"""平台适配器路由（规格 §7.2）。当前为契约 mock。"""
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class ChaoxingLoginBody(BaseModel):
    username: str
    password: str


@router.post("/chaoxing/login")
def chaoxing_login(body: ChaoxingLoginBody):
    """返回成功/需验证码（规格模块 2：登录失败返回明确错误码）。"""
    # TODO Phase 1: 接 adapters/chaoxing.py
    return {"ok": False, "code": "NOT_IMPLEMENTED", "mock": True}


@router.post("/chaoxing/refresh")
def chaoxing_refresh():
    """立即刷新作业+课表。"""
    # TODO Phase 1
    return {"ok": True, "mock": True}


@router.get("/status")
def adapters_status():
    """各平台连接状态。"""
    # TODO: 接真实状态
    return {
        "chaoxing": {"logged_in": False},
        "xiaoya": {"logged_in": False},
        "wechat": {"state": "not_configured"},  # running / offline / not_configured
        "mock": True,
    }


@router.post("/wechat/start")
def wechat_start():
    # TODO Phase 2
    return {"ok": False, "code": "NOT_IMPLEMENTED", "mock": True}


@router.post("/wechat/stop")
def wechat_stop():
    # TODO Phase 2
    return {"ok": False, "code": "NOT_IMPLEMENTED", "mock": True}
