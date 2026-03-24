import Foundation

extension AccountsCoordinator {
    func listAccounts() async throws -> [AccountSummary] {
        var store = try storeRepository.loadStore()
        let didReconcile = Self.reconcileStoredAccountMetadata(in: &store, authRepository: authRepository)
        let didEnrich = await enrichStoredWorkspaceMetadataIfNeeded(in: &store, forceRemoteCheck: false)
        if didReconcile || didEnrich {
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
        onPartialUpdate: (@Sendable ([AccountSummary]) async -> Void)? = nil
    ) async throws -> [AccountSummary] {
        let now = dateProvider.unixSecondsNow()
        let snapshot = try storeRepository.loadStore()
        let authRepository = self.authRepository
        let usageService = self.usageService
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
                    authRepository: authRepository,
                    usageService: usageService
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
                            authRepository: authRepository,
                            usageService: usageService
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
            planType: extracted.planType,
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
            existing.planType = account.planType
            if let teamName = Self.normalizedTeamName(account.teamName) {
                existing.teamName = teamName
            }
            existing.authJSON = account.authJSON
            existing.updatedAt = now
            existing.usage = usage ?? existing.usage
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

    private func resolveRemoteWorkspaceName(
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
        authRepository: AuthRepository,
        usageService: UsageService
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
            account.planType = extracted.planType ?? account.planType
            if let teamName = normalizedTeamName(extracted.teamName) {
                account.teamName = teamName
            }
            account.email = extracted.email ?? account.email
            account.principalID = extracted.principalID
        } catch {
            account.usageError = error.localizedDescription
        }

        account.updatedAt = now
        return account
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

            if store.accounts[index].planType != reconciled.planType {
                store.accounts[index].planType = reconciled.planType
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

    private static func normalizedTeamName(_ value: String?) -> String? {
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
