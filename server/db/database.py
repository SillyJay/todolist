"""数据库引擎与会话工厂（规格 §12.4：check_same_thread=False + 会话工厂）。"""
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from config import db_path
from db.models import Base

engine = create_engine(
    f"sqlite:///{db_path()}",
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def init_db() -> None:
    Base.metadata.create_all(engine)
    _migrate()


def _migrate() -> None:
    """轻量迁移：SQLite 老库缺列时补上（只加列，不动数据）。"""
    wanted = {
        "daily_plans": [
            ("quadrant", "TEXT DEFAULT 'q2'"),
            ("done", "INTEGER DEFAULT 0"),
            ("space_id", "TEXT"),
        ],
        "course_schedule": [
            ("teacher", "TEXT"),
            ("source", "TEXT DEFAULT 'chaoxing'"),
            ("section", "INTEGER"),
            ("updated_at", "TEXT"),
            ("space_id", "TEXT"),
        ],
        "tasks": [
            ("in_semester", "INTEGER DEFAULT 1"),
            ("semester", "TEXT"),
            ("space_id", "TEXT"),
            ("deleted_at", "TEXT"),
        ],
        "files": [
            ("origin_key", "TEXT"),
            ("space_id", "TEXT"),
        ],
        "classify_feedback": [
            ("space_id", "TEXT"),
        ],
        "spaces": [
            ("display_name", "TEXT"),
            ("avatar", "TEXT"),
        ],
        "users": [
            ("consent_version", "TEXT"),
            ("consent_at", "TEXT"),
        ],
        "wechat_messages": [
            ("space_id", "TEXT"),
            ("is_read", "INTEGER DEFAULT 0"),
            ("ignored", "INTEGER DEFAULT 0"),
            ("digest", "TEXT"),
            ("digest_src", "TEXT"),
            ("updated_at", "TEXT"),
            ("action", "TEXT"),
            ("importance", "TEXT"),
            ("classify_src", "TEXT"),
        ],
    }
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        for table, columns in wanted.items():
            if table not in existing_tables:
                continue
            have = {c["name"] for c in inspector.get_columns(table)}
            for name, ddl in columns:
                if name not in have:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
