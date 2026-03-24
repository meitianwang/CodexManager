import Foundation

extension SwiftNativeProxyRuntimeService {
    static func normalizedReasoningSummaryForUpstream(_ summary: String?) -> String {
        let raw = summary?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let lowered = raw.lowercased()
        if lowered.isEmpty || lowered == "none" {
            return "auto"
        }
        return raw
    }

    static func normalizedReasoningForUpstream(_ reasoning: [String: Any], upstreamModel: String? = nil) -> [String: Any] {
        var result = reasoning
        let effort = normalizedReasoningEffortForUpstream(result["effort"] as? String, upstreamModel: upstreamModel)
        result["effort"] = effort
        let summary = result["summary"] as? String
        result["summary"] = normalizedReasoningSummaryForUpstream(summary)
        return result
    }

    static func normalizedReasoningEffortForUpstream(_ effort: String?, upstreamModel: String? = nil) -> String {
        let raw = effort?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        let routeFamily = upstreamModel.map(resolveUpstreamRouteFamily(forUpstreamModel:)) ?? .general
        let defaultEffort = defaultReasoningEffortForUpstream(upstreamModel)

        if raw.isEmpty {
            return defaultEffort
        }

        if routeFamily == .codex {
            switch raw {
            case "low", "medium", "high", "xhigh":
                return raw
            case "none", "minimal":
                return defaultEffort
            default:
                return defaultEffort
            }
        }

        switch raw {
        case "none", "minimal", "low", "medium", "high", "xhigh":
            return raw
        default:
            return defaultEffort
        }
    }

    static func defaultReasoningEffortForUpstream(_ upstreamModel: String?) -> String {
        let routeFamily = upstreamModel.map(resolveUpstreamRouteFamily(forUpstreamModel:)) ?? .general
        return routeFamily == .codex ? "medium" : "none"
    }
}

