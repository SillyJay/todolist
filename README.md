# ToDoList

A desktop + Android app that pulls your **course assignments, exam schedules and WeChat group notices** into one place: tasks, calendar, reminders, and an AI-generated digest of what actually matters.

> ⚠️ **This is a vibecoding practice project.** Most of the code was written by pairing with AI coding agents (DeepSeek / Claude / GLM). It is a personal side project built to learn, not a commercial product. Expect rough edges, missing tests, and unpolished code.

---

## What it does

| Feature | Description |
|---|---|
| **Assignments & exams** | Syncs homework deadlines and exam schedules from Chaoxing (学习通), including a real exam list endpoint |
| **WeChat group digest** | Reads group messages locally, classifies them (homework / notice / event / chat …), and only shows the ones that matter |
| **AI digest** | A short summary per message plus a three-level importance (`high / medium / low`) decided by an LLM; keyword rules act as a cheap pre-filter |
| **Pending queue** | Messages are hidden until the AI has digested them; a "pending" view shows what is still being processed |
| **Schedule** | Week/month calendar with course blocks, per-week course filtering, ICS export |
| **Reminders** | Desktop notifications plus Android local notifications one hour before and at the deadline |
| **Accounts** | Email + invite-code registration, avatars and display names synced between desktop and phone |
| **Mobile app** | Capacitor-based Android app; voice input via the system speech recognizer |

## Architecture

```
┌────────────────────────────┐        ┌───────────────────────────────┐
│ Desktop (Electron)         │        │ Phone (Capacitor / Android)   │
│  React 19 + TypeScript     │        │  React + TypeScript           │
│  ┌──────────────────────┐  │  HTTP  │                               │
│  │ Local FastAPI backend│◄─┼────────┤  sync via /api/sync/changes   │
│  │ Python 3.13 + SQLite │  │        │  and /api/sync/ops            │
│  └──────────────────────┘  │        │                               │
│   WeChat CLI · Chaoxing    │        └───────────────────────────────┘
│   Playwright (web scraping)│
└────────────────────────────┘
```

- The desktop app owns all credentials (WeChat keys, Chaoxing cookies, AI API keys); nothing leaves the machine except what you choose to sync.
- The phone is a thin client: it reads changes and writes back small operations (create event, mark done).

## Tech stack

- **Desktop shell**: Electron 37 + electron-vite
- **Desktop UI**: React 19, TypeScript, Tailwind CSS v4, lucide-react
- **Backend**: Python 3.13, FastAPI, SQLAlchemy, SQLite, APScheduler
- **Mobile**: Vite + React + Capacitor 8
- **AI**: any OpenAI-compatible endpoint (Zhipu GLM, DeepSeek, local Ollama …)

## Getting started (development)

```bash
# backend
cd server
python -m venv .venv && .venv/Scripts/activate
pip install -r requirements.txt
python main.py --port 8765

# desktop
cd app
npm install
npm run dev

# mobile (optional, needs Android SDK + JDK 21)
cd mobile
npm install
npm run build
npx cap sync android
```

Build artifacts:

```bash
powershell -File build-backend.ps1      # PyInstaller onedir backend
cd app && npm run build:win            # NSIS + portable installers
```

## Known limitations

- **Not a multi-tenant SaaS**: one machine collects one person's data. Account isolation exists, but there is no central hosted service.
- **Chaoxing scraping breaks easily**: it relies on undocumented endpoints and on a local WeChat CLI; upstream changes will break it.
- **No meaningful automated tests** — this is a hobby project.
- Windows only (desktop). The Android APK is debug-signed.

## Data & privacy

- WeChat databases, Chaoxing cookies and AI keys stay on your own computer.
- AI features send message text to whichever model provider **you** configure.
- There is no telemetry, no analytics, no external account system.

## Disclaimer

This project is **not affiliated with, endorsed by, or connected to** Chaoxing / 学习通, iFlytek / 讯飞小雅, or Tencent / WeChat.

It is provided **as-is**, without warranty of any kind. The author is not liable for missed deadlines, wrong AI output, data loss, or any consequence of using it. Always verify important dates against your school's official notices.

Do not use it for commercial purposes, to scrape other people's data, or to bypass any platform's terms of service.

## License

MIT — see [LICENSE](LICENSE).

---

## 中文说明

**ToDoList** 是一个桌面 + 安卓的个人效率工具，把学习通作业/考试、微信群通知聚合到一处，用 AI 生成摘要并按重要性分级。

这是一个 **vibecoding 练手项目**：绝大部分代码是和 AI 结对写出来的，目的是学习，不是产品。请把它当作一个可运行的实验，而不是值得托付重要事务的软件。

> 与超星学习通、讯飞小雅、腾讯微信均无关联；不保证准确性，重要事项请以官方通知为准。
