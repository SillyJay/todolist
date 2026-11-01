# ToDoList

把**学习通作业与考试、微信群通知**汇总到一处：任务、日历、提醒，以及一份由 AI 生成的「这条到底要不要管」摘要。桌面 + 安卓双端。

> ⚠️ **这是一个 vibecoding 练手项目。** 绝大部分代码是和 AI 结对写出来的（DeepSeek / Claude / GLM），目的是学习，不是商业产品。会有粗糙的地方、缺失的测试和不那么漂亮的实现。

---

## 能做什么

| 功能 | 说明 |
|---|---|
| **作业与考试** | 同步学习通的作业截止时间、考试安排（用的是真实的考试列表接口） |
| **微信群消息** | 本地读取群消息并分类（作业 / 通知 / 活动 / 闲聊），只显示需要处理的 |
| **AI 摘要** | 每条消息一句话摘要，外加高 / 中 / 低三档重要性；关键词规则只做预筛 |
| **待处理队列** | 消息先不显示，AI 化简完才出现在列表里；「未处理」页可以看还在排队的内容 |
| **课表** | 周 / 月视图、按周过滤课程、导出 ICS |
| **提醒** | 桌面通知 + 安卓本地通知（截止前 1 小时、到点各一次） |
| **账号** | 邮箱 + 邀请码注册，头像昵称在桌面和手机之间同步 |
| **手机端** | Capacitor 打包的安卓应用，支持系统语音输入 |

## 架构

```
┌────────────────────────────┐        ┌───────────────────────────────┐
│ 桌面端（Electron）          │        │ 手机端（Capacitor / Android） │
│  React 19 + TypeScript     │        │  React + TypeScript           │
│  ┌──────────────────────┐  │  HTTP  │                               │
│  │ 本地 FastAPI 后端     │◄─┼────────┤  /api/sync/changes 读         │
│  │ Python 3.13 + SQLite │  │        │  /api/sync/ops 写             │
│  └──────────────────────┘  │        │                               │
│   微信 CLI · 学习通抓取     │        └───────────────────────────────┘
│   Playwright（网页抓取）    │
└────────────────────────────┘
```

- 所有凭证（微信密钥、学习通 Cookie、AI Key）都在本机；除了你主动同步的内容，不会离开这台电脑
- 手机是瘦客户端：只读变化，写回少量操作（建日程、标完成）

## 技术栈

- **桌面壳**：Electron 37 + electron-vite
- **桌面 UI**：React 19、TypeScript、Tailwind CSS v4、lucide-react
- **后端**：Python 3.13、FastAPI、SQLAlchemy、SQLite、APScheduler
- **手机**：Vite + React + Capacitor 8
- **AI**：任意 OpenAI 兼容接口（智谱 GLM、DeepSeek、本地 Ollama 等）

## 本地跑起来

```bash
# 后端
cd server
python -m venv .venv && .venv/Scripts/activate
pip install -r requirements.txt
python main.py --port 8765

# 桌面端
cd app
npm install
npm run dev

# 手机端（可选，需要 Android SDK + JDK 21）
cd mobile
npm install
npm run build
npx cap sync android
```

打包：

```bash
powershell -File build-backend.ps1      # PyInstaller 打包后端
cd app && npm run build:win            # NSIS 安装版 + 便携版
```

## 已知限制

- **不是多租户 SaaS**：一台电脑采集一个人的数据；账号隔离已经有了，但没有中心化托管服务
- **学习通抓取容易失效**：依赖非公开接口和本地微信 CLI，上游一改就可能挂
- **几乎没有自动化测试**：只有 8 个纯逻辑回归测试，别指望覆盖率
- 桌面端仅支持 Windows；安卓包是 debug 签名

## 数据与隐私

- 微信数据库、学习通 Cookie、AI Key 都留在你自己的电脑上
- AI 功能会把消息文本发给你**自己配置**的模型服务商
- 没有遥测、没有埋点、没有外部账号系统

## 免责声明

本项目**与超星学习通、讯飞小雅、腾讯微信没有任何隶属、合作或背书关系**。

软件按「现状」提供，不附带任何担保。作者不对漏交作业、AI 判断错误、数据丢失或任何使用后果负责。重要的截止时间与考试安排，请以学校官方通知为准。

请勿将其用于商业用途、批量采集他人数据，或规避任何平台的服务条款。

## 许可证

MIT，见 [LICENSE](LICENSE)。

---

## English

A desktop + Android app that pulls course assignments, exam schedules and WeChat group notices into one place: tasks, calendar, reminders, and an AI-generated digest.

> ⚠️ **Vibecoding practice project.** Most of the code was written by pairing with AI coding agents. Expect rough edges — this is a learning exercise, not a polished product.

**Highlights**: Chaoxing assignment/exam sync · WeChat group classification · one-line AI digest with three-level importance · pending queue until digest finishes · week/month calendar with ICS export · desktop + Android local notifications · email accounts with avatars synced across devices.

**Known limitations**: not multi-tenant; scraping breaks when upstream changes; minimal tests; Windows-only desktop; debug-signed APK.

**Disclaimer**: not affiliated with Chaoxing / 学习通, iFlytek / 讯飞小雅, or Tencent / WeChat. Provided as-is, without warranty. Always verify deadlines against your school's official notices.
