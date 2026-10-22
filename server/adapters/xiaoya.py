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

    # ---------- 课程文件（附件）----------

    def list_course_files(self, group_id: str, title: str | None = None) -> list[dict]:
        """课程内容树里可下载的文件（type=6）。

        实测（2026-10）：`queryCourseResources/v2` 返回扁平节点列表，
        type=1 是目录、type=7 是作业节点、**type=6 才是文件**，且带 resource_id。
        文件的归属目录可从 parent_id 链还原。

        title 传入时（如「实验3 回归分析」），只取同名目录子树下的文件。
        """
        with self._client() as cli:
            r = cli.get(
                f"{API}/jx-iresource/resource/queryCourseResources/v2",
                params={"group_id": group_id},
            )
            r.raise_for_status()
            nodes = (r.json() or {}).get("data") or []
        if not isinstance(nodes, list):
            return []

        by_id = {str(n.get("id")): n for n in nodes if isinstance(n, dict)}
        children: dict[str, list[dict]] = {}
        for n in nodes:
            if isinstance(n, dict):
                children.setdefault(str(n.get("parent_id")), []).append(n)

        def dir_path(node_id: str) -> str:
            parts, cur, guard = [], by_id.get(node_id), 0
            while cur and guard < 8:
                parts.append(str(cur.get("name") or ""))
                cur = by_id.get(str(cur.get("parent_id")))
                guard += 1
            return " / ".join(reversed([p for p in parts if p and p != "root"]))

        def collect(node: dict) -> list[dict]:
            out: list[dict] = []
            stack = [node]
            while stack:
                cur = stack.pop()
                if str(cur.get("type")) == "6" and cur.get("resource_id"):
                    out.append(cur)
                for child in children.get(str(cur.get("id")), []):
                    if str(child.get("id")) != str(cur.get("id")):  # 防自引用
                        stack.append(child)
            return out

        picked: list[dict] = []
        if title:
            want = title.strip()
            cands = [
                n
                for n in nodes
                if isinstance(n, dict) and str(n.get("name") or "").strip() == want
            ]
            if not cands:
                # 模糊匹配：作业标题和目录名常有前后缀差异（如「实验3 回归分析（第7周）」）
                cands = [
                    n
                    for n in nodes
                    if isinstance(n, dict)
                    and str(n.get("type")) == "1"
                    and (
                        want in str(n.get("name") or "")
                        or str(n.get("name") or "") in want
                    )
                    and len(str(n.get("name") or "")) >= 4
                ]
                cands.sort(key=lambda n: -len(str(n.get("name") or "")))
            else:
                # 优先取目录节点（type=1），再退回任意匹配
                cands.sort(key=lambda n: 0 if str(n.get("type")) == "1" else 1)

            for cand in cands[:2]:
                picked = collect(cand)
                if picked:
                    break

        if not picked and not title:
            # 没给标题（如按课程浏览）才返回整个课程的文件
            picked = [n for n in nodes if isinstance(n, dict) and str(n.get("type")) == "6" and n.get("resource_id")]

        out: list[dict] = []
        seen: set[str] = set()
        for n in picked:
            rid = str(n.get("resource_id"))
            if rid in seen:
                continue
            seen.add(rid)
            name = str(n.get("name") or f"{rid[:8]}.bin")
            out.append(
                {
                    "key": rid,
                    "node_id": str(n.get("id")),
                    "name": name,
                    "size": 0,
                    "size_text": "",
                    "kind": "file",
                    "ext": name.rsplit(".", 1)[-1].lower() if "." in name else "",
                    "dir": dir_path(str(n.get("parent_id"))),
                }
            )
        return out

    def download_course_files(self, group_id: str, items: list[dict], out_dir: str) -> list[dict]:
        """用浏览器逐个触发「下载」菜单并保存。

        为什么不用纯 HTTP：`/cloud/file_down/resource_id/{rid}` 返回的是**加密字符串**
        （不是 302），解密在前端 JS 里；而点「下载」菜单时浏览器拿到的才是
        OSS 签名直链（带 Expires/Signature，且时效很短）。
        这里只驱动 UI 点击下载菜单，不做任何提交类操作。
        """
        import os as _os

        if not items:
            return []

        ck = self.load_cookies()
        _os.makedirs(out_dir, exist_ok=True)
        results: list[dict] = []

        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            raise RuntimeError("缺少 playwright，无法下载小雅文件")

        url = f"https://xiaoya.fifedu.com/jx-stem/mycourse/{group_id}/resource"
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="msedge", headless=True, args=["--no-sandbox"])
            ctx = browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1440, "height": 900},
                accept_downloads=True,
            )
            ctx.add_cookies(
                [{"name": k, "value": v, "domain": ".fifedu.com", "path": "/"} for k, v in ck.items()]
            )
            page = ctx.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
            page.wait_for_timeout(5000)

            try:
                for item in items:
                    name = item.get("name") or ""
                    try:
                        # 先按目录路径逐级展开
                        for seg in [x for x in (item.get("dir") or "").split(" / ") if x][:4]:
                            try:
                                page.get_by_text(seg, exact=True).first.click(timeout=3500)
                                page.wait_for_timeout(1200)
                            except Exception:  # noqa: BLE001 - 目录可能已展开
                                pass

                        node = page.locator(f'.mixed-tree-node[data-node-id="{item.get("node_id")}"]')
                        if node.count() == 0:
                            node = page.locator(".mixed-tree-node").filter(has_text=name[:30])
                        if node.count() == 0:
                            results.append({"name": name, "error": "页面里没找到该文件"})
                            continue

                        box = node.first
                        box.hover(timeout=8000)
                        page.wait_for_timeout(600)
                        box.locator(".mixed-tree-node__action-btn").first.click(timeout=8000)

                        entry = page.locator("li.ant-menu-item:visible", has_text="下载").first
                        entry.wait_for(state="visible", timeout=6000)
                        with page.expect_download(timeout=60000) as dl:
                            entry.click()
                        download = dl.value
                        target = _os.path.join(out_dir, download.suggested_filename)
                        download.save_as(target)
                        results.append({"name": download.suggested_filename, "path": target})
                        try:
                            page.keyboard.press("Escape")
                        except Exception:  # noqa: BLE001
                            pass
                    except Exception as e:  # noqa: BLE001
                        results.append({"name": name, "error": str(e)[:110]})
            finally:
                browser.close()

        return results

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
