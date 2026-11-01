"""关键回归测试：纯逻辑模块（不需要数据库/网络）。"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.message_classify import analyze
from services.task_display import display_title, is_fragment, task_kind


# ---------------------------------------------------------------- task_display

def test_is_fragment_for_chapter_titles():
    assert is_fragment("第六章") is True
    assert is_fragment("实验2") is True
    # 带具体内容的标题不算碎片
    assert is_fragment("第 6 章 图论作业") is False


def test_is_fragment_for_real_tasks():
    assert is_fragment("完成实验报告并提交") is False


def test_display_title_keeps_course_prefix():
    # 签名是 display_title(title, course)
    title = display_title("第六章", "大学物理BⅠ")
    assert "大学物理" in title
    assert "第六章" in title


def test_task_kind():
    assert task_kind("第六章") == "chapter"
    assert task_kind("提交实验报告") == "task"


# ---------------------------------------------------------------- message_classify

def _profile():
    return {"name": "张三", "class_name": "25软件工程B班", "orgs": ["计算机协会"]}


def test_homework_keyword_is_homework():
    r = analyze("请于10月30日前提交实验报告", "通知群", _profile(), "老师")
    assert r["category"] in ("homework", "admin")
    assert r["needs_action"] is True


def test_chitchat_is_not_task():
    r = analyze("哈哈哈这也太离谱了", "闲聊群", _profile(), "同学")
    assert r["category"] == "chitchat"
    assert r["needs_action"] is False


def test_own_message_goes_misc():
    r = analyze("我去看一下", "通知群", _profile(), "me")
    assert r["category"] == "misc"


def test_ppt_alone_is_not_homework():
    r = analyze("ppt不着急的", "闲聊群", _profile(), "同学")
    assert r["category"] != "homework"
