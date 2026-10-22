"""文件路由（规格 §7.4 + Phase 3）：附件下载、列表、原生预览、工作区浏览。"""
import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import File, Task
from services.workspace import save_bytes, tree, workspace_root

router = APIRouter()


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


@router.get("")
def list_files(task_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(File)
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


@router.get("/workspace")
def workspace_info():
    """工作区根目录 + 两层目录树（设置页展示）。"""
    return {"root": workspace_root(), "tree": tree()}


@router.post("/open-workspace")
def open_workspace():
    """在资源管理器里打开工作区（仅本机）。"""
    root = workspace_root()
    try:
        os.startfile(root)  # noqa: S606
    except OSError as e:
        raise HTTPException(500, f"打开失败：{e}") from e
    return {"ok": True, "root": root}


@router.get("/attachments")
def list_attachments(task_id: int, db: Session = Depends(get_db)):
    """发现任务附件（不下载）。目前学习通支持，小雅待补。"""
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(404, "任务不存在")

    if task.platform != "chaoxing":
        return {
            "items": [],
            "count": 0,
            "supported": False,
            "message": f"{task.platform} 的附件发现尚未实现" if task.platform == "xiaoya" else "该平台没有附件概念",
        }

    if not task.url:
        return {"items": [], "count": 0, "supported": True, "message": "该任务没有详情链接"}

    from adapters.chaoxing import ChaoxingAdapter

    try:
        items = ChaoxingAdapter().fetch_attachments(task.url)
    except Exception as e:  # noqa: BLE001
        return {"items": [], "count": 0, "supported": True, "message": f"读取失败：{e}"}

    by_name = {f.name: f.id for f in db.query(File).filter(File.task_id == task_id).all()}
    for i in items:
        fid = by_name.get(i["name"])
        i["downloaded"] = fid is not None
        i["file_id"] = fid

    return {"items": items, "count": len(items), "supported": True, "message": ""}


@router.post("/download-attachments")
def download_attachments(body: BulkDownloadBody, db: Session = Depends(get_db)):
    """批量下载任务附件并归档到工作区。逐个下，单个失败不影响其他。"""
    task = db.get(Task, body.task_id)
    if not task:
        raise HTTPException(404, "任务不存在")
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

    existing = {f.name for f in db.query(File).filter(File.task_id == task.id).all()}
    downloaded, failed, skipped = [], [], []

    for item in items:
        name_guess = item.get("name") or ""
        if name_guess and name_guess in existing:
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
