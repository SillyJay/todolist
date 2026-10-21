"""任务路由（规格 §7.1）。

排序：默认按 ddl 升序，ddl 为空的排最后。
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Task

router = APIRouter()


class TaskCreate(BaseModel):
    title: str
    ddl: str | None = None
    course_name: str | None = None
    course_abbr: str | None = None
    platform: str = "manual"
    url: str | None = None
    raw_text: str | None = None


class TaskPatch(BaseModel):
    status: str | None = None
    title: str | None = None
    ddl: str | None = None
    course_abbr: str | None = None
    course_name: str | None = None
    summary: str | None = None


class ImportTextBody(BaseModel):
    text: str


class ConfirmBody(BaseModel):
    title: str
    course_name: str | None = None
    ddl: str | None = None
    summary: str | None = None
    raw_text: str | None = None
    confidence: float | None = None


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _serialize(t: Task) -> dict:
    return {
        "id": t.id,
        "platform": t.platform,
        "course_name": t.course_name,
        "course_abbr": t.course_abbr,
        "title": t.title,
        "ddl": t.ddl,
        "status": t.status,
        "url": t.url,
        "raw_text": t.raw_text,
        "ai_result": t.ai_result,
        "summary": t.summary,
        "confidence": t.confidence,
        "in_semester": t.in_semester,
        "semester": t.semester,
        "created_at": t.created_at,
        "updated_at": t.updated_at,
    }


@router.get("")
def list_tasks(
    status: str | None = None,
    platform: str | None = None,
    from_: str | None = None,
    to: str | None = None,
    semester: str | None = None,  # current=仅本学期 / all=全部

    db: Session = Depends(get_db),
):
    """任务列表。from/to 为 ISO 日期，按 ddl 过滤。"""
    q = db.query(Task)
    if status:
        q = q.filter(Task.status == status)
    if platform:
        q = q.filter(Task.platform == platform)
    if from_:
        q = q.filter(Task.ddl >= from_)
    if to:
        q = q.filter(Task.ddl <= to)
    if semester == "current":
        q = q.filter(Task.in_semester == 1)

    items = q.all()
    # ddl 升序、空 ddl 排最后
    items.sort(key=lambda t: (t.ddl is None, t.ddl or "", t.id))
    return {"items": [_serialize(t) for t in items], "total": len(items)}


@router.post("")
def create_task(body: TaskCreate, db: Session = Depends(get_db)):
    """手动创建任务。"""
    t = Task(
        platform=body.platform,
        course_name=body.course_name,
        course_abbr=body.course_abbr,
        title=body.title,
        ddl=body.ddl,
        status="pending",
        url=body.url,
        raw_text=body.raw_text,
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return _serialize(t)


@router.patch("/{task_id}")
def update_task(task_id: int, body: TaskPatch, db: Session = Depends(get_db)):
    """更新（标记完成/修改/忽略）。"""
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(404, "task not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(t, k, v)
    t.updated_at = _now()
    db.commit()
    db.refresh(t)
    return _serialize(t)


@router.delete("/{task_id}")
def delete_task(task_id: int, db: Session = Depends(get_db)):
    """删除任务（仅删除数据库记录，不涉及用户文件，符合「工作区只增不删」红线）。"""
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(404, "task not found")
    db.delete(t)
    db.commit()
    return {"ok": True}


@router.post("/import-text")
def import_text(body: ImportTextBody):
    """手动导入：调 AI 提取 → 返回草稿（不入库，等用户确认）。"""
    from ai.extract import extract

    draft = extract(body.text)
    return {"draft": draft, "raw_len": len(body.text)}


@router.post("/confirm")
def confirm_task(body: ConfirmBody, db: Session = Depends(get_db)):
    """确认草稿入库。"""
    if not body.title.strip():
        raise HTTPException(400, "标题不能为空")
    t = Task(
        platform="manual",
        course_name=body.course_name,
        course_abbr=body.course_name[:8] if body.course_name else None,
        title=body.title.strip(),
        ddl=body.ddl,
        status="pending",
        summary=body.summary,
        raw_text=body.raw_text,
        confidence=body.confidence,
        in_semester=1,
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return _serialize(t)


@router.get("/pending-confirm")
def pending_confirm():
    """待确认的 AI 提取结果列表。Phase 2 实现。"""
    return {"items": []}
