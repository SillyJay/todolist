"""任务路由（规格 §7.1）。当前为契约 mock，Phase 1 接真实逻辑。"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db

router = APIRouter()


class TaskCreate(BaseModel):
    title: str
    ddl: str | None = None
    course_name: str | None = None
    url: str | None = None


class TaskPatch(BaseModel):
    status: str | None = None
    title: str | None = None
    ddl: str | None = None


class ImportTextBody(BaseModel):
    text: str


@router.get("")
def list_tasks(status: str | None = None, platform: str | None = None,
               from_: str | None = None, to: str | None = None,
               db: Session = Depends(get_db)):
    """任务列表（筛选/排序：默认按 ddl 升序，空 ddl 排最后）。"""
    # TODO Phase 1: 真实查询；当前返回 mock
    return {"items": [], "total": 0}


@router.post("")
def create_task(body: TaskCreate, db: Session = Depends(get_db)):
    """手动创建任务。"""
    # TODO Phase 1
    return {"id": 0, "mock": True, **body.model_dump()}


@router.patch("/{task_id}")
def update_task(task_id: int, body: TaskPatch, db: Session = Depends(get_db)):
    """更新（标记完成/修改/忽略）。"""
    # TODO Phase 1
    return {"id": task_id, "mock": True, **body.model_dump(exclude_none=True)}


@router.post("/import-text")
def import_text(body: ImportTextBody):
    """手动导入：调 AI 提取 → 返回草稿（不入库）。"""
    # TODO Phase 2: 接 ai/llm.py L1 提取
    return {"draft": None, "mock": True, "echo_len": len(body.text)}


@router.post("/confirm")
def confirm_task():
    """确认草稿入库（含用户修改后的字段）。"""
    # TODO Phase 2
    return {"ok": True, "mock": True}


@router.get("/pending-confirm")
def pending_confirm():
    """待确认的 AI 提取结果列表。"""
    # TODO Phase 2
    return {"items": []}
