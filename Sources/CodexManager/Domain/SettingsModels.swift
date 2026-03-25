import Foundation

struct AppSettings: Codable, Equatable {
    var launchAtStartup: Bool
    var launchCodexAfterSwitch: Bool
    var autoSmartSwitch: Bool
    var restartEditorsOnSwitch: Bool
    var restartEditorTargets: [EditorAppID]
    var autoStartApiProxy: Bool
    var proxyConfiguration: ProxyConfiguration
    var locale: String

    enum CodingKeys: String, CodingKey {
        case launchAtStartup
        case launchCodexAfterSwitch
        case autoSmartSwitch
        case restartEditorsOnSwitch
        case restartEditorTargets
        case autoStartApiProxy
        case proxyConfiguration
        case locale
    }

    init(
        launchAtStartup: Bool,
        launchCodexAfterSwitch: Bool,
        autoSmartSwitch: Bool,
        restartEditorsOnSwitch: Bool,
        restartEditorTargets: [EditorAppID],
        autoStartApiProxy: Bool,
        proxyConfiguration: ProxyConfiguration = .defaultValue,
        locale: String
    ) {
        self.launchAtStartup = launchAtStartup
        self.launchCodexAfterSwitch = launchCodexAfterSwitch
        self.autoSmartSwitch = autoSmartSwitch
        self.restartEditorsOnSwitch = restartEditorsOnSwitch
        self.restartEditorTargets = restartEditorTargets
        self.autoStartApiProxy = autoStartApiProxy
        self.proxyConfiguration = proxyConfiguration.normalized()
        self.locale = AppLocale.resolve(locale).identifier
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let defaults = AppSettings.defaultValue
        launchAtStartup = try container.decodeIfPresent(Bool.self, forKey: .launchAtStartup) ?? defaults.launchAtStartup
        launchCodexAfterSwitch = try container.decodeIfPresent(Bool.self, forKey: .launchCodexAfterSwitch) ?? defaults.launchCodexAfterSwitch
        autoSmartSwitch = try container.decodeIfPresent(Bool.self, forKey: .autoSmartSwitch) ?? defaults.autoSmartSwitch
        restartEditorsOnSwitch = try container.decodeIfPresent(Bool.self, forKey: .restartEditorsOnSwitch) ?? defaults.restartEditorsOnSwitch
        restartEditorTargets = try container.decodeIfPresent([EditorAppID].self, forKey: .restartEditorTargets) ?? defaults.restartEditorTargets
        autoStartApiProxy = try container.decodeIfPresent(Bool.self, forKey: .autoStartApiProxy) ?? defaults.autoStartApiProxy
        proxyConfiguration = try container.decodeIfPresent(ProxyConfiguration.self, forKey: .proxyConfiguration) ?? defaults.proxyConfiguration
        locale = AppLocale.resolve(try container.decodeIfPresent(String.self, forKey: .locale) ?? defaults.locale).identifier
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(launchAtStartup, forKey: .launchAtStartup)
        try container.encode(launchCodexAfterSwitch, forKey: .launchCodexAfterSwitch)
        try container.encode(autoSmartSwitch, forKey: .autoSmartSwitch)
        try container.encode(restartEditorsOnSwitch, forKey: .restartEditorsOnSwitch)
        try container.encode(restartEditorTargets, forKey: .restartEditorTargets)
        try container.encode(autoStartApiProxy, forKey: .autoStartApiProxy)
        try container.encode(proxyConfiguration, forKey: .proxyConfiguration)
        try container.encode(locale, forKey: .locale)
    }

    static var defaultValue: AppSettings {
        AppSettings(
            launchAtStartup: false,
            launchCodexAfterSwitch: true,
            autoSmartSwitch: false,
            restartEditorsOnSwitch: false,
            restartEditorTargets: [],
            autoStartApiProxy: false,
            proxyConfiguration: .defaultValue,
            locale: AppLocale.systemDefault.identifier
        )
    }
}

struct AppSettingsPatch {
    var launchAtStartup: Bool? = nil
    var launchCodexAfterSwitch: Bool? = nil
    var autoSmartSwitch: Bool? = nil
    var restartEditorsOnSwitch: Bool? = nil
    var restartEditorTargets: [EditorAppID]? = nil
    var autoStartApiProxy: Bool? = nil
    var proxyConfiguration: ProxyConfiguration? = nil
    var locale: String? = nil
}
