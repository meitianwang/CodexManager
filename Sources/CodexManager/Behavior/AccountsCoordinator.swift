import Foundation

actor AccountsCoordinator {
    enum UsageRefreshPolicy {
        static let minimumRefreshIntervalSeconds: Int64 = 25

        static func shouldRefresh(_ snapshot: UsageSnapshot?, now: Int64) -> Bool {
            guard let snapshot else { return true }
            return now - snapshot.fetchedAt >= minimumRefreshIntervalSeconds
        }
    }

    let storeRepository: AccountsStoreRepository
    let settingsRepository: SettingsRepository
    let authRepository: AuthRepository
    let usageService: UsageService
    let workspaceMetadataService: WorkspaceMetadataService?
    let chatGPTOAuthLoginService: ChatGPTOAuthLoginServiceProtocol
    let codexCLIService: CodexCLIServiceProtocol
    let editorAppService: EditorAppServiceProtocol
    let dateProvider: DateProviding
    let runtimePlatform: RuntimePlatform

    init(
        storeRepository: AccountsStoreRepository,
        settingsRepository: SettingsRepository,
        authRepository: AuthRepository,
        usageService: UsageService,
        workspaceMetadataService: WorkspaceMetadataService? = nil,
        chatGPTOAuthLoginService: ChatGPTOAuthLoginServiceProtocol,
        codexCLIService: CodexCLIServiceProtocol,
        editorAppService: EditorAppServiceProtocol,
        dateProvider: DateProviding = SystemDateProvider(),
        runtimePlatform: RuntimePlatform = PlatformCapabilities.currentPlatform
    ) {
        self.storeRepository = storeRepository
        self.settingsRepository = settingsRepository
        self.authRepository = authRepository
        self.usageService = usageService
        self.workspaceMetadataService = workspaceMetadataService
        self.chatGPTOAuthLoginService = chatGPTOAuthLoginService
        self.codexCLIService = codexCLIService
        self.editorAppService = editorAppService
        self.dateProvider = dateProvider
        self.runtimePlatform = runtimePlatform
    }

    func deleteAccount(id: String) throws {
        var store = try storeRepository.loadStore()
        store.accounts.removeAll { $0.id == id }
        try storeRepository.saveStore(store)
    }

    func updateTeamAlias(id: String, alias: String?) throws -> AccountSummary {
        var store = try storeRepository.loadStore()
        guard let index = store.accounts.firstIndex(where: { $0.id == id }) else {
            throw AppError.invalidData(L10n.tr("error.accounts.account_not_found_for_update"))
        }

        store.accounts[index].teamAlias = normalizeTeamAlias(alias)
        store.accounts[index].updatedAt = dateProvider.unixSecondsNow()
        try storeRepository.saveStore(store)

        return toSummary(store.accounts[index], currentAccountKey: authRepository.currentAuthAccountKey())
    }

    func switchAccount(id: String) async throws {
        let account = try await prepareStoredAccountForSwitch(id: id)
        try updateCurrentAccountProjection(authJSON: account.authJSON)
    }

    func switchAccountAndApplySettings(id: String, workspacePath: String? = nil) async throws -> SwitchAccountExecutionResult {
        let account = try await prepareStoredAccountForSwitch(id: id)
        try updateCurrentAccountProjection(authJSON: account.authJSON)
        let settings = try settingsRepository.loadSettings()
        return try applySwitchSideEffects(
            for: account,
            settings: settings,
            workspacePath: workspacePath
        )
    }

    func smartSwitch() async throws -> (AccountSummary, SwitchAccountExecutionResult)? {
        let sorted = AccountRanking.sortByRemaining(try await listAccounts())
        guard let best = sorted.first else { return nil }
        let execution = try await switchAccountAndApplySettings(id: best.id)
        return (best, execution)
    }

    func autoSmartSwitchIfNeeded() async throws -> (AccountSummary, SwitchAccountExecutionResult)? {
        let accounts = try await listAccounts()
        guard let target = AccountRanking.pickAutoSwitchTarget(accounts) else {
            return nil
        }
        let execution = try await switchAccountAndApplySettings(id: target.id)
        return (target, execution)
    }

    private func prepareStoredAccountForSwitch(id: String) async throws -> StoredAccount {
        var store = try storeRepository.loadStore()
        if Self.reconcileCurrentAuthSnapshot(
            in: &store,
            authRepository: authRepository,
            now: dateProvider.unixSecondsNow()
        ) {
            try storeRepository.saveStore(store)
        }
        guard let account = store.accounts.first(where: { $0.id == id }) else {
            throw AppError.invalidData(L10n.tr("error.accounts.account_not_found_for_switch"))
        }

        guard accountNeedsCodexVisibleAuthRepair(account) else {
            return account
        }

        let repairedAccount = try await repairCodexVisibleAuth(for: account)
        var latestStore = try storeRepository.loadStore()
        guard let index = latestStore.accounts.firstIndex(where: { $0.id == id }) else {
            throw AppError.invalidData(L10n.tr("error.accounts.account_not_found_for_switch"))
        }

        latestStore.accounts[index] = mergePreparedAccount(
            repairedAccount,
            into: latestStore.accounts[index]
        )
        try storeRepository.saveStore(latestStore)
        return latestStore.accounts[index]
    }

    private func accountNeedsCodexVisibleAuthRepair(_ account: StoredAccount) -> Bool {
        AuthTokenPlanInspector.needsRepair(
            codexVisiblePlan: AuthTokenPlanInspector.codexVisiblePlan(in: account.authJSON),
            expectedPlan: expectedPlan(for: account)
        )
    }

    private func repairCodexVisibleAuth(for account: StoredAccount) async throws -> StoredAccount {
        if let refreshToken = AuthTokenPlanInspector.refreshToken(in: account.authJSON),
           let refreshed = try? await refreshStoredAccountAuth(account, refreshToken: refreshToken),
           !accountNeedsCodexVisibleAuthRepair(refreshed) {
            return refreshed
        }

        let tokens = try await chatGPTOAuthLoginService.signInWithChatGPT(
            timeoutSeconds: 10 * 60,
            allowedWorkspaceID: account.accountID
        )
        let reauthorized = try await storedAccount(account, replacingTokensWith: tokens)
        guard !accountNeedsCodexVisibleAuthRepair(reauthorized) else {
            throw AppError.unauthorized(
                L10n.tr(
                    "error.auth.codex_token_plan_mismatch_format",
                    expectedPlan(for: reauthorized) ?? "paid",
                    AuthTokenPlanInspector.codexVisiblePlan(in: reauthorized.authJSON) ?? "unknown"
                )
            )
        }
        return reauthorized
    }

    private func refreshStoredAccountAuth(
        _ account: StoredAccount,
        refreshToken: String
    ) async throws -> StoredAccount {
        let tokens = try await chatGPTOAuthLoginService.refreshChatGPTTokens(refreshToken: refreshToken)
        return try await storedAccount(account, replacingTokensWith: tokens)
    }

    private func storedAccount(
        _ account: StoredAccount,
        replacingTokensWith tokens: ChatGPTOAuthTokens
    ) async throws -> StoredAccount {
        let authJSON = try authRepository.replacingChatGPTTokens(in: account.authJSON, with: tokens)
        var extracted = try authRepository.extractAuth(from: authJSON)
        guard AccountIdentity.normalizedAccountID(extracted.accountID) == AccountIdentity.normalizedAccountID(account.accountID) else {
            throw AppError.unauthorized(
                L10n.tr("error.oauth.workspace_mismatch_format", account.accountID)
            )
        }

        if let remoteWorkspaceName = await resolveRemoteWorkspaceName(for: extracted, forceRemoteCheck: true) {
            extracted.teamName = remoteWorkspaceName
        }

        var usage: UsageSnapshot?
        var usageError: String?
        do {
            usage = try await usageService.fetchUsage(
                accessToken: extracted.accessToken,
                accountID: extracted.accountID
            )
        } catch {
            usageError = error.localizedDescription
        }

        var updated = account
        updated.email = extracted.email ?? account.email
        updated.accountID = extracted.accountID
        updated.planType = AccountPlanResolver.preferredPlanType(
            planType: extracted.planType,
            usagePlanType: usage?.planType,
            fallback: account.planType
        )
        if let teamName = Self.normalizedTeamName(extracted.teamName) {
            updated.teamName = teamName
        }
        updated.authJSON = authJSON
        updated.updatedAt = dateProvider.unixSecondsNow()
        updated.usage = usage ?? account.usage
        updated.usageError = usageError
        updated.principalID = extracted.principalID
        return updated
    }

    private func mergePreparedAccount(_ prepared: StoredAccount, into latest: StoredAccount) -> StoredAccount {
        var merged = latest
        merged.email = prepared.email
        merged.accountID = prepared.accountID
        merged.planType = prepared.planType
        merged.teamName = prepared.teamName ?? latest.teamName
        merged.authJSON = prepared.authJSON
        merged.updatedAt = prepared.updatedAt
        merged.usage = prepared.usage
        merged.usageError = prepared.usageError
        merged.principalID = prepared.principalID
        return merged
    }

    private func expectedPlan(for account: StoredAccount) -> String? {
        AccountPlanResolver.preferredPlanType(
            planType: account.planType,
            usagePlanType: account.usage?.planType
        )
    }

    private func updateCurrentAccountProjection(authJSON: JSONValue) throws {
        let extracted = try authRepository.extractAuth(from: authJSON)
        var store = try storeRepository.loadStore()
        guard let matchedAccount = Self.matchingStoredAccount(for: extracted, in: store.accounts) else {
            throw AppError.invalidData(L10n.tr("error.accounts.account_not_found_for_switch"))
        }

        store.currentSelection = CurrentAccountSelection(
            accountID: extracted.accountID,
            selectedAt: dateProvider.unixMillisecondsNow(),
            sourceDeviceID: runtimePlatform == .macOS ? "macos-local" : "ios-local",
            accountKey: matchedAccount.accountKey
        )
        try storeRepository.saveStore(store)

        guard runtimePlatform == .macOS else { return }
        try authRepository.writeCurrentAuth(authJSON)
    }

    private func normalizeTeamAlias(_ alias: String?) -> String? {
        guard let alias else { return nil }
        let trimmed = alias.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func applySwitchSideEffects(
        for account: StoredAccount,
        settings: AppSettings,
        workspacePath: String?
    ) throws -> SwitchAccountExecutionResult {
        var result = SwitchAccountExecutionResult.idle


        guard runtimePlatform == .macOS else {
            return result
        }

        if settings.restartEditorsOnSwitch {
            let restart = editorAppService.restartSelectedApps(settings.restartEditorTargets)
            result.restartedEditorApps = restart.restarted
            result.editorRestartError = restart.error
        }

        if settings.launchCodexAfterSwitch {
            result.usedFallbackCLI = try codexCLIService.launchApp(workspacePath: workspacePath)
        }

        return result
    }

    static func matchingStoredAccountIndex(
        for extracted: ExtractedAuth,
        in accounts: [StoredAccount]
    ) -> Int? {
        AccountIdentity.preferredMatchIndex(for: extracted, in: accounts)
    }

    static func matchingStoredAccount(
        for extracted: ExtractedAuth,
        in accounts: [StoredAccount]
    ) -> StoredAccount? {
        guard let index = matchingStoredAccountIndex(for: extracted, in: accounts) else {
            return nil
        }
        return accounts[index]
    }
}
