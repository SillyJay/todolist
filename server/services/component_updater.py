"""组件更新检查（只读）。

做两件事：
1. 记住「当前安装的是哪个 commit」（pip 本地目录安装不会记录 commit，只能我们自己存）
2. 用 `git ls-remote` 取仓库远端 HEAD，和本地记录比对

**不做静默升级**：只回答"有没有新提交"，升级由用户在界面上点按钮后手动执行
（升级命令见 apply_command，执行方式写在 docs/wechat-cli-install.md）。
"""
from __future__ import annotations

import os
import subprocess
from datetime import datetime

REPO = "https://github.com/huohuoer/wechat-cli.git"
SETTING_COMMIT = "wechat_cli_commit"
SETTING_CHECKED = "wechat_cli_checked_at"


def _git(args: list[str], timeout: int = 20) -> tuple[int, str]:
    try:
        r = subprocess.run(
            ["git", *args],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return r.returncode, (r.stdout or b"").decode("utf-8", errors="replace").strip()
    except FileNotFoundError:
        return -1, "未找到 git（检查更新需要 git 命令）"
    except subprocess.TimeoutExpired:
        return -2, f"git 超时（{timeout}s）"
    except OSError as e:
        return -3, f"git 调用失败：{e}"


def remote_head(timeout: int = 25) -> tuple[str | None, str]:
    """远端 HEAD 的 commit sha；失败返回 (None, 错误信息)。"""
    code, out = _git(["ls-remote", REPO, "HEAD"], timeout)
    if code != 0:
        return None, out[:200] or f"git exit {code}"
    line = out.splitlines()[0] if out.strip() else ""
    sha = line.split("\t")[0].strip() if line else ""
    return (sha or None), ("" if sha else "远端未返回 HEAD")


def local_source_commit() -> tuple[str | None, str | None]:
    """从本地源码目录推断当前安装的 commit（pip 本地目录安装不记录 commit）。

    依次尝试：环境变量 WECHAT_CLI_SRC → %TEMP%\\wcli → %TEMP%\\wechat-cli
    """
    temp = os.environ.get("TEMP") or os.environ.get("TMP") or ""
    candidates = [
        os.environ.get("WECHAT_CLI_SRC", ""),
        os.path.join(temp, "wcli") if temp else "",
        os.path.join(temp, "wechat-cli") if temp else "",
    ]
    for c in candidates:
        if not c or not os.path.isdir(os.path.join(c, ".git")):
            continue
        code, out = _git(["-C", c, "rev-parse", "HEAD"])
        if code == 0 and out:
            return out.splitlines()[-1].strip(), c
    return None, None


def _short(sha: str | None) -> str:
    return (sha or "")[:7]


def check(db) -> dict:
    """比对远端与本地记录，返回结构化结果（不修改任何东西，除非首次建立基线）。"""
    from db.models import Setting

    row = db.get(Setting, SETTING_COMMIT)
    current = (row.value or "").strip() if row else ""
    source = "recorded" if current else ""

    # 没有记录时，先从本地源码目录推断（能推断就不算"未知"）
    src_dir = None
    if not current:
        hint, src_dir = local_source_commit()
        if hint:
            current = hint
            source = "inferred"

    latest, err = remote_head()

    # 完全无法确定基线：把远端 HEAD 记成基线，避免永久显示"未知"
    if not current and latest:
        current = latest
        source = "new-baseline"

    if current and (not row or row.value != current):
        if row:
            row.value = current
        else:
            db.add(Setting(key=SETTING_COMMIT, value=current))
        db.commit()

    stamp = datetime.now().astimezone().isoformat(timespec="seconds")
    checked = db.get(Setting, SETTING_CHECKED)
    if checked:
        checked.value = stamp
    else:
        db.add(Setting(key=SETTING_CHECKED, value=stamp))
    db.commit()

    has_update = bool(current and latest and current != latest)
    return {
        "repo": REPO,
        "current": _short(current),
        "latest": _short(latest),
        "has_update": has_update,
        "baseline": source,
        "source_dir": src_dir,
        "checked_at": stamp,
        "error": err,
        "apply_command": (
            'python -m pip install --upgrade "git+' + REPO + '"'
            if has_update
            else ""
        ),
    }


# ── 启动时自动检查（每次开软件跑一次，带节流） ──────────────────────────────
STATE_KEY = "wechat_cli_update_state"
CHECK_THROTTLE_MIN = 10  # 10 分钟内重复启动不重复联网


def _read_state(db) -> dict:
    import json

    from db.models import Setting

    row = db.get(Setting, STATE_KEY)
    if not row or not row.value:
        return {}
    try:
        data = json.loads(row.value)
        return data if isinstance(data, dict) else {}
    except ValueError:
        return {}


def _save_state(db, data: dict) -> None:
    import json

    from db.models import Setting

    row = db.get(Setting, STATE_KEY)
    payload = json.dumps(data, ensure_ascii=False)
    if row:
        row.value = payload
    else:
        db.add(Setting(key=STATE_KEY, value=payload))
    db.commit()


def last_state(db) -> dict:
    """给接口用：上一次检查的结果（不含联网）。"""
    return _read_state(db)


def auto_check_on_boot(session_factory) -> dict:
    """开机自动检查一次：失败只记录不抛异常，绝不阻塞启动。

    session_factory：sqlalchemy 的 SessionLocal，线程内自己开会话。
    """
    db = session_factory()
    try:
        prev = _read_state(db)
        stamp = prev.get("checked_at") or ""
        if stamp:
            try:
                from datetime import datetime as _dt

                last = _dt.fromisoformat(stamp)
                age_min = (datetime.now().astimezone() - last).total_seconds() / 60
                if age_min < CHECK_THROTTLE_MIN:
                    return {**prev, "skipped": True, "reason": "刚刚检查过"}
            except ValueError:
                pass

        result = check(db)

        # 网络失败时保留上一次成功的结论，不要把「已是最新」擦成「未知」
        if result.get("error"):
            merged = {
                **prev,
                "error": result["error"],
                "last_error_at": result.get("checked_at"),
                "auto": True,
            }
            _save_state(db, merged)
            return merged

        _save_state(db, {**result, "auto": True})
        return result
    except Exception as e:  # noqa: BLE001 - 启动路径不允许抛
        return {"error": f"{type(e).__name__}: {e}", "has_update": False}
    finally:
        db.close()
