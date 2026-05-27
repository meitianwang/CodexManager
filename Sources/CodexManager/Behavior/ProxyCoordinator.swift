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
            return await handleModels(request)

        case ("POST", "/v1/chat/completions"):
            return await handleChatCompletions(request)

        case ("POST", "/v1/responses"):
            return await handleResponses(request)

        case ("POST", "/v1/responses/compact"):
            return await handleCodexJSONPassthrough(request, upstreamPath: "responses/compact")

        case ("POST", "/v1/memories/trace_summarize"):
            return await handleCodexJSONPassthrough(request, upstreamPath: "memories/trace_summarize")

        case ("POST", "/v1/alpha/search"):
            return await handleCodexJSONPassthrough(
                request,
                upstreamPath: "alpha/search",
                defaultModel: ""
            )

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

    private func handleModels(_ request: HTTPRequest) async -> ProxyHTTPResponse {
        let queryItems = Self.modelsQueryItems(from: request)
        let requestHeaders = Self.forwardableUpstreamHeaders(from: request)
        return await executeWithRetry(
            bodyData: Data(),
            model: "",
            requestHeaders: requestHeaders,
            upstreamPath: "models",
            upstreamMethod: "GET",
            upstreamQueryItems: queryItems,
            upstreamStreams: false
        ) { result in
            switch result {
            case .complete(statusCode: let statusCode, data: let data, headers: let headers):
                let responseHeaders = Self.jsonHeaders(merging: Self.mirroredDownstreamHeaders(from: headers))
                return .complete(self.corsResponse(HTTPResponse(
                    statusCode: statusCode,
                    headers: responseHeaders,
                    body: data
                )))
            case .streaming(statusCode: let statusCode, lines: let lines, headers: let headers):
                return .streaming(
                    statusCode: statusCode,
                    headers: Self.corsHeaders(merging: Self.mirroredDownstreamHeaders(from: headers)),
                    body: lines
                )
            }
        }
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

        return await executeWithRetry(bodyData: bodyData, model: model) { result in
            switch result {
            case .streaming(statusCode: _, lines: let lines, headers: _):
                if isStream {
                    let translated = ChatToCodexTranslator.translateStreamingResponse(model: model, lines: lines)
                    return .streaming(statusCode: 200, headers: Self.corsHeaders(), body: translated)
                } else {
                    let response = await ChatToCodexTranslator.collectAndTranslateResponse(model: model, lines: lines)
                    return .complete(self.corsResponse(response))
                }
            case .complete(statusCode: _, data: let data, headers: _):
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

        // Preserve Codex-native request bodies. Only fill fields older or generic
        // clients may omit, and force upstream streaming so retry preflight can work.
        var body = json
        body["stream"] = true
        if body["store"] == nil {
            body["store"] = false
        }
        if body["instructions"] == nil {
            body["instructions"] = ""
        }
        if body["tools"] == nil {
            body["tools"] = [] as [Any]
        }
        if body["tool_choice"] == nil {
            body["tool_choice"] = "auto"
        }
        if body["parallel_tool_calls"] == nil {
            body["parallel_tool_calls"] = true
        }
        if body["include"] == nil {
            body["include"] = body["reasoning"] == nil ? [] as [Any] : ["reasoning.encrypted_content"]
        }

        guard let bodyData = try? JSONSerialization.data(withJSONObject: body) else {
            return .complete(corsResponse(HTTPResponse.json(
                statusCode: 400,
                object: Self.errorJSON(L10n.tr("error.proxy_runtime.invalid_upstream_payload"))
            )))
        }

        let requestHeaders = Self.forwardableUpstreamHeaders(from: request)
        return await executeWithRetry(
            bodyData: bodyData,
            model: model,
            requestHeaders: requestHeaders,
            upstreamPath: "responses",
            upstreamStreams: true
        ) { result in
            switch result {
            case .streaming(statusCode: let statusCode, lines: let lines, headers: let headers):
                let mirroredHeaders = Self.mirroredDownstreamHeaders(from: headers)
                if isStream {
                    // Passthrough SSE lines
                    return .streaming(
                        statusCode: statusCode,
                        headers: Self.corsHeaders(merging: mirroredHeaders),
                        body: lines
                    )
                } else {
                    // Collect and return completed response
                    let response = await Self.collectCompletedResponse(
                        lines: lines,
                        headers: mirroredHeaders
                    )
                    return .complete(self.corsResponse(response))
                }
            case .complete(statusCode: let statusCode, data: let data, headers: let headers):
                let responseHeaders = Self.jsonHeaders(merging: Self.mirroredDownstreamHeaders(from: headers))
                return .complete(self.corsResponse(HTTPResponse(
                    statusCode: statusCode,
                    headers: responseHeaders,
                    body: data
                )))
            }
        }
    }

    private func handleCodexJSONPassthrough(
        _ request: HTTPRequest,
        upstreamPath: String,
        defaultModel: String = "gpt-5"
    ) async -> ProxyHTTPResponse {
        guard let json = parseJSONBody(request.body) else {
            return .complete(corsResponse(HTTPResponse.json(
                statusCode: 400,
                object: Self.errorJSON(L10n.tr("error.proxy_runtime.request_body_must_be_object"))
            )))
        }

        let model = json["model"] as? String ?? defaultModel
        let requestHeaders = Self.forwardableUpstreamHeaders(from: request)
        return await executeWithRetry(
            bodyData: request.body,
            model: model,
            requestHeaders: requestHeaders,
            upstreamPath: upstreamPath,
            upstreamStreams: false
        ) { result in
            switch result {
            case .complete(statusCode: let statusCode, data: let data, headers: let headers):
                let responseHeaders = Self.jsonHeaders(merging: Self.mirroredDownstreamHeaders(from: headers))
                return .complete(self.corsResponse(HTTPResponse(
                    statusCode: statusCode,
                    headers: responseHeaders,
                    body: data
                )))
            case .streaming(statusCode: let statusCode, lines: let lines, headers: let headers):
                return .streaming(
                    statusCode: statusCode,
                    headers: Self.corsHeaders(merging: Self.mirroredDownstreamHeaders(from: headers)),
                    body: lines
                )
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

        return await executeWithRetry(bodyData: bodyData, model: model) { result in
            switch result {
            case .streaming(statusCode: _, lines: let lines, headers: _):
                if isStream {
                    let translated = AnthropicToCodexTranslator.translateStreamingResponse(model: model, lines: lines)
                    return .streaming(statusCode: 200, headers: Self.corsHeaders(), body: translated)
                } else {
                    let response = await AnthropicToCodexTranslator.collectAndTranslateResponse(model: model, lines: lines)
                    return .complete(self.corsResponse(response))
                }
            case .complete(statusCode: _, data: let data, headers: _):
                // Shouldn't happen since we always stream from upstream, but handle gracefully
                let text = String(data: data, encoding: .utf8) ?? ""
                let fallback = AnthropicToCodexTranslator.anthropicErrorResponse(statusCode: 502, message: "Unexpected non-stream response: \(text.prefix(200))")
                return .complete(self.corsResponse(fallback))
            }
        }
    }

    // MARK: - Account Selection & Retry

    private enum UpstreamSuccessResult {
        case streaming(statusCode: Int, lines: AsyncStream<Data>, headers: [String: String])
        case complete(statusCode: Int, data: Data, headers: [String: String])
    }

    private func executeWithRetry(
        bodyData: Data,
        model: String,
        requestHeaders: [String: String] = [:],
        upstreamPath: String = "responses",
        upstreamMethod: String = "POST",
        upstreamQueryItems: [URLQueryItem] = [],
        upstreamStreams: Bool = true,
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
        let normalizedPath = upstreamPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let upstreamURLString = baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/backend-api/codex/" + normalizedPath
        if let bodyStr = String(data: bodyData.prefix(2048), encoding: .utf8) {
            proxyLogger.info("Upstream body: \(bodyStr, privacy: .public)")
        }
        if let url = Self.upstreamURL(string: upstreamURLString, queryItems: upstreamQueryItems) {
            upstreamURL = url
        } else {
            return .complete(corsResponse(HTTPResponse.json(
                statusCode: 500,
                object: Self.errorJSON("Invalid upstream URL")
            )))
        }
        proxyLogger.info("Upstream URL: \(upstreamURL.absoluteString, privacy: .public)")

        var failures: [String] = []

        for account in accountSelection.accounts {
            let request = makeUpstreamRequest(
                method: upstreamMethod,
                url: upstreamURL,
                bodyData: bodyData,
                headers: requestHeaders,
                upstreamStreams: upstreamStreams,
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
        method: String,
        url: URL,
        bodyData: Data,
        headers: [String: String],
        upstreamStreams: Bool,
        account: ProxyAccount
    ) -> CodexUpstreamRequest {
        CodexUpstreamRequest(
            method: method,
            url: url,
            body: bodyData,
            headers: headers,
            accessToken: account.accessToken,
            accountID: account.accountID,
            isStream: upstreamStreams
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
                    method: request.method,
                    url: request.url,
                    bodyData: request.body,
                    headers: request.headers,
                    upstreamStreams: request.isStream,
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
        case .stream(let statusCode, let lines, let headers):
            return .streaming(
                statusCode: statusCode,
                lines: try await preflightStreamingLines(lines),
                headers: headers
            )
        case .complete(let statusCode, let data, let headers):
            if let error = Self.firstSSEError(in: data) {
                throw CodexUpstreamError.eventError(
                    statusCode: error.statusCode,
                    message: error.message,
                    body: error.body
                )
            }
            return .complete(statusCode: statusCode, data: data, headers: headers)
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
        guard !model.isEmpty else { return true }
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

    private static func collectCompletedResponse(
        lines: AsyncStream<Data>,
        headers: [String: String] = [:]
    ) async -> HTTPResponse {
        let dataPrefix = Data("data: ".utf8)
        var completedPayload: Data?

        for await line in lines {
            if let error = CodexUpstreamSSEInspector.error(fromSSELine: line) {
                return HTTPResponse(
                    statusCode: error.statusCode,
                    headers: jsonHeaders(merging: headers),
                    body: (try? JSONSerialization.data(withJSONObject: errorJSON(error.message))) ?? Data("{}".utf8)
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
                headers: jsonHeaders(merging: headers),
                body: data
            )
        }

        return HTTPResponse(
            statusCode: 502,
            headers: jsonHeaders(merging: headers),
            body: (try? JSONSerialization.data(
                withJSONObject: errorJSON(L10n.tr("error.proxy_runtime.sse_extract_completed_failed"))
            )) ?? Data("{}".utf8)
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

    private static func corsHeaders(merging extra: [String: String] = [:]) -> [String: String] {
        var headers = extra
        for (key, value) in [
            "Access-Control-Allow-Origin": "http://localhost",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": Self.corsAllowedHeaders,
            "Access-Control-Expose-Headers": Self.corsExposedHeaders,
            "Access-Control-Max-Age": "86400",
        ] {
            headers[key] = value
        }
        return headers
    }

    private static func jsonHeaders(merging extra: [String: String] = [:]) -> [String: String] {
        var headers = extra
        headers["Content-Type"] = "application/json; charset=utf-8"
        return headers
    }

    private static func upstreamURL(string: String, queryItems: [URLQueryItem]) -> URL? {
        guard var components = URLComponents(string: string) else { return nil }
        if !queryItems.isEmpty {
            components.queryItems = queryItems
        }
        return components.url
    }

    private static func modelsQueryItems(from request: HTTPRequest) -> [URLQueryItem] {
        if request.queryItems.contains(where: { $0.name == "client_version" }) {
            return request.queryItems
        }
        let version = request.headers["version"]?.trimmingCharacters(in: .whitespacesAndNewlines)
        var queryItems = request.queryItems
        queryItems.append(URLQueryItem(
            name: "client_version",
            value: version?.isEmpty == false ? version : AppVersion.current
        ))
        return queryItems
    }

    private static let upstreamBlockedHeaderNames: Set<String> = [
        "authorization",
        "x-api-key",
        "host",
        "content-length",
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
        "accept-encoding",
        "chatgpt-account-id"
    ]

    private static let downstreamBlockedHeaderNames: Set<String> = [
        "content-length",
        "content-type",
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
        "content-encoding"
    ]

    private static let corsAllowedHeaders = [
        "Content-Type",
        "Authorization",
        "x-api-key",
        "anthropic-version",
        "session-id",
        "thread-id",
        "x-client-request-id",
        "x-codex-window-id",
        "x-codex-turn-metadata",
        "x-codex-turn-state",
        "x-codex-beta-features",
        "x-openai-subagent",
        "x-codex-parent-thread-id",
        "x-openai-memgen-request",
        "openai-beta",
        "version",
        "originator"
    ].joined(separator: ", ")

    private static let corsExposedHeaders = [
        "x-codex-turn-state",
        "x-request-id",
        "openai-model",
        "x-models-etag",
        "x-reasoning-included",
        "x-codex-ratelimit-reset-requests",
        "x-codex-ratelimit-remaining-requests",
        "x-codex-ratelimit-limit-requests",
        "x-codex-ratelimit-reset-tokens",
        "x-codex-ratelimit-remaining-tokens",
        "x-codex-ratelimit-limit-tokens"
    ].joined(separator: ", ")

    private static func forwardableUpstreamHeaders(from request: HTTPRequest) -> [String: String] {
        request.headers.filter { name, _ in
            !upstreamBlockedHeaderNames.contains(name.lowercased())
        }
    }

    private static func mirroredDownstreamHeaders(from headers: [String: String]) -> [String: String] {
        var result: [String: String] = [:]
        for (name, value) in headers {
            if !downstreamBlockedHeaderNames.contains(name.lowercased()) {
                result[name] = value
            }
        }
        return result
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
