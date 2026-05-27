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
            [.exportAccountsBackup, .importAccountsBackup, .importCurrentAuth, .addAccount, .smartSwitch, .refreshUsage]
        )
        XCTAssertEqual(buttons[2].title, L10n.tr("accounts.action.importing"))
        XCTAssertFalse(buttons[0].isEnabled)
        XCTAssertFalse(buttons[1].isEnabled)
        XCTAssertFalse(buttons[2].isEnabled)
        XCTAssertFalse(buttons[3].isEnabled)
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
