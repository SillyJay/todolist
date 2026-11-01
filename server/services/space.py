"""空间 / 设备 / 配对 的底层逻辑。

设计要点（和移动端方案对应）：
- space 是数据归属，电脑首次启动时自动创建一个（uuid）
- 账号可选：绑定邮箱后可在换手机/换电脑时找回同一个 space
- 配对码一次性、5 分钟；手机拿到 device token 后长期使用
- 恢复码只在「账号也进不去」时用，只存 hash
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import uuid
from datetime import datetime, timedelta

from db.database import SessionLocal
from db.models import Device, PairingCode, Space, User

DEFAULT_SPACE_KEY = "default_space_id"
RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 去掉易混的 I/O/0/1


def _detach(db, obj):
    """把对象从 session 摘出来，避免关闭连接后读属性报 DetachedInstanceError。"""
    try:
        db.refresh(obj)
        db.expunge(obj)
    except Exception:  # noqa: BLE001
        pass
    return obj


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------- space

def get_or_create_space() -> Space:
    """取当前 space；没有就建一个（并生成恢复码）。"""
    from db.models import Setting

    db = SessionLocal()
    try:
        row = db.get(Setting, DEFAULT_SPACE_KEY)
        space = db.get(Space, row.value) if row and row.value else None
        if space and not space.recovery_hash:
            space.recovery_hash = _hash(gen_recovery_code())
            db.commit()
        if space:
            return _detach(db, space)

        space = Space(
            id=str(uuid.uuid4()),
            name="我的空间",
            recovery_hash=_hash(gen_recovery_code()),
            created_at=now_iso(),
        )
        db.add(space)
        if row:
            row.value = space.id
        else:
            db.add(Setting(key=DEFAULT_SPACE_KEY, value=space.id))
        db.commit()
        return _detach(db, space)
    finally:
        db.close()


def gen_recovery_code() -> str:
    """32 位恢复码，8 组 4 位，方便抄写。"""
    raw = "".join(secrets.choice(RECOVERY_ALPHABET) for _ in range(32))
    return "-".join(raw[i : i + 4] for i in range(0, 32, 4))


def normalize_recovery(code: str) -> str:
    return "".join(ch for ch in (code or "").upper() if ch.isalnum())


def verify_recovery(code: str) -> Space | None:
    target = _hash(normalize_recovery(code))
    db = SessionLocal()
    try:
        for space in db.query(Space).all():
            if space.recovery_hash and hmac.compare_digest(space.recovery_hash, target):
                return space
        return None
    finally:
        db.close()


def rotate_recovery(space: Space) -> str:
    code = gen_recovery_code()
    db = SessionLocal()
    try:
        row = db.get(Space, space.id)
        if row:
            row.recovery_hash = _hash(normalize_recovery(code))
            db.commit()
        return code
    finally:
        db.close()


# ---------------------------------------------------------------- device / token

def make_device(space_id: str, name: str, platform: str = "android") -> tuple[Device, str]:
    """创建一台设备并返回 (device, 明文 token)。token 只在这里出现一次。"""
    token = secrets.token_urlsafe(32)
    device = Device(
        id=str(uuid.uuid4()),
        space_id=space_id,
        name=(name or "未命名设备")[:40],
        platform=platform,
        token_hash=_hash(token),
        created_at=now_iso(),
        last_seen=now_iso(),
    )
    db = SessionLocal()
    try:
        db.add(device)
        db.commit()
        return _detach(db, device), token
    finally:
        db.close()


def device_by_token(token: str) -> Device | None:
    if not token:
        return None
    db = SessionLocal()
    try:
        d = db.query(Device).filter(Device.token_hash == _hash(token)).first()
        if not d or d.revoked_at:
            return None
        d.last_seen = now_iso()
        db.commit()
        return _detach(db, d)
    finally:
        db.close()


def list_devices(space_id: str) -> list[Device]:
    db = SessionLocal()
    try:
        return (
            db.query(Device)
            .filter(Device.space_id == space_id, Device.revoked_at.is_(None))
            .order_by(Device.created_at.desc())
            .all()
        )
    finally:
        for d in locals().get("rows", []) or []:
            _detach(db, d)
        db.close()


def revoke_device(space_id: str, device_id: str) -> bool:
    db = SessionLocal()
    try:
        d = db.get(Device, device_id)
        if not d or d.space_id != space_id:
            return False
        d.revoked_at = now_iso()
        db.commit()
        return True
    finally:
        db.close()


# ---------------------------------------------------------------- pairing

def create_pairing_code(space_id: str, ttl_seconds: int = 300) -> PairingCode:
    db = SessionLocal()
    try:
        # 只清理「已过期」的旧码。
        # 以前是全部删掉，导致用户手上拿着上一分钟生成的码却提示「无效」。
        from datetime import datetime as _dt

        now_ts = _dt.now().astimezone()
        for old in db.query(PairingCode).filter(PairingCode.space_id == space_id).all():
            try:
                if _dt.fromisoformat(old.expires_at) < now_ts:
                    db.delete(old)
            except (ValueError, TypeError):
                db.delete(old)
        db.commit()

        for _ in range(20):
            code = f"{secrets.randbelow(1_000_000):06d}"
            if not db.get(PairingCode, code):
                break
        row = PairingCode(
            code=code,
            space_id=space_id,
            expires_at=(datetime.now() + timedelta(seconds=ttl_seconds)).astimezone().isoformat(
                timespec="seconds"
            ),
            created_at=now_iso(),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row
    finally:
        db.close()


def consume_pairing_code(code: str, device_name: str, platform: str) -> tuple[Device, str] | None:
    """用配对码换设备 token；码一次性、过期失效。"""
    db = SessionLocal()
    try:
        row = db.get(PairingCode, (code or "").strip())
        if not row or row.used_at:
            return None
        try:
            if datetime.fromisoformat(row.expires_at) < datetime.now().astimezone():
                return None
        except ValueError:
            return None
        row.used_at = now_iso()
        db.commit()
        space_id = row.space_id
    finally:
        db.close()
    return make_device(space_id, device_name, platform)


# ---------------------------------------------------------------- account

def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000)
    return f"pbkdf2$200000${salt.hex()}${dk.hex()}"


def check_password(password: str, stored: str) -> bool:
    try:
        scheme, rounds, salt_hex, dk_hex = (stored or "").split("$")
        if scheme != "pbkdf2":
            return False
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(rounds)
        )
        return hmac.compare_digest(dk.hex(), dk_hex)
    except (ValueError, TypeError):
        return False


def register_user(email: str, password: str) -> tuple[User | None, str]:
    email = (email or "").strip().lower()
    if "@" not in email:
        return None, "邮箱格式不对"
    if len(password or "") < 8:
        return None, "密码至少 8 位"

    space = get_or_create_space()
    db = SessionLocal()
    try:
        if db.query(User).filter(User.email == email).first():
            return None, "这个邮箱已经注册过"
        user = User(
            space_id=space.id,
            email=email,
            password_hash=hash_password(password),
            consent_version=consent_version,
            consent_at=now_iso(),
            created_at=now_iso(),
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user, ""
    finally:
        db.close()


def login(email: str, password: str) -> User | None:
    email = (email or "").strip().lower()
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if user and check_password(password, user.password_hash or ""):
            return user
        return None
    finally:
        db.close()

# ---------------------------------------------------------------- 邀请码

_INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def create_invite(note: str = "", ttl_days: int = 7) -> "InviteCode":
    """生成邀请码（默认 7 天有效）。"""
    import secrets
    from datetime import datetime, timedelta

    from db.database import SessionLocal
    from db.models import InviteCode

    db = SessionLocal()
    try:
        for _ in range(20):
            code = "".join(secrets.choice(_INVITE_ALPHABET) for _ in range(8))
            if not db.query(InviteCode).filter(InviteCode.code == code).first():
                break
        row = InviteCode(
            code=code,
            note=note[:100],
            expires_at=(datetime.now().astimezone() + timedelta(days=ttl_days)).isoformat(timespec="seconds"),
            created_at=now_iso(),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        db.expunge(row)
        return row
    finally:
        db.close()


def consume_invite(code: str, email: str) -> tuple[bool, str]:
    """用掉一个邀请码。返回 (成功, 原因)。"""
    from db.database import SessionLocal
    from db.models import InviteCode

    db = SessionLocal()
    try:
        row = db.get(InviteCode, (code or "").strip().upper())
        if not row:
            return False, "邀请码无效"
        if row.used_at:
            return False, "邀请码已被使用"
        if row.expires_at and row.expires_at < now_iso():
            return False, "邀请码已过期"
        row.used_at = now_iso()
        row.used_by_email = (email or "").strip().lower()
        db.commit()
        return True, ""
    finally:
        db.close()


def register_with_invite(
    email: str, password: str, invite: str, consent_version: str = ""
) -> tuple[User | None, str]:
    """邀请码注册：建空间 + 账号（必须已同意协议）。"""
    if not consent_version:
        return None, "需要先同意《使用协议与免责声明》"

    email = (email or "").strip().lower()
    if "@" not in email or len(email) < 6:
        return None, "邮箱格式不对"
    if len(password or "") < 6:
        return None, "密码至少 6 位"

    from db.database import SessionLocal
    from db.models import Space

    db = SessionLocal()
    try:
        if db.query(User).filter(User.email == email).first():
            return None, "这个邮箱已经注册过了"

        ok, why = consume_invite(invite, email)
        if not ok:
            return None, why

        space = Space(id=str(__import__("uuid").uuid4()), name=email.split("@")[0], created_at=now_iso())
        space.recovery_hash = _hash(gen_recovery_code())
        db.add(space)
        db.flush()

        user = User(
            space_id=space.id,
            email=email,
            password_hash=hash_password(password),
            consent_version=consent_version,
            consent_at=now_iso(),
            created_at=now_iso(),
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        db.expunge(user)
        return user, ""
    finally:
        db.close()
