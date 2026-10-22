"""工作区与附件落盘（Phase 3 简化版）。

目录策略（用户要求）：默认放在助手目录下 `workspace/`，可在设置里改成任意路径。
结构由程序自动分类，用户不用管：

    workspace/
      学习通/计算机组成原理/第四章作业/
          要求.docx
      小雅/数学建模/实验3 回归分析/
          ...
      微信群/25软件工程B班/2026-10-22 通知.pdf

⚠️ 红线：只增不删，重名自动加序号 name(2).ext，绝不覆盖/删除。
"""
import hashlib
import os
import shutil
import re

from config import app_root
from db.database import SessionLocal
from db.models import Setting

_ILLEGAL = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _sanitize(name: str, fallback: str = "未命名") -> str:
    name = _ILLEGAL.sub("_", (name or "").strip()).strip(" .")
    return (name or fallback)[:60]


def workspace_root() -> str:
    """工作区根目录：settings.workspace_dir 优先，否则 <助手目录>/workspace。"""
    db = SessionLocal()
    try:
        row = db.get(Setting, "workspace_dir")
        custom = row.value.strip() if row and row.value else ""
    finally:
        db.close()

    root = custom or os.path.join(app_root(), "workspace")
    try:
        os.makedirs(root, exist_ok=True)
        probe = os.path.join(root, ".write_test")
        with open(probe, "w", encoding="utf-8") as f:
            f.write("ok")
        os.remove(probe)
    except OSError:
        root = os.path.join(app_root(), "workspace")
        os.makedirs(root, exist_ok=True)
    return root


PLATFORM_DIR = {"chaoxing": "学习通", "xiaoya": "小雅", "wechat": "微信群", "manual": "手动"}


def task_dir(task) -> str:
    """给任务算出归档目录：<root>/<平台>/<课程>/<任务标题>"""
    root = workspace_root()
    platform = PLATFORM_DIR.get(task.platform or "manual", "其他")
    course = _sanitize(task.course_abbr or task.course_name or "未分类课程", "未分类课程")
    title = _sanitize(task.title or f"任务{task.id}")
    path = os.path.join(root, platform, course, title)
    os.makedirs(path, exist_ok=True)
    return path


def save_bytes(data: bytes, task, filename: str) -> tuple[str, str]:
    """保存附件到任务目录，返回 (路径, sha256)。重名加序号，不覆盖。"""
    folder = task_dir(task)
    safe_name = _sanitize(filename, "附件")
    digest = hashlib.sha256(data).hexdigest()

    target = os.path.join(folder, safe_name)
    stem, ext = os.path.splitext(safe_name)
    i = 1
    while os.path.exists(target):
        target = os.path.join(folder, f"{stem}({i}){ext}")
        i += 1

    with open(target, "wb") as f:
        f.write(data)
    return target, digest


def save_existing_file(src: str, task, filename: str) -> tuple[str, str]:
    """把已下载到临时目录的文件复制进任务目录，返回 (路径, sha256)。

    用于浏览器下载场景（Playwright 只能落盘，不能直接拿 bytes），
    避免把几十 MB 的文件整个读进内存。
    """
    folder = task_dir(task)
    safe_name = _sanitize(filename, "附件")
    target = os.path.join(folder, safe_name)
    stem, ext = os.path.splitext(safe_name)
    i = 1
    while os.path.exists(target):
        target = os.path.join(folder, f"{stem}({i}){ext}")
        i += 1

    shutil.copy2(src, target)

    digest = hashlib.sha256()
    with open(target, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return target, digest.hexdigest()


def tree(limit_platforms: int = 20) -> list[dict]:
    """列出工作区目录树（两层），供设置页展示。"""
    root = workspace_root()
    out: list[dict] = []
    try:
        platforms = sorted(os.listdir(root))
    except OSError:
        return out

    for platform in platforms[:limit_platforms]:
        pdir = os.path.join(root, platform)
        if not os.path.isdir(pdir):
            continue
        courses = []
        for course in sorted(os.listdir(pdir))[:50]:
            cdir = os.path.join(pdir, course)
            if not os.path.isdir(cdir):
                continue
            tasks = []
            for t in sorted(os.listdir(cdir))[:50]:
                tdir = os.path.join(cdir, t)
                if not os.path.isdir(tdir):
                    continue
                files = [
                    {"name": f, "size": os.path.getsize(os.path.join(tdir, f))}
                    for f in os.listdir(tdir)
                    if os.path.isfile(os.path.join(tdir, f))
                ]
                tasks.append({"name": t, "files": files})
            courses.append({"name": course, "tasks": tasks})
        out.append({"platform": platform, "courses": courses})
    return out
