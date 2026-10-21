"""日历路由（规格 §7.4）。当前为契约 mock。"""
from fastapi import APIRouter

router = APIRouter()


@router.post("/calendar/export")
def export_calendar():
    """生成 ics → 返回文件路径。"""
    # TODO Phase 1: 接 services/ics.py
    return {"path": None, "mock": True}


@router.get("/feed.ics")
def feed_ics(token: str | None = None):
    """（进阶可选）本地订阅链接。"""
    # TODO Phase 3+
    return {"mock": True}
