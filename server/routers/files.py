"""文件路由（规格 §7.4 + Phase 3）：附件下载、列表、原生预览、工作区浏览。"""
import json
import os
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db
from routers.pair import current_space
from db.models import Space
from db.models import File, Setting, Task
from services.workspace import save_bytes, safe_path, tree, workspace_root

router = APIRouter()


def _watch_gate(db: Session, task: Task) -> tuple[bool, str]:
    """「获取文件」白名单：settings.file_watch_courses 为空表示全部课程。

    键形如 `<platform>/<课程目录名>`，与前端筛选弹窗保持一致。
    """

    row = db.get(Setting, "file_watch_courses")
    if not row or not row.value:
        return True, ""
    try:
        watched = json.loads(row.value)
    except ValueError:
        return True, ""
    if not isinstance(watched, list) or not watched:
        return True, ""

    course = (task.course_abbr or task.course_name or "").strip()
    if not course:
        return True, ""  # 判断不了就别拦
    key = f"{task.platform}/{course}"
    for w in watched:
        if isinstance(w, str) and w == key:
            return True, ""
    return False, f"「{course}」不在获取文件列表里（文件页 → 筛选可调整）"


class DownloadBody(BaseModel):
    task_id: int
    url: str
    name: str | None = None


class DiscoverBody(BaseModel):
    task_id: int
    refresh: bool = False


class BulkDownloadBody(BaseModel):
    task_id: int
    keys: list[str] | None = None  # 不传 = 全部


class PathBody(BaseModel):
    rel: str


@router.get("")
def list_files(
    task_id: int | None = None,
    space: Space = Depends(current_space),
    db: Session = Depends(get_db),
):
    q = db.query(File).filter(File.space_id == space.id)
    if task_id:
        q = q.filter(File.task_id == task_id)
    rows = q.all()
    return {
        "items": [
            {
                "id": f.id,
                "task_id": f.task_id,
                "platform": f.platform,
                "name": f.name,
                "local_path": f.local_path,
                "origin": f.origin,
                "size": os.path.getsize(f.local_path)
                if f.local_path and os.path.exists(f.local_path)
                else 0,
            }
            for f in rows
        ]
    }


# ---------- 按相对路径操作（工作区里任何文件，含用户自己放的）----------

_MIME = {
    "pdf": "application/pdf",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
    "svg": "image/svg+xml",
    "bmp": "image/bmp",
    "txt": "text/plain; charset=utf-8",
    "md": "text/plain; charset=utf-8",
    "csv": "text/plain; charset=utf-8",
    "json": "application/json",
    "log": "text/plain; charset=utf-8",
    "mp4": "video/mp4",
    "webm": "video/webm",
}

_INLINE = {
    "pdf", "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "mp4", "webm",
    "txt", "md", "csv", "json", "log",
}


@router.get("/preview")
def preview_by_rel(rel: str):
    """按相对路径返回文件内容，供前端内嵌预览。

    PDF / 图片 / 文本由浏览器直接渲染；docx / xlsx 前端用 mammoth / SheetJS 解析，
    后端只负责给原始字节。
    """
    path = safe_path(rel)
    if not path or not os.path.isfile(path):
        raise HTTPException(404, "文件不存在")
    ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
    media = _MIME.get(ext, "application/octet-stream")
    headers = {"X-Content-Type-Options": "nosniff"}
    if ext not in _INLINE:
        headers["Content-Disposition"] = "attachment"
    return FileResponse(path, media_type=media, headers=headers)


@router.post("/open-path")
def open_by_rel(body: PathBody):
    """用系统默认程序打开工作区文件。"""
    path = safe_path(body.rel)
    if not path or not os.path.isfile(path):
        raise HTTPException(404, "文件不存在")
    try:
        os.startfile(path)  # noqa: S606
    except OSError as e:
        raise HTTPException(500, f"打开失败：{e}") from e
    return {"ok": True, "path": path}


@router.post("/reveal-path")
def reveal_by_rel(body: PathBody):
    """在资源管理器中定位工作区文件。"""
    path = safe_path(body.rel)
    if not path or not os.path.isfile(path):
        raise HTTPException(404, "文件不存在")
    try:
        import subprocess

        subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])  # noqa: S603,S607
    except OSError as e:
        raise HTTPException(500, f"打开失败：{e}") from e
    return {"ok": True, "path": path}


def _purge_file_rows(target: str, is_dir: bool) -> None:
    """删除成功后同步清理 files 表记录。"""
    from db.database import SessionLocal

    db = SessionLocal()
    try:
        prefix = os.path.normcase(os.path.realpath(target)) + os.sep
        for row in db.query(File).all():
            if not row.local_path:
                continue
            real = os.path.normcase(os.path.realpath(row.local_path))
            if (is_dir and real.startswith(prefix)) or (
                not is_dir and real == os.path.normcase(os.path.realpath(target))
            ):
                db.delete(row)
        db.commit()
    finally:
        db.close()


@router.delete("/file")
def delete_by_rel(rel: str):
    """删除工作区文件（送回收站，可恢复）。

    红线补充：程序自身「只增不删」；这里是用户在文件页的显式操作，
    因此强制走回收站，失败就报错而不是退化成硬删。
    """
    path = safe_path(rel)
    if not path or not os.path.isfile(path):
        raise HTTPException(404, "文件不存在")

    from services.trash import to_recycle_bin

    ok, err = to_recycle_bin(path)
    if not ok:
        raise HTTPException(500, f"移入回收站失败：{err}")
    _purge_file_rows(path, is_dir=False)
    return {"ok": True, "rel": rel}


@router.delete("/task-dir")
def delete_task_dir(rel: str):
    """删除任务目录（送回收站）。只允许任务层，防止误删平台/课程目录。"""
    path = safe_path(rel)
    if not path or not os.path.isdir(path):
        raise HTTPException(404, "目录不存在")

    root = os.path.realpath(workspace_root())
    depth = len(os.path.relpath(path, root).split(os.sep))
    if depth < 3:
        raise HTTPException(400, "只能删除任务级目录（平台/课程目录不允许删）")

    from services.trash import to_recycle_bin

    ok, err = to_recycle_bin(path)
    if not ok:
        raise HTTPException(500, f"移入回收站失败：{err}")
    _purge_file_rows(path, is_dir=True)
    return {"ok": True, "rel": rel}


@router.get("/workspace")
def workspace_info(include_tree: bool = Query(True, alias="tree")):
    """工作区根目录 + 两层目录树。

    设置页只用到 root，带上 tree=false 可省掉一次目录遍历（文件多时很慢）。
    """
    return {"root": workspace_root(), "tree": tree() if include_tree else []}


@router.post("/open-workspace")
def open_workspace():
    """在资源管理器里打开工作区（仅本机）。"""
    root = workspace_root()
    try:
        os.startfile(root)  # noqa: S606
    except OSError as e:
        raise HTTPException(500, f"打开失败：{e}") from e
    return {"ok": True, "root": root}


def _xiaoya_group_id(url: str | None) -> str | None:
    """从小雅任务链接里取课程 group_id：/jx-stem/mycourse/{gid}/task"""
    if not url:
        return None
    m = re.search(r"/mycourse/(\d+)", url)
    return m.group(1) if m else None


def _download_xiaoya(task: Task, keys: list[str] | None, db: Session) -> dict:
    """小雅文件下载：浏览器逐个点「下载」菜单，落临时目录后复制进工作区。"""
    import shutil
    import tempfile

    from adapters.xiaoya import XiaoyaAdapter
    from services.workspace import save_existing_file

    group_id = _xiaoya_group_id(task.url)
    if not group_id:
        raise HTTPException(400, "该任务没有课程链接，无法定位文件")

    adapter = XiaoyaAdapter()
    try:
        items = adapter.list_course_files(group_id, task.title)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"读取文件列表失败：{e}") from e

    if keys:
        wanted = set(keys)
        items = [i for i in items if i["key"] in wanted]
    if not items:
        return {"ok": True, "downloaded": [], "failed": [], "skipped": [], "message": "没有可下载的文件"}

    rows = db.query(File).filter(File.task_id == task.id).all()
    existing_keys = {f.origin_key for f in rows if f.origin_key}
    existing_names = {f.name for f in rows}

    def _done(i: dict) -> bool:
        return i["key"] in existing_keys or i["name"] in existing_names

    todo = [i for i in items if not _done(i)]
    skipped = [i["name"] for i in items if _done(i)]
    if not todo:
        return {
            "ok": True,
            "downloaded": [],
            "failed": [],
            "skipped": skipped,
            "message": f"全部已下载（{len(skipped)} 个）",
        }

    tmp = tempfile.mkdtemp(prefix="xiaoya_dl_")
    downloaded, failed = [], []
    try:
        results = adapter.download_course_files(group_id, todo, tmp)
        # 下载结果按文件名回连到发现阶段的 key（Playwright 只回传文件名）
        key_by_name = {i["name"]: i["key"] for i in todo}
        for r in results:
            if r.get("error"):
                failed.append({"name": r.get("name", ""), "error": r["error"]})
                continue
            src = r.get("path")
            if not src or not os.path.exists(src):
                failed.append({"name": r.get("name", ""), "error": "文件未落盘"})
                continue
            path, digest = save_existing_file(src, task, r["name"])
            db.add(
                File(
                    task_id=task.id,
                    platform=task.platform,
                    name=r["name"],
                    local_path=path,
                    origin="attachment",
                    origin_key=key_by_name.get(r["name"]),
                    file_hash=digest,
                    created_at=datetime.now().isoformat(timespec="seconds"),
                )
            )
            downloaded.append({"name": r["name"], "size": os.path.getsize(path), "path": path})
        db.commit()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    return {
        "ok": True,
        "downloaded": downloaded,
        "failed": failed,
        "skipped": skipped,
        "message": f"成功 {len(downloaded)} 个"
        + (f"，跳过已下载 {len(skipped)} 个" if skipped else "")
        + (f"，失败 {len(failed)} 个" if failed else ""),
    }


@router.get("/attachments")
def list_attachments(task_id: int, db: Session = Depends(get_db)):
    """发现任务附件（不下载）。学习通走页面解析，小雅走课程内容树。"""
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "任务不存在")

    allowed, why = _watch_gate(db, task)
    if not allowed:
        return {"items": [], "count": 0, "supported": False, "message": why}

    if task.platform not in ("chaoxing", "xiaoya"):
        return {
            "items": [],
            "count": 0,
            "supported": False,
            "message": "该平台没有附件概念",
        }

    if task.platform == "xiaoya":
        group_id = _xiaoya_group_id(task.url)
        if not group_id:
            return {"items": [], "count": 0, "supported": True, "message": "该任务没有课程链接"}
        from adapters.xiaoya import XiaoyaAdapter

        try:
            items = XiaoyaAdapter().list_course_files(group_id, task.title)
        except Exception as e:  # noqa: BLE001
            return {"items": [], "count": 0, "supported": True, "message": f"读取失败：{e}"}
    else:
        if not task.url:
            return {"items": [], "count": 0, "supported": True, "message": "该任务没有详情链接"}
        from adapters.chaoxing import ChaoxingAdapter

        try:
            items = ChaoxingAdapter().fetch_attachments(task.url)
        except Exception as e:  # noqa: BLE001
            return {"items": [], "count": 0, "supported": True, "message": f"读取失败：{e}"}

    rows = db.query(File).filter(File.task_id == task_id).all()
    by_key = {f.origin_key: f.id for f in rows if f.origin_key}
    by_name = {f.name: f.id for f in rows}
    for i in items:
        fid = by_key.get(i["key"]) or by_name.get(i["name"])
        i["downloaded"] = fid is not None
        i["file_id"] = fid

    return {"items": items, "count": len(items), "supported": True, "message": ""}


@router.post("/download-attachments")
def download_attachments(body: BulkDownloadBody, db: Session = Depends(get_db)):
    """批量下载任务附件并归档到工作区。逐个下，单个失败不影响其他。

    学习通 = 纯 HTTP（status 接口换签名地址）；
    小雅 = Playwright 逐个点「下载」菜单（接口返回加密串，无法直取）。
    """
    task = db.get(Task, body.task_id)
    if not task:
        raise HTTPException(404, "任务不存在")

    allowed, why = _watch_gate(db, task)
    if not allowed:
        raise HTTPException(403, why)

    if task.platform == "xiaoya":
        return _download_xiaoya(task, body.keys, db)
    if task.platform != "chaoxing":
        raise HTTPException(400, "该平台附件下载尚未实现")

    from adapters.chaoxing import ChaoxingAdapter

    adapter = ChaoxingAdapter()
    try:
        items = adapter.fetch_attachments(task.url)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"读取附件列表失败：{e}") from e

    if body.keys:
        wanted = set(body.keys)
        items = [i for i in items if i["key"] in wanted]
    if not items:
        return {"ok": True, "downloaded": [], "failed": [], "message": "没有可下载的附件"}

    rows = db.query(File).filter(File.task_id == task.id).all()
    existing_keys = {f.origin_key for f in rows if f.origin_key}
    existing_names = {f.name for f in rows}
    downloaded, failed, skipped = [], [], []

    for item in items:
        name_guess = item.get("name") or ""
        if item.get("key") in existing_keys or (name_guess and name_guess in existing_names):
            skipped.append(name_guess)
            continue
        try:
            data, filename = adapter.download_attachment(item)
        except Exception as e:  # noqa: BLE001
            failed.append({"name": name_guess, "error": str(e)[:120]})
            continue

        if len(data) == 0:
            failed.append({"name": name_guess, "error": "下载内容为空"})
            continue

        path, digest = save_bytes(data, task, filename)
        row = File(
            task_id=task.id,
            platform=task.platform,
            name=filename,
            local_path=path,
            origin="attachment",
            origin_key=item.get("key"),
            file_hash=digest,
            created_at=datetime.now().isoformat(timespec="seconds"),
        )
        db.add(row)
        downloaded.append({"name": filename, "size": len(data), "path": path})

    db.commit()
    return {
        "ok": True,
        "downloaded": downloaded,
        "failed": failed,
        "skipped": skipped,
        "message": f"成功 {len(downloaded)} 个"
        + (f"，跳过已下载 {len(skipped)} 个" if skipped else "")
        + (f"，失败 {len(failed)} 个" if failed else ""),
    }


@router.post("/download")
def download(body: DownloadBody, db: Session = Depends(get_db)):
    """下载附件并归档到工作区（带平台登录 Cookie）。"""
    import httpx

    task = db.get(Task, body.task_id)
    if not task:
        raise HTTPException(404, "任务不存在")

    cookies: dict[str, str] = {}
    headers = {"User-Agent": "Mozilla/5.0"}

    if task.platform == "chaoxing":
        from adapters.chaoxing import ChaoxingAdapter

        cookies = ChaoxingAdapter().load_cookies()
        headers["Referer"] = "https://mooc1.chaoxing.com/"
    elif task.platform == "xiaoya":
        from adapters.xiaoya import XiaoyaAdapter

        cookies = XiaoyaAdapter().load_cookies()
        headers["Referer"] = "https://xiaoya.fifedu.com/"
        headers["authorization"] = f"Bearer {cookies.get('HS-prd-access-token', '')}"

    try:
        with httpx.Client(timeout=60, follow_redirects=True, headers=headers, cookies=cookies) as cli:
            r = cli.get(body.url)
            r.raise_for_status()
            data = r.content
    except httpx.HTTPError as e:
        raise HTTPException(502, f"下载失败：{e}") from e

    if len(data) < 200:
        raise HTTPException(502, "下载内容异常（可能未登录或链接失效）")

    name = body.name or os.path.basename(body.url.split("?")[0]) or "附件"
    path, digest = save_bytes(data, task, name)

    row = File(
        task_id=task.id,
        platform=task.platform,
        name=name,
        local_path=path,
        origin="attachment",
        file_hash=digest,
        created_at=datetime.now().isoformat(timespec="seconds"),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"ok": True, "id": row.id, "path": path, "size": len(data)}


@router.post("/{file_id}/open")
def open_file(file_id: int, db: Session = Depends(get_db)):
    """用系统默认程序打开文件（本机操作）。"""
    f = db.get(File, file_id)
    if not f or not f.local_path or not os.path.exists(f.local_path):
        raise HTTPException(404, "文件不存在")
    try:
        os.startfile(f.local_path)  # noqa: S606
    except OSError as e:
        raise HTTPException(500, f"打开失败：{e}") from e
    return {"ok": True, "path": f.local_path}


@router.post("/{file_id}/reveal")
def reveal_file(file_id: int, db: Session = Depends(get_db)):
    """在资源管理器中定位文件。"""
    f = db.get(File, file_id)
    if not f or not f.local_path or not os.path.exists(f.local_path):
        raise HTTPException(404, "文件不存在")
    try:
        import subprocess

        subprocess.Popen(["explorer", "/select,", f.local_path])  # noqa: S603,S607
    except OSError as e:
        raise HTTPException(500, f"打开失败：{e}") from e
    return {"ok": True, "path": f.local_path}


@router.get("/{file_id}/content")
def file_content(file_id: int, db: Session = Depends(get_db)):
    """原生预览：PDF / 图片 / 文本直接返回，浏览器可内嵌显示。"""
    f = db.get(File, file_id)
    if not f or not f.local_path or not os.path.exists(f.local_path):
        raise HTTPException(404, "文件不存在")
    return FileResponse(f.local_path, filename=f.name)
