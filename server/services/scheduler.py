"""APScheduler 定时任务（规格模块 2 + §10.4）。

当前注册：
- 每周日 21:00 同步整学期课表（约 8 秒，防止老师临时调课）
- 启动时若课表超过 6 天未更新，后台补一次

作业轮询（25-30 分钟）在 Phase 2 与 AI 摘要一起接入。
"""
from datetime import datetime, timedelta
import time

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
    """启动后的补动作：自动提取微信密钥 → 自动开始监听 → 排当天的课程刷新任务。"""
    from services import scheduler as _self

    # 1) 密钥：缺失时自动跑一次 wechat-cli init（已有则跳过，不阻塞界面）
    try:
        from adapters.wechat_listener import auto_init_keys

        r = auto_init_keys()
        if not r.get("skipped"):
            print(f"[boot] 微信密钥：{r.get('message')}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[boot] 自动提取密钥失败：{e}", flush=True)

    # 2) 监听：密钥就绪且微信在跑才启动
    try:
        from routers.adapters import auto_start_wechat

        auto_start_wechat()
    except Exception:  # noqa: BLE001
        pass

    # 3) 组件更新：每次启动自动检查一次（带节流，失败不影响启动）
    try:
        from db.database import SessionLocal
        from services.component_updater import auto_check_on_boot

        r = auto_check_on_boot(SessionLocal)
        if r.get("has_update"):
            print(
                f"[boot] wechat-cli 有新提交：{r.get('current')} → {r.get('latest')}",
                flush=True,
            )
        elif r.get("error"):
            print(f"[boot] 组件更新检查失败（忽略）：{r['error']}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[boot] 组件更新检查异常（忽略）：{e}", flush=True)


# 微信看门狗状态：避免刷屏、避免频繁重试 init
_WD = {"phase": "", "init_at": 0.0}


def _wechat_watchdog() -> None:
    """每 60 秒检查一次：微信没开就等着，开了就自动提密钥 + 开始监听。

    解决的问题：开机时微信常常还没启动，而 `_boot_tasks` 只跑一次，
    那一次失败后就再也不会自动开始监听了。
    """
    try:
        from adapters.wechat_listener import keys_ready, wechat_running
        from routers.adapters import auto_start_wechat, wechat
    except Exception:  # noqa: BLE001
        return

    st = wechat.status()
    if st.get("state") == "running":
        if _WD["phase"] != "running":
            _WD["phase"] = "running"
            print("[wechat] 监听中", flush=True)
        return

    # 密钥还没拿到 → 自动试一次只读扫描（wcdb），失败 5 分钟后重试。
    try:
        from adapters.wechat_listener import maybe_auto_init

        res = maybe_auto_init()
        if res and res.get("ok"):
            print(f"[wechat] 启动窗口内自动提取密钥成功：{res.get('message')}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[wechat] 自动提取异常：{type(e).__name__}: {e}", flush=True)

    # 没配置群就别白跑（每次 wechat_running() 会起一个 tasklist 子进程）
    try:
        from db.database import SessionLocal
        from db.models import Setting

        db = SessionLocal()
        try:
            cfg = db.get(Setting, "wechat_groups")
            if not (cfg and cfg.value and cfg.value.strip()):
                return
        finally:
            db.close()
    except Exception:  # noqa: BLE001
        return

    if not wechat_running():
        if _WD["phase"] != "wechat_closed":
            _WD["phase"] = "wechat_closed"
            print("[wechat] 未检测到微信，60 秒后重试", flush=True)
        return

    # 微信已启动但密钥还没有：尝试提取（10 分钟冷却，init 本身可能要几分钟）
    if not keys_ready():
        now = time.time()
        if now - _WD["init_at"] < 600:
            return
        _WD["init_at"] = now
        _WD["phase"] = "initializing"
        print("[wechat] 检测到微信已启动，尝试提取密钥…", flush=True)
        try:
            from adapters.wechat_listener import auto_init_keys

            r = auto_init_keys(force=True)
            print(f"[wechat] 密钥提取结果：{r.get('message')}", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"[wechat] 密钥提取异常：{e}", flush=True)
        if not keys_ready():
            return

    try:
        r = auto_start_wechat()
        if r.get("ok"):
            _WD["phase"] = "running"
            print(f"[wechat] 自动开始监听：{r.get('message')}", flush=True)
        elif r.get("message") != "未配置监听群":
            print(f"[wechat] 暂不能开始监听：{r.get('message')}", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[wechat] 自动开始监听失败：{e}", flush=True)


def _warm_caches() -> None:
    """启动后预热慢接口（微信组件探测），避免用户第一次打开设置页卡一下。"""
    try:
        from adapters.wechat_listener import cli_status

        cli_status()
    except Exception:  # noqa: BLE001
        pass


# 群消息保留天数（超过就删，避免 SQLite 无限膨胀）
WECHAT_RETENTION_DAYS = 30


def _cleanup_wechat_messages() -> None:
    """每天清理超过保留期的群消息（任务不受影响）。"""
    from datetime import datetime, timedelta

    from db.database import SessionLocal
    from db.models import WeChatMessage

    cutoff = (datetime.now().astimezone() - timedelta(days=WECHAT_RETENTION_DAYS)).isoformat(
        timespec="seconds"
    )
    db = SessionLocal()
    try:
        removed = (
            db.query(WeChatMessage)
            .filter(WeChatMessage.created_at < cutoff)
            .delete(synchronize_session=False)
        )
        db.commit()
        if removed:
            print(f"[wechat] 已清理 {removed} 条超过 {WECHAT_RETENTION_DAYS} 天的群消息", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[wechat] 清理群消息失败（忽略）：{e}", flush=True)
    finally:
        db.close()


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
    # 启动 2 秒后预热缓存（微信组件探测约 0.7s，别让用户第一次开设置页等）
    _scheduler.add_job(
        _warm_caches,
        "date",
        run_date=datetime.now() + timedelta(seconds=2),
        id="warm_caches",
        replace_existing=True,
    )
    # 群消息保留 30 天：每天 03:30 清理一次
    _scheduler.add_job(
        _cleanup_wechat_messages,
        CronTrigger(hour=3, minute=30),
        id="wechat_cleanup_30d",
        replace_existing=True,
    )
    # 微信看门狗：每 60 秒检查一次（微信没开就等，开了自动提密钥并监听）
    _scheduler.add_job(
        _wechat_watchdog,
        "interval",
        seconds=20,
        id="wechat_watchdog",
        max_instances=1,
        coalesce=True,
        replace_existing=True,
    )
    # 启动 2 秒后：自动提密钥 + 自动开始监听（用户点开软件就生效，不用手动操作）
    _scheduler.add_job(
        _boot_tasks,
        "date",
        run_date=datetime.now() + timedelta(seconds=2),
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
