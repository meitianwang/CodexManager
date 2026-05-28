import SwiftUI

struct AccountsActionBarView: View {
    let presentation: AccountsActionBarPresentation
    let onTriggerAction: (AccountsPageActionIntent) -> Void
    let onSelectListMode: (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 12) {
                Text(L10n.tr("tab.accounts"))
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(AppTheme.primaryText)
                    .lineLimit(1)

                Spacer(minLength: 12)

                AccountsViewModeToggle(
                    isListMode: presentation.isListMode,
                    onSelect: onSelectListMode
                )
            }

            AccountsActionStrip(
                descriptors: presentation.descriptors,
                onTrigger: onTriggerAction
            )
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct AccountsViewModeToggle: View {
    let isListMode: Bool
    let onSelect: (Bool) -> Void

    var body: some View {
        HStack(spacing: 0) {
            segment(systemImage: "square.grid.2x2", selected: !isListMode) {
                onSelect(false)
            }
            segment(systemImage: "list.bullet", selected: isListMode) {
                onSelect(true)
            }
        }
        .font(.system(size: 13, weight: .semibold))
        .background(AppTheme.controlBackground, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .strokeBorder(AppTheme.separator, lineWidth: 1)
        }
    }

    private func segment(systemImage: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .frame(width: 34, height: 28)
                .foregroundStyle(selected ? AppTheme.accent : AppTheme.primaryText)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(selected ? AppTheme.accentSoft : Color.clear)
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(systemImage == "list.bullet"
            ? L10n.tr("accounts.action.view_list")
            : L10n.tr("accounts.action.view_grid")))
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
