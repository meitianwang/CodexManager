import SwiftUI

struct AccountsPageShell: View {
    let model: AccountsPageModel
    let currentLocale: AppLocale
    let onSelectLocale: (AppLocale) -> Void
    let areCardsPresented: Bool
    let onTriggerAction: (AccountsPageActionIntent) -> Void
    let onToggleCollapse: () -> Void
    let onSwitchAccount: (String) -> Void
    let onRefreshAccountUsage: (String) -> Void
    let onDeleteAccount: (String) -> Void

    var body: some View {
        #if os(iOS)
        AccountsIOSPageShell(
            model: model,
            currentLocale: currentLocale,
            onSelectLocale: onSelectLocale,
            areCardsPresented: areCardsPresented,
            onTriggerAction: onTriggerAction,
            onToggleCollapse: onToggleCollapse,
            onSwitchAccount: onSwitchAccount,
            onRefreshAccountUsage: onRefreshAccountUsage,
            onDeleteAccount: onDeleteAccount
        )
        #else
        AccountsMacPageShell(
            model: model,
            areCardsPresented: areCardsPresented,
            onTriggerAction: onTriggerAction,
            onToggleCollapse: onToggleCollapse,
            onSwitchAccount: onSwitchAccount,
            onRefreshAccountUsage: onRefreshAccountUsage,
            onDeleteAccount: onDeleteAccount
        )
        #endif
    }
}

#if os(iOS)
private struct AccountsIOSPageShell: View {
    let model: AccountsPageModel
    let currentLocale: AppLocale
    let onSelectLocale: (AppLocale) -> Void
    let areCardsPresented: Bool
    let onTriggerAction: (AccountsPageActionIntent) -> Void
    let onToggleCollapse: () -> Void
    let onSwitchAccount: (String) -> Void
    let onRefreshAccountUsage: (String) -> Void
    let onDeleteAccount: (String) -> Void

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    AccountsPageContentSection(
                        model: model,
                        availableViewportSize: proxy.size,
                        areCardsPresented: areCardsPresented,
                        onSwitchAccount: onSwitchAccount,
                        onRefreshAccountUsage: onRefreshAccountUsage,
                        onDeleteAccount: onDeleteAccount
                    )
                }
                .padding(.top, LayoutRules.iOSAccountsContentTopPadding(safeAreaTop: proxy.safeAreaInsets.top))
                .padding(.bottom, LayoutRules.iOSAccountsContentBottomPadding(safeAreaBottom: proxy.safeAreaInsets.bottom))
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollIndicators(.hidden)
            .ignoresSafeArea(edges: [.top, .bottom])
            .refreshable {
                onTriggerAction(.refreshUsage)
            }
            .toolbar {
                AccountsToolbarContent(
                    model: model,
                    currentLocale: currentLocale,
                    onSelectLocale: onSelectLocale,
                    onTriggerAction: onTriggerAction,
                    onToggleCollapse: onToggleCollapse
                )
            }
        }
    }
}
#endif

private struct AccountsMacPageShell: View {
    let model: AccountsPageModel
    let areCardsPresented: Bool
    let onTriggerAction: (AccountsPageActionIntent) -> Void
    let onToggleCollapse: () -> Void
    let onSwitchAccount: (String) -> Void
    let onRefreshAccountUsage: (String) -> Void
    let onDeleteAccount: (String) -> Void

    private var pageContentWidth: CGFloat {
        LayoutRules.accountsPageContentWidth(isCompactWidth: false) ?? LayoutRules.accountsPageTargetWidth
    }

    var body: some View {
        VStack(alignment: .leading, spacing: LayoutRules.sectionSpacing) {
            AccountsActionBarContainer(
                model: model,
                onTriggerAction: onTriggerAction,
                onToggleCollapse: onToggleCollapse
            )
            .padding(.horizontal, LayoutRules.pagePadding)
            .frame(width: pageContentWidth, alignment: .leading)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    AccountsPageContentSection(
                        model: model,
                        availableViewportSize: CGSize(
                            width: pageContentWidth,
                            height: LayoutRules.defaultPanelHeight
                        ),
                        areCardsPresented: areCardsPresented,
                        onSwitchAccount: onSwitchAccount,
                        onRefreshAccountUsage: onRefreshAccountUsage,
                        onDeleteAccount: onDeleteAccount
                    )
                }
                .padding(.bottom, 12)
                .frame(width: pageContentWidth, alignment: .leading)
            }
            .scrollIndicators(.hidden)
        }
        .frame(width: pageContentWidth, alignment: .topLeading)
        .padding(.top, LayoutRules.pagePadding)
    }
}

private struct AccountsActionBarContainer: View {
    @ObservedObject var model: AccountsPageModel
    let onTriggerAction: (AccountsPageActionIntent) -> Void
    let onToggleCollapse: () -> Void

    var body: some View {
        AccountsActionBarView(
            presentation: model.makeMacActionBarPresentation(),
            onTriggerAction: onTriggerAction,
            onToggleCollapse: onToggleCollapse
        )
    }
}

#if os(iOS)
private struct AccountsToolbarContent: ToolbarContent {
    @ObservedObject var model: AccountsPageModel
    let currentLocale: AppLocale
    let onSelectLocale: (AppLocale) -> Void
    let onTriggerAction: (AccountsPageActionIntent) -> Void
    let onToggleCollapse: () -> Void

    var body: some ToolbarContent {
        AccountsToolbarActions(
            leadingButtons: model.leadingToolbarButtons,
            trailingButtons: model.trailingToolbarButtons,
            currentLocale: currentLocale,
            onSelectLocale: onSelectLocale,
            onTriggerAction: onTriggerAction,
            onToggleCollapse: onToggleCollapse
        )
    }
}
#endif
