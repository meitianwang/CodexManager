import XCTest
@testable import CodexManager

final class AccountsActionPresentationTests: XCTestCase {
    func testDesktopButtonsReflectBusyState() {
        let buttons = AccountsActionPresentation.desktopButtons(
            isImporting: true,
            isFileImporting: false,
            isExporting: false,
            isAdding: false,
            switchingAccountID: nil,
            canRefreshUsage: true,
            isRefreshSpinnerActive: false
        )

        XCTAssertEqual(
            buttons.map(\.intent),
            [
                .exportAccountsBackup,
                .importAccountsBackup,
                .importCurrentAuth,
                .addAccount,
                .smartSwitch,
                .warmUpWeeklyQuota,
                .refreshUsage
            ]
        )
        XCTAssertEqual(buttons[2].title, L10n.tr("accounts.action.importing"))
        XCTAssertFalse(buttons[0].isEnabled)
        XCTAssertFalse(buttons[1].isEnabled)
        XCTAssertFalse(buttons[2].isEnabled)
        XCTAssertFalse(buttons[3].isEnabled)
        XCTAssertFalse(buttons[5].isEnabled)
    }

    func testDesktopButtonsReflectWarmupState() {
        let buttons = AccountsActionPresentation.desktopButtons(
            isImporting: false,
            isFileImporting: false,
            isExporting: false,
            isAdding: false,
            switchingAccountID: nil,
            canRefreshUsage: true,
            isRefreshSpinnerActive: false,
            canWarmUpWeeklyQuota: false,
            isWeeklyQuotaWarmupActive: true
        )

        let warmupButton = buttons.first { $0.intent == .warmUpWeeklyQuota }
        XCTAssertEqual(warmupButton?.title, L10n.tr("accounts.action.warming_up_weekly_quota"))
        XCTAssertEqual(warmupButton?.systemImage, "flame")
        XCTAssertFalse(warmupButton?.isEnabled ?? true)
    }

    func testTrailingToolbarButtonsReflectCollapseStateAndSpinner() {
        let buttons = AccountsActionPresentation.trailingToolbarButtons(
            canRefreshUsage: true,
            isRefreshSpinnerActive: true,
            areAllAccountsCollapsed: true
        )

        XCTAssertEqual(buttons.map(\.intent), [.refreshUsage, .toggleCollapse])
        XCTAssertTrue(buttons[0].isSpinning)
        XCTAssertEqual(buttons[1].systemImage, "chevron.down")
        XCTAssertEqual(
            buttons[1].accessibilityLabel,
            L10n.tr("accounts.action.expand_all")
        )
    }
}
