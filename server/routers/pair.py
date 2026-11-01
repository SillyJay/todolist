"""配对 / 设备 / 账号 / 恢复码 路由。

规则：
- 生成配对码只允许本机（127.0.0.1），避免局域网里任何人随手生成
- 配对成功返回一次性 token，之后手机用 Authorization: Bearer <token>
- 账号可选：绑定邮箱后换设备可登录找回同一个 space
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Device, Event, Space, User
from services import local_auth
from services import space as svc

router = APIRouter()
# ---------------------------------------------------------------- 配对限流
# 6 位码只有 100 万种，公网暴露（测试隧道）时必须限流，否则能被爆破。
# 规则：同一 IP 每分钟最多 5 次，超了直接 429。
_PAIR_HITS: dict[str, list[float]] = {}
_PAIR_LIMIT = 5
_PAIR_WINDOW = 60.0


def _pair_hit(ip: str) -> bool:
    """记一次尝试；返回 True 表示超限。"""
    import time

    now = time.time()
    hits = [t for t in _PAIR_HITS.get(ip, []) if now - t < _PAIR_WINDOW]
    hits.append(now)
    _PAIR_HITS[ip] = hits
    return len(hits) > _PAIR_LIMIT



# ---------------------------------------------------------------- 模型

class PairBody(BaseModel):
    code: str
    device_name: str = "我的手机"
    platform: str = "android"


class RegisterBody(BaseModel):
    email: str
    password: str


class LoginBody(BaseModel):
    email: str
    password: str


class RecoveryBody(BaseModel):
    code: str


# ---------------------------------------------------------------- 鉴权

def current_device(authorization: str | None = Header(default=None)) -> Device | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    return svc.device_by_token(authorization.split(" ", 1)[1].strip())


def current_space(
    request: Request,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> Space:
    """解析当前空间。

    优先用设备 token；没有 token 时只允许本机访问（桌面端自己），
    这样即使局域网里有人扫到端口，也拿不到数据。
    """
    device = current_device(authorization)
    if device:
        row = db.get(Space, device.space_id)
        if row:
            return row
    # 本机（桌面 App）用密钥证明身份；不能用来源 IP，
    # 否则挂了隧道/反代之后所有请求都来自 127.0.0.1，等于对公网敞开。
    if local_auth.is_admin(request.headers.get("x-admin-token")):
        return svc.get_or_create_space()
    from fastapi import HTTPException

    raise HTTPException(status_code=401, detail="未配对设备")


# ---------------------------------------------------------------- 配对

@router.post("/code")
def create_code(request: Request, ttl: int = 300):
    """桌面端生成配对码（只有持有本机密钥的进程能调用）。

    ttl：有效期秒数，默认 300（5 分钟）。测试隧道时可用 ttl=1800 拉长，
    最长 3600（1 小时），避免一直抢时间。
    """
    if not local_auth.is_admin(request.headers.get("x-admin-token")):
        return {"ok": False, "code": "LOCAL_ONLY", "message": "配对码只能在电脑本机生成"}
    ttl = max(60, min(int(ttl or 300), 3600))
    space = svc.get_or_create_space()
    row = svc.create_pairing_code(space.id, ttl_seconds=ttl)
    return {
        "ok": True,
        "code": row.code,
        "expires_at": row.expires_at,
        "space_id": space.id,
        "ttl": ttl,
    }


@router.post("")
def pair(body: PairBody, request: Request):
    """手机用 6 位码换取设备 token。"""
    from fastapi import HTTPException

    ip = (request.client.host or "unknown") if request.client else "unknown"
    if _pair_hit(ip):
        raise HTTPException(status_code=429, detail="尝试太频繁，请 1 分钟后再试")
    result = svc.consume_pairing_code(body.code, body.device_name, body.platform)
    if not result:
        print(f"[pair] 配对失败 code={body.code!r} device={body.device_name!r} ip={ip}")
        return {"ok": False, "code": "BAD_CODE", "message": "配对码无效或已过期"}
    device, token = result
    return {
        "ok": True,
        "token": token,
        "device_id": device.id,
        "space_id": device.space_id,
        "device_name": device.name,
    }


@router.get("/devices")
def devices(space: Space = Depends(current_space)):
    rows = svc.list_devices(space.id)
    return {
        "items": [
            {
                "id": d.id,
                "name": d.name,
                "platform": d.platform,
                "created_at": d.created_at,
                "last_seen": d.last_seen,
            }
            for d in rows
        ]
    }


@router.delete("/devices/{device_id}")
def revoke(device_id: str, space: Space = Depends(current_space)):
    ok = svc.revoke_device(space.id, device_id)
    return {"ok": ok}


# ---------------------------------------------------------------- 账号

@router.post("/register")
def register(body: RegisterBody):
    user, err = svc.register_user(body.email, body.password)
    if not user:
        return {"ok": False, "code": "BAD_INPUT", "message": err}
    return {"ok": True, "space_id": user.space_id, "email": user.email}


@router.post("/login")
def login(body: LoginBody):
    user = svc.login(body.email, body.password)
    if not user:
        return {"ok": False, "code": "BAD_CREDENTIAL", "message": "邮箱或密码不对"}
    device, token = svc.make_device(user.space_id, "登录设备", "android")
    return {"ok": True, "token": token, "device_id": device.id, "space_id": user.space_id}


@router.get("/me")
def me(space: Space = Depends(current_space), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.space_id == space.id).first()
    devices_count = len(svc.list_devices(space.id))
    return {
        "space_id": space.id,
        "space_name": space.name,
        "email": user.email if user else None,
        "devices": devices_count,
        "recovery_set": bool(space.recovery_hash),
    }


@router.post("/recovery")
def recovery(body: RecoveryBody):
    """用恢复码验证身份（第一版只做校验，方便后续重设密码）。"""
    space = svc.verify_recovery(body.code)
    if not space:
        return {"ok": False, "code": "BAD_RECOVERY", "message": "恢复码不对"}
    return {"ok": True, "space_id": space.id, "space_name": space.name}


# ---------------------------------------------------------------- 恢复码（本机查看）

@router.post("/recovery/rotate")
def rotate_recovery(request: Request):
    if not local_auth.is_admin(request.headers.get("x-admin-token")):
        return {"ok": False, "code": "LOCAL_ONLY", "message": "恢复码只能在本机重置"}
    space = svc.get_or_create_space()
    code = svc.rotate_recovery(space)
    return {"ok": True, "recovery": code}


# ---------------------------------------------------------------- 联调自检

@router.get("/debug/events")
def debug_events(space: Space = Depends(current_space), db: Session = Depends(get_db)):
    """手机还没做出来时，用它确认「鉴权 + 空间隔离」是否生效。"""
    rows = (
        db.query(Event)
        .filter(Event.space_id == space.id)
        .order_by(Event.date.asc())
        .limit(20)
        .all()
    )
    return {
        "space_id": space.id,
        "count": len(rows),
        "events": [
            {"id": e.id, "title": e.title, "date": e.date, "start": e.start, "end": e.end}
            for e in rows
        ],
    }
