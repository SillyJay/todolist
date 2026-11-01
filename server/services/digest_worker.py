"""后台摘要队列：把「AI 归纳」从页面请求里挪走。

为什么要有它：
- 免费额度有频率限制（实测 glm-4.7 连续调用会 429）。
- 页面一次要几十条，同步等会卡住；并发又会把配额打光。
- 所以做成单线程队列：一次一条、间隔几秒、遇到 429 就退避重试，
  前端只负责「排进去 + 轮询看结果」。

只接受 AI 的结果（src == "ai"）；AI 不可用时**不写**降级文本，
避免把「第一句话」当成摘要展示，让人误以为已经归纳过了。
"""

from __future__ import annotations

import logging
import queue
import threading
import time

log = logging.getLogger("campus.digest")

_q: "queue.Queue[int]" = queue.Queue()
_seen: set[int] = set()
_lock = threading.Lock()
_started = False

INTERVAL = 3.0        # 每批之间间隔（秒）
BATCH = 6             # 一次请求处理多少条
MAX_ATTEMPTS = 3      # 单条最多尝试次数
BACKOFF = [8, 20, 45]  # 429 时的退避节奏


def _worker() -> None:
    from db.database import SessionLocal
    from db.models import WeChatMessage
    from services.message_digest import digest_many

    while True:
        # 一次凑一批（最多 BATCH 条），一条请求解决，省配额
        batch: list[int] = []
        while len(batch) < BATCH:
            try:
                batch.append(_q.get_nowait())
            except queue.Empty:
                break
        if not batch:
            batch = [_q.get()]  # 队列空就阻塞等一条

        attempts = 0
        done = False
        while attempts < MAX_ATTEMPTS and not done:
            attempts += 1
            db = SessionLocal()
            try:
                rows = (
                    db.query(WeChatMessage)
                    .filter(WeChatMessage.id.in_(batch))
                    .filter((WeChatMessage.digest.is_(None)) | (WeChatMessage.digest_src != "ai"))
                    .all()
                )
                if not rows:
                    done = True
                    break

                got = digest_many([(m.id, m.text or "") for m in rows])
                if not got:
                    log.info("批量摘要无返回（第 %s 次），退避后重试", attempts)
                    time.sleep(BACKOFF[min(attempts - 1, len(BACKOFF) - 1)])
                    continue

                for m in rows:
                    if m.id not in got:
                        continue
                    m.digest = got[m.id]
                    m.digest_src = "ai"
                    # 顺手让 AI 定分类/重要性，省一次独立调用
                    try:
                        from services.ai_classify import _call_batch

                        res = _call_batch(db, [m])
                        hit = res.get(m.id)
                        if hit:
                            m.category = hit["category"]
                            m.action = hit["action"]
                            m.importance = hit["importance"]
                            m.reason = hit["reason"] or m.reason
                            m.classify_src = "ai"
                    except Exception:  # noqa: BLE001
                        m.classify_src = m.classify_src or "rule"

                db.commit()
                log.info("批量摘要完成 %s/%s 条", len(got), len(rows))
                done = True
            except Exception as e:  # noqa: BLE001
                log.warning("批量摘要异常：%s", e)
                time.sleep(BACKOFF[min(attempts - 1, len(BACKOFF) - 1)])
            finally:
                db.close()

        exactly_done = done
        with _lock:
            for mid in batch:
                _seen.discard(mid)

        if not exactly_done:
            # 重试也没成功（通常是额度用完）→ 等一会再放回队列，
            # 不能把消息丢掉，否则用户切了服务商也补不回来。
            log.warning("摘要批次失败 %s 条，5 分钟后重试", len(batch))
            time.sleep(300)
            enqueue(batch)
            continue

        time.sleep(INTERVAL)


def ensure_worker() -> None:
    global _started
    if _started:
        return
    _started = True
    threading.Thread(target=_worker, name="digest-worker", daemon=True).start()
    log.info("摘要队列已启动")


def enqueue(ids: list[int]) -> int:
    """把缺摘要的消息排进队列，返回新加入的条数。"""
    ensure_worker()
    added = 0
    with _lock:
        for mid in ids:
            if mid in _seen:
                continue
            _seen.add(mid)
            _q.put(mid)
            added += 1
    return added


def pending() -> int:
    return _q.qsize()
