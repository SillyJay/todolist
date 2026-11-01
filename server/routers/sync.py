"""同步接口：手机 ↔ 电脑（方案里的「离线优先 + 双向合并」）。

协议：
  GET  /sync/changes?since=<ISO 时间>&limit=500
       → 返回 since 之后发生变化的行（任务/日程/课表/消息）+ 新游标
  POST /sync/ops
       手机把离线期间攒的操作发上来，按 op_id 幂等；冲突用字段级 LWW

约定：
- 游标就是 ISO 时间字符串；比较字段是 coalesce(updated_at, created_at)
- 删除用 deleted_at（软删除），客户端据此移除
- space_id 为空的历史数据视为「默认空间」，避免老库迁移后看不到
"""

from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import CourseSchedule, Event, Space, SyncOp, Task, WeChatMessage
from services.message_classify import HIDDEN_CATEGORIES, RELEVANT_THRESHOLD
from services.task_display import display_title, task_kind
from routers.pair import current_space

router = APIRouter()

CURSOR_EPOCH = "1970-01-01T00:00:00+00:00"


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _later(a: str | None, b: str | None) -> str | None:
    if not a:
        return b
    if not b:
        return a
    return a if a >= b else b


def _task_row(t: Task) -> dict:
    course = t.course_abbr or t.course_name
    return {
        "id": t.id,
        "title": t.title,
        # A：碎片标题补课程名（大学物理BⅠ · 第六章），原文不动
        "display_title": display_title(t.title, course),
        # C：chapter = 纯章节类，前端可折叠归档
        "kind": task_kind(t.title),
        "ddl": t.ddl,
        "status": t.status,
        "course": course,
        "platform": t.platform,
        "updated_at": t.updated_at or t.created_at,
        "deleted_at": t.deleted_at,
    }


def _event_row(e: Event) -> dict:
    return {
        "id": e.id,
        "title": e.title,
        "date": e.date,
        "start": e.start,
        "end": e.end,
        "location": e.location,
        "note": e.note,
        "remind_before": e.remind_before,
        "updated_at": e.updated_at or e.created_at,
        "deleted_at": e.deleted_at,
    }


def _course_row(c: CourseSchedule) -> dict:
    return {
        "id": c.id,
        "name": c.course_abbr or c.course_name,
        "weekday": c.weekday,
        "start": c.start_time,
        "end": c.end_time,
        "location": c.location,
        "teacher": c.teacher,
        "weeks": c.weeks,
        "updated_at": c.updated_at,
    }


def _msg_row(m: WeChatMessage) -> dict:
    """移动端要两种形态：简化后的 digest（列表）和原文 text（详情里看）。"""
    return {
        "id": m.id,
        "group": m.group_name,
        "sender": m.sender,
        "category": m.category,
        "digest": m.digest or "",
        # 没有 AI 摘要时给个截断，列表不至于空着，但 digest_src 会标成 fallback
        "digest_fallback": (m.text or "")[:60],
        "digest_src": m.digest_src or "",
        "text": m.text or "",
        "reason": m.reason or "",
        "relevance": m.relevance,
        "needs_action": bool(m.needs_action),
        "time": m.sent_at,
        "ignored": bool(m.ignored),
        "importance": m.importance or "",
        "action": m.action or "",
        "updated_at": m.updated_at or m.created_at,
    }


def _account_row(db, space) -> dict:
    from db.models import User

    user = db.query(User).filter(User.space_id == space.id).first()
    return {
        "email": user.email if user else "",
        "display_name": space.display_name or "",
        "avatar": space.avatar or "",
    }


def _semester_start(db) -> str | None:
    """学期第一周的周一（YYYY-MM-DD），用来把日期换算成周次。"""
    from db.models import Setting

    row = db.get(Setting, "curriculum_first_week_date")
    return (row.value or None) if row and row.value else None


@router.get("/changes")
def changes(
    since: str = Query(CURSOR_EPOCH),
    limit: int = Query(500, ge=1, le=2000),
    space: Space = Depends(current_space),
    db: Session = Depends(get_db),
):
    """拉取 since 之后的变化。首次调用（since 为纪元）等于全量快照。"""
    # 游标归一化：非法/空/纪元都当「首次全量」
    # 注意：不能把 1970 的 UTC 时间 astimezone() 成 +08:00 再比字符串，
    # 那会得到 1970-01-01T08:00+08:00，反而不小于纪元，导致没走全量分支。
    raw = (since or "").strip()
    is_full = False
    cursor = CURSOR_EPOCH
    if not raw:
        is_full = True
    else:
        try:
            dt = datetime.fromisoformat(raw)
            if dt.timestamp() <= datetime.fromisoformat(CURSOR_EPOCH).timestamp():
                is_full = True
            else:
                cursor = dt.astimezone().isoformat(timespec="seconds")
        except ValueError:
            is_full = True

    def _changed(q, ts_col, created_col=None):
        """全量时不加时间过滤（老数据没有 updated_at 也能拿到）。"""
        if is_full:
            return q
        ts = func.coalesce(ts_col, created_col) if created_col is not None else ts_col
        return q.filter(ts > cursor)

    # space_id 为空 = 老数据，归入默认空间
    task_q = _changed(db.query(Task), Task.updated_at, Task.created_at).filter(
        (Task.space_id.is_(None)) | (Task.space_id == space.id)
    )
    event_q = _changed(db.query(Event), Event.updated_at, Event.created_at).filter(
        Event.space_id == space.id
    )
    course_q = _changed(db.query(CourseSchedule), CourseSchedule.updated_at).filter(
        CourseSchedule.space_id == space.id
    )
    # 只同步桌面端消息页会显示的那些（闲聊/其他、低相关度、用户忽略的都不下发）
    msg_q = _changed(db.query(WeChatMessage), WeChatMessage.updated_at, WeChatMessage.created_at).filter(
        WeChatMessage.space_id == space.id
    )
    # AI 判过档位的按重要性下发（中/高），没判过的回退到相关度阈值
    msg_q = msg_q.filter(
        WeChatMessage.ignored == 0,
        WeChatMessage.digest_src == "ai",
        WeChatMessage.category.notin_(HIDDEN_CATEGORIES),
    ).filter(
        (WeChatMessage.importance.in_(["high", "medium"]))
        | (WeChatMessage.importance.is_(None) & (WeChatMessage.relevance >= RELEVANT_THRESHOLD))
    )

    tasks = task_q.order_by(Task.updated_at.asc()).limit(limit).all()
    events = event_q.order_by(Event.updated_at.asc()).limit(limit).all()
    courses = course_q.order_by(CourseSchedule.updated_at.asc()).limit(limit).all()
    messages = msg_q.order_by(func.coalesce(WeChatMessage.updated_at, WeChatMessage.created_at).asc()).limit(
        limit
    ).all()

    new_cursor = cursor
    for rows, getter in (
        (tasks, lambda r: r.updated_at or r.created_at),
        (events, lambda r: r.updated_at or r.created_at),
        (courses, lambda r: r.updated_at),
        (messages, lambda r: r.updated_at or r.created_at),
    ):
        for r in rows:
            new_cursor = _later(new_cursor, getter(r)) or new_cursor

    # 历史数据没有 updated_at：用「当前时间」推进游标，避免每次全量重拉
    if not (tasks or events or courses or messages):
        new_cursor = _now()

    return {
        "cursor": new_cursor,
        "server_time": _now(),
        "space_id": space.id,
        "semester_start": _semester_start(db),
        # 账号资料（头像/昵称），桌面和手机共用
        "account": _account_row(db, space),
        # 未处理（手机端只显示"有没有"）
        "pending_messages": db.query(WeChatMessage)
        .filter(
            WeChatMessage.space_id == space.id,
            WeChatMessage.ignored == 0,
            WeChatMessage.digest_src.is_(None),
        )
        .count(),
        "tasks": [_task_row(t) for t in tasks],
        "events": [_event_row(e) for e in events],
        "courses": [_course_row(c) for c in courses],
        "messages": [_msg_row(m) for m in messages],
    }


# ---------------------------------------------------------------- 写回

class Op(BaseModel):
    op_id: str
    entity: str  # task / event / message
    id: str
    action: str  # done / undone / ignore / create / update / delete
    patch: dict = {}


class OpsBody(BaseModel):
    ops: list[Op] = []


@router.post("/ops")
def apply_ops(
    body: OpsBody,
    space: Space = Depends(current_space),
    db: Session = Depends(get_db),
):
    """应用手机的操作。幂等：同一个 op_id 只执行一次。"""
    applied: list[str] = []
    skipped: list[str] = []
    conflicts: list[dict] = []
    created: list[dict] = []
    now = _now()

    for op in body.ops:
        if db.get(SyncOp, op.op_id):
            skipped.append(op.op_id)
            continue

        ok = False
        if op.entity == "task":
            if op.action == "create":
                # 手机端「消息 → 转为任务」：标题取摘要/原文，截止时间由客户端给
                title = (op.patch.get("title") or "").strip()
                if title:
                    row = Task(
                        platform=op.patch.get("platform") or "manual",
                        title=title[:200],
                        ddl=op.patch.get("ddl"),
                        course_name=op.patch.get("course_name"),
                        course_abbr=op.patch.get("course_abbr"),
                        status="pending",
                        raw_text=op.patch.get("raw_text"),
                        space_id=space.id,
                        created_at=now,
                        updated_at=now,
                    )
                    db.add(row)
                    db.flush()  # 拿到自增 id
                    created.append({"op_id": op.op_id, "entity": "task", "id": row.id})
                    ok = True
            else:
                row = db.get(Task, int(op.id)) if op.id.isdigit() else None
                if row and (row.space_id is None or row.space_id == space.id):
                    if op.action in ("done", "undone"):
                        row.status = "done" if op.action == "done" else "pending"
                        row.updated_at = now
                        ok = True
        elif op.entity == "event":
            if op.action == "create":
                row = db.get(Event, op.id)
                if not row:
                    db.add(
                        Event(
                            id=op.id,
                            space_id=space.id,
                            title=op.patch.get("title", ""),
                            date=op.patch.get("date", ""),
                            start=op.patch.get("start", ""),
                            end=op.patch.get("end", ""),
                            location=op.patch.get("location"),
                            note=op.patch.get("note"),
                            remind_before=int(op.patch.get("remind_before") or 15),
                            source=op.patch.get("source", "manual"),
                            created_at=now,
                            updated_at=now,
                        )
                    )
                    ok = True
                else:
                    conflicts.append({"op_id": op.op_id, "reason": "event 已存在"})
            elif op.action == "delete":
                row = db.get(Event, op.id)
                if row and row.space_id == space.id:
                    row.deleted_at = now
                    row.updated_at = now
                    ok = True
        elif op.entity == "message" and op.action == "ignore":
            row = db.get(WeChatMessage, int(op.id)) if op.id.isdigit() else None
            if row:
                row.ignored = 1
                row.updated_at = now
                ok = True

        if ok:
            db.add(SyncOp(op_id=op.op_id, space_id=space.id, created_at=now))
            applied.append(op.op_id)
        elif op.op_id not in skipped:
            conflicts.append({"op_id": op.op_id, "reason": "目标不存在或无权修改"})

    db.commit()
    return {
        "ok": True,
        "applied": applied,
        "skipped": skipped,
        "conflicts": conflicts,
        "created": created,
        "cursor": now,
    }


@router.get("/events")
def list_events(
    space: Space = Depends(current_space),
    db: Session = Depends(get_db),
    since_date: str | None = None,
):
    """日程列表（手机端日历直接读这个更简单）。"""
    q = db.query(Event).filter(Event.space_id == space.id, Event.deleted_at.is_(None))
    if since_date:
        try:
            start = datetime.fromisoformat(since_date).date()
            q = q.filter(Event.date >= start.isoformat())
        except ValueError:
            pass
    rows = q.order_by(Event.date.asc(), Event.start.asc()).limit(200).all()
    return {"items": [_event_row(e) for e in rows]}


@router.get("/health")
def sync_health(space: Space = Depends(current_space), db: Session = Depends(get_db)):
    """给手机端做连通性自检用。"""
    counts = {
        "tasks": db.query(Task).filter(
            (Task.space_id.is_(None)) | (Task.space_id == space.id)
        ).count(),
        "events": db.query(Event).filter(Event.space_id == space.id).count(),
        "courses": db.query(CourseSchedule).filter(CourseSchedule.space_id == space.id).count(),
        "messages": db.query(WeChatMessage).filter(WeChatMessage.space_id == space.id)
        .filter(
            WeChatMessage.ignored == 0,
            WeChatMessage.category.notin_(HIDDEN_CATEGORIES),
            WeChatMessage.relevance >= RELEVANT_THRESHOLD,
        )
        .count(),
    }
    return {"ok": True, "space_id": space.id, "counts": counts, "server_time": _now()}


# 兼容：三天内的日程（手机首屏常用）
@router.get("/upcoming")
def upcoming(space: Space = Depends(current_space), db: Session = Depends(get_db)):
    today = datetime.now().date()
    end = today + timedelta(days=7)
    rows = (
        db.query(Event)
        .filter(
            Event.space_id == space.id,
            Event.deleted_at.is_(None),
            Event.date >= today.isoformat(),
            Event.date <= end.isoformat(),
        )
        .order_by(Event.date.asc(), Event.start.asc())
        .all()
    )
    return {"items": [_event_row(e) for e in rows]}


# ---------------------------------------------------------------- 云端同步

class CloudConfig(BaseModel):
    enabled: bool | None = None
    url: str | None = None


@router.get("/cloud/status")
def cloud_status(space: Space = Depends(current_space), db: Session = Depends(get_db)):
    from services import cloud_sync
    from services.secrets import get_secret
    from db.models import Setting

    ok, url, why = cloud_sync.configured(db)
    return {
        "ok": True,
        "enabled": (db.get(Setting, "cloud_enabled").value if db.get(Setting, "cloud_enabled") else "0") == "1",
        "url": url or (db.get(Setting, "cloud_url").value if db.get(Setting, "cloud_url") else ""),
        "ready": ok,
        "message": why,
        "has_token": bool((get_secret("cloud_token") or "").strip()),
        "push_cursor": (db.get(Setting, "cloud_cursor_push").value if db.get(Setting, "cloud_cursor_push") else ""),
        "pull_cursor": (db.get(Setting, "cloud_cursor_pull").value if db.get(Setting, "cloud_cursor_pull") else ""),
    }


@router.post("/cloud/config")
def cloud_config(
    body: CloudConfig, space: Space = Depends(current_space), db: Session = Depends(get_db)
):
    from db.models import Setting

    def put(key: str, value: str) -> None:
        row = db.get(Setting, key)
        if row:
            row.value = value
        else:
            db.add(Setting(key=key, value=value))

    if body.enabled is not None:
        put("cloud_enabled", "1" if body.enabled else "0")
    if body.url is not None:
        put("cloud_url", body.url.strip())
    db.commit()
    return {"ok": True}


@router.post("/cloud/now")
def cloud_now(space: Space = Depends(current_space), db: Session = Depends(get_db)):
    from services import cloud_sync

    return cloud_sync.sync_once(db)


class EventPatch(BaseModel):
    title: str | None = None
    date: str | None = None
    start: str | None = None
    end: str | None = None
    location: str | None = None
    note: str | None = None
    remind_before: int | None = None


@router.patch("/events/{event_id}")
def update_event(
    event_id: str,
    body: EventPatch,
    space: Space = Depends(current_space),
    db: Session = Depends(get_db),
):
    """手机端编辑日程：只改传入的字段。"""
    row = db.get(Event, event_id)
    if not row or row.space_id != space.id:
        return {"ok": False, "message": "日程不存在"}

    for key, value in body.model_dump(exclude_none=True).items():
        setattr(row, key, value)
    row.updated_at = _now()
    db.commit()
    return {"ok": True, "event": _event_row(row)}


@router.delete("/events/{event_id}")
def delete_event(
    event_id: str,
    space: Space = Depends(current_space),
    db: Session = Depends(get_db),
):
    row = db.get(Event, event_id)
    if not row or row.space_id != space.id:
        return {"ok": False, "message": "日程不存在"}
    row.deleted_at = _now()
    row.updated_at = _now()
    db.commit()
    return {"ok": True}
