"""APScheduler 定时任务（规格模块 2 + §10.4）。

当前注册：
- 每周一 08:00 自动同步学习通课表（课表接口只返回"当前周"，必须每周刷一次）
- 启动时若课表超过 6 天未更新，后台补一次

作业轮询（25-30 分钟）在 Phase 2 与 AI 摘要一起接入。
"""
from datetime import datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from db.database import SessionLocal
from db.models import CourseSchedule, Setting

_scheduler: BackgroundScheduler | None = None


def _sync_schedule_once(force: bool = False) -> None:
    from adapters.chaoxing import ChaoxingAdapter
    from routers.adapters import _abbr

    adapter = ChaoxingAdapter()
    if not adapter.has_session():
        return

    db = SessionLocal()
    try:
        if not force:
            row = db.get(Setting, "schedule_synced_at")
            if row and row.value:
                try:
                    last = datetime.fromisoformat(row.value)
                    if datetime.now().astimezone() - last < timedelta(days=6):
                        return
                except ValueError:
                    pass

        data = adapter.fetch_schedule()
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
        _put(db, "curriculum_week", str(data.get("current_week") or ""))
        _put(db, "schedule_synced_at", datetime.now().astimezone().isoformat(timespec="seconds"))
        db.commit()
    except Exception:  # noqa: BLE001 - 定时任务不允许抛出中断
        db.rollback()
    finally:
        db.close()


def _put(db, key: str, value: str) -> None:
    row = db.get(Setting, key)
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value))


def start_scheduler() -> None:
    global _scheduler
    if _scheduler:
        return
    _scheduler = BackgroundScheduler(timezone="Asia/Shanghai")
    _scheduler.add_job(
        _sync_schedule_once,
        CronTrigger(day_of_week="mon", hour=8, minute=0),
        id="sync_schedule_weekly",
        kwargs={"force": True},
        replace_existing=True,
    )
    _scheduler.start()
    # 启动补同步（数据超过 6 天才跑，避免每次开都打扰学习通）
    _scheduler.add_job(
        _sync_schedule_once,
        "date",
        run_date=datetime.now() + timedelta(seconds=20),
        kwargs={"force": False},
        id="sync_schedule_startup",
        replace_existing=True,
    )


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
