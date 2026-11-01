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


class RecoveryBody(BaseModel):
    email: str
    recovery: str
    new_password: str
    device_name: str = "桌面端"


@router.post("/recovery")
def recovery_login(body: RecoveryBody):
    """忘记密码：邮箱 + 恢复码 → 重设密码并直接登录。"""
    from services.space import (
        make_device,
        new_recovery_for_space,
        reset_password_with_recovery,
    )

    ok, why, space_id = reset_password_with_recovery(
        body.email, body.recovery, body.new_password
    )
    if not ok:
        return {"ok": False, "message": why}

    device, token = make_device(space_id, body.device_name or "桌面端", "desktop")
    user = None
    try:
        from db.database import SessionLocal

        db = SessionLocal()
        user = db.query(User).filter(User.space_id == space_id).first()
        email = user.email if user else body.email
        db.close()
    except Exception:  # noqa: BLE001
        email = body.email

    return {
        "ok": True,
        "token": token,
        "email": email,
        "space_id": space_id,
        "device_id": device.id,
        "new_recovery": new_recovery_for_space(space_id),
    }


@router.post("/recovery/rotate")
def rotate_recovery_code(authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    """登录状态下换一个新的恢复码（旧的立即失效）。"""
    from services.space import new_recovery_for_space

    device = device_by_token((authorization or "").replace("Bearer ", "").strip())
    if not device:
        return {"ok": False, "message": "未登录"}
    code = new_recovery_for_space(device.space_id)
    return {"ok": True, "recovery": code}


@router.get("/recovery/status")
def recovery_status(authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    device = device_by_token((authorization or "").replace("Bearer ", "").strip())
    if not device:
        return {"ok": False, "message": "未登录"}
    space = db.get(Space, device.space_id)
    return {"ok": True, "recovery_set": bool(space and space.recovery_hash)}


@router.post("/bind-local")
def bind_local(
    request: Request,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """把本机数据绑定到当前登录的账号空间（桌面端登录后调用）。

    - 记录 local_space_id，之后本地采集都写进这个空间
    - 把此前挂在默认空间的数据迁移过来（任务/日程/消息/课表/文件）
    """
    from services.local_auth import is_admin
    from services.space import get_or_create_space

    if not is_admin(request.headers.get("x-admin-token")):
        return {"ok": False, "code": "LOCAL_ONLY", "message": "只能在本机绑定"}

    device = device_by_token((authorization or "").replace("Bearer ", "").strip())
    if not device:
        return {"ok": False, "message": "未登录"}

    target = device.space_id
    default_space = get_or_create_space()
    moved = 0

    if default_space.id != target:
        from sqlalchemy import text

        for table in ("tasks", "events", "wechat_messages", "course_schedule", "files", "daily_plans"):
            try:
                r = db.execute(
                    text(f"UPDATE {table} SET space_id=:to WHERE space_id IS NULL OR space_id=:from_"),
                    {"to": target, "from_": default_space.id},
                )
                moved += r.rowcount or 0
            except Exception:  # noqa: BLE001
                continue
        db.commit()

    # 保存 token 供云端同步使用
    try:
        from services.secrets import set_secret

        raw = (authorization or "").replace("Bearer ", "").strip()
        if raw:
            set_secret("cloud_token", raw)
    except Exception:  # noqa: BLE001
        pass

    from db.models import Setting

    row = db.get(Setting, "local_space_id")
    if row:
        row.value = target
    else:
        db.add(Setting(key="local_space_id", value=target))
    db.commit()

    return {"ok": True, "space_id": target, "moved_rows": moved}


class EmailCodeBody(BaseModel):
    email: str


class ResetByCodeBody(BaseModel):
    email: str
    code: str
    new_password: str
    device_name: str = "桌面端"


@router.get("/email/status")
def email_status(db: Session = Depends(get_db)):
    """前端据此决定是否显示「邮箱验证码」入口。"""
    from services.mail import configured

    return {"ok": True, "configured": configured(db)}


@router.post("/email/send-code")
def send_email_code(body: EmailCodeBody, db: Session = Depends(get_db)):
    from services.mail import issue_code

    err, _ = issue_code(db, body.email)
    if err:
        return {"ok": False, "message": err}
    return {"ok": True, "message": "验证码已发送"}


@router.post("/reset-by-code")
def reset_by_code(body: ResetByCodeBody, db: Session = Depends(get_db)):
    """用邮箱验证码重设密码并登录。"""
    from services.mail import verify_code
    from services.space import hash_password, make_device, new_recovery_for_space

    if len(body.new_password or "") < 6:
        return {"ok": False, "message": "新密码至少 6 位"}
    if not verify_code(db, body.email, body.code):
        return {"ok": False, "message": "验证码不对或已过期"}

    email = (body.email or "").strip().lower()
    user = db.query(User).filter(User.email == email).first()
    if not user:
        return {"ok": False, "message": "邮箱不存在"}

    user.password_hash = hash_password(body.new_password)
    db.commit()

    device, token = make_device(user.space_id, body.device_name or "桌面端", "desktop")
    return {
        "ok": True,
        "token": token,
        "email": email,
        "space_id": user.space_id,
        "device_id": device.id,
        "new_recovery": new_recovery_for_space(user.space_id),
    }


class SmtpBody(BaseModel):
    host: str
    port: int = 465
    user: str
    password: str | None = None
    sender: str = ""
    ssl: bool = True


@router.get("/email/config")
def get_smtp_config(request: Request, db: Session = Depends(get_db)):
    from services.local_auth import is_admin
    from db.models import Setting

    if not is_admin(request.headers.get("x-admin-token")):
        return {"ok": False, "message": "只能在本机查看"}

    def get(key: str) -> str:
        row = db.get(Setting, key)
        return (row.value if row and row.value else "") or ""

    return {
        "ok": True,
        "host": get("smtp_host"),
        "port": get("smtp_port") or "465",
        "user": get("smtp_user"),
        "sender": get("smtp_from"),
        "ssl": get("smtp_ssl") or "1",
    }


@router.post("/email/config")
def save_smtp_config(body: SmtpBody, request: Request, db: Session = Depends(get_db)):
    from services.local_auth import is_admin
    from services.secrets import set_secret
    from db.models import Setting

    if not is_admin(request.headers.get("x-admin-token")):
        return {"ok": False, "message": "只能在本机设置"}

    def put(key: str, value: str) -> None:
        row = db.get(Setting, key)
        if row:
            row.value = value
        else:
            db.add(Setting(key=key, value=value))

    put("smtp_host", body.host.strip())
    put("smtp_port", str(int(body.port or 465)))
    put("smtp_user", body.user.strip())
    put("smtp_from", (body.sender or body.user).strip())
    put("smtp_ssl", "1" if body.ssl else "0")
    if body.password:
        set_secret("smtp_password", body.password)
    db.commit()
    return {"ok": True}


@router.post("/email/test")
def test_smtp(request: Request, db: Session = Depends(get_db)):
    from services.local_auth import is_admin
    from services.mail import _cfg, configured, send_mail

    if not is_admin(request.headers.get("x-admin-token")):
        return {"ok": False, "message": "只能在本机测试"}
    if not configured(db):
        return {"ok": False, "message": "还没配置 SMTP"}

    to = (_cfg(db).get("user") or "").strip()
    ok, err = send_mail(db, to, "ToDoList SMTP 测试", "如果你收到这封邮件，说明 SMTP 配置正确。")
    return {"ok": ok, "message": err or f"已发送到 {to}"}
