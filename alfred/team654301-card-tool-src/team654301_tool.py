#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from enum import Enum
from typing import Any, Iterable, Protocol


DEFAULT_BASE_URL = "https://team.654301.xyz"
DEFAULT_DELAY_SECONDS = 0.25
DEFAULT_TIMEOUT_SECONDS = 15.0


class InviteToolOperation(str, Enum):
    REDEEM = "redeem"
    WARRANTY = "warranty"
    STATUS = "status"

    @property
    def title(self) -> str:
        if self is InviteToolOperation.REDEEM:
            return "批量兑换"
        if self is InviteToolOperation.WARRANTY:
            return "质保激活"
        return "激活查询"

    @property
    def description(self) -> str:
        if self is InviteToolOperation.REDEEM:
            return "每行支持“卡密,邮箱”或“卡密 邮箱”。缺邮箱时会回退到默认邮箱。"
        if self is InviteToolOperation.WARRANTY:
            return "每行支持“卡密,新邮箱”。需重激活时优先使用行内邮箱，其次默认邮箱，最后原邮箱。"
        return "每行一个卡密，支持空行和以 # 开头的注释。"


class InviteToolResultTone(str, Enum):
    SUCCESS = "success"
    WARNING = "warning"
    ERROR = "error"

    @property
    def title(self) -> str:
        if self is InviteToolResultTone.SUCCESS:
            return "成功"
        if self is InviteToolResultTone.WARNING:
            return "需处理"
        return "失败"


class InviteToolResultStep(str, Enum):
    VALIDATE_INPUT = "validate_input"
    REDEEM = "redeem"
    WARRANTY_CHECK = "warranty_check"
    WARRANTY_REDEEM = "warranty_redeem"
    STATUS = "status"


@dataclass(frozen=True)
class InviteToolInputLine:
    line_number: int
    code: str
    email: str | None


@dataclass(frozen=True)
class InviteToolResponsePayload:
    code: str | None = None
    email: str | None = None
    invited_at: str | None = None
    code_type_display: str | None = None
    warranty_duration: int | None = None
    first_used_at: str | None = None
    warranty_expires_at: str | None = None
    is_warranty: bool | None = None
    message: str | None = None
    level: str | None = None
    reason: str | None = None
    status: str | None = None
    status_label: str | None = None
    status_level: str | None = None
    last_used_email: str | None = None
    used_by_email: str | None = None
    used_at: str | None = None

    @staticmethod
    def from_dict(payload: dict[str, Any]) -> "InviteToolResponsePayload":
        return InviteToolResponsePayload(
            code=payload.get("code"),
            email=payload.get("email"),
            invited_at=payload.get("invited_at"),
            code_type_display=payload.get("code_type_display"),
            warranty_duration=payload.get("warranty_duration"),
            first_used_at=payload.get("first_used_at"),
            warranty_expires_at=payload.get("warranty_expires_at"),
            is_warranty=payload.get("is_warranty"),
            message=payload.get("message"),
            level=payload.get("level"),
            reason=payload.get("reason"),
            status=payload.get("status"),
            status_label=payload.get("status_label"),
            status_level=payload.get("status_level"),
            last_used_email=payload.get("last_used_email"),
            used_by_email=payload.get("used_by_email"),
            used_at=payload.get("used_at"),
        )


@dataclass(frozen=True)
class InviteToolResultRow:
    line_number: int
    code: str
    tone: InviteToolResultTone
    step: InviteToolResultStep
    message: str
    request_email: str | None
    final_email: str | None
    payload: InviteToolResponsePayload | None

    @property
    def detail_items(self) -> list[tuple[str, str]]:
        items: list[tuple[str, str]] = []
        if self.request_email:
            items.append(("提交邮箱", self.request_email))
        if self.final_email and self.final_email != self.request_email:
            items.append(("最终邮箱", self.final_email))

        payload = self.payload
        if not payload:
            return items

        if payload.email and payload.email != self.final_email:
            items.append(("接口邮箱", payload.email))
        if payload.last_used_email:
            items.append(("原邮箱", payload.last_used_email))
        if payload.used_by_email:
            items.append(("使用邮箱", payload.used_by_email))
        if payload.invited_at:
            items.append(("邀请时间", payload.invited_at))
        if payload.used_at:
            items.append(("使用时间", payload.used_at))
        if payload.first_used_at:
            items.append(("首次使用", payload.first_used_at))
        if payload.warranty_expires_at:
            items.append(("质保截止", payload.warranty_expires_at))
        return items

    def to_dict(self) -> dict[str, Any]:
        return {
            "line_number": self.line_number,
            "code": self.code,
            "tone": self.tone.value,
            "step": self.step.value,
            "message": self.message,
            "request_email": self.request_email,
            "final_email": self.final_email,
            "payload": asdict(self.payload) if self.payload else None,
            "detail_items": [{"label": label, "value": value} for label, value in self.detail_items],
        }


@dataclass(frozen=True)
class InviteToolSummary:
    total: int
    success_count: int
    warning_count: int
    error_count: int

    def to_dict(self) -> dict[str, int]:
        return asdict(self)


@dataclass(frozen=True)
class InviteToolBatchResult:
    operation: InviteToolOperation
    summary: InviteToolSummary
    rows: list[InviteToolResultRow]

    def to_dict(self) -> dict[str, Any]:
        return {
            "operation": self.operation.value,
            "summary": self.summary.to_dict(),
            "rows": [row.to_dict() for row in self.rows],
        }


class InviteToolServiceProtocol(Protocol):
    def redeem(self, code: str, email: str) -> InviteToolResponsePayload: ...
    def check_warranty(self, code: str) -> InviteToolResponsePayload: ...
    def redeem_warranty(self, code: str, email: str, last_used_email: str) -> InviteToolResponsePayload: ...
    def query_status(self, code: str) -> InviteToolResponsePayload: ...


class InviteToolServiceError(RuntimeError):
    pass


class InviteToolService:
    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
        user_agent: str = "Team654301 Alfred Workflow/1.0",
    ) -> None:
        self.base_url = ensure_trailing_slash(base_url)
        self.timeout_seconds = timeout_seconds
        self.user_agent = user_agent

    def redeem(self, code: str, email: str) -> InviteToolResponsePayload:
        return self._post("/api/redeem/", {"code": code, "email": email})

    def check_warranty(self, code: str) -> InviteToolResponsePayload:
        return self._post("/api/warranty/activate/", {"codes": code})

    def redeem_warranty(self, code: str, email: str, last_used_email: str) -> InviteToolResponsePayload:
        return self._post(
            "/api/warranty/redeem/",
            {
                "code": code,
                "email": email,
                "last_used_email": last_used_email,
            },
        )

    def query_status(self, code: str) -> InviteToolResponsePayload:
        return self._post("/api/status/", {"code": code})

    def _post(self, path: str, form: dict[str, str]) -> InviteToolResponsePayload:
        url = urllib.parse.urljoin(self.base_url, path.lstrip("/"))
        payload = urllib.parse.urlencode(form).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=payload,
            method="POST",
            headers={
                "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
                "X-Requested-With": "XMLHttpRequest",
                "User-Agent": self.user_agent,
            },
        )

        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                body = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            payload_dict = try_parse_json(body)
            if payload_dict is None:
                raise InviteToolServiceError(f"HTTP {error.code}: {body or error.reason}") from error
            return InviteToolResponsePayload.from_dict(payload_dict)
        except urllib.error.URLError as error:
            raise InviteToolServiceError(f"网络错误: {error.reason}") from error

        payload_dict = try_parse_json(body)
        if payload_dict is None:
            raise InviteToolServiceError("接口返回的数据无法解析。")
        return InviteToolResponsePayload.from_dict(payload_dict)


class InviteToolRunner:
    def __init__(self, service: InviteToolServiceProtocol, delay_seconds: float = DEFAULT_DELAY_SECONDS) -> None:
        self.service = service
        self.delay_seconds = max(delay_seconds, 0.0)

    def run(
        self,
        operation: InviteToolOperation,
        entries: list[InviteToolInputLine],
        default_email: str | None,
    ) -> InviteToolBatchResult:
        rows: list[InviteToolResultRow] = []
        for index, entry in enumerate(entries):
            if index:
                time.sleep(self.delay_seconds)
            if operation is InviteToolOperation.REDEEM:
                rows.append(self._redeem(entry, default_email))
            elif operation is InviteToolOperation.WARRANTY:
                rows.append(self._warranty(entry, default_email))
            else:
                rows.append(self._status(entry))

        summary = InviteToolSummary(
            total=len(rows),
            success_count=sum(1 for row in rows if row.tone is InviteToolResultTone.SUCCESS),
            warning_count=sum(1 for row in rows if row.tone is InviteToolResultTone.WARNING),
            error_count=sum(1 for row in rows if row.tone is InviteToolResultTone.ERROR),
        )
        return InviteToolBatchResult(operation=operation, summary=summary, rows=rows)

    def _redeem(self, entry: InviteToolInputLine, default_email: str | None) -> InviteToolResultRow:
        target_email = resolve_email(entry.email, default_email)
        if not target_email:
            return InviteToolResultRow(
                line_number=entry.line_number,
                code=entry.code,
                tone=InviteToolResultTone.ERROR,
                step=InviteToolResultStep.VALIDATE_INPUT,
                message="兑换需要邮箱。请在该行补充邮箱，或填写默认邮箱。",
                request_email=entry.email,
                final_email=None,
                payload=None,
            )

        try:
            payload = self.service.redeem(entry.code, target_email)
            return InviteToolResultRow(
                line_number=entry.line_number,
                code=entry.code,
                tone=tone_for_payload(payload),
                step=InviteToolResultStep.REDEEM,
                message=payload.message or "兑换完成。",
                request_email=entry.email,
                final_email=target_email,
                payload=payload,
            )
        except Exception as error:
            return InviteToolResultRow(
                line_number=entry.line_number,
                code=entry.code,
                tone=InviteToolResultTone.ERROR,
                step=InviteToolResultStep.REDEEM,
                message=str(error),
                request_email=entry.email,
                final_email=target_email,
                payload=None,
            )

    def _warranty(self, entry: InviteToolInputLine, default_email: str | None) -> InviteToolResultRow:
        try:
            payload = self.service.check_warranty(entry.code)
            if payload.reason == "reactivation_required" and payload.last_used_email:
                target_email = resolve_email(entry.email, default_email) or payload.last_used_email
                redeem_payload = self.service.redeem_warranty(entry.code, target_email, payload.last_used_email)
                return InviteToolResultRow(
                    line_number=entry.line_number,
                    code=entry.code,
                    tone=tone_for_payload(redeem_payload),
                    step=InviteToolResultStep.WARRANTY_REDEEM,
                    message=redeem_payload.message or "已完成重新激活。",
                    request_email=entry.email,
                    final_email=target_email,
                    payload=redeem_payload,
                )

            return InviteToolResultRow(
                line_number=entry.line_number,
                code=entry.code,
                tone=tone_for_payload(payload),
                step=InviteToolResultStep.WARRANTY_CHECK,
                message=payload.message or "质保检查完成。",
                request_email=entry.email,
                final_email=None,
                payload=payload,
            )
        except Exception as error:
            return InviteToolResultRow(
                line_number=entry.line_number,
                code=entry.code,
                tone=InviteToolResultTone.ERROR,
                step=InviteToolResultStep.WARRANTY_CHECK,
                message=str(error),
                request_email=entry.email,
                final_email=None,
                payload=None,
            )

    def _status(self, entry: InviteToolInputLine) -> InviteToolResultRow:
        try:
            payload = self.service.query_status(entry.code)
            return InviteToolResultRow(
                line_number=entry.line_number,
                code=entry.code,
                tone=tone_for_payload(payload),
                step=InviteToolResultStep.STATUS,
                message=(f"当前状态：{payload.status_label}" if payload.status_label else payload.message) or "查询完成。",
                request_email=entry.email,
                final_email=None,
                payload=payload,
            )
        except Exception as error:
            return InviteToolResultRow(
                line_number=entry.line_number,
                code=entry.code,
                tone=InviteToolResultTone.ERROR,
                step=InviteToolResultStep.STATUS,
                message=str(error),
                request_email=entry.email,
                final_email=None,
                payload=None,
            )


def parse_input_lines(raw_input: str) -> list[InviteToolInputLine]:
    entries: list[InviteToolInputLine] = []
    for index, raw_line in enumerate(raw_input.splitlines(), start=1):
        trimmed = raw_line.strip()
        if not trimmed or trimmed.startswith("#"):
            continue

        parts = split_line(trimmed)
        code = parts[0].strip() if parts else ""
        if not code:
            continue
        email = parts[1].strip() if len(parts) > 1 else None
        entries.append(InviteToolInputLine(index, code, email or None))
    return entries


def split_line(line: str) -> list[str]:
    if "," in line:
        left, right = line.split(",", 1)
        return [left, right]
    if "\t" in line:
        left, right = line.split("\t", 1)
        return [left, right]
    parts = line.split()
    if len(parts) >= 2:
        return [parts[0], parts[1]]
    return [line]


def resolve_email(request_email: str | None, default_email: str | None) -> str | None:
    request_value = sanitize_text(request_email)
    if request_value:
        return request_value
    return sanitize_text(default_email)


def sanitize_text(value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def tone_for_payload(payload: InviteToolResponsePayload) -> InviteToolResultTone:
    marker = payload.level or payload.status_level or ""
    if marker == "success":
        return InviteToolResultTone.SUCCESS
    if marker == "warning":
        return InviteToolResultTone.WARNING
    if payload.reason == "reactivation_required":
        return InviteToolResultTone.WARNING
    if marker == "error":
        return InviteToolResultTone.ERROR
    return InviteToolResultTone.WARNING


def format_markdown(result: InviteToolBatchResult) -> str:
    lines = [
        f"# {result.operation.title}",
        "",
        f"- 总数：`{result.summary.total}`",
        f"- 成功：`{result.summary.success_count}`",
        f"- 需处理：`{result.summary.warning_count}`",
        f"- 失败：`{result.summary.error_count}`",
        "",
    ]

    if not result.rows:
        lines.extend(["没有可处理的卡密。", ""])
        return "\n".join(lines)

    for row in result.rows:
        lines.append(f"## 第 {row.line_number} 行 · `{row.code}`")
        lines.append("")
        lines.append(f"- 结果：`{row.tone.title}`")
        lines.append(f"- 阶段：`{row.step.value}`")
        lines.append(f"- 说明：{row.message}")
        for label, value in row.detail_items:
            lines.append(f"- {label}：`{value}`")
        lines.append("")
    return "\n".join(lines)


def ensure_trailing_slash(url: str) -> str:
    return url if url.endswith("/") else f"{url}/"


def try_parse_json(text: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def read_input_text(file_path: str | None) -> str:
    if file_path:
        with open(file_path, "r", encoding="utf-8") as handle:
            return handle.read()
    return sys.stdin.read()


def build_cli_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Standalone Team 654301 invite/code tool.")
    parser.add_argument("operation", choices=[item.value for item in InviteToolOperation])
    parser.add_argument("--file", help="Read batch input from a file instead of stdin.")
    parser.add_argument("--default-email", help="Default email used when a line omits it.")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY_SECONDS)
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_SECONDS)
    parser.add_argument("--format", choices=("json", "markdown"), default="json")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_cli_parser()
    args = parser.parse_args(argv)

    raw_input = read_input_text(args.file)
    entries = parse_input_lines(raw_input)
    if not entries:
        print("No valid codes found in input.", file=sys.stderr)
        return 2

    runner = InviteToolRunner(
        InviteToolService(base_url=args.base_url, timeout_seconds=args.timeout),
        delay_seconds=args.delay,
    )
    result = runner.run(InviteToolOperation(args.operation), entries, args.default_email)

    if args.format == "markdown":
        markdown = format_markdown(result)
        sys.stdout.write(markdown)
        if not markdown.endswith("\n"):
            sys.stdout.write("\n")
    else:
        json.dump(result.to_dict(), sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
