import Foundation

extension AccountsCoordinator {
    func listAccounts() async throws -> [AccountSummary] {
        var store = try storeRepository.loadStore()
        let didReconcileCurrentAuth = Self.reconcileCurrentAuthSnapshot(
            in: &store,
            authRepository: authRepository,
            now: dateProvider.unixSecondsNow()
        )
        let didReconcile = Self.reconcileStoredAccountMetadata(in: &store, authRepository: authRepository)
        let didEnrich = await enrichStoredWorkspaceMetadataIfNeeded(in: &store, forceRemoteCheck: false)
        if didReconcileCurrentAuth || didReconcile || didEnrich {
            try storeRepository.saveStore(store)
        }
        return store.accountSummaries(currentAccountKey: authRepository.currentAuthAccountKey())
    }

    @discardableResult
    func importCurrentAuthAccount(customLabel: String?) async throws -> AccountSummary {
        let authJSON = try authRepository.readCurrentAuth()
        return try await importAccount(authJSON: authJSON, customLabel: customLabel)
    }

    @discardableResult
    func importAccountFile(from url: URL, customLabel: String?, setAsCurrent: Bool) async throws -> AccountSummary {
        let didAccess = url.startAccessingSecurityScopedResource()
        defer {
            if didAccess {
                url.stopAccessingSecurityScopedResource()
            }
        }

        let authJSON = try authRepository.readAuth(from: url)
        if setAsCurrent, runtimePlatform == .macOS {
            try authRepository.writeCurrentAuth(authJSON)
        }
        return try await importAccount(authJSON: authJSON, customLabel: customLabel)
    }

    @discardableResult
    func addAccountViaLogin(customLabel: String?, timeoutSeconds: TimeInterval = 10 * 60) async throws -> AccountSummary {
        let tokens = try await chatGPTOAuthLoginService.signInWithChatGPT(timeoutSeconds: timeoutSeconds)
        let authJSON = try authRepository.makeChatGPTAuth(from: tokens)
        return try await importAccount(authJSON: authJSON, customLabel: customLabel)
    }

    func refreshUsage(
        accountIDs: [String]? = nil,
        force: Bool = false,
        serial: Bool = false,
        allowInteractiveAuthRepair: Bool = false,
        onPartialUpdate: (@Sendable ([AccountSummary]) async -> Void)? = nil
    ) async throws -> [AccountSummary] {
        let now = dateProvider.unixSecondsNow()
        var snapshot = try storeRepository.loadStore()
        let authRepository = self.authRepository
        let usageService = self.usageService
        let chatGPTOAuthLoginService = self.chatGPTOAuthLoginService
        if Self.reconcileCurrentAuthSnapshot(in: &snapshot, authRepository: authRepository, now: now) {
            try storeRepository.saveStore(snapshot)
        }
        let currentAccountKey = authRepository.currentAuthAccountKey()
        let targetIDSet = accountIDs.map(Set.init)
        let refreshTargets = snapshot.accounts.filter { account in
            guard let targetIDSet else { return true }
            return targetIDSet.contains(account.id)
        }

        guard !refreshTargets.isEmpty else {
            return snapshot.accountSummaries(currentAccountKey: authRepository.currentAuthAccountKey())
        }

        var latest = snapshot
        if serial {
            for account in refreshTargets {
                let refreshed = await Self.refreshAccount(
                    account,
                    now: now,
                    forceRefresh: force,
                    allowInteractiveAuthRepair: allowInteractiveAuthRepair,
                    currentAccountKey: currentAccountKey,
                    authRepository: authRepository,
                    usageService: usageService,
                    chatGPTOAuthLoginService: chatGPTOAuthLoginService
                )
                latest = Self.mergeRefreshedAccount(refreshed, into: latest)
                try storeRepository.saveStore(latest)
                if let onPartialUpdate {
                    await onPartialUpdate(
                        latest.accountSummaries(currentAccountKey: authRepository.currentAuthAccountKey())
                    )
                }
            }
        } else {
            try await withThrowingTaskGroup(of: StoredAccount.self, returning: Void.self) { group in
                for account in refreshTargets {
                    group.addTask {
                        await Self.refreshAccount(
                            account,
                            now: now,
                            forceRefresh: force,
                            allowInteractiveAuthRepair: allowInteractiveAuthRepair,
                            currentAccountKey: currentAccountKey,
                            authRepository: authRepository,
                            usageService: usageService,
                            chatGPTOAuthLoginService: chatGPTOAuthLoginService
                        )
                    }
                }
                for try await refreshed in group {
                    latest = Self.mergeRefreshedAccount(refreshed, into: latest)
                    try storeRepository.saveStore(latest)
                    if let onPartialUpdate {
                        await onPartialUpdate(
                            latest.accountSummaries(currentAccountKey: authRepository.currentAuthAccountKey())
                        )
                    }
                }
            }
        }

        return latest.accountSummaries(currentAccountKey: authRepository.currentAuthAccountKey())
    }

    func warmUpResetWeeklyQuotaAccounts(
        onPartialUpdate: (@Sendable ([AccountSummary]) async -> Void)? = nil
    ) async throws -> WeeklyQuotaWarmupResult {
        let now = dateProvider.unixSecondsNow()
        var snapshot = try storeRepository.loadStore()
        let authRepository = self.authRepository

        if Self.reconcileCurrentAuthSnapshot(in: &snapshot, authRepository: authRepository, now: now) {
            try storeRepository.saveStore(snapshot)
        }

        let currentAccountKey = authRepository.currentAuthAccountKey()
        let targets = snapshot.accounts.filter {
            Self.shouldWarmUpResetWeeklyQuota($0, now: now)
        }

        guard !targets.isEmpty else {
            return WeeklyQuotaWarmupResult(
                accounts: snapshot.accountSummaries(currentAccountKey: currentAccountKey),
                targetCount: 0,
                succeededCount: 0,
                failures: []
            )
        }

        guard let weeklyQuotaWarmupService else {
            throw AppError.invalidData(L10n.tr("error.accounts.weekly_quota_warmup_unavailable"))
        }

        var latest = snapshot
        var succeededIDs: [String] = []
        var failures: [WeeklyQuotaWarmupFailure] = []

        for target in targets {
            let activeAccount = latest.accounts.first(where: { $0.id == target.id }) ?? target
            do {
                let extracted = try authRepository.extractAuth(from: activeAccount.authJSON)
                try await weeklyQuotaWarmupService.warmUp(
                    accessToken: extracted.accessToken,
                    accountID: extracted.accountID
                )
                succeededIDs.append(activeAccount.id)
            } catch {
                let message = error.localizedDescription
                failures.append(
                    WeeklyQuotaWarmupFailure(
                        accountID: activeAccount.id,
                        label: activeAccount.label,
                        message: message
                    )
                )
                latest = Self.updateWarmupFailure(
                    accountID: activeAccount.id,
                    message: message,
                    now: dateProvider.unixSecondsNow(),
                    in: latest
                )
                try storeRepository.saveStore(latest)
                if let onPartialUpdate {
                    await onPartialUpdate(
                        latest.accountSummaries(currentAccountKey: authRepository.currentAuthAccountKey())
                    )
                }
            }
        }

        let accounts: [AccountSummary]
        if succeededIDs.isEmpty {
            accounts = latest.accountSummaries(currentAccountKey: authRepository.currentAuthAccountKey())
        } else {
            accounts = try await refreshUsage(
                accountIDs: succeededIDs,
                force: true,
                serial: true,
                allowInteractiveAuthRepair: true,
                onPartialUpdate: onPartialUpdate
            )
        }

        return WeeklyQuotaWarmupResult(
            accounts: accounts,
            targetCount: targets.count,
            succeededCount: succeededIDs.count,
            failures: failures
        )
    }

    func refreshWorkspaceMetadata(forceRemoteCheck: Bool) async throws -> [AccountSummary] {
        var store = try storeRepository.loadStore()
        let didChange = await enrichStoredWorkspaceMetadataIfNeeded(
            in: &store,
            forceRemoteCheck: forceRemoteCheck
        )
        if didChange {
            try storeRepository.saveStore(store)
        }
        return store.accountSummaries(currentAccountKey: authRepository.currentAuthAccountKey())
    }

    private func importAccount(authJSON: JSONValue, customLabel: String?) async throws -> AccountSummary {
        var extracted = try authRepository.extractAuth(from: authJSON)
        if let remoteWorkspaceName = await resolveRemoteWorkspaceName(for: extracted, forceRemoteCheck: true) {
            extracted.teamName = remoteWorkspaceName
        }

        var usage: UsageSnapshot?
        var usageError: String?

        do {
            usage = try await usageService.fetchUsage(accessToken: extracted.accessToken, accountID: extracted.accountID)
        } catch {
            usageError = error.localizedDescription
        }

        let now = dateProvider.unixSecondsNow()
        let generatedLabel = customLabel?.trimmingCharacters(in: .whitespacesAndNewlines)
        let label = generatedLabel?.isEmpty == false
            ? generatedLabel!
            : (extracted.email ?? "Codex \(String(extracted.accountID.prefix(8)))")

        var store = try storeRepository.loadStore()
        let account = StoredAccount(
            id: UUID().uuidString,
            label: label,
            email: extracted.email,
            accountID: extracted.accountID,
            planType: AccountPlanResolver.preferredPlanType(
                planType: extracted.planType,
                usagePlanType: usage?.planType
            ),
            teamName: extracted.teamName,
            teamAlias: nil,
            authJSON: authJSON,
            addedAt: now,
            updatedAt: now,
            usage: usage,
            usageError: usageError,
            principalID: extracted.principalID
        )

        if let existingIndex = Self.matchingStoredAccountIndex(for: extracted, in: store.accounts) {
            var existing = store.accounts[existingIndex]
            existing.label = account.label
            existing.email = account.email
            if let teamName = Self.normalizedTeamName(account.teamName) {
                existing.teamName = teamName
            }
            existing.authJSON = account.authJSON
            existing.updatedAt = now
            existing.usage = usage ?? existing.usage
            existing.planType = AccountPlanResolver.preferredPlanType(
                planType: extracted.planType,
                usagePlanType: existing.usage?.planType,
                fallback: existing.planType
            )
            existing.usageError = usageError
            existing.principalID = extracted.principalID
            store.accounts[existingIndex] = existing
        } else {
            store.accounts.append(account)
        }

        try storeRepository.saveStore(store)
        let savedAccount = Self.matchingStoredAccount(for: extracted, in: store.accounts)!
        return toSummary(savedAccount, currentAccountKey: authRepository.currentAuthAccountKey())
    }

    func toSummary(_ account: StoredAccount, currentAccountKey: String?) -> AccountSummary {
        AccountsStore(accounts: [account]).accountSummaries(currentAccountKey: currentAccountKey)[0]
    }

    func resolveRemoteWorkspaceName(
        for extracted: ExtractedAuth,
        forceRemoteCheck: Bool
    ) async -> String? {
        guard let workspaceMetadataService else { return nil }
        guard shouldLookupRemoteWorkspaceName(
            storedTeamName: extracted.teamName,
            extracted: extracted,
            forceRemoteCheck: forceRemoteCheck
        ) else {
            return extracted.teamName
        }
        guard let directory = try? await workspaceMetadataService.fetchWorkspaceMetadata(
            accessToken: extracted.accessToken
        ) else {
            return extracted.teamName
        }
        return Self.remoteWorkspaceName(for: extracted.accountID, in: directory) ?? extracted.teamName
    }

    private func enrichStoredWorkspaceMetadataIfNeeded(
        in store: inout AccountsStore,
        forceRemoteCheck: Bool
    ) async -> Bool {
        guard let workspaceMetadataService else { return false }

        var didChange = false
        var cachedDirectories: [String: [WorkspaceMetadata]] = [:]

        for index in store.accounts.indices {
            let storedAccount = store.accounts[index]
            guard let extracted = try? authRepository.extractAuth(from: storedAccount.authJSON) else { continue }
            guard shouldLookupRemoteWorkspaceName(
                storedTeamName: storedAccount.teamName,
                extracted: extracted,
                forceRemoteCheck: forceRemoteCheck
            ) else { continue }

            let directory: [WorkspaceMetadata]
            if let cached = cachedDirectories[extracted.accessToken] {
                directory = cached
            } else {
                guard let fetched = try? await workspaceMetadataService.fetchWorkspaceMetadata(
                    accessToken: extracted.accessToken
                ) else { continue }
                cachedDirectories[extracted.accessToken] = fetched
                directory = fetched
            }

            guard let remoteWorkspaceName = Self.remoteWorkspaceName(
                for: extracted.accountID,
                in: directory
            ) else { continue }

            if store.accounts[index].teamName != remoteWorkspaceName {
                store.accounts[index].teamName = remoteWorkspaceName
                didChange = true
            }
        }

        return didChange
    }

    private func shouldLookupRemoteWorkspaceName(
        storedTeamName: String?,
        extracted: ExtractedAuth,
        forceRemoteCheck: Bool
    ) -> Bool {
        let normalizedPlan = (extracted.planType ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard normalizedPlan == "team" || normalizedPlan == "business" || normalizedPlan == "enterprise" else {
            return false
        }
        return forceRemoteCheck || Self.normalizedTeamName(storedTeamName) == nil
    }

    private static func refreshAccount(
        _ account: StoredAccount,
        now: Int64,
        forceRefresh: Bool,
        allowInteractiveAuthRepair: Bool,
        currentAccountKey: String?,
        authRepository: AuthRepository,
        usageService: UsageService,
        chatGPTOAuthLoginService: ChatGPTOAuthLoginServiceProtocol
    ) async -> StoredAccount {
        var account = account
        guard forceRefresh || UsageRefreshPolicy.shouldRefresh(account.usage, now: now) else {
            return account
        }

        do {
            let extracted = try authRepository.extractAuth(from: account.authJSON)
            let usage = try await usageService.fetchUsage(
                accessToken: extracted.accessToken,
                accountID: extracted.accountID
            )
            account.usage = usage
            account.usageError = nil
            account.planType = AccountPlanResolver.preferredPlanType(
                planType: extracted.planType,
                usagePlanType: usage.planType,
                fallback: account.planType
            )
            if let teamName = normalizedTeamName(extracted.teamName) {
                account.teamName = teamName
            }
            account.email = extracted.email ?? account.email
            account.principalID = extracted.principalID
        } catch {
            if Self.isUnauthorizedUsageError(error) {
                return await Self.refreshAccountAuthAndRetryUsage(
                    account,
                    now: now,
                    allowInteractiveAuthRepair: allowInteractiveAuthRepair,
                    currentAccountKey: currentAccountKey,
                    originalError: error,
                    authRepository: authRepository,
                    usageService: usageService,
                    chatGPTOAuthLoginService: chatGPTOAuthLoginService
                )
            }
            account.usageError = error.localizedDescription
        }

        account.updatedAt = now
        return account
    }

    private static func refreshAccountAuthAndRetryUsage(
        _ account: StoredAccount,
        now: Int64,
        allowInteractiveAuthRepair: Bool,
        currentAccountKey: String?,
        originalError: Error,
        authRepository: AuthRepository,
        usageService: UsageService,
        chatGPTOAuthLoginService: ChatGPTOAuthLoginServiceProtocol
    ) async -> StoredAccount {
        var account = account
        let wasCurrentAccount = accountMatchesCurrentAuth(account, currentAccountKey: currentAccountKey)

        do {
            let tokens = try await repairedTokens(
                for: account,
                originalError: originalError,
                allowInteractiveAuthRepair: allowInteractiveAuthRepair,
                chatGPTOAuthLoginService: chatGPTOAuthLoginService
            )
            let authJSON = try authRepository.replacingChatGPTTokens(in: account.authJSON, with: tokens)
            let extracted = try authRepository.extractAuth(from: authJSON)
            guard AccountIdentity.normalizedAccountID(extracted.accountID) == AccountIdentity.normalizedAccountID(account.accountID) else {
                throw AppError.unauthorized(L10n.tr("error.oauth.workspace_mismatch_format", account.accountID))
            }

            account.authJSON = authJSON
            account.accountID = extracted.accountID
            account.email = extracted.email ?? account.email
            account.principalID = extracted.principalID
            if let teamName = normalizedTeamName(extracted.teamName) {
                account.teamName = teamName
            }

            do {
                let usage = try await usageService.fetchUsage(
                    accessToken: extracted.accessToken,
                    accountID: extracted.accountID
                )
                account.usage = usage
                account.usageError = nil
                account.planType = AccountPlanResolver.preferredPlanType(
                    planType: extracted.planType,
                    usagePlanType: usage.planType,
                    fallback: account.planType
                )
            } catch {
                account.usageError = error.localizedDescription
                account.planType = AccountPlanResolver.preferredPlanType(
                    planType: extracted.planType,
                    usagePlanType: account.usage?.planType,
                    fallback: account.planType
                )
            }

            if wasCurrentAccount || accountMatchesCurrentAuth(account, currentAccountKey: currentAccountKey) {
                try authRepository.writeCurrentAuth(authJSON)
            }
        } catch {
            account.usageError = error.localizedDescription
        }

        account.updatedAt = now
        return account
    }

    private static func repairedTokens(
        for account: StoredAccount,
        originalError: Error,
        allowInteractiveAuthRepair: Bool,
        chatGPTOAuthLoginService: ChatGPTOAuthLoginServiceProtocol
    ) async throws -> ChatGPTOAuthTokens {
        if let refreshToken = AuthTokenPlanInspector.refreshToken(in: account.authJSON) {
            do {
                return try await chatGPTOAuthLoginService.refreshChatGPTTokens(refreshToken: refreshToken)
            } catch {
                guard allowInteractiveAuthRepair else {
                    throw error
                }
            }
        } else if !allowInteractiveAuthRepair {
            throw originalError
        }

        return try await chatGPTOAuthLoginService.signInWithChatGPT(
            timeoutSeconds: 10 * 60,
            allowedWorkspaceID: account.accountID
        )
    }

    private static func isUnauthorizedUsageError(_ error: Error) -> Bool {
        guard case AppError.unauthorized = error else { return false }
        return true
    }

    private static func accountMatchesCurrentAuth(_ account: StoredAccount, currentAccountKey: String?) -> Bool {
        guard let currentAccountKey = AccountIdentity.normalizedSelectionKey(currentAccountKey) else {
            return false
        }
        return account.accountKey == currentAccountKey
    }

    private static func shouldWarmUpResetWeeklyQuota(_ account: StoredAccount, now: Int64) -> Bool {
        guard let window = account.usage?.oneWeek,
              window.usedPercent >= 100,
              let resetAt = window.resetAt else {
            return false
        }
        return resetAt <= now
    }

    private static func updateWarmupFailure(
        accountID: String,
        message: String,
        now: Int64,
        in store: AccountsStore
    ) -> AccountsStore {
        var store = store
        guard let index = store.accounts.firstIndex(where: { $0.id == accountID }) else {
            return store
        }
        store.accounts[index].usageError = message
        store.accounts[index].updatedAt = now
        return store
    }

    private static func mergeRefreshedAccount(
        _ refreshed: StoredAccount,
        into store: AccountsStore
    ) -> AccountsStore {
        var store = store
        store.accounts = store.accounts.map { existing in
            guard existing.id == refreshed.id else { return existing }
            var merged = existing
            merged.label = refreshed.label
            merged.email = refreshed.email
            merged.planType = refreshed.planType
            merged.teamName = refreshed.teamName
            merged.teamAlias = refreshed.teamAlias
            merged.authJSON = refreshed.authJSON
            merged.updatedAt = refreshed.updatedAt
            merged.usage = refreshed.usage
            merged.usageError = refreshed.usageError
            merged.principalID = refreshed.principalID
            return merged
        }
        return store
    }

    static func reconcileCurrentAuthSnapshot(
        in store: inout AccountsStore,
        authRepository: AuthRepository,
        now: Int64
    ) -> Bool {
        guard let currentAuth = try? authRepository.readCurrentAuthOptional(),
              let extracted = try? authRepository.extractAuth(from: currentAuth),
              let index = matchingStoredAccountIndex(for: extracted, in: store.accounts) else {
            return false
        }

        var account = store.accounts[index]
        var didChange = false

        if account.authJSON != currentAuth {
            account.authJSON = currentAuth
            didChange = true
        }

        if account.accountID != extracted.accountID {
            account.accountID = extracted.accountID
            didChange = true
        }

        if account.email != extracted.email {
            account.email = extracted.email
            didChange = true
        }

        if account.principalID != extracted.principalID {
            account.principalID = extracted.principalID
            didChange = true
        }

        let resolvedPlanType = AccountPlanResolver.preferredPlanType(
            planType: extracted.planType,
            usagePlanType: account.usage?.planType,
            fallback: account.planType
        )
        if account.planType != resolvedPlanType {
            account.planType = resolvedPlanType
            didChange = true
        }

        if let teamName = normalizedTeamName(extracted.teamName),
           normalizedTeamName(account.teamName) != teamName {
            account.teamName = teamName
            didChange = true
        }

        guard didChange else { return false }
        account.updatedAt = now
        store.accounts[index] = account
        return true
    }

    private static func reconcileStoredAccountMetadata(
        in store: inout AccountsStore,
        authRepository: AuthRepository
    ) -> Bool {
        var didChange = false

        for index in store.accounts.indices {
            let storedAccount = store.accounts[index]
            guard let reconciled = try? authRepository.extractAuth(from: storedAccount.authJSON) else {
                continue
            }

            if store.accounts[index].email != reconciled.email {
                store.accounts[index].email = reconciled.email
                didChange = true
            }

            if store.accounts[index].principalID != reconciled.principalID {
                store.accounts[index].principalID = reconciled.principalID
                didChange = true
            }

            let resolvedPlanType = AccountPlanResolver.preferredPlanType(
                planType: reconciled.planType,
                usagePlanType: storedAccount.usage?.planType,
                fallback: storedAccount.planType
            )
            if store.accounts[index].planType != resolvedPlanType {
                store.accounts[index].planType = resolvedPlanType
                didChange = true
            }

            let reconciledTeamName = normalizedTeamName(reconciled.teamName)
            let storedTeamName = normalizedTeamName(store.accounts[index].teamName)
            if let reconciledTeamName, storedTeamName != reconciledTeamName {
                store.accounts[index].teamName = reconciledTeamName
                didChange = true
            }
        }

        return didChange
    }

    static func normalizedTeamName(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func remoteWorkspaceName(
        for accountID: String,
        in metadata: [WorkspaceMetadata]
    ) -> String? {
        guard let match = metadata.first(where: { $0.accountID == accountID }) else {
            return nil
        }

        let trimmed = match.workspaceName?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let trimmed, !trimmed.isEmpty else {
            return nil
        }

        if match.structure?.lowercased() == "personal" {
            return nil
        }

        return trimmed
    }
}
