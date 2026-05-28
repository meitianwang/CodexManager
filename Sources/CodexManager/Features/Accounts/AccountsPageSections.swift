import SwiftUI

struct AccountsPageContentSection: View {
    @ObservedObject var model: AccountsPageModel
    let availableViewportSize: CGSize
    let areCardsPresented: Bool
    let onSwitchAccount: (String) -> Void
    let onRefreshAccountUsage: (String) -> Void
    let onDeleteAccount: (String) -> Void

    private var presentation: AccountsPageContentPresentation {
        model.makeContentPresentation()
    }

    var body: some View {
        switch presentation.state {
        case .loading:
            ProgressView(L10n.tr("accounts.loading.message"))
                .frame(maxWidth: .infinity, minHeight: 180)
        case .empty(let message):
            EmptyStateView(title: L10n.tr("accounts.empty.title"), message: message)
                .padding(.horizontal, LayoutRules.pagePadding)
        case .error(let message):
            EmptyStateView(title: L10n.tr("accounts.error.load_failed"), message: message)
                .padding(.horizontal, LayoutRules.pagePadding)
        case .content(let cards):
            AccountsGridSection(
                cards: cards,
                isOverviewMode: presentation.isOverviewMode,
                isListMode: presentation.isListMode,
                availableViewportSize: availableViewportSize,
                areCardsPresented: areCardsPresented,
                onSwitchAccount: onSwitchAccount,
                onRefreshAccountUsage: onRefreshAccountUsage,
                onDeleteAccount: onDeleteAccount
            )
        }
    }
}

private struct AccountsGridSection: View {
    let cards: [AccountCardViewState]
    let isOverviewMode: Bool
    let isListMode: Bool
    let availableViewportSize: CGSize
    let areCardsPresented: Bool
    let onSwitchAccount: (String) -> Void
    let onRefreshAccountUsage: (String) -> Void
    let onDeleteAccount: (String) -> Void

    private var gridContext: LayoutRules.AccountsGridContext {
        #if os(iOS)
        LayoutRules.accountsGridContext(
            isOverviewMode: isOverviewMode,
            viewportSize: availableViewportSize
        )
        #else
        LayoutRules.AccountsGridContext(
            platform: .macOS,
            isOverviewMode: isOverviewMode,
            viewportSize: availableViewportSize
        )
        #endif
    }

    private var columns: [GridItem] {
        if isListMode {
            return [GridItem(.flexible(minimum: 0, maximum: .infinity), spacing: LayoutRules.accountsRowSpacing, alignment: .top)]
        }
        return LayoutRules.accountsGridColumns(context: gridContext)
    }

    var body: some View {
        LazyVGrid(
            columns: columns,
            alignment: .leading,
            spacing: LayoutRules.accountsRowSpacing
        ) {
            ForEach(Array(cards.enumerated()), id: \.element.id) { index, card in
                AccountCardGridItem(
                    card: card,
                    areCardsPresented: areCardsPresented,
                    index: index,
                    onSwitch: { onSwitchAccount(card.id) },
                    onRefresh: { onRefreshAccountUsage(card.id) },
                    onDelete: { onDeleteAccount(card.id) }
                )
            }
        }
        .animation(
            AccountsAnimationRules.contentReorder,
            value: cards.map(\.id)
        )
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct AccountCardGridItem: View {
    let card: AccountCardViewState
    let areCardsPresented: Bool
    let index: Int
    let onSwitch: () -> Void
    let onRefresh: () -> Void
    let onDelete: () -> Void

    var body: some View {
        AccountCardView(
            account: card.account,
            isCollapsed: card.isCollapsed,
            switching: card.switching,
            refreshing: card.refreshing,
            isRefreshEnabled: card.isRefreshEnabled,
            isUsageRefreshActive: card.isUsageRefreshActive,
            onSwitch: onSwitch,
            onRefresh: onRefresh,
            onDelete: onDelete
        )
        .codexManagerCardEntrance(index: index, isPresented: areCardsPresented)
        .modifier(AccountCardFrameModifier())
    }
}

private struct CardEntranceModifier: ViewModifier {
    let index: Int
    let isPresented: Bool

    func body(content: Content) -> some View {
        content
            .opacity(isPresented ? 1 : 0)
            .offset(y: isPresented ? 0 : 22)
            .scaleEffect(isPresented ? 1 : 0.985)
            .animation(
                AccountsAnimationRules.cardEntrance(index: index),
                value: isPresented
            )
    }
}

private extension View {
    func codexManagerCardEntrance(index: Int, isPresented: Bool) -> some View {
        modifier(CardEntranceModifier(index: index, isPresented: isPresented))
    }
}

private struct AccountCardFrameModifier: ViewModifier {
    func body(content: Content) -> some View {
        content.frame(maxWidth: .infinity, alignment: .topLeading)
    }
}
