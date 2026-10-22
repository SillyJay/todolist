"""Windows 回收站操作（纯 ctypes，不依赖 PowerShell / 第三方库）。

为什么不用 os.remove：本项目对用户文件的原则是「不硬删」。
用户在工作区里点删除时，文件必须还能从回收站捞回来，否则一个误操作就没了。
"""
import ctypes
import os
from ctypes import wintypes

FO_DELETE = 3
FOF_SILENT = 0x0004
FOF_NOCONFIRMATION = 0x0010
FOF_ALLOWUNDO = 0x0040  # 关键：送回收站而不是直接删
FOF_NOERRORUI = 0x0400


class _SHFILEOPSTRUCTW(ctypes.Structure):
    _fields_ = [
        ("hwnd", wintypes.HWND),
        ("wFunc", wintypes.UINT),
        ("pFrom", wintypes.LPCWSTR),
        ("pTo", wintypes.LPCWSTR),
        ("fFlags", ctypes.c_uint16),
        ("fAnyOperationsAborted", wintypes.BOOL),
        ("hNameMappings", ctypes.c_void_p),
        ("lpszProgressTitle", wintypes.LPCWSTR),
    ]


def to_recycle_bin(path: str) -> tuple[bool, str]:
    """把文件或目录移入回收站。返回 (成功, 错误信息)。"""
    if not os.path.exists(path):
        return False, "路径不存在"
    if os.name != "nt":
        return False, "当前系统不支持回收站操作"

    # pFrom 必须是双 null 结尾的多字符串
    src = os.path.abspath(path) + "\0\0"

    op = _SHFILEOPSTRUCTW()
    op.hwnd = None
    op.wFunc = FO_DELETE
    op.pFrom = src
    op.pTo = None
    op.fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI

    try:
        result = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))
    except (AttributeError, OSError) as e:
        return False, f"调用系统接口失败：{e}"

    if result != 0:
        return False, f"系统返回错误码 {result}（文件可能正被占用）"
    if op.fAnyOperationsAborted:
        return False, "操作被取消"
    return True, ""
