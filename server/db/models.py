"""SQLAlchemy 模型（规格 §6，逐字对应）。"""
from sqlalchemy import (
    Column, Integer, Text, Float, ForeignKey, UniqueConstraint,
)
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class Task(Base):
    """任务表（DDL 统一载体）"""
    __tablename__ = "tasks"
    __table_args__ = (UniqueConstraint("platform", "source_msg_id"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    platform = Column(Text, nullable=False)        # chaoxing / xiaoya / wechat / manual
    course_name = Column(Text)                     # 原始课程名
    course_abbr = Column(Text)                     # 简化课程名
    title = Column(Text, nullable=False)
    ddl = Column(Text)                             # ISO8601，可为空
    status = Column(Text, default="pending")       # pending / done / expired / ignored
    url = Column(Text)
    raw_text = Column(Text)                        # 原文（AI 提取类任务必有）
    ai_result = Column(Text)                       # AI 提取的 JSON
    summary = Column(Text)                         # AI 摘要（L2，缓存）
    confidence = Column(Float)                     # AI 置信度
    source_msg_id = Column(Text)                   # 来源消息去重键
    created_at = Column(Text)
    updated_at = Column(Text)


class CourseSchedule(Base):
    """课表表"""
    __tablename__ = "course_schedule"

    id = Column(Integer, primary_key=True, autoincrement=True)
    course_name = Column(Text)
    course_abbr = Column(Text)
    weekday = Column(Integer)                      # 1-7
    start_time = Column(Text)                      # "08:00"
    end_time = Column(Text)
    location = Column(Text)
    weeks = Column(Text)                           # "1,2,3..." 或 "1-16"
    teacher = Column(Text)
    source = Column(Text, default="chaoxing")      # chaoxing / manual


class File(Base):
    """文件表"""
    __tablename__ = "files"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(Integer, ForeignKey("tasks.id"))
    platform = Column(Text)
    name = Column(Text)
    local_path = Column(Text)                      # 归档后的路径
    origin = Column(Text)                          # attachment / wechat_group / user_drop
    file_hash = Column(Text)                       # 去重
    created_at = Column(Text)


class Setting(Base):
    """设置表（KV）"""
    __tablename__ = "settings"

    key = Column(Text, primary_key=True)
    value = Column(Text)


class SummaryCache(Base):
    """AI 摘要缓存"""
    __tablename__ = "summary_cache"

    text_hash = Column(Text, primary_key=True)
    summary = Column(Text)
    created_at = Column(Text)


class DailyPlan(Base):
    """日计划（规格 §13.6）：用户自定义的分钟级安排。

    quadrant 采用艾森豪威尔矩阵四象限：
      q1 紧急且重要 / q2 重要不紧急 / q3 紧急不重要 / q4 都不紧急
    """
    __tablename__ = "daily_plans"

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(Text, nullable=False)        # YYYY-MM-DD
    start_min = Column(Integer, nullable=False)  # 00:00 起的分钟数
    end_min = Column(Integer, nullable=False)
    title = Column(Text, nullable=False)
    note = Column(Text)
    color = Column(Text, default="blue")
    quadrant = Column(Text, default="q2")      # q1/q2/q3/q4
    done = Column(Integer, default=0)          # 0/1
    created_at = Column(Text)
    updated_at = Column(Text)
