"""SMTP 发信：找回密码验证码 / 通知。

配置放在 settings（keyring 存密码）：
  smtp_host, smtp_port, smtp_user, smtp_from, smtp_ssl
  smtp_password → keyring（services.secrets）
"""

from __future__ import annotations

import logging
import random
import smtplib
import ssl
from datetime import datetime, timedelta
from email.message import EmailMessage

log = logging.getLogger("campus.mail")

CODE_TTL_MIN = 10


def _cfg(db) -> dict:
    from db.models import Setting
    from services.secrets import get_secret

    def get(key: str, default: str = "") -> str:
        row = db.get(Setting, key)
        return (row.value if row and row.value else default) or default

    return {
        "host": get("smtp_host"),
        "port": int(get("smtp_port", "465") or 465),
        "user": get("smtp_user"),
        "password": get_secret("smtp_password") or "",
        "sender": get("smtp_from") or get("smtp_user"),
        "ssl": get("smtp_ssl", "1") == "1",
    }


def configured(db) -> bool:
    c = _cfg(db)
    return bool(c["host"] and c["user"] and c["password"])


def send_mail(db, to: str, subject: str, body: str) -> tuple[bool, str]:
    c = _cfg(db)
    if not configured(db):
        return False, "还没配置 SMTP"

    msg = EmailMessage()
    msg["From"] = c["sender"]
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)

    try:
        if c["ssl"]:
            with smtplib.SMTP_SSL(c["host"], c["port"], timeout=20, context=ssl.create_default_context()) as s:
                s.login(c["user"], c["password"])
                s.send_message(msg)
        else:
            with smtplib.SMTP(c["host"], c["port"], timeout=20) as s:
                s.starttls(context=ssl.create_default_context())
                s.login(c["user"], c["password"])
                s.send_message(msg)
        return True, ""
    except Exception as e:  # noqa: BLE001
        log.warning("发信失败：%s", e)
        return False, f"发送失败：{type(e).__name__}"


def issue_code(db, email: str, purpose: str = "reset") -> tuple[str, str]:
    """生成并发送验证码，返回 (是否成功, 错误信息)。"""
    from db.models import EmailCode, User

    email = (email or "").strip().lower()
    user = db.query(User).filter(User.email == email).first()
    if not user:
        return "该邮箱没有注册", ""

    code = f"{random.randint(0, 999999):06d}"
    now = datetime.now().astimezone()
    db.add(
        EmailCode(
            email=email,
            code=code,
            purpose=purpose,
            expires_at=(now + timedelta(minutes=CODE_TTL_MIN)).isoformat(timespec="seconds"),
            created_at=now.isoformat(timespec="seconds"),
        )
    )
    db.commit()

    ok, err = send_mail(
        db,
        email,
        "ToDoList 验证码",
        f"你的验证码是 {code}，{CODE_TTL_MIN} 分钟内有效。\n如果不是你本人操作，请忽略这封邮件。",
    )
    if not ok:
        return err, ""
    return "", code


def verify_code(db, email: str, code: str, purpose: str = "reset") -> bool:
    from db.models import EmailCode

    email = (email or "").strip().lower()
    row = (
        db.query(EmailCode)
        .filter(
            EmailCode.email == email,
            EmailCode.code == (code or "").strip(),
            EmailCode.purpose == purpose,
            EmailCode.used_at.is_(None),
        )
        .order_by(EmailCode.id.desc())
        .first()
    )
    if not row:
        return False
    if row.expires_at and row.expires_at < datetime.now().astimezone().isoformat(timespec="seconds"):
        return False
    row.used_at = datetime.now().astimezone().isoformat(timespec="seconds")
    db.commit()
    return True
