import XCTest
@testable import CodexManager

final class AccountsActionPresentationTests: XCTestCase {
    func testDesktopButtonsReflectBusyState() {
        let buttons = AccountsActionPresentation.desktopButtons(
            isImporting: true,
            isAdding: false,
            switchingAccountID: nil,
            canRefreshUsage: true,
            isRefreshSpinnerActive: false
        )

        XCTAssertEqual(buttons.map(\.intent), [.importCurrentAuth, .addAccount, .smartSwitch, .refreshUsage])
        XCTAssertEqual(buttons.first?.title, L10n.tr("accounts.action.importing"))
        XCTAssertFalse(buttons.first?.isEnabled ?? true)
        XCTAssertFalse(buttons[1].isEnabled)
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
