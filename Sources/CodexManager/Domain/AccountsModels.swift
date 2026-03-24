import Foundation

struct AccountsStore: Codable, Equatable {
    var version: Int = 1
    var accounts: [StoredAccount] = []
    var currentSelection: CurrentAccountSelection?
}

struct CurrentAccountSelection: Codable, Equatable {
    var accountID: String
    var selectedAt: Int64
    var sourceDeviceID: String
    var accountKey: String? = nil

    enum CodingKeys: String, CodingKey {
        case accountID = "accountId"
        case selectedAt
        case sourceDeviceID
        case accountKey
    }
}

struct CurrentAccountSelectionPullResult: Equatable, Sendable {
    var didUpdateSelection: Bool
    var changedCurrentAccount: Bool
    var accountID: String?
    var accountKey: String?

    static let noChange = CurrentAccountSelectionPullResult(
        didUpdateSelection: false,
        changedCurrentAccount: false,
        accountID: nil,
        accountKey: nil
    )
}

struct AccountsCloudSyncPullResult: Equatable, Sendable {
    var didUpdateAccounts: Bool
    var remoteSyncedAt: Int64?

    static let noChange = AccountsCloudSyncPullResult(
        didUpdateAccounts: false,
        remoteSyncedAt: nil
    )
}

struct StoredAccount: Codable, Equatable, Identifiable {
    var id: String
    var label: String
    var email: String?
    var accountID: String
    var planType: String?
    var teamName: String?
    var teamAlias: String?
    var authJSON: JSONValue
    var addedAt: Int64
    var updatedAt: Int64
    var usage: UsageSnapshot?
    var usageError: String?
    var principalID: String? = nil

    enum CodingKeys: String, CodingKey {
        case id
        case label
        case email
        case accountID = "accountId"
        case planType
        case teamName
        case teamAlias
        case authJSON = "authJson"
        case addedAt
        case updatedAt
        case usage
        case usageError
        case principalID = "principalId"
    }

    var accountKey: String {
        AccountIdentity.key(for: self)
    }
}

struct AccountSummary: Equatable, Identifiable {
    var id: String
    var label: String
    var email: String?
    var accountID: String
    var planType: String?
    var teamName: String?
    var teamAlias: String?
    var addedAt: Int64
    var updatedAt: Int64
    var usage: UsageSnapshot?
    var usageError: String?
    var isCurrent: Bool
    var principalID: String? = nil

    var accountKey: String {
        AccountIdentity.key(for: self)
    }

    var normalizedPlanLabel: String {
        let normalized = (planType ?? usage?.planType ?? "team")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()

        switch normalized {
        case "free":
            return "FREE"
        case "plus":
            return "PLUS"
        case "pro":
            return "PRO"
        case "enterprise":
            return "ENTERPRISE"
        case "business":
            return "BUSINESS"
        default:
            return "TEAM"
        }
    }

    var displayTeamName: String? {
        if let alias = teamAlias?.trimmingCharacters(in: .whitespacesAndNewlines),
           !alias.isEmpty {
            return alias
        }
        if let teamName = teamName?.trimmingCharacters(in: .whitespacesAndNewlines),
           !teamName.isEmpty {
            return teamName
        }
        return nil
    }

    var shouldDisplayWorkspaceTag: Bool {
        switch normalizedPlanLabel {
        case "TEAM", "BUSINESS", "ENTERPRISE":
            return displayTeamName != nil
        default:
            return false
        }
    }
}

extension AccountsStore {
    func accountSummaries(currentAccountKey: String?) -> [AccountSummary] {
        let resolvedCurrentAccountKey = resolvedCurrentAccountKey(currentAccountKey)

        return accounts.map { account in
            AccountSummary(
                id: account.id,
                label: account.label,
                email: account.email,
                accountID: account.accountID,
                planType: account.planType,
                teamName: account.teamName,
                teamAlias: account.teamAlias,
                addedAt: account.addedAt,
                updatedAt: account.updatedAt,
                usage: account.usage,
                usageError: account.usageError,
                isCurrent: resolvedCurrentAccountKey == account.accountKey,
                principalID: account.principalID
            )
        }
    }

    private func resolvedCurrentAccountKey(_ currentAccountKey: String?) -> String? {
        if let selectionKey = AccountIdentity.normalizedSelectionKey(currentSelection?.accountKey),
           accounts.contains(where: { $0.accountKey == selectionKey }) {
            return selectionKey
        }

        if let selectionAccountID = currentSelection?.accountID {
            let matches = accounts.filter {
                AccountIdentity.normalizedAccountID($0.accountID) == AccountIdentity.normalizedAccountID(selectionAccountID)
            }
            if matches.count == 1 {
                return matches[0].accountKey
            }
        }

        if let currentAccountKey = AccountIdentity.normalizedSelectionKey(currentAccountKey),
           accounts.contains(where: { $0.accountKey == currentAccountKey }) {
            return currentAccountKey
        }

        return nil
    }
}

struct UsageSnapshot: Codable, Equatable {
    var fetchedAt: Int64
    var planType: String?
    var fiveHour: UsageWindow?
    var oneWeek: UsageWindow?
    var credits: CreditSnapshot?
}

struct UsageWindow: Codable, Equatable {
    var usedPercent: Double
    var windowSeconds: Int64
    var resetAt: Int64?
}

struct CreditSnapshot: Codable, Equatable {
    var hasCredits: Bool
    var unlimited: Bool
    var balance: String?
}

struct ExtractedAuth: Equatable {
    var accountID: String
    var accessToken: String
    var email: String?
    var planType: String?
    var teamName: String?
    var principalID: String? = nil

    var accountKey: String {
        AccountIdentity.key(for: self)
    }
}

struct WorkspaceMetadata: Equatable, Sendable {
    var accountID: String
    var workspaceName: String?
    var structure: String?
}

struct ChatGPTOAuthTokens: Equatable, Sendable {
    var accessToken: String
    var refreshToken: String
    var idToken: String
    var apiKey: String?
}
