"""课表周次工具（规格 §13.5）。"""
from datetime import date


def parse_weeks(weeks: str | None) -> set[int]:
    """'1-16,18' → {1..16, 18}"""
    out: set[int] = set()
    if not weeks:
        return out
    for part in weeks.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, _, b = part.partition("-")
            try:
                out.update(range(int(a), int(b) + 1))
            except ValueError:
                continue
        else:
            try:
                out.add(int(part))
            except ValueError:
                continue
    return out


def weeks_contain(weeks: str | None, week_no: int) -> bool:
    w = parse_weeks(weeks)
    return (not w) or (week_no in w)  # 周次为空的课视为每周都有


def week_of_date(target: date, first_week_date: date) -> int:
    """按学期第一周周一推算教学周（第 1 周为 1）。"""
    return (target - first_week_date).days // 7 + 1
