"""LLM 客户端（规格 §5 模块 4、§12.3）。

- 默认 GLM-4.7-Flash（免费；GLM-4.5-Flash 已于 2026-01-30 下线），兼容任意 OpenAI 兼容接口（base_url / model 可改）
- API Key 存 keyring（services/secrets.py），不落明文
- 30s 超时 + 1 次重试；失败返回结构化错误，由上层降级为「AI 不可用，已存原文」
"""
import json
from typing import Any

import httpx

from ai.prompts import LLM_DEFAULTS
from services.secrets import get_secret


class LLMError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def api_key() -> str:
    """当前服务商的 Key（每个服务商各存一份，互不覆盖）。"""
    from ai.providers import get_key

    return get_key(provider_id())


def is_configured() -> bool:
    return bool(api_key())


def provider_id() -> str:
    """当前选择的服务商 id（空字符串 = 未选择）。"""
    from ai.providers import current_provider_id

    return current_provider_id()


def base_url() -> str:
    """显式配置优先，其次取服务商内置地址，最后兜底。"""
    explicit = get_secret("llm_base_url")
    if explicit:
        return explicit
    from ai.providers import merged_provider

    mp = merged_provider(provider_id())
    return (mp.get("base_url") or "") or LLM_DEFAULTS["base_url"]


def model() -> str:
    """显式模型优先；选了 auto 时取该服务商的默认（清单第一个）。"""
    explicit = (get_secret("llm_model") or "").strip()
    if explicit and explicit != "auto":
        return explicit
    from ai.providers import merged_provider

    models = merged_provider(provider_id()).get("models") or []
    return models[0] if models else LLM_DEFAULTS["model"]


# 思考强度：off / low / medium / high（auto = 交给模型默认）
THINKING_LEVELS = ("auto", "off", "low", "medium", "high")


def thinking_level() -> str:
    v = (get_secret("llm_thinking") or "").strip().lower()
    return v if v in THINKING_LEVELS else "auto"


def set_thinking_level(level: str) -> str:
    from services.secrets import set_secret

    lv = (level or "").strip().lower()
    if lv not in THINKING_LEVELS:
        lv = "auto"
    set_secret("llm_thinking", lv)
    return lv


def _apply_thinking(payload: dict, level: str) -> None:
    """把思考强度翻译成服务商参数。

    - glm：支持 thinking={type: enabled/disabled}
    - 其它 OpenAI 兼容：带 reasoning_effort（不认识该参数的服务商会忽略）
    """
    if level == "auto":
        return
    if model().startswith("glm"):
        payload["thinking"] = {"type": "disabled" if level == "off" else "enabled"}
    else:
        payload["reasoning_effort"] = {"off": "minimal", "low": "low", "medium": "medium", "high": "high"}[level]


def chat(
    messages: list[dict],
    *,
    json_mode: bool = False,
    tools: list[dict] | None = None,
    temperature: float | None = None,
    timeout: int | None = None,
    thinking: bool | None = None,
) -> dict:
    """调用 chat/completions，返回原始 JSON。

    抛 LLMError(code=NO_KEY / HTTP_xxx / TIMEOUT / BAD_RESPONSE)
    """
    key = api_key()
    if not key:
        raise LLMError("NO_KEY", "未配置 API Key，请在设置页填写")

    payload: dict[str, Any] = {
        "model": model(),
        "messages": messages,
        "temperature": LLM_DEFAULTS["temperature"] if temperature is None else temperature,
        "stream": False,
    }
    # thinking=False 时关掉 GLM 的思考（工具轮这类只求快的调用）；
    # 未显式指定时，按用户在对话框右下角选的「思考强度」。
    if thinking is False and ((provider_id() == "glm") or model().startswith("glm")):
        payload["thinking"] = {"type": "disabled"}
    elif thinking is None:
        _apply_thinking(payload, thinking_level())
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    url = f"{base_url().rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    last_err: Exception | None = None

    for attempt in range(2):  # 1 次重试
        try:
            with httpx.Client(timeout=timeout or LLM_DEFAULTS["timeout"]) as cli:
                resp = cli.post(url, json=payload, headers=headers)
            if resp.status_code == 401:
                raise LLMError("UNAUTHORIZED", "API Key 无效或已过期")
            if resp.status_code == 429:
                raise LLMError("RATE_LIMIT", "调用频率超限，请稍后再试")
            if resp.status_code >= 500:
                last_err = LLMError(f"HTTP_{resp.status_code}", f"服务端错误 {resp.status_code}")
                continue
            if resp.status_code != 200:
                raise LLMError(f"HTTP_{resp.status_code}", resp.text[:200])
            return resp.json()
        except httpx.TimeoutException as e:
            last_err = LLMError("TIMEOUT", f"请求超时：{e}")
        except httpx.HTTPError as e:
            last_err = LLMError("NETWORK", f"网络错误：{e}")

    raise last_err or LLMError("UNKNOWN", "调用失败")


def chat_text(messages: list[dict], **kwargs) -> str:
    data = chat(messages, **kwargs)
    try:
        return data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError) as e:
        raise LLMError("BAD_RESPONSE", f"响应格式异常：{e}") from e


def chat_json(messages: list[dict], **kwargs) -> dict:
    text = chat_text(messages, json_mode=True, **kwargs)
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1] if "```" in text[3:] else text
        text = text.lstrip("json").strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                pass
        raise LLMError("BAD_JSON", f"模型未返回合法 JSON：{text[:120]}")


def chat_stream(
    messages: list[dict],
    *,
    temperature: float | None = None,
    timeout: int | None = None,
):
    """流式调用 chat/completions，逐段 yield 文本增量。

    只在「最终答案」这一轮使用；带工具调用的轮次必须先拿到完整 JSON，
    所以仍走非流式的 chat()。

    GLM 默认开思考模式：思考期间只吐 reasoning_content，正文要等思考完，
    表现为「很慢且不像流式」，所以这里显式关掉 thinking；
    老模型不认识该字段时（400 + thinking），去掉再试一次。
    """
    key = api_key()
    if not key:
        raise LLMError("NO_KEY", "未配置 API Key，请在设置页填写")

    payload: dict[str, Any] = {
        "model": model(),
        "messages": messages,
        "temperature": LLM_DEFAULTS["temperature"] if temperature is None else temperature,
        "stream": True,
    }
    # 流式回答按用户选的思考强度：off 关掉，low/medium/high 开启；
    # auto 时为避免「思考期间不吐字」，仍然关掉（保持原来的快）。
    lv = thinking_level()
    if lv == "auto":
        if (provider_id() == "glm") or model().startswith("glm"):
            payload["thinking"] = {"type": "disabled"}
    else:
        _apply_thinking(payload, lv)

    url = f"{base_url().rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    for attempt in range(2):
        try:
            with httpx.Client(timeout=timeout or LLM_DEFAULTS["timeout"]) as cli:
                with cli.stream("POST", url, json=payload, headers=headers) as resp:
                    if resp.status_code == 401:
                        raise LLMError("UNAUTHORIZED", "API Key 无效或已过期")
                    if resp.status_code == 429:
                        raise LLMError("RATE_LIMIT", "调用频率超限，请稍后再试")
                    if resp.status_code != 200:
                        body_text = resp.read().decode("utf-8", errors="replace")[:200]
                        if (
                            resp.status_code == 400
                            and "thinking" in body_text.lower()
                            and attempt == 0
                            and "thinking" in payload
                        ):
                            payload.pop("thinking", None)
                            continue
                        raise LLMError(f"HTTP_{resp.status_code}", body_text)

                    for line in resp.iter_lines():
                        if not line:
                            continue
                        line = line.strip()
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        choices = chunk.get("choices") or []
                        if not choices:
                            continue
                        delta = choices[0].get("delta") or {}
                        piece = delta.get("content")
                        if piece:
                            yield piece
            return
        except httpx.TimeoutException as e:
            raise LLMError("TIMEOUT", f"请求超时：{e}") from e
        except httpx.HTTPError as e:
            raise LLMError("NETWORK", f"网络错误：{e}") from e