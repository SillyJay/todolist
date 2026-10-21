"""Adapter 基类（规格模块 2「接口契约」）。

所有平台 Adapter 统一输出该契约，供任务入库与前端展示使用。
"""
from dataclasses import dataclass, field


@dataclass
class Attachment:
    name: str
    url: str
    local_path: str | None = None


@dataclass
class Assignment:
    """统一作业契约（规格 §5 模块 2）"""
    platform: str            # chaoxing / xiaoya / ...
    course_name: str
    title: str
    ddl: str | None          # ISO8601 或 None
    status: str              # pending / submitted / expired
    url: str
    source_msg_id: str       # 平台内唯一去重键
    attachments: list[Attachment] = field(default_factory=list)


class BaseAdapter:
    platform: str = ""

    def login(self, **kwargs) -> dict:
        """返回 {"ok": bool, "code": str}，失败时 code 供前端区分引导文案。"""
        raise NotImplementedError

    def fetch_assignments(self) -> list[Assignment]:
        raise NotImplementedError
