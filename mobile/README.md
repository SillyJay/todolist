# 移动端原型（v0.1）

MinimaList 风格的五 Tab 原型，用来先敲定视觉与交互，再进 Android 壳。

## 跑起来

```bash
cd mobile
npm install
npm run dev        # http://127.0.0.1:5273
```

构建静态版：

```bash
npm run build && npm run preview   # http://127.0.0.1:5274
```

用手机访问：电脑和手机同一 WiFi，打开 `http://<电脑IP>:5273`（需要把 dev 的 host 设为 0.0.0.0，已配置）。

## 已实现（纯前端假数据）

| Tab | 内容 |
|---|---|
| To do | 勾选完成、按 DDL 排序、24h 内标红、完成态灰化划线 |
| 专注 | 番茄钟 / 正计时 / 倒计时，圆环进度，开始暂停 |
| 日历 | 月视图、点日期看当天日程、左右滑动切天、课程/事件按时间合并 |
| 消息 | 按日期分组的 AI 摘要流、分类筛选、详情抽屉 |
| 设置 | 浅色 / 深色 / 跟随系统、同步状态、提醒开关 |

右下角 **+**：点按 = 新建任务；长按 = 语音（原型内为模拟识别，真机会接系统 SpeechRecognizer）。

## 目录

```
src/
  App.tsx            外壳：Tab 切换、FAB、弹层、语音浮层、主题
  pages/             五个页面
  components/Icons.tsx  线性图标
  lib/mock.ts        假数据
  lib/date.ts        日期工具
  styles/tokens.css  设计 Token（颜色/字号/间距，含深色）
  styles/app.css     组件样式
```

## 还没做

- 真实数据（等 `/sync` 接口）
- 语音识别（等 Capacitor + SpeechRecognizer）
- 本地通知、离线缓存
- 登录 / 配对 / 恢复码页面
