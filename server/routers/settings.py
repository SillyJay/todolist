"""设置路由（规格 §7.5）。

注意：API Key 只写不读回明文（存 keyring，settings 表仅存占位）。
"""
import time

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import Setting
from services.secrets import get_secret, set_secret

router = APIRouter()

# 密钥类 key：走 keyring，读时返回掩码
SECRET_KEYS = {"glm_api_key"}

# keyring 读取要走 Windows 凭据管理器（一次约 100ms）。
# 设置页/启动时会频繁调用，这里缓存「有没有密钥」60 秒。
_SECRET_PRESENCE: dict[str, tuple[float, bool]] = {}
_SECRET_TTL = 60.0


def _has_secret(key: str) -> bool:
    now = time.time()
    hit = _SECRET_PRESENCE.get(key)
    if hit and now - hit[0] < _SECRET_TTL:
        return hit[1]
    try:
        exists = bool(get_secret(key))
    except Exception:  # noqa: BLE001 - 无密钥后端时按没有处理
        exists = False
    _SECRET_PRESENCE[key] = (now, exists)
    return exists


@router.get("")
def get_settings(db: Session = Depends(get_db)):
    data = {r.key: r.value for r in db.query(Setting).all() if r.key not in SECRET_KEYS}
    for k in SECRET_KEYS:
        if _has_secret(k):
            data[k] = "********"  # 只回掩码，绝不回明文
    return data


@router.put("")
def put_settings(body: dict, db: Session = Depends(get_db)):
    for k, v in body.items():
        if k in SECRET_KEYS:
            if str(v) and str(v) != "********":
                set_secret(k, str(v))
                _SECRET_PRESENCE[k] = (time.time(), True)
            continue  # 密钥不进 settings 表
        row = db.get(Setting, k)
        if row:
            row.value = str(v)
        else:
            db.add(Setting(key=k, value=str(v)))
    db.commit()

    # 改「微信数据目录」后清掉探测缓存，下次状态查询/初始化才会用新路径
    if "wechat_db_dir" in body:
        try:
            from adapters.wechat_listener import reset_db_dir_cache

            reset_db_dir_cache()
        except Exception:  # noqa: BLE001
            pass

    return {"ok": True}
