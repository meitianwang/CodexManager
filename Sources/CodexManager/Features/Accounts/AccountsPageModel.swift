import Foundation
import Combine

@MainActor
final class AccountsPageModel: ObservableObject {
    let coordinator: AccountsCoordinator
    let manualRefreshService: AccountsManualRefreshServiceProtocol?
    let localAccountsMutationSyncService: AccountsLocalMutationSyncServiceProtocol?
    let currentAccountSelectionSyncService: CurrentAccountSelectionSyncServiceProtocol?
    let cloudSyncAvailabilityService: CloudSyncAvailabilityService?
    let onLocalAccountsChanged: (([AccountSummary]) -> Void)?

    private let noticeScheduler = NoticeAutoDismissScheduler()

    var hasLoaded = false
    var isCloudSyncAvailable = true

    @Published var state: ViewState<[AccountSummary]>
    @Published var notice: NoticeMessage? {
        didSet {
            noticeScheduler.schedule(notice) { [weak self] in
                self?.notice = nil
            }
        }
    }
    @Published var isManualRefreshing = false
    @Published var isRemoteUsageRefreshing = false
    @Published var isImporting = false
    @Published var isAdding = false
    @Published var switchingAccountID: String?
    @Published var refreshingAccountIDs: Set<String> = []
    @Published var collapsedAccountIDs: Set<String> = []

    init(
        coordinator: AccountsCoordinator,
        manualRefreshService: AccountsManualRefreshServiceProtocol? = nil,
        localAccountsMutationSyncService: AccountsLocalMutationSyncServiceProtocol? = nil,
        currentAccountSelectionSyncService: CurrentAccountSelectionSyncServiceProtocol? = nil,
        cloudSyncAvailabilityService: CloudSyncAvailabilityService? = nil,
        onLocalAccountsChanged: (([AccountSummary]) -> Void)? = nil,
        initialAccounts: [AccountSummary]? = nil
    ) {
        self.coordinator = coordinator
        self.manualRefreshService = manualRefreshService
        self.localAccountsMutationSyncService = localAccountsMutationSyncService
        self.currentAccountSelectionSyncService = currentAccountSelectionSyncService
        self.cloudSyncAvailabilityService = cloudSyncAvailabilityService
        self.onLocalAccountsChanged = onLocalAccountsChanged
        self.state = initialAccounts.map { initialAccounts in
            Self.makeViewState(
                accounts: AccountRanking.sortForDisplay(initialAccounts),
                cloudSyncAvailable: true
            )
        } ?? .loading
    }

    var canRefreshUsageAction: Bool {
        !isAdding
    }

    var areAllAccountsCollapsed: Bool {
        guard case .content(let accounts) = state else { return false }
        let ids = Set(accounts.map(\.id))
        guard !ids.isEmpty else { return false }
        return collapsedAccountIDs.isSuperset(of: ids)
    }

    var hasResolvedInitialState: Bool {
        if case .loading = state {
            return false
        }
        return true
    }

    var isRefreshing: Bool {
        isManualRefreshing || isRemoteUsageRefreshing || !refreshingAccountIDs.isEmpty
    }

    var isRefreshSpinnerActive: Bool {
        isManualRefreshing
    }

    var desktopActionButtons: [AccountsActionButtonDescriptor<AccountsPageActionIntent>] {
        AccountsActionPresentation.desktopButtons(
            isImporting: isImporting,
            isAdding: isAdding,
            switchingAccountID: switchingAccountID,
            canRefreshUsage: canRefreshUsageAction,
            isRefreshSpinnerActive: isRefreshSpinnerActive
        )
    }

    var leadingToolbarButtons: [AccountsActionButtonDescriptor<AccountsPageActionIntent>] {
        AccountsActionPresentation.leadingToolbarButtons(
            isImporting: isImporting,
            isAdding: isAdding
        )
    }

    var trailingToolbarButtons: [AccountsActionButtonDescriptor<AccountsPageActionIntent>] {
        AccountsActionPresentation.trailingToolbarButtons(
            canRefreshUsage: canRefreshUsageAction,
            isRefreshSpinnerActive: isRefreshSpinnerActive,
            areAllAccountsCollapsed: areAllAccountsCollapsed
        )
    }

    var collapsePresentation: AccountsCollapsePresentation {
        AccountsActionPresentation.collapseControl(
            areAllAccountsCollapsed: areAllAccountsCollapsed
        )
    }

    func isAccountCollapsed(_ id: String) -> Bool {
        collapsedAccountIDs.contains(id)
    }

    func isAccountRefreshing(_ id: String) -> Bool {
        refreshingAccountIDs.contains(id)
    }

    func canRefreshAccount(_ id: String) -> Bool {
        !isRefreshing
    }

    func isUsageRefreshActive(forAccountID id: String) -> Bool {
        isManualRefreshing || isRemoteUsageRefreshing || refreshingAccountIDs.contains(id)
    }

    func handlePageAction(_ intent: AccountsPageActionIntent) async {
        switch intent {
        case .importCurrentAuth:
            await importCurrentAuth()
        case .addAccount:
            await addAccountViaLogin()
        case .smartSwitch:
            await smartSwitch()
        case .refreshUsage:
            await refreshUsage()
        case .toggleCollapse:
            toggleAllAccountsCollapsed()
        }
    }
}
