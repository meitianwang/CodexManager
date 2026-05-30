import XCTest
@testable import CodexManager

final class AccountsCoordinatorUsageRefreshTests: XCTestCase {
    func testRefreshUsageRefreshesExpiredAccessTokenAndRetries() async throws {
        let context = try makeCoordinatorContext(
            usage: UsageSnapshot(
                fetchedAt: 100,
                planType: "pro",
                fiveHour: UsageWindow(usedPercent: 12, windowSeconds: 18_000, resetAt: 200),
                oneWeek: UsageWindow(usedPercent: 34, windowSeconds: 604_800, resetAt: 300),
                credits: nil
            ),
            oauthService: OAuthRefreshServiceStub(
                refreshTokens: ChatGPTOAuthTokens(
                    accessToken: "new-access-token",
                    refreshToken: "new-refresh-token",
                    idToken: makeIDToken(planType: "pro"),
                    apiKey: "new-api-key"
                )
            )
        )

        let summaries = try await context.coordinator.refreshUsage(
            accountIDs: ["account-1"],
            force: true,
            serial: true
        )

        XCTAssertEqual(summaries.first?.usage, context.expectedUsage)
        XCTAssertNil(summaries.first?.usageError)
        let requestedAccessTokens = await context.usageService.requestedAccessTokens()
        let requestedRefreshTokens = await context.oauthService.requestedRefreshTokens()
        XCTAssertEqual(requestedAccessTokens, ["old-access-token", "new-access-token"])
        XCTAssertEqual(requestedRefreshTokens, ["old-refresh-token"])

        let savedAccount = try XCTUnwrap(context.storeRepository.loadStore().accounts.first)
        XCTAssertEqual(savedAccount.authJSON["tokens"]?["access_token"]?.stringValue, "new-access-token")
        XCTAssertEqual(savedAccount.authJSON["tokens"]?["refresh_token"]?.stringValue, "new-refresh-token")
        XCTAssertEqual(savedAccount.authJSON["OPENAI_API_KEY"]?.stringValue, "new-api-key")

        let currentAuth = try context.authRepository.readCurrentAuth()
        XCTAssertEqual(currentAuth["tokens"]?["access_token"]?.stringValue, "new-access-token")
        XCTAssertEqual(currentAuth["tokens"]?["refresh_token"]?.stringValue, "new-refresh-token")
    }

    func testRefreshUsageFallsBackToWorkspaceLoginWhenRefreshTokenWasAlreadyUsed() async throws {
        let context = try makeCoordinatorContext(
            usage: UsageSnapshot(
                fetchedAt: 200,
                planType: "pro",
                fiveHour: UsageWindow(usedPercent: 8, windowSeconds: 18_000, resetAt: 300),
                oneWeek: UsageWindow(usedPercent: 21, windowSeconds: 604_800, resetAt: 400),
                credits: nil
            ),
            oauthService: OAuthRefreshServiceStub(
                refreshError: AppError.network("Your refresh token has already been used to generate new tokens"),
                signInTokens: ChatGPTOAuthTokens(
                    accessToken: "reauth-access-token",
                    refreshToken: "reauth-refresh-token",
                    idToken: makeIDToken(planType: "pro"),
                    apiKey: "reauth-api-key"
                )
            ),
            refreshedAccessToken: "reauth-access-token"
        )

        let summaries = try await context.coordinator.refreshUsage(
            accountIDs: ["account-1"],
            force: true,
            serial: true,
            allowInteractiveAuthRepair: true
        )

        XCTAssertEqual(summaries.first?.usage, context.expectedUsage)
        XCTAssertNil(summaries.first?.usageError)
        let requestedAccessTokens = await context.usageService.requestedAccessTokens()
        let requestedRefreshTokens = await context.oauthService.requestedRefreshTokens()
        let signInWorkspaceIDs = await context.oauthService.requestedSignInWorkspaceIDs()
        XCTAssertEqual(requestedAccessTokens, ["old-access-token", "reauth-access-token"])
        XCTAssertEqual(requestedRefreshTokens, ["old-refresh-token"])
        XCTAssertEqual(signInWorkspaceIDs, ["workspace-1"])

        let savedAccount = try XCTUnwrap(context.storeRepository.loadStore().accounts.first)
        XCTAssertEqual(savedAccount.authJSON["tokens"]?["access_token"]?.stringValue, "reauth-access-token")
        XCTAssertEqual(savedAccount.authJSON["tokens"]?["refresh_token"]?.stringValue, "reauth-refresh-token")
        XCTAssertEqual(savedAccount.authJSON["OPENAI_API_KEY"]?.stringValue, "reauth-api-key")
    }

    func testRefreshUsageReconcilesCurrentCodexAuthBeforeUsingStoredRefreshToken() async throws {
        let context = try makeCoordinatorContext(
            usage: UsageSnapshot(
                fetchedAt: 300,
                planType: "pro",
                fiveHour: UsageWindow(usedPercent: 3, windowSeconds: 18_000, resetAt: 400),
                oneWeek: UsageWindow(usedPercent: 5, windowSeconds: 604_800, resetAt: 500),
                credits: nil
            ),
            oauthService: OAuthRefreshServiceStub(
                refreshTokens: ChatGPTOAuthTokens(
                    accessToken: "unused-access-token",
                    refreshToken: "unused-refresh-token",
                    idToken: makeIDToken(planType: "pro"),
                    apiKey: nil
                )
            ),
            refreshedAccessToken: "current-access-token"
        )
        let currentCodexAuth = makeAuth(
            accessToken: "current-access-token",
            refreshToken: "current-refresh-token"
        )
        try context.authRepository.writeCurrentAuth(currentCodexAuth)

        let summaries = try await context.coordinator.refreshUsage(
            accountIDs: ["account-1"],
            force: true,
            serial: true
        )

        XCTAssertEqual(summaries.first?.usage, context.expectedUsage)
        XCTAssertNil(summaries.first?.usageError)
        let requestedAccessTokens = await context.usageService.requestedAccessTokens()
        let requestedRefreshTokens = await context.oauthService.requestedRefreshTokens()
        XCTAssertEqual(requestedAccessTokens, ["current-access-token"])
        XCTAssertEqual(requestedRefreshTokens, [])

        let savedAccount = try XCTUnwrap(context.storeRepository.loadStore().accounts.first)
        XCTAssertEqual(savedAccount.updatedAt, 999)
        XCTAssertEqual(savedAccount.authJSON["tokens"]?["access_token"]?.stringValue, "current-access-token")
        XCTAssertEqual(savedAccount.authJSON["tokens"]?["refresh_token"]?.stringValue, "current-refresh-token")
    }

    func testSwitchAccountReconcilesCurrentCodexAuthBeforeWritingProjection() async throws {
        let context = try makeCoordinatorContext(
            usage: UsageSnapshot(
                fetchedAt: 400,
                planType: "pro",
                fiveHour: UsageWindow(usedPercent: 1, windowSeconds: 18_000, resetAt: 500),
                oneWeek: UsageWindow(usedPercent: 2, windowSeconds: 604_800, resetAt: 600),
                credits: nil
            ),
            oauthService: OAuthRefreshServiceStub(
                refreshTokens: ChatGPTOAuthTokens(
                    accessToken: "unused-access-token",
                    refreshToken: "unused-refresh-token",
                    idToken: makeIDToken(planType: "pro"),
                    apiKey: nil
                )
            )
        )
        let currentCodexAuth = makeAuth(
            accessToken: "current-access-token",
            refreshToken: "current-refresh-token"
        )
        try context.authRepository.writeCurrentAuth(currentCodexAuth)

        try await context.coordinator.switchAccount(id: "account-1")

        let currentAuth = try context.authRepository.readCurrentAuth()
        XCTAssertEqual(currentAuth["tokens"]?["access_token"]?.stringValue, "current-access-token")
        XCTAssertEqual(currentAuth["tokens"]?["refresh_token"]?.stringValue, "current-refresh-token")
        let savedAccount = try XCTUnwrap(context.storeRepository.loadStore().accounts.first)
        XCTAssertEqual(savedAccount.authJSON["tokens"]?["access_token"]?.stringValue, "current-access-token")
        XCTAssertEqual(savedAccount.authJSON["tokens"]?["refresh_token"]?.stringValue, "current-refresh-token")

        let requestedRefreshTokens = await context.oauthService.requestedRefreshTokens()
        XCTAssertEqual(requestedRefreshTokens, [])
    }

    func testRefreshTokenExchangeCoordinatorCoalescesConcurrentRequestsAndCachesResult() async throws {
        let tokens = ChatGPTOAuthTokens(
            accessToken: "new-access-token",
            refreshToken: "new-refresh-token",
            idToken: makeIDToken(planType: "pro"),
            apiKey: nil
        )
        let coordinator = ChatGPTRefreshTokenExchangeCoordinator(
            cacheTTL: 60,
            maxCachedExchanges: 4
        )
        let recorder = RefreshExchangeRecorder(tokens: tokens)

        async let first = coordinator.refresh(refreshToken: "old-refresh-token") {
            try await recorder.exchange()
        }
        async let second = coordinator.refresh(refreshToken: "old-refresh-token") {
            try await recorder.exchange()
        }
        let (firstTokens, secondTokens) = try await (first, second)

        XCTAssertEqual(firstTokens, tokens)
        XCTAssertEqual(secondTokens, tokens)
        let callCountAfterConcurrentRefresh = await recorder.callCount()
        XCTAssertEqual(callCountAfterConcurrentRefresh, 1)

        let cachedTokens = try await coordinator.refresh(refreshToken: "old-refresh-token") {
            throw AppError.network("cache miss")
        }

        XCTAssertEqual(cachedTokens, tokens)
        let callCountAfterCachedRefresh = await recorder.callCount()
        XCTAssertEqual(callCountAfterCachedRefresh, 1)
    }

    func testWarmUpResetWeeklyQuotaAccountsWarmsExpiredExhaustedWeeklyAccountsAndRefreshesUsage() async throws {
        let now: Int64 = 1_000
        let targetAuth = makeAuth(
            accessToken: "target-token",
            refreshToken: "target-refresh",
            accountID: "target-workspace",
            email: "target@example.com",
            principalID: "target-user"
        )
        let futureResetAuth = makeAuth(
            accessToken: "future-token",
            refreshToken: "future-refresh",
            accountID: "future-workspace",
            email: "future@example.com",
            principalID: "future-user"
        )
        let partialUsageAuth = makeAuth(
            accessToken: "partial-token",
            refreshToken: "partial-refresh",
            accountID: "partial-workspace",
            email: "partial@example.com",
            principalID: "partial-user"
        )
        let refreshedUsage = UsageSnapshot(
            fetchedAt: now,
            planType: "pro",
            fiveHour: UsageWindow(usedPercent: 1, windowSeconds: 18_000, resetAt: now + 18_000),
            oneWeek: UsageWindow(usedPercent: 1, windowSeconds: 604_800, resetAt: now + 604_800),
            credits: nil
        )
        let storeRepository = InMemoryAccountsStoreRepository(
            store: AccountsStore(accounts: [
                makeStoredAccount(
                    id: "target-account",
                    label: "Target",
                    accountID: "target-workspace",
                    authJSON: targetAuth,
                    usage: exhaustedWeeklyUsage(resetAt: now - 1)
                ),
                makeStoredAccount(
                    id: "future-account",
                    label: "Future",
                    accountID: "future-workspace",
                    authJSON: futureResetAuth,
                    usage: exhaustedWeeklyUsage(resetAt: now + 1)
                ),
                makeStoredAccount(
                    id: "partial-account",
                    label: "Partial",
                    accountID: "partial-workspace",
                    authJSON: partialUsageAuth,
                    usage: UsageSnapshot(
                        fetchedAt: now - 100,
                        planType: "pro",
                        fiveHour: nil,
                        oneWeek: UsageWindow(usedPercent: 50, windowSeconds: 604_800, resetAt: now - 1),
                        credits: nil
                    )
                )
            ])
        )
        let authRepository = try makeAuthRepository(currentAuth: targetAuth)
        let usageService = StaticUsageServiceStub(usageByAccountID: [
            "target-workspace": refreshedUsage
        ])
        let warmupService = RecordingWeeklyQuotaWarmupService()
        let coordinator = makeCoordinator(
            storeRepository: storeRepository,
            authRepository: authRepository,
            usageService: usageService,
            weeklyQuotaWarmupService: warmupService,
            now: now
        )

        let result = try await coordinator.warmUpResetWeeklyQuotaAccounts()

        XCTAssertEqual(result.targetCount, 1)
        XCTAssertEqual(result.succeededCount, 1)
        XCTAssertTrue(result.failures.isEmpty)
        let warmupRequests = await warmupService.requests()
        XCTAssertEqual(
            warmupRequests,
            [WarmupRequest(accessToken: "target-token", accountID: "target-workspace")]
        )
        let requestedAccountIDs = await usageService.requestedAccountIDs()
        XCTAssertEqual(requestedAccountIDs, ["target-workspace"])
        XCTAssertEqual(
            result.accounts.first(where: { $0.id == "target-account" })?.usage,
            refreshedUsage
        )
    }

    func testWarmUpResetWeeklyQuotaAccountsSkipsWhenNoExpiredExhaustedWeeklyAccounts() async throws {
        let now: Int64 = 1_000
        let auth = makeAuth(
            accessToken: "token",
            refreshToken: "refresh",
            accountID: "workspace",
            email: "account@example.com",
            principalID: "user"
        )
        let storeRepository = InMemoryAccountsStoreRepository(
            store: AccountsStore(accounts: [
                makeStoredAccount(
                    id: "account",
                    label: "Account",
                    accountID: "workspace",
                    authJSON: auth,
                    usage: exhaustedWeeklyUsage(resetAt: now + 60)
                )
            ])
        )
        let authRepository = try makeAuthRepository(currentAuth: auth)
        let usageService = StaticUsageServiceStub(usageByAccountID: [:])
        let warmupService = RecordingWeeklyQuotaWarmupService()
        let coordinator = makeCoordinator(
            storeRepository: storeRepository,
            authRepository: authRepository,
            usageService: usageService,
            weeklyQuotaWarmupService: warmupService,
            now: now
        )

        let result = try await coordinator.warmUpResetWeeklyQuotaAccounts()

        XCTAssertEqual(result.targetCount, 0)
        XCTAssertEqual(result.succeededCount, 0)
        XCTAssertTrue(result.failures.isEmpty)
        let warmupRequests = await warmupService.requests()
        let requestedAccountIDs = await usageService.requestedAccountIDs()
        XCTAssertTrue(warmupRequests.isEmpty)
        XCTAssertTrue(requestedAccountIDs.isEmpty)
    }

    func testWarmUpResetWeeklyQuotaAccountsStoresWarmupFailure() async throws {
        let now: Int64 = 1_000
        let auth = makeAuth(
            accessToken: "token",
            refreshToken: "refresh",
            accountID: "workspace",
            email: "account@example.com",
            principalID: "user"
        )
        let storeRepository = InMemoryAccountsStoreRepository(
            store: AccountsStore(accounts: [
                makeStoredAccount(
                    id: "account",
                    label: "Account",
                    accountID: "workspace",
                    authJSON: auth,
                    usage: exhaustedWeeklyUsage(resetAt: now - 1)
                )
            ])
        )
        let authRepository = try makeAuthRepository(currentAuth: auth)
        let usageService = StaticUsageServiceStub(usageByAccountID: [:])
        let warmupService = RecordingWeeklyQuotaWarmupService(
            failuresByAccountID: ["workspace": "warmup failed"]
        )
        let coordinator = makeCoordinator(
            storeRepository: storeRepository,
            authRepository: authRepository,
            usageService: usageService,
            weeklyQuotaWarmupService: warmupService,
            now: now
        )

        let result = try await coordinator.warmUpResetWeeklyQuotaAccounts()

        XCTAssertEqual(result.targetCount, 1)
        XCTAssertEqual(result.succeededCount, 0)
        XCTAssertEqual(result.failures.map(\.accountID), ["account"])
        XCTAssertEqual(result.failures.first?.message, "warmup failed")
        XCTAssertEqual(try storeRepository.loadStore().accounts.first?.usageError, "warmup failed")
        let requestedAccountIDs = await usageService.requestedAccountIDs()
        XCTAssertTrue(requestedAccountIDs.isEmpty)
    }

    private func makeCoordinatorContext(
        usage expectedUsage: UsageSnapshot,
        oauthService: OAuthRefreshServiceStub,
        refreshedAccessToken: String = "new-access-token"
    ) throws -> CoordinatorContext {
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
        let oldAuth = makeAuth(accessToken: "old-access-token", refreshToken: "old-refresh-token")
        try authRepository.writeCurrentAuth(oldAuth)

        let storeRepository = InMemoryAccountsStoreRepository(
            store: AccountsStore(
                accounts: [
                    StoredAccount(
                        id: "account-1",
                        label: "Pro Account",
                        email: "pro@example.com",
                        accountID: "workspace-1",
                        planType: "pro",
                        teamName: nil,
                        teamAlias: nil,
                        authJSON: oldAuth,
                        addedAt: 1,
                        updatedAt: 1,
                        usage: nil,
                        usageError: nil,
                        principalID: "user-1"
                    )
                ]
            )
        )
        let usageService = RefreshingUsageServiceStub(
            expiredAccessToken: "old-access-token",
            refreshedAccessToken: refreshedAccessToken,
            usage: expectedUsage
        )
        let coordinator = AccountsCoordinator(
            storeRepository: storeRepository,
            settingsRepository: StaticSettingsRepository(),
            authRepository: authRepository,
            usageService: usageService,
            chatGPTOAuthLoginService: oauthService,
            codexCLIService: IdleCodexCLIService(),
            editorAppService: EmptyEditorAppService(),
            dateProvider: StaticDateProvider(seconds: 999),
            runtimePlatform: .macOS
        )

        return CoordinatorContext(
            coordinator: coordinator,
            storeRepository: storeRepository,
            authRepository: authRepository,
            usageService: usageService,
            oauthService: oauthService,
            expectedUsage: expectedUsage
        )
    }

    private func makeCoordinator(
        storeRepository: InMemoryAccountsStoreRepository,
        authRepository: AuthFileRepository,
        usageService: UsageService,
        weeklyQuotaWarmupService: WeeklyQuotaWarmupService?,
        now: Int64
    ) -> AccountsCoordinator {
        AccountsCoordinator(
            storeRepository: storeRepository,
            settingsRepository: StaticSettingsRepository(),
            authRepository: authRepository,
            usageService: usageService,
            weeklyQuotaWarmupService: weeklyQuotaWarmupService,
            chatGPTOAuthLoginService: OAuthRefreshServiceStub(
                refreshTokens: ChatGPTOAuthTokens(
                    accessToken: "unused",
                    refreshToken: "unused",
                    idToken: makeIDToken(planType: "pro"),
                    apiKey: nil
                )
            ),
            codexCLIService: IdleCodexCLIService(),
            editorAppService: EmptyEditorAppService(),
            dateProvider: StaticDateProvider(seconds: now),
            runtimePlatform: .macOS
        )
    }

    private func makeAuthRepository(currentAuth: JSONValue) throws -> AuthFileRepository {
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
        try authRepository.writeCurrentAuth(currentAuth)
        return authRepository
    }

    private func makeStoredAccount(
        id: String,
        label: String,
        accountID: String,
        authJSON: JSONValue,
        usage: UsageSnapshot?
    ) -> StoredAccount {
        StoredAccount(
            id: id,
            label: label,
            email: "\(accountID)@example.com",
            accountID: accountID,
            planType: "pro",
            teamName: nil,
            teamAlias: nil,
            authJSON: authJSON,
            addedAt: 1,
            updatedAt: 1,
            usage: usage,
            usageError: nil,
            principalID: "\(accountID)-user"
        )
    }

    private func exhaustedWeeklyUsage(resetAt: Int64) -> UsageSnapshot {
        UsageSnapshot(
            fetchedAt: resetAt - 100,
            planType: "pro",
            fiveHour: UsageWindow(usedPercent: 0, windowSeconds: 18_000, resetAt: resetAt + 18_000),
            oneWeek: UsageWindow(usedPercent: 100, windowSeconds: 604_800, resetAt: resetAt),
            credits: nil
        )
    }

    private func makeAuth(
        accessToken: String,
        refreshToken: String,
        accountID: String = "workspace-1",
        email: String = "pro@example.com",
        principalID: String = "user-1"
    ) -> JSONValue {
        .object([
            "auth_mode": .string("chatgpt"),
            "tokens": .object([
                "access_token": .string(accessToken),
                "refresh_token": .string(refreshToken),
                "id_token": .string(
                    makeIDToken(
                        planType: "pro",
                        accountID: accountID,
                        email: email,
                        principalID: principalID
                    )
                ),
                "account_id": .string(accountID),
                "principal_id": .string(principalID)
            ])
        ])
    }

    private func makeIDToken(
        planType: String,
        accountID: String = "workspace-1",
        email: String = "pro@example.com",
        principalID: String = "user-1"
    ) -> String {
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
}

private struct CoordinatorContext {
    let coordinator: AccountsCoordinator
    let storeRepository: InMemoryAccountsStoreRepository
    let authRepository: AuthFileRepository
    let usageService: RefreshingUsageServiceStub
    let oauthService: OAuthRefreshServiceStub
    let expectedUsage: UsageSnapshot
}

private final class InMemoryAccountsStoreRepository: AccountsStoreRepository, @unchecked Sendable {
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

private struct StaticSettingsRepository: SettingsRepository {
    func loadSettings() throws -> AppSettings {
        .defaultValue
    }

    func saveSettings(_ settings: AppSettings) throws {
        _ = settings
    }
}

private actor RefreshingUsageServiceStub: UsageService {
    private let expiredAccessToken: String
    private let refreshedAccessToken: String
    private let usage: UsageSnapshot
    private var accessTokens: [String] = []

    init(expiredAccessToken: String, refreshedAccessToken: String, usage: UsageSnapshot) {
        self.expiredAccessToken = expiredAccessToken
        self.refreshedAccessToken = refreshedAccessToken
        self.usage = usage
    }

    func fetchUsage(accessToken: String, accountID: String) async throws -> UsageSnapshot {
        _ = accountID
        accessTokens.append(accessToken)
        if accessToken == expiredAccessToken {
            throw AppError.unauthorized("401")
        }
        guard accessToken == refreshedAccessToken else {
            throw AppError.network("unexpected access token")
        }
        return usage
    }

    func requestedAccessTokens() -> [String] {
        accessTokens
    }
}

private actor StaticUsageServiceStub: UsageService {
    private let usageByAccountID: [String: UsageSnapshot]
    private var accountIDs: [String] = []

    init(usageByAccountID: [String: UsageSnapshot]) {
        self.usageByAccountID = usageByAccountID
    }

    func fetchUsage(accessToken: String, accountID: String) async throws -> UsageSnapshot {
        _ = accessToken
        accountIDs.append(accountID)
        guard let usage = usageByAccountID[accountID] else {
            throw AppError.network("unexpected account")
        }
        return usage
    }

    func requestedAccountIDs() -> [String] {
        accountIDs
    }
}

private struct WarmupRequest: Equatable, Sendable {
    var accessToken: String
    var accountID: String
}

private actor RecordingWeeklyQuotaWarmupService: WeeklyQuotaWarmupService {
    private let failuresByAccountID: [String: String]
    private var recordedRequests: [WarmupRequest] = []

    init(failuresByAccountID: [String: String] = [:]) {
        self.failuresByAccountID = failuresByAccountID
    }

    func warmUp(accessToken: String, accountID: String) async throws {
        recordedRequests.append(WarmupRequest(accessToken: accessToken, accountID: accountID))
        if let message = failuresByAccountID[accountID] {
            throw AppError.network(message)
        }
    }

    func requests() -> [WarmupRequest] {
        recordedRequests
    }
}

private actor RefreshExchangeRecorder {
    private let tokens: ChatGPTOAuthTokens
    private var count = 0

    init(tokens: ChatGPTOAuthTokens) {
        self.tokens = tokens
    }

    func exchange() async throws -> ChatGPTOAuthTokens {
        count += 1
        try await Task.sleep(for: .milliseconds(50))
        return tokens
    }

    func callCount() -> Int {
        count
    }
}

private actor OAuthRefreshServiceStub: ChatGPTOAuthLoginServiceProtocol {
    private let refreshTokensResult: Result<ChatGPTOAuthTokens, Error>
    private let signInTokens: ChatGPTOAuthTokens?
    private var refreshTokens: [String] = []
    private var signInWorkspaceIDs: [String] = []

    init(refreshTokens: ChatGPTOAuthTokens) {
        self.refreshTokensResult = .success(refreshTokens)
        self.signInTokens = nil
    }

    init(refreshError: Error, signInTokens: ChatGPTOAuthTokens) {
        self.refreshTokensResult = .failure(refreshError)
        self.signInTokens = signInTokens
    }

    func signInWithChatGPT(timeoutSeconds: TimeInterval, allowedWorkspaceID: String?) async throws -> ChatGPTOAuthTokens {
        _ = timeoutSeconds
        signInWorkspaceIDs.append(allowedWorkspaceID ?? "")
        guard let signInTokens else {
            throw AppError.unauthorized("unexpected interactive login")
        }
        return signInTokens
    }

    func refreshChatGPTTokens(refreshToken: String) async throws -> ChatGPTOAuthTokens {
        refreshTokens.append(refreshToken)
        return try refreshTokensResult.get()
    }

    func requestedRefreshTokens() -> [String] {
        refreshTokens
    }

    func requestedSignInWorkspaceIDs() -> [String] {
        signInWorkspaceIDs
    }
}

private struct IdleCodexCLIService: CodexCLIServiceProtocol {
    func launchApp(workspacePath: String?) throws -> Bool {
        _ = workspacePath
        return false
    }
}

private struct EmptyEditorAppService: EditorAppServiceProtocol {
    func listInstalledApps() -> [InstalledEditorApp] {
        []
    }

    func restartSelectedApps(_ targets: [EditorAppID]) -> (restarted: [EditorAppID], error: String?) {
        _ = targets
        return ([], nil)
    }
}

private struct StaticDateProvider: DateProviding {
    let seconds: Int64

    func unixSecondsNow() -> Int64 {
        seconds
    }
}
