import XCTest
@testable import CodexManager

final class PublicAccessSectionPresentationTests: XCTestCase {
    func testModeCardsReflectSelectedModeAndEditability() {
        let descriptors = PublicAccessSectionPresentation.modeCards(
            selectedMode: .named,
            isEnabled: false
        )

        XCTAssertEqual(descriptors.map(\.mode), [.quick, .named])
        XCTAssertFalse(descriptors[0].selected)
        XCTAssertTrue(descriptors[1].selected)
        XCTAssertFalse(descriptors[0].isEnabled)
    }

    func testStartLocalProxyCalloutOnlyAppearsWhenProxyIsStopped() {
        XCTAssertNotNil(
            PublicAccessSectionPresentation.startLocalProxyCallout(isProxyRunning: false)
        )
        XCTAssertNil(
            PublicAccessSectionPresentation.startLocalProxyCallout(isProxyRunning: true)
        )
    }

    func testStatusCardsExposePublicURLCopyBehavior() {
        let cards = PublicAccessSectionPresentation.statusCards(
            status: CloudflaredStatus(
                installed: true,
                binaryPath: "/usr/local/bin/cloudflared",
                running: true,
                tunnelMode: .quick,
                publicURL: "https://example.trycloudflare.com",
                customHostname: nil,
                useHTTP2: true,
                lastError: nil
            )
        )

        XCTAssertEqual(cards.map(\.id), ["status", "url", "install-path", "last-error"])
        XCTAssertEqual(cards[1].copyValue, "https://example.trycloudflare.com")
        XCTAssertEqual(cards[1].truncation, .middle)
    }
}
