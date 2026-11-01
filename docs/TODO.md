# 待办事项 / Roadmap

> 更新：2026-10-23 · 当前版本 v0.1.0-beta（内测）
> 状态图例：✅ 已完成 · 🔄 部分完成 · ⬜ 未开始 · ⚠️ 有已知问题

---

## 发布记录

### v0.2.0-beta（2026-10-24）

产物：`app/dist/CampusAssistant-v0.2.0-beta-win64.zip`（190.7 MB）
SHA256：`D529A7D242F2FBE8D5039B720A73661FACEC107728E83ABF8ABB23086923FC73`

包含：
- 后端内置 playwright（`_internal/playwright` 98.5 MB），学习通作业同步不再依赖用户环境；
  浏览器复用系统 Edge（`channel="msedge"`），无需下载 Chromium
- 打开软件 2 秒内自动提密钥 + 自动开始监听；看门狗 20 秒轮询；监听间隔 60→30 秒
- 「消息」页：分类 / 按群筛选 / 忽略单条 / 未读计数（侧栏红点）
- 设置新增「常规」tab（我的信息 / 工作区 / 新手引导 / 组件与版本）
- 学习通、小雅支持退出登录并显示当前账号
- 修复：浅色模式重开闪黑、切页/加载整页闪动、新手引导提示卡闪动、日历周次提示

体积对比：v0.1 = 351 MB / zip 154.7 MB → v0.2 = 450.6 MB / zip 190.7 MB（playwright +98 MB）

---
## 2026-10-23 第二批（消息分类 / 设置页重构）

- [x] **群消息分类 + 相关性过滤**
  `server/services/message_classify.py`：规则分类 7 类（比赛竞赛 / 作业考试 / 讲座活动 /
  通知安排 / 招募招新 / 闲聊灌水 / 其他），并结合画像算 0~100 相关度。
  `server/routers/wechat_feed.py`：`/api/wechat/feed`、`/feed/summary`、`/feed/{id}/to-task`、`/feed/reanalyze`。
  `_wechat_on_message` 现在**每条消息都留存**（`wechat_messages` 表）再走任务提取。

- [x] **消息页**（侧栏「消息」）
  分类 chips + 只看与我相关 + 搜索 + 一键转任务 + 相关度/原因展示。

- [x] **用户画像设置**（设置 → 常规）
  姓名 / 班级 / 组织，存 `profile_name` / `profile_class` / `profile_orgs`，
  改完可「重新分析历史消息」。

- [x] **设置页重构**
  删掉独立「工作区」tab，新增「常规」为第一个 tab，内含：
  我的信息 / 工作区 / 重新观看新手引导 / 组件与版本（含 App 版本、组件版本、检查更新）。

- [x] **浅色模式重开闪黑**
  `theme-boot.js`（首帧前置）+ `localStorage` 缓存 + 主进程 `theme.json` 与 `backgroundColor`。

- [x] **GLM 模型清单更新**（glm-4.7-flash 默认，新增 5.3-flash/flashx）
- [x] **负向词扩充**（接龙/投票/问卷/聚餐/二手…）
- [x] **微信「已回补的群」展示**

### 本批新增待办

- [x] 群消息保留 30 天后自动清理（每天 03:30，_cleanup_wechat_messages）
- [x] 消息页：忽略单条 / 按群筛选 / 未读计数（侧栏红点）
- [ ] 分类规则可配置（用户自己加关键词）
- [x] 删除「闲聊灌水」分类：默认不展示（HIDDEN_CATEGORIES），数据仍留存用于广告识别
- [ ] 相关性阈值可调（现在写死 45）
- [ ] 「转为任务」失败时的手动编辑兜底
- [ ] 首启时若没填画像，引导里提示去填

---
## P0 · 内测前必做

- [ ] **导出诊断日志按钮**
  设置页一键把 `main.log` + 配置摘要 + 版本号打成 zip，用户点一下就能发反馈。
  现在用户要自己找 `%APPDATA%\CampusAssistant\main.log`，内测反馈成本太高。
  涉及：`server/routers/settings.py`、`app/src/renderer/src/pages/SettingsPage.tsx` · 约 30 分钟

- [ ] **首次启动向导**
  当前打包版打开是空界面。需要强制引导：① 配 AI Key ② 登学习通 ③（可选）选微信群。
  `GuideTour` 目前只讲界面，没讲"必须配什么才能用"。
  涉及：`components/GuideTour.tsx`、`App.tsx` · 约 2 小时

- [ ] **提交代码 + 打 tag**
  当前 20+ 文件未提交，没有可回滚基线。
  `git add -A && git commit -m "..." && git tag v0.1.0-beta`

- [ ] **干净机器验证**
  我目前只在开发机验证过（同一台机器）。缺 VC++ 运行库、杀软拦截、非管理员账户等问题只有干净环境才暴露。

- [ ] **清库脚本 / 样例数据**（可选）
  给测试者一个"导入样例数据"的按钮，让他们一进来能看到界面长什么样，而不是空列表。
  涉及：`server/routers/` 新增 `sample` 接口 + 设置页按钮

---

## P1 · 内测中高价值（直接影响体验）

- [ ] **微信消息置信度闸门**
  `confidence < 0.7` 的任务进"待确认"区，用户点确认才进正式列表。
  现状：`tasks.py` 的 `/pending-confirm` 是 **stub**（`return {"items": []}`），
  `_wechat_on_message` 直接写库，置信度只存不用。
  涉及：`server/routers/tasks.py`、`server/routers/adapters.py`、`TasksPage.tsx` · 约 1.5 小时

- [x] **扩充负向词表**
  现在只有"活动报名"，实测"周末聚餐报名，截止周五"被误判成任务。
  加：报名 / 接龙 / 投票 / 问卷 / 聚餐 / 团建 / 打卡 / 拼单 / 二手 / 失物招领。
  涉及：`server/adapters/wechat_listener.py` 的 `NEGATIVE` · 约 10 分钟

- [ ] **任务来源可追溯**
  任务详情里显示"来自「25软件工程B班✨交流群✨」· 原文：…"，并可跳回原文。
  `draft` 里已有 `group`/`raw_text`，但 Task 表没存 group。
  涉及：`db/models.py` 加列 + 迁移、`TaskDetail` · 约 1 小时

- [ ] **「停止生成」按钮**
  流式输出时只能等它跑完。需要 AbortController + 后端断流。
  涉及：`AgentPage.tsx`、`lib/api.ts` 的 `chatStream` · 约 1 小时

- [ ] **提醒提前量可配置**
  现在硬编码提前 1 小时（`notify.ts` 的 `WARN_WINDOW_MS`）。
  需要设置项：15 分钟 / 1 小时 / 3 小时 / 1 天，外加免打扰时段。
  涉及：`app/src/main/notify.ts`、设置页 · 约 1 小时

- [ ] **多 provider 自动降级**
  主模型 429/超时 → 自动切备用模型，而不是直接报错。
  涉及：`server/ai/llm.py`、`server/ai/providers.py` · 约 2 小时

- [x] **更新 GLM 模型清单**
  `providers.py` 里还是 `glm-4.5-flash / glm-4.5-air / glm-4-plus / glm-4-flash`，
  其中 `glm-4.5-flash` 即将下线、`glm-4-flash` 文档已 404。
  改成：`glm-4.7-flash`（默认，免费）、`glm-5.3-flash`、`glm-5.3-flashx`。
  涉及：`server/ai/providers.py` · 约 15 分钟

- [ ] **学习通登录态失效主动提醒**
  Cookie 过期时任务页只显示空，用户以为是 bug。要能提示"登录已过期，点此重新登录"。
  涉及：`server/adapters/chaoxing.py` 错误分类 + `TasksPage` 提示 · 约 1 小时

- [ ] **小雅 Playwright/Chromium 按需下载**
  现在依赖本机 Playwright 浏览器；打包版没有，小雅功能等于不可用。
  需要首次使用时的下载引导 + 进度条（约 150MB）。
  涉及：`server/adapters/xiaoya.py`、`services/component_installer.py` · 约 3 小时

- [ ] **日志轮转**
  `main.log` 无上限增长，长期使用会占满磁盘。
  按 5MB × 3 份轮转即可。
  涉及：`app/src/main/logger.ts` · 约 20 分钟

---

## P2 · 功能补全

- [ ] **任务导出 CSV / Excel**
  现在只有日历 ICS 导出。家长/同学更习惯看表格。
  涉及：`server/routers/tasks.py` 新增 `/export`、前端按钮

- [ ] **数据备份 / 恢复**
  一键导出 `campus_assistant.db`，以及从备份文件恢复（换电脑时很有用）。

- [ ] **工作区整理规则**
  "只增不删"已定，但还没规则：按 `<课程>/<日期>_<标题>/` 归档、重名加后缀、
  以及下载前提示"目标文件夹已存在同名文件"。

- [ ] **组件一键升级（带回滚）**
  现在只有「检查更新」（`wechat_cli_commit`），没有升级。
  需要：`git pull` + 重建 + 失败回滚上一版本。
  注意：上游无 release，升级可能反而更坏，回滚必须先做。

- [ ] **「一门也不获取」哨兵值**
  文件筛选现在"空 = 全部"，没法表达"所有课都不要"。加 `__none__` 哨兵。

- [ ] **`file_watch_courses` 键统一**
  现在存的是 `<platform>/<course_abbr>`，后端用 `task.course_abbr or task.course_name` 匹配，
  课程改名或缩写冲突时会漏。需要统一成稳定 ID（课程表主键）。

- [ ] **附件批量下载到工作区**
  文件页目前只能单个下载/打开，缺"选中多个 → 下载到 workspace"。

- [x] **微信「已回补的群」状态展示**
  后端 `/wechat/status` 已返回 `backfilled` 字段，前端还没用。

- [ ] **日历：预估课程块虚线区分**
  课表时间不准时，用虚线/浅色标出"时间来自默认作息"的块，避免误导。

---

## P3 · 发布与架构

- [x] **打包链路**
  `build-backend.ps1` + PyInstaller（onedir）+ `electron-builder` `extraResources`。
  已产出可运行的 `win-unpacked`，并验证后端与内置组件都能跑。
  文档：`docs/PACKAGING.md`

- [x] **体积优化（第一轮）**
  465 MB → 351 MB（zip 178 → 155 MB）：
  - 渲染层依赖移到 devDependencies：`app.asar` 74.9 → 2.2 MB
  - `electronLanguages: [zh-CN, en-US]`：语言包 42.5 → 1 MB

- [ ] **体积方案决策**（需拍板）
  | 方案 | 解压后 | zip | 代价 |
  |---|---|---|---|
  | A 保持现状 | 351 MB | 155 MB | 无，走网盘分发 |
  | B wechat-cli 改按需下载 | ~322 MB | ~135 MB | 失去"内置即用" |
  | C 浏览器轻量版（无 Electron 壳） | ~75 MB | ~35 MB | 无托盘/原生通知，1-2 天 |
  | D 迁移 Tauri | ~90 MB | ~50 MB | 主进程重写，1-2 周 |

- [ ] **NSIS 安装包**
  `electron-builder --win` 需要下载 winCodeSign/nsis，当前网络受限。
  解法：能联网时跑一次，或手动放置到 `%LOCALAPPDATA%\electron-builder\Cache`。

- [ ] **代码签名**
  未签名 → SmartScreen 提示"未知发布者"。个人开发者可用 Azure Trusted Signing。

- [ ] **自动更新（electron-updater）**
  打包版目前无法自更新，用户只能手动重装。

- [ ] **微信监听合规**
  公开分发前建议：默认关闭微信直读，改为风险告知 + 显式开启；
  或改用 Windows 通知监听（零依赖、零 ToS 风险）。

- [ ] **微信小程序端**（规划）
  手机端查看任务/DDL/日历；需要后端从本地 SQLite 迁到可同步的存储。

---

## 技术债 / 已知缺陷

- ⚠️ **后端零测试**：`server/` 没有任何单元测试，改动全靠手测。
- ⚠️ **开发态 HMR 中间态**：多工具并发编辑同一文件时，Vite 会读到半截文件报错
  （已出现 `Failed to reload FilesPage.tsx`、`Sparkles is not defined`）。
- ⚠️ **StrictMode 双请求**：开发模式下 `GET /api/ai/status` 等接口会打两次，属正常但掩盖真实性能。
- ⚠️ **onefile → onedir**：已改；若将来改回 onefile，杀进程必须用 `taskkill /T`。
- ⚠️ **微信组件版本脆弱**：微信 4.x 升级后 `wechat-cli` 可能失效，且上游无 release 可追。
- ⚠️ **计时器分散**：当前 4 个常驻节拍（scheduler / wechat 线程 / health 30s / notify 60s），
  已优化掉面板 5s 轮询，但微信看门狗与监听线程仍是两个 60s 节拍（互斥工作，成本低）。

---

## 已完成（近期，供回溯）

- ✅ 微信 24h 首轮回补 + 按 `last_sync_at` 增量补齐（关机多天也能补）
- ✅ 系统消息（XML）过滤
- ✅ emoji/GBK 编码问题（后端 stdout + 冻结版 wechat-cli 输出）
- ✅ 页面级错误边界 `PageBoundary`（避免整页白屏）
- ✅ 保存微信配置后自动重启监听
- ✅ 微信看门狗：每 60s 检测，微信开了自动提密钥并监听
- ✅ AI 设置：多 provider、模型下拉、无默认 provider、GLM 推荐
- ✅ 流式输出（GLM thinking 关闭后首字 ~1.2s）
- ✅ 计划卡片彩色圆点、文件筛选、课表时间配置、月视图图例
- ✅ 打包链路与体积第一轮优化
