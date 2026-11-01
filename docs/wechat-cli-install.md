# wechat-cli 安装与排障（微信群消息数据源）

> 这份文档记录 `server/adapters/wechat_listener.py` 依赖的外部组件 `wechat-cli`
> 是怎么装的、为什么某些"看起来空的目录"其实是正常的、以及踩过的坑。

## 1. 它是什么

`wechat-cli`（GitHub: `huohuoer/wechat-cli`）是一个**只读**读取本地微信 SQLCipher 数据库的
命令行工具，本项目只用它的三个命令：

| 命令 | 用途 |
|---|---|
| `init` | 从微信进程内存里提取数据库密钥，写入 `~/.wechat-cli/all_keys.json` |
| `sessions` | 列出会话（群列表就从这里来） |
| `new-messages` | 增量拉新消息（本项目 60s 轮询一次） |

⚠️ 本项目**绝不调用** `send` 等写操作命令。

## 2. 本机实际的安装方式（2026-10）

源码来自 GitHub 直接 pip 安装，**没有**走应用内的"一键安装组件"：

```bash
git clone https://github.com/huohuoer/wechat-cli.git C:\Users\<user>\AppData\Local\Temp\wcli
# HEAD a378923 "docs: add acknowledgement to wechat-decrypt"

<venv>\python.exe -m pip install "C:\Users\<user>\AppData\Local\Temp\wcli"
```

其中 `<venv>` 是本项目后端使用的 Python 环境（开发期）：
```
C:\Users\<user>\.workbuddy\binaries\python\envs\campus-assistant
```

安装后入口程序落在：

```
<venv>\Scripts\wechat-cli.exe        ← 真正被调用的就是这个
```

## 3. 最大的坑：`bin/wechat-cli/` 是空的，但这不代表没装

`find_cli()` 的探测顺序（`server/adapters/wechat_listener.py`）：

```
1. 组件安装目录  app_root()/bin/wechat-cli/…   ← component_installer 给"UI 点按钮下载"预留
2. PATH 上的 wechat-cli(.exe)
3. 解释器同目录   dirname(sys.executable)/wechat-cli.exe   ← pip 安装落在 venv\Scripts，命中这里
4. 常见固定路径   %LOCALAPPDATA%\wechat-cli\… 等
```

`bin/wechat-cli/` 只在「从界面点按钮下载组件」时才会被写入；pip 安装方式下它**一直是空的，属于正常现象**。

👉 排查时不要只看 `bin/wechat-cli/` 空就判断"没装"，直接看 `/api/adapters/wechat/status`
返回的 `env.path` 才准。

## 4. 踩过的坑：群名带 emoji 导致 `sessions` 崩溃

**现象**：点"读取群列表"报 `wechat-cli 执行失败（exit 1）`，栈里是

```
UnicodeEncodeError: 'gbk' codec can't encode character '\u0001f60b'
in position 5: illegal multibyte sequence  [{"chat": ...
```

**原因**：`wechat-cli` 是 Python 程序，Windows 下 stdout 默认 GBK；群名里有 emoji
（如 `呀咪呀咪😋`、`25软件工程B班✨交流群✨`、`广佛兼职群6️⃣`）时 `json.dump` 直接抛错退出。

**修复**：调用子进程时注入 UTF-8 环境（见 `_cli_env()`）：

```python
env["PYTHONIOENCODING"] = "utf-8"
env["PYTHONUTF8"] = "1"
env["PYTHONLEGACYWINDOWSSTDIO"] = "0"
```

同一个 bug 也会影响 `new-messages`（消息正文含 emoji 时同样 exit 1），
所以这个修复对**消息监听**同样必要。

## 5. 如何验证装好了

```powershell
# 1) 能否列出会话（应输出 JSON 数组，含 chat / is_group / unread）
& "<venv>\Scripts\wechat-cli.exe" sessions --limit 5

# 2) 项目内的结构体检（通过 API）
#    GET /api/adapters/wechat/groups
#    正常返回 {"groups":[...48 条...], "code":"OK"}
#    异常时 code 会明确告诉你原因：
#      CLI_MISSING / KEYS_MISSING / CLI_FAILED / PARSE_FAILED / EMPTY
```

## 6. 更新方式

组件**没有自动升级**，但应用内可以「检查更新」（只读，不会动你的环境）：
设置 → 微信监听 → 「检查更新」。

实现见 `server/services/component_updater.py`：

```
GET /api/adapters/wechat/update/check
→ { current: "a378923", latest: "a378923", has_update: false }
```

它做的事：
1. 记住「当前装的是哪个 commit」（存在 settings 的 `wechat_cli_commit`）
2. `git ls-remote https://github.com/huohuoer/wechat-cli.git HEAD` 取远端 HEAD
3. 比对，只告诉你结果，**不自动执行升级**

基线怎么来的：pip 本地目录安装不会记录 commit，所以首次检查时按
`WECHAT_CLI_SRC` → `%TEMP%\wcli` → `%TEMP%\wechat-cli` 顺序找本地 clone，
用 `git rev-parse HEAD` 推断（返回结果里的 `baseline: "inferred"` 就是这个意思）；
推断不到则把远端 HEAD 记为基线（`baseline: "new-baseline"`）。

手动更新：

```bash
cd C:\Users\<user>\AppData\Local\Temp\wcli
git pull
<venv>\python.exe -m pip install . --upgrade
```

> 由于是 pip 安装，`pip install --upgrade "git+https://github.com/huohuoer/wechat-cli.git"`
> 也可以；但网络受限时先在本地 clone 再 `pip install .` 更稳。
> 升级失败时旧版本仍在，不会把环境弄坏。

## 7. 已知限制

- 微信版本过新（>4.1.8 系）时 `init` 提取密钥可能失败 → 表现为 `KEYS_MISSING`
- `init` 在 Windows 需要能读取微信进程内存，必要时用管理员权限运行后端
- 该上游项目没有发布 release 包，也不在任何 npm/pypi 官方源上（同名包是另一个项目），
  所以**不要**执行 `pip install wechat-cli`，会装错东西
