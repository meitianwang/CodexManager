import Foundation

struct AppSettings: Codable, Equatable {
    var launchAtStartup: Bool
    var launchCodexAfterSwitch: Bool
    var autoSmartSwitch: Bool
    var restartEditorsOnSwitch: Bool
    var restartEditorTargets: [EditorAppID]
    var locale: String
    var proxyPort: UInt16
    var proxyApiKey: String
    var autoStartProxy: Bool

    enum CodingKeys: String, CodingKey {
        case launchAtStartup
        case launchCodexAfterSwitch
        case autoSmartSwitch
        case restartEditorsOnSwitch
        case restartEditorTargets
        case locale
        case proxyPort
        case proxyApiKey
        case autoStartProxy
    }

    init(
        launchAtStartup: Bool,
        launchCodexAfterSwitch: Bool,
        autoSmartSwitch: Bool,
        restartEditorsOnSwitch: Bool,
        restartEditorTargets: [EditorAppID],
        locale: String,
        proxyPort: UInt16 = 18317,
        proxyApiKey: String = "",
        autoStartProxy: Bool = false
    ) {
        self.launchAtStartup = launchAtStartup
        self.launchCodexAfterSwitch = launchCodexAfterSwitch
        self.autoSmartSwitch = autoSmartSwitch
        self.restartEditorsOnSwitch = restartEditorsOnSwitch
        self.restartEditorTargets = restartEditorTargets
        self.locale = AppLocale.resolve(locale).identifier
        self.proxyPort = proxyPort
        self.proxyApiKey = proxyApiKey
        self.autoStartProxy = autoStartProxy
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let defaults = AppSettings.defaultValue
        launchAtStartup = try container.decodeIfPresent(Bool.self, forKey: .launchAtStartup) ?? defaults.launchAtStartup
        launchCodexAfterSwitch = try container.decodeIfPresent(Bool.self, forKey: .launchCodexAfterSwitch) ?? defaults.launchCodexAfterSwitch
        autoSmartSwitch = try container.decodeIfPresent(Bool.self, forKey: .autoSmartSwitch) ?? defaults.autoSmartSwitch
        restartEditorsOnSwitch = try container.decodeIfPresent(Bool.self, forKey: .restartEditorsOnSwitch) ?? defaults.restartEditorsOnSwitch
        restartEditorTargets = try container.decodeIfPresent([EditorAppID].self, forKey: .restartEditorTargets) ?? defaults.restartEditorTargets
        locale = AppLocale.resolve(try container.decodeIfPresent(String.self, forKey: .locale) ?? defaults.locale).identifier
        proxyPort = try container.decodeIfPresent(UInt16.self, forKey: .proxyPort) ?? defaults.proxyPort
        proxyApiKey = try container.decodeIfPresent(String.self, forKey: .proxyApiKey) ?? defaults.proxyApiKey
        autoStartProxy = try container.decodeIfPresent(Bool.self, forKey: .autoStartProxy) ?? defaults.autoStartProxy
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(launchAtStartup, forKey: .launchAtStartup)
        try container.encode(launchCodexAfterSwitch, forKey: .launchCodexAfterSwitch)
        try container.encode(autoSmartSwitch, forKey: .autoSmartSwitch)
        try container.encode(restartEditorsOnSwitch, forKey: .restartEditorsOnSwitch)
        try container.encode(restartEditorTargets, forKey: .restartEditorTargets)
        try container.encode(locale, forKey: .locale)
        try container.encode(proxyPort, forKey: .proxyPort)
        try container.encode(proxyApiKey, forKey: .proxyApiKey)
        try container.encode(autoStartProxy, forKey: .autoStartProxy)
    }

    static var defaultValue: AppSettings {
        AppSettings(
            launchAtStartup: false,
            launchCodexAfterSwitch: true,
            autoSmartSwitch: false,
            restartEditorsOnSwitch: false,
            restartEditorTargets: [],
            locale: AppLocale.systemDefault.identifier
        )
    }

    static func generateApiKey() -> String {
        let bytes = (0..<24).map { _ in UInt8.random(in: 0...255) }
        return "sk-local-" + bytes.map { String(format: "%02x", $0) }.joined()
    }
}

struct AppSettingsPatch {
    var launchAtStartup: Bool? = nil
    var launchCodexAfterSwitch: Bool? = nil
    var autoSmartSwitch: Bool? = nil
    var restartEditorsOnSwitch: Bool? = nil
    var restartEditorTargets: [EditorAppID]? = nil
    var locale: String? = nil
    var proxyPort: UInt16? = nil
    var proxyApiKey: String? = nil
    var autoStartProxy: Bool? = nil
}
