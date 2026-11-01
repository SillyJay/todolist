"""微信群消息：分类 + 「跟我有多大关系」打分。

设计目标（内测反馈里最痛的一点）：
群里一天几百条，用户真正关心的只有几条。这里用**纯规则**做两件事：

1. `classify()` —— 把消息归到 7 类：比赛竞赛 / 作业考试 / 讲座活动 /
   通知安排 / 招募招新 / 闲聊灌水 / 其他
2. `score()` —— 结合用户画像（姓名、班级、组织）算 0~100 的相关度，
   并给出「为什么相关」的原因，方便界面解释，也方便用户判断规则是否合理

不用 LLM 的原因：群里消息量大、要实时、要可解释、要不烧 token。
规则漏判的，用户可以点「转为任务」手动补救。
"""
from __future__ import annotations

import json
import re

# 分类规则：(key, 中文名, 关键词, 基础分)
# 关键词按长度加权，长词优先（"互联网+" 比 "赛" 更能说明问题）
RULES: list[tuple[str, str, list[str], int]] = [
    (
        "competition",
        "比赛竞赛",
        [
            "竞赛", "比赛", "大赛", "挑战赛", "创新创业", "数学建模竞赛", "建模竞赛", "蓝桥", "ACM",
            "电赛", "挑战杯", "互联网+", "省赛", "国赛", "校赛", "赛道", "报名参赛",
            "作品提交", "初赛", "复赛", "决赛", "获奖",
        ],
        55,
    ),
    (
        "homework",
        "作业考试",
        [
            "作业", "实验报告", "课程报告", "实验", "课设", "课程设计", "论文",
            "ddl", "DDL", "考试", "测验", "补考", "重修", "答辩",
            "预习", "复习", "习题", "查重", "降重",
        ],
        55,
    ),
    (
        "lecture",
        "讲座活动",
        [
            "讲座", "沙龙", "分享会", "宣讲会", "论坛", "演出", "晚会", "展览",
            "观影", "读书会", "参观", "志愿者", "志愿", "活动报名", "社团活动",
        ],
        38,
    ),
    (
        "admin",
        "通知安排",
        [
            "通知", "安排", "调课", "停课", "补课", "放假", "班会", "签到",
            "统计", "表格", "填写", "填报", "领取", "缴费", "注册", "选课",
            "学籍", "评教", "辅导员", "教务处", "请假", "返校",
            "公示", "名单", "评选", "资助", "助学金", "奖助", "困难生", "家庭经济困难",
            "例会", "会议", "开会", "值班", "排班", "教室", "调休",
        ],
        42,
    ),
    (
        "recruit",
        "招募招新",
        ["招新", "纳新", "招募", "面试", "干事", "部员", "社长", "加入我们", "简历", "部门"],
        32,
    ),
    (
        "file",
        "文件资料",
        ["文件", "附件", "资料", "课件", "模板", "答案", "讲义"],
        18,
    ),
    (
        "chitchat",
        "闲聊灌水",
        [
            "接龙", "投票", "问卷", "拼单", "二手", "失物", "招领", "打卡", "聚餐", "团建", "生日", "约饭", "开黑",
            "哈哈哈", "有人吗", "水群", "表情包", "梗", "求带", "外卖", "拼车",
        ],
        8,
    ),
]

AD_WORDS = ["代课", "代写", "代办", "刷单", "兼职", "贷款", "微商", "广告", "优惠", "拼团", "求购", "出售"]

ACTION_WORDS = ["报名", "截止", "提交", "上交", "填写", "填报", "参加", "领取", "今天", "明天", "本周", "紧急"]

URGENT_WORDS = ["今天", "今晚", "明天", "马上", "紧急", "最后一天"]

# 分类权重：闲聊类命中时优先归到闲聊，避免「聚餐报名，截止周五」被当成作业
CATEGORY_WEIGHT = {"chitchat": 2.0}

CATEGORY_LABEL = {k: label for k, label, _, _ in RULES}
CATEGORY_LABEL["misc"] = "其他"

# 界面上的排序/筛选顺序
CATEGORY_ORDER = ["competition", "homework", "lecture", "admin", "recruit", "file", "chitchat", "misc"]


# 课表/上课信息：这类文本里常出现课程名（数学建模、Java…），只按关键词打分会
# 被「数学建模」这种词误判成比赛。先识别出"这是课表"，再决定要不要看竞赛词。
_SCHEDULE_STRONG = ("课表", "上课时间", "上课地点", "节次", "第几节", "周次")
_SCHEDULE_WEAK = ("第", "节", "教学楼", "实训", "机房", "教室", "校区", "上午", "下午")
_COMPETITION_STRONG = (
    "竞赛", "比赛", "大赛", "挑战赛", "参赛", "报名参", "初赛", "复赛", "决赛",
    "获奖", "作品提交", "赛道", "报名截止", "组队",
)


def is_schedule(text: str) -> bool:
    t = text or ""
    if any(k in t for k in _SCHEDULE_STRONG):
        return True
    hits = sum(1 for k in _SCHEDULE_WEAK if k in t)
    return hits >= 3


# 文件分享：群里丢文件（PPT/PDF/压缩包…）不该算「作业考试」
_FILE_NAME_RE = re.compile(
    r"(?:\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|7z|txt|md|csv|mp4|mov|png|jpe?g|gif)|\[文件\])",
    re.IGNORECASE,
)
_FILE_SHARE_HINT = ("上传了文件", "上传文件", "发了一个文件", "群文件", "详见附件", "附件如下")
# 有这些词说明是「要交的东西」，才算作业
_ASSIGNMENT_INTENT = (
    "截止", "提交", "上交", "交到", "请在", "前交", "ddl", "DDL", "必须交", "务必", "不交", "逾期",
)


# 强通知信号：出现这些词时，即使带 [文件]/附件 也按通知处理
_ADMIN_STRONG = ("通知", "公示", "通报", "名单", "安排", "统计", "报名", "评选", "资助", "领取", "填写")


def has_admin_strong(text: str) -> bool:
    return any(k in (text or "") for k in _ADMIN_STRONG)


# 群文件在微信里通常是一条「文案」而不是正文：
#   发布2026年老生体检必达公众号操作指引
#   发布2026年老生体检程序及注意事项
#   2026花都校区2024级、2025级体检安排文件
# 这类东西真正的通知会有单独的文字消息，所以整条都可以不显示。
_CAPTION_TAIL = re.compile(r"(文件|附件|指引|操作指引|注意事项|说明|文档|表格)$")


def is_file_caption(text: str) -> bool:
    """短句 + 以「文件/附件/指引/注意事项」结尾 → 认定是文件描述。"""
    t = (text or "").strip()
    if not t or len(t) > 40:
        return False
    # 去掉开头的「发布/上传/分享」等动词再判断结尾
    body = re.sub(r"^(发布|上传|分享|转发|发送)[:：]?", "", t)
    return bool(_CAPTION_TAIL.search(body))


def is_file_share(text: str) -> bool:
    """判断这条消息是不是「群里发了/提到一个文件」。"""
    t = text or ""
    if any(k in t for k in _FILE_SHARE_HINT):
        return True
    return bool(_FILE_NAME_RE.search(t))


def has_assign_intent(text: str) -> bool:
    return any(k in (text or "") for k in _ASSIGNMENT_INTENT)


def has_competition(text: str) -> bool:
    t = text or ""
    return any(k in t for k in _COMPETITION_STRONG)


# 闲聊口吻：出现这些词基本可以确定不是在发通知
_CASUAL_WORDS = ("哈哈", "咱", "我觉", "你看", "行不", "不是", "了吧", "呢", "吗", "啊", "哦", "嗯", "呀")
# 真·任务信号：有这些词才可能在短句里算作业
_STRONG_TASK = ("截止", "提交", "上交", "交到", "报名", "请在", "前交", "ddl", "DDL", "必须", "务必", "逾期")


# 通知的"格式特征"：出现这些就不是随口聊天
_NOTICE_MARKERS = ("【", "】", "各位", "同学们", "@所有人", "请大家", "请于", "请各", "现将", "特此")


def is_short_chat(text: str, sender: str | None = None) -> bool:
    """判断是不是「随口说的话」。

    命中任意一条即视为闲聊：
      - 发送者是自己
      - 很短（≤20 字）且没有行动词、也没有通知格式
      - 带口语词且不长（≤40 字）且没有通知格式
    """
    t = (text or "").strip()
    if not t:
        return True
    if (sender or "").strip().lower() in ("me", "self", "我", "myself"):
        return True
    if any(k in t for k in _STRONG_TASK):
        return False
    if any(k in t for k in _NOTICE_MARKERS):
        return False
    if len(t) <= 20:
        return True
    return any(k in t for k in _CASUAL_WORDS) and len(t) <= 40


def classify(text: str, sender: str | None = None) -> tuple[str, str, list[str]]:
    """返回 (分类 key, 中文名, 命中的关键词)。

    计分方式：每个命中关键词按长度加权累加，取最高分类；
    全部未命中则归为 misc（其他）。
    """
    text = text or ""

    # 自己发的话永远不是"通知"，直接归到不展示的 misc
    if (sender or "").strip().lower() in ("me", "self", "我", "myself"):
        return "misc", CATEGORY_LABEL["misc"], []

    # 课表优先：没有明确的竞赛/比赛措辞时，一律算「通知安排」
    if is_schedule(text) and not has_competition(text):
        return "admin", CATEGORY_LABEL["admin"], ["课表/上课信息"]

    # 文件类优先，且不看「通知/安排」这类词：
    # 群文件的文案（发布…操作指引 / …注意事项 / …安排文件）本身不是通知，
    # 真正要用户做事的那条文字通知会单独出现。
    if is_file_caption(text) and not has_assign_intent(text):
        return "file", CATEGORY_LABEL["file"], ["文件文案"]

    # 带扩展名 / [文件] / 上传了文件 的，只要不是「要交的作业」也算文件
    if (
        is_file_share(text)
        and not has_assign_intent(text)
        and not has_competition(text)
        and not has_admin_strong(text)
    ):
        return "file", CATEGORY_LABEL["file"], ["文件/附件"]

    best_key, best_hits, best_score = "misc", [], 0.0
    for key, _label, keywords, _base in RULES:
        hits = [k for k in keywords if k in text]
        if not hits:
            continue
        weight = sum(len(k) for k in hits)
        # 长词（>=3 字）额外加权，避免「赛」这种单字误判
        weight += sum(2 for k in hits if len(k) >= 3)
        weight *= CATEGORY_WEIGHT.get(key, 1.0)
        if weight > best_score:
            best_key, best_hits, best_score = key, hits, weight
    # 短闲聊兜底：作业/考试/竞赛被高频词带偏时纠正成闲聊
    if best_key in ("homework", "lecture", "competition", "admin") and is_short_chat(text, sender):
        return "chitchat", CATEGORY_LABEL["chitchat"], best_hits

    return best_key, CATEGORY_LABEL[best_key], best_hits


def _norm(value) -> list[str]:
    """profile_orgs 既可能是 JSON 数组，也可能是逗号分隔字符串。"""
    if not value:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    raw = str(value).strip()
    if raw.startswith("["):
        try:
            return _norm(json.loads(raw))
        except (ValueError, TypeError):
            pass
    return [p.strip() for p in re.split(r"[,，;；\n]", raw) if p.strip()]


def load_profile(db) -> dict:
    """从 settings 读出用户画像：姓名 / 班级 / 组织列表。"""
    from db.models import Setting

    def get(key: str) -> str:
        row = db.get(Setting, key)
        return (row.value or "") if row else ""

    return {
        "name": get("profile_name").strip(),
        "class_name": get("profile_class").strip(),
        "orgs": _norm(get("profile_orgs")),
    }


def score(text: str, group: str, profile: dict, category: str) -> tuple[int, list[str], bool]:
    """返回 (0~100 相关度, 相关原因列表, 是否需要行动)。"""
    text = text or ""
    group = group or ""
    base = next((b for k, _, _, b in RULES if k == category), 20)
    reasons: list[str] = []
    if any(k in text for k in ("@所有人", "@全体成员", "@全体")):
        base += 6
        reasons.append("群里 @所有人")

    name = (profile or {}).get("name") or ""
    if name and len(name) >= 2 and name in text:
        base += 28
        reasons.append(f"提到你（{name}）")

    klass = (profile or {}).get("class_name") or ""
    if klass and klass in text:
        base += 22
        reasons.append(f"提到你的班级（{klass}）")

    org_hits = []
    for org in (profile or {}).get("orgs") or []:
        if len(org) < 2:
            continue
        if org in text or org in group:
            org_hits.append(org)
    if org_hits:
        base += min(26, 14 * len(org_hits))
        reasons.append("涉及你的组织：" + "、".join(org_hits[:3]))

    hits = [k for k in ACTION_WORDS if k in text]
    if hits:
        base += 6
        reasons.append("含行动要求：" + "、".join(hits[:3]))

    if any(k in text for k in URGENT_WORDS):
        base += 4

    if category == "chitchat":
        base -= 14
    if category == "file":
        # 单纯丢个文件，除非命中你的课程/组织，否则不该高亮
        base -= 16
    if any(w in text for w in AD_WORDS):
        base -= 28
        reasons.append("疑似广告/推销")

    base = max(0, min(100, base))
    needs_action = any(k in text for k in ("报名", "截止", "提交", "上交", "填写", "领取"))
    return base, reasons, needs_action


def analyze(text: str, group: str, profile: dict, sender: str | None = None) -> dict:
    """一步完成分类 + 打分，供监听线程与「重新分析」接口复用。"""
    category, label, hits = classify(text, sender)
    relevance, reasons, needs_action = score(text, group, profile, category)
    return {
        "category": category,
        "category_label": label,
        "keywords": hits[:6],
        "relevance": relevance,
        "reasons": reasons,
        "needs_action": needs_action,
        # 界面上「只看与我相关」的阈值
        "relevant": relevance >= 45,
    }

# ---------------------------------------------------------------- 可见性规则
# 桌面端「消息」页和移动端同步都走这套规则，避免两边显示不一样。
# 不展示：闲聊(chitchat) + 其他(misc)；低于阈值的视为无关。
# 规则版本：改动分类逻辑就 +1，后端启动时会用它判断要不要重跑老数据
CLASSIFY_VERSION = 5

RELEVANT_THRESHOLD = 45
# 文件分享（file）也不展示：群里丢的 pptx/pdf 不是需要处理的通知，
# 单独给一个「文件资料」分类只会让筛选栏变长，直接不出现在消息流里。
HIDDEN_CATEGORIES = ("chitchat", "misc", "file")
VISIBLE_CATEGORIES = tuple(
    c for c in ["competition", "homework", "lecture", "admin", "recruit"] if c not in HIDDEN_CATEGORIES
)


def is_visible(message) -> bool:
    """这条消息该不该出现在用户的消息流里。"""
    if getattr(message, "ignored", 0):
        return False
    if (message.category or "misc") in HIDDEN_CATEGORIES:
        return False
    return (getattr(message, "relevance", 0) or 0) >= RELEVANT_THRESHOLD
