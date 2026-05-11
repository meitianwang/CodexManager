import Foundation
import os.log

private let proxyLogger = Logger(subsystem: "com.nik.mei.codexmanager", category: "ProxyCoordinator")

actor ProxyCoordinator {
    static let defaultPort: UInt16 = 18317

    private static let remoteModelsURLs = [
        "https://models.router-for.me/models.json",
        "https://raw.githubusercontent.com/router-for-me/models/refs/heads/main/models.json",
    ]

    private let storeRepository: AccountsStoreRepository
    private let authRepository: AuthRepository
    private let configPath: URL

    private var server: ProxyHTTPServer?
    private var upstreamClient = CodexUpstreamClient()
    private var roundRobinIndex = 0
    /// Random API key generated at each start — clients must send `Authorization: Bearer <key>`.
    private(set) var currentAPIKey: String?
    /// Dynamically fetched model IDs; nil until first fetch completes.
    private(set) var fetchedModels: [String]?

    init(
        storeRepository: AccountsStoreRepository,
        authRepository: AuthRepository,
        configPath: URL
    ) {
        self.storeRepository = storeRepository
        self.authRepository = authRepository
        self.configPath = configPath
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
                let models = try await Self.fetchModels(from: url, planKeys: planKeys)
                if !models.isEmpty {
                    fetchedModels = models
                    proxyLogger.info("Fetched \(models.count) models from \(url, privacy: .public)")
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

    private static func fetchModels(from urlString: String, planKeys: Set<String>) async throws -> [String] {
        guard let url = URL(string: urlString) else { return [] }
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        let session = URLSession(configuration: config)
        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return [] }
        guard let catalog = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [] }

        var seen = Set<String>()
        var result: [String] = []
        for key in planKeys {
            guard let entries = catalog[key] as? [[String: Any]] else { continue }
            for entry in entries {
                if let id = entry["id"] as? String, seen.insert(id).inserted {
                    result.append(id)
                }
            }
        }
        return result
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
        let accounts = loadAvailableAccounts()
        guard !accounts.isEmpty else {
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
        let maxAttempts = min(accounts.count, 3)

        for attempt in 0..<maxAttempts {
            let accountIndex = (roundRobinIndex + attempt) % accounts.count
            let account = accounts[accountIndex]

            let request = CodexUpstreamRequest(
                url: upstreamURL,
                body: bodyData,
                accessToken: account.accessToken,
                accountID: account.accountID,
                isStream: true // always stream from upstream
            )

            do {
                let result = try await upstreamClient.execute(request: request)
                roundRobinIndex = (accountIndex + 1) % accounts.count

                switch result {
                case .stream(_, let lines, _):
                    return await transform(.streaming(lines))
                case .complete(_, let data, _):
                    return await transform(.complete(data))
                }
            } catch let error as CodexUpstreamError {
                let label = account.label
                let bodySnippet: String
                if case .httpError(_, let body) = error {
                    bodySnippet = String(data: body.prefix(1024), encoding: .utf8) ?? "(non-utf8)"
                } else {
                    bodySnippet = ""
                }
                proxyLogger.warning("Upstream failed for \(label, privacy: .public): \(error.localizedDescription, privacy: .public) body=\(bodySnippet, privacy: .public)")
                failures.append("\(label): \(error.localizedDescription)")

                if !error.isRetryable {
                    return .complete(corsResponse(HTTPResponse.json(
                        statusCode: error.statusCode,
                        object: Self.errorJSON(error.localizedDescription)
                    )))
                }
            } catch {
                failures.append(error.localizedDescription)
            }
        }

        let summary = failures.joined(separator: "; ")
        return .complete(corsResponse(HTTPResponse.json(
            statusCode: 502,
            object: Self.errorJSON(L10n.tr("error.proxy_runtime.upstream_failed_format", summary))
        )))
    }

    // MARK: - Account Loading

    private struct ProxyAccount {
        var label: String
        var accessToken: String
        var accountID: String
    }

    private func loadAvailableAccounts() -> [ProxyAccount] {
        guard let store = try? storeRepository.loadStore() else {
            return []
        }

        return store.accounts.compactMap { account in
            guard let extracted = try? authRepository.extractAuth(from: account.authJSON) else {
                return nil
            }
            return ProxyAccount(
                label: account.label,
                accessToken: extracted.accessToken,
                accountID: extracted.accountID
            )
        }
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
