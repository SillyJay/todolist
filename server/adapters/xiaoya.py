"""讯飞小雅 Adapter（规格 §5 模块 6）。

实测（2026-10）：
- 登录态靠浏览器 Cookie（内置浏览器登录导入），其中 `HS-prd-access-token` 即 Bearer 令牌
- 课程列表：GET /api/jx-iresource/group/student/groups?time_flag=1
- 内容树：GET /api/jx-iresource/resource/queryCourseResources/v2?group_id=
         （任务本身不带标题，用 node_id 到内容树里映射名称）
- 任务列表：GET /api/jx-stat/group/task/queryTaskNotices?group_id=&role=1
- ⚠️ 红线：只读；交作业完全人工，不做任何自动上传/提交
"""
import json
import os
from datetime import datetime, timezone, timedelta

import httpx

from adapters.base import Assignment, BaseAdapter
from config import data_dir

API = "https://xyapi.fifedu.com/api"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
)
CN = timezone(timedelta(hours=8))


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
        c = self.load_cookies()
        return bool(c.get("HS-prd-access-token"))

    def import_cookies(self, raw: str) -> dict:
        cookies: dict[str, str] = {}
        for part in raw.replace("\n", ";").split(";"):
            if "=" not in part:
                continue
            k, v = part.split("=", 1)
            k, v = k.strip(), v.strip()
            if k:
                cookies[k] = v
        if not cookies.get("HS-prd-access-token"):
            return {
                "ok": False,
                "code": "BAD_COOKIE",
                "message": "缺少 HS-prd-access-token，请重新登录小雅",
            }
        self.save_cookies(cookies)
        return {"ok": True, "code": "OK", "message": f"已导入 {len(cookies)} 个 Cookie 字段"}

    def login(self, username: str = "", password: str = "", **kwargs) -> dict:
        return {
            "ok": False,
            "code": "NEED_BROWSER",
            "message": "小雅登录需验证码，请用「内置浏览器登录」",
        }

    # ---------- 请求 ----------

    def _client(self) -> httpx.Client:
        ck = self.load_cookies()
        token = ck.get("HS-prd-access-token", "")
        headers = {
            "User-Agent": UA,
            "Referer": "https://xiaoya.fifedu.com/",
            "Origin": "https://xiaoya.fifedu.com",
            "authorization": f"Bearer {token}",
            "app-code": "jx-web",
            "x-platform": "web",
            "x-language": "zh-CN",
        }
        school = ck.get("HS-prd-login-schoolId", "")
        if school:
            headers["schoolid"] = school
        return httpx.Client(timeout=25, headers=headers, cookies=ck)

    # ---------- 抓取 ----------

    def fetch_courses(self) -> list[dict]:
        with self._client() as cli:
            r = cli.get(
                f"{API}/jx-iresource/group/student/groups",
                params={"time_flag": 1, "page_num": 1, "page_size": 50},
            )
            r.raise_for_status()
            data = (r.json() or {}).get("data") or {}
        out = []
        for c in data.get("data_list") or []:
            out.append(
                {
                    "id": str(c.get("id")),
                    "name": c.get("site_name") or c.get("name") or "未命名课程",
                }
            )
        return out

    def _node_names(self, cli: httpx.Client, group_id: str) -> dict[str, str]:
        """课程内容树 → {node_id: 名称}，用于给任务补标题。"""
        try:
            r = cli.get(
                f"{API}/jx-iresource/resource/queryCourseResources/v2",
                params={"group_id": group_id},
            )
            data = (r.json() or {}).get("data") or []
        except (httpx.HTTPError, ValueError):
            return {}
        out: dict[str, str] = {}
        stack = list(data) if isinstance(data, list) else []
        while stack:
            node = stack.pop()
            if not isinstance(node, dict):
                continue
            nid, name = node.get("id"), node.get("name")
            if nid and name:
                out[str(nid)] = name
            for child in node.get("children") or []:
                stack.append(child)
        return out

    def fetch_assignments(self, progress=None) -> list[Assignment]:
        courses = self.fetch_courses()
        total = len(courses)
        result: list[Assignment] = []

        with self._client() as cli:
            for idx, course in enumerate(courses):
                if progress:
                    progress(idx, total, course["name"])
                try:
                    nodes = self._node_names(cli, course["id"])
                    r = cli.get(
                        f"{API}/jx-stat/group/task/queryTaskNotices",
                        params={"group_id": course["id"], "role": 1},
                    )
                    data = (r.json() or {}).get("data") or {}
                except (httpx.HTTPError, ValueError):
                    continue

                for t in (data.get("teacher_tasks") or []) + (data.get("student_tasks") or []):
                    node_id = str(t.get("node_id") or "")
                    title = nodes.get(node_id) or f"课程任务（{_type_name(t.get('task_type'))}）"
                    result.append(
                        Assignment(
                            platform="xiaoya",
                            course_name=course["name"],
                            title=title,
                            ddl=_to_iso(t.get("end_time")),
                            status=_status_of(t),
                            url=f"https://xiaoya.fifedu.com/jx-stem/mycourse/{course['id']}/task",
                            source_msg_id=str(t.get("task_id") or t.get("id") or ""),
                            attachments=[],
                        )
                    )

        if progress:
            progress(total, total, "")
        return result


def _status_of(task: dict) -> str:
    finish = task.get("finish")
    if finish in (1, 2):  # 1/2 均表示已提交（实测 2=已提交并批阅）
        return "submitted"
    end = _to_iso(task.get("end_time"))
    if end:
        try:
            if datetime.fromisoformat(end) < datetime.now(CN):
                return "expired"
        except ValueError:
            pass
    return "pending"


def _type_name(t) -> str:
    return {1: "测验", 2: "作业", 3: "讨论", 4: "考试"}.get(t, "任务")


def _to_iso(value) -> str | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt.astimezone(CN).isoformat(timespec="seconds")
