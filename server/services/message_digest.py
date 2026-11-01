"""把群消息压成一句话（「消息」页用）。

设计取舍：
- 不放在入库时生成：群消息量大，且大部分是闲聊（已被过滤），入库阶段调 LLM 既慢又费钱。
- 改成**懒生成**：前端显示某几条时，把缺 digest 的 id 批量发过来，后端补齐并落库，
  之后永久复用（同一条消息只花一次）。
- 没有配置 API Key 时降级为规则截断，保证界面不空着。
"""

from __future__ import annotations

import json as _json
import re
import time

MAX_LEN = 46

PROMPT = (
    "把下面这条校园微信群消息压缩成一句中文短句，供列表快速扫读。要求：\n"
    "1. 只保留关键信息：谁要做什么 / 截止时间 / 地点 / 报名方式（有就写，没有就不写）\n"
    "2. 不超过 40 个字，不要换行，不要引号，不要「通知：」这类前缀\n"
    "3. 不要编造原文没有的信息；原文像广告/闲聊就直接概括它是什么\n"
    "只输出这句话本身。"
)


def _fallback(text: str) -> str:
    """AI 不可用时的降级：去掉【标题】/开头寒暄，取第一句，再截断。"""
    t = re.sub(r"\s+", " ", (text or "").strip())
    if not t:
        return ""
    # 「【时间调整通知】xxx」→ 去掉方括号标题后再看不空就留着
    t = re.sub(r"^[【\[][^】\]]{0,60}[】\]]\s*", "", t)
    # 取第一句（中文句号/问号/感叹号/分号）
    first = re.split(r"[。！？；;]", t, maxsplit=1)[0].strip()
    t = first or t
    return t if len(t) <= MAX_LEN else t[:MAX_LEN].rstrip() + "…"


BATCH_PROMPT = (
    "下面是一个 JSON 数组，每项是一条校园微信群消息（id + text）。"
    "请为每条生成一句中文短句摘要，要求：\n"
    "1. 只保留关键信息：谁要做什么 / 截止时间 / 地点 / 报名方式（有就写）\n"
    "2. 每条不超过 40 字，不要引号、不要换行\n"
    "3. 不要编造原文没有的信息\n"
    "只输出 JSON：{\"results\":[{\"id\":1,\"digest\":\"...\"}]}"
)


def digest_many(items: list[tuple[int, str]]) -> dict[int, str]:
    """一次请求给多条消息生成摘要（省配额：8 条 1 次调用，而不是 8 次）。"""
    if not items:
        return {}
    payload = [{"id": i, "text": (t or "")[:600]} for i, t in items]
    try:
        from ai import llm

        if not llm.is_configured():
            return {}
        data = llm.chat_json(
            [
                {"role": "system", "content": BATCH_PROMPT},
                {"role": "user", "content": _json.dumps(payload, ensure_ascii=False)},
            ],
            temperature=0.2,
            timeout=45,
        )
    except Exception as e:  # noqa: BLE001
        import logging

        logging.getLogger("campus").warning("批量摘要失败：%s", e)
        return {}

    out: dict[int, str] = {}
    for row in data.get("results") or []:
        try:
            mid = int(row.get("id"))
        except (TypeError, ValueError):
            continue
        text = str(row.get("digest") or "").strip().strip('"').strip("「」")
        if len(text) >= 4:
            out[mid] = text[:MAX_LEN] + ("…" if len(text) > MAX_LEN else "")
    return out


def digest_text(text: str) -> tuple[str, str]:
    """返回 (digest, source)。source: 'ai' | 'fallback'。"""
    raw = (text or "").strip()
    if not raw:
        return "", "fallback"
    try:
        from ai import llm

        if not llm.is_configured():
            return _fallback(raw), "fallback"
        msgs = [
            {"role": "system", "content": PROMPT},
            {"role": "user", "content": raw[:1200]},
        ]
        last_err = ""
        for attempt in range(2):
            try:
                out = llm.chat_text(msgs, temperature=0.2, timeout=25 if attempt == 0 else 40, thinking=False)
                line = re.sub(r"\s+", " ", (out or "").strip().strip('"').strip("「」"))
                if len(line) >= 4:
                    if len(line) > MAX_LEN:
                        line = line[:MAX_LEN].rstrip() + "…"
                    return line, "ai"
                last_err = f"too short: {line!r}"
            except Exception as e:  # noqa: BLE001
                last_err = f"{type(e).__name__}: {e}"
                time.sleep(3.0)
        # 失败要留痕，否则以后不知道是超时还是限流
        import logging

        logging.getLogger("campus").warning("消息摘要生成失败：%s", last_err)
        return _fallback(raw), "fallback"
    except Exception as e:  # noqa: BLE001
        import logging

        logging.getLogger("campus").warning("消息摘要异常：%s", e)
        return _fallback(raw), "fallback"
