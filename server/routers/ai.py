"""AI 路由（规格 §7.3）：状态 / 连通性测试 / 摘要 / Agent 对话（SSE）。"""
import hashlib
import json
from datetime import datetime

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ai import llm
from ai.prompts import AGENT_SYSTEM_PROMPT, SUMMARIZE_PROMPT
from ai.tools import TOOLS, execute
from db.database import get_db
from db.models import SummaryCache

router = APIRouter()


class SummarizeBody(BaseModel):
    text: str
    force: bool = False


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatBody(BaseModel):
    message: str
    history: list[ChatMessage] = []


class KeyBody(BaseModel):
    api_key: str
    base_url: str | None = None
    model: str | None = None


@router.get("/status")
def ai_status():
    """AI 配置状态，供前端显示「已配置/未配置」。"""
    return {
        "configured": llm.is_configured(),
        "model": llm.model() if llm.is_configured() else None,
        "base_url": llm.base_url() if llm.is_configured() else None,
    }


@router.post("/key")
def set_key(body: KeyBody):
    """保存 API Key（keyring，不落明文）。"""
    from services.secrets import set_secret

    res = set_secret("glm_api_key", body.api_key.strip())
    if body.base_url:
        set_secret("llm_base_url", body.base_url.strip())
    if body.model:
        set_secret("llm_model", body.model.strip())
    return {"ok": True, "backend": res.get("backend")}


@router.post("/test")
def test_connection():
    """用一次最小请求测试 Key 是否可用。"""
    if not llm.is_configured():
        return {"ok": False, "code": "NO_KEY", "message": "尚未配置 API Key"}
    try:
        reply = llm.chat_text(
            [{"role": "user", "content": "只回复两个字：正常"}], temperature=0
        )
        return {"ok": True, "message": f"连接正常，模型回复：{reply.strip()[:20]}"}
    except llm.LLMError as e:
        return {"ok": False, "code": e.code, "message": e.message}


@router.post("/summarize")
def summarize(body: SummarizeBody, db: Session = Depends(get_db)):
    """长通知摘要（走缓存，规格模块 4 能力二）。"""
    text = (body.text or "").strip()
    if not text:
        return {"summary": "", "cached": False}

    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    if not body.force:
        hit = db.get(SummaryCache, digest)
        if hit and hit.summary:
            return {"summary": hit.summary, "cached": True}

    if not llm.is_configured():
        # 无 Key 时给出可读的降级摘要（截断，不做伪 AI 输出）
        short = text.replace("\n", " ")[:80]
        return {
            "summary": f"{short}…",
            "cached": False,
            "degraded": True,
            "message": "未配置 API Key，当前为截断摘要",
        }

    try:
        summary = llm.chat_text(
            [
                {"role": "system", "content": SUMMARIZE_PROMPT},
                {"role": "user", "content": text[:4000]},
            ],
            temperature=0.2,
        ).strip()
    except llm.LLMError as e:
        return {"summary": None, "code": e.code, "message": e.message}

    db.add(SummaryCache(text_hash=digest, summary=summary, created_at=datetime.now().isoformat()))
    db.commit()
    return {"summary": summary, "cached": False}


def _runtime_context(db: Session) -> str:
    """给模型注入当前时间/教学周/数据概况，避免它算错日期。"""
    from datetime import date

    from db.models import CourseSchedule, Setting, Task

    now = datetime.now().astimezone()
    weekdays = "一二三四五六日"
    lines = [
        "## 当前环境",
        f"- 现在：{now.strftime('%Y-%m-%d %H:%M')}（周{weekdays[now.weekday()]}）",
    ]

    week = db.get(Setting, "curriculum_week")
    if week and week.value:
        lines.append(f"- 当前教学周：第 {week.value} 周")

    pending = db.query(Task).filter(Task.status == "pending").count()
    with_ddl = (
        db.query(Task).filter(Task.status == "pending", Task.ddl.isnot(None)).count()
    )
    lines.append(f"- 待办任务：{pending} 条（其中 {with_ddl} 条有明确截止时间）")

    today = date.today()
    courses = db.query(CourseSchedule).filter(CourseSchedule.weekday == today.isoweekday()).all()
    courses.sort(key=lambda r: r.start_time or "")
    if courses:
        brief = "；".join(f"{c.course_abbr or c.course_name} {c.start_time}" for c in courses[:6])
        lines.append(f"- 今天课程：{brief}")
    else:
        lines.append("- 今天没有课")

    return "\n".join(lines)


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


@router.post("/chat")
def chat(body: ChatBody, db: Session = Depends(get_db)):
    """Agent 对话：SSE 返回 + Function Calling（最多 3 轮工具调用）。"""

    def stream():
        if not llm.is_configured():
            yield _sse({"type": "error", "message": "尚未配置 API Key，请到设置页填写后再对话"})
            yield "data: [DONE]\n\n"
            return

        messages: list[dict] = [
            {"role": "system", "content": AGENT_SYSTEM_PROMPT + "\n\n" + _runtime_context(db)}
        ]
        for h in body.history[-8:]:
            if h.role in ("user", "assistant") and h.content:
                messages.append({"role": h.role, "content": h.content})
        messages.append({"role": "user", "content": body.message})

        try:
            for _ in range(3):
                data = llm.chat(messages, tools=TOOLS)
                msg = data["choices"][0]["message"]
                tool_calls = msg.get("tool_calls") or []

                if not tool_calls:
                    yield _sse({"type": "message", "content": msg.get("content") or ""})
                    yield "data: [DONE]\n\n"
                    return

                messages.append(
                    {
                        "role": "assistant",
                        "content": msg.get("content") or "",
                        "tool_calls": tool_calls,
                    }
                )
                for call in tool_calls:
                    fn = call["function"]["name"]
                    try:
                        args = json.loads(call["function"].get("arguments") or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    yield _sse({"type": "tool", "name": fn, "args": args})
                    result = execute(fn, args, db)
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": call.get("id"),
                            "content": json.dumps(result, ensure_ascii=False)[:4000],
                        }
                    )

            yield _sse({"type": "error", "message": "工具调用轮次过多，已中止"})
        except llm.LLMError as e:
            yield _sse({"type": "error", "message": f"{e.message}（{e.code}）"})
        except Exception as e:  # noqa: BLE001
            yield _sse({"type": "error", "message": f"服务异常：{type(e).__name__}: {e}"})
        yield "data: [DONE]\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")
