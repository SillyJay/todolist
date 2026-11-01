"""给学习通适配器追加：收件箱通知 + 考试列表抓取。

放在单独文件里，避免动原来 700 行的 chaoxing.py。
"""

from __future__ import annotations

import json
import re
import time
from typing import Any

import httpx

# 常用 UA，和学习通网页版一致
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0 Safari/537.36"
)

# 收件箱（通知中心）
NOTICE_LIST_URL = "https://notice.chaoxing.com/pc/notice/getNoticeList"
NOTICE_REFERER = "https://notice.chaoxing.com/pc/notice/index"

# 考试：学习通的考试入口有多个域名/路径，按顺序试
EXAM_CANDIDATES = [
    ("https://mooc1-api.chaoxing.com/exam-ans/exam/test/exam-list", "https://mooc1.chaoxing.com/"),
    ("https://mooc1-api.chaoxing.com/mooc-ans/exam/test/exam-list", "https://mooc1.chaoxing.com/"),
    ("https://exm.chaoxing.com/exam-ans/exam/test/exam-list", "https://exm.chaoxing.com/"),
]


def _client(cookies: dict[str, str], referer: str) -> httpx.Client:
    return httpx.Client(
        timeout=20,
        follow_redirects=True,
        headers={"User-Agent": UA, "Referer": referer},
        cookies=cookies,
    )


def _to_iso_seconds(ms: int | None) -> str | None:
    """毫秒时间戳 → ISO（+08:00）。"""
    if not ms:
        return None
    return time.strftime("%Y-%m-%dT%H:%M:%S+08:00", time.localtime(ms / 1000))


def _pick_list(data: Any) -> list[dict]:
    """从各种形状的返回里挖出列表。"""
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    if not isinstance(data, dict):
        return []
    for key in ("notices", "noticeList", "data", "list", "rows", "items", "examList"):
        v = data.get(key)
        if isinstance(v, list):
            return [x for x in v if isinstance(x, dict)]
        if isinstance(v, dict):
            inner = _pick_list(v)
            if inner:
                return inner
    return []


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").replace("&nbsp;", " ").strip()


def _parse_deadline(text: str) -> str | None:
    """从通知正文里找截止时间，返回 ISO 字符串。"""
    t = text or ""
    m = re.search(r"(20\d{2})[-./年](\d{1,2})[-./月](\d{1,2})[日]?\s*(\d{1,2})[:：](\d{2})", t)
    if m:
        y, mo, d, h, mi = (int(x) for x in m.groups())
        return time.strftime(
            "%Y-%m-%dT%H:%M:00+08:00", (y, mo, d, h, mi, 0, 0, 0, 0)
        )
    m = re.search(r"(\d{1,2})月(\d{1,2})日\s*(\d{1,2})[:：](\d{2})", t)
    if m:
        mo, d, h, mi = (int(x) for x in m.groups())
        year = time.localtime().tm_year
        return time.strftime(
            "%Y-%m-%dT%H:%M:00+08:00", (year, mo, d, h, mi, 0, 0, 0, 0)
        )
    m = re.search(r"(20\d{2})[-./年](\d{1,2})[-./月](\d{1,2})", t)
    if m:
        y, mo, d = (int(x) for x in m.groups())
        return time.strftime("%Y-%m-%dT23:59:00+08:00", (y, mo, d, 23, 59, 0, 0, 0, 0))
    return None


def _attachment_list(raw: Any) -> list[dict]:
    """attachment 字段是 JSON 字符串，里面可能挂着作业/考试。"""
    if not raw:
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return []
    if not isinstance(raw, list):
        return []
    return [x for x in raw if isinstance(x, dict)]


def _deadline_from_text(text: str, base_ms: int | None = None) -> str | None:
    """优先找绝对时间；没有就看「还有 N 个小时」。"""
    iso = _parse_deadline(text)
    if iso:
        return iso
    m = re.search(r"还有\s*(\d+)\s*(个)?(小时|天)", text or "")
    if m and base_ms:
        n = int(m.group(1))
        delta = n * 3600 if m.group(3) == "小时" else n * 86400
        ts = base_ms / 1000 + delta
        return time.strftime("%Y-%m-%dT%H:%M:00+08:00", time.localtime(ts))
    return None


def fetch_notices(cookies: dict[str, str], page: int = 1, size: int = 30) -> list[dict]:
    """收件箱：按学习通真实结构解析。

    返回 [{"id","title","content","time","ddl","url","kind","course","raw"}]
    kind: notice / homework / exam
    """
    with _client(cookies, NOTICE_REFERER) as cli:
        resp = cli.get(NOTICE_LIST_URL, params={"pageNum": page, "pageSize": size})
        resp.raise_for_status()
        try:
            data = resp.json()
        except ValueError:
            return []

    out: list[dict] = []
    for raw in _pick_list(data):
        nid = str(raw.get("idCode") or raw.get("id") or "")
        title = _strip_html(str(raw.get("title") or ""))
        content = _strip_html(str(raw.get("content") or raw.get("rtf_content") or ""))
        insert_ms = raw.get("insertTime")
        try:
            insert_ms = int(insert_ms) if insert_ms else None
        except (TypeError, ValueError):
            insert_ms = None
        send_time = str(raw.get("sendTime") or "")

        attachments = _attachment_list(raw.get("attachment"))
        kind = "notice"
        course = ""
        url = ""
        work_id = ""
        work_title = ""
        if attachments:
            att = attachments[0]
            web = att.get("att_web") or {}
            which = str(web.get("examOrWork") or "")
            course = str(web.get("courseName") or att.get("courseName") or "")
            if which == "exam":
                kind = "exam"
            elif which == "work":
                kind = "homework"
            work_title = str(web.get("title") or att.get("title") or "")
            wid = web.get("examOrWorkId")
            work_id = str(wid or "")
            cid = web.get("courseId") or web.get("clazzId")
            if wid and cid:
                if kind == "exam":
                    url = f"https://mooc1.chaoxing.com/mooc-ans/exam/test/reVersionTestStartNew?courseId={cid}&workId={wid}"
                else:
                    url = f"https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?courseId={cid}&workId={wid}"

        if not nid and not title:
            continue

        out.append(
            {
                "id": nid or title[:40],
                "title": title or content[:40],
                "content": content,
                "time": send_time or (_to_iso_seconds(insert_ms) or ""),
                "ddl": _deadline_from_text(f"{title} {content}", insert_ms),
                "url": url or f"https://notice.chaoxing.com/pc/notice/detail?id={nid}",
                "kind": kind,
                "course": course,
                "work_id": work_id,
                "work_title": work_title,
                "raw": raw,
            }
        )
    return out


def fetch_exams(cookies: dict[str, str]) -> tuple[list[dict], str]:
    """考试列表：逐个候选接口试，返回 (列表, 命中的 URL 或错误说明)。"""
    last_err = ""
    for url, referer in EXAM_CANDIDATES:
        try:
            with _client(cookies, referer) as cli:
                resp = cli.get(url, params={"pageNum": 1, "pageSize": 30})
                if resp.status_code != 200:
                    last_err = f"{url} → HTTP {resp.status_code}"
                    continue
                try:
                    data = resp.json()
                except ValueError:
                    last_err = f"{url} → 非 JSON"
                    continue
            items = _pick_list(data)
            if not items:
                last_err = f"{url} → 空列表"
                continue
            out = []
            for raw in items:
                eid = str(raw.get("id") or raw.get("examId") or raw.get("testId") or "")
                title = _strip_html(str(raw.get("name") or raw.get("title") or raw.get("examName") or ""))
                if not title and not eid:
                    continue
                out.append(
                    {
                        "id": eid or title[:40],
                        "title": title or "考试",
                        "content": _strip_html(str(raw.get("description") or raw.get("remark") or "")),
                        "time": str(
                            raw.get("startTime")
                            or raw.get("beginTime")
                            or raw.get("examStartTime")
                            or ""
                        ),
                        "end_time": str(raw.get("endTime") or raw.get("examEndTime") or ""),
                        "course": str(raw.get("courseName") or raw.get("course") or ""),
                        "url": raw.get("url") or referer,
                        "source": "exam",
                        "raw": raw,
                    }
                )
            return out, url
        except Exception as e:  # noqa: BLE001
            last_err = f"{url} → {type(e).__name__}: {e}"
            continue
    return [], last_err or "没有可用的考试接口"
