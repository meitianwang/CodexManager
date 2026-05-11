import XCTest
@testable import CodexManager

final class AppSettingsCodableTests: XCTestCase {
    func testDecodeSettingsUsesDefaultsForMissingCurrentFields() throws {
        let json = """
        {
          "launchAtStartup": true,
          "launchCodexAfterSwitch": true,
          "autoSmartSwitch": false,
          "syncOpencodeOpenaiAuth": false
        }
        """

        let settings = try JSONDecoder().decode(AppSettings.self, from: Data(json.utf8))

        XCTAssertTrue(settings.launchAtStartup)
        XCTAssertTrue(settings.launchCodexAfterSwitch)
        XCTAssertFalse(settings.autoSmartSwitch)
        XCTAssertEqual(settings.restartEditorsOnSwitch, AppSettings.defaultValue.restartEditorsOnSwitch)
        XCTAssertEqual(settings.restartEditorTargets, AppSettings.defaultValue.restartEditorTargets)
        XCTAssertEqual(settings.locale, AppSettings.defaultValue.locale)
        XCTAssertEqual(settings.proxyPort, AppSettings.defaultValue.proxyPort)
        XCTAssertEqual(settings.proxyApiKey, AppSettings.defaultValue.proxyApiKey)
        XCTAssertEqual(settings.autoStartProxy, AppSettings.defaultValue.autoStartProxy)
    }
}
