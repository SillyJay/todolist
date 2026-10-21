"""平台适配器路由（规格 §7.2）。"""
import threading
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from adapters.chaoxing import ChaoxingAdapter
from adapters.xiaoya import XiaoyaAdapter
from db.database import get_db
from db.models import Setting, Task

router = APIRouter()
chaoxing = ChaoxingAdapter()
xiaoya = XiaoyaAdapter()

# 刷新任务状态（作业抓取要跑浏览器，耗时 1-3 分钟，因此异步 + 轮询进度）
_refresh_state: dict = {
    "running": False,
    "done": 0,
    "total": 0,
    "current": "",
    "created": 0,
    "updated": 0,
    "error": "",
}


class ChaoxingLoginBody(BaseModel):
    username: str
    password: str


class CookieBody(BaseModel):
    cookie: str


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


@router.post("/chaoxing/login")
def chaoxing_login(body: ChaoxingLoginBody, db: Session = Depends(get_db)):
    """账号密码登录。返回错误码供前端区分引导文案（验证码/密码错/网络）。"""
    result = chaoxing.login(body.username, body.password)
    if result.get("ok"):
        row = db.get(Setting, "chaoxing_username")
        if row:
            row.value = body.username
        else:
            db.add(Setting(key="chaoxing_username", value=body.username))
        db.commit()
    return result


@router.post("/chaoxing/import-cookie")
def chaoxing_import_cookie(body: CookieBody):
    """浏览器手动登录后导入 Cookie（验证码场景的兜底入口）。"""
    return chaoxing.import_cookies(body.cookie)


@router.post("/chaoxing/refresh")
def chaoxing_refresh():
    """触发作业刷新（后台线程，前端轮询 /refresh/status）。"""
    if not chaoxing.has_session():
        return {"ok": False, "code": "NOT_LOGGED_IN", "message": "未登录学习通"}
    if _refresh_state["running"]:
        return {"ok": True, "started": False, "message": "刷新进行中"}

    _refresh_state.update(
        running=True, done=0, total=0, current="", created=0, updated=0, error=""
    )
    threading.Thread(target=_do_refresh, daemon=True).start()
    return {"ok": True, "started": True, "message": "已开始刷新"}


@router.get("/chaoxing/refresh/status")
def chaoxing_refresh_status():
    return _refresh_state


def _do_refresh() -> None:
    from db.database import SessionLocal

    def progress(done: int, total: int, name: str) -> None:
        _refresh_state.update(done=done, total=total, current=name)

    db = SessionLocal()
    try:
        assignments = chaoxing.fetch_assignments(progress=progress)
        created = updated = 0
        for a in assignments:
            existing = (
                db.query(Task)
                .filter(Task.platform == "chaoxing", Task.source_msg_id == a.source_msg_id)
                .first()
            )
            if existing:
                changed = False
                if a.ddl and existing.ddl != a.ddl:
                    existing.ddl = a.ddl
                    changed = True
                target_status = {"submitted": "done", "expired": "expired"}.get(a.status, "pending")
                if existing.status != target_status:
                    existing.status = target_status
                    changed = True
                if changed:
                    existing.updated_at = _now()
                    updated += 1
                continue

            db.add(
                Task(
                    platform="chaoxing",
                    course_name=a.course_name,
                    course_abbr=_abbr(a.course_name),
                    title=a.title,
                    ddl=a.ddl,
                    status={"submitted": "done", "expired": "expired"}.get(a.status, "pending"),
                    url=a.url,
                    source_msg_id=a.source_msg_id,
                    created_at=_now(),
                    updated_at=_now(),
                )
            )
            created += 1
        db.commit()
        _refresh_state.update(created=created, updated=updated)
    except Exception as e:  # noqa: BLE001
        _refresh_state.update(error=f"{type(e).__name__}: {e}")
    finally:
        db.close()
        _refresh_state.update(running=False, current="")


def _abbr(course_name: str) -> str:
    """课程简称：去掉年级/班级前缀与书名号，取前 8 个字符。

    例：「2026-2027-1-《马克思主义基本原理》-李文巧」→「马克思主义基本原理」
    """
    import re

    name = course_name or ""
    m = re.search(r"《(.+?)》", name)
    if m:
        return m.group(1)[:12]
    name = re.sub(r"^[0-9\-]+", "", name)
    name = re.sub(r"[-—].*$", "", name)
    return name[:12] or course_name[:12]


@router.get("/status")
def adapters_status():
    """各平台连接状态（规格 §7.2）。"""
    return {
        "chaoxing": {"logged_in": chaoxing.has_session()},
        "xiaoya": {"logged_in": xiaoya.has_session()},
        "wechat": {"state": "not_configured"},  # running / offline / not_configured
    }


@router.post("/xiaoya/import-cookie")
def xiaoya_import_cookie(body: CookieBody):
    """小雅：浏览器登录后导入 Cookie（登录需短信验证，暂不做账密直登）。"""
    return xiaoya.import_cookies(body.cookie)


@router.post("/xiaoya/login")
def xiaoya_login(body: ChaoxingLoginBody):
    return xiaoya.login(body.username, body.password)


@router.post("/wechat/start")
def wechat_start():
    # Phase 2 实现
    return {"ok": False, "code": "NOT_IMPLEMENTED", "message": "微信群监听将在 Phase 2 提供"}


@router.post("/wechat/stop")
def wechat_stop():
    return {"ok": False, "code": "NOT_IMPLEMENTED", "message": "微信群监听将在 Phase 2 提供"}
