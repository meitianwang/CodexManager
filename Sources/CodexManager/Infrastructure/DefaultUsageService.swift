import Foundation

final class DefaultUsageService: UsageService, @unchecked Sendable {
    private enum RequestPolicy {
        static let timeout: TimeInterval = 18
        static let scope = "usage"
    }

    private let session: URLSession
    private let configPath: URL
    private let dateProvider: DateProviding
    private let endpointCoordinator: EndpointRequestCoordinator

    init(
        session: URLSession = .shared,
        configPath: URL,
        dateProvider: DateProviding = SystemDateProvider(),
        endpointPreferenceStore: EndpointPreferenceStore = .shared
    ) {
        self.session = session
        self.configPath = configPath
        self.dateProvider = dateProvider
        self.endpointCoordinator = EndpointRequestCoordinator(
            session: session,
            preferenceStore: endpointPreferenceStore
        )
    }

    func fetchUsage(accessToken: String, accountID: String) async throws -> UsageSnapshot {
        do {
            let result = try await endpointCoordinator.fetchFirstSuccessful(
                scope: RequestPolicy.scope,
                candidateURLs: resolveUsageURLs()
            ) { endpoint in
                var request = URLRequest(url: endpoint)
                request.timeoutInterval = RequestPolicy.timeout
                request.httpMethod = "GET"
                request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
                request.setValue(accountID, forHTTPHeaderField: "ChatGPT-Account-Id")
                request.setValue("application/json", forHTTPHeaderField: "Accept")
                request.setValue("codex-tools-swift/0.1", forHTTPHeaderField: "User-Agent")
                return request
            }
            let payload = try JSONDecoder().decode(UsageAPIResponse.self, from: result.data)
            return mapPayload(payload)
        } catch EndpointRequestError.allRequestsFailed(let errors) {
            let preview = errors.prefix(2).joined(separator: " | ")
            let message: String
            if errors.count > 2 {
                message = L10n.tr("error.usage.request_failed_with_more_format", preview, String(errors.count - 2))
            } else {
                message = L10n.tr("error.usage.request_failed_format", preview)
            }
            if Self.containsUnauthorizedResponse(errors) {
                throw AppError.unauthorized(message)
            }
            throw AppError.network(message)
        }
    }

    private static func containsUnauthorizedResponse(_ failures: [String]) -> Bool {
        failures.contains { failure in
            failure.contains("-> 401:")
        }
    }

    private func resolveUsageURLs() -> [String] {
        let baseOrigin = ChatGPTBaseOriginResolver.resolve(configPath: configPath)
        let backendPrefix = "/backend-api"
        let whamPath = "/wham/usage"
        let codexPath = "/api/codex/usage"

        var candidates: [String] = []
        if let originWithoutBackend = baseOrigin.removingSuffix(backendPrefix) {
            candidates.append("\(baseOrigin)\(whamPath)")
            candidates.append("\(originWithoutBackend)\(backendPrefix)\(whamPath)")
            candidates.append("\(originWithoutBackend)\(codexPath)")
        } else {
            candidates.append("\(baseOrigin)\(backendPrefix)\(whamPath)")
            candidates.append("\(baseOrigin)\(whamPath)")
            candidates.append("\(baseOrigin)\(codexPath)")
        }

        candidates.append("https://chatgpt.com/backend-api/wham/usage")
        candidates.append("https://chatgpt.com/api/codex/usage")

        var deduped: [String] = []
        for candidate in candidates where !deduped.contains(candidate) {
            deduped.append(candidate)
        }
        return deduped
    }

    private func mapPayload(_ payload: UsageAPIResponse) -> UsageSnapshot {
        var windows: [UsageWindowRaw] = []

        if let rateLimit = payload.rateLimit {
            if let primary = rateLimit.primaryWindow { windows.append(primary) }
            if let secondary = rateLimit.secondaryWindow { windows.append(secondary) }
        }

        if let additional = payload.additionalRateLimits {
            for item in additional {
                if let primary = item.rateLimit?.primaryWindow { windows.append(primary) }
                if let secondary = item.rateLimit?.secondaryWindow { windows.append(secondary) }
            }
        }

        let fiveHourRaw = UsageWindowSelector.pickNearestWindow(windows, targetSeconds: 5 * 60 * 60)
        let oneWeekRaw = UsageWindowSelector.pickNearestWindow(windows, targetSeconds: 7 * 24 * 60 * 60)

        return UsageSnapshot(
            fetchedAt: dateProvider.unixSecondsNow(),
            planType: payload.planType,
            fiveHour: fiveHourRaw.map(Self.toUsageWindow),
            oneWeek: oneWeekRaw.map(Self.toUsageWindow),
            credits: payload.credits.map {
                CreditSnapshot(hasCredits: $0.hasCredits, unlimited: $0.unlimited, balance: $0.balance)
            }
        )
    }

    private static func toUsageWindow(_ raw: UsageWindowRaw) -> UsageWindow {
        UsageWindow(
            usedPercent: raw.usedPercent,
            windowSeconds: raw.limitWindowSeconds,
            resetAt: raw.resetAt
        )
    }
}

final class DefaultWeeklyQuotaWarmupService: WeeklyQuotaWarmupService, @unchecked Sendable {
    private enum RequestPolicy {
        static let scope = "weekly-quota-warmup"
        static let model = "gpt-5.4-mini"
    }

    private let configPath: URL
    private let upstreamClient: CodexUpstreamClientProtocol
    private let endpointPreferenceStore: EndpointPreferenceStore

    init(
        configPath: URL,
        upstreamClient: CodexUpstreamClientProtocol = CodexUpstreamClient(),
        endpointPreferenceStore: EndpointPreferenceStore = .shared
    ) {
        self.configPath = configPath
        self.upstreamClient = upstreamClient
        self.endpointPreferenceStore = endpointPreferenceStore
    }

    func warmUp(accessToken: String, accountID: String) async throws {
        let bodyData = try Self.makeWarmupBodyData()
        let candidates = resolveWarmupURLs()
        let orderedCandidates = await endpointPreferenceStore.prioritizedCandidates(
            scope: RequestPolicy.scope,
            candidates: candidates
        )

        var failures: [String] = []
        for endpointString in orderedCandidates {
            guard let endpoint = URL(string: endpointString) else {
                failures.append("\(endpointString) -> invalid URL")
                continue
            }

            do {
                let result = try await upstreamClient.execute(
                    request: CodexUpstreamRequest(
                        method: "POST",
                        url: endpoint,
                        body: bodyData,
                        headers: [:],
                        accessToken: accessToken,
                        accountID: accountID,
                        isStream: true
                    )
                )
                try await Self.drainWarmupResponse(result)
                await endpointPreferenceStore.recordSuccess(
                    scope: RequestPolicy.scope,
                    endpoint: endpointString
                )
                return
            } catch {
                failures.append("\(endpointString) -> \(Self.failureDescription(error))")
            }
        }

        throw AppError.network(
            L10n.tr("error.weekly_quota_warmup.request_failed_format", failures.joined(separator: " | "))
        )
    }

    private func resolveWarmupURLs() -> [String] {
        let baseOrigin = ChatGPTBaseOriginResolver.resolve(configPath: configPath)
        let backendPrefix = "/backend-api"
        let codexResponsesPath = "/codex/responses"
        let backendCodexResponsesPath = "/backend-api/codex/responses"

        var candidates: [String] = []
        if let originWithoutBackend = baseOrigin.removingSuffix(backendPrefix) {
            candidates.append("\(baseOrigin)\(codexResponsesPath)")
            candidates.append("\(originWithoutBackend)\(backendCodexResponsesPath)")
        } else {
            candidates.append("\(baseOrigin)\(backendCodexResponsesPath)")
        }

        candidates.append("https://chatgpt.com/backend-api/codex/responses")

        var deduped: [String] = []
        for candidate in candidates where !deduped.contains(candidate) {
            deduped.append(candidate)
        }
        return deduped
    }

    private static func makeWarmupBodyData() throws -> Data {
        let body: [String: Any] = [
            "model": RequestPolicy.model,
            "stream": true,
            "store": false,
            "instructions": "Reply with OK.",
            "tools": [] as [Any],
            "tool_choice": "none",
            "parallel_tool_calls": false,
            "include": [] as [Any],
            "reasoning": [
                "effort": "low"
            ],
            "input": [[
                "type": "message",
                "role": "user",
                "content": [[
                    "type": "input_text",
                    "text": "ping"
                ]]
            ]]
        ]
        return try JSONSerialization.data(withJSONObject: body, options: [])
    }

    private static func failureDescription(_ error: Error) -> String {
        guard let upstreamError = error as? CodexUpstreamError else {
            return error.localizedDescription
        }

        let body: Data
        switch upstreamError {
        case .httpError(_, let data), .eventError(_, _, let data):
            body = data
        case .networkError, .invalidResponse:
            return upstreamError.localizedDescription
        }

        let bodyText = String(data: body.prefix(512), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let bodyText, !bodyText.isEmpty else {
            return upstreamError.localizedDescription
        }
        return "\(upstreamError.localizedDescription): \(bodyText)"
    }

    private static func drainWarmupResponse(_ result: CodexUpstreamResult) async throws {
        switch result {
        case .stream(_, let lines, _):
            for await line in lines {
                try inspectWarmupLine(line)
                if let event = CodexUpstreamSSEInspector.event(fromSSELine: line),
                   event.type == "response.completed" {
                    return
                }
            }
        case .complete(_, let data, _):
            for line in data.split(separator: UInt8(ascii: "\n")) {
                try inspectWarmupLine(Data(line))
            }
        }
    }

    private static func inspectWarmupLine(_ line: Data) throws {
        guard let error = CodexUpstreamSSEInspector.error(fromSSELine: line) else {
            return
        }
        throw AppError.network("SSE \(error.statusCode): \(error.message)")
    }
}

private struct UsageAPIResponse: Decodable {
    var planType: String?
    var rateLimit: RateLimitDetails?
    var additionalRateLimits: [AdditionalRateLimitDetails]?
    var credits: CreditDetails?

    enum CodingKeys: String, CodingKey {
        case planType = "plan_type"
        case rateLimit = "rate_limit"
        case additionalRateLimits = "additional_rate_limits"
        case credits
    }
}

private struct RateLimitDetails: Decodable {
    var primaryWindow: UsageWindowRaw?
    var secondaryWindow: UsageWindowRaw?

    enum CodingKeys: String, CodingKey {
        case primaryWindow = "primary_window"
        case secondaryWindow = "secondary_window"
    }
}

private struct AdditionalRateLimitDetails: Decodable {
    var rateLimit: RateLimitDetails?

    enum CodingKeys: String, CodingKey {
        case rateLimit = "rate_limit"
    }
}

struct UsageWindowRaw: Equatable {
    var usedPercent: Double
    var limitWindowSeconds: Int64
    var resetAt: Int64
}

extension UsageWindowRaw: Decodable {
    enum CodingKeys: String, CodingKey {
        case usedPercent = "used_percent"
        case limitWindowSeconds = "limit_window_seconds"
        case resetAt = "reset_at"
    }
}

private struct CreditDetails: Decodable {
    var hasCredits: Bool
    var unlimited: Bool
    var balance: String?

    enum CodingKeys: String, CodingKey {
        case hasCredits = "has_credits"
        case unlimited
        case balance
    }
}

private extension String {
    func removingSuffix(_ suffix: String) -> String? {
        guard hasSuffix(suffix) else { return nil }
        return String(dropLast(suffix.count))
    }
}
