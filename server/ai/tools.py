"""Function Calling 工具定义与执行（规格 §7.3）。

工具集（6 个）：
1. get_upcoming_tasks(days)   查未来 N 天截止的任务
2. search_tasks(keyword)      关键词搜索任务
3. add_task(title, ddl, course) 添加任务
4. complete_task(task_id)     标记完成
5. get_schedule(day_offset)   查某天课表
6. export_calendar()          导出 ics
"""
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from config import exports_dir
from db.models import CourseSchedule, Task
from services.ics import export_ics
from services.schedule import week_of_date, weeks_contain

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_upcoming_tasks",
            "description": "查询未来 N 天内截止的待办任务",
            "parameters": {
                "type": "object",
                "properties": {"days": {"type": "integer", "description": "天数，默认 7"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_tasks",
            "description": "按关键词搜索任务标题或课程名",
            "parameters": {
                "type": "object",
                "properties": {"keyword": {"type": "string"}},
                "required": ["keyword"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_task",
            "description": "新建一条待办任务",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "ddl": {"type": "string", "description": "ISO8601 时间，可空"},
                    "course": {"type": "string"},
                },
                "required": ["title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "complete_task",
            "description": "把任务标记为已完成",
            "parameters": {
                "type": "object",
                "properties": {"task_id": {"type": "integer"}},
                "required": ["task_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_schedule",
            "description": "查询某天的课程安排（0=今天，1=明天）",
            "parameters": {
                "type": "object",
                "properties": {"day_offset": {"type": "integer"}},
            },
        },
    },
    {
        "type": "function",
        "function": {"name": "export_calendar", "description": "导出日历为 ics 文件", "parameters": {}},
    },
]


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _task_brief(t: Task) -> dict:
    return {
        "id": t.id,
        "title": t.title,
        "course": t.course_abbr or t.course_name,
        "ddl": t.ddl,
        "status": t.status,
        "platform": t.platform,
    }


def execute(name: str, args: dict, db: Session) -> dict:
    try:
        if name == "get_upcoming_tasks":
            days = int(args.get("days") or 7)
            limit = (datetime.now() + timedelta(days=days)).astimezone().isoformat(timespec="seconds")
            rows = (
                db.query(Task)
                .filter(Task.status == "pending", Task.ddl.isnot(None), Task.ddl <= limit)
                .all()
            )
            rows.sort(key=lambda t: t.ddl or "")
            return {"tasks": [_task_brief(t) for t in rows[:30]], "count": len(rows)}

        if name == "search_tasks":
            kw = (args.get("keyword") or "").strip()
            rows = (
                db.query(Task)
                .filter(Task.title.contains(kw) | Task.course_name.contains(kw))
                .limit(30)
                .all()
            )
            return {"tasks": [_task_brief(t) for t in rows], "count": len(rows)}

        if name == "add_task":
            t = Task(
                platform="manual",
                course_name=args.get("course"),
                course_abbr=args.get("course"),
                title=args.get("title") or "未命名任务",
                ddl=args.get("ddl"),
                status="pending",
                in_semester=1,
                created_at=_now(),
                updated_at=_now(),
            )
            db.add(t)
            db.commit()
            db.refresh(t)
            return {"ok": True, "task": _task_brief(t)}

        if name == "complete_task":
            t = db.get(Task, int(args.get("task_id") or 0))
            if not t:
                return {"ok": False, "error": "任务不存在"}
            t.status = "done"
            t.updated_at = _now()
            db.commit()
            return {"ok": True, "task": _task_brief(t)}

        if name == "get_schedule":
            offset = int(args.get("day_offset") or 0)
            target = date.today() + timedelta(days=offset)
            rows = db.query(CourseSchedule).filter(CourseSchedule.weekday == target.isoweekday()).all()
            first = db.get(__import__("db.models", fromlist=["Setting"]).Setting, "curriculum_first_week_date")
            if first and first.value:
                try:
                    week = week_of_date(target, date.fromisoformat(first.value))
                    rows = [r for r in rows if weeks_contain(r.weeks, week)]
                except ValueError:
                    pass
            rows.sort(key=lambda r: r.start_time or "")
            return {
                "date": target.isoformat(),
                "courses": [
                    {
                        "course": r.course_abbr or r.course_name,
                        "start": r.start_time,
                        "end": r.end_time,
                        "location": r.location,
                    }
                    for r in rows
                ],
                "count": len(rows),
            }

        if name == "export_calendar":
            rows = db.query(Task).all()
            path = export_ics(rows, exports_dir())
            return {"ok": True, "path": path, "count": len([t for t in rows if t.ddl])}

        return {"error": f"未知工具 {name}"}
    except Exception as e:  # noqa: BLE001 - 工具异常回传给模型
        return {"error": f"{type(e).__name__}: {e}"}
