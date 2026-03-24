import Foundation

extension SwiftNativeProxyRuntimeService {
    static var clientVisibleModels: [String] {
        [
            "gpt-5",
            "gpt-5.4",
            "gpt-5-mini",
            "gpt-5.2",
            "gpt-5.3-codex"
        ]
    }

    static func resolveUpstreamRouteFamily(forUpstreamModel model: String) -> UpstreamRouteFamily {
        let normalized = model.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if normalized.contains("codex")
            || normalized.hasPrefix("gpt-5")
            || normalized.hasPrefix("gpt-5.4")
            || normalized.hasPrefix("gpt5.4")
            || normalized.hasPrefix("gpt-5-4") {
            return .codex
        }
        return .general
    }

    static func resolveUpstreamBaseURL(configuredBaseURL: String, routeFamily: UpstreamRouteFamily) -> String {
        let normalized = normalizeConfiguredBaseURL(configuredBaseURL)
        let backendSuffix = "/backend-api"
        let codexSuffix = "/backend-api/codex"

        switch routeFamily {
        case .codex:
            if normalized.hasSuffix(codexSuffix) {
                return normalized
            }
            if normalized.hasSuffix(backendSuffix) {
                return "\(normalized)/codex"
            }
            return "\(normalized)\(codexSuffix)"
        case .general:
            if normalized.hasSuffix(codexSuffix) {
                return String(normalized.dropLast("/codex".count))
            }
            if normalized.hasSuffix(backendSuffix) {
                return normalized
            }
            return "\(normalized)\(backendSuffix)"
        }
    }

    func mapClientModelToUpstream(_ model: String) throws -> String {
        let normalized = normalizedClientModelToken(model)
        if normalized == "gpt-5-4" || normalized == "gpt-5.4" || normalized == "gpt5.4" {
            return "gpt-5.4"
        }
        return normalizedNumericModelRevisionIfNeeded(normalized)
    }

    func normalizeModelForClient(_ model: String) -> String {
        let normalized = model.lowercased()
        if normalized == "gpt5.4" || normalized == "gpt-5.4" {
            return "gpt-5-4"
        }
        return model
    }

    func responsesEndpoint(forUpstreamModel model: String) -> URL {
        let routeFamily = Self.resolveUpstreamRouteFamily(forUpstreamModel: model)
        let base = resolveUpstreamBaseURL(routeFamily: routeFamily)
        return URL(string: "\(base)/responses")!
    }

    private func resolveUpstreamBaseURL(routeFamily: UpstreamRouteFamily) -> String {
        let defaultOrigin = "https://chatgpt.com"
        let configured = readChatGPTBaseURLFromConfig() ?? defaultOrigin
        return Self.resolveUpstreamBaseURL(configuredBaseURL: configured, routeFamily: routeFamily)
    }
}
