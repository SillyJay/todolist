"""AI 路由（规格 §7.3）。当前为契约 mock。"""
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class SummarizeBody(BaseModel):
    text: str


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatBody(BaseModel):
    message: str
    history: list[ChatMessage] = []


@router.post("/test")
def test_connection():
    """测试 API Key 连通性。"""
    # TODO Phase 2: 接 ai/llm.py
    return {"ok": False, "code": "NO_API_KEY", "mock": True}


@router.post("/summarize")
def summarize(body: SummarizeBody):
    """长通知摘要（走缓存，规格模块 4 能力二）。"""
    # TODO Phase 2
    return {"summary": None, "mock": True}


@router.post("/chat")
def chat(body: ChatBody):
    """Agent 对话：SSE 流式返回 + Function Calling 工具集。"""
    # TODO Phase 2: SSE + tools
    return {"reply": None, "mock": True}
