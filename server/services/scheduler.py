"""APScheduler 定时任务（规格模块 2 + §10.4）。

当前注册：
- 每周日 21:00 同步整学期课表（约 8 秒，防止老师临时调课）
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

        data = adapter.fetch_schedule_semester()
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
        _put(db, "curriculum_max_week", str(data.get("max_week") or ""))
        if data.get("school_year"):
            _put(db, "curriculum_school_year", str(data.get("school_year")))
        if data.get("semester"):
            _put(db, "curriculum_semester", str(data.get("semester")))
        ts = data.get("first_week_date")
        if ts:
            _put(db, "curriculum_first_week_date", datetime.fromtimestamp(ts / 1000).date().isoformat())
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


def _refresh_assignments() -> None:
    """触发作业同步（内部有 10 分钟防抖，避免课程起止时间密集时重复刷）。"""
    from datetime import datetime as _dt

    from db.database import SessionLocal
    from db.models import Setting
    from routers import adapters as adapters_router

    db = SessionLocal()
    try:
        last = db.get(Setting, "assignments_refreshed_at")
        if last and last.value:
            try:
                gap = _dt.now().astimezone() - _dt.fromisoformat(last.value)
                if gap.total_seconds() < 600:
                    return
            except ValueError:
                pass
        _put(db, "assignments_refreshed_at", _dt.now().astimezone().isoformat(timespec="seconds"))
        db.commit()
    finally:
        db.close()

    try:
        adapters_router.chaoxing_refresh()  # 内部起线程，立即返回
    except Exception:  # noqa: BLE001
        pass


def _schedule_class_jobs(scheduler) -> None:
    """按今天的课表，在每节课开始/结束时各触发一次作业同步。"""
    from datetime import date, datetime as _dt, timedelta

    from db.database import SessionLocal
    from db.models import CourseSchedule

    db = SessionLocal()
    try:
        today = date.today()
        rows = db.query(CourseSchedule).filter(CourseSchedule.weekday == today.isoweekday()).all()
    finally:
        db.close()

    now = _dt.now()
    for r in rows:
        for t in (r.start_time, r.end_time):
            if not t:
                continue
            try:
                hh, mm = t.split(":")[:2]
                run_at = now.replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
            except ValueError:
                continue
            if run_at <= now + timedelta(minutes=1):
                continue
            scheduler.add_job(
                _refresh_assignments,
                "date",
                run_date=run_at,
                id=f"cls_{today.isoformat()}_{t}_{r.id}",
                replace_existing=True,
            )


def _boot_tasks() -> None:
    """启动后的补动作：自动开始微信监听 + 排当天的课程刷新任务。"""
    from services import scheduler as _self

    try:
        from routers.adapters import auto_start_wechat

        auto_start_wechat()
    except Exception:  # noqa: BLE001
        pass


def start_scheduler() -> None:
    global _scheduler
    if _scheduler:
        return
    _scheduler = BackgroundScheduler(timezone="Asia/Shanghai")
    _scheduler.add_job(
        _sync_schedule_once,
        CronTrigger(day_of_week="sun", hour=21, minute=0),
        id="sync_schedule_weekly",
        kwargs={"force": True},
        replace_existing=True,
    )
    # 作业自动同步：每 30 分钟
    _scheduler.add_job(
        _refresh_assignments,
        "interval",
        minutes=30,
        id="refresh_assignments_30m",
        replace_existing=True,
    )
    # 每天 00:10 重新安排当天的课程起止刷新
    _scheduler.add_job(
        lambda: _schedule_class_jobs(_scheduler),
        CronTrigger(hour=0, minute=10),
        id="reschedule_class_jobs",
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
    # 启动 30 秒后：自动开始微信监听 + 排当天课程刷新
    _scheduler.add_job(
        _boot_tasks,
        "date",
        run_date=datetime.now() + timedelta(seconds=30),
        id="boot_tasks",
        replace_existing=True,
    )
    _scheduler.add_job(
        lambda: _schedule_class_jobs(_scheduler),
        "date",
        run_date=datetime.now() + timedelta(seconds=35),
        id="schedule_class_jobs_startup",
        replace_existing=True,
    )


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
