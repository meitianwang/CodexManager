import Foundation
import os.log

private let proxyLogger = Logger(subsystem: "com.nik.mei.codexmanager", category: "ProxyCoordinator")

actor ProxyCoordinator {
    static let defaultPort: UInt16 = 18317

    private static let remoteModelsURLs = [
        "https://models.router-for.me/models.json",
        "https://raw.githubusercontent.com/router-for-me/models/refs/heads/main/models.json",
    ]

    private enum RetryPolicy {
        static let shortCooldownSeconds: Int64 = 15
        static let accountCooldownSeconds: Int64 = 60
        static let authCooldownSeconds: Int64 = 5 * 60
        static let maxPreflightLines = 128
        static let maxPreflightBytes = 64 * 1024
    }

    private let storeRepository: AccountsStoreRepository
    private let authRepository: AuthRepository
    private let chatGPTOAuthLoginService: ChatGPTOAuthLoginServiceProtocol?
    private let configPath: URL
    private let dateProvider: DateProviding

    private var server: ProxyHTTPServer?
    private var upstreamClient: CodexUpstreamClientProtocol
    private var accountCooldowns: [String: Int64] = [:]
    private var accountModelCooldowns: [String: Int64] = [:]
    /// Random API key generated at each start — clients must send `Authorization: Bearer <key>`.
    private(set) var currentAPIKey: String?
    /// Dynamically fetched model IDs; nil until first fetch completes.
    private(set) var fetchedModels: [String]?
    private var fetchedModelIDsByPlanKey: [String: Set<String>]?

    init(
        storeRepository: AccountsStoreRepository,
        authRepository: AuthRepository,
        chatGPTOAuthLoginService: ChatGPTOAuthLoginServiceProtocol? = nil,
        configPath: URL,
        dateProvider: DateProviding = SystemDateProvider(),
        upstreamClient: CodexUpstreamClientProtocol = CodexUpstreamClient()
    ) {
        self.storeRepository = storeRepository
        self.authRepository = authRepository
        self.chatGPTOAuthLoginService = chatGPTOAuthLoginService
        self.configPath = configPath
        self.dateProvider = dateProvider
        self.upstreamClient = upstreamClient
    }

    // MARK: - Lifecycle

    func start(port: UInt16, apiKey: String) throws {
        guard server == nil else { return }

        self.currentAPIKey = apiKey

        let handler: ProxyHTTPServer.RequestHandler = { [weak self] request in
            guard let self else {
                return .complete(HTTPResponse.json(statusCode: 503, object: Self.errorJSON("Service unavailable")))
            }
            return await self.handleRequest(request)
        }

        let srv = try ProxyHTTPServer(port: port, loopbackOnly: true, handler: handler)
        srv.start()
        server = srv
        proxyLogger.info("Proxy started on 127.0.0.1:\(port, privacy: .public)")
    }

    func stop() {
        server?.stop()
        server = nil
        currentAPIKey = nil
        proxyLogger.info("Proxy stopped")
    }

    var isRunning: Bool {
        server != nil
    }

    // MARK: - Request Routing

    private func handleRequest(_ request: HTTPRequest) async -> ProxyHTTPResponse {
        // CORS preflight
        if request.method == "OPTIONS" {
            return .complete(corsResponse(statusCode: 204))
        }

        // Health check is unauthenticated
        if request.method == "GET" && request.path == "/health" {
            return .complete(corsResponse(HTTPResponse.json(statusCode: 200, object: ["status": "ok"])))
        }

        // Authenticate all other requests (supports both Bearer token and x-api-key)
        if let apiKey = currentAPIKey {
            let authHeader = request.headers["authorization"] ?? ""
            let bearerToken = authHeader.hasPrefix("Bearer ") ? String(authHeader.dropFirst(7)) : ""
            let xApiKey = request.headers["x-api-key"] ?? ""
            if bearerToken != apiKey && xApiKey != apiKey {
                return .complete(corsResponse(HTTPResponse.json(
                    statusCode: 401,
                    object: Self.errorJSON("Invalid or missing API key. Use Authorization: Bearer <key> or x-api-key header.")
                )))
            }
        }

        switch (request.method, request.path) {
        case ("GET", "/health"):
            return .complete(corsResponse(HTTPResponse.json(statusCode: 200, object: ["status": "ok"])))

        case ("GET", "/v1/models"):
            return .complete(corsResponse(handleModels()))

        case ("POST", "/v1/chat/completions"):
            return await handleChatCompletions(request)

        case ("POST", "/v1/responses"):
            return await handleResponses(request)

        case ("POST", "/v1/messages"):
            return await handleMessages(request)

        default:
            return .complete(corsResponse(HTTPResponse.json(
                statusCode: 404,
                object: Self.errorJSON(L10n.tr("error.proxy_runtime.unsupported_route"))
            )))
        }
    }

    // MARK: - /v1/models

    private func handleModels() -> HTTPResponse {
        let ids = fetchedModels ?? proxyAvailableModels
        let models = ids.map { id in
            ["id": id, "object": "model", "owned_by": "openai"] as [String: Any]
        }
        return HTTPResponse.json(statusCode: 200, object: [
            "object": "list",
            "data": models
        ])
    }

    // MARK: - Remote Model Fetching

    /// Fetches available models from remote JSON, filtered by account plan types.
    func refreshModels() async {
        let planKeys = resolvePlanKeys()
        guard !planKeys.isEmpty else {
            proxyLogger.info("No accounts available, skipping model refresh")
            return
        }

        for url in Self.remoteModelsURLs {
            do {
                let catalog = try await Self.fetchModels(from: url, planKeys: planKeys)
                if !catalog.ids.isEmpty {
                    fetchedModels = catalog.ids
                    fetchedModelIDsByPlanKey = catalog.idsByPlanKey
                    proxyLogger.info("Fetched \(catalog.ids.count) models from \(url, privacy: .public)")
                    return
                }
            } catch {
                proxyLogger.warning("Failed to fetch models from \(url, privacy: .public): \(error.localizedDescription, privacy: .public)")
            }
        }
        proxyLogger.info("All remote model URLs failed, using fallback list")
    }

    /// Maps account plan types to codex JSON keys and collects unique model IDs.
    private func resolvePlanKeys() -> Set<String> {
        guard let store = try? storeRepository.loadStore() else { return [] }
        var keys = Set<String>()
        for account in store.accounts {
            let plan = account.effectivePlanType
            switch plan {
            case "free": keys.insert("codex-free")
            case "plus": keys.insert("codex-plus")
            case "pro", "prolite", "pro_lite": keys.insert("codex-pro")
            default: keys.insert("codex-team")
            }
        }
        return keys
    }

    private struct FetchedModelCatalog {
        var ids: [String]
        var idsByPlanKey: [String: Set<String>]
    }

    private static func fetchModels(from urlString: String, planKeys: Set<String>) async throws -> FetchedModelCatalog {
        guard let url = URL(string: urlString) else {
            return FetchedModelCatalog(ids: [], idsByPlanKey: [:])
        }
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        let session = URLSession(configuration: config)
        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            return FetchedModelCatalog(ids: [], idsByPlanKey: [:])
        }
        guard let catalog = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return FetchedModelCatalog(ids: [], idsByPlanKey: [:])
        }

        var seen = Set<String>()
        var result: [String] = []
        var idsByPlanKey: [String: Set<String>] = [:]
        for key in planKeys {
            guard let entries = catalog[key] as? [[String: Any]] else { continue }
            for entry in entries {
                guard let id = entry["id"] as? String else { continue }
                idsByPlanKey[key, default: []].insert(id)
                if seen.insert(id).inserted {
                    result.append(id)
                }
            }
        }
        return FetchedModelCatalog(ids: result, idsByPlanKey: idsByPlanKey)
    }

    // MARK: - /v1/chat/completions

    private func handleChatCompletions(_ request: HTTPRequest) async -> ProxyHTTPResponse {
        guard let json = parseJSONBody(request.body) else {
            return .complete(corsResponse(HTTPResponse.json(
                statusCode: 400,
                object: Self.errorJSON(L10n.tr("error.proxy_runtime.request_body_must_be_object"))
            )))
        }

        guard let model = json["model"] as? String else {
            return .complete(corsResponse(HTTPResponse.json(
                statusCode: 400,
                object: Self.errorJSON(L10n.tr("error.proxy_runtime.missing_model"))
            )))
        }

        guard let messages = json["messages"] as? [[String: Any]] else {
            return .complete(corsResponse(HTTPResponse.json(
                statusCode: 400,
                object: Self.errorJSON(L10n.tr("error.proxy_runtime.chat_missing_messages"))
            )))
        }

        let isStream = json["stream"] as? Bool ?? false
        let codexBody = ChatToCodexTranslator.translateRequest(model: model, messages: messages, originalJSON: json)

        guard let bodyData = try? JSONSerialization.data(withJSONObject: codexBody) else {
            return .complete(corsResponse(HTTPResponse.json(
                statusCode: 400,
                object: Self.errorJSON(L10n.tr("error.proxy_runtime.invalid_upstream_payload"))
            )))
        }

        return await executeWithRetry(bodyData: bodyData, model: model, isStream: isStream) { result in
            switch result {
            case .streaming(let lines):
                if isStream {
                    let translated = ChatToCodexTranslator.translateStreamingResponse(model: model, lines: lines)
                    return .streaming(statusCode: 200, headers: Self.corsHeaders(), body: translated)
                } else {
                    let response = await ChatToCodexTranslator.collectAndTranslateResponse(model: model, lines: lines)
                    return .complete(self.corsResponse(response))
                }
            case .complete(let data):
                let response = ChatToCodexTranslator.translateCompleteResponse(model: model, data: data)
                return .complete(self.corsResponse(response))
            }
        }
    }

    // MARK: - /v1/responses (passthrough)

    private func handleResponses(_ request: HTTPRequest) async -> ProxyHTTPResponse {
        guard let json = parseJSONBody(request.body) else {
            return .complete(corsResponse(HTTPResponse.json(
                statusCode: 400,
                object: Self.errorJSON(L10n.tr("error.proxy_runtime.request_body_must_be_object"))
            )))
        }

        let model = json["model"] as? String ?? "gpt-5"
        let isStream = json["stream"] as? Bool ?? true

        // Ensure required fields for codex backend
        var body = json
        body["stream"] = true // always stream from upstream
        body["store"] = false
        body["parallel_tool_calls"] = true
        body["include"] = ["reasoning.encrypted_content"]
        if body["instructions"] == nil {
            body["instructions"] = ""
        }
        if body["reasoning"] == nil {
            body["reasoning"] = ["effort": "medium", "summary": "auto"]
        }
        // Convert system role to developer
        if var inputArray = body["input"] as? [[String: Any]] {
            for i in inputArray.indices {
                if (inputArray[i]["role"] as? String) == "system" {
                    inputArray[i]["role"] = "developer"
                }
            }
            body["input"] = inputArray
        }
        // Remove fields not accepted by codex backend
        for key in ["previous_response_id", "prompt_cache_retention", "safety_identifier",
                     "max_output_tokens", "max_completion_tokens", "temperature",
                     "top_p", "context_management", "truncation", "user"] {
            body.removeValue(forKey: key)
        }
        // service_tier: only keep if "priority"
        if (body["service_tier"] as? String) != "priority" {
            body.removeValue(forKey: "service_tier")
        }

        guard let bodyData = try? JSONSerialization.data(withJSONObject: body) else {
            return .complete(corsResponse(HTTPResponse.json(
                statusCode: 400,
                object: Self.errorJSON(L10n.tr("error.proxy_runtime.invalid_upstream_payload"))
            )))
        }

        return await executeWithRetry(bodyData: bodyData, model: model, isStream: isStream) { result in
            switch result {
            case .streaming(let lines):
                if isStream {
                    // Passthrough SSE lines
                    return .streaming(statusCode: 200, headers: Self.corsHeaders(), body: lines)
                } else {
                    // Collect and return completed response
                    let response = await Self.collectCompletedResponse(lines: lines)
                    return .complete(self.corsResponse(response))
                }
            case .complete(let data):
                return .complete(self.corsResponse(HTTPResponse(
                    statusCode: 200,
                    headers: ["Content-Type": "application/json; charset=utf-8"],
                    body: data
                )))
            }
        }
    }

    // MARK: - /v1/messages (Anthropic)

    private func handleMessages(_ request: HTTPRequest) async -> ProxyHTTPResponse {
        guard let json = parseJSONBody(request.body) else {
            return .complete(corsResponse(
                AnthropicToCodexTranslator.anthropicErrorResponse(statusCode: 400, message: L10n.tr("error.proxy_runtime.request_body_must_be_object"))
            ))
        }

        guard let (codexBody, model, isStream) = AnthropicToCodexTranslator.translateRequest(json) else {
            return .complete(corsResponse(
                AnthropicToCodexTranslator.anthropicErrorResponse(statusCode: 400, message: L10n.tr("error.proxy_runtime.missing_model"))
            ))
        }

        guard let bodyData = try? JSONSerialization.data(withJSONObject: codexBody) else {
            return .complete(corsResponse(
                AnthropicToCodexTranslator.anthropicErrorResponse(statusCode: 400, message: L10n.tr("error.proxy_runtime.invalid_upstream_payload"))
            ))
        }

        return await executeWithRetry(bodyData: bodyData, model: model, isStream: isStream) { result in
            switch result {
            case .streaming(let lines):
                if isStream {
                    let translated = AnthropicToCodexTranslator.translateStreamingResponse(model: model, lines: lines)
                    return .streaming(statusCode: 200, headers: Self.corsHeaders(), body: translated)
                } else {
                    let response = await AnthropicToCodexTranslator.collectAndTranslateResponse(model: model, lines: lines)
                    return .complete(self.corsResponse(response))
                }
            case .complete(let data):
                // Shouldn't happen since we always stream from upstream, but handle gracefully
                let text = String(data: data, encoding: .utf8) ?? ""
                let fallback = AnthropicToCodexTranslator.anthropicErrorResponse(statusCode: 502, message: "Unexpected non-stream response: \(text.prefix(200))")
                return .complete(self.corsResponse(fallback))
            }
        }
    }

    // MARK: - Account Selection & Retry

    private enum UpstreamSuccessResult {
        case streaming(AsyncStream<Data>)
        case complete(Data)
    }

    private func executeWithRetry(
        bodyData: Data,
        model: String,
        isStream: Bool,
        transform: @escaping (UpstreamSuccessResult) async -> ProxyHTTPResponse
    ) async -> ProxyHTTPResponse {
        let accountSelection = loadAvailableAccounts(model: model)
        guard !accountSelection.accounts.isEmpty else {
            if accountSelection.hasStoredAccounts {
                return .complete(corsResponse(HTTPResponse.json(
                    statusCode: 429,
                    object: Self.errorJSON(accountSelection.unavailableSummary)
                )))
            }
            return .complete(corsResponse(HTTPResponse.json(
                statusCode: 503,
                object: Self.errorJSON(L10n.tr("error.proxy_runtime.no_accounts_available"))
            )))
        }

        let baseURL = ChatGPTBaseOriginResolver.resolve(configPath: configPath)
        let upstreamURL: URL
        let upstreamURLString = baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/backend-api/codex/responses"
        proxyLogger.info("Upstream URL: \(upstreamURLString, privacy: .public)")
        if let bodyStr = String(data: bodyData.prefix(2048), encoding: .utf8) {
            proxyLogger.info("Upstream body: \(bodyStr, privacy: .public)")
        }
        if let url = URL(string: upstreamURLString) {
            upstreamURL = url
        } else {
            return .complete(corsResponse(HTTPResponse.json(
                statusCode: 500,
                object: Self.errorJSON("Invalid upstream URL")
            )))
        }

        var failures: [String] = []

        for account in accountSelection.accounts {
            let request = makeUpstreamRequest(
                url: upstreamURL,
                bodyData: bodyData,
                account: account
            )

            let attemptResult = await executeUpstreamRequest(
                request,
                account: account,
                model: model
            )

            switch attemptResult {
            case .success(let result):
                return await transform(result)
            case .failure(let error):
                let label = account.label
                let bodySnippet = bodySnippet(from: error)
                proxyLogger.warning("Upstream failed for \(label, privacy: .public): \(error.localizedDescription, privacy: .public) body=\(bodySnippet, privacy: .public)")
                failures.append("\(label): \(error.localizedDescription)")

                if !error.isRetryable {
                    return .complete(corsResponse(HTTPResponse.json(
                        statusCode: error.statusCode,
                        object: Self.errorJSON(error.localizedDescription)
                    )))
                }
            }
        }

        let summary = (failures + accountSelection.unavailableReasons).joined(separator: "; ")
        return .complete(corsResponse(HTTPResponse.json(
            statusCode: 502,
            object: Self.errorJSON(L10n.tr("error.proxy_runtime.upstream_failed_format", summary))
        )))
    }

    private func makeUpstreamRequest(
        url: URL,
        bodyData: Data,
        account: ProxyAccount
    ) -> CodexUpstreamRequest {
        CodexUpstreamRequest(
            url: url,
            body: bodyData,
            accessToken: account.accessToken,
            accountID: account.accountID,
            isStream: true // always stream from upstream
        )
    }

    private func executeUpstreamRequest(
        _ request: CodexUpstreamRequest,
        account: ProxyAccount,
        model: String
    ) async -> Result<UpstreamSuccessResult, CodexUpstreamError> {
        do {
            let result = try await upstreamClient.execute(request: request)
            return .success(try await preflight(result))
        } catch let error as CodexUpstreamError {
            if error.isAuthenticationFailure,
               let repairedAccount = await refreshProxyAccountAuth(account) {
                let repairedRequest = makeUpstreamRequest(
                    url: request.url,
                    bodyData: request.body,
                    account: repairedAccount
                )
                do {
                    let result = try await upstreamClient.execute(request: repairedRequest)
                    return .success(try await preflight(result))
                } catch let repairedError as CodexUpstreamError {
                    recordCooldown(for: repairedAccount, model: model, error: repairedError)
                    return .failure(repairedError)
                } catch {
                    let networkError = CodexUpstreamError.networkError(error)
                    recordCooldown(for: repairedAccount, model: model, error: networkError)
                    return .failure(networkError)
                }
            }

            recordCooldown(for: account, model: model, error: error)
            return .failure(error)
        } catch {
            let networkError = CodexUpstreamError.networkError(error)
            recordCooldown(for: account, model: model, error: networkError)
            return .failure(networkError)
        }
    }

    private func preflight(_ result: CodexUpstreamResult) async throws -> UpstreamSuccessResult {
        switch result {
        case .stream(_, let lines, _):
            return .streaming(try await preflightStreamingLines(lines))
        case .complete(_, let data, _):
            if let error = Self.firstSSEError(in: data) {
                throw CodexUpstreamError.eventError(
                    statusCode: error.statusCode,
                    message: error.message,
                    body: error.body
                )
            }
            return .complete(data)
        }
    }

    private func preflightStreamingLines(_ lines: AsyncStream<Data>) async throws -> AsyncStream<Data> {
        let gate = SSEPreflightGate()
        let replayed = AsyncStream<Data> { continuation in
            let task = Task {
                var buffered: [Data] = []
                var bufferedBytes = 0
                var didPassPreflight = false

                for await line in lines {
                    if !didPassPreflight {
                        buffered.append(line)
                        bufferedBytes += line.count

                        if let error = CodexUpstreamSSEInspector.error(fromSSELine: line) {
                            await gate.fail(CodexUpstreamError.eventError(
                                statusCode: error.statusCode,
                                message: error.message,
                                body: error.body
                            ))
                            continuation.finish()
                            return
                        }

                        if CodexUpstreamSSEInspector.isReadyForClient(fromSSELine: line)
                            || buffered.count >= RetryPolicy.maxPreflightLines
                            || bufferedBytes >= RetryPolicy.maxPreflightBytes {
                            didPassPreflight = true
                            await gate.succeed()
                            for bufferedLine in buffered {
                                continuation.yield(bufferedLine)
                            }
                            buffered.removeAll(keepingCapacity: false)
                        }
                        continue
                    }

                    continuation.yield(line)
                }

                if !didPassPreflight {
                    await gate.succeed()
                    for bufferedLine in buffered {
                        continuation.yield(bufferedLine)
                    }
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
        try await gate.wait()
        return replayed
    }

    private static func firstSSEError(in data: Data) -> CodexUpstreamSSEError? {
        for line in data.split(separator: UInt8(ascii: "\n")) {
            if let error = CodexUpstreamSSEInspector.error(fromSSELine: Data(line)) {
                return error
            }
        }
        return nil
    }

    private func recordCooldown(for account: ProxyAccount, model: String, error: CodexUpstreamError) {
        let now = dateProvider.unixSecondsNow()
        if error.isAuthenticationFailure {
            accountCooldowns[account.accountKey] = now + RetryPolicy.authCooldownSeconds
            return
        }
        if error.isRateLimited {
            accountCooldowns[account.accountKey] = quotaRetryCooldown(for: account, now: now)
            return
        }
        if error.isModelRestriction {
            setAccountModelCooldown(
                accountKey: account.accountKey,
                model: model,
                until: now + RetryPolicy.authCooldownSeconds
            )
            return
        }
        if error.isRetryable {
            accountCooldowns[account.accountKey] = now + RetryPolicy.shortCooldownSeconds
        }
    }

    private func bodySnippet(from error: CodexUpstreamError) -> String {
        let body: Data
        switch error {
        case .httpError(_, let errorBody), .eventError(_, _, let errorBody):
            body = errorBody
        case .networkError, .invalidResponse:
            return ""
        }
        return String(data: body.prefix(1024), encoding: .utf8) ?? "(non-utf8)"
    }

    // MARK: - Account Loading

    private struct AccountSelection {
        var accounts: [ProxyAccount]
        var hasStoredAccounts: Bool
        var unavailableReasons: [String]

        var unavailableSummary: String {
            let summary = unavailableReasons.isEmpty
                ? L10n.tr("error.proxy_runtime.no_accounts_available")
                : unavailableReasons.joined(separator: "; ")
            return L10n.tr("error.proxy_runtime.all_accounts_unavailable_with_summary_format", summary)
        }
    }

    private struct ProxyAccount {
        var id: String
        var label: String
        var accessToken: String
        var refreshToken: String?
        var accountID: String
        var accountKey: String
        var authJSON: JSONValue
        var effectivePlanType: String
        var usage: UsageSnapshot?
        var addedAt: Int64
    }

    private func loadAvailableAccounts(model: String) -> AccountSelection {
        guard let store = try? storeRepository.loadStore() else {
            return AccountSelection(accounts: [], hasStoredAccounts: false, unavailableReasons: [])
        }

        let now = dateProvider.unixSecondsNow()
        expireCooldowns(now: now)

        var unavailableReasons: [String] = []
        let accounts = store.accounts.compactMap { account -> ProxyAccount? in
            let accountKey = account.accountKey
            if let resetAt = exhaustedQuotaResetTime(for: account.usage, now: now) {
                accountCooldowns[accountKey] = resetAt
                unavailableReasons.append("\(account.label): quota resets \(formatResetTime(resetAt))")
                return nil
            }
            if let cooldownUntil = accountCooldowns[accountKey], cooldownUntil > now {
                unavailableReasons.append("\(account.label): cooling down until \(formatResetTime(cooldownUntil))")
                return nil
            }
            if let modelCooldownUntil = accountModelCooldown(accountKey: accountKey, model: model),
               modelCooldownUntil > now {
                unavailableReasons.append("\(account.label): model \(model) cooling down until \(formatResetTime(modelCooldownUntil))")
                return nil
            }
            guard modelIsSupported(model, by: account) else {
                unavailableReasons.append("\(account.label): model \(model) unavailable for \(account.effectivePlanType)")
                return nil
            }
            guard let extracted = try? authRepository.extractAuth(from: account.authJSON) else {
                unavailableReasons.append("\(account.label): auth unavailable")
                return nil
            }
            return makeProxyAccount(account, extracted: extracted)
        }
        return AccountSelection(
            accounts: sortProxyAccountsByAvailability(accounts),
            hasStoredAccounts: !store.accounts.isEmpty,
            unavailableReasons: unavailableReasons
        )
    }

    private func sortProxyAccountsByAvailability(_ accounts: [ProxyAccount]) -> [ProxyAccount] {
        accounts.sorted { left, right in
            let leftScore = remainingScore(for: left.usage)
            let rightScore = remainingScore(for: right.usage)
            if leftScore != rightScore {
                return leftScore > rightScore
            }
            return left.addedAt < right.addedAt
        }
    }

    private func remainingScore(for usage: UsageSnapshot?) -> Double {
        let oneWeekUsed = usage?.oneWeek?.usedPercent ?? 100
        let fiveHourUsed = usage?.fiveHour?.usedPercent ?? 100
        return max(0, 100 - oneWeekUsed) * 0.7 + max(0, 100 - fiveHourUsed) * 0.3
    }

    private func modelIsSupported(_ model: String, by account: StoredAccount) -> Bool {
        guard let fetchedModelIDsByPlanKey, !fetchedModelIDsByPlanKey.isEmpty else {
            return true
        }
        let planKey = Self.planKey(for: account.effectivePlanType)
        return fetchedModelIDsByPlanKey[planKey]?.contains(model) == true
    }

    private static func planKey(for plan: String) -> String {
        switch plan {
        case "free": return "codex-free"
        case "plus": return "codex-plus"
        case "pro", "prolite", "pro_lite": return "codex-pro"
        default: return "codex-team"
        }
    }

    private func exhaustedQuotaResetTime(for usage: UsageSnapshot?, now: Int64) -> Int64? {
        guard let usage else { return nil }
        let exhaustedWindows = [usage.fiveHour, usage.oneWeek].compactMap { $0 }.filter {
            $0.usedPercent >= 100
        }
        guard !exhaustedWindows.isEmpty else { return nil }

        let futureResetTimes = exhaustedWindows.compactMap(\.resetAt).filter { $0 > now }
        if let resetAt = futureResetTimes.max() {
            return resetAt
        }

        let hasUnknownFuture = exhaustedWindows.contains { $0.resetAt == nil }
        return hasUnknownFuture ? now + RetryPolicy.shortCooldownSeconds : nil
    }

    private func quotaRetryCooldown(for account: ProxyAccount, now: Int64) -> Int64 {
        exhaustedQuotaResetTime(for: account.usage, now: now) ?? now + RetryPolicy.accountCooldownSeconds
    }

    private func expireCooldowns(now: Int64) {
        accountCooldowns = accountCooldowns.filter { $0.value > now }
        accountModelCooldowns = accountModelCooldowns.filter { $0.value > now }
    }

    private func accountModelCooldown(accountKey: String, model: String) -> Int64? {
        accountModelCooldowns["\(accountKey)|\(model)"]
    }

    private func setAccountModelCooldown(accountKey: String, model: String, until: Int64) {
        accountModelCooldowns["\(accountKey)|\(model)"] = until
    }

    private func formatResetTime(_ timestamp: Int64) -> String {
        ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: TimeInterval(timestamp)))
    }

    private func refreshProxyAccountAuth(_ account: ProxyAccount) async -> ProxyAccount? {
        guard let chatGPTOAuthLoginService,
              let refreshToken = account.refreshToken else {
            return nil
        }

        do {
            let tokens = try await chatGPTOAuthLoginService.refreshChatGPTTokens(refreshToken: refreshToken)
            let authJSON = try authRepository.replacingChatGPTTokens(in: account.authJSON, with: tokens)
            let extracted = try authRepository.extractAuth(from: authJSON)
            guard AccountIdentity.normalizedAccountID(extracted.accountID) == AccountIdentity.normalizedAccountID(account.accountID) else {
                return nil
            }

            var store = try storeRepository.loadStore()
            guard let index = store.accounts.firstIndex(where: { $0.id == account.id }) else {
                return nil
            }

            var stored = store.accounts[index]
            stored.authJSON = authJSON
            stored.accountID = extracted.accountID
            stored.email = extracted.email ?? stored.email
            stored.principalID = extracted.principalID
            stored.planType = AccountPlanResolver.preferredPlanType(
                planType: extracted.planType,
                usagePlanType: stored.usage?.planType,
                fallback: stored.planType
            )
            if let teamName = extracted.teamName?.trimmingCharacters(in: .whitespacesAndNewlines),
               !teamName.isEmpty {
                stored.teamName = teamName
            }
            stored.updatedAt = dateProvider.unixSecondsNow()
            store.accounts[index] = stored
            try storeRepository.saveStore(store)

            if authRepository.currentAuthAccountKey() == account.accountKey {
                do {
                    try authRepository.writeCurrentAuth(authJSON)
                } catch {
                    proxyLogger.warning("Failed to update current auth after proxy token refresh: \(error.localizedDescription, privacy: .public)")
                }
            }

            return makeProxyAccount(stored, extracted: extracted)
        } catch {
            proxyLogger.warning("Failed to refresh proxy auth for \(account.label, privacy: .public): \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }

    private func makeProxyAccount(_ account: StoredAccount, extracted: ExtractedAuth) -> ProxyAccount {
        ProxyAccount(
            id: account.id,
            label: account.label,
            accessToken: extracted.accessToken,
            refreshToken: AuthTokenPlanInspector.refreshToken(in: account.authJSON),
            accountID: extracted.accountID,
            accountKey: account.accountKey,
            authJSON: account.authJSON,
            effectivePlanType: account.effectivePlanType,
            usage: account.usage,
            addedAt: account.addedAt
        )
    }

    // MARK: - Helpers

    private func parseJSONBody(_ data: Data) -> [String: Any]? {
        guard !data.isEmpty,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return json
    }

    private static func collectCompletedResponse(lines: AsyncStream<Data>) async -> HTTPResponse {
        let dataPrefix = Data("data: ".utf8)
        var completedPayload: Data?

        for await line in lines {
            if let error = CodexUpstreamSSEInspector.error(fromSSELine: line) {
                return HTTPResponse.json(
                    statusCode: error.statusCode,
                    object: errorJSON(error.message)
                )
            }
            guard line.starts(with: dataPrefix) else { continue }
            let payload = line.dropFirst(dataPrefix.count)
            if let text = String(data: Data(payload), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
               text.contains("\"response.completed\"") {
                // Extract the response object from the completed event
                if let json = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
                   let response = json["response"] {
                    completedPayload = try? JSONSerialization.data(withJSONObject: response)
                }
            }
        }

        if let data = completedPayload {
            return HTTPResponse(
                statusCode: 200,
                headers: ["Content-Type": "application/json; charset=utf-8"],
                body: data
            )
        }

        return HTTPResponse.json(
            statusCode: 502,
            object: errorJSON(L10n.tr("error.proxy_runtime.sse_extract_completed_failed"))
        )
    }

    private static func errorJSON(_ message: String) -> [String: Any] {
        ["error": ["message": message, "type": "proxy_error"]]
    }

    private func corsResponse(_ response: HTTPResponse) -> HTTPResponse {
        var headers = response.headers
        for (key, value) in Self.corsHeaders() {
            headers[key] = value
        }
        return HTTPResponse(statusCode: response.statusCode, headers: headers, body: response.body)
    }

    private func corsResponse(statusCode: Int) -> HTTPResponse {
        HTTPResponse(statusCode: statusCode, headers: Self.corsHeaders(), body: Data())
    }

    private static func corsHeaders() -> [String: String] {
        [
            "Access-Control-Allow-Origin": "http://localhost",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, anthropic-version",
            "Access-Control-Max-Age": "86400"
        ]
    }
}

private actor SSEPreflightGate {
    private var continuation: CheckedContinuation<Void, Error>?
    private var result: Result<Void, Error>?

    func wait() async throws {
        if let result {
            return try result.get()
        }
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
        }
    }

    func succeed() {
        finish(.success(()))
    }

    func fail(_ error: Error) {
        finish(.failure(error))
    }

    private func finish(_ result: Result<Void, Error>) {
        guard self.result == nil else { return }
        self.result = result
        guard let continuation else { return }
        self.continuation = nil
        continuation.resume(with: result)
    }
}
