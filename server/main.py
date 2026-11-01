"""FastAPI 入口（规格 §2.1、§7）。

- 只绑定 127.0.0.1，端口由 Electron 主进程通过命令行参数传入（默认 8765）
- 用法：python main.py --port 8765
"""
import argparse
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db.database import init_db
from routers import auth, adapters, ai, calendar, files, pair, plans, settings, sync, system, tasks, wechat_feed
from services.scheduler import start_scheduler, stop_scheduler


def _maybe_reclassify() -> None:
    """分类规则升级后，把老消息重跑一遍（后台线程，不阻塞启动）。

    打包版用户升级后，旧数据会自动按新规则重分类，
    不需要手动跑脚本。
    """
    import threading

    def run() -> None:
        from datetime import datetime

        from db.database import SessionLocal
        from db.models import Setting, WeChatMessage
        from services.message_classify import CLASSIFY_VERSION, analyze, load_profile

        db = SessionLocal()
        try:
            row = db.get(Setting, "classify_version")
            current = 0
            if row and row.value and str(row.value).isdigit():
                current = int(row.value)
            if current >= CLASSIFY_VERSION:
                return

            profile = load_profile(db)
            now = datetime.now().astimezone().isoformat(timespec="seconds")
            changed = 0
            from services.ai_classify import rule_importance

            for m in db.query(WeChatMessage).all():
                r = analyze(m.text or "", m.group_name or "", profile, m.sender or "")
                action, importance = rule_importance(m.text or "", r["category"], r["needs_action"])
                if (
                    r["category"] != (m.category or "misc")
                    or r["relevance"] != (m.relevance or 0)
                    or (m.importance or "") != importance
                ):
                    m.category = r["category"]
                    m.relevance = r["relevance"]
                    m.reason = "; ".join(r["reasons"])[:400]
                    m.needs_action = 1 if r["needs_action"] else 0
                    # 规则重跑不覆盖 AI 判定过的档位
                    if (m.classify_src or "rule") != "ai":
                        m.action = action
                        m.importance = importance
                        m.classify_src = "rule"
                    m.updated_at = now
                    changed += 1

            if row:
                row.value = str(CLASSIFY_VERSION)
            else:
                db.add(Setting(key="classify_version", value=str(CLASSIFY_VERSION)))
            db.commit()
            print(f"[classify] 规则升到 v{CLASSIFY_VERSION}，重分类 {changed} 条")
        except Exception as e:  # noqa: BLE001
            print(f"[classify] 重分类失败：{e}")
        finally:
            db.close()

    threading.Thread(target=run, daemon=True, name="reclassify").start()


def _digest_backfill() -> None:
    """启动时把历史未化简的消息排进队列，后台慢慢补。"""
    import threading

    def run() -> None:
        try:
            from db.database import SessionLocal
            from db.models import WeChatMessage
            from services.digest_worker import enqueue, ensure_worker

            ensure_worker()
            db = SessionLocal()
            try:
                from services.message_classify import HIDDEN_CATEGORIES

                ids = [
                    r[0]
                    for r in db.query(WeChatMessage.id)
                    .filter((WeChatMessage.digest.is_(None)) | (WeChatMessage.digest_src != "ai"))
                    .filter(~WeChatMessage.category.in_(HIDDEN_CATEGORIES))
                    .filter(
                        (WeChatMessage.importance.in_(["high", "medium"]))
                        | (WeChatMessage.importance.is_(None))
                    )
                    .order_by(WeChatMessage.id.desc())
                    .limit(200)
                    .all()
                ]
            finally:
                db.close()
            if ids:
                enqueue(ids)
                print(f"[digest] 回填 {len(ids)} 条进队列")
        except Exception as e:  # noqa: BLE001
            print(f"[digest] 回填失败：{e}")

    threading.Thread(target=run, daemon=True, name="digest-backfill").start()


def _retention_cleanup() -> None:
    """启动时清一次超期消息，并起每日后台任务。"""
    import threading

    def run() -> None:
        try:
            from db.database import SessionLocal
            from services.retention import purge_old_messages, start_retention_job

            db = SessionLocal()
            try:
                stat = purge_old_messages(db)
                if stat["deleted"]:
                    print(f"[retention] 清理 {stat['deleted']} 条超过 {stat['days']} 天的消息")
            finally:
                db.close()
            start_retention_job()
        except Exception as e:  # noqa: BLE001
            print(f"[retention] 清理失败：{e}")

    threading.Thread(target=run, daemon=True, name="retention-boot").start()


def _start_cloud() -> None:
    """开启云端同步时，跑后台推送/拉取循环。"""
    try:
        from db.database import SessionLocal
        from db.models import Setting
        from services.cloud_sync import start_cloud_loop

        db = SessionLocal()
        row = db.get(Setting, "cloud_enabled")
        enabled = (row.value if row else "0") == "1"
        db.close()
        if enabled:
            start_cloud_loop()
    except Exception as e:  # noqa: BLE001
        print(f"[cloud] 启动失败：{e}")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    _maybe_reclassify()
    _digest_backfill()
    _retention_cleanup()
    _start_cloud()
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="Campus Assistant API", lifespan=lifespan)

# 只允许本地前端来源（开发期 vite dev server / 打包后 file:// 均走 127.0.0.1）
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "null",
        # 移动端原型（Vite dev / 静态预览）
        "http://127.0.0.1:5300",
        "http://localhost:5300",
        "http://localhost:5273",
        "http://localhost:5280",
        # Capacitor 原生壳：WebView 的 origin 是 http://localhost
        "http://localhost",
        "https://localhost",
        "capacitor://localhost",
        "http://127.0.0.1:5280",
        "http://127.0.0.1:5273",
        "http://localhost:5274",
        "http://127.0.0.1:5274",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "campus-assistant"}


app.include_router(auth.router, prefix="/api")
app.include_router(tasks.router, prefix="/api/tasks", tags=["tasks"])
app.include_router(adapters.router, prefix="/api/adapters", tags=["adapters"])
app.include_router(ai.router, prefix="/api/ai", tags=["ai"])
app.include_router(files.router, prefix="/api/files", tags=["files"])
app.include_router(calendar.router, prefix="/api", tags=["calendar"])
app.include_router(plans.router, prefix="/api/plans", tags=["plans"])
app.include_router(settings.router, prefix="/api/settings", tags=["settings"])
app.include_router(wechat_feed.router, prefix="/api/wechat", tags=["wechat-feed"])
app.include_router(system.router, prefix="/api/system", tags=["system"])
# 配对码流程已由邮箱账号取代
app.include_router(sync.router, prefix="/api/sync", tags=["sync"])

# ---------------------------------------------------------------- 移动端静态站点
# 把 mobile/dist 一起托管，好处是「网页和接口同源」：
#  - 手机端不用处理 CORS
#  - Cloudflare 临时隧道只要穿一个地址（测试用，见 docs/移动端测试隧道.md）
def _mount_mobile(mobile_dir: str = "", apk_dir: str = "") -> None:
    from pathlib import Path

    from fastapi.staticfiles import StaticFiles

    def first_exist(candidates: list[Path], marker: str) -> Path | None:
        for c in candidates:
            if (c / marker).exists():
                return c
        return None

    dev_root = Path(__file__).resolve().parent.parent / "mobile" / "dist"
    roots = [Path(mobile_dir)] if mobile_dir else []
    roots.append(dev_root)
    root = first_exist(roots, "index.html")
    if root:
        app.mount("/m", StaticFiles(directory=str(root), html=True), name="mobile")
        print(f"[mobile] 静态站点已挂载: {root} → /m")

    apk_candidates = [Path(apk_dir)] if apk_dir else []
    apk_candidates.append(dev_root.parent / "dist-apk")
    apk_root = first_exist(apk_candidates, ".")
    if apk_root and any(apk_root.glob("*.apk")):
        app.mount("/apk", StaticFiles(directory=str(apk_root), html=False), name="apk")
        print(f"[mobile] APK 下载目录已挂载: {apk_root} → /apk")





def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--mobile-dir",
        default="",
        help="打包版：resources/mobile/dist 的路径",
    )
    parser.add_argument(
        "--apk-dir",
        default="",
        help="打包版：resources/apk 的路径",
    )
    parser.add_argument(
        "--admin-token",
        default="",
        help="本机密钥：桌面 App 用它证明自己是本机（挂了隧道也安全）",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="监听地址：手机要对局域网访问就传 0.0.0.0（无 token 的请求仍只允许本机）",
    )
    args = parser.parse_args()

    # 静态资源挂载要在 parse 之后（args 只在这里存在）
    _mount_mobile(args.mobile_dir, args.apk_dir)
    from services import local_auth

    local_auth.set_token(args.admin_token or __import__('os').environ.get('CA_ADMIN_TOKEN', ''))
    if local_auth.get_token():
        print('[auth] 本机密钥已启用（--admin-token）')
    else:
        print('[auth] 警告：没有本机密钥，桌面端请求会被拒')
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
