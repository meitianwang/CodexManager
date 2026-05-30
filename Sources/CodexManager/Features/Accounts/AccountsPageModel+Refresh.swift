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
                allowInteractiveAuthRepair: true,
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

    func warmUpWeeklyQuota() async {
        guard !isRefreshing else { return }
        isWeeklyQuotaWarmingUp = true
        defer { isWeeklyQuotaWarmingUp = false }

        do {
            let result = try await coordinator.warmUpResetWeeklyQuotaAccounts(
                onPartialUpdate: { [weak self] accounts in
                    guard let self else { return }
                    await MainActor.run {
                        self.applyAccounts(accounts)
                        self.publishLocalAccounts(accounts)
                    }
                }
            )
            applyAccounts(result.accounts)
            publishAndSyncLocalAccountsMutation(result.accounts)
            notice = Self.weeklyQuotaWarmupNotice(for: result)
        } catch {
            notice = NoticeMessage(style: .error, text: error.localizedDescription)
        }
    }

    private static func weeklyQuotaWarmupNotice(for result: WeeklyQuotaWarmupResult) -> NoticeMessage {
        guard result.targetCount > 0 else {
            return NoticeMessage(
                style: .info,
                text: L10n.tr("accounts.notice.weekly_quota_warmup_no_targets")
            )
        }

        let key = result.failedCount == 0
            ? "accounts.notice.weekly_quota_warmup_completed_format"
            : "accounts.notice.weekly_quota_warmup_partial_format"
        return NoticeMessage(
            style: result.failedCount == 0 ? .success : .error,
            text: L10n.tr(
                key,
                "\(result.succeededCount)",
                "\(result.failedCount)"
            )
        )
    }
}
