"""日历路由（规格 §7.4 + §13.7）。"""
import os
from datetime import date as date_cls
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from config import exports_dir
from db.database import get_db
from db.models import CourseSchedule, Setting, Task
from services.holidays import range_info
from services.ics import export_ics

router = APIRouter()


@router.post("/calendar/export")
def export_calendar(db: Session = Depends(get_db)):
    """生成 ics → 返回文件路径。

    规格 §13.8：默认写入助手目录下 exports/，不写 C 盘；
    若用户显式配置 export_dir 则以配置为准。
    """
    tasks = db.query(Task).all()

    out_dir = exports_dir()
    row = db.get(Setting, "export_dir")
    if row and row.value:
        try:
            os.makedirs(row.value, exist_ok=True)
            out_dir = row.value
        except OSError:
            out_dir = exports_dir()  # 配置目录不可写时回落到默认目录

    path = export_ics(tasks, out_dir)
    return {"path": path, "count": len([t for t in tasks if t.ddl])}


@router.get("/calendar/dayinfo")
def calendar_dayinfo(from_: str | None = None, to: str | None = None):
    """每日农历/节日/节气/是否节假日（规格 §13.3）。默认返回当月。"""
    try:
        start = date_cls.fromisoformat(from_) if from_ else date_cls.today().replace(day=1)
        end = date_cls.fromisoformat(to) if to else start.replace(day=28)
    except ValueError as e:
        raise HTTPException(400, f"日期格式错误：{e}") from e
    if (end - start).days > 400:
        raise HTTPException(400, "日期区间过大（最多 400 天）")
    return {"items": range_info(start, end)}


@router.get("/schedule")
def schedule_of_date(date: str | None = None, db: Session = Depends(get_db)):
    """某日课表（规格 §13.5）：按 weekday 匹配 course_schedule。

    未接入学习通课表时返回空数组，由前端给出引导。
    """
    try:
        target = date_cls.fromisoformat(date) if date else date_cls.today()
    except ValueError as e:
        raise HTTPException(400, f"日期格式错误：{e}") from e

    weekday = target.isoweekday()  # 1=周一 … 7=周日
    rows = (
        db.query(CourseSchedule)
        .filter(CourseSchedule.weekday == weekday)
        .all()
    )
    rows.sort(key=lambda r: r.start_time or "")
    return {
        "date": target.isoformat(),
        "items": [
            {
                "id": r.id,
                "course_name": r.course_name,
                "course_abbr": r.course_abbr,
                "start_time": r.start_time,
                "end_time": r.end_time,
                "location": r.location,
                "weeks": r.weeks,
            }
            for r in rows
        ],
    }


@router.get("/schedule/all")
def schedule_all(db: Session = Depends(get_db)):
    """整学期课表（周视图用）：一次返回全部，前端按 weekday 分组。"""
    rows = db.query(CourseSchedule).all()
    rows.sort(key=lambda r: ((r.weekday or 0), r.start_time or ""))
    return {
        "items": [
            {
                "id": r.id,
                "weekday": r.weekday,
                "course_name": r.course_name,
                "course_abbr": r.course_abbr,
                "start_time": r.start_time,
                "end_time": r.end_time,
                "location": r.location,
                "weeks": r.weeks,
            }
            for r in rows
        ]
    }


@router.get("/calendar/export-dir")
def export_dir_info():
    """导出目录信息，便于前端展示与用户确认（规格 §13.8）。"""
    return {"dir": exports_dir(), "exists": os.path.isdir(exports_dir())}


@router.get("/feed.ics")
def feed_ics(token: str | None = None):
    """（进阶可选）本地订阅链接。Phase 3+ 实现。"""
    return {"mock": True}


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")
