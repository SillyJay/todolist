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


@router.get("/{file_id}/content")
def file_content(file_id: int, db: Session = Depends(get_db)):
    """原生预览：PDF / 图片 / 文本直接返回，浏览器可内嵌显示。"""
    f = db.get(File, file_id)
    if not f or not f.local_path or not os.path.exists(f.local_path):
        raise HTTPException(404, "文件不存在")
    return FileResponse(f.local_path, filename=f.name)
