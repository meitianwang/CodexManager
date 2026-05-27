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

    private func sendResponsesRequest(port: UInt16) async throws -> (statusCode: Int, body: [String: Any]) {
        let url = URL(string: "http://127.0.0.1:\(port)/v1/responses")!
        let body: [String: Any] = [
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
        let bodyData = try JSONSerialization.data(withJSONObject: body)

        var lastError: Error?
        for _ in 0..<10 {
            do {
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.httpBody = bodyData
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.setValue("Bearer test-key", forHTTPHeaderField: "Authorization")
                let (data, response) = try await URLSession.shared.data(for: request)
                let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
                let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                return (statusCode, object ?? [:])
            } catch {
                lastError = error
                try await Task.sleep(nanoseconds: 50_000_000)
            }
        }
        throw lastError ?? AppError.network("Proxy request failed")
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

private func responseStream(id: String) -> CodexUpstreamResult {
    let response: [String: Any] = [
        "type": "response.completed",
        "response": [
            "id": id,
            "object": "response",
            "output": [] as [Any],
            "usage": ["input_tokens": 1, "output_tokens": 1]
        ] as [String: Any]
    ]
    return .stream(statusCode: 200, lines: stream(lines: [sseData(response)]), headers: [:])
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
