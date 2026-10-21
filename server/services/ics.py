"""ICS 导出（规格 §5 模块 5）。

- DDL 事件：标题 `[作业] 课程简称 - 任务名`，两条 VALARM（前 24h、前 1h）
- 课表事件：标题 `{课程简称} @ {地点}`，按 RRULE 每周重复（Phase 3）
- 已完成任务重新导出时标题前缀改为 `[已完成]`
"""
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from icalendar import Alarm, Calendar, Event

from config import data_dir

CN_TZ = ZoneInfo("Asia/Shanghai")


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    # 全链路统一东八区（规格 §12.5）
    if dt.tzinfo is None:
        return dt.replace(tzinfo=CN_TZ)
    return dt.astimezone(CN_TZ)


def build_calendar(tasks: list, schedules: list | None = None) -> Calendar:
    cal = Calendar()
    cal.add("prodid", "-//Campus Assistant//CN")
    cal.add("version", "2.0")
    cal.add("calscale", "GREGORIAN")
    cal.add("x-wr-calname", "校园信息管理助手")
    cal.add("x-wr-timezone", "Asia/Shanghai")

    for t in tasks:
        ddl = _parse_dt(t.ddl)
        if not ddl:
            continue
        if t.status in ("ignored", "expired"):
            continue

        prefix = "[已完成]" if t.status == "done" else "[作业]"
        course = t.course_abbr or t.course_name or ""
        summary = f"{prefix} {course} - {t.title}".replace("  ", " ").strip()

        ev = Event()
        ev.add("summary", summary)
        ev.add("dtstart", ddl - timedelta(minutes=30))
        ev.add("dtend", ddl)
        ev.add("dtstamp", datetime.now().astimezone())

        desc_parts = []
        if t.platform:
            desc_parts.append(f"来源：{t.platform}")
        if t.url:
            desc_parts.append(f"链接：{t.url}")
        if t.summary:
            desc_parts.append(f"摘要：{t.summary}")
        ev.add("description", "\n".join(desc_parts))
        ev.add("uid", f"task-{t.id}@campus-assistant")

        # 两条提醒：前 24h、前 1h（规格模块 5）
        for minutes in (24 * 60, 60):
            alarm = Alarm()
            alarm.add("action", "DISPLAY")
            alarm.add("description", summary)
            alarm.add("trigger", timedelta(minutes=-minutes))
            ev.add_component(alarm)

        cal.add_component(ev)

    # 课表事件（Phase 3 接入 course_schedule 后启用）
    for s in schedules or []:
        pass

    return cal


def export_ics(tasks: list, out_dir: str | None = None) -> str:
    """生成 .ics 到 exports 目录，返回文件路径。文件名带时间戳，不覆盖旧文件。"""
    cal = build_calendar(tasks)
    target_dir = out_dir or os.path.join(data_dir(), "exports")
    os.makedirs(target_dir, exist_ok=True)
    filename = f"campus-{datetime.now().strftime('%Y%m%d-%H%M%S')}.ics"
    path = os.path.join(target_dir, filename)
    with open(path, "wb") as f:
        f.write(cal.to_ical())
    return path
