import XCTest
@testable import CodexManager

final class RemoteServerCardPresentationTests: XCTestCase {
    func testHeaderFallsBackToDefaultLabelAndCollapsedSubtitle() {
        let presentation = RemoteServerCardPresentation.header(
            label: "",
            sshUser: "root",
            host: "1.2.3.4",
            sshPort: 2222,
            isExpanded: false,
            status: nil
        )

        XCTAssertEqual(presentation.title, RemoteServerConfiguration.defaultLabel)
        XCTAssertEqual(presentation.subtitle, "root@1.2.3.4:2222")
        XCTAssertFalse(presentation.isRunning)
    }

    func testMetricsAndDetailsExposeFallbackValues() {
        let metrics = RemoteServerCardPresentation.metrics(status: nil)
        let details = RemoteServerCardPresentation.details(status: nil)

        XCTAssertEqual(metrics.last?.value, "--")
        XCTAssertEqual(details[0].value, "--")
        XCTAssertFalse(details[1].canCopy)
        XCTAssertEqual(details[1].value, "Generated after first start")
    }

    func testLogsPresentationUsesPlaceholderWhenLogsMissing() {
        let presentation = RemoteServerCardPresentation.logs(logs: nil)

        XCTAssertEqual(presentation.content, "Logs have not been loaded yet")
        XCTAssertFalse(presentation.canCopy)
    }
}
