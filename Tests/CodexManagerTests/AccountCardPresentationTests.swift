import XCTest
@testable import CodexManager

final class AccountCardPresentationTests: XCTestCase {
    func testCollapsedPresentationUsesAliasAccentAndShortEmail() {
        let account = AccountSummary(
            id: "acct-1",
            label: "Primary",
            email: "dev@example.com",
            accountID: "account-1",
            planType: "business",
            teamName: "workspace-a",
            teamAlias: "Alias A",
            addedAt: 1,
            updatedAt: 2,
            usage: UsageSnapshot(
                fetchedAt: 3,
                planType: "business",
                fiveHour: UsageWindow(usedPercent: 27.2, windowSeconds: 18_000, resetAt: 1_763_216_000),
                oneWeek: UsageWindow(usedPercent: 52.6, windowSeconds: 604_800, resetAt: 1_763_820_800),
                credits: CreditSnapshot(hasCredits: true, unlimited: false, balance: "128")
            ),
            usageError: nil,
            isCurrent: true
        )

        let presentation = AccountCardPresentation(
            account: account,
            isCollapsed: true,
            locale: Locale(identifier: "en_US_POSIX")
        )

        XCTAssertEqual(presentation.accent, .indigo)
        XCTAssertEqual(presentation.planLabel, "BUSINESS")
        XCTAssertEqual(presentation.teamNameTag, "Alias A")
        XCTAssertEqual(presentation.displayAccountName, "dev")
        XCTAssertEqual(presentation.creditsText, "128")
        XCTAssertEqual(presentation.compactUsage.fiveHourRemainingPercent, 72.8)
        XCTAssertEqual(presentation.compactUsage.oneWeekRemainingPercent, 47.4)
        XCTAssertEqual(presentation.fiveHourWindow.remainingPercent, 73)
        XCTAssertEqual(presentation.fiveHourWindow.remainingText, L10n.tr("accounts.window.remaining_format", "73%"))
        XCTAssertEqual(presentation.fiveHourWindow.usedText, L10n.tr("accounts.window.used_format", "27%"))
        XCTAssertNotEqual(presentation.fiveHourWindow.resetValueText, presentation.oneWeekWindow.resetValueText)
        XCTAssertTrue(presentation.fiveHourWindow.resetText.contains(presentation.fiveHourWindow.resetValueText))
        XCTAssertTrue(presentation.oneWeekWindow.resetText.contains(presentation.oneWeekWindow.resetValueText))
    }

    func testExpandedPresentationFallsBackToTeamAccentAndMissingWindowDefaults() {
        let account = AccountSummary(
            id: "acct-2",
            label: "Backup",
            email: nil,
            accountID: "account-2",
            planType: nil,
            teamName: nil,
            teamAlias: nil,
            addedAt: 1,
            updatedAt: 2,
            usage: UsageSnapshot(
                fetchedAt: 3,
                planType: nil,
                fiveHour: nil,
                oneWeek: nil,
                credits: CreditSnapshot(hasCredits: false, unlimited: true, balance: nil)
            ),
            usageError: nil,
            isCurrent: false
        )

        let presentation = AccountCardPresentation(
            account: account,
            isCollapsed: false,
            locale: Locale(identifier: "en_US_POSIX")
        )

        XCTAssertEqual(presentation.accent, .teal)
        XCTAssertEqual(presentation.planLabel, "TEAM")
        XCTAssertNil(presentation.teamNameTag)
        XCTAssertEqual(presentation.displayAccountName, "account-2")
        XCTAssertEqual(presentation.creditsText, L10n.tr("accounts.card.unlimited"))
        XCTAssertEqual(presentation.fiveHourWindow.remainingPercent, 0)
        XCTAssertEqual(presentation.fiveHourWindow.resetValueText, "--")
        XCTAssertEqual(presentation.fiveHourWindow.resetText, L10n.tr("accounts.window.reset_at_format", "--"))
    }
}
