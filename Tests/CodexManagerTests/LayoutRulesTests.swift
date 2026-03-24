import XCTest
@testable import CodexManager

final class LayoutRulesTests: XCTestCase {
    func testIPadMiniPortraitColumnCounts() {
        let expanded = LayoutRules.accountsGridColumnCount(
            context: .init(
                platform: .iPadMini,
                isOverviewMode: false,
                viewportSize: CGSize(width: 744, height: 1133)
            )
        )
        let collapsed = LayoutRules.accountsGridColumnCount(
            context: .init(
                platform: .iPadMini,
                isOverviewMode: true,
                viewportSize: CGSize(width: 744, height: 1133)
            )
        )

        XCTAssertEqual(expanded, 2)
        XCTAssertEqual(collapsed, 3)
    }

    func testIPadMiniLandscapeColumnCounts() {
        let expanded = LayoutRules.accountsGridColumnCount(
            context: .init(
                platform: .iPadMini,
                isOverviewMode: false,
                viewportSize: CGSize(width: 1133, height: 744)
            )
        )
        let collapsed = LayoutRules.accountsGridColumnCount(
            context: .init(
                platform: .iPadMini,
                isOverviewMode: true,
                viewportSize: CGSize(width: 1133, height: 744)
            )
        )

        XCTAssertEqual(expanded, 3)
        XCTAssertEqual(collapsed, 5)
    }

    func testRegularIPadPortraitColumnCounts() {
        let expanded = LayoutRules.accountsGridColumnCount(
            context: .init(
                platform: .iPadRegular,
                isOverviewMode: false,
                viewportSize: CGSize(width: 820, height: 1180)
            )
        )
        let collapsed = LayoutRules.accountsGridColumnCount(
            context: .init(
                platform: .iPadRegular,
                isOverviewMode: true,
                viewportSize: CGSize(width: 820, height: 1180)
            )
        )

        XCTAssertEqual(expanded, 3)
        XCTAssertEqual(collapsed, 5)
    }

    func testRegularIPadLandscapeColumnCounts() {
        let expanded = LayoutRules.accountsGridColumnCount(
            context: .init(
                platform: .iPadRegular,
                isOverviewMode: false,
                viewportSize: CGSize(width: 1180, height: 820)
            )
        )
        let collapsed = LayoutRules.accountsGridColumnCount(
            context: .init(
                platform: .iPadRegular,
                isOverviewMode: true,
                viewportSize: CGSize(width: 1180, height: 820)
            )
        )

        XCTAssertEqual(expanded, 4)
        XCTAssertEqual(collapsed, 7)
    }

    func testNarrowViewportCapsRequestedColumnCount() {
        let collapsed = LayoutRules.accountsGridColumnCount(
            context: .init(
                platform: .iPadRegular,
                isOverviewMode: true,
                viewportSize: CGSize(width: 680, height: 820)
            )
        )

        XCTAssertEqual(collapsed, 4)
    }
}
