"""文件路由（规格 §7.4）。当前为契约 mock。"""
from fastapi import APIRouter

router = APIRouter()


@router.get("")
def list_files(task_id: int | None = None):
    """文件列表。"""
    # TODO Phase 3
    return {"items": []}


@router.get("/{file_id}/content")
def file_content(file_id: int):
    """文件内容：docx→mammoth HTML；pptx→转换后 PDF；PDF/图片直出。"""
    # TODO Phase 3
    return {"mock": True, "file_id": file_id}


@router.post("/{file_id}/convert-pptx")
def convert_pptx(file_id: int):
    """触发 LibreOffice 转换（幂等）。"""
    # TODO Phase 3
    return {"ok": False, "code": "NOT_IMPLEMENTED", "mock": True}
