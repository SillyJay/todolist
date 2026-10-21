"""讯飞小雅 Adapter（规格 §5 模块 6）。Phase 3 实现，风险最高、允许整体砍掉。

TODO Phase 3：
- Playwright Chromium，用户首次手动登录 → Cookie 持久化
- 抓取作业列表页，输出统一契约
- ⚠️ 红线：交作业完全人工，不做任何自动上传/提交
"""
from adapters.base import BaseAdapter


class XiaoyaAdapter(BaseAdapter):
    platform = "xiaoya"
