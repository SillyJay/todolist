# 校园信息管理助手 (Campus Assistant)

桌面端校园 AI Agent：聚合学习通、讯飞小雅等平台的作业/课表信息，监听微信通知群消息，用 AI 提取 DDL 与摘要，统一管理任务、导出日历、到点提醒。

> 开发唯一权威依据：`../campus-assistant-engineering-spec.md`（工程规格说明书 v1.0）
> 遇到规格未覆盖的歧义：选择更简单、更保守的方案，并在代码注释中标记 `// SPEC-GAP`。

## 合规红线（不可违反）

- ❌ 不做任何自动刷课、自动答题、AI 代写作业
- ❌ 不自动提交作业：所有"交作业"环节完全由用户人工操作
- ❌ 微信侧只读：不发送任何微信消息、不控制微信 UI、不注入微信进程
- ❌ 工作区只增不删：程序不得删除或覆盖用户已有文件
- ✅ 所有 AI 提取结果必须保留原文，置信度低时必须人工确认才入库

## 技术栈

- **桌面壳**：Electron (electron-vite)
- **前端**：React 18 + TypeScript + Vite + TailwindCSS + shadcn/ui
- **后端**：Python 3.11+ + FastAPI + Uvicorn（Electron 子进程，只绑 127.0.0.1）
- **数据库**：SQLite (SQLAlchemy ORM)
- **AI**：智谱 GLM-4.5-Flash（zai-sdk），支持切换任意 OpenAI 兼容接口

## 目录结构

```
campus-assistant/
├── app/       # Electron + React 前端
├── server/    # Python FastAPI 后端
└── docs/      # 开发文档
```

## 开发进度

- [x] Phase 0：工程地基（FastAPI 骨架 + mock 路由 + Electron 子进程管理 + /health 连通）
- [ ] Phase 1：壳与单平台闭环（学习通）
- [ ] Phase 2：AI 与微信监听
- [ ] Phase 3：小雅与文件体系
- [ ] Phase 4：打包与交付

## 本地启动

```bash
# 后端（可选，Electron 会自动拉起）
cd server && python main.py --port 8765

# 前端
cd app && npm run dev
```

环境踩坑记录见 `docs/DEV-NOTES.md`。

# 一键启动（双击）
Windows 下可直接双击根目录的 dev.cmd，自动清理干扰环境变量并启动前端+后端。
