"""AI 分类：把「要不要打扰我」交给模型判断，规则只做预筛和兜底。

设计参考（公开项目）：
- deskbtm/nitmgpt：规则预筛 + AI 判定 + 本地留存
- ridhorezkyanwar/whatsapp-notification-router：三档路由 notify/digest/mute、
  严格 JSON 枚举、429 重试、失败不覆盖旧结果
- SWSP-Git/messageAIHelper：重要性高/中/低，默认只显示中高
"""

from __future__ import annotations

import time
from datetime import datetime

from ai import llm

# 分类（与前端筛选栏一致）
CATEGORIES = [
    "competition",
    "homework",
    "lecture",
    "admin",
    "recruit",
    "chitchat",
    "misc",
    "file",
]

CATEGORY_LABEL = {
    "competition": "比赛竞赛",
    "homework": "作业考试",
    "lecture": "讲座活动",
    "admin": "通知安排",
    "recruit": "招募招新",
    "chitchat": "闲聊灌水",
    "misc": "其他",
    "file": "文件资料",
}

# 三档路由：要不要现在提醒
ACTIONS = ["notify", "digest", "mute"]
# 重要性：高 / 中 / 低
IMPORTANCE = ["high", "medium", "low"]

BATCH = 15
MAX_RETRY = 3
RETRY_SLEEP = [5, 15, 40]

SYSTEM = """你在帮一个大学生筛选微信群消息。用户只关心「需要我做事」的消息。

对每条消息输出：
- category：从 competition/homework/lecture/admin/recruit/chitchat/misc/file 里选一个
  · competition 比赛竞赛：竞赛报名、初赛复赛决赛、组队参赛
  · homework 作业考试：作业截止、实验报告、考试、提交要求
  · lecture 讲座活动：讲座、宣讲会、社团活动、晚会
  · admin 通知安排：调课停课、请假、表格填写、领取、会议、班务
  · recruit 招募招新：招新、面试、干事招募
  · chitchat 闲聊灌水：聊天、吐槽、约饭、表情包、技术讨论、个人感慨
  · file 文件资料：群里发的文件/附件本身（不是通知）
  · misc 其他：无法归类的
- action：notify / digest / mute
  · notify 需要现在提醒：有明确截止时间、要报名、要提交、今天/明天就要做
  · digest 不用马上但值得看：一般通知、安排、活动预告
  · mute 不值得打扰：闲聊、吐槽、文件、广告、重复内容、和自己无关
- importance：high / medium / low（与 action 对应即可）
- reason：20 字以内的判断依据

判定原则：
1. 同学之间的讨论、吐槽、「我觉得」「要不」「哈哈」→ chitchat + mute
2. 自己发的话（sender=me）→ chitchat + mute
3. 有【】、各位同学、@所有人、请于、截止、提交 → 大概率是通知/作业
4. 只在确实需要用户做事时才给 notify
5. 拿不准时选 digest，不要选 notify

只输出 JSON：
{"items":[{"id":1,"category":"homework","action":"notify","importance":"high","reason":"要求10.30前提交"}]}
"""


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _feedback_examples(db, limit: int = 8) -> list[dict]:
    """用户纠正过的例子，作为 few-shot。"""
    from db.models import ClassifyFeedback

    try:
        rows = (
            db.query(ClassifyFeedback)
            .order_by(ClassifyFeedback.id.desc())
            .limit(limit)
            .all()
        )
    except Exception:  # noqa: BLE001
        return []
    out = []
    for r in reversed(rows):
        out.append(
            {
                "text": (r.text or "")[:120],
                "sender": r.sender or "",
                "category": r.new_category,
            }
        )
    return out


def _prompt(db) -> str:
    examples = _feedback_examples(db)
    if not examples:
        return SYSTEM
    lines = [SYSTEM, "\n用户之前纠正过的例子（照这个标准判）："]
    for e in examples:
        lines.append(f'- "{e["text"]}"（{e["sender"] or "未知"}）→ {e["category"]}')
    return "\n".join(lines)


def _call_batch(db, batch: list) -> dict[int, dict]:
    """一次调用，返回 {消息id: 判定}。"""
    payload = []
    for m in batch:
        payload.append(
            {
                "id": m.id,
                "group": (m.group_name or "")[:24],
                "sender": (m.sender or "")[:16],
                "text": (m.text or "")[:220],
            }
        )
    data = llm.chat_json(
        [
            {"role": "system", "content": _prompt(db)},
            {"role": "user", "content": "messages=" + str(payload)},
        ],
        temperature=0.1,
        timeout=90,
        thinking=False,
    )
    out: dict[int, dict] = {}
    for item in data.get("items") or []:
        try:
            mid = int(item.get("id"))
        except (TypeError, ValueError):
            continue
        cat = str(item.get("category") or "").strip()
        act = str(item.get("action") or "").strip()
        imp = str(item.get("importance") or "").strip()
        if cat not in CATEGORIES:
            cat = "misc"
        if act not in ACTIONS:
            act = "digest"
        if imp not in IMPORTANCE:
            imp = "medium" if act == "digest" else ("high" if act == "notify" else "low")
        out[mid] = {
            "category": cat,
            "action": act,
            "importance": imp,
            "reason": str(item.get("reason") or "")[:120],
        }
    return out


# 明显的闲聊/文件/碎句，规则就能定，不必花 AI 额度
_OBVIOUS_CHAT = ("哈哈", "表情", "签到", "打卡", "在吗", "有人吗", "收到", "好的", "谢谢", "嗯", "哦")
_STRONG_TASK = ("截止", "提交", "上交", "报名", "请在", "前交", "ddl", "逾期", "务必", "必须")


def needs_ai(m) -> bool:
    """这条消息值得花 AI 额度吗？"""
    text = (m.text or "").strip()
    cat = (m.category or "misc").strip()

    if not text:
        return False
    # 自己发的话不用判
    if (m.sender or "").strip().lower() in ("me", "self", "我", "myself"):
        return False
    # 极短且是闲聊/文件/其他 → 规则足够
    if cat in ("chitchat", "misc", "file") and len(text) <= 30:
        return False
    if cat == "file":
        return False
    # 有明显任务信号 + 已归到作业/通知 → 规则足够
    if cat in ("homework", "admin", "competition") and any(k in text for k in _STRONG_TASK):
        return False
    # 纯表情/图片占位
    if text.startswith("[图片]") or text.startswith("[表情]"):
        return False
    return True


def classify_pending(db, limit: int = 60, force: bool = False) -> dict:
    """给「还没被 AI 判过」的消息跑分类。"""
    from db.models import WeChatMessage

    if not llm.is_configured():
        return {"ok": False, "code": "NO_AI", "message": "没有配置 AI Key"}

    q = db.query(WeChatMessage)
    if not force:
        q = q.filter((WeChatMessage.classify_src.is_(None)) | (WeChatMessage.classify_src == "rule"))

    # 先把「规则能定」的标记成 rule_final，不再进队列
    skipped = 0
    if not force:
        candidates = q.order_by(WeChatMessage.id.desc()).limit(400).all()
        for m in candidates:
            if not needs_ai(m):
                m.classify_src = "rule_final"
                skipped += 1
        if skipped:
            db.commit()

    q2 = db.query(WeChatMessage).filter(
        (WeChatMessage.classify_src.is_(None)) | (WeChatMessage.classify_src == "rule")
    )
    rows = q2.order_by(WeChatMessage.id.desc()).limit(max(1, min(limit, 200))).all()

    done = 0
    failed = 0
    now = _now()
    for i in range(0, len(rows), BATCH):
        batch = rows[i : i + BATCH]
        result: dict[int, dict] = {}
        for attempt in range(MAX_RETRY):
            try:
                result = _call_batch(db, batch)
                break
            except llm.LLMError as e:
                if "RATE_LIMIT" in str(e) or "频率" in str(e):
                    time.sleep(RETRY_SLEEP[min(attempt, len(RETRY_SLEEP) - 1)])
                    continue
                failed += len(batch)
                break
            except Exception:  # noqa: BLE001
                time.sleep(RETRY_SLEEP[min(attempt, len(RETRY_SLEEP) - 1)])
                continue
        if not result:
            failed += len(batch)
            continue

        for m in batch:
            r = result.get(m.id)
            if not r:
                continue
            m.category = r["category"]
            m.action = r["action"]
            m.importance = r["importance"]
            m.reason = r["reason"] or m.reason
            m.classify_src = "ai"
            m.updated_at = now
            done += 1
        db.commit()

    return {
        "ok": True,
        "done": done,
        "failed": failed,
        "skipped_rule": skipped,
        "pending": db.query(WeChatMessage)
        .filter((WeChatMessage.classify_src.is_(None)) | (WeChatMessage.classify_src == "rule"))
        .count(),
    }


def rule_importance(text: str, category: str, needs_action: bool) -> tuple[str, str]:
    """规则兜底：给出 (action, importance)。"""
    if category in ("chitchat", "misc", "file"):
        return "mute", "low"
    if needs_action or any(k in (text or "") for k in ("截止", "提交", "报名", "今天", "明天", "今晚")):
        return "notify", "high"
    if category in ("admin", "lecture", "competition", "homework", "recruit"):
        return "digest", "medium"
    return "digest", "low"
