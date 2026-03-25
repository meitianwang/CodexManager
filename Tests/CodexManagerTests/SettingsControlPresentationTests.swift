import XCTest
@testable import CodexManager

final class SettingsControlPresentationTests: XCTestCase {
    func testSwitchBehaviorSectionDisablesRestartTargetPickerWhenSwitchingIsOff() {
        let presentation = SettingsControlPresentation.switchBehaviorSection(
            settings: AppSettings.defaultValue,
            installedEditorApps: [
                InstalledEditorApp(id: .cursor, label: "Cursor")
            ]
        )

        XCTAssertEqual(
            presentation.toggles.map(\.intent),
            [.autoSmartSwitch, .restartEditorsOnSwitch]
        )
        XCTAssertFalse(presentation.restartEditorTargetPicker.isEnabled)
        XCTAssertEqual(
            presentation.restartEditorTargetPicker.options.map(\.title),
            [L10n.tr("common.none"), "Cursor"]
        )
    }

    func testSwitchBehaviorSectionEnablesRestartTargetPickerWhenConfigured() {
        let settings = AppSettings(
            launchAtStartup: false,
            launchCodexAfterSwitch: true,
            autoSmartSwitch: true,
            restartEditorsOnSwitch: true,
            restartEditorTargets: [.vscode],
            autoStartApiProxy: false,
            proxyConfiguration: .defaultValue,
            locale: AppLocale.english.identifier
        )

        let presentation = SettingsControlPresentation.switchBehaviorSection(
            settings: settings,
            installedEditorApps: [
                InstalledEditorApp(id: .vscode, label: "VS Code")
            ]
        )

        XCTAssertTrue(presentation.restartEditorTargetPicker.isEnabled)
        XCTAssertEqual(
            presentation.restartEditorTargetPicker.selectedValue,
            EditorAppID?.some(.vscode)
        )
    }

    func testLanguageSectionNormalizesSelectedLocale() {
        let settings = AppSettings(
            launchAtStartup: false,
            launchCodexAfterSwitch: true,
            autoSmartSwitch: false,
            restartEditorsOnSwitch: false,
            restartEditorTargets: [],
            autoStartApiProxy: false,
            proxyConfiguration: .defaultValue,
            locale: "zh_CN"
        )

        let presentation = SettingsControlPresentation.languageSection(settings: settings)

        XCTAssertEqual(presentation.picker.selectedValue, .simplifiedChinese)
        XCTAssertEqual(presentation.picker.options.count, AppLocale.allCases.count)
    }
}
