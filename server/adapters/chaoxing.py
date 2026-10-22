"""学习通 Adapter（规格 §5 模块 2）。

设计：
- 登录：passport2.chaoxing.com/fanyalogin（表单登录），Cookie 落盘持久化
- 抓取：优先 HTTP 接口，接口失效时回退 Playwright 浏览器抓取（规格允许的兜底）
- ⚠️ 红线：只读数据。绝不包含任务点完成/刷课/答题/提交作业代码。

状态：登录与 Cookie 持久化已完成；作业列表的返回结构需真实账号联调确认。
"""
import json
import os
import re
import time
from datetime import datetime, timedelta
from typing import Any

import httpx

from adapters.base import Assignment, Attachment, BaseAdapter
from config import data_dir

LOGIN_URL = "https://passport2.chaoxing.com/fanyalogin"
COURSE_LIST_URL = "https://mooc1-api.chaoxing.com/mycourse/backclazzdata?view=json"
WORK_LIST_URL = "https://mooc1-api.chaoxing.com/work/getAllWork"
HOME_URL = "https://i.chaoxing.com"
SCHEDULE_URL = "https://kb.chaoxing.com/pc/curriculum/getMyLessons"

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



    # ---------- 课表 ----------

    def fetch_schedule_semester(self, progress: Any = None) -> dict:
        """拉取整学期课表。

        实测（2026-10）：`getMyLessons` 支持 `?week=N`，逐周请求即可拼出全学期；
        单次约 0.3s，25 周总共 8 秒左右。
        """
        with httpx.Client(
            timeout=25,
            headers={
                "User-Agent": UA,
                "Referer": "https://kb.chaoxing.com/res/pc/curriculum/schedule.html",
            },
            cookies=self.load_cookies(),
        ) as cli:
            first = cli.get(SCHEDULE_URL, params={"week": 1})
            data = first.json().get("data") or {}
            cur = data.get("curriculum") or {}
            cfg = cur.get("lessonTimeConfigArray") or []
            current_week = int(cur.get("currentWeek") or 0)
            max_week = int(cur.get("maxWeek") or cur.get("existMaxLength") or 18)
            first_week_date = cur.get("firstWeekDateReal") or cur.get("firstWeekDate")

            slots: dict[tuple, set[int]] = {}
            for week in range(1, max_week + 1):
                if progress:
                    progress(week, max_week, f"第 {week} 周")
                try:
                    if week == 1:
                        lessons = data.get("lessonArray") or []
                    else:
                        lessons = (
                            cli.get(SCHEDULE_URL, params={"week": week})
                            .json()
                            .get("data", {})
                            .get("lessonArray")
                            or []
                        )
                except (httpx.HTTPError, ValueError):
                    continue

                # 同一周内先合并连续节次
                blocks = _merge_sections(lessons)
                for b in blocks:
                    key = (b["weekday"], b["name"], b["location"], b["begin"], b["length"])
                    slots.setdefault(key, set()).add(week)

        merged = [
            {
                "weekday": k[0],
                "name": k[1],
                "location": k[2],
                "begin": k[3],
                "length": k[4],
                "weeks": _compress_weeks(sorted(v)),
                "teacher": "",
            }
            for k, v in slots.items()
        ]

        for m in merged:
            start_i = m["begin"] - 1
            end_i = m["begin"] + m["length"] - 2
            m["start_time"] = cfg[start_i].split("-")[0] if 0 <= start_i < len(cfg) else None
            m["end_time"] = cfg[end_i].split("-")[1] if 0 <= end_i < len(cfg) else None

        return {
            "current_week": current_week,
            "max_week": max_week,
            "first_week_date": first_week_date,
            "school_year": cur.get("schoolYear"),
            "semester": cur.get("semester"),
            "lessons": merged,
        }

    def fetch_schedule(self) -> dict:
        """拉取本学期课表（实测 2026-10：kb.chaoxing.com/pc/curriculum/getMyLessons）。

        返回 {"current_week": int, "lessons": [{name, location, teacher, weekday,
              begin, length, weeks, start_time, end_time}]}
        同一门课连续节次会合并成一个时段（如 1-2 节）。
        """
        with httpx.Client(
            timeout=25,
            headers={
                "User-Agent": UA,
                "Referer": "https://kb.chaoxing.com/res/pc/curriculum/schedule.html",
            },
            cookies=self.load_cookies(),
        ) as cli:
            resp = cli.get(SCHEDULE_URL, params={"curTime": int(time.time() * 1000)})
            resp.raise_for_status()
            data = resp.json().get("data") or {}

        cur = data.get("curriculum") or {}
        cfg = cur.get("lessonTimeConfigArray") or []
        current_week = cur.get("currentWeek") or 0

        raw = data.get("lessonArray") or []
        # 按 星期+课程名+地点+周次 分组后合并连续节次
        raw.sort(key=lambda x: (x.get("dayOfWeek") or 0, x.get("beginNumber") or 0))
        merged: list[dict] = []
        for item in raw:
            name = item.get("name") or item.get("displayCourseName") or "未命名课程"
            loc = item.get("location") or item.get("onlineLocation") or ""
            begin = int(item.get("beginNumber") or 1)
            length = int(item.get("length") or 1)
            weekday = int(item.get("dayOfWeek") or 0)
            weeks = str(item.get("weeks") or "")

            if merged:
                last = merged[-1]
                if (
                    last["weekday"] == weekday
                    and last["name"] == name
                    and last["location"] == loc
                    and last["weeks"] == weeks
                    and begin == last["begin"] + last["length"]
                ):
                    last["length"] += length
                    continue

            merged.append(
                {
                    "name": name,
                    "location": loc,
                    "teacher": item.get("teacherName") or "",
                    "weekday": weekday,
                    "begin": begin,
                    "length": length,
                    "weeks": weeks,
                }
            )

        # 节次 → 具体时间
        for m in merged:
            start_i = m["begin"] - 1
            end_i = m["begin"] + m["length"] - 2
            if 0 <= start_i < len(cfg):
                m["start_time"] = cfg[start_i].split("-")[0]
            else:
                m["start_time"] = None
            if 0 <= end_i < len(cfg):
                m["end_time"] = cfg[end_i].split("-")[1]
            else:
                m["end_time"] = None

        return {"current_week": current_week, "lessons": merged}

    # ---------- 作业附件 ----------

    STATUS_URL = "https://mooc1.chaoxing.com/ananas/status/{objectid}"

    def fetch_attachments(self, task_url: str) -> list[dict]:
        """解析作业详情页，返回可下载的附件列表。

        实测（2026-10）两类来源：
        1. 云盘附件：`<iframe module="insertAttach" objectid="..." filename="..."
           filetype="zip" filesize="336.24K">` —— objectid 是取文件的钥匙
        2. 正文图片：`<img src="https://p.ananas.chaoxing.com/star3/origin/xxx.png">`

        返回 [{key, name, size, kind, url}]，key 对云附件是 objectid，对图片是原始 URL。
        """
        if not task_url:
            return []
        with httpx.Client(
            timeout=25,
            follow_redirects=True,
            headers={"User-Agent": UA, "Referer": "https://mooc1.chaoxing.com/"},
            cookies=self.load_cookies(),
        ) as cli:
            resp = cli.get(task_url)
            resp.raise_for_status()
            html = resp.text

        items: list[dict] = []
        seen: set[str] = set()

        # 1) 云盘附件
        for m in re.finditer(r"""<iframe[^>]*module=["']insertAttach["'][^>]*>""", html, re.I):
            tag = m.group(0)
            oid = _attr(tag, "objectid")
            if not oid or oid in seen:
                continue
            seen.add(oid)
            name = _attr(tag, "filename") or f"{oid[:8]}.bin"
            size_text = _attr(tag, "filesize") or ""
            items.append(
                {
                    "key": oid,
                    "name": _unescape(name),
                    "size": _parse_size(size_text),
                    "size_text": size_text,
                    "kind": "file",
                    "ext": (_attr(tag, "filetype") or "").lower(),
                    "url": f"chaoxing://object/{oid}",
                }
            )

        # 2) 正文图片（跳过图标/表情）
        for m in re.finditer(r'<img[^>]+src="(https?://p\.ananas\.chaoxing\.com/[^"]+)"', html, re.I):
            url = m.group(1)
            if url in seen:
                continue
            seen.add(url)
            fname = url.split("?")[0].rsplit("/", 1)[-1] or "图片.png"
            items.append(
                {
                    "key": url,
                    "name": fname,
                    "size": 0,
                    "size_text": "",
                    "kind": "image",
                    "ext": fname.rsplit(".", 1)[-1].lower() if "." in fname else "png",
                    "url": url,
                }
            )

        return items

    def resolve_download_url(self, objectid: str) -> dict:
        """objectid → 真实下载地址（含临时签名）。

        实测：`/ananas/status/{objectid}` 返回
        {"download": "http://d0.cldisk.com/download/<oid>?at_=..&ak_=..&ad_=..",
         "filename": "陈永杰.zip", "length": 344310, "crc": "..."}
        签名带时效，必须现取现下，不能缓存复用。
        """
        with httpx.Client(
            timeout=25,
            headers={"User-Agent": UA, "Referer": "https://mooc1.chaoxing.com/"},
            cookies=self.load_cookies(),
        ) as cli:
            resp = cli.get(self.STATUS_URL.format(objectid=objectid))
            resp.raise_for_status()
            if "json" not in (resp.headers.get("content-type") or ""):
                raise ValueError("取下载地址失败（可能登录态失效）")
            return resp.json()

    def download_attachment(self, item: dict) -> tuple[bytes, str]:
        """下载单个附件，返回 (内容, 文件名)。"""
        headers = {"User-Agent": UA, "Referer": "https://mooc1.chaoxing.com/"}
        with httpx.Client(timeout=90, follow_redirects=True, headers=headers,
                          cookies=self.load_cookies()) as cli:
            if item.get("kind") == "image":
                resp = cli.get(item["url"])
                resp.raise_for_status()
                name = item.get("name") or "图片.png"
                return resp.content, name

            meta = self.resolve_download_url(item["key"])
            url = meta.get("download")
            if not url:
                raise ValueError("该附件没有可用的下载地址")
            resp = cli.get(url, timeout=120)
            resp.raise_for_status()
            name = meta.get("filename") or item.get("name") or "附件"
            return resp.content, name

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

    def fetch_assignments(self, progress: Any = None) -> list[Assignment]:
        """拉取全部课程的作业列表。

        实测结论（2026-10）：作业模块是独立页面 `mooc1.chaoxing.com/mooc2/work/list`，
        需要 cpi + stuenc（由课程页 JS 生成），纯 HTTP 会被 3004 拦掉。
        因此走 Playwright + 本机 Edge 内核，点击「作业」标签后读 iframe 内容。
        progress(done, total, course_name) 用于回传进度。
        """
        courses = [c for c in self.fetch_courses() if c.get("course_id") and c.get("class_id")]
        total = len(courses)

        from playwright.sync_api import sync_playwright

        result: list[Assignment] = []
        cookies = self.load_cookies()

        with sync_playwright() as p:
            browser = p.chromium.launch(channel="msedge", headless=True, args=["--no-sandbox"])
            ctx = browser.new_context()
            ctx.add_cookies(
                [{"name": k, "value": v, "domain": ".chaoxing.com", "path": "/"} for k, v in cookies.items()]
            )
            page = ctx.new_page()
            try:
                page.goto("https://i.chaoxing.com", wait_until="domcontentloaded", timeout=45000)
                for idx, course in enumerate(courses):
                    if progress:
                        progress(idx, total, course["name"])
                    try:
                        result.extend(self._fetch_course_works_browser(page, course))
                    except Exception:  # noqa: BLE001 - 单课失败不影响整体
                        continue
            finally:
                browser.close()

        if progress:
            progress(total, total, "")
        return result

    def _fetch_course_works_browser(self, page: Any, course: dict) -> list[Assignment]:
        """在浏览器里打开课程 → 点作业 → 解析 iframe 列表。"""
        page.goto(
            "https://mooc1.chaoxing.com/mooc-ans/visit/stucoursemiddle"
            f"?courseid={course['course_id']}&clazzid={course['class_id']}&vc=1&ismooc2=1&v=2",
            wait_until="domcontentloaded",
            timeout=40000,
        )
        page.wait_for_timeout(1200)
        page.get_by_text("作业", exact=True).first.click(timeout=6000)
        page.wait_for_timeout(2200)

        frames = [f for f in page.frames if "work/list" in f.url]
        if not frames:
            return []
        html = frames[0].content()
        return _parse_work_list(html, course["name"])

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




def _attr(tag: str, name: str) -> str:
    """从 HTML 标签字符串里取属性值（兼容单双引号）。"""
    m = re.search(rf'{name}\s*=\s*"([^"]*)"', tag, re.I) or re.search(
        rf"{name}\s*=\s*'([^']*)'", tag, re.I
    )
    return m.group(1) if m else ""


def _unescape(text: str) -> str:
    import html as _html

    return _html.unescape(text or "")


def _parse_size(text: str) -> int:
    """'336.24K' / '14.81M' → 字节数；解析不了返回 0。"""
    t = (text or "").strip().upper().replace("B", "")
    if not t:
        return 0
    unit = t[-1] if t[-1] in "KMG" else ""
    num = t[:-1] if unit else t
    try:
        value = float(num)
    except ValueError:
        return 0
    return int(value * {"": 1, "K": 1024, "M": 1024**2, "G": 1024**3}[unit])


def _merge_sections(lessons: list[dict]) -> list[dict]:
    """同一周内把连续节次合并（如 1 节 + 2 节 → 1 节起、长度 2）。"""
    out: list[dict] = []
    for item in sorted(lessons, key=lambda x: (x.get("dayOfWeek") or 0, x.get("beginNumber") or 0)):
        name = item.get("name") or item.get("displayCourseName") or "未命名课程"
        loc = item.get("location") or item.get("onlineLocation") or ""
        begin = int(item.get("beginNumber") or 1)
        length = int(item.get("length") or 1)
        weekday = int(item.get("dayOfWeek") or 0)
        if out:
            last = out[-1]
            if (
                last["weekday"] == weekday
                and last["name"] == name
                and last["location"] == loc
                and begin == last["begin"] + last["length"]
            ):
                last["length"] += length
                continue
        out.append(
            {
                "name": name,
                "location": loc,
                "weekday": weekday,
                "begin": begin,
                "length": length,
            }
        )
    return out


def _compress_weeks(weeks: list[int]) -> str:
    """[1,2,3,5] → '1-3,5'"""
    if not weeks:
        return ""
    parts, start, prev = [], weeks[0], weeks[0]
    for w in weeks[1:]:
        if w == prev + 1:
            prev = w
            continue
        parts.append(f"{start}-{prev}" if prev > start else str(start))
        start = prev = w
    parts.append(f"{start}-{prev}" if prev > start else str(start))
    return ",".join(parts)


def _parse_work_list(html: str, course_name: str) -> list[Assignment]:
    """解析作业列表 iframe 的 HTML（2026-10 实测结构）。

    <li onclick="goTask(this);" data="<url>" aria-label="标题 ; 状态">
      <p class="overHidden2 fl">标题</p>
      <p class="status fl">未交</p>
      <div class="time notOver">剩余220小时20分钟</div>
    </li>
    """
    out: list[Assignment] = []
    blocks = re.findall(r'<li[^>]*onclick="goTask\(this\);"[^>]*>(.*?)</li>', html, re.S)
    urls = re.findall(r'<li[^>]*onclick="goTask\(this\);"[^>]*data="([^"]+)"', html)

    for html_block, url in zip(blocks, urls):
        clean_url = url.replace("&amp;", "&")
        title_m = re.search(r'<p class="overHidden2[^"]*"[^>]*>(.*?)</p>', html_block, re.S)
        status_m = re.search(r'<p class="status[^"]*"[^>]*>(.*?)</p>', html_block, re.S)
        time_m = re.search(r'<div class="time[^"]*"[^>]*>(.*?)</div>', html_block, re.S)

        title = _strip_tags(title_m.group(1)) if title_m else "未命名作业"
        status_text = _strip_tags(status_m.group(1)) if status_m else ""
        time_text = _strip_tags(time_m.group(1)) if time_m else ""

        work_id = ""
        q = re.search(r"[?&]workId=(\d+)", clean_url)
        if q:
            work_id = q.group(1)

        out.append(
            Assignment(
                platform="chaoxing",
                course_name=course_name,
                title=title,
                ddl=_ddl_from_remaining(time_text),
                status=(
                    "submitted"
                    if ("已完成" in status_text or "已交" in status_text)
                    else "expired"
                    if ("过期" in time_text or "已结束" in time_text or "过期" in status_text)
                    else "pending"
                ),
                url=clean_url,
                source_msg_id=work_id or title,
                attachments=[],
            )
        )
    return out


def _strip_tags(s: str) -> str:
    return re.sub(r"<[^>]+>", "", s or "").replace("&nbsp;", " ").strip()


def _ddl_from_remaining(text: str) -> str | None:
    """把「剩余220小时20分钟」换算成绝对时间（相对当前时刻）。"""
    if not text:
        return None
    h = re.search(r"(\d+)\s*小时", text)
    m = re.search(r"(\d+)\s*分钟", text)
    d = re.search(r"(\d+)\s*天", text)
    if not (h or m or d):
        return None
    delta = timedelta(
        days=int(d.group(1)) if d else 0,
        hours=int(h.group(1)) if h else 0,
        minutes=int(m.group(1)) if m else 0,
    )
    return (datetime.now().astimezone() + delta).isoformat(timespec="seconds")


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
