"""把一句中文（语音识别结果 / 手打）解析成结构化日程。

两条路：
1. 有 API Key → 让模型输出严格 JSON（准确、能理解"下周三之前"这类说法）
2. 没有 Key / 模型失败 → 退回规则解析，保证语音那条链路永远可用
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta

CN_NUM = {
    "零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5,
    "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
}

WEEK = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7}

PERIOD = {"凌晨": "am", "早上": "am", "上午": "am", "中午": "noon", "下午": "pm", "傍晚": "pm", "晚上": "pm"}

PROMPT = """你是日程解析器。把用户的一句话解析成 JSON，只输出 JSON：
{
  "type": "event" | "task",
  "title": "去掉时间描述后的标题",
  "date": "YYYY-MM-DD",
  "start": "HH:mm",
  "end": "HH:mm",
  "location": "地点或 null",
  "remind_before": 15,
  "confidence": 0.0~1.0
}
规则：
- 带起止时间（下午三点开会）→ type=event；只有截止时间（周五前交报告）→ type=task
- 没说的字段填 null，不要编造
- date 用相对今天的实际日期，今天是 {today}（周{weekday}）
"""


def _cn_num(s: str) -> int | None:
    if not s:
        return None
    if s.isdigit():
        return int(s)
    if s == "十":
        return 10
    if len(s) == 2 and s[0] == "十":
        return 10 + CN_NUM.get(s[1], 0)
    if len(s) == 2 and s[1] == "十":
        return CN_NUM.get(s[0], 0) * 10
    if len(s) == 3 and s[1] == "十":
        return CN_NUM.get(s[0], 0) * 10 + CN_NUM.get(s[2], 0)
    return CN_NUM.get(s)


def rule_parse(text: str, now: datetime | None = None) -> dict:
    """规则解析（没有 AI Key 时的兜底）。"""
    now = now or datetime.now()
    raw = (text or "").strip()
    work = raw
    matched: list[str] = []

    date = None
    for word, off in (("大后天", 3), ("后天", 2), ("明天", 1), ("明日", 1), ("今天", 0), ("今日", 0)):
        if word in work:
            date = (now + timedelta(days=off)).date()
            matched.append(word)
            work = work.replace(word, "")
            break

    if date is None:
        m = re.search(r"(下|这|本)?(?:周|星期|礼拜)([一二三四五六日天])", work)
        if m:
            target = WEEK[m.group(2)]
            cur = now.isoweekday()
            diff = target - cur
            if m.group(1) == "下":
                diff += 7
            elif diff < 0:
                diff += 7
            date = (now + timedelta(days=diff)).date()
            matched.append(m.group(0))
            work = work.replace(m.group(0), "")

    if date is None:
        m = re.search(r"(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*[日号]?", work)
        if m:
            mo, dy = int(m.group(1)), int(m.group(2))
            if 1 <= mo <= 12 and 1 <= dy <= 31:
                candidate = datetime(now.year, mo, dy)
                if candidate.date() < (now - timedelta(days=1)).date():
                    candidate = candidate.replace(year=now.year + 1)
                date = candidate.date()
                matched.append(m.group(0))
                work = work.replace(m.group(0), "")

    hour = minute = None
    m = re.search(r"(\d{1,2})\s*[:：]\s*(\d{1,2})", work)
    if m:
        h, mi = int(m.group(1)), int(m.group(2))
        if h <= 23 and mi <= 59:
            hour, minute = h, mi
            matched.append(m.group(0))
            work = work.replace(m.group(0), "")

    if hour is None:
        period = None
        for k, v in PERIOD.items():
            if k in work:
                period = v
                matched.append(k)
                work = work.replace(k, "")
                break
        m = re.search(r"(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*点\s*(半|一刻|三刻|\d{1,2}\s*分?)?", work)
        if m:
            h = _cn_num(m.group(1))
            if h is not None and h <= 24:
                hour = h
                minute = {"半": 30, "一刻": 15, "三刻": 45}.get(m.group(2) or "", 0)
                if m.group(2) and minute == 0:
                    minute = int(re.sub(r"\D", "", m.group(2)) or 0)
                if period == "pm" and hour < 12:
                    hour += 12
                if period == "noon" and hour <= 2:
                    hour += 12
                if period == "am" and hour == 12:
                    hour = 0
                matched.append(m.group(0))
                work = work.replace(m.group(0), "")
        elif period == "noon":
            hour, minute = 12, 0

    location = None
    m = re.search(r"(?:在|地点[:：]?|去)\s*([\u4e00-\u9fa5A-Za-z0-9]{2,12}(?:楼|室|馆|厅|场|区|教室|机房)?)", work)
    if m:
        location = m.group(1)
        matched.append(m.group(0))
        work = work.replace(m.group(0), "")
    else:
        # 口语常把地点放句尾：「小组会议 实训515」「讲座 报告厅」
        tail = re.search(
            r"\s+((?:实训|教|机|实验|综合)?\s*[A-Za-z]?\d{2,4}|[\u4e00-\u9fa5]{1,8}(?:楼|室|馆|厅|场))$",
            work,
        )
        if tail:
            location = tail.group(1).strip()
            matched.append(tail.group(0))
            work = work[: tail.start()]

    title = re.sub(r"^(之前|以前|前|截止|ddl)", "", work.strip())
    title = re.sub(r"\s+", " ", title).strip(" ，,、。.")
    start = None
    end = None
    if hour is not None:
        start = f"{hour:02d}:{minute or 0:02d}"
        end_dt = datetime(2000, 1, 1, hour, minute or 0) + timedelta(hours=1)
        end = end_dt.strftime("%H:%M")

    return {
        "type": "event" if start else "task",
        "title": title or raw,
        "date": date.isoformat() if date else now.date().isoformat(),
        "start": start,
        "end": end,
        "location": location,
        "remind_before": 15,
        "confidence": 0.55 if start or date else 0.3,
        "matched": matched,
        "source": "rule",
    }


def parse_event(text: str, now: datetime | None = None) -> dict:
    """优先 AI，失败退回规则。"""
    now = now or datetime.now()
    try:
        from ai import llm

        if llm.is_configured():
            data = llm.chat_json(
                [
                    {
                        "role": "system",
                        "content": PROMPT.replace("{today}", now.date().isoformat()).replace(
                            "{weekday}", "一二三四五六日"[now.isoweekday() - 1]
                        ),
                    },
                    {"role": "user", "content": text[:500]},
                ],
                temperature=0.1,
                timeout=30,
                thinking=False,
            )
            out = rule_parse(text, now)  # 先拿规则结果当兜底字段
            for key in ("type", "title", "date", "start", "end", "location", "remind_before"):
                if data.get(key) not in (None, ""):
                    out[key] = data[key]
            out["confidence"] = float(data.get("confidence") or 0.8)
            out["source"] = "ai"
            return out
    except Exception as e:  # noqa: BLE001
        import logging

        logging.getLogger("campus").warning("parse-event 走规则：%s", e)

    return rule_parse(text, now)


def to_event_payload(parsed: dict) -> dict:
    """转成 events 表能直接落库的字段。"""
    return {
        "title": parsed.get("title") or "未命名",
        "date": parsed.get("date") or datetime.now().date().isoformat(),
        "start": parsed.get("start") or "09:00",
        "end": parsed.get("end") or "10:00",
        "location": parsed.get("location"),
        "remind_before": int(parsed.get("remind_before") or 15),
    }


def dumps(obj: dict) -> str:
    return json.dumps(obj, ensure_ascii=False)
