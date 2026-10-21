"""平台适配器路由（规格 §7.2）。"""
import threading
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from adapters.chaoxing import ChaoxingAdapter
from adapters.xiaoya import XiaoyaAdapter
from db.database import get_db
from db.models import CourseSchedule, Setting, Task

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


@router.post("/chaoxing/refresh-schedule")
def chaoxing_refresh_schedule(db: Session = Depends(get_db)):
    """同步课表（HTTP 接口，约 1 秒）。覆盖 source='chaoxing' 的旧数据。"""
    if not chaoxing.has_session():
        return {"ok": False, "code": "NOT_LOGGED_IN", "message": "未登录学习通"}
    try:
        data = chaoxing.fetch_schedule_semester()
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "code": "FETCH_FAILED", "message": str(e)}

    lessons = data.get("lessons") or []
    db.query(CourseSchedule).filter(CourseSchedule.source == "chaoxing").delete()
    for m in lessons:
        if not m.get("weekday") or not m.get("start_time"):
            continue
        db.add(
            CourseSchedule(
                course_name=m["name"],
                course_abbr=_abbr(m["name"]),
                weekday=m["weekday"],
                start_time=m["start_time"],
                end_time=m.get("end_time"),
                location=m.get("location"),
                weeks=m.get("weeks"),
                teacher=m.get("teacher"),
                source="chaoxing",
            )
        )
    _put_setting(db, "curriculum_week", str(data.get("current_week") or ""))
    _put_setting(db, "curriculum_max_week", str(data.get("max_week") or ""))
    if data.get("school_year"):
        _put_setting(db, "curriculum_school_year", str(data.get("school_year")))
    if data.get("semester"):
        _put_setting(db, "curriculum_semester", str(data.get("semester")))
    ts = data.get("first_week_date")
    if ts:
        from datetime import datetime as _dt

        _put_setting(
            db,
            "curriculum_first_week_date",
            _dt.fromtimestamp(ts / 1000).date().isoformat(),
        )
    _put_setting(db, "schedule_synced_at", _now())
    db.commit()
    _mark_semester(db)
    return {
        "ok": True,
        "count": len(lessons),
        "current_week": data.get("current_week"),
        "message": f"已同步 {len(lessons)} 个课程时段（第 {data.get('current_week')} 周）",
    }


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
        _mark_semester(db)
        _refresh_state.update(created=created, updated=updated)
    except Exception as e:  # noqa: BLE001
        _refresh_state.update(error=f"{type(e).__name__}: {e}")
    finally:
        db.close()
        _refresh_state.update(running=False, current="")


def _semester_label(db: Session) -> str:
    """当前学期标签，如 2026-2027-1；缺数据时用系统时间推断。"""
    y = db.get(Setting, "curriculum_school_year")
    sem = db.get(Setting, "curriculum_semester")
    if y and y.value:
        try:
            year = int(y.value)
            term = int(sem.value) if sem and sem.value else 1
            return f"{year}-{year + 1}-{term}"
        except ValueError:
            pass
    now = datetime.now()
    year = now.year if now.month >= 9 else now.year - 1
    term = 1 if now.month >= 9 or now.month == 1 else 2
    return f"{year}-{year + 1}-{term}"


def _mark_semester(db: Session) -> int:
    """按课表课程集合标记任务是否属于本学期（比日期推算更准）。"""
    names = {
        r.course_name
        for r in db.query(CourseSchedule).filter(CourseSchedule.source == "chaoxing").all()
        if r.course_name
    }
    if not names:
        return 0
    label = _semester_label(db)
    changed = 0
    for t in db.query(Task).filter(Task.platform == "chaoxing").all():
        val = 1 if (t.course_name or "") in names else 0
        if t.in_semester != val or t.semester != label:
            t.in_semester = val
            t.semester = label
            changed += 1
    db.commit()
    return changed


def _put_setting(db: Session, key: str, value: str) -> None:
    row = db.get(Setting, key)
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value))


def _abbr(course_name: str) -> str:
    """课程简称：去掉年级/班级前缀与书名号，取前 8 个字符。

    例：「2026-2027-1-《马克思主义基本原理》-李文巧」→「马克思主义基本原理」
    """
    import re

    name = course_name or ""
    m = re.search(r"《(.+?)》", name)
    if m:
        return m.group(1)[:8]
    name = re.sub(r"^[0-9\-]+", "", name)
    name = re.sub(r"[-—].*$", "", name)
    return name[:8] or course_name[:8]


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


@router.post("/xiaoya/refresh")
def xiaoya_refresh(db: Session = Depends(get_db)):
    """同步小雅作业任务（HTTP 直连，2-5 秒）。按 task_id 去重。"""
    if not xiaoya.has_session():
        return {"ok": False, "code": "NOT_LOGGED_IN", "message": "未登录小雅"}
    try:
        items = xiaoya.fetch_assignments()
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "code": "FETCH_FAILED", "message": str(e)}

    created = updated = 0
    for a in items:
        existing = (
            db.query(Task)
            .filter(Task.platform == "xiaoya", Task.source_msg_id == a.source_msg_id)
            .first()
        )
        target = {"submitted": "done", "expired": "expired"}.get(a.status, "pending")
        if existing:
            changed = False
            if a.ddl and existing.ddl != a.ddl:
                existing.ddl = a.ddl
                changed = True
            if existing.status != target:
                existing.status = target
                changed = True
            if changed:
                existing.updated_at = _now()
                updated += 1
            continue
        db.add(
            Task(
                platform="xiaoya",
                course_name=a.course_name,
                course_abbr=_abbr(a.course_name),
                title=a.title,
                ddl=a.ddl,
                status=target,
                url=a.url,
                source_msg_id=a.source_msg_id,
                created_at=_now(),
                updated_at=_now(),
            )
        )
        created += 1
    db.commit()
    _mark_semester(db)
    return {"ok": True, "created": created, "updated": updated, "total": len(items)}


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
