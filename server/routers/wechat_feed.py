"""群消息信息流（消息页的数据源）。

能力：
- 列表：分类 / 相关度 / 群 / 关键词筛选，默认排除「闲聊灌水」与已忽略
- 概览：各分类条数 + 未读数
- 已读：进入消息页后把当前可见的标记为已读
- 忽略：单条消息不再出现在列表（可撤销）
- 转任务：规则漏判时手动兜底
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Space, Task, WeChatMessage
from routers.pair import current_space
from services.message_classify import (
    CATEGORY_LABEL,
    CATEGORY_ORDER,
    analyze,
    load_profile,
)

router = APIRouter()

RELEVANT_THRESHOLD = 45  # 与 services.message_classify 保持一致
# 不展示的分类：闲聊灌水 + 其他（用户只关心比赛/作业/讲座/通知/招募）
HIDDEN_CATEGORIES = ("chitchat", "misc", "file")
VISIBLE_ORDER = [c for c in CATEGORY_ORDER if c not in HIDDEN_CATEGORIES]


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _serialize(m: WeChatMessage) -> dict:
    return {
        "id": m.id,
        "group": m.group_name,
        "sender": m.sender,
        "text": m.text,
        "digest": m.digest or "",
        "digest_src": m.digest_src or "",
        "digest_ready": bool(m.digest) and (m.digest_src == "ai"),
        "time": m.sent_at,
        "category": m.category,
        "category_label": CATEGORY_LABEL.get(m.category or "misc", "其他"),
        "relevance": m.relevance or 0,
        "reason": m.reason or "",
        "needs_action": bool(m.needs_action),
        "is_task": bool(m.is_task),
        "task_id": m.task_id,
        "is_read": bool(m.is_read),
        "ignored": bool(m.ignored),
        "action": m.action or "",
        "importance": m.importance or "",
        "classify_src": m.classify_src or "",
    }


@router.get("/feed")
def feed(
    category: str | None = None,
    group: str | None = None,
    min_relevance: int = 0,
    only_relevant: bool = False,
    only_unread: bool = False,
    include_ignored: bool = False,
    min_importance: str | None = None,
    include_low: bool = False,
    include_pending: bool = False,
    status: str = "ready",
    include_chitchat: bool = False,
    q: str | None = None,
    limit: int = 200,
    space: Space = Depends(current_space),
    db: Session = Depends(get_db),
):
    query = db.query(WeChatMessage).filter(WeChatMessage.space_id == space.id)

    # status=pending 时只给「还没化简」的原文（未处理视图）
    if status == "pending":
        query = query.filter(WeChatMessage.digest_src.is_(None))
    elif not include_pending:
        query = query.filter(WeChatMessage.digest_src == "ai")

    if not include_ignored:
        query = query.filter(WeChatMessage.ignored == 0)
    if not include_chitchat:
        query = query.filter(WeChatMessage.category.notin_(HIDDEN_CATEGORIES))
    if category and category not in ("all", ""):
        query = query.filter(WeChatMessage.category == category)
    if group:
        query = query.filter(WeChatMessage.group_name == group)
    if only_relevant:
        query = query.filter(WeChatMessage.relevance >= RELEVANT_THRESHOLD)
    elif min_relevance:
        query = query.filter(WeChatMessage.relevance >= min_relevance)
    # 默认只给「中/高」重要性（参考 messageAIHelper：默认隐藏低重要性）
    if status == "pending":
        pass
    elif min_importance in ("high", "medium", "low"):
        allow = ["high", "medium", "low"] if min_importance == "low" else (
            ["high", "medium"] if min_importance == "medium" else ["high"]
        )
        query = query.filter(
            (WeChatMessage.importance.in_(allow)) | (WeChatMessage.importance.is_(None))
        )
    elif not include_low:
        query = query.filter(
            (WeChatMessage.importance.in_(["high", "medium"]))
            | (WeChatMessage.importance.is_(None))
        )

    if only_unread:
        query = query.filter(WeChatMessage.is_read == 0)
    if q:
        query = query.filter(WeChatMessage.text.contains(q))

    rows = query.order_by(WeChatMessage.id.desc()).limit(max(1, min(limit, 500))).all()
    return {
        "items": [_serialize(m) for m in rows],
        "threshold": RELEVANT_THRESHOLD,
        "profile": load_profile(db),
    }


@router.get("/feed/summary")
def summary(space: Space = Depends(current_space), db: Session = Depends(get_db)):
    base = db.query(WeChatMessage).filter(
        WeChatMessage.space_id == space.id,
        WeChatMessage.ignored == 0,
        WeChatMessage.digest_src == "ai",
    )
    visible = base.filter(WeChatMessage.category.notin_(HIDDEN_CATEGORIES)).all()
    counts: dict[str, int] = {k: 0 for k in VISIBLE_ORDER}
    for m in visible:
        key = m.category or "misc"
        if key in HIDDEN_CATEGORIES:
            continue
        counts[key] = counts.get(key, 0) + 1
    return {
        "total": len(visible),
        "relevant": sum(1 for m in visible if (m.relevance or 0) >= RELEVANT_THRESHOLD),
        "needs_action": sum(1 for m in visible if m.needs_action),
        "unread": sum(1 for m in visible if not m.is_read),
        # 注意：ignored 要用独立查询，不能在上面的 base（已过滤 ignored==0）上再筛
        "ignored": db.query(WeChatMessage).filter(WeChatMessage.ignored == 1).count(),
        # 未处理：入库了但还没化简（skip 的不算）
        "pending": db.query(WeChatMessage)
        .filter(WeChatMessage.ignored == 0, WeChatMessage.digest_src.is_(None))
        .count(),
        "counts": counts,
        "labels": CATEGORY_LABEL,
        "order": VISIBLE_ORDER,
        "profile": load_profile(db),
    }


@router.get("/feed/unread")
def unread(db: Session = Depends(get_db)):
    """侧栏红点用：未读数 + 与我相关的未读数。"""
    q = db.query(WeChatMessage).filter(
        WeChatMessage.ignored == 0,
        WeChatMessage.category.notin_(HIDDEN_CATEGORIES),
        WeChatMessage.is_read == 0,
    )
    total = q.count()
    hot = q.filter(WeChatMessage.relevance >= RELEVANT_THRESHOLD).count()
    return {"total": total, "relevant": hot}


class DigestReq(BaseModel):
    ids: list[int] = []


@router.post("/feed/digest")
def feed_digest(req: DigestReq, db: Session = Depends(get_db)):
    """把缺摘要的消息排进后台队列（单线程、限速、自动退避重试）。

    不在请求里同步调 AI：一页几十条会撞免费额度的频率限制。
    这里只入队，前端轮询 /feed 看结果即可。
    """
    from services import digest_worker

    queued = 0
    if req.ids:
        rows = (
            db.query(WeChatMessage)
            .filter(WeChatMessage.id.in_(req.ids[:50]))
            # digest_src 为 NULL（老数据/降级结果）也要重新排队；
            # 直接用 != 'ai' 时 SQL 里 NULL 比较是 unknown，会被过滤掉。
            .filter(func.coalesce(WeChatMessage.digest_src, "") != "ai")
            .all()
        )
        queued = digest_worker.enqueue([m.id for m in rows])
    return {"queued": queued, "pending": digest_worker.pending()}


@router.get("/feed/groups")
def groups(db: Session = Depends(get_db)):
    """按群筛选用的下拉数据。"""
    rows = (
        db.query(WeChatMessage.group_name, func.count(WeChatMessage.id))
        .filter(
            WeChatMessage.ignored == 0,
            WeChatMessage.category.notin_(HIDDEN_CATEGORIES),
        )
        .group_by(WeChatMessage.group_name)
        .order_by(func.count(WeChatMessage.id).desc())
        .all()
    )
    return {"items": [{"name": name or "未知群", "count": n} for name, n in rows]}


@router.post("/feed/read-all")
def read_all(
    ids: list[int] | None = None,
    db: Session = Depends(get_db),
):
    """标记已读：传 ids 只标这些，不传则标记全部可见未读。"""
    q = db.query(WeChatMessage).filter(WeChatMessage.is_read == 0)
    if ids:
        q = q.filter(WeChatMessage.id.in_(ids))
    updated = q.update({WeChatMessage.is_read: 1}, synchronize_session=False)
    db.commit()
    return {"ok": True, "updated": updated}


@router.post("/feed/{mid}/ignore")
def ignore(mid: int, ignored: bool = True, db: Session = Depends(get_db)):
    m = db.get(WeChatMessage, mid)
    if not m:
        raise HTTPException(404, "消息不存在")
    m.ignored = 1 if ignored else 0
    db.commit()
    return {"ok": True, "id": mid, "ignored": bool(m.ignored)}


@router.post("/feed/{mid}/to-task")
def to_task(mid: int, db: Session = Depends(get_db)):
    """把一条群消息转成任务（AI 提取 + 去重）。"""
    m = db.get(WeChatMessage, mid)
    if not m:
        raise HTTPException(404, "消息不存在")

    if m.task_id:
        task = db.get(Task, m.task_id)
        if task:
            return {"ok": True, "task_id": task.id, "created": False}

    from ai.extract import extract

    draft = extract(m.text or "", source="wechat")
    if not draft.get("is_task"):
        raise HTTPException(400, "AI 判断这条不是任务，可手动新建")

    exists = (
        db.query(Task)
        .filter(Task.platform == "wechat", Task.source_msg_id == m.msg_id)
        .first()
    )
    if exists:
        m.is_task = 1
        m.task_id = exists.id
        db.commit()
        return {"ok": True, "task_id": exists.id, "created": False}

    now = _now()
    task = Task(
        platform="wechat",
        title=(draft.get("title") or (m.text or "")[:20]).strip(),
        course_name=draft.get("course_name"),
        ddl=draft.get("ddl"),
        summary=draft.get("summary"),
        confidence=draft.get("confidence") or 0.5,
        raw_text=m.text,
        source_msg_id=m.msg_id,
        status="pending",
        created_at=now,
        updated_at=now,
    )
    db.add(task)
    db.flush()
    m.is_task = 1
    m.task_id = task.id
    db.commit()
    return {"ok": True, "task_id": task.id, "created": True}


@router.post("/feed/reanalyze")
def reanalyze(db: Session = Depends(get_db)):
    """用户改了姓名/班级/组织后，重算历史消息的相关度。"""
    profile = load_profile(db)
    rows = db.query(WeChatMessage).order_by(WeChatMessage.id.desc()).limit(3000).all()
    for m in rows:
        res = analyze(m.text or "", m.group_name or "", profile, m.sender or "")
        m.category = res["category"]
        m.relevance = res["relevance"]
        m.reason = "；".join(res["reasons"])
        m.needs_action = 1 if res["needs_action"] else 0
    db.commit()
    return {"ok": True, "updated": len(rows), "profile": profile}

class ReclassifyBody(BaseModel):
    category: str


@router.post("/feed/{mid}/reclassify")
def reclassify(mid: int, body: ReclassifyBody, db: Session = Depends(get_db)):
    """用户说「这条分错了」：改分类并记下来当 few-shot。"""
    from services.ai_classify import CATEGORIES, CATEGORY_LABEL, rule_importance

    if body.category not in CATEGORIES:
        return {"ok": False, "message": "未知分类"}

    m = db.get(WeChatMessage, mid)
    if not m:
        return {"ok": False, "message": "消息不存在"}

    old = m.category or "misc"
    m.category = body.category
    action, importance = rule_importance(m.text or "", body.category, bool(m.needs_action))
    m.action = "digest" if body.category not in ("chitchat", "misc", "file") else "mute"
    m.importance = importance if action != "mute" else "low"
    m.classify_src = "manual"
    m.updated_at = _now()

    db.add(
        ClassifyFeedback(
            msg_id=str(mid),
            text=(m.text or "")[:500],
            sender=m.sender or "",
            group_name=m.group_name or "",
            old_category=old,
            new_category=body.category,
            created_at=_now(),
        )
    )
    db.commit()
    return {
        "ok": True,
        "category": m.category,
        "label": CATEGORY_LABEL.get(m.category, m.category),
        "old": old,
    }


@router.post("/feed/ai-classify")
def ai_classify(limit: int = 60, force: bool = False, db: Session = Depends(get_db)):
    """后台批量让 AI 判分类与重要性。"""
    from services.ai_classify import classify_pending

    return classify_pending(db, limit=limit, force=force)


@router.get("/feed/classify-stats")
def classify_stats(db: Session = Depends(get_db)):
    """分类来源与重要性分布，给设置页看。"""
    from sqlalchemy import func

    src = dict(
        db.query(WeChatMessage.classify_src, func.count())
        .group_by(WeChatMessage.classify_src)
        .all()
    )
    imp = dict(
        db.query(WeChatMessage.importance, func.count())
        .group_by(WeChatMessage.importance)
        .all()
    )
    return {"classify_src": src, "importance": imp}

@router.post("/feed/digest-backfill")
def digest_backfill(limit: int = 200, db: Session = Depends(get_db)):
    """把还没化简的消息排进摘要队列（后台慢慢跑，完成后 App 才会显示）。"""
    from services.digest_worker import enqueue

    from services.message_classify import HIDDEN_CATEGORIES

    rows = (
        db.query(WeChatMessage.id)
        .filter((WeChatMessage.digest.is_(None)) | (WeChatMessage.digest_src != "ai"))
        # 闲聊/文件/其他永远不会显示，不必化简
        .filter(~WeChatMessage.category.in_(HIDDEN_CATEGORIES))
        .filter((WeChatMessage.importance.in_(["high", "medium"])) | (WeChatMessage.importance.is_(None)))
        .order_by(WeChatMessage.id.desc())
        .limit(max(1, min(limit, 500)))
        .all()
    )
    ids = [r[0] for r in rows]
    if ids:
        enqueue(ids)
    pending = (
        db.query(WeChatMessage)
        .filter((WeChatMessage.digest.is_(None)) | (WeChatMessage.digest_src != "ai"))
        .filter(~WeChatMessage.category.in_(HIDDEN_CATEGORIES))
        .filter((WeChatMessage.importance.in_(["high", "medium"])) | (WeChatMessage.importance.is_(None)))
        .count()
    )
    return {"ok": True, "queued": len(ids), "pending": pending}

@router.post("/feed/{mid}/digest")
def digest_one(mid: int, db: Session = Depends(get_db)):
    """未处理视图里的「立即化简」。"""
    from services import digest_worker

    m = db.get(WeChatMessage, mid)
    if not m:
        return {"ok": False, "message": "消息不存在"}
    queued = digest_worker.enqueue([m.id])
    return {"ok": True, "queued": queued, "pending": digest_worker.pending()}


@router.post("/feed/digest-all-pending")
def digest_all_pending(db: Session = Depends(get_db)):
    """刷新按钮用：把所有未处理的一次性排队。"""
    from services import digest_worker

    ids = [
        r[0]
        for r in db.query(WeChatMessage.id)
        .filter(WeChatMessage.ignored == 0, WeChatMessage.digest_src.is_(None))
        .order_by(WeChatMessage.id.desc())
        .limit(200)
        .all()
    ]
    queued = digest_worker.enqueue(ids) if ids else 0
    return {"ok": True, "queued": queued, "pending": digest_worker.pending()}
