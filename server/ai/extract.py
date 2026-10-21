"""文本 → 任务草稿（规格 §5 模块 4 L1）。

优先调用 LLM（结构化 JSON）；未配置 Key 或调用失败时，降级为本地规则提取，
保证「AI 不可用，已存原文」也能得到可用草稿（confidence 较低，前端提示待确认）。
"""
import re
from datetime import datetime, timedelta

from ai.llm import LLMError, chat_json, is_configured
from ai.prompts import DDL_EXTRACT_PROMPT

_WEEKDAY = {"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6}


def extract(text: str, source: str = "manual") -> dict:
    """返回 {is_task,title,course_name,ddl,summary,confidence,engine,hint}"""
    text = (text or "").strip()
    if not text:
        return _empty("文本为空")

    if is_configured():
        try:
            return _extract_by_llm(text)
        except LLMError as e:
            draft = _extract_by_rules(text)
            draft["hint"] = f"AI 调用失败（{e.code}），已用本地规则解析，请核对"
            return draft

    draft = _extract_by_rules(text)
    draft["hint"] = "未配置 API Key，使用本地规则解析，请核对时间"
    return draft


def _empty(hint: str) -> dict:
    return {
        "is_task": False,
        "title": "",
        "course_name": None,
        "ddl": None,
        "summary": "",
        "confidence": 0.0,
        "engine": "none",
        "hint": hint,
    }


def _extract_by_llm(text: str) -> dict:
    now = datetime.now().astimezone()
    messages = [
        {"role": "system", "content": DDL_EXTRACT_PROMPT},
        {
            "role": "user",
            "content": f"当前时间：{now.strftime('%Y-%m-%d %H:%M')}（周{'一二三四五六日'[now.weekday()]}）\n\n通知原文：\n{text[:3000]}",
        },
    ]
    data = chat_json(messages)
    return {
        "is_task": bool(data.get("is_task", True)),
        "title": (data.get("title") or "").strip() or text[:20],
        "course_name": data.get("course_name"),
        "ddl": _normalize_ddl(data.get("ddl")),
        "summary": (data.get("summary") or "").strip(),
        "confidence": float(data.get("confidence") or 0.8),
        "engine": "llm",
        "hint": "",
    }


def _normalize_ddl(value) -> str | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.astimezone()
    return dt.isoformat(timespec="seconds")


def _extract_by_rules(text: str) -> dict:
    """本地规则：识别日期/时间/课程名，作为无 Key 时的兜底。"""
    now = datetime.now()
    ddl = _find_datetime(text, now)

    course = None
    m = re.search(r"《(.+?)》", text) or re.search(r"【(.+?)】", text)
    if m:
        course = m.group(1)[:12]
    else:
        m = re.search(r"课程[：:]\s*([^\s，,。；;]{2,20})", text)
        if m:
            course = m.group(1)

    # 标题：取第一行非空文本，去掉通知抬头
    first = ""
    for line in text.splitlines():
        line = line.strip()
        if line:
            first = line
            break
    title = re.sub(r"^(通知|公告)[：:\s]*", "", first)
    title = re.sub(r"^【.+?】", "", title).strip()
    if "请于" in title:
        title = title.split("请于")[0]
    title = title.strip(" ，,。;；") [:30] or "未命名任务"

    return {
        "is_task": True,
        "title": title,
        "course_name": course,
        "ddl": ddl,
        "summary": text[:40].replace("\n", " "),
        "confidence": 0.55 if ddl else 0.35,
        "engine": "rules",
        "hint": "",
    }


def _find_datetime(text: str, now: datetime) -> str | None:
    """从中文文本里找截止时间：绝对日期优先，其次相对日期。"""
    date_obj: datetime | None = None

    # 1) 2026-10-25 / 2026/10/25
    m = re.search(r"(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})", text)
    if m:
        date_obj = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    else:
        # 2) 10月25日 / 10-25
        m = re.search(r"(?<!\d)(\d{1,2})[-月/](\d{1,2})日?", text)
        if m:
            month, day = int(m.group(1)), int(m.group(2))
            if 1 <= month <= 12 and 1 <= day <= 31:
                year = now.year
                candidate = datetime(year, month, day)
                if candidate < now - timedelta(days=180):
                    candidate = datetime(year + 1, month, day)
                date_obj = candidate

    # 3) 相对日期
    if date_obj is None:
        if "今天" in text or "今晚" in text:
            date_obj = datetime(now.year, now.month, now.day)
        elif "明天" in text or "明晚" in text:
            date_obj = now + timedelta(days=1)
            date_obj = datetime(date_obj.year, date_obj.month, date_obj.day)
        elif "后天" in text:
            date_obj = now + timedelta(days=2)
            date_obj = datetime(date_obj.year, date_obj.month, date_obj.day)
        else:
            m = re.search(r"(本周|这周|下周|周)([一二三四五六日天])", text)
            if m:
                target = _WEEKDAY[m.group(2)]
                delta = target - now.weekday()
                if m.group(1) == "下周" or delta < 0:
                    delta += 7
                d = now + timedelta(days=delta)
                date_obj = datetime(d.year, d.month, d.day)

    if date_obj is None:
        return None

    hour, minute = 23, 59
    m = re.search(r"(\d{1,2})[:：](\d{2})", text)
    if m:
        hour, minute = int(m.group(1)), int(m.group(2))
    else:
        m = re.search(r"(上午|下午|晚上|中午)?\s*(\d{1,2})\s*点(半|(\d{1,2})分)?", text)
        if m:
            hour = int(m.group(2))
            suffix = m.group(1) or ""
            if suffix in ("下午", "晚上") and hour < 12:
                hour += 12
            minute = 30 if m.group(3) == "半" else int(m.group(4) or 0)

    final = date_obj.replace(hour=min(hour, 23), minute=min(minute, 59), second=0, microsecond=0)
    return final.astimezone().isoformat(timespec="seconds")
