"""重新分类已有的微信消息（改了分类规则后跑一次）。

用法：
    python tools/dev/reclassify.py            # 只统计，不改
    python tools/dev/reclassify.py --apply    # 真的写库
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from datetime import datetime  # noqa: E402

from db.database import SessionLocal, init_db  # noqa: E402
from db.models import Setting, WeChatMessage  # noqa: E402
from services.message_classify import analyze, load_profile  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="写回数据库")
    args = ap.parse_args()

    init_db()
    db = SessionLocal()
    profile = load_profile(db)

    rows = db.query(WeChatMessage).all()
    changed = []
    now = datetime.now().astimezone().isoformat(timespec="seconds")

    for m in rows:
        result = analyze(m.text or "", m.group_name or "", profile)
        if result["category"] != (m.category or "misc") or result["relevance"] != (m.relevance or 0):
            changed.append((m, result))

    print(f"共 {len(rows)} 条，需要改 {len(changed)} 条")
    for m, r in changed[:25]:
        print(f"  #{m.id} {(m.text or '')[:36]!r}: {m.category}({m.relevance}) → {r['category']}({r['relevance']})")
    if len(changed) > 25:
        print(f"  …还有 {len(changed) - 25} 条")

    if args.apply:
        for m, r in changed:
            m.category = r["category"]
            m.relevance = r["relevance"]
            m.reason = "; ".join(r["reasons"])[:400]
            m.needs_action = 1 if r["needs_action"] else 0
            m.updated_at = now
        db.commit()
        print(f"已写回 {len(changed)} 条")
    else:
        print("（未写库，加 --apply 生效）")

    db.close()


if __name__ == "__main__":
    main()
