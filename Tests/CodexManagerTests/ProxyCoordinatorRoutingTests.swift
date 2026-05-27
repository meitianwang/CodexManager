import XCTest
@testable import CodexManager

final class ProxyCoordinatorRoutingTests: XCTestCase {
    func testProxySkipsAccountsUntilKnownQuotaResetTime() async throws {
        let now: Int64 = 1_800_000_000
        let context = try makeProxyContext(
            now: now,
            accounts: [
                makeAccount(
                    id: "exhausted",
                    label: "Exhausted",
                    accountID: "workspace-exhausted",
                    accessToken: "token-exhausted",
                    usage: usage(fiveHourUsed: 100, fiveHourResetAt: now + 3_600),
                    addedAt: 1
                ),
                makeAccount(
                    id: "available",
                    label: "Available",
                    accountID: "workspace-available",
                    accessToken: "token-available",
                    usage: usage(fiveHourUsed: 10, oneWeekUsed: 20),
                    addedAt: 2
                )
            ],
            upstreamResults: [
                "token-available": [.success(responseStream(id: "resp-available"))]
            ]
        )
        let port = try await startProxy(context.coordinator)
        defer { Task { await context.coordinator.stop() } }

        let response = try await sendResponsesRequest(port: port)

        XCTAssertEqual(response.statusCode, 200)
        XCTAssertEqual(response.body["id"] as? String, "resp-available")
        let accountIDs = await context.upstream.requestedAccountIDs()
        XCTAssertEqual(accountIDs, ["workspace-available"])
    }

    func testProxyRetriesEveryEligibleAccountUntilOneSucceeds() async throws {
        let context = try makeProxyContext(
            accounts: [
                makeAccount(id: "a1", label: "A1", accountID: "workspace-1", accessToken: "token-1", usage: usage(), addedAt: 1),
                makeAccount(id: "a2", label: "A2", accountID: "workspace-2", accessToken: "token-2", usage: usage(), addedAt: 2),
                makeAccount(id: "a3", label: "A3", accountID: "workspace-3", accessToken: "token-3", usage: usage(), addedAt: 3),
                makeAccount(id: "a4", label: "A4", accountID: "workspace-4", accessToken: "token-4", usage: usage(), addedAt: 4)
            ],
            upstreamResults: [
                "token-1": [.failure(.httpError(statusCode: 429, body: Data("quota".utf8)))],
                "token-2": [.failure(.httpError(statusCode: 429, body: Data("quota".utf8)))],
                "token-3": [.failure(.httpError(statusCode: 429, body: Data("quota".utf8)))],
                "token-4": [.success(responseStream(id: "resp-fourth"))]
            ]
        )
        let port = try await startProxy(context.coordinator)
        defer { Task { await context.coordinator.stop() } }

        let response = try await sendResponsesRequest(port: port)

        XCTAssertEqual(response.statusCode, 200)
        XCTAssertEqual(response.body["id"] as? String, "resp-fourth")
        let accountIDs = await context.upstream.requestedAccountIDs()
        XCTAssertEqual(accountIDs, ["workspace-1", "workspace-2", "workspace-3", "workspace-4"])
    }

    func testProxyRefreshesExpiredTokenAndRetriesSameAccount() async throws {
        let refreshedTokens = ChatGPTOAuthTokens(
            accessToken: "token-new",
            refreshToken: "refresh-new",
            idToken: makeIDToken(accountID: "workspace-1", email: "one@example.com", principalID: "user-1", planType: "pro"),
            apiKey: nil
        )
        let oauth = ProxyOAuthServiceStub(refreshTokens: refreshedTokens)
        let context = try makeProxyContext(
            accounts: [
                makeAccount(
                    id: "a1",
                    label: "A1",
                    accountID: "workspace-1",
                    accessToken: "token-old",
                    refreshToken: "refresh-old",
                    usage: usage(),
                    addedAt: 1
                )
            ],
            upstreamResults: [
                "token-old": [.failure(.httpError(statusCode: 401, body: Data("unauthorized".utf8)))],
                "token-new": [.success(responseStream(id: "resp-refreshed"))]
            ],
            oauthService: oauth
        )
        let port = try await startProxy(context.coordinator)
        defer { Task { await context.coordinator.stop() } }

        let response = try await sendResponsesRequest(port: port)

        XCTAssertEqual(response.statusCode, 200)
        XCTAssertEqual(response.body["id"] as? String, "resp-refreshed")
        let tokens = await context.upstream.requestedAccessTokens()
        XCTAssertEqual(tokens, ["token-old", "token-new"])
        let refreshTokens = await oauth.requestedRefreshTokens()
        XCTAssertEqual(refreshTokens, ["refresh-old"])
        let savedAccount = try XCTUnwrap(context.storeRepository.loadStore().accounts.first)
        XCTAssertEqual(savedAccount.authJSON["tokens"]?["access_token"]?.stringValue, "token-new")
    }

    func testProxyRetriesNextAccountWhenUpstreamReturnsSSEErrorBeforeOutput() async throws {
        let context = try makeProxyContext(
            accounts: [
                makeAccount(id: "a1", label: "A1", accountID: "workspace-1", accessToken: "token-1", usage: usage(), addedAt: 1),
                makeAccount(id: "a2", label: "A2", accountID: "workspace-2", accessToken: "token-2", usage: usage(), addedAt: 2)
            ],
            upstreamResults: [
                "token-1": [.success(errorStream(message: "quota exceeded", code: "quota_exceeded"))],
                "token-2": [.success(responseStream(id: "resp-second"))]
            ]
        )
        let port = try await startProxy(context.coordinator)
        defer { Task { await context.coordinator.stop() } }

        let response = try await sendResponsesRequest(port: port)

        XCTAssertEqual(response.statusCode, 200)
        XCTAssertEqual(response.body["id"] as? String, "resp-second")
        let accountIDs = await context.upstream.requestedAccountIDs()
        XCTAssertEqual(accountIDs, ["workspace-1", "workspace-2"])
    }

    func testResponsesForwardsCodexHeadersAndOverridesSelectedAccount() async throws {
        let context = try makeProxyContext(
            accounts: [
                makeAccount(id: "a1", label: "A1", accountID: "workspace-1", accessToken: "token-1", usage: usage(), addedAt: 1)
            ],
            upstreamResults: [
                "token-1": [.success(responseStream(id: "resp-one"))]
            ]
        )
        let port = try await startProxy(context.coordinator)
        defer { Task { await context.coordinator.stop() } }

        _ = try await sendResponsesRequest(
            port: port,
            headers: [
                "session-id": "session-1",
                "thread-id": "thread-1",
                "x-client-request-id": "thread-1",
                "x-codex-window-id": "thread-1:0",
                "x-codex-turn-metadata": #"{"turn_id":"turn-1"}"#,
                "x-codex-turn-state": "turn-state-1",
                "originator": "codex_chatgpt_desktop",
                "User-Agent": "CodexAppTest/1",
                "version": "9.9.9",
                "x-api-key": "test-key",
                "ChatGPT-Account-ID": "client-selected-account"
            ]
        )

        let requests = await context.upstream.requestedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.accessToken, "token-1")
        XCTAssertEqual(request.accountID, "workspace-1")
        XCTAssertEqual(request.headers["session-id"], "session-1")
        XCTAssertEqual(request.headers["thread-id"], "thread-1")
        XCTAssertEqual(request.headers["x-client-request-id"], "thread-1")
        XCTAssertEqual(request.headers["x-codex-window-id"], "thread-1:0")
        XCTAssertEqual(request.headers["x-codex-turn-metadata"], #"{"turn_id":"turn-1"}"#)
        XCTAssertEqual(request.headers["x-codex-turn-state"], "turn-state-1")
        XCTAssertEqual(request.headers["originator"], "codex_chatgpt_desktop")
        XCTAssertEqual(request.headers["user-agent"], "CodexAppTest/1")
        XCTAssertEqual(request.headers["version"], "9.9.9")
        XCTAssertNil(request.headers["authorization"])
        XCTAssertNil(request.headers["x-api-key"])
        XCTAssertNil(request.headers["chatgpt-account-id"])
    }

    func testResponsesMirrorsCodexResponseHeaders() async throws {
        let context = try makeProxyContext(
            accounts: [
                makeAccount(id: "a1", label: "A1", accountID: "workspace-1", accessToken: "token-1", usage: usage(), addedAt: 1)
            ],
            upstreamResults: [
                "token-1": [
                    .success(responseStream(
                        id: "resp-one",
                        headers: [
                            "x-codex-turn-state": "turn-state-next",
                            "x-request-id": "req-1",
                            "openai-model": "gpt-5-codex",
                            "transfer-encoding": "upstream-chunked"
                        ]
                    ))
                ]
            ]
        )
        let port = try await startProxy(context.coordinator)
        defer { Task { await context.coordinator.stop() } }

        let response = try await sendResponsesRequest(port: port)

        XCTAssertEqual(response.statusCode, 200)
        XCTAssertEqual(response.headers["x-codex-turn-state"], "turn-state-next")
        XCTAssertEqual(response.headers["x-request-id"], "req-1")
        XCTAssertEqual(response.headers["openai-model"], "gpt-5-codex")
        XCTAssertNotEqual(response.headers["transfer-encoding"], "upstream-chunked")
    }

    func testResponsesPreservesCodexBodyFields() async throws {
        let context = try makeProxyContext(
            accounts: [
                makeAccount(id: "a1", label: "A1", accountID: "workspace-1", accessToken: "token-1", usage: usage(), addedAt: 1)
            ],
            upstreamResults: [
                "token-1": [.success(responseStream(id: "resp-one"))]
            ]
        )
        let port = try await startProxy(context.coordinator)
        defer { Task { await context.coordinator.stop() } }

        let body: [String: Any] = [
            "model": "gpt-5-codex",
            "stream": false,
            "store": false,
            "input": [
                [
                    "role": "system",
                    "content": [
                        ["type": "input_text", "text": "stay system"]
                    ]
                ]
            ],
            "tools": [
                ["type": "function", "name": "lookup", "parameters": ["type": "object"]]
            ],
            "tool_choice": "auto",
            "parallel_tool_calls": false,
            "reasoning": ["effort": "high", "summary": "auto"],
            "include": ["custom.include"],
            "prompt_cache_key": "thread-1",
            "client_metadata": [
                "x-codex-installation-id": "install-1",
                "custom": "value"
            ],
            "text": ["format": ["type": "text"]],
            "previous_response_id": "prev-1",
            "temperature": 0.2
        ]

        _ = try await sendResponsesRequest(port: port, body: body)

        let requests = await context.upstream.requestedRequests()
        let request = try XCTUnwrap(requests.first)
        let forwarded = try XCTUnwrap(JSONSerialization.jsonObject(with: request.body) as? [String: Any])
        XCTAssertEqual(forwarded["model"] as? String, "gpt-5-codex")
        XCTAssertEqual(forwarded["stream"] as? Bool, true)
        XCTAssertEqual(forwarded["store"] as? Bool, false)
        XCTAssertEqual(forwarded["parallel_tool_calls"] as? Bool, false)
        XCTAssertEqual(forwarded["include"] as? [String], ["custom.include"])
        XCTAssertEqual(forwarded["prompt_cache_key"] as? String, "thread-1")
        XCTAssertEqual(forwarded["previous_response_id"] as? String, "prev-1")
        XCTAssertEqual(forwarded["temperature"] as? Double, 0.2)
        let metadata = try XCTUnwrap(forwarded["client_metadata"] as? [String: String])
        XCTAssertEqual(metadata["x-codex-installation-id"], "install-1")
        XCTAssertEqual(metadata["custom"], "value")
        let input = try XCTUnwrap(forwarded["input"] as? [[String: Any]])
        XCTAssertEqual(input.first?["role"] as? String, "system")
    }

    func testCompactEndpointRoutesThroughSelectedAccount() async throws {
        let context = try makeProxyContext(
            accounts: [
                makeAccount(id: "a1", label: "A1", accountID: "workspace-1", accessToken: "token-1", usage: usage(), addedAt: 1)
            ],
            upstreamResults: [
                "token-1": [.success(completeJSON(["output": [] as [Any]], headers: ["x-request-id": "req-compact"]))]
            ]
        )
        let port = try await startProxy(context.coordinator)
        defer { Task { await context.coordinator.stop() } }

        let body: [String: Any] = [
            "model": "gpt-5-codex",
            "input": [] as [Any],
            "tools": [] as [Any],
            "parallel_tool_calls": true,
            "prompt_cache_key": "thread-1"
        ]

        let response = try await sendJSONRequest(port: port, path: "/v1/responses/compact", body: body)

        XCTAssertEqual(response.statusCode, 200)
        XCTAssertEqual(response.headers["x-request-id"], "req-compact")
        let requests = await context.upstream.requestedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.url.path, "/backend-api/codex/responses/compact")
        XCTAssertFalse(request.isStream)
        XCTAssertEqual(request.accountID, "workspace-1")
    }

    func testMemoriesEndpointRoutesThroughSelectedAccount() async throws {
        let context = try makeProxyContext(
            accounts: [
                makeAccount(id: "a1", label: "A1", accountID: "workspace-1", accessToken: "token-1", usage: usage(), addedAt: 1)
            ],
            upstreamResults: [
                "token-1": [.success(completeJSON(["output": [] as [Any]], headers: ["x-request-id": "req-memories"]))]
            ]
        )
        let port = try await startProxy(context.coordinator)
        defer { Task { await context.coordinator.stop() } }

        let body: [String: Any] = [
            "model": "gpt-5-codex",
            "traces": [] as [Any],
            "reasoning": ["effort": "low"]
        ]

        let response = try await sendJSONRequest(port: port, path: "/v1/memories/trace_summarize", body: body)

        XCTAssertEqual(response.statusCode, 200)
        XCTAssertEqual(response.headers["x-request-id"], "req-memories")
        let requests = await context.upstream.requestedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.url.path, "/backend-api/codex/memories/trace_summarize")
        XCTAssertFalse(request.isStream)
        XCTAssertEqual(request.accountID, "workspace-1")
    }

    func testModelsEndpointRoutesThroughSelectedAccountWithClientVersion() async throws {
        let context = try makeProxyContext(
            accounts: [
                makeAccount(id: "a1", label: "A1", accountID: "workspace-1", accessToken: "token-1", usage: usage(), addedAt: 1)
            ],
            upstreamResults: [
                "token-1": [
                    .success(completeJSON(
                        ["models": [["slug": "gpt-5-codex", "name": "GPT-5 Codex"]]],
                        headers: ["etag": #"W/"models-1""#]
                    ))
                ]
            ]
        )
        let port = try await startProxy(context.coordinator)
        defer { Task { await context.coordinator.stop() } }

        let response = try await sendGETRequest(
            port: port,
            path: "/v1/models?client_version=1.2.3",
            headers: [
                "session-id": "session-1",
                "version": "9.9.9"
            ]
        )

        XCTAssertEqual(response.statusCode, 200)
        XCTAssertEqual(response.headers["etag"], #"W/"models-1""#)
        XCTAssertNotNil(response.body["models"])
        let requests = await context.upstream.requestedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.method, "GET")
        XCTAssertEqual(request.url.path, "/backend-api/codex/models")
        XCTAssertEqual(URLComponents(url: request.url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "client_version" })?.value, "1.2.3")
        XCTAssertEqual(request.headers["session-id"], "session-1")
        XCTAssertEqual(request.accountID, "workspace-1")
        XCTAssertTrue(request.body.isEmpty)
    }

    func testModelsEndpointAddsClientVersionFromVersionHeaderWhenMissing() async throws {
        let context = try makeProxyContext(
            accounts: [
                makeAccount(id: "a1", label: "A1", accountID: "workspace-1", accessToken: "token-1", usage: usage(), addedAt: 1)
            ],
            upstreamResults: [
                "token-1": [.success(completeJSON(["models": [] as [Any]]))]
            ]
        )
        let port = try await startProxy(context.coordinator)
        defer { Task { await context.coordinator.stop() } }

        _ = try await sendGETRequest(port: port, path: "/v1/models", headers: ["version": "9.9.9"])

        let requests = await context.upstream.requestedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(URLComponents(url: request.url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "client_version" })?.value, "9.9.9")
    }

    func testSearchEndpointRoutesThroughSelectedAccountWithoutModelFiltering() async throws {
        let context = try makeProxyContext(
            accounts: [
                makeAccount(id: "a1", label: "A1", accountID: "workspace-1", accessToken: "token-1", usage: usage(), addedAt: 1)
            ],
            upstreamResults: [
                "token-1": [.success(completeJSON(["results": [] as [Any]], headers: ["x-request-id": "req-search"]))]
            ]
        )
        let port = try await startProxy(context.coordinator)
        defer { Task { await context.coordinator.stop() } }

        let body: [String: Any] = [
            "query": "codex",
            "commands": [] as [Any]
        ]

        let response = try await sendJSONRequest(port: port, path: "/v1/alpha/search", body: body)

        XCTAssertEqual(response.statusCode, 200)
        XCTAssertEqual(response.headers["x-request-id"], "req-search")
        let requests = await context.upstream.requestedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.url.path, "/backend-api/codex/alpha/search")
        XCTAssertEqual(request.accountID, "workspace-1")
        XCTAssertFalse(request.body.isEmpty)
    }

    private func makeProxyContext(
        now: Int64 = 1_800_000_000,
        accounts: [StoredAccount],
        upstreamResults: [String: [Result<CodexUpstreamResult, CodexUpstreamError>]],
        oauthService: ProxyOAuthServiceStub = ProxyOAuthServiceStub()
    ) throws -> ProxyTestContext {
        let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        addTeardownBlock {
            try? FileManager.default.removeItem(at: tempDir)
        }

        let paths = FileSystemPaths(
            applicationSupportDirectory: tempDir,
            accountStorePath: tempDir.appendingPathComponent("accounts.json"),
            settingsStorePath: tempDir.appendingPathComponent("settings.json"),
            codexAuthPath: tempDir.appendingPathComponent("auth.json"),
            codexConfigPath: tempDir.appendingPathComponent("config.toml")
        )
        let authRepository = AuthFileRepository(paths: paths)
        if let firstAuth = accounts.first?.authJSON {
            try authRepository.writeCurrentAuth(firstAuth)
        }

        let storeRepository = ProxyInMemoryAccountsStoreRepository(store: AccountsStore(accounts: accounts))
        let upstream = ProxyUpstreamStub(resultsByAccessToken: upstreamResults)
        let coordinator = ProxyCoordinator(
            storeRepository: storeRepository,
            authRepository: authRepository,
            chatGPTOAuthLoginService: oauthService,
            configPath: paths.codexConfigPath,
            dateProvider: ProxyStaticDateProvider(seconds: now),
            upstreamClient: upstream
        )
        return ProxyTestContext(
            coordinator: coordinator,
            storeRepository: storeRepository,
            upstream: upstream
        )
    }

    private func startProxy(_ coordinator: ProxyCoordinator) async throws -> UInt16 {
        var lastError: Error?
        for _ in 0..<10 {
            let port = UInt16.random(in: 20_000...50_000)
            do {
                try await coordinator.start(port: port, apiKey: "test-key")
                return port
            } catch {
                lastError = error
            }
        }
        throw lastError ?? AppError.network("Unable to allocate test proxy port")
    }

    private func sendResponsesRequest(
        port: UInt16,
        body: [String: Any]? = nil,
        headers: [String: String] = [:]
    ) async throws -> (statusCode: Int, headers: [String: String], body: [String: Any], rawData: Data) {
        try await sendJSONRequest(
            port: port,
            path: "/v1/responses",
            body: body ?? defaultResponsesBody(),
            headers: headers
        )
    }

    private func sendJSONRequest(
        port: UInt16,
        path: String,
        body: [String: Any],
        headers: [String: String] = [:]
    ) async throws -> (statusCode: Int, headers: [String: String], body: [String: Any], rawData: Data) {
        let url = URL(string: "http://127.0.0.1:\(port)\(path)")!
        let bodyData = try JSONSerialization.data(withJSONObject: body)

        var lastError: Error?
        for _ in 0..<10 {
            do {
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.httpBody = bodyData
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.setValue("Bearer test-key", forHTTPHeaderField: "Authorization")
                for (name, value) in headers {
                    request.setValue(value, forHTTPHeaderField: name)
                }
                let (data, response) = try await URLSession.shared.data(for: request)
                let http = response as? HTTPURLResponse
                let statusCode = http?.statusCode ?? 0
                let responseHeaders = normalizeHeaders(http?.allHeaderFields ?? [:])
                let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                return (statusCode, responseHeaders, object ?? [:], data)
            } catch {
                lastError = error
                try await Task.sleep(nanoseconds: 50_000_000)
            }
        }
        throw lastError ?? AppError.network("Proxy request failed")
    }

    private func sendGETRequest(
        port: UInt16,
        path: String,
        headers: [String: String] = [:]
    ) async throws -> (statusCode: Int, headers: [String: String], body: [String: Any], rawData: Data) {
        let url = URL(string: "http://127.0.0.1:\(port)\(path)")!
        var lastError: Error?
        for _ in 0..<10 {
            do {
                var request = URLRequest(url: url)
                request.httpMethod = "GET"
                request.setValue("Bearer test-key", forHTTPHeaderField: "Authorization")
                for (name, value) in headers {
                    request.setValue(value, forHTTPHeaderField: name)
                }
                let (data, response) = try await URLSession.shared.data(for: request)
                let http = response as? HTTPURLResponse
                let statusCode = http?.statusCode ?? 0
                let responseHeaders = normalizeHeaders(http?.allHeaderFields ?? [:])
                let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                return (statusCode, responseHeaders, object ?? [:], data)
            } catch {
                lastError = error
                try await Task.sleep(nanoseconds: 50_000_000)
            }
        }
        throw lastError ?? AppError.network("Proxy request failed")
    }

    private func defaultResponsesBody() -> [String: Any] {
        [
            "model": "gpt-5",
            "stream": false,
            "input": [
                [
                    "role": "user",
                    "content": [
                        ["type": "input_text", "text": "hello"]
                    ]
                ]
            ]
        ]
    }

    private func normalizeHeaders(_ headers: [AnyHashable: Any]) -> [String: String] {
        var normalized: [String: String] = [:]
        for (name, value) in headers {
            normalized[String(describing: name).lowercased()] = String(describing: value)
        }
        return normalized
    }
}

private struct ProxyTestContext {
    let coordinator: ProxyCoordinator
    let storeRepository: ProxyInMemoryAccountsStoreRepository
    let upstream: ProxyUpstreamStub
}

private final class ProxyInMemoryAccountsStoreRepository: AccountsStoreRepository, @unchecked Sendable {
    private var store: AccountsStore

    init(store: AccountsStore) {
        self.store = store
    }

    func loadStore() throws -> AccountsStore {
        store
    }

    func saveStore(_ store: AccountsStore) throws {
        self.store = store
    }
}

private actor ProxyUpstreamStub: CodexUpstreamClientProtocol {
    private var resultsByAccessToken: [String: [Result<CodexUpstreamResult, CodexUpstreamError>]]
    private var requests: [CodexUpstreamRequest] = []

    init(resultsByAccessToken: [String: [Result<CodexUpstreamResult, CodexUpstreamError>]]) {
        self.resultsByAccessToken = resultsByAccessToken
    }

    func execute(request: CodexUpstreamRequest) async throws -> CodexUpstreamResult {
        requests.append(request)
        var results = resultsByAccessToken[request.accessToken] ?? []
        guard !results.isEmpty else {
            throw CodexUpstreamError.httpError(statusCode: 500, body: Data("unexpected token".utf8))
        }
        let result = results.removeFirst()
        resultsByAccessToken[request.accessToken] = results
        return try result.get()
    }

    func requestedAccountIDs() -> [String] {
        requests.map(\.accountID)
    }

    func requestedAccessTokens() -> [String] {
        requests.map(\.accessToken)
    }

    func requestedRequests() -> [CodexUpstreamRequest] {
        requests
    }
}

private actor ProxyOAuthServiceStub: ChatGPTOAuthLoginServiceProtocol {
    private let refreshTokensResult: Result<ChatGPTOAuthTokens, Error>?
    private var refreshTokens: [String] = []

    init(refreshTokens: ChatGPTOAuthTokens? = nil) {
        self.refreshTokensResult = refreshTokens.map { .success($0) }
    }

    func signInWithChatGPT(timeoutSeconds: TimeInterval, allowedWorkspaceID: String?) async throws -> ChatGPTOAuthTokens {
        _ = timeoutSeconds
        _ = allowedWorkspaceID
        throw AppError.unauthorized("unexpected interactive sign-in")
    }

    func refreshChatGPTTokens(refreshToken: String) async throws -> ChatGPTOAuthTokens {
        refreshTokens.append(refreshToken)
        guard let refreshTokensResult else {
            throw AppError.unauthorized("unexpected token refresh")
        }
        return try refreshTokensResult.get()
    }

    func requestedRefreshTokens() -> [String] {
        refreshTokens
    }
}

private struct ProxyStaticDateProvider: DateProviding {
    let seconds: Int64

    func unixSecondsNow() -> Int64 {
        seconds
    }
}

private func makeAccount(
    id: String,
    label: String,
    accountID: String,
    accessToken: String,
    refreshToken: String = "refresh-token",
    email: String? = nil,
    principalID: String? = nil,
    planType: String = "pro",
    usage: UsageSnapshot,
    addedAt: Int64
) -> StoredAccount {
    let resolvedEmail = email ?? "\(id)@example.com"
    let resolvedPrincipalID = principalID ?? "user-\(id)"
    return StoredAccount(
        id: id,
        label: label,
        email: resolvedEmail,
        accountID: accountID,
        planType: planType,
        teamName: nil,
        teamAlias: nil,
        authJSON: makeAuth(
            accountID: accountID,
            accessToken: accessToken,
            refreshToken: refreshToken,
            email: resolvedEmail,
            principalID: resolvedPrincipalID,
            planType: planType
        ),
        addedAt: addedAt,
        updatedAt: addedAt,
        usage: usage,
        usageError: nil,
        principalID: resolvedPrincipalID
    )
}

private func makeAuth(
    accountID: String,
    accessToken: String,
    refreshToken: String,
    email: String,
    principalID: String,
    planType: String
) -> JSONValue {
    .object([
        "auth_mode": .string("chatgpt"),
        "tokens": .object([
            "access_token": .string(accessToken),
            "refresh_token": .string(refreshToken),
            "id_token": .string(makeIDToken(accountID: accountID, email: email, principalID: principalID, planType: planType)),
            "account_id": .string(accountID),
            "principal_id": .string(principalID)
        ])
    ])
}

private func usage(
    fiveHourUsed: Double = 10,
    oneWeekUsed: Double = 20,
    fiveHourResetAt: Int64? = nil,
    oneWeekResetAt: Int64? = nil
) -> UsageSnapshot {
    UsageSnapshot(
        fetchedAt: 1,
        planType: "pro",
        fiveHour: UsageWindow(usedPercent: fiveHourUsed, windowSeconds: 5 * 60 * 60, resetAt: fiveHourResetAt),
        oneWeek: UsageWindow(usedPercent: oneWeekUsed, windowSeconds: 7 * 24 * 60 * 60, resetAt: oneWeekResetAt),
        credits: nil
    )
}

private func responseStream(id: String, headers: [String: String] = [:]) -> CodexUpstreamResult {
    let response: [String: Any] = [
        "type": "response.completed",
        "response": [
            "id": id,
            "object": "response",
            "output": [] as [Any],
            "usage": ["input_tokens": 1, "output_tokens": 1]
        ] as [String: Any]
    ]
    return .stream(statusCode: 200, lines: stream(lines: [sseData(response)]), headers: headers)
}

private func errorStream(message: String, code: String) -> CodexUpstreamResult {
    let response: [String: Any] = [
        "type": "response.error",
        "error": [
            "message": message,
            "code": code,
            "type": code
        ]
    ]
    return .stream(statusCode: 200, lines: stream(lines: [sseData(response)]), headers: [:])
}

private func completeJSON(_ object: [String: Any], headers: [String: String] = [:]) -> CodexUpstreamResult {
    let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    return .complete(statusCode: 200, data: data, headers: headers)
}

private func stream(lines: [Data]) -> AsyncStream<Data> {
    AsyncStream { continuation in
        for line in lines {
            continuation.yield(line)
        }
        continuation.finish()
    }
}

private func sseData(_ object: [String: Any]) -> Data {
    let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    let text = String(data: data, encoding: .utf8)!
    return Data("data: \(text)\n\n".utf8)
}

private func makeIDToken(accountID: String, email: String, principalID: String, planType: String) -> String {
    let payload: [String: Any] = [
        "email": email,
        "sub": principalID,
        "https://api.openai.com/auth": [
            "chatgpt_account_id": accountID,
            "chatgpt_plan_type": planType,
            "chatgpt_user_id": principalID
        ]
    ]
    return makeJWT(payload: payload)
}

private func makeJWT(payload: [String: Any]) -> String {
    let header = ["alg": "none", "typ": "JWT"]
    return [
        base64URLEncoded(header),
        base64URLEncoded(payload),
        "signature"
    ].joined(separator: ".")
}

private func base64URLEncoded(_ object: [String: Any]) -> String {
    let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    return data
        .base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}
