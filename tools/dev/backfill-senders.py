"""12 微信发送者补全：文本匹配 + 时间就近匹配 + 翻页。

用法：python tools/dev/backfill-senders.py [--dry-run]
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "server"))

from db.database import SessionLocal  # noqa: E402
from db.models import WeChatMessage  # noqa: E402

CLI = Path(r"D:\projects\campus-assistant-merged\server\dist\backend\bin\wechat-cli\wechat-cli.exe")
LINE_RE = re.compile(r"^\[(?P<time>[^\]]+)\]\s*(?P<sender>[^:：]{1,40})[:：]\s*(?P<text>.*)$", re.S)
LEAD_JUNK = re.compile(r"^(?:[-=+*()\[\]{}<>\w]{0,6}[:：]\s*)+")


def norm(text: str) -> str:
    t = (text or "").strip()
    t = LEAD_JUNK.sub("", t)
    return re.sub(r"\s+", "", t)[:60]


def parse_time(value: str) -> datetime | None:
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M"):
        try:
            return datetime.strptime((value or "").strip()[:19], fmt)
        except ValueError:
            continue
    return None


def fetch_pages(group: str, pages: int = 3, size: int = 500) -> list[dict]:
    rows: list[dict] = []
    for i in range(pages):
        try:
            out = subprocess.run(
                [str(CLI), "history", group, "--limit", str(size), "--offset", str(i * size)],
                capture_output=True,
                timeout=180,
                encoding="utf-8",
                errors="ignore",
            )
        except Exception as e:  # noqa: BLE001
            print(f"  [{group}] 第 {i + 1} 页失败：{type(e).__name__}")
            break
        if out.returncode != 0:
            break
        try:
            data = json.loads(out.stdout)
        except json.JSONDecodeError:
            break
        msgs = data.get("messages") or []
        if not msgs:
            break
        for line in msgs:
            m = LINE_RE.match(line)
            if not m:
                continue
            rows.append(
                {
                    "time": m.group("time").strip(),
                    "sender": m.group("sender").strip(),
                    "text": m.group("text").strip(),
                }
            )
    return rows


def main() -> None:
    dry = "--dry-run" in sys.argv
    db = SessionLocal()

    groups = [
        g[0]
        for g in db.query(WeChatMessage.group_name)
        .filter((WeChatMessage.sender.is_(None)) | (WeChatMessage.sender == ""))
        .distinct()
        .all()
        if g[0]
    ]
    print(f"待补全的群：{len(groups)} 个")

    total = 0
    for group in groups:
        rows = fetch_pages(group)
        if not rows:
            continue

        by_text = {norm(r["text"]): r["sender"] for r in rows if r["sender"]}
        by_time = [
            (parse_time(r["time"]), r["sender"]) for r in rows if r["sender"] and parse_time(r["time"])
        ]

        pending = (
            db.query(WeChatMessage)
            .filter(
                WeChatMessage.group_name == group,
                (WeChatMessage.sender.is_(None)) | (WeChatMessage.sender == ""),
            )
            .all()
        )

        hit_text = hit_time = 0
        for msg in pending:
            sender = by_text.get(norm(msg.text or ""))
            if sender:
                hit_text += 1
            else:
                stamp = parse_time(msg.sent_at or msg.created_at or "")
                if stamp:
                    best = None
                    for t, name in by_time:
                        delta = abs((t - stamp).total_seconds())
                        if delta <= 180 and (best is None or delta < best[0]):
                            best = (delta, name)
                    if best:
                        sender = best[1]
                        hit_time += 1
            if sender:
                msg.sender = sender[:40]

        total += hit_text + hit_time
        print(
            f"  [{group}] 历史 {len(rows)} 条 → 文本命中 {hit_text}，时间命中 {hit_time}，待补 {len(pending)}"
        )
        if not dry:
            db.commit()

    if dry:
        db.rollback()
        print(f"dry-run：可补 {total} 条（未写入）")
    else:
        print(f"完成：补上 {total} 条")
    db.close()


if __name__ == "__main__":
    main()
