"""学习通考试列表：真实接口 examcode/examlist，返回 HTML 表格。

参考资料（公开项目）：
  DanMo661/Xuexitong-mcp —— 公开了「考试列表 GET .../examcode/examlist」等接口
  Han-maker-wp/chaoxing-mcp —— 学习通 MCP，含考试/通知查询
"""

from __future__ import annotations

import hashlib
import re
from typing import Any

from adapters.chaoxing_notice import _client, _strip_html

EXAM_LIST_URL = "https://mooc1-api.chaoxing.com/exam-ans/exam/test/examcode/examlist"
EXAM_REFERER = "https://mooc1.chaoxing.com/"

_TIME_RANGE = re.compile(
    r"(20\d{2}-\d{1,2}-\d{1,2}\s*\d{1,2}:\d{2})\s*[至到~-]\s*(20\d{2}-\d{1,2}-\d{1,2}\s*\d{1,2}:\d{2})"
)
_DT = re.compile(r"(20\d{2})-(\d{1,2})-(\d{1,2})\s*(\d{1,2}):(\d{2})")


def _iso(dt_text: str) -> str | None:
    m = _DT.search(dt_text or "")
    if not m:
        return None
    y, mo, d, h, mi = (int(x) for x in m.groups())
    return f"{y:04d}-{mo:02d}-{d:02d}T{h:02d}:{mi:02d}:00+08:00"


def _rows(html: str) -> list[list[str]]:
    table = re.search(r"<table.*?</table>", html, re.S)
    if not table:
        return []
    out: list[list[str]] = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", table.group(0), re.S):
        cells = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
        if not cells:
            continue
        out.append([_strip_html(c) for c in cells])
    return out


def _exam_url(html: str) -> str:
    """表格里「查看」按钮的链接（如果有）。"""
    m = re.search(r'href="([^"]*exam[^"]*)"', html)
    if m:
        href = m.group(1)
        if href.startswith("/"):
            return "https://mooc1.chaoxing.com" + href
        if href.startswith("http"):
            return href
    return EXAM_LIST_URL


def fetch_exam_list(cookies: dict[str, str], page_size: int = 100) -> list[dict]:
    """返回 [{"id","title","start","end","duration","status","score","method","url"}]。

    表格列固定为 9 列：编号 / 名称 / 时间 / 时长 / 考试状态 / 作答状态 / 分数 / 方式 / 操作
    """
    with _client(cookies, EXAM_REFERER) as cli:
        resp = cli.get(EXAM_LIST_URL, params={"pageNum": 1, "pageSize": page_size})
        resp.raise_for_status()
        html = resp.text

    url = _exam_url(html)
    out: list[dict] = []
    for cells in _rows(html):
        if len(cells) < 6:
            continue
        joined = " ".join(cells)
        if "考试名称" in joined:
            continue
        name = cells[1].strip()
        if not name or name.isdigit():
            continue

        tr = _TIME_RANGE.search(cells[2] if len(cells) > 2 else joined)
        start = _iso(tr.group(1)) if tr else None
        end = _iso(tr.group(2)) if tr else None
        duration = cells[3].strip() if len(cells) > 3 and cells[3].strip().isdigit() else ""
        status = cells[4].strip() if len(cells) > 4 else ""
        submit = cells[5].strip() if len(cells) > 5 else ""
        score = cells[6].strip() if len(cells) > 6 else ""
        method = cells[7].strip() if len(cells) > 7 else ""

        eid = hashlib.sha1(f"{name}|{start}".encode("utf-8")).hexdigest()[:16]
        out.append(
            {
                "id": eid,
                "title": name,
                "start": start,
                "end": end,
                "duration": duration,
                "status": status,
                "submit": submit,
                "score": score,
                "method": method,
                "url": url,
            }
        )
    return out


def exams_to_rows(exams: list[dict], now_iso: str | None = None) -> list[dict[str, Any]]:
    """只保留「未开始 / 进行中」，转成任务结构。"""
    out: list[dict[str, Any]] = []
    for e in exams:
        if e.get("status") == "已结束":
            continue
        title = f"考试：{e['title']}"[:200]
        note = f"{e.get('start') or ''} 至 {e.get('end') or ''} · 时长 {e.get('duration') or '-'} 分钟"
        out.append(
            {
                "platform": "chaoxing",
                "source_msg_id": f"exam:{e['id']}",
                "title": title,
                "raw_text": f"{e['title']} {note}".strip()[:1000],
                "ddl": e.get("start"),
                "url": e.get("url"),
                "kind": "exam",
            }
        )
    return out
