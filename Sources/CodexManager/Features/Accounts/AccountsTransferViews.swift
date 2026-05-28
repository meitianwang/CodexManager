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
        VStack(spacing: 0) {
            header
            Divider()
                .padding(.horizontal, 12)
            accountList
            Divider()
            footer
        }
        .frame(width: 506)
        .frame(minHeight: 388)
        .background(AppTheme.panelBackground)
    }

    private var header: some View {
        ZStack {
            VStack(spacing: 3) {
                Text(title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(AppTheme.primaryText)
                Text(L10n.tr("accounts.transfer.account_count_format", "\(accounts.count)"))
                    .font(.system(size: 11, weight: .regular))
                    .foregroundStyle(AppTheme.secondaryText)
            }

            HStack {
                Button(action: onCancel) {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(AppTheme.secondaryText)
                        .frame(width: 24, height: 24)
                        .background(AppTheme.mutedBackground, in: Circle())
                }
                .buttonStyle(.plain)

                Spacer(minLength: 0)

                HStack(spacing: 20) {
                    Button(L10n.tr("common.select_all")) {
                        selectedIDs = Set(accounts.map(\.id))
                    }
                    .disabled(selectedIDs.count == accounts.count)

                    Button(L10n.tr("common.deselect_all")) {
                        selectedIDs.removeAll()
                    }
                    .disabled(selectedIDs.isEmpty)
                }
                .buttonStyle(.plain)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(AppTheme.accent)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 11)
    }

    private var accountList: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(accounts) { account in
                    AccountTransferSelectionRow(
                        account: account,
                        isSelected: selectedIDs.contains(account.id)
                    ) {
                        toggle(account.id)
                    }
                }
            }
        }
        .frame(minHeight: 240, maxHeight: 294)
    }

    private var footer: some View {
        HStack(spacing: 12) {
            Spacer(minLength: 0)

            Button(L10n.tr("common.cancel")) {
                onCancel()
            }
            .codexManagerActionButtonStyle(prominent: false, density: .compact)

            Button(actionTitle) {
                onConfirm(selectedIDs)
            }
            .disabled(selectedIDs.isEmpty)
            .codexManagerActionButtonStyle(prominent: true, density: .compact)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private func toggle(_ id: String) {
        if selectedIDs.contains(id) {
            selectedIDs.remove(id)
        } else {
            selectedIDs.insert(id)
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
                Image(systemName: isSelected ? "checkmark.square.fill" : "square")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(isSelected ? AppTheme.accent : .secondary)
                    .frame(width: 22, height: 22)

                VStack(alignment: .leading, spacing: 2) {
                    Text(account.email ?? account.label)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(AppTheme.primaryText)
                        .lineLimit(1)

                    Text(account.teamName ?? account.accountID)
                        .font(.system(size: 11, weight: .regular))
                        .foregroundStyle(AppTheme.secondaryText)
                        .lineLimit(1)
                }

                Spacer(minLength: 0)

                AccountTransferPlanBadge(text: account.planLabel)

                if account.isCurrent {
                    AccountTransferCurrentBadge()
                }
            }
            .padding(.horizontal, 24)
            .frame(height: 48)
            .background(AppTheme.panelBackground)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(AppTheme.separator)
                    .frame(height: 1)
                    .padding(.leading, 58)
            }
        }
        .buttonStyle(.plain)
    }
}

private struct AccountTransferPlanBadge: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(AppTheme.planForeground(for: text))
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background {
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(AppTheme.planBackground(for: text))
            }
    }
}

private struct AccountTransferCurrentBadge: View {
    var body: some View {
        Text(L10n.tr("accounts.card.current"))
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(AppTheme.currentBadgeForeground)
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background {
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(AppTheme.currentBadgeBackground)
            }
    }
}
