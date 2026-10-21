"""微信监听 Adapter（规格 §5 模块 3、§12.2）。Phase 2 实现。

TODO Phase 2：
- 环境检测：wechat-cli 路径探测（PATH → %LOCALAPPDATA%\\wechat-cli）、`wechat-cli status`
- subprocess 拉起 `wechat-cli watch --follow --jsonl`，逐行解析 JSON（注意半行缓冲）
- 群过滤 → L0 关键词过滤 → L1 AI 提取 → 置信度分级入库
- ⚠️ 红线：微信侧只读，不发送消息、不控制 UI、不注入进程
"""
