import Foundation

extension AccountsPageModel {
    func refreshUsage() async {
        guard !isRefreshing else { return }
        isManualRefreshing = true
        defer { isManualRefreshing = false }

        do {
            let accounts: [AccountSummary]
            if let manualRefreshService {
                accounts = try await manualRefreshService.performManualRefresh(
                    onPartialUpdate: { [weak self] accounts in
                        guard let self else { return }
                        self.applyAccounts(accounts)
                        self.publishLocalAccounts(accounts)
                    }
                )
            } else {
                accounts = try await coordinator.refreshUsage(
                    force: true,
                    onPartialUpdate: { [weak self] accounts in
                        guard let self else { return }
                        await MainActor.run {
                            self.applyAccounts(accounts)
                            self.publishLocalAccounts(accounts)
                        }
                    }
                )
            }
            applyAccounts(accounts)
            publishLocalAccounts(accounts)
            let noticeKey = manualRefreshService == nil
                ? "accounts.notice.usage_refreshed"
                : "accounts.notice.accounts_refreshed"
            notice = NoticeMessage(style: .info, text: L10n.tr(noticeKey))
        } catch {
            notice = NoticeMessage(style: .error, text: error.localizedDescription)
        }
    }

    func refreshUsage(forAccountID id: String) async {
        guard !isRefreshing else { return }
        refreshingAccountIDs.insert(id)
        defer { refreshingAccountIDs.remove(id) }

        do {
            let accounts = try await coordinator.refreshUsage(
                accountIDs: [id],
                force: true,
                onPartialUpdate: { [weak self] accounts in
                    guard let self else { return }
                    await MainActor.run {
                        self.applyAccounts(accounts)
                        self.publishLocalAccounts(accounts)
                    }
                }
            )
            applyAccounts(accounts)
            publishAndSyncLocalAccountsMutation(accounts)
        } catch {
            notice = NoticeMessage(style: .error, text: error.localizedDescription)
        }
    }
}
