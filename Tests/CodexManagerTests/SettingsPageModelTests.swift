import XCTest
@testable import CodexManager

@MainActor
final class SettingsPageModelTests: XCTestCase {
    func testQuitAppInvokesInjectedAction() {
        var didQuit = false
        let model = SettingsPageModel(
            settingsCoordinator: SettingsCoordinator(
                settingsRepository: TestSettingsRepository(),
                launchAtStartupService: SettingsStubLaunchAtStartupService()
            ),
            editorAppService: SettingsStubEditorAppService(),
            onQuitRequested: {
                didQuit = true
            }
        )

        model.quitApp()

        XCTAssertTrue(didQuit)
    }
}

final class TestSettingsRepository: SettingsRepository, @unchecked Sendable {
    private var settings: AppSettings

    init(settings: AppSettings = .defaultValue) {
        self.settings = settings
    }

    func loadSettings() throws -> AppSettings {
        settings
    }

    func saveSettings(_ settings: AppSettings) throws {
        self.settings = settings
    }
}

private struct SettingsStubLaunchAtStartupService: LaunchAtStartupServiceProtocol {
    func setEnabled(_ enabled: Bool) throws {
        _ = enabled
    }

    func syncWithStoreValue(_ enabled: Bool) throws {
        _ = enabled
    }
}

private struct SettingsStubEditorAppService: EditorAppServiceProtocol {
    func listInstalledApps() -> [InstalledEditorApp] {
        []
    }

    func restartSelectedApps(_ targets: [EditorAppID]) -> (restarted: [EditorAppID], error: String?) {
        (targets, nil)
    }
}
