"""模型服务商注册表（多供应商适配）。

设计原则：
- **不预设默认供应商**：设置页初始为「未选择」，只把 GLM 标成「推荐」
- 服务商只描述"怎么连"，不绑定 Key；Key 仍统一存 keyring
- 模型列表优先问服务商（GET /models），拿不到就退回内置清单；
  两者都没有时前端显示 `auto`（由后端取该服务商的默认模型）
"""
from __future__ import annotations

import httpx

from services.secrets import get_secret, set_secret

PROVIDERS: list[dict] = [
    {
        "id": "glm",
        "name": "智谱 GLM",
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "models": ["glm-4.7-flash", "glm-5.3-flash", "glm-5.3-flashx"],
        "recommended": True,
        "note": "glm-4.7-flash 免费，推荐先用它",
        "key_url": "https://bigmodel.cn/",
    },
    {
        "id": "deepseek",
        "name": "DeepSeek",
        "base_url": "https://api.deepseek.com/v1",
        "models": ["deepseek-chat", "deepseek-reasoner"],
        "recommended": False,
        "note": "便宜、中文好；reasoner 支持深度思考",
        "key_url": "https://platform.deepseek.com/api_keys",
    },
    {
        "id": "openai",
        "name": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "models": ["gpt-4o-mini", "gpt-4o"],
        "recommended": False,
        "note": "需要可用的网络出口",
        "key_url": "https://platform.openai.com/api-keys",
    },
    {
        "id": "custom",
        "name": "自定义（OpenAI 兼容）",
        "base_url": "",
        "models": [],
        "recommended": False,
        "note": "填自己的 base_url，如本地 Ollama / vLLM / 中转站",
        "key_url": "",
    },
]

_BY_ID = {p["id"]: p for p in PROVIDERS}
DEFAULT_MODEL_HINT = "auto"


# ---------------------------------------------------------------------------
# 多供应商配置（对齐 DSH）
#   - 非敏感项（base_url / models）存 settings KV `ai_providers`（JSON）
#   - API Key 存 keyring：llm_key_<provider_id>；glm 兼容旧的 glm_api_key
#   - 「当前服务商 + 模型」仍用 llm_provider / llm_model 两个 secret
# ---------------------------------------------------------------------------

import json as _json


def _settings_db():
    from db.database import SessionLocal

    return SessionLocal()


def load_overrides() -> dict:
    """读取用户对服务商的自定义配置（base_url / models）。"""
    try:
        from db.models import Setting

        db = _settings_db()
        try:
            row = db.get(Setting, "ai_providers")
            if row and row.value:
                data = _json.loads(row.value)
                return data if isinstance(data, dict) else {}
        finally:
            db.close()
    except Exception:  # noqa: BLE001
        pass
    return {}


def save_overrides(data: dict) -> None:
    from db.models import Setting

    db = _settings_db()
    try:
        row = db.get(Setting, "ai_providers")
        if row:
            row.value = _json.dumps(data, ensure_ascii=False)
        else:
            db.add(Setting(key="ai_providers", value=_json.dumps(data, ensure_ascii=False)))
        db.commit()
    finally:
        db.close()


def key_name(pid: str) -> str:
    return f"llm_key_{pid}"


def get_key(pid: str | None = None) -> str:
    """取某个服务商的 Key；glm 兼容旧版本存在 glm_api_key 里的值。"""
    pid = (pid or current_provider_id() or "").strip()
    if not pid:
        return ""
    v = (get_secret(key_name(pid)) or "").strip()
    if v:
        return v
    if pid == "glm":
        return (get_secret("glm_api_key") or "").strip()
    return ""


def set_key(pid: str, api_key: str) -> None:
    set_secret(key_name(pid), (api_key or "").strip())


def clear_key(pid: str) -> None:
    try:
        from services.secrets import delete_secret

        delete_secret(key_name(pid))
    except Exception:  # noqa: BLE001
        pass


def update_provider(
    pid: str,
    base_url: str | None = None,
    models: list[str] | None = None,
    enabled: list[str] | None = None,
) -> None:
    p = get_provider(pid)
    if not p:
        return
    data = load_overrides()
    cur = dict(data.get(pid) or {})
    if base_url is not None:
        cur["base_url"] = base_url.strip()
    if models is not None:
        cur["models"] = [m.strip() for m in models if m and m.strip()]
    if enabled is not None:
        cur["enabled"] = [m.strip() for m in enabled if m and m.strip()]
    data[pid] = cur
    save_overrides(data)


def reset_provider(pid: str) -> None:
    data = load_overrides()
    data.pop(pid, None)
    save_overrides(data)
    clear_key(pid)


def merged_provider(pid: str) -> dict:
    """注册表 + 用户覆盖，附带 configured / active / enabled_models。"""
    base = dict(get_provider(pid) or {})
    ov = (load_overrides().get(pid) or {})
    if ov.get("base_url"):
        base["base_url"] = ov["base_url"]
    if ov.get("models"):
        base["models"] = list(ov["models"])
    models = list(base.get("models") or [])
    # enabled = 用户勾选要在对话框里显示的模型；没勾过就用全部
    enabled = [m for m in (ov.get("enabled") or []) if m in models] or models
    base["enabled_models"] = enabled
    base["configured"] = bool(get_key(pid))
    base["active"] = pid == current_provider_id()
    return base


def update_enabled(pid: str, enabled: list[str]) -> None:
    data = load_overrides()
    cur = dict(data.get(pid) or {})
    cur["enabled"] = [m.strip() for m in enabled if m and m.strip()]
    data[pid] = cur
    save_overrides(data)


def available_models() -> dict:
    """给对话页的模型选择器：已配置的服务商 + 各自的模型。"""
    out = []
    for p in PROVIDERS:
        pid = p["id"]
        mp = merged_provider(pid)
        if not mp.get("configured") and not mp.get("active"):
            continue
        out.append(
            {
                "id": pid,
                "name": mp["name"],
                "configured": mp["configured"],
                "active": mp["active"],
                "models": mp.get("enabled_models") or mp.get("models") or [],
                "current_model": get_secret("llm_model") if mp["active"] else "",
            }
        )
    return out


def list_providers() -> list[dict]:
    return [merged_provider(p["id"]) for p in PROVIDERS]


def get_provider(pid: str | None) -> dict | None:
    return _BY_ID.get((pid or "").strip())


def current_provider_id() -> str:
    return (get_secret("llm_provider") or "").strip()


def set_provider(pid: str) -> None:
    set_secret("llm_provider", pid)


def provider_base_url(pid: str | None = None) -> str:
    p = get_provider(pid or current_provider_id())
    return (p or {}).get("base_url", "")


def provider_models(pid: str | None = None) -> list[str]:
    p = get_provider(pid or current_provider_id())
    return list((p or {}).get("models") or [])


def fetch_models(api_key: str, base_url: str, timeout: int = 12) -> tuple[list[str], str]:
    """向服务商询问可用模型。返回 (模型列表, 错误信息)。

    不是所有 OpenAI 兼容服务都实现 /models，失败不算错误，由调用方退回内置清单。
    """
    if not api_key or not base_url:
        return [], "缺少 api_key 或 base_url"
    url = f"{base_url.rstrip('/')}/models"
    try:
        with httpx.Client(timeout=timeout) as cli:
            resp = cli.get(url, headers={"Authorization": f"Bearer {api_key}"})
        if resp.status_code == 401:
            return [], "API Key 无效"
        if resp.status_code != 200:
            return [], f"服务商返回 {resp.status_code}"
        data = resp.json()
        items = data.get("data") if isinstance(data, dict) else None
        if not isinstance(items, list):
            return [], "响应里没有模型列表"
        ids = [str(it.get("id")) for it in items if isinstance(it, dict) and it.get("id")]
        return sorted(set(ids)), ""
    except httpx.TimeoutException:
        return [], "请求超时"
    except (httpx.HTTPError, ValueError) as e:
        return [], f"读取失败：{type(e).__name__}"
