import Foundation
import os.log

private let proxyLogger = Logger(subsystem: "com.nik.mei.codexmanager", category: "ProxyCoordinator")

actor ProxyCoordinator {
    static let defaultPort: UInt16 = 18317

    private let storeRepository: AccountsStoreRepository
    private let authRepository: AuthRepository
    private let configPath: URL

    private var server: ProxyHTTPServer?
    private var upstreamClient = CodexUpstreamClient()
    private var roundRobinIndex = 0
    /// Random API key generated at each start — clients must send `Authorization: Bearer <key>`.
    private(set) var currentAPIKey: String?

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

    func start(port: UInt16) throws {
        guard server == nil else { return }

        let apiKey = Self.generateAPIKey()
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

    private static func generateAPIKey() -> String {
        let bytes = (0..<24).map { _ in UInt8.random(in: 0...255) }
        return "sk-local-" + bytes.map { String(format: "%02x", $0) }.joined()
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

        // Authenticate all other requests
        if let apiKey = currentAPIKey {
            let authHeader = request.headers["authorization"] ?? ""
            let token = authHeader.hasPrefix("Bearer ") ? String(authHeader.dropFirst(7)) : ""
            if token != apiKey {
                return .complete(corsResponse(HTTPResponse.json(
                    statusCode: 401,
                    object: Self.errorJSON("Invalid or missing API key. Use Authorization: Bearer <key>.")
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

        default:
            return .complete(corsResponse(HTTPResponse.json(
                statusCode: 404,
                object: Self.errorJSON(L10n.tr("error.proxy_runtime.unsupported_route"))
            )))
        }
    }

    // MARK: - /v1/models

    private func handleModels() -> HTTPResponse {
        let models: [[String: Any]] = [
            ["id": "gpt-5", "object": "model", "owned_by": "openai"],
            ["id": "gpt-5-mini", "object": "model", "owned_by": "openai"],
            ["id": "gpt-5-4", "object": "model", "owned_by": "openai"],
            ["id": "o3", "object": "model", "owned_by": "openai"],
            ["id": "o3-pro", "object": "model", "owned_by": "openai"],
            ["id": "o4-mini", "object": "model", "owned_by": "openai"],
            ["id": "codex-mini-latest", "object": "model", "owned_by": "openai"],
        ]
        return HTTPResponse.json(statusCode: 200, object: [
            "object": "list",
            "data": models
        ])
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
        if body["instructions"] == nil {
            body["instructions"] = ""
        }
        // Remove fields not accepted by codex backend
        body.removeValue(forKey: "previous_response_id")
        body.removeValue(forKey: "prompt_cache_retention")
        body.removeValue(forKey: "safety_identifier")

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
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Max-Age": "86400"
        ]
    }
}

// MARK: - Chat Completions ↔ Codex Responses Translation

enum ChatToCodexTranslator {
    /// 50 MB — matches CodexUpstreamClient.maxResponseBytes.
    private static let maxAccumulatedTextBytes = 50 * 1024 * 1024

    // MARK: Request: OpenAI Chat → Codex Responses

    static func translateRequest(model: String, messages: [[String: Any]], originalJSON: [String: Any]) -> [String: Any] {
        var codexBody: [String: Any] = [
            "model": model,
            "stream": true,
            "store": false
        ]

        var instructions = ""
        var input: [[String: Any]] = []

        for message in messages {
            guard let role = message["role"] as? String else { continue }
            let content = extractContent(from: message)

            if role == "system" || role == "developer" {
                if !instructions.isEmpty { instructions += "\n" }
                instructions += content
                continue
            }

            let contentType = role == "assistant" ? "output_text" : "input_text"
            input.append([
                "type": "message",
                "role": role,
                "content": [["type": contentType, "text": content]]
            ])
        }

        codexBody["instructions"] = instructions
        codexBody["input"] = input

        // Forward tools if present
        if let tools = originalJSON["tools"] as? [[String: Any]] {
            codexBody["tools"] = tools.compactMap { tool -> [String: Any]? in
                guard let function = tool["function"] as? [String: Any],
                      let name = function["name"] as? String else { return nil }
                var codexTool: [String: Any] = [
                    "type": "function",
                    "name": name
                ]
                if let desc = function["description"] as? String {
                    codexTool["description"] = desc
                }
                if let params = function["parameters"] {
                    codexTool["parameters"] = params
                }
                return codexTool
            }
        }

        // Forward optional parameters
        if let maxTokens = originalJSON["max_tokens"] as? Int {
            codexBody["max_output_tokens"] = maxTokens
        }
        if let temperature = originalJSON["temperature"] {
            codexBody["temperature"] = temperature
        }
        if let topP = originalJSON["top_p"] {
            codexBody["top_p"] = topP
        }

        return codexBody
    }

    private static func extractContent(from message: [String: Any]) -> String {
        if let text = message["content"] as? String {
            return text
        }
        if let parts = message["content"] as? [[String: Any]] {
            return parts.compactMap { part -> String? in
                if part["type"] as? String == "text" {
                    return part["text"] as? String
                }
                return nil
            }.joined(separator: "\n")
        }
        return ""
    }

    // MARK: Response: Codex SSE → Chat Completion Chunks (streaming)

    static func translateStreamingResponse(model: String, lines: AsyncStream<Data>) -> AsyncStream<Data> {
        let requestID = "chatcmpl-\(UUID().uuidString.prefix(12))"
        let dataPrefix = Data("data: ".utf8)

        return AsyncStream { continuation in
            let task = Task {
                var sentRole = false

                for await line in lines {
                    guard line.starts(with: dataPrefix) else {
                        // Forward empty lines for SSE framing
                        if line == Data("\n".utf8) || line == Data("\r\n".utf8) {
                            continuation.yield(line)
                        }
                        continue
                    }

                    let payload = Data(line.dropFirst(dataPrefix.count))
                    guard let text = String(data: payload, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
                          !text.isEmpty,
                          let event = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
                          let eventType = event["type"] as? String else {
                        continue
                    }

                    switch eventType {
                    case "response.output_text.delta":
                        if !sentRole {
                            let roleChunk = makeStreamChunk(id: requestID, model: model, delta: ["role": "assistant"])
                            continuation.yield(formatSSELine(roleChunk))
                            sentRole = true
                        }
                        if let delta = event["delta"] as? String {
                            let chunk = makeStreamChunk(id: requestID, model: model, delta: ["content": delta])
                            continuation.yield(formatSSELine(chunk))
                        }

                    case "response.completed":
                        let finalChunk = makeStreamChunk(
                            id: requestID,
                            model: model,
                            delta: [:],
                            finishReason: "stop"
                        )
                        continuation.yield(formatSSELine(finalChunk))
                        continuation.yield(Data("data: [DONE]\n\n".utf8))

                    default:
                        break
                    }
                }

                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: Response: Codex SSE → Chat Completion (non-streaming)

    static func collectAndTranslateResponse(model: String, lines: AsyncStream<Data>) async -> HTTPResponse {
        let dataPrefix = Data("data: ".utf8)
        var fullText = ""
        var usage: [String: Any]?
        var truncated = false

        for await line in lines {
            guard line.starts(with: dataPrefix) else { continue }
            let payload = Data(line.dropFirst(dataPrefix.count))
            guard let text = String(data: payload, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !text.isEmpty,
                  let event = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
                  let eventType = event["type"] as? String else {
                continue
            }

            switch eventType {
            case "response.output_text.delta":
                if !truncated, let delta = event["delta"] as? String {
                    fullText += delta
                    if fullText.utf8.count > maxAccumulatedTextBytes {
                        truncated = true
                    }
                }
            case "response.completed":
                if let response = event["response"] as? [String: Any],
                   let u = response["usage"] as? [String: Any] {
                    usage = u
                }
            default:
                break
            }
        }

        let requestID = "chatcmpl-\(UUID().uuidString.prefix(12))"
        var result: [String: Any] = [
            "id": requestID,
            "object": "chat.completion",
            "model": model,
            "choices": [[
                "index": 0,
                "message": [
                    "role": "assistant",
                    "content": fullText
                ],
                "finish_reason": "stop"
            ]]
        ]
        if let usage {
            result["usage"] = usage
        }

        let data = (try? JSONSerialization.data(withJSONObject: result)) ?? Data("{}".utf8)
        return HTTPResponse(
            statusCode: 200,
            headers: ["Content-Type": "application/json; charset=utf-8"],
            body: data
        )
    }

    // MARK: Response: Codex complete → Chat Completion

    static func translateCompleteResponse(model: String, data: Data) -> HTTPResponse {
        // Parse the SSE data to extract completed response
        let lines = data.split(separator: UInt8(ascii: "\n"))
        let dataPrefix = Data("data: ".utf8)
        var fullText = ""
        var usage: [String: Any]?
        var truncated = false

        for line in lines {
            let lineData = Data(line)
            guard lineData.starts(with: dataPrefix) else { continue }
            let payload = Data(lineData.dropFirst(dataPrefix.count))
            guard let text = String(data: payload, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !text.isEmpty,
                  let event = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
                  let eventType = event["type"] as? String else {
                continue
            }

            if !truncated, eventType == "response.output_text.delta",
               let delta = event["delta"] as? String {
                fullText += delta
                if fullText.utf8.count > maxAccumulatedTextBytes {
                    truncated = true
                }
            }
            if eventType == "response.completed",
               let response = event["response"] as? [String: Any],
               let u = response["usage"] as? [String: Any] {
                usage = u
            }
        }

        let requestID = "chatcmpl-\(UUID().uuidString.prefix(12))"
        var result: [String: Any] = [
            "id": requestID,
            "object": "chat.completion",
            "model": model,
            "choices": [[
                "index": 0,
                "message": ["role": "assistant", "content": fullText],
                "finish_reason": "stop"
            ]]
        ]
        if let usage { result["usage"] = usage }

        let responseData = (try? JSONSerialization.data(withJSONObject: result)) ?? Data("{}".utf8)
        return HTTPResponse(
            statusCode: 200,
            headers: ["Content-Type": "application/json; charset=utf-8"],
            body: responseData
        )
    }

    // MARK: - SSE Helpers

    private static func makeStreamChunk(
        id: String,
        model: String,
        delta: [String: Any],
        finishReason: String? = nil
    ) -> [String: Any] {
        var choice: [String: Any] = [
            "index": 0,
            "delta": delta
        ]
        if let finishReason {
            choice["finish_reason"] = finishReason
        } else {
            choice["finish_reason"] = NSNull()
        }

        return [
            "id": id,
            "object": "chat.completion.chunk",
            "model": model,
            "choices": [choice]
        ]
    }

    private static func formatSSELine(_ object: [String: Any]) -> Data {
        guard let json = try? JSONSerialization.data(withJSONObject: object) else {
            return Data()
        }
        var line = Data("data: ".utf8)
        line.append(json)
        line.append(Data("\n\n".utf8))
        return line
    }
}
