"""平台适配器路由（规格 §7.2）。"""
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from adapters.chaoxing import ChaoxingAdapter
from db.database import get_db
from db.models import Setting, Task

router = APIRouter()
chaoxing = ChaoxingAdapter()


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
def chaoxing_refresh(db: Session = Depends(get_db)):
    """立即刷新作业列表并入库（按平台内作业 id 去重）。"""
    if not chaoxing.has_session():
        return {"ok": False, "code": "NOT_LOGGED_IN", "message": "未登录学习通"}

    try:
        assignments = chaoxing.fetch_assignments()
    except Exception as e:  # noqa: BLE001 - 任何抓取异常都反馈给前端
        return {"ok": False, "code": "FETCH_FAILED", "message": str(e)}

    created, updated = 0, 0
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
            if a.status and existing.status != a.status:
                existing.status = a.status
                changed = True
            if changed:
                existing.updated_at = _now()
                updated += 1
            continue

        db.add(
            Task(
                platform="chaoxing",
                course_name=a.course_name,
                course_abbr=a.course_name,  # Phase 3 接课表简化后统一
                title=a.title,
                ddl=a.ddl,
                status="done" if a.status == "submitted" else "pending",
                url=a.url,
                source_msg_id=a.source_msg_id,
                created_at=_now(),
                updated_at=_now(),
            )
        )
        created += 1

    db.commit()
    return {"ok": True, "created": created, "updated": updated, "total": len(assignments)}


@router.get("/status")
def adapters_status():
    """各平台连接状态（规格 §7.2）。"""
    return {
        "chaoxing": {"logged_in": chaoxing.has_session()},
        "xiaoya": {"logged_in": False},
        "wechat": {"state": "not_configured"},  # running / offline / not_configured
    }


@router.post("/wechat/start")
def wechat_start():
    # Phase 2 实现
    return {"ok": False, "code": "NOT_IMPLEMENTED", "message": "微信群监听将在 Phase 2 提供"}


@router.post("/wechat/stop")
def wechat_stop():
    return {"ok": False, "code": "NOT_IMPLEMENTED", "message": "微信群监听将在 Phase 2 提供"}
