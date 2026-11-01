"""数据保留策略：清理超期的微信群消息。

规则（可在 settings 里用 message_retention_days 覆盖）：
- 微信消息默认保留 90 天
- 任务、日程、课表、文件记录不自动删除
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

log = logging.getLogger("campus.retention")

DEFAULT_DAYS = 90


def retention_days(db) -> int:
    from db.models import Setting

    row = db.get(Setting, "message_retention_days")
    try:
        days = int((row.value if row else "") or DEFAULT_DAYS)
    except (TypeError, ValueError):
        days = DEFAULT_DAYS
    return max(7, min(days, 3650))


def purge_old_messages(db=None) -> dict:
    """删除超过保留期的消息，返回统计。"""
    from db.database import SessionLocal
    from db.models import WeChatMessage

    own = db is None
    db = db or SessionLocal()
    try:
        days = retention_days(db)
        cutoff = (datetime.now().astimezone() - timedelta(days=days)).isoformat(timespec="seconds")

        # sent_at 可能是格式不一的字符串；用 created_at 兜底
        from sqlalchemy import func, or_

        q = db.query(WeChatMessage).filter(
            or_(
                func.coalesce(WeChatMessage.sent_at, WeChatMessage.created_at) < cutoff,
            )
        )
        total = q.count()
        if total:
            q.delete(synchronize_session=False)
            db.commit()
            log.info("清理 %s 条超过 %s 天的消息", total, days)
        return {"deleted": total, "days": days, "cutoff": cutoff}
    finally:
        if own:
            db.close()


def start_retention_job() -> None:
    """每天凌晨跑一次；用 APScheduler（主调度器已存在时复用）。"""
    import threading
    import time

    def loop() -> None:
        while True:
            try:
                from db.database import SessionLocal

                db = SessionLocal()
                try:
                    purge_old_messages(db)
                finally:
                    db.close()
            except Exception as e:  # noqa: BLE001
                log.warning("清理任务失败：%s", e)
            time.sleep(24 * 3600)

    threading.Thread(target=loop, daemon=True, name="retention").start()
    log.info("数据清理任务已启动（每 24 小时）")
