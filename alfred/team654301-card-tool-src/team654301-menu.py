#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from team654301_tool import InviteToolOperation, parse_input_lines, sanitize_text


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


def make_item(
    title: str,
    subtitle: str,
    arg: dict[str, str] | None = None,
    valid: bool = True,
    autocomplete: str | None = None,
) -> dict[str, object]:
    item: dict[str, object] = {
        "title": title,
        "subtitle": subtitle,
        "valid": valid,
    }
    if arg is not None:
        item["arg"] = json.dumps(arg, ensure_ascii=False)
    if autocomplete is not None:
        item["autocomplete"] = autocomplete
    return item


def operation_item(
    operation: InviteToolOperation,
    entry_count: int,
    missing_email_count: int,
    default_email: str | None,
) -> dict[str, object]:
    subtitle = f"使用剪贴板中的 {entry_count} 条记录执行 {operation.title}。"
    if operation is InviteToolOperation.REDEEM and missing_email_count > 0 and not default_email:
        subtitle += f" 有 {missing_email_count} 行缺少邮箱，会在结果里报错。"
    elif operation is InviteToolOperation.WARRANTY and missing_email_count > 0 and default_email:
        subtitle += f" 缺邮箱行会回退到默认邮箱 {default_email}。"
    elif default_email and operation is not InviteToolOperation.STATUS:
        subtitle += f" 默认邮箱：{default_email}。"

    return make_item(
        title=operation.title,
        subtitle=subtitle,
        arg={"action": "run", "operation": operation.value},
    )


def preview_item(entry_count: int) -> dict[str, object]:
    return make_item(
        title="预览剪贴板解析结果",
        subtitle=f"确认这 {entry_count} 行会如何被解析，再决定执行哪个操作。",
        arg={"action": "preview"},
    )


def main(argv: list[str]) -> int:
    query = sanitize_text(argv[0] if argv else "") or ""
    default_email = sanitize_text(env("default_email"))
    clipboard = read_clipboard()
    entries = parse_input_lines(clipboard)

    items: list[dict[str, object]] = []
    if entries:
        missing_email_count = sum(1 for entry in entries if not entry.email)
        for operation in InviteToolOperation:
            items.append(operation_item(operation, len(entries), missing_email_count, default_email))
        items.append(preview_item(len(entries)))
    else:
        items.append(
            make_item(
                title="剪贴板里没有可识别的卡密输入",
                subtitle="先复制多行卡密，再运行工作流。支持“卡密,邮箱”或“卡密 邮箱”。",
                valid=False,
            )
        )
    if query:
        query_lower = query.lower()
        items = [
            item
            for item in items
            if query_lower in str(item.get("title", "")).lower()
            or query_lower in str(item.get("subtitle", "")).lower()
        ]

    print(json.dumps({"items": items}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
