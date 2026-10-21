"""设置路由（规格 §7.5）。

注意：API Key 只写不读回明文（存 keyring，settings 表仅存占位）。
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Setting

router = APIRouter()

# 密钥类 key：走 keyring，读时返回掩码
SECRET_KEYS = {"glm_api_key"}


@router.get("")
def get_settings(db: Session = Depends(get_db)):
    rows = db.query(Setting).all()
    data = {r.key: r.value for r in rows}
    for k in SECRET_KEYS:
        if data.get(k):
            data[k] = "********"  # 只回掩码
    return data


@router.put("")
def put_settings(body: dict, db: Session = Depends(get_db)):
    for k, v in body.items():
        if k in SECRET_KEYS:
            from config import set_secret
            set_secret(k, str(v))
            v = "1"  # 占位标记，表示已配置
        row = db.get(Setting, k)
        if row:
            row.value = str(v)
        else:
            db.add(Setting(key=k, value=str(v)))
    db.commit()
    return {"ok": True}
