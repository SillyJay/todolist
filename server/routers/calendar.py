"""日历路由（规格 §7.4）。"""
import os

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Setting, Task
from services.ics import export_ics

router = APIRouter()


@router.post("/calendar/export")
def export_calendar(db: Session = Depends(get_db)):
    """生成 ics → 返回文件路径。

    导出目录优先级：工作区 exports/（若已配置且存在）→ 程序数据目录 exports/
    """
    tasks = db.query(Task).all()

    out_dir = None
    ws = db.get(Setting, "workspace_dir")
    if ws and ws.value:
        candidate = os.path.join(ws.value, "exports")
        try:
            os.makedirs(candidate, exist_ok=True)
            out_dir = candidate
        except OSError:
            out_dir = None  # 工作区失效时回落到默认目录，不扫描全盘（规格 §9）

    path = export_ics(tasks, out_dir)
    return {"path": path, "count": len([t for t in tasks if t.ddl])}


@router.get("/feed.ics")
def feed_ics(token: str | None = None):
    """（进阶可选）本地订阅链接。Phase 3+ 实现。"""
    return {"mock": True}
