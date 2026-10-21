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
from routers import adapters, ai, calendar, files, settings, tasks


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Campus Assistant API", lifespan=lifespan)

# 只允许本地前端来源（开发期 vite dev server / 打包后 file:// 均走 127.0.0.1）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "null"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "campus-assistant"}


app.include_router(tasks.router, prefix="/api/tasks", tags=["tasks"])
app.include_router(adapters.router, prefix="/api/adapters", tags=["adapters"])
app.include_router(ai.router, prefix="/api/ai", tags=["ai"])
app.include_router(files.router, prefix="/api/files", tags=["files"])
app.include_router(calendar.router, prefix="/api", tags=["calendar"])
app.include_router(settings.router, prefix="/api/settings", tags=["settings"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()
