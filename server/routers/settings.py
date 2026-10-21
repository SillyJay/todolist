"""设置路由（规格 §7.5）。

注意：API Key 只写不读回明文（存 keyring，settings 表仅存占位）。
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Setting
from services.secrets import get_secret, set_secret

router = APIRouter()

# 密钥类 key：走 keyring，读时返回掩码
SECRET_KEYS = {"glm_api_key"}


@router.get("")
def get_settings(db: Session = Depends(get_db)):
    rows = db.query(Setting).all()
    data = {r.key: r.value for r in rows if r.key not in SECRET_KEYS}
    for k in SECRET_KEYS:
        if get_secret(k):
            data[k] = "********"  # 只回掩码，绝不回明文
    return data


@router.put("")
def put_settings(body: dict, db: Session = Depends(get_db)):
    for k, v in body.items():
        if k in SECRET_KEYS:
            if str(v) and str(v) != "********":
                set_secret(k, str(v))
            continue  # 密钥不进 settings 表
        row = db.get(Setting, k)
        if row:
            row.value = str(v)
        else:
            db.add(Setting(key=k, value=str(v)))
    db.commit()
    return {"ok": True}
