import Foundation

extension AccountsCoordinator {
    func makeAccountsTransferPackage(accountIDs: Set<String>) throws -> AccountsTransferPackage {
        guard !accountIDs.isEmpty else {
            throw AppError.invalidData(L10n.tr("error.accounts.no_accounts_selected"))
        }

        let store = try storeRepository.loadStore()
        let selectedAccounts = store.accounts.filter { accountIDs.contains($0.id) }
        guard !selectedAccounts.isEmpty else {
            throw AppError.invalidData(L10n.tr("error.accounts.export_package_empty"))
        }

        return AccountsTransferPackage(
            exportedAt: dateProvider.unixSecondsNow(),
            accounts: selectedAccounts
        )
    }

    func encodeAccountsTransferPackage(accountIDs: Set<String>) throws -> Data {
        let package = try makeAccountsTransferPackage(accountIDs: accountIDs)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(package)
    }

    func loadAccountsTransferPackage(from url: URL) throws -> AccountsTransferPackage {
        let didAccess = url.startAccessingSecurityScopedResource()
        defer {
            if didAccess {
                url.stopAccessingSecurityScopedResource()
            }
        }

        let data = try Data(contentsOf: url)
        let package: AccountsTransferPackage
        do {
            package = try JSONDecoder().decode(AccountsTransferPackage.self, from: data)
        } catch {
            throw AppError.invalidData(L10n.tr("error.accounts.import_file_invalid"))
        }

        try validateAccountsTransferPackage(package)
        return package
    }

    func importAccountsTransferPackage(
        _ package: AccountsTransferPackage,
        selectedAccountIDs: Set<String>
    ) throws -> AccountsImportResult {
        try validateAccountsTransferPackage(package)
        guard !selectedAccountIDs.isEmpty else {
            throw AppError.invalidData(L10n.tr("error.accounts.no_accounts_selected"))
        }

        let store = try storeRepository.loadStore()
        let merged = AccountsTransferMerge.applying(
            importedAccounts: package.accounts,
            selectedAccountIDs: selectedAccountIDs,
            to: store,
            now: dateProvider.unixSecondsNow()
        )
        guard merged.result.totalCount > 0 else {
            throw AppError.invalidData(L10n.tr("error.accounts.no_accounts_selected"))
        }

        try storeRepository.saveStore(merged.store)
        return merged.result
    }

    private func validateAccountsTransferPackage(_ package: AccountsTransferPackage) throws {
        guard package.format == AccountsTransferPackage.formatIdentifier else {
            throw AppError.invalidData(L10n.tr("error.accounts.import_file_invalid"))
        }
        guard package.version <= AccountsTransferPackage.currentVersion else {
            throw AppError.invalidData(
                L10n.tr("error.accounts.import_file_unsupported_version_format", "\(package.version)")
            )
        }
        guard !package.accounts.isEmpty else {
            throw AppError.invalidData(L10n.tr("error.accounts.import_file_empty"))
        }
    }
}
