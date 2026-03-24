import Foundation

extension AccountsPageModel {
    func loadIfNeeded() async {
        guard !hasLoaded else { return }
        await load()
    }

    func load() async {
        async let cloudSyncAvailableTask = cloudSyncAvailabilityService?.isICloudAvailable() ?? true
        do {
            let accounts = try await coordinator.listAccounts()

            if accounts.isEmpty {
                isCloudSyncAvailable = await cloudSyncAvailableTask
            }

            applyAccounts(accounts)

            if !accounts.isEmpty {
                isCloudSyncAvailable = await cloudSyncAvailableTask
            }

            hasLoaded = true
        } catch {
            state = .error(message: error.localizedDescription)
            hasLoaded = true
        }
    }

    /// Applies account snapshots produced by the global background refresh pipeline.
    /// This keeps the Accounts page in sync without creating a duplicate timer.
    func syncFromBackgroundRefresh(_ accounts: [AccountSummary]) {
        applyAccounts(accounts)
    }

    func syncRemoteUsageRefreshActivity(isRefreshing: Bool) {
        guard isRemoteUsageRefreshing != isRefreshing else { return }
        isRemoteUsageRefreshing = isRefreshing
    }
}
