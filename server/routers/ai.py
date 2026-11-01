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
    provider: str | None = None


class ModelsBody(BaseModel):
    provider: str | None = None
    api_key: str | None = None
    base_url: str | None = None


class ProviderBody(BaseModel):
    api_key: str | None = None
    base_url: str | None = None
    models: list[str] | None = None
    # 用户勾选、要在对话框里可选的模型
    enabled_models: list[str] | None = None


class ThinkingBody(BaseModel):
    level: str = "auto"


class ActiveBody(BaseModel):
    provider: str
    model: str | None = None


class ParseEventBody(BaseModel):
    text: str
    # 客户端可传当前时间，保证「明天」按用户设备的日期算
    now: str | None = None


@router.post("/parse-event")
def ai_parse_event(body: ParseEventBody):
    """把一句话解析成日程/任务（语音输入走这里）。"""
    from datetime import datetime

    from services.parse_event import parse_event

    now = None
    if body.now:
        try:
            now = datetime.fromisoformat(body.now)
        except ValueError:
            now = None
    parsed = parse_event(body.text, now)
    return {"ok": True, **parsed}


@router.get("/thinking")
def ai_thinking():
    """对话页右下角的思考强度。"""
    return {"level": llm.thinking_level(), "levels": list(llm.THINKING_LEVELS)}


@router.post("/thinking")
def ai_set_thinking(body: ThinkingBody):
    return {"ok": True, "level": llm.set_thinking_level(body.level)}


@router.get("/models")
def ai_model_catalog():
    """对话页的模型选择器：已配置的服务商 + 各自模型。"""
    from ai.providers import available_models

    return {"items": available_models(), "provider": llm.provider_id(), "model": llm.model()}


@router.post("/active")
def ai_set_active(body: ActiveBody):
    """切换当前服务商/模型（对话页与设置页共用）。"""
    from ai.providers import get_provider, merged_provider, set_key  # noqa: F401
    from ai.providers import current_provider_id, provider_models
    from services.secrets import set_secret

    pid = (body.provider or "").strip()
    p = merged_provider(pid)
    if not p or not p.get("id"):
        return {"ok": False, "code": "BAD_PROVIDER", "message": f"未知服务商：{pid}"}
    set_secret("llm_provider", pid)
    model = (body.model or "").strip()
    models = p.get("models") or provider_models(pid)
    if not model or model not in models:
        model = models[0] if models else ""
    set_secret("llm_model", model)
    # 切服务商时把旧的 base_url 覆盖清掉，避免串到别的服务商
    set_secret("llm_base_url", "")
    return {"ok": True, "provider": pid, "model": model, "configured": bool(p.get("configured"))}


@router.put("/providers/{pid}")
def ai_save_provider(pid: str, body: ProviderBody):
    """保存某个服务商的配置（Key + 可选 base_url / 模型清单）。"""
    from ai.providers import get_provider, merged_provider, set_key, update_provider

    if not get_provider(pid):
        return {"ok": False, "code": "BAD_PROVIDER", "message": f"未知服务商：{pid}"}
    if body.api_key is not None:
        set_key(pid, body.api_key)
    update_provider(pid, base_url=body.base_url, models=body.models, enabled=body.enabled_models)
    mp = merged_provider(pid)
    return {"ok": True, "provider": mp}


@router.delete("/providers/{pid}")
def ai_delete_provider(pid: str):
    """清除某个服务商的 Key 与自定义配置。"""
    from ai.providers import current_provider_id, reset_provider

    reset_provider(pid)
    if current_provider_id() == pid:
        from services.secrets import set_secret

        set_secret("llm_provider", "")
        set_secret("llm_model", "")
    return {"ok": True}


@router.get("/providers")
def ai_providers():
    """可选模型服务商（未选择任何默认；GLM 标为推荐）。"""
    from ai.providers import list_providers

    return {"items": list_providers(), "current": llm.provider_id()}


@router.post("/models")
def ai_models(body: ModelsBody):
    """拉取某服务商的可用模型列表。

    顺序：先带 Key 问服务商 → 失败退回内置清单 → 都没有则返回 auto。
    """
    from ai.providers import fetch_models, get_provider, provider_models

    pid = (body.provider or llm.provider_id() or "").strip()
    p = get_provider(pid)
    base = (body.base_url or (p or {}).get("base_url") or "").strip()
    key = (body.api_key or llm.api_key() or "").strip()

    remote: list[str] = []
    err = ""
    if key and base:
        remote, err = fetch_models(key, base)

    builtin = provider_models(pid)

    # 上游 /models 不一定列全（智谱就不返回免费的 glm-4.7-flash），
    # 所以做并集：内置的排前面，再补上游多出来的。
    if remote:
        merged = list(dict.fromkeys(list(builtin) + list(remote)))
        return {"models": merged, "source": "remote+builtin", "provider": pid, "error": ""}

    if builtin:
        return {"models": builtin, "source": "builtin", "provider": pid, "error": err}

    return {"models": [], "source": "none", "provider": pid, "error": err, "auto": True}


@router.get("/status")
def ai_status():
    """AI 配置状态，供前端显示「已配置/未配置」。"""
    from ai.providers import get_provider

    pid = llm.provider_id()
    p = get_provider(pid)
    return {
        "configured": llm.is_configured(),
        "provider": pid,
        "provider_name": (p or {}).get("name", ""),
        "recommended": bool((p or {}).get("recommended")),
        "model": llm.model() if llm.is_configured() else None,
        "base_url": llm.base_url() if llm.is_configured() else None,
        "thinking": llm.thinking_level(),
    }


@router.post("/key")
def set_key(body: KeyBody):
    """保存 API Key（keyring，不落明文）+ 记录服务商与模型选择。"""
    from ai.providers import get_provider, set_provider
    from services.secrets import set_secret

    pid = (body.provider or "").strip()
    if pid:
        if not get_provider(pid):
            return {"ok": False, "code": "BAD_PROVIDER", "message": f"未知服务商：{pid}"}
        set_provider(pid)

    res = set_secret("glm_api_key", body.api_key.strip())
    # 换服务商时清掉上一家的 base_url/model，避免串味
    if pid and not body.base_url:
        set_secret("llm_base_url", "")
    if body.base_url:
        set_secret("llm_base_url", body.base_url.strip())
    if body.model:
        set_secret("llm_model", body.model.strip())
    return {"ok": True, "backend": res.get("backend")}


@router.post("/model")
def set_model(body: dict):
    """只切换模型（不动 Key），供对话页的模型下拉使用。"""
    from services.secrets import set_secret

    model = str(body.get("model") or "").strip()
    if not model:
        return {"ok": False, "message": "缺少 model"}
    set_secret("llm_model", model)
    return {"ok": True, "model": model}


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
                data = llm.chat(messages, tools=TOOLS, thinking=False)
                msg = data["choices"][0]["message"]
                tool_calls = msg.get("tool_calls") or []

                if not tool_calls:
                    # 最终答案这一轮改成流式：逐段下发 delta，最后用 message 收口
                    pieces: list[str] = []
                    stream_failed = ""
                    try:
                        for piece in llm.chat_stream(messages):
                            pieces.append(piece)
                            yield _sse({"type": "delta", "content": piece})
                    except llm.LLMError as e:
                        stream_failed = e.message
                    text = "".join(pieces) or (msg.get("content") or "")
                    if not text and stream_failed:
                        yield _sse({"type": "error", "message": stream_failed})
                        yield "data: [DONE]\n\n"
                        return
                    yield _sse({"type": "message", "content": text})
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
