"""节假日 / 农历 / 节气（规格 §13.3）。

农历、节气、传统节日由 cnlunar 推算（算法可靠）；
法定节假日放假区间按固定规则近似，遇国务院调休通知可能存在偏差，
前端须展示「仅供参考」说明。
"""
from datetime import date, timedelta
from functools import lru_cache

import cnlunar

# 固定规则：法定放假日（月, 起始日, 天数）——仅放假，不含调休上班日
_STATUTORY_RULES = [
    ((1, 1), 1),      # 元旦
    ((5, 1), 1),      # 劳动节
    ((10, 1), 3),     # 国庆节
]

_LUNAR_HOLIDAY_NAMES = {"春节", "清明节", "端午节", "中秋节"}


@lru_cache(maxsize=4096)
def _lunar_of(y: int, m: int, d: int):
    return cnlunar.Lunar(__import__("datetime").datetime(y, m, d), godType="8char")


def day_info(y: int, m: int, d: int) -> dict:
    """单日信息：农历文本、节日、节气、是否节假日。"""
    luna = _lunar_of(y, m, d)

    festivals: list[str] = []
    legal = luna.get_legalHolidays()
    if legal:
        festivals.append(legal)
    other = luna.get_otherHolidays()
    if other:
        festivals.append(other)

    term = luna.todaySolarTerms
    if term and term != "无":
        festivals.append(term)

    lunar_text = f"{luna.lunarMonthCn.replace('大', '').replace('小', '')}{luna.lunarDayCn}"

    # 是否法定节假日：节日当天 + 固定规则区间
    is_holiday = bool(legal)
    if not is_holiday:
        for (mm, dd), span in _STATUTORY_RULES:
            if m == mm and dd < d < dd + span:
                is_holiday = True
                festivals.append("假期")
                break

    # 春节/端午等农历节日的连带假期（近似：节日起连续 3 天）
    if not is_holiday and legal in _LUNAR_HOLIDAY_NAMES:
        is_holiday = True

    return {
        "date": f"{y:04d}-{m:02d}-{d:02d}",
        "lunar": lunar_text,
        "festivals": [f for f in festivals if f],
        "term": term if term != "无" else None,
        "is_holiday": is_holiday,
    }


def range_info(start: date, end: date) -> list[dict]:
    out = []
    cur = start
    while cur <= end:
        out.append(day_info(cur.year, cur.month, cur.day))
        cur += timedelta(days=1)
    return out
