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
    kind = Column(Text, index=True)                # exam / homework / notice / task
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
    in_semester = Column(Integer, default=1)        # 是否属于本学期课程
    semester = Column(Text)                        # 如 2026-2027-1
    source_msg_id = Column(Text)                   # 来源消息去重键
    space_id = Column(Text, index=True)
    deleted_at = Column(Text)
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
    section = Column(Integer)                      # 起始节次（1 起），与具体时间解耦
    location = Column(Text)
    weeks = Column(Text)                           # "1,2,3..." 或 "1-16"
    teacher = Column(Text)
    space_id = Column(Text, index=True)
    source = Column(Text, default="chaoxing")      # chaoxing / manual
    updated_at = Column(Text, index=True)


class File(Base):
    """文件表"""
    __tablename__ = "files"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(Integer, ForeignKey("tasks.id"))
    platform = Column(Text)
    name = Column(Text)
    local_path = Column(Text)                      # 归档后的路径
    origin = Column(Text)                          # attachment / wechat_group / user_drop
    origin_key = Column(Text)                      # 平台侧唯一标识：学习通 objectid / 小雅 resource_id
    space_id = Column(Text, index=True)
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
    space_id = Column(Text, index=True)
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

class WeChatMessage(Base):
    """微信群消息留存（用于「消息」页的信息流与分类过滤）。

    只存解析后的纯文本 + 分类结果，不存原始 XML；
    消息量可能很大，所以按 msg_id 去重，并保留 30 天由清理任务处理。
    """
    __tablename__ = "wechat_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    space_id = Column(Text, index=True)
    msg_id = Column(Text, unique=True, index=True)
    group_name = Column(Text)
    sender = Column(Text)
    text = Column(Text)
    sent_at = Column(Text)                 # 消息时间（字符串，来自 wechat-cli）
    category = Column(Text, default="misc", index=True)
    relevance = Column(Integer, default=0)
    reason = Column(Text)                  # 为什么相关（分号分隔）
    needs_action = Column(Integer, default=0)
    is_task = Column(Integer, default=0)   # 是否已被提取成任务
    task_id = Column(Integer)
    digest = Column(Text)                  # AI 归纳后的一句话
    digest_src = Column(Text)              # ai / fallback（fallback 不算简化完成）
    updated_at = Column(Text, index=True)  # 同步用：摘要生成/忽略时更新
    # ---- AI 分类结果（参考 messageAIHelper / whatsapp-router 的做法）----
    action = Column(Text)                  # notify / digest / mute
    importance = Column(Text, index=True)  # high / medium / low
    classify_src = Column(Text)            # rule / ai / manual
    is_read = Column(Integer, default=0)   # 0=未读 1=已读（进「消息」页后置 1）
    ignored = Column(Integer, default=0)   # 0=正常 1=用户手动忽略
    created_at = Column(Text)

class Space(Base):
    """用户空间：一台电脑 + 若干手机共享的数据归属。"""

    __tablename__ = "spaces"

    id = Column(Text, primary_key=True)          # uuid
    name = Column(Text, default="我的空间")
    recovery_hash = Column(Text)                 # 恢复码的 sha256（不存明文）
    display_name = Column(Text)                  # 昵称
    avatar = Column(Text)                        # 头像：data:image/...;base64（<=256KB）
    created_at = Column(Text)


class User(Base):
    """可选账号：绑定后可在换设备时找回 space。"""

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    space_id = Column(Text, index=True)
    email = Column(Text, unique=True, index=True)
    password_hash = Column(Text)
    consent_version = Column(Text)   # 同意的协议版本
    consent_at = Column(Text)        # 同意时间
    created_at = Column(Text)


class Device(Base):
    """已配对设备（手机 / 平板 / 另一台电脑）。"""

    __tablename__ = "devices"

    id = Column(Text, primary_key=True)          # uuid
    space_id = Column(Text, index=True)
    name = Column(Text)
    platform = Column(Text, default="android")
    token_hash = Column(Text, index=True)
    created_at = Column(Text)
    last_seen = Column(Text)
    revoked_at = Column(Text)


class PairingCode(Base):
    """一次性配对码（6 位，5 分钟有效）。"""

    __tablename__ = "pairing_codes"

    code = Column(Text, primary_key=True)
    space_id = Column(Text, index=True)
    expires_at = Column(Text)
    used_at = Column(Text)
    attempts = Column(Integer, default=0)
    created_at = Column(Text)


class Event(Base):
    """日程（有起止时间的一次性事件），区别于任务（只有截止时间）。"""

    __tablename__ = "events"

    id = Column(Text, primary_key=True)          # uuid，客户端生成
    space_id = Column(Text, index=True)
    title = Column(Text)
    date = Column(Text, index=True)              # YYYY-MM-DD
    start = Column(Text)                         # HH:mm
    end = Column(Text)                           # HH:mm
    location = Column(Text)
    note = Column(Text)
    remind_before = Column(Integer, default=15)  # 提前几分钟
    source = Column(Text, default="manual")      # manual / voice / ai
    created_at = Column(Text)
    updated_at = Column(Text, index=True)
    deleted_at = Column(Text)

class SyncOp(Base):
    """已应用的操作 id，保证手机重试不会重复执行。"""

    __tablename__ = "sync_ops"

    op_id = Column(Text, primary_key=True)
    space_id = Column(Text, index=True)
    created_at = Column(Text)


class ClassifyFeedback(Base):
    """用户手动纠正过的分类，作为 AI 的 few-shot 例子。"""

    __tablename__ = "classify_feedback"

    id = Column(Integer, primary_key=True, autoincrement=True)
    space_id = Column(Text, index=True)
    msg_id = Column(Text, index=True)
    text = Column(Text)
    sender = Column(Text)
    group_name = Column(Text)
    old_category = Column(Text)
    new_category = Column(Text)
    created_at = Column(Text)


class InviteCode(Base):
    """邀请码：控制谁能注册（每人一个空间，互不可见）。"""

    __tablename__ = "invite_codes"

    code = Column(Text, primary_key=True)
    note = Column(Text)                     # 备注：发给谁
    expires_at = Column(Text)
    used_at = Column(Text)
    used_by_email = Column(Text)
    created_at = Column(Text)


class EmailCode(Base):
    """邮箱验证码：找回密码用（10 分钟有效，一次性）。"""

    __tablename__ = "email_codes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(Text, index=True)
    code = Column(Text)
    purpose = Column(Text, default="reset")
    expires_at = Column(Text)
    used_at = Column(Text)
    created_at = Column(Text)
