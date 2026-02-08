from __future__ import annotations

from datetime import datetime, date
from typing import Optional
from sqlmodel import SQLModel, Field


class Member(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

    number: str = Field(index=True, unique=True)  # ✅ 회원 번호(고유)
    name: str
    memo: Optional[str] = None

    height_cm: Optional[float] = Field(default=None)
    weight_kg: Optional[float] = Field(default=None)

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ColoredResult(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

    member_id: int = Field(foreign_key="member.id", index=True)

    filename: str  # uploads 기준 상대경로 저장 (예: members/12/colored_xxx.png)
    mime: str = "image/png"
    original_id: Optional[int] = Field(default=None, index=True)

    selected_date: Optional[date] = Field(default=None, index=True)

    created_at: datetime = Field(default_factory=datetime.utcnow)
