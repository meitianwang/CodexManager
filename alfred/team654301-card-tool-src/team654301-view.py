#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from team654301_tool import (
    DEFAULT_BASE_URL,
    DEFAULT_DELAY_SECONDS,
    DEFAULT_TIMEOUT_SECONDS,
    InviteToolOperation,
    InviteToolRunner,
    InviteToolService,
    format_markdown,
    parse_input_lines,
    sanitize_text,
)


def env(name: str) -> str | None:
    return os.environ.get(name)


def read_clipboard() -> str:
    result = subprocess.run(
        ["pbpaste"],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout


def parse_payload(raw: str) -> dict[str, str]:
    if not raw:
        return {"action": "preview"}
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return {"action": "preview"}
    return payload if isinstance(payload, dict) else {"action": "preview"}


def parse_float_env(name: str, default: float) -> float:
    raw = sanitize_text(env(name))
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def preview_markdown(raw_clipboard: str) -> str:
    entries = parse_input_lines(raw_clipboard)
    lines = [
        "# 剪贴板解析预览",
        "",
        f"- 原始行数：`{len(raw_clipboard.splitlines())}`",
        f"- 可处理条数：`{len(entries)}`",
        "",
    ]

    if not entries:
        lines.extend(
            [
                "没有识别到有效卡密。",
                "",
                "```text",
                raw_clipboard.strip() or "[clipboard empty]",
                "```",
            ]
        )
        return "\n".join(lines)

    for entry in entries:
        email = entry.email or "-"
        lines.append(f"- 第 `{entry.line_number}` 行: `{entry.code}` | 邮箱: `{email}`")
    return "\n".join(lines)


def run_markdown(operation: InviteToolOperation, raw_clipboard: str, default_email: str | None) -> str:
    entries = parse_input_lines(raw_clipboard)
    if not entries:
        return "\n".join(
            [
                "# 没有可处理的卡密",
                "",
                "剪贴板里没有识别到有效输入。先复制多行卡密，再重新运行。",
            ]
        )

    base_url = sanitize_text(env("base_url")) or DEFAULT_BASE_URL
    timeout_seconds = parse_float_env("request_timeout_seconds", DEFAULT_TIMEOUT_SECONDS)
    delay_seconds = parse_float_env("request_delay_seconds", DEFAULT_DELAY_SECONDS)

    runner = InviteToolRunner(
        InviteToolService(base_url=base_url, timeout_seconds=timeout_seconds),
        delay_seconds=delay_seconds,
    )
    result = runner.run(operation, entries, default_email)
    return format_markdown(result)


def main(argv: list[str]) -> int:
    payload = parse_payload(argv[0] if argv else "")
    action = payload.get("action", "preview")
    default_email = sanitize_text(env("default_email"))
    clipboard = read_clipboard()

    if action == "run":
        operation = InviteToolOperation(payload.get("operation", InviteToolOperation.STATUS.value))
        markdown = run_markdown(operation, clipboard, default_email)
        footer = "结果来自当前剪贴板批量输入。"
    else:
        markdown = preview_markdown(clipboard)
        footer = "仅预览解析结果，未发起网络请求。"

    response = {
        "response": markdown,
        "footer": footer,
    }
    print(json.dumps(response, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
