"""本机密钥（admin token）。

为什么需要它：
后端原来用「来源 IP 是不是 127.0.0.1」判断请求是不是桌面 App 自己发的。
一旦挂了 Cloudflare 隧道 / 反向代理，代理连后端时来源就是 127.0.0.1，
这个判断就失效了——公网任何人都能冒充本机读数据。

所以改成「持有密钥才算本机」：
- Electron 启动后端时生成一个随机串，通过 --admin-token 传入
- 渲染进程通过 preload 拿到同一个串，随请求带 X-Admin-Token 头
- 没有这个头 → 只能走设备 token（配对后的手机）
"""

from __future__ import annotations

import os

_TOKEN: str = ""


def set_token(token: str) -> None:
    global _TOKEN
    _TOKEN = (token or "").strip()


def get_token() -> str:
    return _TOKEN


def init_from_env() -> None:
    set_token(os.environ.get("CA_ADMIN_TOKEN", ""))


def is_admin(header_value: str | None) -> bool:
    """请求头里的密钥是否等于本机密钥。"""
    if not _TOKEN or not header_value:
        return False
    import hmac

    return hmac.compare_digest(header_value.strip(), _TOKEN)
