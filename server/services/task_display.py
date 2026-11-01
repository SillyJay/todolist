"""任务标题的「可读化」与「碎片识别」。

背景：学习通把章节名当作业名（第一章、实验1、作业…），抓回来只是碎片，
脱离课程看不出要做什么。这里做两件事：

A. 补全：碎片标题 → 「大学物理BⅠ · 第六章」
C. 归档：把这类纯章节任务标记成 kind=chapter，前端可以折叠起来

只做展示层处理，不改数据库里的 title，原文仍然完整保留。
"""

from __future__ import annotations

import re

# 纯碎片：整条标题只有「第X章 / 实验N / 作业 / 练习 / 第X周作业」这类
FRAGMENT_RE = re.compile(
    r"^(?:"
    r"第[一二三四五六七八九十百零\d]+[章节讲篇]"
    r"|实验[一二三四五六七八九十\d]*"
    r"|作业[一二三四五六七八九十\d]*"
    r"|练习[一二三四五六七八九十\d]*"
    r"|第[一二三四五六七八九十\d]+周作业"
    r"|[上中下]篇"
    r")$"
)

MAX_FRAGMENT_LEN = 8


def is_fragment(title: str | None) -> bool:
    """标题是不是「只说了一半」的章节名。"""
    t = (title or "").strip()
    if not t or len(t) > MAX_FRAGMENT_LEN:
        return False
    return bool(FRAGMENT_RE.match(t))


def display_title(title: str | None, course: str | None) -> str:
    """给碎片标题补上课程名，其他标题原样返回。"""
    t = (title or "").strip()
    c = (course or "").strip()
    if not t:
        return c or "(无标题)"
    if c and is_fragment(t):
        return f"{c} · {t}"
    return t


def task_kind(title: str | None) -> str:
    """chapter = 纯章节类（可折叠归档）；task = 正常任务。"""
    return "chapter" if is_fragment(title) else "task"
