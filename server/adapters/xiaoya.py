"""讯飞小雅 Adapter（规格 §5 模块 6）。

小雅没有公开 API，登录态只能靠浏览器会话。当前实现：
- Cookie 导入 / 持久化 / 状态检测（已完成）
- 作业抓取：Phase 3 用 Playwright 打开 `xiaoya.iflytek.com` 作业页读取
- ⚠️ 红线：交作业完全人工，不做任何自动上传/提交
"""
import json
import os

from adapters.base import BaseAdapter, Assignment
from config import data_dir

XIAOYA_HOST = "https://xiaoya.iflytek.com"


class XiaoyaAdapter(BaseAdapter):
    platform = "xiaoya"

    def __init__(self) -> None:
        self.cookie_path = os.path.join(data_dir(), "xiaoya_cookies.json")

    # ---------- Cookie ----------

    def load_cookies(self) -> dict[str, str]:
        if not os.path.exists(self.cookie_path):
            return {}
        try:
            with open(self.cookie_path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError):
            return {}

    def save_cookies(self, cookies: dict[str, str]) -> None:
        with open(self.cookie_path, "w", encoding="utf-8") as f:
            json.dump(cookies, f, ensure_ascii=False, indent=2)

    def has_session(self) -> bool:
        """小雅的会话凭据名不固定，只要导入过非空 Cookie 即视为已配置，
        真实有效性由 fetch 时的跳转判断。"""
        return bool(self.load_cookies())

    def import_cookies(self, raw: str) -> dict:
        cookies: dict[str, str] = {}
        for part in raw.replace("\n", ";").split(";"):
            if "=" not in part:
                continue
            k, v = part.split("=", 1)
            k, v = k.strip(), v.strip()
            if k:
                cookies[k] = v
        if not cookies:
            return {"ok": False, "code": "BAD_COOKIE", "message": "Cookie 为空"}
        self.save_cookies(cookies)
        return {"ok": True, "code": "OK", "message": f"已导入 {len(cookies)} 个 Cookie 字段"}

    def login(self, username: str = "", password: str = "", **kwargs) -> dict:
        """账号密码登录：小雅登录需短信/图形验证，暂不支持纯 HTTP 登录。"""
        return {
            "ok": False,
            "code": "NEED_BROWSER",
            "message": "小雅暂不支持直接账密登录，请在浏览器登录后导入 Cookie",
        }

    # ---------- 抓取 ----------

    def fetch_assignments(self, progress=None) -> list[Assignment]:
        """Phase 3：Playwright 打开小雅作业页抓取。当前未实现，返回空。"""
        if progress:
            progress(1, 1, "小雅抓取尚未实现")
        return []
