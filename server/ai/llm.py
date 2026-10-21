"""LLM 客户端（规格 §5 模块 4、§12.3）。Phase 2 实现。

- 默认 GLM-4.5-Flash（zai-sdk），支持切换任意 OpenAI 兼容接口
  （base_url / api_key / model 三字段，API Key 存 keyring）
- DDL 提取用 response_format={"type": "json_object"} 强制 JSON
- 请求 30s 超时 + 1 次重试；失败任务标记「AI 不可用，已存原文」
"""
