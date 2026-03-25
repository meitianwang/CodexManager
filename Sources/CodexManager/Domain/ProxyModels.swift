import Foundation

struct ProxyConfiguration: Codable, Equatable {
    var preferredPortText: String

    init(preferredPortText: String = "8787") {
        self.preferredPortText = Self.normalizePreferredPortText(preferredPortText)
    }

    static var defaultValue: ProxyConfiguration {
        ProxyConfiguration()
    }

    var preferredPort: Int? {
        Int(preferredPortText.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    func normalized() -> ProxyConfiguration {
        ProxyConfiguration(preferredPortText: preferredPortText)
    }

    static func normalizePreferredPortText(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "8787" : trimmed
    }
}

struct ApiProxyStatus: Codable, Equatable {
    var running: Bool
    var port: Int?
    var apiKey: String?
    var baseURL: String?
    var availableAccounts: Int
    var activeAccountID: String?
    var activeAccountLabel: String?
    var lastError: String?

    static let idle = ApiProxyStatus(
        running: false,
        port: nil,
        apiKey: nil,
        baseURL: nil,
        availableAccounts: 0,
        activeAccountID: nil,
        activeAccountLabel: nil,
        lastError: nil
    )
}
