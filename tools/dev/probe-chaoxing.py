"""探测学习通收件箱 / 考试接口（需要先登录）。

用法：
    python tools/dev/probe-chaoxing.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

import httpx  # noqa: E402

from adapters.chaoxing import ChaoxingAdapter  # noqa: E402
from adapters.chaoxing_notice import (  # noqa: E402
    EXAM_CANDIDATES,
    NOTICE_LIST_URL,
    NOTICE_REFERER,
    UA,
    fetch_exams,
    fetch_notices,
)

CANDIDATES = [
    (NOTICE_LIST_URL, NOTICE_REFERER, {"pageNum": 1, "pageSize": 20}),
    ("https://notice.chaoxing.com/pc/notice/getNoticeCount", NOTICE_REFERER, {}),
    ("https://mooc1-api.chaoxing.com/notice/getNoticeList", "https://mooc1.chaoxing.com/", {"pageNum": 1}),
    ("https://i.chaoxing.com/base", "https://i.chaoxing.com/", {}),
]


def shape(data) -> str:
    if isinstance(data, dict):
        return "dict keys=" + ",".join(list(data.keys())[:8])
    if isinstance(data, list):
        return f"list len={len(data)} first_keys=" + ",".join(list(data[0].keys())[:8]) if data else "list len=0"
    return type(data).__name__


def main() -> None:
    ad = ChaoxingAdapter()
    cookies = ad.load_cookies()
    print("cookie 数:", len(cookies), "| 有 _uid:", bool(cookies.get("_uid")))
    if not cookies.get("_uid"):
        print("❌ 学习通未登录：先在桌面端「设置 → 学习通」登录一次")
        return

    print("\n=== 收件箱候选 ===")
    for url, referer, params in CANDIDATES:
        try:
            with httpx.Client(
                timeout=15,
                follow_redirects=True,
                headers={"User-Agent": UA, "Referer": referer},
                cookies=cookies,
            ) as cli:
                r = cli.get(url, params=params)
            ctype = r.headers.get("content-type", "")
            body = r.text[:180].replace("\n", " ")
            print(f"  [{r.status_code}] {url.split('?')[0]}")
            print(f"        {ctype} | {body}")
        except Exception as e:  # noqa: BLE001
            print(f"  [ERR] {url.split('?')[0]} → {type(e).__name__}: {e}")

    print("\n=== 用封装函数取通知 ===")
    try:
        notices = fetch_notices(cookies)
        print(f"  拿到 {len(notices)} 条")
        for n in notices[:3]:
            print("   -", n["id"], n["title"][:40], "|", n["time"])
    except Exception as e:  # noqa: BLE001
        print("  失败:", type(e).__name__, e)

    print("\n=== 考试候选 ===")
    for url, referer in EXAM_CANDIDATES:
        try:
            with httpx.Client(
                timeout=15,
                follow_redirects=True,
                headers={"User-Agent": UA, "Referer": referer},
                cookies=cookies,
            ) as cli:
                r = cli.get(url, params={"pageNum": 1, "pageSize": 20})
            print(f"  [{r.status_code}] {url}")
            print("        " + r.text[:160].replace("\n", " "))
        except Exception as e:  # noqa: BLE001
            print(f"  [ERR] {url} → {type(e).__name__}: {e}")

    exams, hint = fetch_exams(cookies)
    print(f"\n考试解析：{len(exams)} 条 | 命中：{hint}")
    for e in exams[:3]:
        print("   -", json.dumps(e, ensure_ascii=False)[:160])


if __name__ == "__main__":
    main()
