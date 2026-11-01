"""账号：邀请码注册 / 邮箱登录 / 我 / 邀请码管理。

设计：
- 一个邮箱 = 一个空间（space），数据互不可见
- 登录成功发一个设备 token（和配对码等价，但不用扫码）
- 邀请码只能由本机（X-Admin-Token）生成
"""

from __future__ import annotations

from fastapi import APIRouter, Header, Request
from pydantic import BaseModel

from db.database import get_db
from db.models import Device, InviteCode, Space, User
from fastapi import Depends
from services import local_auth
from services.space import (
    check_password,
    create_invite,
    device_by_token,
    login as do_login,
    make_device,
    now_iso,
    register_with_invite,
)
from sqlalchemy.orm import Session

router = APIRouter(prefix="/auth", tags=["auth"])

# 登录/注册限流：同一来源每分钟最多 10 次，防暴力猜测
_AUTH_HITS: dict[str, list[float]] = {}
_AUTH_LIMIT = 10
_AUTH_WINDOW = 60.0


def _auth_throttled(host: str) -> bool:
    import time

    now = time.time()
    hits = [t for t in _AUTH_HITS.get(host, []) if now - t < _AUTH_WINDOW]
    if len(hits) >= _AUTH_LIMIT:
        _AUTH_HITS[host] = hits
        return True
    hits.append(now)
    _AUTH_HITS[host] = hits
    return False


CONSENT_VERSION = "2026-11-01"


class RegisterBody(BaseModel):
    email: str
    password: str
    invite: str
    device_name: str = "手机"
    agree: bool = False


class LoginBody(BaseModel):
    email: str
    password: str
    device_name: str = "手机"


class InviteBody(BaseModel):
    note: str = ""
    ttl_days: int = 7


def _device_payload(device: Device, token: str, email: str) -> dict:
    return {
        "ok": True,
        "token": token,
        "device_id": device.id,
        "space_id": device.space_id,
        "email": email,
        "device_name": device.name,
    }


@router.post("/register")
def register(body: RegisterBody, request: Request):
    if _auth_throttled(request.client.host if request.client else "?"):
        return {"ok": False, "message": "尝试太频繁，请稍后再试"}
    """邀请码注册：成功后直接拿到 token（免再登录一次）。"""
    if not body.agree:
        return {
            "ok": False,
            "code": "NEED_CONSENT",
            "message": "请先阅读并同意《使用协议与免责声明》",
        }

    user, err = register_with_invite(
        body.email, body.password, body.invite, CONSENT_VERSION if body.agree else ""
    )
    if not user:
        return {"ok": False, "message": err}
    device, token = make_device(user.space_id, body.device_name or "手机", "android")
    return _device_payload(device, token, user.email)


@router.post("/login")
def login(body: LoginBody, request: Request):
    if _auth_throttled(request.client.host if request.client else "?"):
        return {"ok": False, "message": "尝试太频繁，请稍后再试"}
    user = do_login(body.email, body.password)
    if not user:
        return {"ok": False, "message": "邮箱或密码不对"}
    device, token = make_device(user.space_id, body.device_name or "手机", "android")
    return _device_payload(device, token, user.email)


@router.get("/me")
def me(authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    device = device_by_token((authorization or "").replace("Bearer ", "").strip())
    if not device:
        return {"ok": False, "message": "未登录"}
    user = db.query(User).filter(User.space_id == device.space_id).first()
    return {
        "ok": True,
        "email": user.email if user else "",
        "space_id": device.space_id,
        "device": {"id": device.id, "name": device.name, "platform": device.platform},
    }


@router.post("/logout")
def logout(authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    device = device_by_token((authorization or "").replace("Bearer ", "").strip())
    if not device:
        return {"ok": True}
    row = db.get(Device, device.id)
    if row and not row.revoked_at:
        row.revoked_at = now_iso()
        db.commit()
    return {"ok": True}


@router.post("/invite")
def create_invite_code(body: InviteBody, request: Request):
    """生成邀请码（只能在本机生成）。"""
    if not local_auth.is_admin(request.headers.get("x-admin-token")):
        return {"ok": False, "code": "LOCAL_ONLY", "message": "邀请码只能在电脑本机生成"}
    row = create_invite(body.note or "", max(1, min(body.ttl_days, 365)))
    return {"ok": True, "code": row.code, "expires_at": row.expires_at}


@router.get("/invites")
def list_invites(request: Request, db: Session = Depends(get_db)):
    if not local_auth.is_admin(request.headers.get("x-admin-token")):
        return {"ok": False, "code": "LOCAL_ONLY", "message": "只能在本机查看"}
    rows = db.query(InviteCode).order_by(InviteCode.created_at.desc()).limit(50).all()
    return {
        "ok": True,
        "items": [
            {
                "code": r.code,
                "note": r.note,
                "expires_at": r.expires_at,
                "used_at": r.used_at,
                "used_by_email": r.used_by_email,
            }
            for r in rows
        ],
    }


@router.get("/users")
def list_users(request: Request, db: Session = Depends(get_db)):
    """本机查看已注册账号（仅邮箱和注册时间，不含密码）。"""
    if not local_auth.is_admin(request.headers.get("x-admin-token")):
        return {"ok": False, "code": "LOCAL_ONLY", "message": "只能在本机查看"}
    rows = db.query(User).order_by(User.id.desc()).limit(100).all()
    return {
        "ok": True,
        "items": [{"email": u.email, "space_id": u.space_id, "created_at": u.created_at} for u in rows],
    }


class ProfileBody(BaseModel):
    display_name: str | None = None
    avatar: str | None = None


def _space_of(authorization: str | None, db: Session) -> Space | None:
    device = device_by_token((authorization or "").replace("Bearer ", "").strip())
    if not device:
        return None
    return db.get(Space, device.space_id)


@router.get("/profile")
def get_profile(authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    """当前账号资料（昵称 / 头像）。"""
    space = _space_of(authorization, db)
    if not space:
        return {"ok": False, "message": "未登录"}
    user = db.query(User).filter(User.space_id == space.id).first()
    return {
        "ok": True,
        "email": user.email if user else "",
        "display_name": space.display_name or "",
        "avatar": space.avatar or "",
    }


@router.put("/profile")
def put_profile(
    body: ProfileBody,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """改昵称/头像。头像用 data URL，限 256KB（手机上会自动压到 128px）。"""
    space = _space_of(authorization, db)
    if not space:
        return {"ok": False, "message": "未登录"}

    if body.display_name is not None:
        space.display_name = body.display_name.strip()[:24]

    if body.avatar is not None:
        avatar = body.avatar.strip()
        if avatar and not avatar.startswith("data:image/"):
            return {"ok": False, "message": "头像格式不对"}
        if len(avatar) > 256 * 1024:
            return {"ok": False, "message": "头像太大（请压到 256KB 以内）"}
        space.avatar = avatar

    space_name_changed = body.display_name is not None
    if space_name_changed and body.display_name:
        space.name = body.display_name.strip()[:24]

    db.commit()
    return {"ok": True, "display_name": space.display_name or "", "avatar": space.avatar or ""}
