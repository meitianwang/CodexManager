import Foundation

struct AccountsPageContentPresentation: Equatable {
    let state: ViewState<[AccountCardViewState]>
    let isOverviewMode: Bool
}

struct AccountsActionBarPresentation: Equatable {
    let descriptors: [AccountsActionButtonDescriptor<AccountsPageActionIntent>]
    let collapse: AccountsCollapsePresentation
}

struct AccountCardViewState: Equatable, Identifiable {
    let account: AccountSummary
    let isCollapsed: Bool
    let switching: Bool
    let refreshing: Bool
    let isRefreshEnabled: Bool
    let isUsageRefreshActive: Bool

    var id: String {
        account.id
    }
}

extension AccountsPageModel {
    func makeContentPresentation() -> AccountsPageContentPresentation {
        let contentState = state.mapContent { accounts in
            accounts.map { account in
                AccountCardViewState(
                    account: account,
                    isCollapsed: isAccountCollapsed(account.id),
                    switching: switchingAccountID == account.id,
                    refreshing: isAccountRefreshing(account.id),
                    isRefreshEnabled: canRefreshAccount(account.id),
                    isUsageRefreshActive: isUsageRefreshActive(forAccountID: account.id)
                )
            }
        }

        return AccountsPageContentPresentation(
            state: contentState,
            isOverviewMode: areAllAccountsCollapsed
        )
    }

    func makeMacActionBarPresentation() -> AccountsActionBarPresentation {
        AccountsActionBarPresentation(
            descriptors: desktopActionButtons,
            collapse: collapsePresentation
        )
    }
}

private extension ViewState {
    func mapContent<NewValue>(_ transform: (Value) -> NewValue) -> ViewState<NewValue> {
        switch self {
        case .loading:
            return .loading
        case .empty(let message):
            return .empty(message: message)
        case .content(let value):
            return .content(transform(value))
        case .error(let message):
            return .error(message: message)
        }
    }
}
