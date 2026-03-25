from __future__ import annotations

from typing import Optional
from datetime import datetime, date
from sqlmodel import SQLModel, Field


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    password_hash: str
    role: str = Field(index=True)  # "admin" | "teacher"
    display_name: str
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Member(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

    number: str = Field(index=True, unique=True)  # ✅ 회원 번호(고유)
    name: str
    birth_date: Optional[date] = Field(default=None, index=True)
    memo: Optional[str] = None

    height_cm: Optional[float] = Field(default=None)
    weight_kg: Optional[float] = Field(default=None)

    teacher_id: int = Field(foreign_key="user.id", index=True)

    # PT 관리
    pt_total_count: int = Field(default=0)
    pt_remaining_count: int = Field(default=0)

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ColoredResult(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

    member_id: int = Field(foreign_key="member.id", index=True)

    filename: str  # uploads 기준 상대경로 저장 (예: members/12/colored_xxx.png)
    mime: str = "image/png"
    original_id: Optional[int] = Field(default=None, index=True)

    selected_date: Optional[date] = Field(default=None, index=True)

    note: Optional[str] = Field(default=None)

    created_at: datetime = Field(default_factory=datetime.utcnow)


class Schedule(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)

    title: str = Field(index=True)
    start_at: datetime = Field(index=True)
    end_at: Optional[datetime] = Field(default=None, index=True)

    note: Optional[str] = Field(default=None)

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
