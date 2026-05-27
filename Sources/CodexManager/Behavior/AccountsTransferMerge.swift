import Foundation

enum AccountsTransferMerge {
    static func applying(
        importedAccounts: [StoredAccount],
        selectedAccountIDs: Set<String>,
        to store: AccountsStore,
        now: Int64
    ) -> (store: AccountsStore, result: AccountsImportResult) {
        var merged = store
        var insertedCount = 0
        var updatedCount = 0

        for account in importedAccounts where selectedAccountIDs.contains(account.id) {
            var incoming = account
            incoming.updatedAt = now
            if incoming.addedAt <= 0 {
                incoming.addedAt = now
            }

            if let existingIndex = merged.accounts.firstIndex(where: { AccountIdentity.matches($0, incoming) }) {
                let existing = merged.accounts[existingIndex]
                incoming.id = existing.id
                incoming.addedAt = existing.addedAt
                merged.accounts[existingIndex] = incoming
                updatedCount += 1
                continue
            }

            if merged.accounts.contains(where: { $0.id == incoming.id }) {
                incoming.id = UUID().uuidString
            }
            merged.accounts.append(incoming)
            insertedCount += 1
        }

        return (
            merged,
            AccountsImportResult(insertedCount: insertedCount, updatedCount: updatedCount)
        )
    }
}
