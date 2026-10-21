"""学习通 Adapter（规格 §5 模块 2）。

设计：
- 登录：passport2.chaoxing.com/fanyalogin（表单登录），Cookie 落盘持久化
- 抓取：优先 HTTP 接口，接口失效时回退 Playwright 浏览器抓取（规格允许的兜底）
- ⚠️ 红线：只读数据。绝不包含任务点完成/刷课/答题/提交作业代码。

状态：登录与 Cookie 持久化已完成；作业列表的返回结构需真实账号联调确认。
"""
import json
import os
import time
from typing import Any

import httpx

from adapters.base import Assignment, Attachment, BaseAdapter
from config import data_dir

LOGIN_URL = "https://passport2.chaoxing.com/fanyalogin"
COURSE_LIST_URL = "https://mooc1-api.chaoxing.com/mycourse/backclazzdata?view=json"
WORK_LIST_URL = "https://mooc1-api.chaoxing.com/work/getAllWork"
HOME_URL = "https://i.chaoxing.com"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0 Safari/537.36"
)


class ChaoxingAdapter(BaseAdapter):
    platform = "chaoxing"

    def __init__(self) -> None:
        self.cookie_path = os.path.join(data_dir(), "chaoxing_cookies.json")

    # ---------- Cookie 持久化 ----------

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
        """Cookie 中同时存在 _uid 与 _d 认为有会话（学习通的登录凭据）。"""
        c = self.load_cookies()
        return bool(c.get("_uid") and c.get("_d"))

    # ---------- 登录 ----------

    def login(self, username: str = "", password: str = "", **_: Any) -> dict:
        """账号密码登录。

        返回 {"ok": bool, "code": str, "message": str}
        code: OK / NEED_CAPTCHA / BAD_CREDENTIALS / NETWORK_ERROR / UNKNOWN
        """
        if not username or not password:
            return {"ok": False, "code": "BAD_CREDENTIALS", "message": "账号或密码为空"}

        try:
            with httpx.Client(timeout=20, follow_redirects=True, headers={"User-Agent": UA}) as cli:
                resp = cli.post(
                    LOGIN_URL,
                    data={
                        "fid": "-1",
                        "uname": username,
                        "password": password,
                        "refer": HOME_URL,
                        "t": "true",
                        "forbidotherlogin": "0",
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                cookies = {c.name: c.value for c in cli.cookies.jar}
        except httpx.HTTPError as e:
            return {"ok": False, "code": "NETWORK_ERROR", "message": f"网络错误：{e}"}
        except ValueError:
            # 返回非 JSON，通常是触发了滑块/验证码页
            return {
                "ok": False,
                "code": "NEED_CAPTCHA",
                "message": "登录被拦截（可能需要验证码），请在浏览器登录后导入 Cookie",
            }

        if not data.get("status"):
            msg = str(data.get("msg", "登录失败"))
            code = "NEED_CAPTCHA" if ("验证" in msg or "频繁" in msg) else "BAD_CREDENTIALS"
            return {"ok": False, "code": code, "message": msg}

        self.save_cookies(cookies)
        return {"ok": True, "code": "OK", "message": "登录成功"}

    def import_cookies(self, raw: str) -> dict:
        """导入浏览器 Cookie 字符串（形如 `_uid=xxx; _d=yyy; uf=zzz`）。"""
        cookies: dict[str, str] = {}
        for part in raw.replace("\n", ";").split(";"):
            if "=" not in part:
                continue
            k, v = part.split("=", 1)
            k, v = k.strip(), v.strip()
            if k:
                cookies[k] = v
        if not cookies.get("_uid") or not cookies.get("_d"):
            return {"ok": False, "code": "BAD_COOKIE", "message": "Cookie 缺少 _uid 或 _d 字段"}
        self.save_cookies(cookies)
        return {"ok": True, "code": "OK", "message": f"已导入 {len(cookies)} 个 Cookie 字段"}

    # ---------- 数据抓取 ----------

    def _client(self) -> httpx.Client:
        return httpx.Client(
            timeout=25,
            follow_redirects=True,
            headers={"User-Agent": UA},
            cookies=self.load_cookies(),
        )

    def fetch_courses(self) -> list[dict]:
        """课程列表：[{course_id, class_id, name}]"""
        with self._client() as cli:
            resp = cli.get(COURSE_LIST_URL)
            resp.raise_for_status()
            data = resp.json()

        courses: list[dict] = []
        for ch in data.get("channelList", []):
            content = ch.get("content") or {}
            course = content.get("course") or {}
            course_id = course.get("id")
            class_id = content.get("id")
            for c in course.get("data", []) or []:
                courses.append({"course_id": c.get("id"), "class_id": class_id, "name": c.get("name")})
            if not course.get("data") and course_id:
                courses.append(
                    {"course_id": course_id, "class_id": class_id, "name": course.get("name")}
                )
        return courses

    def fetch_assignments(self) -> list[Assignment]:
        """拉取全部课程的作业列表（防御式解析，字段需真实账号联调确认）。"""
        result: list[Assignment] = []
        for course in self.fetch_courses():
            if not course.get("course_id") or not course.get("class_id"):
                continue
            try:
                result.extend(self._fetch_course_works(course))
            except (httpx.HTTPError, ValueError):
                continue
        return result

    def _fetch_course_works(self, course: dict) -> list[Assignment]:
        out: list[Assignment] = []
        with self._client() as cli:
            resp = cli.get(
                WORK_LIST_URL,
                params={
                    "classId": course["class_id"],
                    "courseId": course["course_id"],
                    "isdes": 0,
                    "pagenum": 1,
                },
            )
            resp.raise_for_status()
            try:
                data = resp.json()
            except ValueError:
                return []

        items = (data.get("data") or {}).get("workList") or data.get("workList") or []
        for w in items:
            out.append(
                Assignment(
                    platform=self.platform,
                    course_name=course.get("name") or "",
                    title=w.get("title") or w.get("name") or "未命名作业",
                    ddl=_to_iso(w.get("endTime") or w.get("deadline")),
                    status=_map_status(w),
                    url=w.get("url") or "",
                    source_msg_id=str(w.get("id") or w.get("workId") or ""),
                    attachments=[
                        Attachment(name=a.get("name", ""), url=a.get("url", ""))
                        for a in (w.get("attachment") or [])
                    ],
                )
            )
        return out


def _to_iso(value: Any) -> str | None:
    """学习通时间字段可能是毫秒时间戳或 'YYYY-MM-DD HH:MM' 字符串。"""
    if not value:
        return None
    if isinstance(value, (int, float)):
        ts = value / 1000 if value > 1e11 else value
        return time.strftime("%Y-%m-%dT%H:%M:%S+08:00", time.localtime(ts))
    text = str(value).strip()
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return time.strftime("%Y-%m-%dT%H:%M:%S+08:00", time.strptime(text, fmt))
        except ValueError:
            continue
    return text or None


def _map_status(work: dict) -> str:
    """状态映射：学习通常见字段 status（0 未交 / 1 已交）与超时标记。"""
    raw = work.get("status")
    if raw in (1, "1", True):
        return "submitted"
    if work.get("overdue") or work.get("excessTime"):
        return "expired"
    return "pending"
