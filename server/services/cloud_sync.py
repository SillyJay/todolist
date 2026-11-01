"""云端同步：把本机采集的任务推到中心服务器，把手机建的事件拉回本机。

- 推送：本地任务（按 updated_at 增量）→ 远端 /api/sync/ops
- 拉取：远端 /api/sync/changes 里的 events → 写本地
- 游标存在 settings（cloud_cursor_push / cloud_cursor_pull）
- Token 来自桌面登录，存在 keyring 的 cloud_token
"""

from __future__ import annotations

import json
import logging

import httpx

log = logging.getLogger("campus.cloud")

PUSH_CURSOR = "cloud_cursor_push"
PULL_CURSOR = "cloud_cursor_pull"


def _setting(db, key: str, default: str = "") -> str:
    from db.models import Setting

    row = db.get(Setting, key)
    return (row.value if row and row.value is not None else default) or default


def _set_setting(db, key: str, value: str) -> None:
    from db.models import Setting

    row = db.get(Setting, key)
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value))


def _token() -> str:
    from services.secrets import get_secret

    return (get_secret("cloud_token") or "").strip()


def configured(db) -> tuple[bool, str, str]:
    """返回 (是否启用, 服务器地址, 错误说明)。"""
    if _setting(db, "cloud_enabled", "0") != "1":
        return False, "", "未开启"
    url = _setting(db, "cloud_url").rstrip("/")
    if not url:
        return False, "", "未配置服务器地址"
    if not _token():
        return False, url, "未登录账号"
    return True, url, ""


def _headers() -> dict:
    return {"Authorization": f"Bearer {_token()}", "Content-Type": "application/json"}


def push_tasks(db) -> dict:
    """把本地新改动的任务推上去。"""
    from db.models import Task

    ok, url, why = configured(db)
    if not ok:
        return {"ok": False, "message": why}

    cursor = _setting(db, PUSH_CURSOR, "1970-01-01T00:00:00+00:00")
    rows = (
        db.query(Task)
        .filter(Task.updated_at.isnot(None), Task.updated_at > cursor)
        .order_by(Task.updated_at.asc())
        .limit(100)
        .all()
    )
    if not rows:
        return {"ok": True, "pushed": 0, "cursor": cursor}

    ops = []
    for t in rows:
        ops.append(
            {
                "op_id": f"desk-{t.id}-{int((t.updated_at or '').__hash__()) & 0xFFFFFFF}",
                "entity": "task",
                "action": "create",
                "patch": {
                    "title": t.title,
                    "ddl": t.ddl,
                    "course_name": t.course_name,
                    "platform": t.platform or "manual",
                    "raw_text": t.raw_text,
                    "url": t.url,
                },
            }
        )

    try:
        with httpx.Client(timeout=25) as cli:
            resp = cli.post(f"{url}/api/sync/ops", json={"ops": ops}, headers=_headers())
        if resp.status_code == 401:
            return {"ok": False, "message": "登录已失效，请重新登录"}
        resp.raise_for_status()
    except Exception as e:  # noqa: BLE001
        log.warning("云端推送失败：%s", e)
        return {"ok": False, "message": f"推送失败：{type(e).__name__}"}

    new_cursor = max((t.updated_at or "" for t in rows), default=cursor)
    _set_setting(db, PUSH_CURSOR, new_cursor)
    db.commit()
    return {"ok": True, "pushed": len(rows), "cursor": new_cursor}


def pull_events(db) -> dict:
    """拉取远端新建/修改的日程，写进本地。"""
    from db.models import Event

    ok, url, why = configured(db)
    if not ok:
        return {"ok": False, "message": why}

    cursor = _setting(db, PULL_CURSOR, "1970-01-01T00:00:00+00:00")
    try:
        with httpx.Client(timeout=25) as cli:
            resp = cli.get(
                f"{url}/api/sync/changes",
                params={"since": cursor},
                headers=_headers(),
            )
        if resp.status_code == 401:
            return {"ok": False, "message": "登录已失效，请重新登录"}
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:  # noqa: BLE001
        log.warning("云端拉取失败：%s", e)
        return {"ok": False, "message": f"拉取失败：{type(e).__name__}"}

    added = 0
    for e in data.get("events") or []:
        if not e.get("id"):
            continue
        row = db.get(Event, e["id"])
        if row:
            continue
        db.add(
            Event(
                id=e["id"],
                space_id=e.get("space_id") or None,
                title=e.get("title"),
                date=e.get("date"),
                start=e.get("start"),
                end=e.get("end"),
                location=e.get("location"),
                note=e.get("note"),
                remind_before=e.get("remind_before") or 15,
                source=e.get("source") or "cloud",
                created_at=e.get("created_at"),
                updated_at=e.get("updated_at"),
            )
        )
        added += 1

    db.commit()
    new_cursor = data.get("cursor") or cursor
    _set_setting(db, PULL_CURSOR, new_cursor)
    db.commit()
    return {"ok": True, "pulled": added, "cursor": new_cursor}


def sync_once(db) -> dict:
    push = push_tasks(db)
    pull = pull_events(db)
    return {"ok": bool(push.get("ok")) or bool(pull.get("ok")), "push": push, "pull": pull}


def start_cloud_loop(interval: int = 300) -> None:
    """后台每 5 分钟同步一次（仅在开启时）。"""
    import threading
    import time

    def loop() -> None:
        while True:
            try:
                from db.database import SessionLocal

                db = SessionLocal()
                try:
                    ok, _, _ = configured(db)
                    if ok:
                        sync_once(db)
                finally:
                    db.close()
            except Exception as e:  # noqa: BLE001
                log.warning("云端同步循环异常：%s", e)
            time.sleep(interval)

    threading.Thread(target=loop, daemon=True, name="cloud-sync").start()
    log.info("云端同步循环已启动（每 %s 秒）", interval)
