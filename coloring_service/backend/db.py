from __future__ import annotations

import os
from sqlmodel import SQLModel, create_engine, Session

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://coloring:coloring@localhost:5432/coloring_db",
)

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
)

def init_db():
    SQLModel.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session
