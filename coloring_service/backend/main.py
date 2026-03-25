from __future__ import annotations

import os
import io
import base64
import uuid
from datetime import datetime, date, timedelta
from pathlib import Path
from typing import Optional, List
from sqlmodel import select

from fastapi import FastAPI, UploadFile, File, Response, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from db import init_db, get_session, engine
from models import User, Member, ColoredResult, Schedule

from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from passlib.hash import bcrypt
from pydantic import BaseModel

import boto3
from botocore.config import Config


S3_BUCKET = os.getenv("S3_BUCKET")
AWS_REGION = os.getenv("AWS_REGION", "ap-northeast-2")
S3_PRESIGN_EXPIRES = int(os.getenv("S3_PRESIGN_EXPIRES", "3600"))

USE_S3 = bool(S3_BUCKET)

_s3 = None
if USE_S3:
    _s3 = boto3.client(
        "s3",
        region_name=AWS_REGION,
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "virtual"},
        ),
    )

def s3_put_bytes(key: str, data: bytes, content_type: str):
    if not USE_S3:
        raise RuntimeError("S3 is not configured")
    _s3.put_object(
        Bucket=S3_BUCKET,
        Key=key,
        Body=data,
        ContentType=content_type,
    )

def s3_delete(key: str):
    if not USE_S3:
        return
    _s3.delete_object(Bucket=S3_BUCKET, Key=key)

def s3_presign_get(key: str) -> str:
    if not USE_S3:
        raise RuntimeError("S3 is not configured")
    return _s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": S3_BUCKET, "Key": key},
        ExpiresIn=S3_PRESIGN_EXPIRES,
    )


BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# admin setting
JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
JWT_ALG = "HS256"
ACCESS_TOKEN_MINUTES = 60 * 12  # 12 hours

ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD_HASH = os.getenv("ADMIN_PASSWORD_HASH", "$2b$12$wZf4tyr7BRJNTT5CUTZR1.v/xOE0Yl2VOR7npN8sJO1eHZKdJ38rm")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/login")

app = FastAPI(title="Member Management (PostgreSQL)")

# 개발 중 프론트 dev 서버(vite)에서 호출할 경우
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://43.203.198.166:8000",
        "http://43.203.198.166:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 업로드 파일 정적 서빙 (실서비스 권한 필요하면 API로 서빙 권장)
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

# ✅ DB 테이블 생성 (개발용)
init_db()

def seed_admin_user():
    with Session(engine) as session:
        admin = session.exec(
            select(User).where(User.username == ADMIN_USERNAME)
        ).first()

        if admin:
            changed = False

            if admin.role != "admin":
                admin.role = "admin"
                changed = True

            if not admin.is_active:
                admin.is_active = True
                changed = True

            if ADMIN_PASSWORD_HASH and admin.password_hash != ADMIN_PASSWORD_HASH:
                admin.password_hash = ADMIN_PASSWORD_HASH
                changed = True

            if changed:
                admin.updated_at = datetime.utcnow()
                session.add(admin)
                session.commit()
            return

        admin = User(
            username=ADMIN_USERNAME,
            password_hash=ADMIN_PASSWORD_HASH,
            role="admin",
            display_name="Administrator",
            is_active=True,
        )
        session.add(admin)
        session.commit()

seed_admin_user()


# ---------------------------
# Schemas
# ---------------------------
class MemberUpsertIn(BaseModel):
    number: str
    name: str
    birth_date: Optional[date] = None
    memo: Optional[str] = None
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None

    teacher_id: Optional[int] = None

    course_name: Optional[str] = None
    contract_status: Optional[str] = "draft"
    contract_start_date: Optional[date] = None
    contract_end_date: Optional[date] = None
    contract_signed_at: Optional[datetime] = None
    contract_memo: Optional[str] = None

class MemberOut(BaseModel):
    id: int
    number: str
    name: str
    birth_date: Optional[date] = None
    memo: Optional[str] = None
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None

    teacher_id: Optional[int] = None
    teacher_name: Optional[str] = None

    course_name: Optional[str] = None
    contract_status: Optional[str] = None
    contract_start_date: Optional[date] = None
    contract_end_date: Optional[date] = None
    contract_signed_at: Optional[datetime] = None
    contract_memo: Optional[str] = None

    pt_total_count: int = 0
    pt_remaining_count: int = 0

    created_at: datetime
    updated_at: datetime

class SaveColoredIn(BaseModel):
    # member: MemberUpsertIn
    member_number: str
    image_data_url: str  # data:image/png;base64,...
    original_id: Optional[int] = None
    original_upload_url: Optional[str] = None
    selected_date: Optional[date] = None
    note: Optional[str] = None

class SaveColoredOut(BaseModel):
    id: int
    member_id: int
    url: str
    created_at: datetime

class ResultItemOut(BaseModel):
    id: int
    created_at: datetime
    url: str
    thumb_url: Optional[str] = None
    member: MemberOut

class ResultsListOut(BaseModel):
    items: list[ResultItemOut]
    nextCursor: Optional[str] = None

class MemberResultsItem(BaseModel):
    id: int
    selected_date: Optional[date] = None
    created_at: datetime
    url: str
    note: Optional[str] = None

class MemberResultsOut(BaseModel):
    member: MemberOut
    items: List[MemberResultsItem]

class LoginIn(BaseModel):
    username: str
    password: str

class UserMeOut(BaseModel):
    id: int
    username: str
    display_name: str
    role: str
    is_active: bool = True

class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserMeOut

class ScheduleCreateIn(BaseModel):
    title: str
    start_at: str
    end_at: Optional[datetime] = None
    note: Optional[str] = None

class ScheduleOut(BaseModel):
    id: int
    title: str
    start_at: datetime
    end_at: Optional[datetime] = None
    note: Optional[str] = None
    created_at: datetime
    updated_at: datetime

class TeacherCreateIn(BaseModel):
    username: str
    password: str
    display_name: str

class TeacherUpdateIn(BaseModel):
    username: str
    display_name: str
    is_active: bool = True

class TeacherPasswordResetIn(BaseModel):
    password: str

class MemberTeacherAssignIn(BaseModel):
    teacher_id: int

class MemberPtRechargeIn(BaseModel):
    amount: int

class MemberPtConsumeIn(BaseModel):
    amount: int = 1

def create_access_token(user: User) -> str:
    exp = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_MINUTES)
    payload = {
        "sub": user.username,
        "user_id": user.id,
        "role": user.role,
        "exp": exp,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def get_current_user(
    token: str = Depends(oauth2_scheme),
    session: Session = Depends(get_session),
) -> User:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        user_id = payload.get("user_id")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")

        user = session.get(User, user_id)
        if not user or not user.is_active:
            raise HTTPException(status_code=401, detail="User not found")

        return user
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Not an admin")
    return user

# ---------------------------
# Member API
# ---------------------------
@app.post("/api/members/upsert", response_model=MemberOut)
def upsert_member(
    payload: MemberUpsertIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    target_teacher_id = payload.teacher_id if user.role == "admin" else user.id
    if target_teacher_id is None:
        raise HTTPException(
            status_code=400,
            detail="teacher_id is required for admin-created member"
        )

    m = session.exec(select(Member).where(Member.number == payload.number)).first()

    if m:
        if user.role == "teacher" and m.teacher_id != user.id:
            raise HTTPException(status_code=403, detail="Cannot edit another teacher's member")

        m.name = payload.name
        m.birth_date = payload.birth_date
        m.memo = payload.memo
        m.height_cm = payload.height_cm
        m.weight_kg = payload.weight_kg
        m.teacher_id = target_teacher_id
        m.course_name = payload.course_name
        m.contract_status = payload.contract_status or "draft"
        m.contract_start_date = payload.contract_start_date
        m.contract_end_date = payload.contract_end_date
        m.contract_signed_at = payload.contract_signed_at
        m.contract_memo = payload.contract_memo
        m.updated_at = datetime.utcnow()
    else:
        m = Member(
            number=payload.number,
            name=payload.name,
            birth_date=payload.birth_date,
            memo=payload.memo,
            height_cm=payload.height_cm,
            weight_kg=payload.weight_kg,
            teacher_id=target_teacher_id,
            course_name=payload.course_name,
            contract_status=payload.contract_status or "draft",
            contract_start_date=payload.contract_start_date,
            contract_end_date=payload.contract_end_date,
            contract_signed_at=payload.contract_signed_at,
            contract_memo=payload.contract_memo,
        )

    session.add(m)
    session.commit()
    session.refresh(m)

    teacher = session.get(User, m.teacher_id)

    return MemberOut(
        id=m.id,
        number=m.number,
        name=m.name,
        birth_date=m.birth_date,
        memo=m.memo,
        height_cm=m.height_cm,
        weight_kg=m.weight_kg,
        teacher_id=m.teacher_id,
        teacher_name=teacher.display_name if teacher else None,
        course_name=m.course_name,
        contract_status=m.contract_status,
        contract_start_date=m.contract_start_date,
        contract_end_date=m.contract_end_date,
        contract_signed_at=m.contract_signed_at,
        contract_memo=m.contract_memo,
        pt_total_count=m.pt_total_count,
        pt_remaining_count=m.pt_remaining_count,
        created_at=m.created_at,
        updated_at=m.updated_at,
    )

@app.get("/api/members/{name}")
def get_member(
    name: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    stmt = scoped_member_query(user).where(Member.name == name)
    m = session.exec(stmt).first()
    if not m:
        return Response(status_code=404)

    teacher = session.get(User, m.teacher_id)

    return {
        "id": m.id,
        "number": m.number,
        "name": m.name,
        "birth_date": m.birth_date,
        "memo": m.memo,
        "height_cm": m.height_cm,
        "weight_kg": m.weight_kg,
        "teacher_id": m.teacher_id,
        "teacher_name": teacher.display_name if teacher else None,
        "course_name": m.course_name,
        "contract_status": m.contract_status,
        "contract_start_date": m.contract_start_date,
        "contract_end_date": m.contract_end_date,
        "contract_signed_at": m.contract_signed_at,
        "contract_memo": m.contract_memo,
        "created_at": m.created_at,
        "updated_at": m.updated_at,
    }


@app.get("/api/members/by-number/{number}", response_model=MemberOut)
def get_member_by_number(
    number: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    stmt = scoped_member_query(user).where(Member.number == number)
    m = session.exec(stmt).first()
    if not m:
        raise HTTPException(status_code=404, detail="Member not found")

    teacher = session.get(User, m.teacher_id)
    return MemberOut(
        id=m.id,
        number=m.number,
        name=m.name,
        birth_date=m.birth_date,
        memo=m.memo,
        height_cm=m.height_cm,
        weight_kg=m.weight_kg,
        teacher_id=m.teacher_id,
        teacher_name=teacher.display_name if teacher else None,
        course_name=m.course_name,
        contract_status=m.contract_status,
        contract_start_date=m.contract_start_date,
        contract_end_date=m.contract_end_date,
        contract_signed_at=m.contract_signed_at,
        contract_memo=m.contract_memo,
        pt_total_count=m.pt_total_count,
        pt_remaining_count=m.pt_remaining_count,
        created_at=m.created_at,
        updated_at=m.updated_at,
    )


@app.get("/api/members", response_model=list[MemberOut])
def list_members(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    stmt = scoped_member_query(user).order_by(Member.updated_at.desc(), Member.id.desc())
    rows = session.exec(stmt).all()

    result = []
    for m in rows:
        teacher = session.get(User, m.teacher_id)
        result.append(
            MemberOut(
                id=m.id,
                number=m.number,
                name=m.name,
                birth_date=m.birth_date,
                memo=m.memo,
                height_cm=m.height_cm,
                weight_kg=m.weight_kg,
                teacher_id=m.teacher_id,
                teacher_name=teacher.display_name if teacher else None,
                course_name=m.course_name,
                contract_status=m.contract_status,
                contract_start_date=m.contract_start_date,
                contract_end_date=m.contract_end_date,
                contract_signed_at=m.contract_signed_at,
                contract_memo=m.contract_memo,
                pt_total_count=m.pt_total_count,
                pt_remaining_count=m.pt_remaining_count,
                created_at=m.created_at,
                updated_at=m.updated_at,
            )
        )
    return result

@app.get("/api/members/by-name/{name}/results")
def get_member_results_by_name(
    name: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    stmt = (
        scoped_member_query(user)
        .where(Member.name == name)
        .order_by(Member.updated_at.desc(), Member.id.desc())
    )
    m = session.exec(stmt).first()
    if not m:
        return Response(status_code=404)

    rows = session.exec(
        select(ColoredResult)
        .where(ColoredResult.member_id == m.id)
        .order_by(ColoredResult.id.desc())
    ).all()

    teacher = session.get(User, m.teacher_id)

    items = []
    for r in rows:
        items.append({
            "id": r.id,
            "selected_date": getattr(r, "selected_date", None),
            "created_at": r.created_at,
            "url": f"/api/results/{r.id}/image",
            "note": r.note,
        })

    return {
        "member": {
            "id": m.id,
            "number": m.number,
            "name": m.name,
            "birth_date": m.birth_date,
            "height_cm": m.height_cm,
            "weight_kg": m.weight_kg,
            "memo": m.memo,
            "teacher_id": m.teacher_id,
            "teacher_name": teacher.display_name if teacher else None,
            "course_name": m.course_name,
            "contract_status": m.contract_status,
            "contract_start_date": m.contract_start_date,
            "contract_end_date": m.contract_end_date,
            "contract_signed_at": m.contract_signed_at,
            "contract_memo": m.contract_memo,
            "pt_total_count": m.pt_total_count,
            "pt_remaining_count": m.pt_remaining_count,
            "created_at": m.created_at,
            "updated_at": m.updated_at,
        },
        "items": items,
    }


@app.get("/api/members/search", response_model=list[MemberOut])
def search_members(
    q: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    keyword = q.strip()
    if not keyword:
        return []

    stmt = (
        scoped_member_query(user)
        .where(Member.name.ilike(f"%{keyword}%"))
        .order_by(Member.name.asc(), Member.created_at.desc(), Member.id.desc())
    )
    rows = session.exec(stmt).all()

    result: list[MemberOut] = []
    for m in rows:
        teacher = session.get(User, m.teacher_id)
        result.append(
            MemberOut(
                id=m.id,
                number=m.number,
                name=m.name,
                birth_date=m.birth_date,
                memo=m.memo,
                height_cm=m.height_cm,
                weight_kg=m.weight_kg,
                teacher_id=m.teacher_id,
                teacher_name=teacher.display_name if teacher else None,
                course_name=m.course_name,
                contract_status=m.contract_status,
                contract_start_date=m.contract_start_date,
                contract_end_date=m.contract_end_date,
                contract_signed_at=m.contract_signed_at,
                contract_memo=m.contract_memo,
                pt_total_count=m.pt_total_count,
                pt_remaining_count=m.pt_remaining_count,
                created_at=m.created_at,
                updated_at=m.updated_at,
            )
        )
    return result


@app.get("/api/members/{member_id}/detail", response_model=MemberOut)
def get_member_detail(
    member_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    m = session.get(Member, member_id)
    if not m:
        raise HTTPException(status_code=404, detail="Member not found")
    ensure_member_access(user, m)

    teacher = session.get(User, m.teacher_id)
    return MemberOut(
        id=m.id,
        number=m.number,
        name=m.name,
        birth_date=m.birth_date,
        memo=m.memo,
        height_cm=m.height_cm,
        weight_kg=m.weight_kg,
        teacher_id=m.teacher_id,
        teacher_name=teacher.display_name if teacher else None,
        course_name=m.course_name,
        contract_status=m.contract_status,
        contract_start_date=m.contract_start_date,
        contract_end_date=m.contract_end_date,
        contract_signed_at=m.contract_signed_at,
        contract_memo=m.contract_memo,
        pt_total_count=m.pt_total_count,
        pt_remaining_count=m.pt_remaining_count,
        created_at=m.created_at,
        updated_at=m.updated_at,
    )


def scoped_member_query(user: User):
    stmt = select(Member)
    if user.role == "teacher":
        stmt = stmt.where(Member.teacher_id == user.id)
    return stmt

def ensure_member_access(user: User, member: Member):
    if user.role == "admin":
        return

    if user.role == "teacher" and member.teacher_id == user.id:
        return

    raise HTTPException(status_code=403, detail="Forbidden member access")

# ---------------------------
# Save colored image (with member link)
# ---------------------------
@app.post("/api/results/save", response_model=SaveColoredOut)
def save_colored(
    payload: SaveColoredIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    # 1) 기존 회원만 조회 (Color 페이지에서는 회원 생성/수정 금지)
    m = session.exec(select(Member).where(Member.number == payload.member_number)).first()
    if not m:
        raise HTTPException(status_code=404, detail="Member not found")
    ensure_member_access(user, m)

    # 2) decode data URL
    data_url = payload.image_data_url
    if not data_url.startswith("data:image"):
        return Response("Invalid image_data_url", status_code=400)

    header, encoded = data_url.split(",", 1)
    binary = base64.b64decode(encoded)

    mime = "image/png"
    if ";base64" in header and ":" in header:
        mime = header.split(":")[1].split(";")[0]

    # 3) save file: uploads/members/<member_id>/colored_<uuid>.png
    filename = f"colored_{uuid.uuid4().hex}.png"
    key = f"members/{m.id}/{filename}"

    if USE_S3:
        s3_put_bytes(key, binary, mime)
        rel = key  # DB에는 S3 key 저장
    else:
        member_dir = UPLOAD_DIR / "members" / str(m.id)
        member_dir.mkdir(parents=True, exist_ok=True)
        
        path = member_dir / filename
        written = path.write_bytes(binary)

        exists_now = path.exists()
        size_now = path.stat().st_size if exists_now else 0
        
        print("[SAVE_COLORED] UPLOAD_DIR =", UPLOAD_DIR)
        print("[SAVE_COLORED] member_dir =", member_dir)
        print("[SAVE_COLORED] saved path =", path)
        print("[SAVE_COLORED] written =", written)
        print("[SAVE_COLORED] exists after save =", exists_now)
        print("[SAVE_COLORED] size after save =", size_now)
        
        if written <= 0 or not exists_now or size_now <= 0:
            try:
                if path.exists():
                    path.unlink()
            except Exception:
                pass
            raise HTTPException(status_code=500, detail="Failed to save colored image file.")

        rel = path.relative_to(UPLOAD_DIR).as_posix()
        print("[SAVE_COLORED] rel =", rel)

    # 4) save db row
    r = ColoredResult(
        member_id=m.id,
        filename=rel,
        mime=mime,
        original_id=payload.original_id,
        selected_date=payload.selected_date,
        note=payload.note,
    )
    try:
        session.add(r)
        session.commit()
        session.refresh(r)
    except Exception:
        session.rollback()
        if not USE_S3:
            try:
                file_path = UPLOAD_DIR / rel
                if file_path.exists():
                    file_path.unlink()
            except Exception:
                pass
        raise

    # 5) delete original uploaded file (optional)
    if getattr(payload, "original_upload_url", None):
        _safe_unlink_uploaded_url(payload.original_upload_url)

    return SaveColoredOut(
        id=r.id,
        member_id=m.id,
        url=(s3_presign_get(r.filename) if USE_S3 else f"/uploads/{r.filename}"),
        created_at=r.created_at,
    )

@app.put("/api/results/{result_id}", response_model=SaveColoredOut)
def update_colored_result(
    result_id: int,
    payload: SaveColoredIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    r = session.get(ColoredResult, result_id)
    if not r:
        raise HTTPException(status_code=404, detail="Result not found")

    current_member = session.get(Member, r.member_id)
    if not current_member:
        raise HTTPException(status_code=404, detail="Original member not found")

    ensure_member_access(user, current_member)

    # 1) 변경 대상 회원 조회만 허용
    m = session.exec(select(Member).where(Member.number == payload.member_number)).first()
    if not m:
        raise HTTPException(status_code=404, detail="Member not found")
    ensure_member_access(user, m)

    # 2) decode image
    data_url = payload.image_data_url
    if not data_url.startswith("data:image"):
        return Response("Invalid image_data_url", status_code=400)

    header, encoded = data_url.split(",", 1)
    binary = base64.b64decode(encoded)

    mime = "image/png"
    if ";base64" in header and ":" in header:
        mime = header.split(":")[1].split(";")[0]

    old_filename = r.filename

    # 3) save new file
    filename = f"colored_{uuid.uuid4().hex}.png"
    key = f"members/{m.id}/{filename}"

    if USE_S3:
        s3_put_bytes(key, binary, mime)
        rel = key
    else:
        member_dir = UPLOAD_DIR / "members" / str(m.id)
        member_dir.mkdir(parents=True, exist_ok=True)

        path = member_dir / filename
        written = path.write_bytes(binary)

        exists_now = path.exists()
        size_now = path.stat().st_size if exists_now else 0

        if written <= 0 or not exists_now or size_now <= 0:
            try:
                if path.exists():
                    path.unlink()
            except Exception:
                pass
            raise HTTPException(status_code=500, detail="Failed to save updated image file.")

        rel = path.relative_to(UPLOAD_DIR).as_posix()

    # 4) update DB row
    r.member_id = m.id
    r.filename = rel
    r.mime = mime
    r.selected_date = payload.selected_date
    r.note = payload.note
    r.original_id = payload.original_id

    session.add(r)
    session.commit()
    session.refresh(r)

    # 5) delete old file
    if old_filename and old_filename != rel:
        if USE_S3:
            s3_delete(old_filename)
        else:
            try:
                old_path = UPLOAD_DIR / old_filename
                if old_path.exists():
                    old_path.unlink()
            except Exception:
                pass

    return SaveColoredOut(
        id=r.id,
        member_id=r.member_id,
        url=(s3_presign_get(r.filename) if USE_S3 else f"/uploads/{r.filename}"),
        created_at=r.created_at,
    )

def _safe_unlink_uploaded_url(url: str) -> bool:
    """Delete a file under UPLOAD_DIR given a public /uploads/... URL.

    Safety:
    - Only accepts URLs starting with /uploads/
    - Never deletes files under /uploads/members/ (saved results)
    """
    try:
        if not url or not isinstance(url, str):
            return False
        if not url.startswith("/uploads/"):
            return False

        rel = url[len("/uploads/"):]
        # prevent deleting saved results
        if rel.startswith("members/"):
            return False

        base = UPLOAD_DIR.resolve()
        target = (UPLOAD_DIR / rel).resolve()

        if base not in target.parents and target != base:
            return False
        if target.exists() and target.is_file():
            target.unlink()
            return True
        return False
    except Exception:
        return False


# ---------------------------
# List results (My Member page)
# cursor = last id
# ---------------------------
@app.get("/api/results", response_model=ResultsListOut)
def list_results(
    limit: int = 24,
    cursor: Optional[int] = None,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    stmt = select(ColoredResult).order_by(ColoredResult.id.desc()).limit(limit + 1)
    if cursor is not None:
        stmt = stmt.where(ColoredResult.id < cursor)

    rows = session.exec(stmt).all()

    next_cursor = None
    if len(rows) > limit:
        next_cursor = rows[limit - 1].id
        rows = rows[:limit]

    items: list[ResultItemOut] = []
    for r in rows:
        if not USE_S3:
            file_path = UPLOAD_DIR / r.filename
            if not file_path.exists():
                print("[MISSING LIST FILE]", r.id, file_path)
                continue

        m = session.get(Member, r.member_id)
        if not m:
            continue
        if user.role == "teacher" and m.teacher_id != user.id:
            continue

        items.append(
            ResultItemOut(
                id=r.id,
                created_at=r.created_at,
                url=(s3_presign_get(r.filename) if USE_S3 else f"/uploads/{r.filename}"),
                thumb_url=None,
                member=MemberOut(
                    id=m.id,
                    number=m.number,
                    name=m.name,
                    birth_date=m.birth_date,
                    memo=m.memo,
                    height_cm=m.height_cm,
                    weight_kg=m.weight_kg,
                    pt_total_count=m.pt_total_count,
                    pt_remaining_count=m.pt_remaining_count,
                    created_at=m.created_at,
                    updated_at=m.updated_at,
                ),
            )
        )

    return ResultsListOut(items=items, nextCursor=str(next_cursor) if next_cursor else None)


# ---------------------------
# Delete result (DB + file)
# ---------------------------
@app.delete("/api/images/{result_id}")
def delete_result(
    result_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    r = session.get(ColoredResult, result_id)
    if not r:
        return Response(status_code=404)

    m = session.get(Member, r.member_id)
    if not m:
        return Response(status_code=404)
    ensure_member_access(user, m)

    # delete file
    if USE_S3:
        s3_delete(r.filename)  # r.filename이 S3 key
    else:
        file_path = UPLOAD_DIR / r.filename
        try:
            if file_path.exists():
                file_path.unlink()
        except:
            pass

    session.delete(r)
    session.commit()
    return Response(status_code=204)


@app.post("/api/upload")
async def upload_image(file: UploadFile = File(...)):
    # 간단한 파일 타입 체크
    if not file.content_type or not file.content_type.startswith("image/"):
        return Response("Only image files are allowed.", status_code=400)

    ext = Path(file.filename or "").suffix.lower()
    if ext not in [".png", ".jpg", ".jpeg", ".webp", ".bmp"]:
        # content_type이 image여도 확장자가 없을 수 있어서 default png로
        ext = ".png"

    data = await file.read()

    if USE_S3:
        key = f"tmp/{uuid.uuid4().hex}{ext}"
        s3_put_bytes(key, data, file.content_type or "application/octet-stream")
        # 프론트는 url만 써도 되게 presigned url을 내려줌
        return {"url": s3_presign_get(key), "key": key}

    # (S3 미설정 시) 기존 로컬 저장 fallback
    filename = f"{uuid.uuid4().hex}{ext}"
    path = UPLOAD_DIR / filename

    written = path.write_bytes(data)
    exists_now = path.exists()
    size_now = path.stat().st_size if exists_now else 0

    print("[UPLOAD] path =", path)
    print("[UPLOAD] written =", written)
    print("[UPLOAD] exists after save =", exists_now)
    print("[UPLOAD] size after save =", size_now)

    if written <= 0 or not exists_now or size_now <= 0:
        try:
            if path.exists():
                path.unlink()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Failed to save uploaded image.")

    return {"url": f"/uploads/{filename}"}


@app.get("/api/members/{number}/results", response_model=MemberResultsOut)
def get_member_results(
    number: str,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    # 1) 회원 조회
    m = session.exec(select(Member).where(Member.number == number)).first()
    if not m:
        raise HTTPException(status_code=404, detail="Member not found")

    # 2) 현재 로그인 사용자가 이 회원을 볼 수 있는지 검사
    ensure_member_access(user, m)

    # 3) 결과 목록 조회
    stmt = select(ColoredResult).where(ColoredResult.member_id == m.id)

    if date_from is not None:
        stmt = stmt.where(ColoredResult.selected_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(ColoredResult.selected_date <= date_to)

    stmt = stmt.order_by(
        ColoredResult.selected_date.desc().nullslast(),
        ColoredResult.id.desc(),
    )

    rows = session.exec(stmt).all()

    items = []
    for r in rows:
        if not USE_S3:
            file_path = UPLOAD_DIR / r.filename
            if not file_path.exists() or not file_path.is_file():
                print("[MISSING MEMBER FILE]", r.id, file_path)
                continue

        items.append(
            MemberResultsItem(
                id=r.id,
                selected_date=r.selected_date,
                created_at=r.created_at,
                url=(s3_presign_get(r.filename) if USE_S3 else f"/uploads/{r.filename}"),
                note=r.note,
            )
        )

    return MemberResultsOut(
        member=MemberOut(
            id=m.id,
            number=m.number,
            name=m.name,
            birth_date=m.birth_date,
            memo=m.memo,
            height_cm=m.height_cm,
            weight_kg=m.weight_kg,
            teacher_id=getattr(m, "teacher_id", None),
            teacher_name=None,
            course_name=m.course_name,
            contract_status=m.contract_status,
            contract_start_date=m.contract_start_date,
            contract_end_date=m.contract_end_date,
            contract_signed_at=m.contract_signed_at,
            contract_memo=m.contract_memo,
            pt_total_count=m.pt_total_count,
            pt_remaining_count=m.pt_remaining_count,
            created_at=m.created_at,
            updated_at=m.updated_at,
        ),
        items=items,
    )


# ---------------------------
# Admin login API
# ---------------------------
@app.post("/api/login", response_model=TokenOut)
def login(body: LoginIn, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.username == body.username)).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not bcrypt.verify(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token(user)

    return TokenOut(
        access_token=token,
        user=UserMeOut(
            id=user.id,
            username=user.username,
            display_name=user.display_name,
            role=user.role,
            is_active=user.is_active,
        ),
    )

@app.get("/api/me", response_model=UserMeOut)
def me(user: User = Depends(get_current_user)):
    return UserMeOut(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        role=user.role,
        is_active=user.is_active,
    )

@app.get("/api/admin/ping")
def admin_ping(_admin: str = Depends(require_admin)):
    return {"ok": True}

@app.get("/api/admin/teachers", response_model=list[UserMeOut])
def list_teachers(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    rows = session.exec(
        select(User)
        .where(User.role == "teacher")
        .order_by(User.display_name.asc(), User.id.asc())
    ).all()

    return [
        UserMeOut(
            id=u.id,
            username=u.username,
            display_name=u.display_name,
            role=u.role,
            is_active=u.is_active,
        )
        for u in rows
    ]

@app.post("/api/admin/teachers", response_model=UserMeOut)
def create_teacher(
    payload: TeacherCreateIn,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    if not payload.username.strip():
        raise HTTPException(status_code=400, detail="Username is required")
    if not payload.display_name.strip():
        raise HTTPException(status_code=400, detail="Display name is required")
    if not payload.password.strip():
        raise HTTPException(status_code=400, detail="Password is required")

    exists = session.exec(select(User).where(User.username == payload.username)).first()
    if exists:
        raise HTTPException(status_code=400, detail="Username already exists")

    row = User(
        username=payload.username.strip(),
        password_hash=bcrypt.hash(payload.password),
        role="teacher",
        display_name=payload.display_name.strip(),
        is_active=True,
    )
    session.add(row)
    session.commit()
    session.refresh(row)

    return UserMeOut(
        id=row.id,
        username=row.username,
        display_name=row.display_name,
        role=row.role,
        is_active=row.is_active,
    )

@app.put("/api/admin/members/{member_id}/teacher", response_model=MemberOut)
def assign_member_teacher(
    member_id: int,
    payload: MemberTeacherAssignIn,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    m = session.get(Member, member_id)
    if not m:
        raise HTTPException(status_code=404, detail="Member not found")

    teacher = session.get(User, payload.teacher_id)
    if not teacher or teacher.role != "teacher":
        raise HTTPException(status_code=400, detail="Teacher not found")

    m.teacher_id = teacher.id
    m.updated_at = datetime.utcnow()
    session.add(m)
    session.commit()
    session.refresh(m)

    return MemberOut(
        id=m.id,
        number=m.number,
        name=m.name,
        birth_date=m.birth_date,
        memo=m.memo,
        height_cm=m.height_cm,
        weight_kg=m.weight_kg,
        teacher_id=m.teacher_id,
        teacher_name=teacher.display_name,
        pt_total_count=m.pt_total_count,
        pt_remaining_count=m.pt_remaining_count,
        created_at=m.created_at,
        updated_at=m.updated_at,
    )

@app.put("/api/admin/teachers/{teacher_id}", response_model=UserMeOut)
def update_teacher(
    teacher_id: int,
    payload: TeacherUpdateIn,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    row = session.get(User, teacher_id)
    if not row or row.role != "teacher":
        raise HTTPException(status_code=404, detail="Teacher not found")

    username = payload.username.strip()
    display_name = payload.display_name.strip()

    if not username:
        raise HTTPException(status_code=400, detail="Username is required")
    if not display_name:
        raise HTTPException(status_code=400, detail="Display name is required")

    dup = session.exec(
        select(User).where(User.username == username, User.id != teacher_id)
    ).first()
    if dup:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    row.username = username
    row.display_name = display_name
    row.is_active = payload.is_active
    row.updated_at = datetime.utcnow()
    session.add(row)
    session.commit()
    session.refresh(row)

    return UserMeOut(
        id=row.id,
        username=row.username,
        display_name=row.display_name,
        role=row.role,
        is_active=row.is_active,
    )

@app.put("/api/admin/teachers/{teacher_id}/password")
def reset_teacher_password(
    teacher_id: int,
    payload: TeacherPasswordResetIn,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    row = session.get(User, teacher_id)
    if not row or row.role != "teacher":
        raise HTTPException(status_code=404, detail="Teacher not found")

    password = payload.password.strip()
    if not password:
        raise HTTPException(status_code=400, detail="Password is required")

    row.password_hash = bcrypt.hash(password)
    row.updated_at = datetime.utcnow()
    session.add(row)
    session.commit()

    return {"ok": True}

@app.delete("/api/admin/teachers/{teacher_id}")
def delete_teacher(
    teacher_id: int,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    row = session.get(User, teacher_id)
    if not row or row.role != "teacher":
        raise HTTPException(status_code=404, detail="Teacher not found")

    assigned_members = session.exec(
        select(Member).where(Member.teacher_id == teacher_id)
    ).all()
    if assigned_members:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete teacher with assigned members",
        )

    session.delete(row)
    session.commit()
    return {"ok": True}


# ---------------------------
# Schedule API
# ---------------------------
def parse_dt(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v
    if isinstance(v, str):
        v = v.strip()
        if v == "":
            return None
        return datetime.fromisoformat(v)
    return None  # 예상 못한 타입이면 None 처리(원하면 400으로 에러 처리 가능)

@app.get("/api/schedules", response_model=list[ScheduleOut])
def list_schedules(
    start: Optional[date] = None,
    end: Optional[date] = None,
    session: Session = Depends(get_session),
    _: str = Depends(require_admin),
):
    stmt = select(Schedule).order_by(Schedule.start_at.asc())

    if start:
        stmt = stmt.where(Schedule.start_at >= datetime.combine(start, datetime.min.time()))
    if end:
        stmt = stmt.where(Schedule.start_at <= datetime.combine(end, datetime.max.time()))

    return session.exec(stmt).all()


@app.post("/api/schedules", response_model=ScheduleOut)
def create_schedule(
    payload: ScheduleCreateIn,
    session: Session = Depends(get_session),
    _: str = Depends(require_admin),
):
    row = Schedule(
        title=payload.title,
        start_at=datetime.fromisoformat(payload.start_at),
        end_at=parse_dt(payload.end_at),
        note=payload.note,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@app.delete("/api/schedules/{schedule_id}")
def delete_schedule(
    schedule_id: int,
    session: Session = Depends(get_session),
    _: str = Depends(require_admin),
):
    row = session.get(Schedule, schedule_id)
    if not row:
        raise HTTPException(status_code=404, detail="Schedule not found")
    session.delete(row)
    session.commit()
    return {"ok": True}


@app.put("/api/schedules/{schedule_id}", response_model=ScheduleOut)
def update_schedule(
    schedule_id: int,
    payload: ScheduleCreateIn,
    session: Session = Depends(get_session),
    _: str = Depends(require_admin),
):
    row = session.get(Schedule, schedule_id)
    if not row:
        raise HTTPException(status_code=404, detail="Schedule not found")

    row.title = payload.title
    row.start_at = datetime.fromisoformat(payload.start_at)
    row.end_at = datetime.fromisoformat(payload.end_at) if payload.end_at else None
    row.note = payload.note
    row.updated_at = datetime.utcnow()

    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@app.get("/api/results/{result_id}/image")
def get_result_image(result_id: int, session: Session = Depends(get_session)):
    r = session.get(ColoredResult, result_id)
    if not r:
        raise HTTPException(status_code=404, detail="Result not found")

    if USE_S3:
        obj = _s3.get_object(Bucket=S3_BUCKET, Key=r.filename)
        body = obj["Body"].read()
        return Response(content=body, media_type=r.mime or "image/png")
    else:
        file_path = UPLOAD_DIR / r.filename
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Image file not found")
        return FileResponse(str(file_path), media_type=r.mime or "image/png")


@app.post("/api/members/{member_id}/pt/recharge", response_model=MemberOut)
def recharge_member_pt(
    member_id: int,
    payload: MemberPtRechargeIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    m = session.get(Member, member_id)
    if not m:
        raise HTTPException(status_code=404, detail="Member not found")

    ensure_member_access(user, m)

    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="amount must be > 0")

    m.pt_total_count += payload.amount
    m.pt_remaining_count += payload.amount
    m.updated_at = datetime.utcnow()

    session.add(m)
    session.commit()
    session.refresh(m)

    teacher = session.get(User, m.teacher_id)

    return MemberOut(
        id=m.id,
        number=m.number,
        name=m.name,
        birth_date=m.birth_date,
        memo=m.memo,
        height_cm=m.height_cm,
        weight_kg=m.weight_kg,
        teacher_id=m.teacher_id,
        teacher_name=teacher.display_name if teacher else None,
        course_name=m.course_name,
        contract_status=m.contract_status,
        contract_start_date=m.contract_start_date,
        contract_end_date=m.contract_end_date,
        contract_signed_at=m.contract_signed_at,
        contract_memo=m.contract_memo,
        pt_total_count=m.pt_total_count,
        pt_remaining_count=m.pt_remaining_count,
        created_at=m.created_at,
        updated_at=m.updated_at,
    )


@app.post("/api/members/{member_id}/pt/consume", response_model=MemberOut)
def consume_member_pt(
    member_id: int,
    payload: MemberPtConsumeIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    m = session.get(Member, member_id)
    if not m:
        raise HTTPException(status_code=404, detail="Member not found")

    ensure_member_access(user, m)

    amount = payload.amount or 1

    if amount <= 0:
        raise HTTPException(status_code=400, detail="amount must be > 0")

    if m.pt_remaining_count < amount:
        raise HTTPException(status_code=400, detail="Not enough PT remaining")

    m.pt_remaining_count -= amount
    m.updated_at = datetime.utcnow()

    session.add(m)
    session.commit()
    session.refresh(m)

    teacher = session.get(User, m.teacher_id)

    return MemberOut(
        id=m.id,
        number=m.number,
        name=m.name,
        birth_date=m.birth_date,
        memo=m.memo,
        height_cm=m.height_cm,
        weight_kg=m.weight_kg,
        teacher_id=m.teacher_id,
        teacher_name=teacher.display_name if teacher else None,
        course_name=m.course_name,
        contract_status=m.contract_status,
        contract_start_date=m.contract_start_date,
        contract_end_date=m.contract_end_date,
        contract_signed_at=m.contract_signed_at,
        contract_memo=m.contract_memo,
        pt_total_count=m.pt_total_count,
        pt_remaining_count=m.pt_remaining_count,
        created_at=m.created_at,
        updated_at=m.updated_at,
    )


# (선택) 배포 시 frontend 빌드 결과를 백엔드가 서빙하도록 할 때
# frontend/dist 를 backend/static 으로 복사해서 사용해도 되고,
# 여기서는 backend가 ../frontend/dist 를 직접 서빙하는 형태 예시
FRONT_DIST = (BASE_DIR.parent / "frontend" / "dist").resolve()
if FRONT_DIST.exists():
    if not USE_S3:
        app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

    @app.get("/")
    def index():
        return FileResponse(str(FRONT_DIST / "index.html"))
    
    # SPA 라우팅을 쓸 경우(선택)
    @app.get("/{path:path}")
    def spa_fallback(path: str):
        file_path = FRONT_DIST / path
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(FRONT_DIST / "index.html"))


# @app.get("/health")
# def health():
#     return {"ok": True}
