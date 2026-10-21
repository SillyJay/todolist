"""数据库引擎与会话工厂（规格 §12.4：check_same_thread=False + 会话工厂）。"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from config import db_path
from db.models import Base

engine = create_engine(
    f"sqlite:///{db_path()}",
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def init_db() -> None:
    Base.metadata.create_all(engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
