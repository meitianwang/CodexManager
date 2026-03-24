import SwiftUI

struct AccountsPageView: View {
    @State private var areCardsPresented = false
    @State private var didRunInitialCardEntrance = false

    let model: AccountsPageModel
    let currentLocale: AppLocale
    let onSelectLocale: (AppLocale) -> Void

    init(
        model: AccountsPageModel,
        currentLocale: AppLocale,
        onSelectLocale: @escaping (AppLocale) -> Void
    ) {
        self.model = model
        self.currentLocale = currentLocale
        self.onSelectLocale = onSelectLocale
        let hasResolvedInitialState = model.hasResolvedInitialState
        _areCardsPresented = State(initialValue: hasResolvedInitialState)
        _didRunInitialCardEntrance = State(initialValue: hasResolvedInitialState)
    }

    var body: some View {
        AccountsPageShell(
            model: model,
            currentLocale: currentLocale,
            onSelectLocale: onSelectLocale,
            areCardsPresented: areCardsPresented,
            onTriggerAction: triggerAction,
            onToggleCollapse: toggleCollapse,
            onSwitchAccount: switchAccount,
            onRefreshAccountUsage: refreshUsage,
            onDeleteAccount: deleteAccount
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .task {
            await model.loadIfNeeded()
        }
        .onAppear {
            triggerInitialCardEntranceIfNeeded(for: contentAccountCount)
        }
        .onChange(of: contentAccountCount) { _, newValue in
            triggerInitialCardEntranceIfNeeded(for: newValue)
        }
    }

    private var contentAccountCount: Int? {
        guard case .content(let accounts) = model.state else { return nil }
        return accounts.count
    }

    private func triggerInitialCardEntranceIfNeeded(for count: Int?) {
        guard count != nil, !didRunInitialCardEntrance else { return }
        didRunInitialCardEntrance = true
        areCardsPresented = true
    }

    private func triggerAction(_ intent: AccountsPageActionIntent) {
        Task { await model.handlePageAction(intent) }
    }

    private func toggleCollapse() {
        withAnimation(AccountsAnimationRules.collapseToggle) {
            model.toggleAllAccountsCollapsed()
        }
    }

    private func switchAccount(id: String) {
        Task { await model.switchAccount(id: id) }
    }

    private func refreshUsage(forAccountID id: String) {
        Task { await model.refreshUsage(forAccountID: id) }
    }

    private func deleteAccount(id: String) {
        Task { await model.deleteAccount(id: id) }
    }
}
