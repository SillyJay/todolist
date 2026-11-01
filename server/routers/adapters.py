"""平台适配器路由（规格 §7.2）。"""
import threading
import json
import os
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from adapters.chaoxing import ChaoxingAdapter
from adapters.xiaoya import XiaoyaAdapter
from adapters.wechat_listener import WeChatListener, cli_status, message_to_task
from db.database import get_db
from services.space import get_or_create_space
from db.models import CourseSchedule, Setting, Task

router = APIRouter()
chaoxing = ChaoxingAdapter()
xiaoya = XiaoyaAdapter()
wechat = WeChatListener()

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


class WeChatConfig(BaseModel):
    groups: list[str] = []


class WeChatInstall(BaseModel):
    source: str
    sha256: str | None = None


class WeChatDerive(BaseModel):
    """微信 4.1+ 的 passphrase（wx_key 提取的一串 hex），只用于派生，不保存。"""

    passphrase: str
    db_dir: str | None = None


class WeChatSimulate(BaseModel):
    text: str
    group: str = "测试群"
    sender: str = "测试老师"
    msg_id: str | None = None


def _put_setting(db, key: str, value: str) -> None:
    row = db.get(Setting, key)
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value))
    db.commit()


def _cookie_account(cookies: dict) -> str:
    """从 Cookie 里猜一个可展示的账号标识（不保证是用户名）。"""
    for k in ("username", "userName", "name", "uid", "_uid", "userId", "userid", "account"):
        v = cookies.get(k)
        if v:
            return str(v)
    return ""


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
def chaoxing_import_cookie(body: CookieBody, db: Session = Depends(get_db)):
    """浏览器手动登录后导入 Cookie（验证码场景的兜底入口）。"""
    result = chaoxing.import_cookies(body.cookie)
    if result.get("ok"):
        hint = _cookie_account(chaoxing.load_cookies())
        if hint:
            _put_setting(db, "chaoxing_account", hint)
    return result


@router.get("/chaoxing/notices")
def chaoxing_notices():
    """预览：收件箱通知 + 考试列表（不落库）。"""
    data = chaoxing.fetch_notice_items()
    if not data.get("ok"):
        return data
    return {
        "ok": True,
        "notices": data["notices"][:50],
        "exams": data["exams"][:50],
        "notice_error": data.get("notice_error", ""),
        "exam_hint": data.get("exam_hint", ""),
    }


@router.post("/chaoxing/sync-notices")
def chaoxing_sync_notices(db: Session = Depends(get_db)):
    """把收件箱通知和考试导入成任务（按 source_msg_id 去重）。"""
    data = chaoxing.fetch_notice_items()
    if not data.get("ok"):
        return data

    items = chaoxing.notices_to_tasks(data)
    if not items:
        return {
            "ok": True,
            "created": 0,
            "skipped": 0,
            "notice_error": data.get("notice_error", ""),
            "exam_hint": data.get("exam_hint", ""),
        }

    # 去重：同一平台 + 同一来源 id 只留一条
    keys = [it["source_msg_id"] for it in items]
    existing = {
        row[0]
        for row in db.query(Task.source_msg_id)
        .filter(Task.platform == "chaoxing", Task.source_msg_id.in_(keys))
        .all()
    }

    now = _now()
    created = 0
    skipped = 0
    seen: set[str] = set()
    for it in items:
        key = it["source_msg_id"]
        if key in existing or key in seen:
            skipped += 1
            continue
        seen.add(key)
        db.add(
            Task(
                space_id=get_or_create_space().id,
                platform="chaoxing",
                title=it["title"],
                ddl=it.get("ddl"),
                status="pending",
                url=it.get("url"),
                raw_text=it.get("raw_text"),
                source_msg_id=key,
                created_at=now,
                updated_at=now,
            )
        )
        created += 1

    db.commit()
    return {
        "ok": True,
        "created": created,
        "skipped": skipped,
        "notice_error": data.get("notice_error", ""),
        "exam_hint": data.get("exam_hint", ""),
    }

@router.post("/chaoxing/logout")
def chaoxing_logout():
    """退出学习通：清除本机 Cookie。"""
    return chaoxing.logout()


@router.post("/xiaoya/logout")
def xiaoya_logout():
    """退出小雅：清除本机 Cookie。"""
    return xiaoya.logout()


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
                section=m.get("begin"),
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
        # Session 是 autoflush=False：同一次批量里重复的 source_msg_id 在 commit 前
        # 查不出来，会直接撞 UNIQUE(platform, source_msg_id) 导致整次同步失败。
        # 所以先一次性把库里已有的 id 捞出来，再配合 batch_seen 做双重去重。
        existing_ids = {
            row[0]
            for row in db.query(Task.source_msg_id)
            .filter(Task.platform == "chaoxing", Task.source_msg_id.isnot(None))
            .all()
        }
        batch_seen: set[str] = set()
        for a in assignments:
            sid = a.source_msg_id
            if sid and (sid in batch_seen or sid in existing_ids):
                # 已存在的：只更新可能变化的字段
                existing = (
                    db.query(Task)
                    .filter(Task.platform == "chaoxing", Task.source_msg_id == sid)
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
            if sid:
                batch_seen.add(sid)
                existing_ids.add(sid)

            db.add(
                Task(
                    space_id=get_or_create_space().id,
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
        try:
            db.commit()
        except IntegrityError as e:
            db.rollback()
            raise RuntimeError(
                "数据库里有重复任务（旧版本遗留），本次新增已回滚；再点一次「同步作业」通常就正常了"
            ) from e
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
    """课程简称（规格 §10）：词库匹配 + 规则压缩，详见 services/course_abbr.py。

    例：「2026-2027-1-《马克思主义基本原理》-李文巧」→「马原」
    """
    from services.course_abbr import abbr_of

    return abbr_of(course_name) or (course_name or "")[:4]


@router.get("/status")
def adapters_status(db: Session = Depends(get_db)):
    """各平台连接状态（规格 §7.2）+ 当前账号。"""

    def get(key: str) -> str:
        row = db.get(Setting, key)
        return (row.value or "") if row else ""

    logged_cx = chaoxing.has_session()
    logged_xy = xiaoya.has_session()
    cx_account = get("chaoxing_username") or get("chaoxing_account")
    xy_account = get("xiaoya_account")
    if logged_cx and not cx_account:
        cx_account = _cookie_account(chaoxing.load_cookies())
    if logged_xy and not xy_account:
        xy_account = _cookie_account(xiaoya.load_cookies())

    return {
        "chaoxing": {"logged_in": logged_cx, "account": cx_account},
        "xiaoya": {"logged_in": logged_xy, "account": xy_account},
        "wechat": {"state": wechat.status()["state"]},  # running / offline / not_configured
    }


@router.post("/xiaoya/import-cookie")
def xiaoya_import_cookie(body: CookieBody, db: Session = Depends(get_db)):
    """小雅：浏览器登录后导入 Cookie（登录需短信验证，暂不做账密直登）。"""
    result = xiaoya.import_cookies(body.cookie)
    if result.get("ok"):
        hint = _cookie_account(xiaoya.load_cookies())
        if hint:
            _put_setting(db, "xiaoya_account", hint)
    return result


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
                space_id=get_or_create_space().id,
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


@router.get("/wechat/status")
def wechat_status(db: Session = Depends(get_db)):
    """微信监听状态：CLI 安装情况 + 微信进程 + 监听器状态 + 配置的群。"""
    cfg = db.get(Setting, "wechat_groups")
    groups = [g for g in (cfg.value.split(",") if cfg and cfg.value else []) if g]
    from services.component_installer import install_location

    loc = install_location()
    manifest_path = os.path.join(loc["active"], "manifest.json")
    manifest = None
    if os.path.exists(manifest_path):
        try:
            with open(manifest_path, encoding="utf-8") as f:
                manifest = json.load(f)
        except (OSError, ValueError):
            manifest = None

    return {
        "env": cli_status(),
        "listener": wechat.status(),
        "config_groups": groups,
        "install": {**loc, "manifest": manifest},
        "update": _wechat_update_state(db),
    }


def _wechat_update_state(db) -> dict:
    """上一次组件更新检查的结果（启动时自动检查写入），不含联网。"""
    try:
        from services.component_updater import last_state

        return last_state(db) or {}
    except Exception:  # noqa: BLE001 - 仅展示用
        return {}


@router.post("/wechat/install")
def wechat_install(body: WeChatInstall):
    """一键安装 wechat-cli（用户主动触发，不静默下载）。"""
    from services.component_installer import install

    return install(body.source.strip(), body.sha256)


@router.post("/wechat/uninstall")
def wechat_uninstall():
    from services.component_installer import uninstall

    if wechat.status()["state"] == "running":
        wechat.stop()
    return uninstall()


@router.put("/wechat/config")
def wechat_config(body: WeChatConfig, db: Session = Depends(get_db)):
    """保存要监听的群名列表（逗号分隔存 settings）。"""
    value = ",".join(g.strip() for g in body.groups if g.strip())
    _put_setting(db, "wechat_groups", value)
    db.commit()

    # 正在监听时，保存配置后立刻用新群列表重启监听（否则要手动停止再开始）
    groups = [g for g in value.split(",") if g]
    restarted = False
    if wechat.status()["state"] == "running":
        wechat.stop()
        wechat.start(groups, _wechat_on_message)
        restarted = True
    return {"ok": True, "groups": groups, "restarted": restarted}


def _wechat_on_message(msg: dict) -> None:
    """监听线程的回调：过滤 → 提取 → 入库。

    注意：监听跑在独立线程里，这里必须自己开 Session（不能复用请求级 db）。
    任何异常都吞掉并打日志，否则会把监听线程带崩。
    """
    from adapters.wechat_listener import _log, clean_message_text, message_to_task
    from db.database import SessionLocal
    from db.models import WeChatMessage
    from services.message_classify import analyze, load_profile

    text = clean_message_text(msg.get("text") or "")
    if not text:
        return
    msg_id = msg.get("msg_id") or ""

    # 自己发的消息不落库：既不是通知，也不需要变成任务
    sender = (msg.get("sender") or "").strip()
    if sender.lower() in ("me", "self", "我", "myself"):
        return

    try:
        db = SessionLocal()
        try:
            # 1) 每条消息都留档 + 分类打分（供「消息」页筛选）
            row = None
            if msg_id:
                row = (
                    db.query(WeChatMessage)
                    .filter(WeChatMessage.msg_id == msg_id)
                    .first()
                )
            if row is None and msg_id:
                profile = load_profile(db)
                from services.ai_classify import rule_importance

                res = analyze(text, msg.get("group") or "", profile, msg.get("sender") or "")
                action, importance = rule_importance(text, res["category"], res["needs_action"])
                row = WeChatMessage(
                    space_id=get_or_create_space().id,
                    msg_id=msg_id,
                    group_name=msg.get("group"),
                    sender=msg.get("sender"),
                    text=text[:2000],
                    sent_at=msg.get("time"),
                    category=res["category"],
                    relevance=res["relevance"],
                    reason="；".join(res["reasons"]),
                    needs_action=1 if res["needs_action"] else 0,
                    action=action,
                    importance=importance,
                    classify_src="rule",
                    is_task=0,
                    created_at=_now(),
                )
                db.add(row)
                db.commit()

                # 只有「可能显示」的消息才值得化简（闲聊/文件不花额度）
                if res["category"] not in ("chitchat", "misc", "file") and importance in ("high", "medium"):
                    try:
                        from services.digest_worker import enqueue

                        enqueue([row.id])
                    except Exception:  # noqa: BLE001
                        pass
                else:
                    row.classify_src = "rule_final"
                    db.commit()

            # 2) 命中关键词的再走 AI 提取，变成正式任务
            draft = message_to_task(msg)
            if not draft:
                return

            exists = (
                db.query(Task)
                .filter(
                    Task.platform == "wechat",
                    Task.source_msg_id == draft["source_msg_id"],
                )
                .first()
            )
            if exists:
                return

            task = Task(
                space_id=get_or_create_space().id,
                platform="wechat",
                course_name=draft.get("course_name"),
                course_abbr=_abbr(draft.get("course_name")) or None,
                title=draft["title"],
                ddl=draft.get("ddl"),
                status="pending",
                summary=draft.get("summary"),
                raw_text=draft.get("raw_text"),
                confidence=draft.get("confidence"),
                source_msg_id=draft["source_msg_id"],
                in_semester=1,
                created_at=_now(),
                updated_at=_now(),
            )
            db.add(task)
            db.flush()
            if row is not None:
                row.is_task = 1
                row.task_id = task.id
            db.commit()
            _log(f"[wechat] 已入库：{draft['title']}")
        finally:
            db.close()
    except Exception as e:  # noqa: BLE001 - 监听线程不能因单条消息崩掉
        print(f"[wechat] 消息入库失败（忽略）：{type(e).__name__}: {e}", flush=True)


@router.post("/wechat/start")
def wechat_start(db: Session = Depends(get_db)):
    cfg = db.get(Setting, "wechat_groups")
    groups = [g for g in (cfg.value.split(",") if cfg and cfg.value else []) if g]
    return wechat.start(groups, _wechat_on_message)


def auto_start_wechat() -> dict:
    """应用启动时调用：微信已在运行 + 已初始化 + 配了群 → 自动开始监听。"""
    from adapters.wechat_listener import keys_ready, wechat_running
    from db.database import SessionLocal

    if not (wechat_running() and keys_ready()):
        return {"ok": False, "message": "微信未运行或未初始化"}
    db = SessionLocal()
    try:
        cfg = db.get(Setting, "wechat_groups")
        groups = [g for g in (cfg.value.split(",") if cfg and cfg.value else []) if g]
    finally:
        db.close()
    if not groups:
        return {"ok": False, "message": "未配置监听群"}
    return wechat.start(groups, _wechat_on_message)


@router.get("/wechat/groups")
def wechat_groups():
    """列出微信里的群，供用户勾选要监听的群。

    返回值带 code/message：前端据此区分「群为空」与「组件缺失/密钥缺失/解析失败」，
    不再静默返回空数组（旧实现就是这么导致界面一片空白）。
    """
    from adapters.wechat_listener import groups_probe

    return groups_probe()


@router.get("/wechat/update/check")
def wechat_update_check(db: Session = Depends(get_db)):
    """检查 wechat-cli 组件是否有新提交（只读，不自动升级）。"""
    from services.component_updater import check

    return check(db)


@router.post("/wechat/launch")
def wechat_launch():
    """唤起微信客户端（用户点按钮时触发，非静默拉起）。"""
    from adapters.wechat_listener import launch_wechat

    return launch_wechat()


@router.post("/wechat/init")
def wechat_init():
    """执行 wechat-cli init 提取数据库密钥（需微信运行 + 管理员权限）。"""
    from adapters.wechat_listener import run_init

    return run_init()


@router.post("/wechat/derive-keys")
def wechat_derive_keys(body: WeChatDerive):
    """微信 4.1+ 备用路径：用 passphrase 走 PBKDF2 派生密钥。

    4.1 之后进程内存里只剩 passphrase，wechat-cli 的内存扫描必然 0 命中，
    所以需要用户用 wx_key 之类的工具取出 passphrase，这里按微信固定参数
    （PBKDF2-HMAC-SHA512 / 256000 次 / salt=文件前 16 字节）派生真实密钥。
    passphrase 只在内存里过一遍，不写库、不写日志。
    """
    from adapters.wechat_listener import derive_keys, run_init, keys_ready

    res = derive_keys(body.passphrase, body.db_dir or "")
    if not res.get("ok"):
        return res

    # 立刻验证一次：能读会话才说明 passphrase 是对的
    code, out = "", ""
    try:
        from adapters.wechat_listener import _run

        code, out = _run(["sessions", "--limit", "1"], timeout=60)
    except Exception as e:  # noqa: BLE001
        res["verify_error"] = f"{type(e).__name__}: {e}"

    ok_read = bool(out and out.strip().startswith("["))
    res["verified"] = ok_read
    res["keys_ready"] = keys_ready()
    if not ok_read:
        res["ok"] = False
        res["code"] = "PASSPHRASE_REJECTED"
        res["message"] = (
            "已按 passphrase 派生密钥，但读不出会话：passphrase 可能不对，"
            "或微信已重启过（passphrase 会变，需要重新用 wx_key 取一次）"
        )
        if out:
            res["output"] = "\n".join(out.strip().splitlines()[-6:])
    return res

@router.post("/wechat/stop")
def wechat_stop():
    return wechat.stop()


@router.post("/wechat/simulate")
def wechat_simulate(body: WeChatSimulate, db: Session = Depends(get_db)):
    """调试用：不依赖 CLI，直接投递一条群消息，验证「过滤→提取→入库」链路。"""
    from adapters.wechat_listener import _digest, _keyword_hit

    msg = {
        "group": body.group,
        "sender": body.sender,
        "text": body.text,
        "msg_id": body.msg_id or _digest(body.group, body.sender, body.text),
        "keyword_hit": _keyword_hit(body.text),
        "time": _now(),
    }
    # 走完整链路（留存 + 分类打分 + 提取任务），和真实监听保持一致
    from db.models import WeChatMessage

    _wechat_on_message(msg)
    row = (
        db.query(WeChatMessage)
        .filter(WeChatMessage.msg_id == msg["msg_id"])
        .first()
    )
    classified = (
        {
            "category": row.category,
            "relevance": row.relevance,
            "reason": row.reason,
            "needs_action": bool(row.needs_action),
            "is_task": bool(row.is_task),
        }
        if row
        else None
    )

    draft = message_to_task(msg)
    if not draft:
        # 说清楚卡在哪一步，别只给一句「未识别」
        if not msg["keyword_hit"]:
            reason = "未命中关键词（作业/实验/提交/截止…）"
        else:
            reason = "关键词命中，但 AI 与本地规则都没能给出任务（可能 AI 超时/未配置，或没解析出截止时间）"
        return {
            "ok": False,
            "matched": False,
            "message": reason + "；消息已留存并分类",
            "keyword_hit": msg["keyword_hit"],
            "classified": classified,
        }
    exists = (
        db.query(Task)
        .filter(Task.platform == "wechat", Task.source_msg_id == draft["source_msg_id"])
        .first()
    )
    if exists:
        return {"ok": True, "matched": True, "created": False, "task_id": exists.id}
    t = Task(
        space_id=get_or_create_space().id,
        platform="wechat",
        course_name=draft.get("course_name"),
        course_abbr=_abbr(draft.get("course_name")) or None,
        title=draft["title"],
        ddl=draft.get("ddl"),
        status="pending",
        summary=draft.get("summary"),
        raw_text=draft.get("raw_text"),
        confidence=draft.get("confidence"),
        source_msg_id=draft["source_msg_id"],
        in_semester=1,
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return {"ok": True, "matched": True, "created": True, "task_id": t.id, "title": t.title, "ddl": t.ddl}
