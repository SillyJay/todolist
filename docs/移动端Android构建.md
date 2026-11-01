# Android 构建（Capacitor）

## 结论：能打，但 debug 包，未上架

产物：`mobile/dist-apk/CampusAssistant-mobile-0.1.0-debug.apk`（约 4 MB）

## 环境（本机已装好）

| 组件 | 路径 / 版本 |
|---|---|
| JDK 21 | `D:\Android\jdk21`（Capacitor 8 要求 21，JDK 17 编译会报「无效源发行版: 21」） |
| Android SDK | `D:\Android\Sdk`（platform-tools、android-35/36、build-tools 35/36） |
| Gradle | 8.14.3，走腾讯镜像 `mirrors.cloud.tencent.com/gradle`（官方源太慢） |

## 一条命令重打

```powershell
powershell -ExecutionPolicy Bypass -File tools\dev\build-apk.ps1
```

输出 APK 路径、大小、SHA256。

## 装到手机

```powershell
# 方式一：adb（需要手机开 USB 调试）
D:\Android\Sdk\platform-tools\adb.exe install -r mobile\dist-apk\CampusAssistant-mobile-0.1.0-debug.apk

# 方式二：把 APK 传到手机，点开安装（需允许「安装未知来源应用」）
```

## 首次打开

1. 手机上打开「校园助手」
2. 填电脑地址：
   - 局域网：`http://10.0.155.134:8765`（手机和电脑同网、且没有 AP 隔离）
   - 校园网连不上时用隧道地址（见 `docs/移动端测试隧道.md`）
3. 输入桌面端生成的 6 位配对码

## 已经能用的

- 实时数据（任务 / 日程 / 课表 / 消息）
- 新建日程（点 + 手动、长按 + 语音占位）
- 消息转任务、忽略
- 本地缓存（断网打开有数据；页面资源也在包内，不依赖网络）

## 还没做（原生能力）

| 项 | 说明 |
|---|---|
| 系统语音识别 | 现在长按 + 还是填示例文本，需要接 `@capacitor-community/speech-recognition` |
| 本地通知 | DDL 到点提醒，需要 `@capacitor/local-notifications` + 后台调度 |
| 应用图标 / 启动图 | 现在是 Capacitor 默认图标 |
| 正式签名 | 现在是 debug 签名，只能自用；上架/分发要 keystore |

## 注意

- 允许明文 HTTP（`cleartext: true`），因为后端是局域网 http；以后上 Tailscale/HTTPS 可以关掉
- WebView origin 是 `http://localhost`，后端 CORS 已放行

## 原生能力（v0.2.0 起）

| 能力 | 插件 | 说明 |
|---|---|---|
| 语音识别 | `@capacitor-community/speech-recognition` | 长按 + 松手调系统 SpeechRecognizer（zh-CN），需要麦克风权限 |
| 本地通知 | `@capacitor/local-notifications` | 任务截止前 1 小时 + 到点各提醒一次；Android 8+ 渠道 `reminders` |
| 返回键 | `@capacitor/app` | 关弹层 → 回待办 → 再退出 |

权限（AndroidManifest 已声明）：`RECORD_AUDIO`、`POST_NOTIFICATIONS`、`SCHEDULE_EXACT_ALARM`、`USE_EXACT_ALARM`、`VIBRATE`。

## 改名（v0.2.0）

产品名统一为 **ToDoList**：

- Android：`strings.xml` 的 `app_name` / `title_activity_main`
- 桌面：`electron-builder.yml` 的 `productName` / `executableName` / 安装包名
- 网页标题；图标资源在 `mobile/assets/`

包名仍是 `com.campusassistant.mobile`（改包名等于换应用，需卸载重装，暂保留）。

## 图标

```powershell
node tools\dev\make-icon.mjs            # 生成 assets/*.png
npx capacitor-assets generate --android   # 生成各密度 mipmap
```
