import Foundation

struct AccountsTransferPackage: Codable, Equatable {
    static let formatIdentifier = "com.nik.mei.codexmanager.accounts"
    static let currentVersion = 1

    var format: String
    var version: Int
    var exportedAt: Int64
    var accounts: [StoredAccount]

    init(exportedAt: Int64, accounts: [StoredAccount]) {
        self.format = Self.formatIdentifier
        self.version = Self.currentVersion
        self.exportedAt = exportedAt
        self.accounts = accounts
    }
}

struct AccountsImportResult: Equatable {
    var insertedCount: Int
    var updatedCount: Int

    var totalCount: Int {
        insertedCount + updatedCount
    }
}

struct AccountTransferSelectableItem: Equatable, Identifiable {
    var id: String
    var label: String
    var email: String?
    var accountID: String
    var planLabel: String
    var teamName: String?
    var isCurrent: Bool

    init(account: AccountSummary) {
        self.id = account.id
        self.label = account.label
        self.email = account.email
        self.accountID = account.accountID
        self.planLabel = account.normalizedPlanLabel
        self.teamName = account.displayTeamName
        self.isCurrent = account.isCurrent
    }

    init(account: StoredAccount) {
        let summary = AccountsStore(accounts: [account]).accountSummaries(currentAccountKey: nil)[0]
        self.id = account.id
        self.label = summary.label
        self.email = summary.email
        self.accountID = summary.accountID
        self.planLabel = summary.normalizedPlanLabel
        self.teamName = summary.displayTeamName
        self.isCurrent = false
    }
}

struct AccountsImportDraft: Identifiable {
    let id = UUID()
    var package: AccountsTransferPackage
    var accounts: [AccountTransferSelectableItem]

    var defaultSelectedIDs: Set<String> {
        Set(accounts.map(\.id))
    }
}
