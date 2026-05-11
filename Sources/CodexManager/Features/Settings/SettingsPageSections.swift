import SwiftUI

struct SettingsPageContent: View {
    @ObservedObject var model: SettingsPageModel

    var body: some View {
        #if os(macOS)
        MacSettingsPageContent(model: model)
        #else
        IOSSettingsPageContent(model: model)
        #endif
    }
}

#if os(macOS)
private struct MacSettingsPageContent: View {
    @ObservedObject var model: SettingsPageModel

    var body: some View {
        MacPageScrollContainer {
            SettingsGeneralSection(model: model)
            SettingsLanguageSection(model: model)
            SettingsSwitchBehaviorSection(model: model)

            SettingsQuitFooter(onQuit: model.quitApp)
        }
        .task {
            await model.loadIfNeeded()
        }
    }
}

private struct SettingsGeneralSection: View {
    @ObservedObject var model: SettingsPageModel

    var body: some View {
        SectionCard(title: L10n.tr("settings.section.general")) {
            SettingsToggleRows(
                descriptors: model.generalSectionPresentation.toggles,
                onChange: model.updateToggle
            )
        }
    }
}

private struct SettingsSwitchBehaviorSection: View {
    @ObservedObject var model: SettingsPageModel

    var body: some View {
        SectionCard(title: L10n.tr("settings.section.switch_behavior")) {
            SettingsToggleRows(
                descriptors: model.switchBehaviorSectionPresentation.toggles,
                onChange: model.updateToggle
            )

            SettingsPickerRow(
                descriptor: model.switchBehaviorSectionPresentation.restartEditorTargetPicker,
                onSelect: model.updateRestartEditorTarget
            )
        }
    }
}

private struct SettingsQuitFooter: View {
    let onQuit: () -> Void

    private static let repoURL = URL(string: "https://github.com/meitianwang/CodexManager")!

    var body: some View {
        HStack(spacing: LayoutRules.listRowSpacing) {
            Link(destination: Self.repoURL) {
                HStack(spacing: 6) {
                    Image(systemName: "star")
                    Text(L10n.tr("settings.star_on_github"))
                }
            }
            .buttonStyle(.frostedCapsule(prominent: false))

            Spacer(minLength: 0)

            Button(role: .destructive) {
                onQuit()
            } label: {
                Text(LocalizedStringKey("common.quit"))
            }
            .buttonStyle(.frostedCapsule(prominent: true, tint: AppTheme.destructive))
        }
        .padding(.top, 6)
        .padding(.bottom, 10)
    }
}
#endif

private struct IOSSettingsPageContent: View {
    @ObservedObject var model: SettingsPageModel

    var body: some View {
        Form {
            SettingsLanguageSection(model: model)
        }
        .formStyle(.grouped)
        .scrollIndicators(.hidden)
        .task {
            await model.loadIfNeeded()
        }
    }
}

private struct SettingsLanguageSection: View {
    @ObservedObject var model: SettingsPageModel

    var body: some View {
        #if os(macOS)
        SectionCard(title: L10n.tr("settings.section.language")) {
            SettingsPickerRow(
                descriptor: model.languageSectionPresentation.picker,
                onSelect: model.updateLocale
            )
        }
        #else
        Section("settings.section.language") {
            SettingsPickerRow(
                descriptor: model.languageSectionPresentation.picker,
                onSelect: model.updateLocale
            )
        }
        #endif
    }
}
