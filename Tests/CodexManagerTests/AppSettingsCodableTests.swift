import XCTest
@testable import CodexManager

final class AppSettingsCodableTests: XCTestCase {
    func testDecodeSettingsRequiresFullCurrentShape() throws {
        let json = """
        {
          "launchAtStartup": true,
          "launchCodexAfterSwitch": true,
          "autoSmartSwitch": false,
          "syncOpencodeOpenaiAuth": false
        }
        """

        XCTAssertThrowsError(try JSONDecoder().decode(AppSettings.self, from: Data(json.utf8)))
    }
}
