from __future__ import annotations

import os
import uuid
from pathlib import Path

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Coloring Service")

# 개발 중 프론트 dev 서버(vite)에서 호출할 경우 CORS 허용
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 업로드 파일 정적 서빙
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


@app.post("/api/upload")
async def upload_image(file: UploadFile = File(...)):
    # 간단한 파일 타입 체크
    if not file.content_type or not file.content_type.startswith("image/"):
        return Response("Only image files are allowed.", status_code=400)

    ext = Path(file.filename or "").suffix.lower()
    if ext not in [".png", ".jpg", ".jpeg", ".webp", ".bmp"]:
        # content_type이 image여도 확장자가 없을 수 있어서 default png로
        ext = ".png"

    filename = f"{uuid.uuid4().hex}{ext}"
    path = UPLOAD_DIR / filename

    data = await file.read()
    path.write_bytes(data)

    return {"url": f"/uploads/{filename}"}


# (선택) 배포 시 frontend 빌드 결과를 백엔드가 서빙하도록 할 때
# frontend/dist 를 backend/static 으로 복사해서 사용해도 되고,
# 여기서는 backend가 ../frontend/dist 를 직접 서빙하는 형태 예시
FRONT_DIST = (BASE_DIR.parent / "frontend" / "dist").resolve()
if FRONT_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONT_DIST), html=True), name="frontend")

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
