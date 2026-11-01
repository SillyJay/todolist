"""PyInstaller 入口：把 wechat-cli 打成独立 exe（不依赖用户机器的 Python）。

两件事：
1. 强制 stdout/stderr 用 UTF-8 —— 冻结后的 exe 不认 PYTHONIOENCODING，
   默认按控制台代码页（简中系统是 GBK）输出，群名里的 emoji 会直接抛
   UnicodeEncodeError（exit 1），上游 JSON 也会变成 GBK 字节，后端按 UTF-8
   解就全是乱码。
2. 调 click 的 cli 入口（与 dist-info 里的 console_scripts 一致）：
       wechat-cli = wechat_cli.main:cli
"""
import io
import sys


def _force_utf8() -> None:
    for name in ("stdout", "stderr"):
        stream = getattr(sys, name, None)
        buf = getattr(stream, "buffer", None)
        if buf is None:
            continue
        try:
            setattr(
                sys,
                name,
                io.TextIOWrapper(buf, encoding="utf-8", errors="replace", line_buffering=True),
            )
        except (ValueError, OSError):
            pass


_force_utf8()

from wechat_cli.main import cli  # noqa: E402

if __name__ == "__main__":
    cli(prog_name="wechat-cli")
