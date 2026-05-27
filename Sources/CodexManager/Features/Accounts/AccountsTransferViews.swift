import SwiftUI

struct AccountTransferSelectionSheet: View {
    let title: String
    let actionTitle: String
    let accounts: [AccountTransferSelectableItem]
    let initiallySelectedIDs: Set<String>
    let onCancel: () -> Void
    let onConfirm: (Set<String>) -> Void

    @State private var selectedIDs: Set<String>

    init(
        title: String,
        actionTitle: String,
        accounts: [AccountTransferSelectableItem],
        initiallySelectedIDs: Set<String>,
        onCancel: @escaping () -> Void,
        onConfirm: @escaping (Set<String>) -> Void
    ) {
        self.title = title
        self.actionTitle = actionTitle
        self.accounts = accounts
        self.initiallySelectedIDs = initiallySelectedIDs
        self.onCancel = onCancel
        self.onConfirm = onConfirm
        _selectedIDs = State(initialValue: initiallySelectedIDs)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            header
            accountList
            footer
        }
        .padding(22)
        .frame(width: 520)
        .frame(minHeight: 420)
        .background(AppTheme.windowBackground)
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.primary)
                Text(L10n.tr("accounts.transfer.account_count_format", "\(accounts.count)"))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)

            Button(selectionToggleTitle) {
                toggleSelection()
            }
            .codexManagerActionButtonStyle(prominent: false, density: .compact)
        }
    }

    private var accountList: some View {
        ScrollView {
            LazyVStack(spacing: 10) {
                ForEach(accounts) { account in
                    AccountTransferSelectionRow(
                        account: account,
                        isSelected: selectedIDs.contains(account.id)
                    ) {
                        toggle(account.id)
                    }
                }
            }
            .padding(.vertical, 2)
        }
        .frame(minHeight: 240, maxHeight: 360)
    }

    private var footer: some View {
        HStack(spacing: 12) {
            Button(L10n.tr("common.cancel")) {
                onCancel()
            }
            .codexManagerActionButtonStyle(prominent: false, density: .compact)

            Spacer(minLength: 0)

            Button(actionTitle) {
                onConfirm(selectedIDs)
            }
            .disabled(selectedIDs.isEmpty)
            .codexManagerActionButtonStyle(prominent: true, density: .compact)
        }
    }

    private var selectionToggleTitle: String {
        selectedIDs.count == accounts.count
            ? L10n.tr("common.deselect_all")
            : L10n.tr("common.select_all")
    }

    private func toggle(_ id: String) {
        if selectedIDs.contains(id) {
            selectedIDs.remove(id)
        } else {
            selectedIDs.insert(id)
        }
    }

    private func toggleSelection() {
        if selectedIDs.count == accounts.count {
            selectedIDs.removeAll()
        } else {
            selectedIDs = Set(accounts.map(\.id))
        }
    }
}

private struct AccountTransferSelectionRow: View {
    let account: AccountTransferSelectableItem
    let isSelected: Bool
    let onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 12) {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundStyle(isSelected ? AppTheme.accent : .secondary)
                    .frame(width: 24, height: 24)

                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text(account.email ?? account.label)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.primary)
                            .lineLimit(1)

                        AccountTransferPlanBadge(text: account.planLabel)

                        if account.isCurrent {
                            AccountTransferCurrentBadge()
                        }
                    }

                    HStack(spacing: 8) {
                        Text(account.teamName ?? account.accountID)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .cardSurface(cornerRadius: LayoutRules.cardRadius)
        }
        .buttonStyle(.plain)
    }
}

private struct AccountTransferPlanBadge: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(AppTheme.accent)
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background {
                Capsule().fill(AppTheme.accent.opacity(0.12))
            }
    }
}

private struct AccountTransferCurrentBadge: View {
    var body: some View {
        Text(L10n.tr("accounts.card.current"))
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background {
                Capsule().fill(AppTheme.controlBackground)
            }
    }
}
