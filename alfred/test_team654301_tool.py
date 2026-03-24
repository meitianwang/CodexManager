#!/usr/bin/env python3

from __future__ import annotations

import unittest
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parent
SRC = ROOT / "team654301-card-tool-src"
sys.path.insert(0, str(SRC))

from team654301_tool import (  # noqa: E402
    InviteToolInputLine,
    InviteToolOperation,
    InviteToolResponsePayload,
    InviteToolResultStep,
    InviteToolResultTone,
    InviteToolRunner,
    parse_input_lines,
)


class StubInviteToolService:
    def __init__(self) -> None:
        self.last_warranty_redeem_email: str | None = None
        self.last_warranty_redeem_original_email: str | None = None

    def redeem(self, code: str, email: str) -> InviteToolResponsePayload:
        return InviteToolResponsePayload(code=code, email=email, message="兑换成功", level="success")

    def check_warranty(self, code: str) -> InviteToolResponsePayload:
        return InviteToolResponsePayload(
            code=code,
            message="需要重新激活",
            level="warning",
            reason="reactivation_required",
            last_used_email="last@example.com",
        )

    def redeem_warranty(self, code: str, email: str, last_used_email: str) -> InviteToolResponsePayload:
        self.last_warranty_redeem_email = email
        self.last_warranty_redeem_original_email = last_used_email
        return InviteToolResponsePayload(
            code=code,
            email=email,
            message="已重新激活",
            level="success",
            last_used_email=last_used_email,
        )

    def query_status(self, code: str) -> InviteToolResponsePayload:
        return InviteToolResponsePayload(
            code=code,
            status="used",
            status_label="已使用",
            status_level="success",
            used_by_email="user@example.com",
        )


class Team654301ToolTests(unittest.TestCase):
    def test_parser_accepts_comma_tab_and_whitespace(self) -> None:
        entries = parse_input_lines(
            """# comment
            Z-ONE,user1@example.com
            Z-TWO\tuser2@example.com
            Z-THREE user3@example.com
            Z-FOUR"""
        )

        self.assertEqual(
            entries,
            [
                InviteToolInputLine(2, "Z-ONE", "user1@example.com"),
                InviteToolInputLine(3, "Z-TWO", "user2@example.com"),
                InviteToolInputLine(4, "Z-THREE", "user3@example.com"),
                InviteToolInputLine(5, "Z-FOUR", None),
            ],
        )

    def test_redeem_without_email_returns_validation_error(self) -> None:
        runner = InviteToolRunner(StubInviteToolService(), delay_seconds=0)
        result = runner.run(
            InviteToolOperation.REDEEM,
            [InviteToolInputLine(1, "Z-ONE", None)],
            default_email=None,
        )

        self.assertEqual(result.summary.error_count, 1)
        self.assertEqual(result.rows[0].tone, InviteToolResultTone.ERROR)
        self.assertEqual(result.rows[0].step, InviteToolResultStep.VALIDATE_INPUT)

    def test_warranty_reactivation_falls_back_to_last_used_email(self) -> None:
        service = StubInviteToolService()
        runner = InviteToolRunner(service, delay_seconds=0)
        result = runner.run(
            InviteToolOperation.WARRANTY,
            [InviteToolInputLine(1, "Z-ONE", None)],
            default_email=None,
        )

        self.assertEqual(result.rows[0].step, InviteToolResultStep.WARRANTY_REDEEM)
        self.assertEqual(result.rows[0].final_email, "last@example.com")
        self.assertEqual(service.last_warranty_redeem_email, "last@example.com")
        self.assertEqual(service.last_warranty_redeem_original_email, "last@example.com")


if __name__ == "__main__":
    unittest.main()
