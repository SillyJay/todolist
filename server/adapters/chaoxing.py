"""学习通 Adapter（规格 §5 模块 2）。

TODO Phase 1：
- 账号密码登录，Cookie 持久化，过期自动重登
- 参考 GitHub `Samueli924/chaoxing` 的登录与作业列表接口逻辑；
  ⚠️ 红线：只取数据读取部分，严禁包含任务点完成/刷课/答题/提交代码
- 拉取课程列表、作业/考试列表、学生课表（§10）
- 兜底：HTTP 接口失效时用 Playwright 模拟浏览器抓取
"""
from adapters.base import BaseAdapter


class ChaoxingAdapter(BaseAdapter):
    platform = "chaoxing"
