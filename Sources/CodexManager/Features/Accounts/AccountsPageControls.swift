import SwiftUI

struct AccountsActionBarView: View {
    let presentation: AccountsActionBarPresentation
    let onTriggerAction: (AccountsPageActionIntent) -> Void
    let onToggleCollapse: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Text(L10n.tr("tab.accounts"))
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)

                Spacer(minLength: 0)

                CollapseChevronButton(isExpanded: presentation.collapse.isExpanded) {
                    onToggleCollapse()
                }
                .accessibilityLabel(Text(presentation.collapse.accessibilityLabel))
            }

            ScrollView(.horizontal, showsIndicators: false) {
                AccountsActionStrip(
                    descriptors: presentation.descriptors,
                    onTrigger: onTriggerAction
                )
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.bottom, 2)
    }
}

#if os(iOS)
struct AccountsToolbarActions: ToolbarContent {
    let leadingButtons: [AccountsActionButtonDescriptor<AccountsPageActionIntent>]
    let trailingButtons: [AccountsActionButtonDescriptor<AccountsPageActionIntent>]
    let currentLocale: AppLocale
    let onSelectLocale: (AppLocale) -> Void
    let onTriggerAction: (AccountsPageActionIntent) -> Void
    let onToggleCollapse: () -> Void

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            LanguageMenuButton(
                currentLocale: currentLocale,
                onSelectLocale: onSelectLocale
            ) {
                ToolbarIconLabel(systemImage: "globe")
            }
        }

        ToolbarItemGroup(placement: .topBarLeading) {
            AccountsToolbarButtonGroup(
                descriptors: leadingButtons,
                onTrigger: triggerAction
            )
        }

        ToolbarItemGroup(placement: .topBarTrailing) {
            AccountsToolbarButtonGroup(
                descriptors: trailingButtons,
                onTrigger: triggerAction
            )
        }
    }

    private func triggerAction(_ intent: AccountsPageActionIntent) {
        if intent == .toggleCollapse {
            onToggleCollapse()
            return
        }
        onTriggerAction(intent)
    }
}
#endif
