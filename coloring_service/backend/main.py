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

from db import init_db, get_session
from models import Member, ColoredResult, Schedule

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

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/admin/login")

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

class MemberOut(BaseModel):
    id: int
    number: str
    name: str
    birth_date: Optional[date] = None
    memo: Optional[str] = None

    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None

    created_at: datetime
    updated_at: datetime

class SaveColoredIn(BaseModel):
    member: MemberUpsertIn
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

class AdminLoginIn(BaseModel):
    username: str
    password: str

class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"

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

def create_access_token(subject: str) -> str:
    exp = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_MINUTES)
    payload = {"sub": subject, "exp": exp, "role": "admin"}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def require_admin(token: str = Depends(oauth2_scheme)) -> str:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        if payload.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Not an admin")
        return payload.get("sub", "")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

# ---------------------------
# Member API
# ---------------------------
@app.post("/api/members/upsert", response_model=MemberOut)
def upsert_member(payload: MemberUpsertIn, session: Session = Depends(get_session)):
    m = session.exec(select(Member).where(Member.number == payload.number)).first()

    if m:
        m.name = payload.name
        m.birth_date = payload.birth_date
        m.memo = payload.memo
        m.height_cm = payload.height_cm
        m.weight_kg = payload.weight_kg
        m.updated_at = datetime.utcnow()
        session.add(m)
        session.commit()
        session.refresh(m)
        return m

    m = Member(
        number=payload.number, 
        name=payload.name,
        birth_date=payload.birth_date,
        memo=payload.memo,
        height_cm=payload.height_cm,
        weight_kg=payload.weight_kg
        )
    session.add(m)
    session.commit()
    session.refresh(m)
    return m

@app.get("/api/members/{name}")
def get_member(name: str, session: Session = Depends(get_session)):
    m = session.exec(select(Member).where(Member.name == name)).first()
    if not m:
        return Response(status_code=404)
    return {
        "id": m.id,
        "number": m.number,
        "name": m.name,
        "birth_date": m.birth_date,
        "memo": m.memo,
        "height_cm": m.height_cm,
        "weight_kg": m.weight_kg,
        "created_at": m.created_at,
        "updated_at": m.updated_at,
    }

@app.get("/api/members", response_model=list[MemberOut])
def list_members(session: Session = Depends(get_session)):
    rows = session.exec(
        select(Member).order_by(Member.updated_at.desc(), Member.id.desc())
    ).all()
    return rows

@app.get("/api/members/by-name/{name}/results")
def get_member_results_by_name(name: str, session: Session = Depends(get_session)):
    # 이름이 중복될 수 있으므로, 가장 최근(updated_at) 멤버를 우선 선택합니다.
    stmt = (
        select(Member)
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

    items = []
    for r in rows:
        if not USE_S3:
            file_path = UPLOAD_DIR / r.filename
            if not file_path.exists():
                print("[MISSING RESULT FILE]", r.id, file_path)
                continue
        
        items.append({
            "id": r.id,
            "selected_date": getattr(r, "selected_date", None),
            "created_at": r.created_at,
            # "url": (s3_presign_get(r.filename) if USE_S3 else f"/uploads/{r.filename}"),
            "url": f"/api/results/{r.id}/image",
            "note": r.note,
        })

    return {
        "member": {
            "id": m.id,
            "number": m.number,
            "name": m.name,
            "birth_date": m.birth_date,
            "height_cm": getattr(m, "height_cm", None),
            "weight_kg": getattr(m, "weight_kg", None),
            "memo": m.memo,
            "created_at": m.created_at,
            "updated_at": m.updated_at,
        },
        "items": items,
    }


# ---------------------------
# Save colored image (with member link)
# ---------------------------
@app.post("/api/results/save", response_model=SaveColoredOut)
def save_colored(payload: SaveColoredIn, session: Session = Depends(get_session)):
    # 1) member upsert by number
    m = session.exec(select(Member).where(Member.number == payload.member.number)).first()
    if m:
        m.name = payload.member.name
        m.birth_date = payload.member.birth_date
        m.memo = payload.member.memo
        m.height_cm = payload.member.height_cm
        m.weight_kg = payload.member.weight_kg
        m.updated_at = datetime.utcnow()
        session.add(m)
        session.commit()
        session.refresh(m)
    else:
        m = Member(
            number=payload.member.number,
            name=payload.member.name,
            birth_date=payload.member.birth_date,
            memo=payload.member.memo,
            height_cm=payload.member.height_cm,
            weight_kg=payload.member.weight_kg,
        )
        session.add(m)
        session.commit()
        session.refresh(m)

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
):
    r = session.get(ColoredResult, result_id)
    if not r:
        raise HTTPException(status_code=404, detail="Result not found")

    # 1) member upsert / update
    m = session.exec(select(Member).where(Member.number == payload.member.number)).first()
    if m:
        m.name = payload.member.name
        m.birth_date = payload.member.birth_date
        m.memo = payload.member.memo
        m.height_cm = payload.member.height_cm
        m.weight_kg = payload.member.weight_kg
        m.updated_at = datetime.utcnow()
        session.add(m)
        session.commit()
        session.refresh(m)
    else:
        m = Member(
            number=payload.member.number,
            name=payload.member.name,
            birth_date=payload.member.birth_date,
            memo=payload.member.memo,
            height_cm=payload.member.height_cm,
            weight_kg=payload.member.weight_kg,
        )
        session.add(m)
        session.commit()
        session.refresh(m)

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
def delete_result(result_id: int, session: Session = Depends(get_session)):
    r = session.get(ColoredResult, result_id)
    if not r:
        return Response(status_code=404)

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
):
    m = session.exec(select(Member).where(Member.number == number)).first()
    if not m:
        raise HTTPException(status_code=404, detail="Member not found")

    stmt = select(ColoredResult).where(ColoredResult.member_id == m.id)

    if date_from is not None:
        stmt = stmt.where(ColoredResult.selected_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(ColoredResult.selected_date <= date_to)

    stmt = stmt.order_by(ColoredResult.selected_date.desc().nullslast(), ColoredResult.id.desc())

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
            memo=m.memo,
            height_cm=m.height_cm,
            weight_kg=m.weight_kg,
            created_at=m.created_at,
            updated_at=m.updated_at,
        ),
        items=items,
    )


# ---------------------------
# Admin login API
# ---------------------------
@app.post("/api/admin/login", response_model=TokenOut)
def admin_login(body: AdminLoginIn):
    if body.username != ADMIN_USERNAME:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not ADMIN_PASSWORD_HASH:
        raise HTTPException(status_code=500, detail="Admin password not configured")

    if not bcrypt.verify(body.password, ADMIN_PASSWORD_HASH):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token(subject=body.username)
    return TokenOut(access_token=token)


@app.get("/api/admin/ping")
def admin_ping(_admin: str = Depends(require_admin)):
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
