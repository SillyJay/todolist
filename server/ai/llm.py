"""LLM 客户端（规格 §5 模块 4、§12.3）。

- 默认 GLM-4.5-Flash，兼容任意 OpenAI 兼容接口（base_url / model 可改）
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
    return get_secret("glm_api_key")


def is_configured() -> bool:
    return bool(api_key())


def base_url() -> str:
    return get_secret("llm_base_url") or LLM_DEFAULTS["base_url"]


def model() -> str:
    return get_secret("llm_model") or LLM_DEFAULTS["model"]


def chat(
    messages: list[dict],
    *,
    json_mode: bool = False,
    tools: list[dict] | None = None,
    temperature: float | None = None,
    timeout: int | None = None,
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
