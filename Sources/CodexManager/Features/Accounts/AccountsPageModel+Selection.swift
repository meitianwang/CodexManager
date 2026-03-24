import Foundation
import SwiftUI

extension AccountsPageModel {
    func switchAccount(id: String) async {
        withAccountsSwitchAnimation {
            switchingAccountID = id
        }
        defer {
            withAccountsSwitchAnimation {
                switchingAccountID = nil
            }
        }

        do {
            let execution = try await coordinator.switchAccountAndApplySettings(id: id)
            let accounts = try await coordinator.listAccounts()
            guard let selectedAccount = accounts.first(where: { $0.id == id }) else {
                throw AppError.invalidData(L10n.tr("error.accounts.account_not_found_for_switch"))
            }
            applyAccountsForAccountSwitch(accounts)
            publishAndSyncLocalAccountsMutation(accounts)
            syncCurrentAccountSelectionInBackground(accountID: selectedAccount.accountID)
            notice = buildSwitchNotice(execution: execution)
        } catch {
            notice = NoticeMessage(style: .error, text: error.localizedDescription)
        }
    }

    func smartSwitch() async {
        do {
            let accountsBefore = try await coordinator.listAccounts()
            let sorted = AccountRanking.sortByRemaining(accountsBefore)
            guard let best = sorted.first else {
                notice = NoticeMessage(style: .info, text: L10n.tr("accounts.notice.no_switch_target"))
                return
            }
            if best.isCurrent {
                notice = NoticeMessage(style: .info, text: L10n.tr("accounts.notice.already_best"))
                return
            }

            let execution = try await coordinator.switchAccountAndApplySettings(id: best.id)
            let accounts = try await coordinator.listAccounts()
            applyAccountsForAccountSwitch(accounts)
            publishAndSyncLocalAccountsMutation(accounts)
            syncCurrentAccountSelectionInBackground(accountID: best.accountID)
            var switchNotice = buildSwitchNotice(execution: execution)
            switchNotice.text = L10n.tr("accounts.notice.smart_switched_prefix_format", best.label, switchNotice.text)
            notice = switchNotice
        } catch {
            notice = NoticeMessage(style: .error, text: error.localizedDescription)
        }
    }

    func toggleAllAccountsCollapsed() {
        guard case .content(let accounts) = state else { return }
        let ids = Set(accounts.map(\.id))
        guard !ids.isEmpty else {
            collapsedAccountIDs = []
            return
        }
        collapsedAccountIDs = collapsedAccountIDs.isSuperset(of: ids) ? [] : ids
    }

    private func applyAccountsForAccountSwitch(_ accounts: [AccountSummary]) {
        withAccountsSwitchAnimation {
            applyAccounts(accounts)
        }
    }

    private func withAccountsSwitchAnimation(_ updates: () -> Void) {
        withAnimation(AccountsAnimationRules.contentReorder) {
            updates()
        }
    }
}
