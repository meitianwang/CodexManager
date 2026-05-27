import SwiftUI
import UniformTypeIdentifiers

struct AccountsPageView: View {
    @State private var areCardsPresented = false
    @State private var didRunInitialCardEntrance = false
    @State private var isExportSelectionPresented = false
    @State private var isImportFilePickerPresented = false
    @State private var isExportFilePickerPresented = false
    @State private var exportDocument = AccountsTransferDocument()
    @State private var pendingExportAccountCount = 0

    @ObservedObject private var model: AccountsPageModel
    let currentLocale: AppLocale
    let onSelectLocale: (AppLocale) -> Void

    init(
        model: AccountsPageModel,
        currentLocale: AppLocale,
        onSelectLocale: @escaping (AppLocale) -> Void
    ) {
        _model = ObservedObject(wrappedValue: model)
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
        .sheet(isPresented: $isExportSelectionPresented) {
            AccountTransferSelectionSheet(
                title: L10n.tr("accounts.transfer.export.title"),
                actionTitle: L10n.tr("accounts.transfer.export.action"),
                accounts: model.exportSelectableAccounts,
                initiallySelectedIDs: Set(model.exportSelectableAccounts.map(\.id)),
                onCancel: {
                    isExportSelectionPresented = false
                },
                onConfirm: { selectedIDs in
                    isExportSelectionPresented = false
                    Task {
                        guard let export = await model.makeAccountsExportDocument(selectedAccountIDs: selectedIDs) else {
                            return
                        }
                        exportDocument = export.document
                        pendingExportAccountCount = export.accountCount
                        isExportFilePickerPresented = true
                    }
                }
            )
        }
        .sheet(item: importDraftBinding) { draft in
            AccountTransferSelectionSheet(
                title: L10n.tr("accounts.transfer.import.title"),
                actionTitle: L10n.tr("accounts.transfer.import.action"),
                accounts: draft.accounts,
                initiallySelectedIDs: draft.defaultSelectedIDs,
                onCancel: {
                    model.cancelAccountsImportDraft()
                },
                onConfirm: { selectedIDs in
                    Task {
                        await model.importAccounts(from: draft, selectedAccountIDs: selectedIDs)
                    }
                }
            )
        }
        .fileImporter(
            isPresented: $isImportFilePickerPresented,
            allowedContentTypes: [.json],
            allowsMultipleSelection: false
        ) { result in
            switch result {
            case .success(let urls):
                guard let url = urls.first else { return }
                Task { await model.loadAccountsImportDraft(from: url) }
            case .failure(let error):
                model.notice = NoticeMessage(style: .error, text: error.localizedDescription)
            }
        }
        .fileExporter(
            isPresented: $isExportFilePickerPresented,
            document: exportDocument,
            contentType: .json,
            defaultFilename: "CodexManager-accounts.json"
        ) { result in
            model.finishAccountsExport(result: result, accountCount: pendingExportAccountCount)
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
        switch intent {
        case .importAccountsBackup:
            isImportFilePickerPresented = true
            return
        case .exportAccountsBackup:
            isExportSelectionPresented = true
            return
        default:
            break
        }
        Task { await model.handlePageAction(intent) }
    }

    private var importDraftBinding: Binding<AccountsImportDraft?> {
        Binding(
            get: { model.importDraft },
            set: { model.importDraft = $0 }
        )
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
