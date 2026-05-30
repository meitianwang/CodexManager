import Foundation
import CloudKit
import CryptoKit
#if os(macOS)
import Security
#endif

actor CloudKitAccountsSyncService: AccountsCloudSyncServiceProtocol {
    private enum Constants {
        static let containerIdentifier = "iCloud.com.nik.mei.codexmanager"
        static let recordType = "AccountsSnapshot"
        static let recordName = "accounts-snapshot.primary"
        static let subscriptionID = "accounts-snapshot.primary.push"
        static let payloadKey = "payload"
        static let syncedAtKey = "syncedAt"
        static let schemaVersion = 1
    }

    private struct SnapshotPayload: Codable {
        let schemaVersion: Int
        let syncedAt: Int64
        let accounts: [StoredAccount]
    }

    private let storeRepository: AccountsStoreRepository
    private let database: CKDatabase?
    private let dateProvider: DateProviding
    private var pushSubscriptionEnsured = false

    init(
        storeRepository: AccountsStoreRepository,
        dateProvider: DateProviding = SystemDateProvider()
    ) {
        self.storeRepository = storeRepository
        self.database = Self.makeDatabase()
        self.dateProvider = dateProvider
    }

    func pushLocalAccountsIfNeeded() async throws {
        guard database != nil else { return }
        let store = try storeRepository.loadStore()
        let accountsDigest = try digest(for: store.accounts)
        if let record = try await fetchRecordIfExists(),
           let payloadData = record[Constants.payloadKey] as? Data,
           let payload = try? decodeSnapshot(from: payloadData),
           try digest(for: payload.accounts) == accountsDigest {
            return
        }

        let payload = SnapshotPayload(
            schemaVersion: Constants.schemaVersion,
            syncedAt: dateProvider.unixSecondsNow(),
            accounts: store.accounts
        )
        try await saveSnapshotRecord(payload)
    }

    func ensurePushSubscriptionIfNeeded() async throws {
        guard let database else { return }
        guard !pushSubscriptionEnsured else { return }

        let subscription = CKDatabaseSubscription(subscriptionID: Self.pushSubscriptionID)
        let notificationInfo = CKSubscription.NotificationInfo()
        notificationInfo.shouldSendContentAvailable = true
        subscription.notificationInfo = notificationInfo

        let results = try await database.modifySubscriptions(
            saving: [subscription],
            deleting: []
        )
        guard let saveResult = results.saveResults[Self.pushSubscriptionID] else {
            throw AppError.io("CloudKit did not report a result for the accounts snapshot push subscription.")
        }
        switch saveResult {
        case .success:
            pushSubscriptionEnsured = true
        case .failure(let error):
            throw error
        }
    }

    func pullRemoteAccountsIfNeeded(
        currentTime _: Int64,
        maximumSnapshotAgeSeconds _: Int64
    ) async throws -> AccountsCloudSyncPullResult {
        guard database != nil else { return .noChange }
        guard let record = try await fetchRecordIfExists() else {
            return .noChange
        }

        guard let payloadData = record[Constants.payloadKey] as? Data,
              let payload = try? decodeSnapshot(from: payloadData) else {
            return .noChange
        }

        let localStore = try storeRepository.loadStore()
        let remoteDigest = try digest(for: payload.accounts)
        let localDigest = try digest(for: localStore.accounts)
        if remoteDigest == localDigest {
            return AccountsCloudSyncPullResult(
                didUpdateAccounts: false,
                remoteSyncedAt: payload.syncedAt
            )
        }

        let mergedStore = CloudKitAccountsStoreMerge.applyingRemoteSnapshot(
            payload.accounts,
            remoteSyncedAt: payload.syncedAt,
            to: localStore
        )
        guard mergedStore != localStore else {
            return AccountsCloudSyncPullResult(
                didUpdateAccounts: false,
                remoteSyncedAt: payload.syncedAt
            )
        }

        try storeRepository.saveStore(mergedStore)
        return AccountsCloudSyncPullResult(
            didUpdateAccounts: true,
            remoteSyncedAt: payload.syncedAt
        )
    }

    private var recordID: CKRecord.ID {
        CKRecord.ID(recordName: Constants.recordName)
    }

    nonisolated static var pushSubscriptionID: String {
        Constants.subscriptionID
    }

    private func fetchRecordIfExists() async throws -> CKRecord? {
        guard let database else { return nil }
        do {
            return try await database.record(for: recordID)
        } catch let ckError as CKError where ckError.code == .unknownItem {
            return nil
        }
    }

    private func save(_ record: CKRecord) async throws -> CKRecord {
        guard let database else {
            throw AppError.io("CloudKit is unavailable for the current process.")
        }
        return try await database.save(record)
    }

    private func decodeSnapshot(from data: Data) throws -> SnapshotPayload {
        let decoder = JSONDecoder()
        do {
            return try decoder.decode(SnapshotPayload.self, from: data)
        } catch {
            throw AppError.invalidData("CloudKit accounts snapshot is invalid: \(error.localizedDescription)")
        }
    }

    private func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        do {
            return try encoder.encode(value)
        } catch {
            throw AppError.invalidData("Failed to serialize accounts snapshot: \(error.localizedDescription)")
        }
    }

    private func digest(for accounts: [StoredAccount]) throws -> String {
        let data = try encode(accounts)
        let digest = SHA256.hash(data: data)
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    private func saveSnapshotRecord(_ payload: SnapshotPayload) async throws {
        let payloadData = try encode(payload)
        let record = try await fetchRecordIfExists() ?? CKRecord(
            recordType: Constants.recordType,
            recordID: recordID
        )

        record[Constants.payloadKey] = payloadData as CKRecordValue
        record[Constants.syncedAtKey] = payload.syncedAt as CKRecordValue
        _ = try await save(record)
    }

    private static func makeDatabase() -> CKDatabase? {
        guard hasCloudKitEntitlement() else {
            return nil
        }
        let container = CKContainer(identifier: Constants.containerIdentifier)
        return container.privateCloudDatabase
    }

    private static func hasCloudKitEntitlement() -> Bool {
        #if os(macOS)
        guard let task = SecTaskCreateFromSelf(nil),
              let value = SecTaskCopyValueForEntitlement(
                task,
                "com.apple.developer.icloud-services" as CFString,
                nil
              ) else {
            return false
        }

        if let services = value as? [String] {
            return services.contains("CloudKit") || services.contains("CloudKit-Anonymous")
        }
        if let services = value as? NSArray {
            return services.contains { element in
                guard let service = element as? String else { return false }
                return service == "CloudKit" || service == "CloudKit-Anonymous"
            }
        }

        return false
        #else
        return true
        #endif
    }
}

enum CloudKitAccountsStoreMerge {
    static func applyingRemoteAccounts(_ remoteAccounts: [StoredAccount], to latestStore: AccountsStore) -> AccountsStore {
        applyingRemoteSnapshot(
            remoteAccounts,
            remoteSyncedAt: remoteAccounts.map(\.updatedAt).max() ?? 0,
            to: latestStore
        )
    }

    static func applyingRemoteSnapshot(
        _ remoteAccounts: [StoredAccount],
        remoteSyncedAt: Int64,
        to latestStore: AccountsStore
    ) -> AccountsStore {
        var mergedStore = latestStore
        var remainingLocalAccounts = latestStore.accounts
        var mergedAccounts: [StoredAccount] = []
        mergedAccounts.reserveCapacity(max(latestStore.accounts.count, remoteAccounts.count))

        for remoteAccount in remoteAccounts {
            if let localIndex = remainingLocalAccounts.firstIndex(where: {
                AccountIdentity.matches($0, remoteAccount)
            }) {
                let localAccount = remainingLocalAccounts.remove(at: localIndex)
                mergedAccounts.append(
                    mergeMatchedAccount(local: localAccount, remote: remoteAccount)
                )
            } else {
                mergedAccounts.append(remoteAccount)
            }
        }

        for localAccount in remainingLocalAccounts {
            if shouldKeepLocalOnlyAccount(localAccount, remoteSyncedAt: remoteSyncedAt) {
                mergedAccounts.append(localAccount)
            }
        }

        mergedStore.accounts = mergedAccounts
        return mergedStore
    }

    private static func mergeMatchedAccount(local: StoredAccount, remote: StoredAccount) -> StoredAccount {
        let remoteMetadataWins = remote.updatedAt >= local.updatedAt
        let metadataWinner = remoteMetadataWins ? remote : local
        let authWinner = preferredAuthSource(local: local, remote: remote, fallback: metadataWinner)
        let usageWinner = preferredUsageSource(local: local, remote: remote)

        var merged = metadataWinner
        merged.id = local.id
        merged.authJSON = authWinner.authJSON
        merged.teamName = preferredMetadataValue(
            primary: metadataWinner.teamName,
            fallback: remoteMetadataWins ? local.teamName : remote.teamName
        )
        merged.teamAlias = preferredMetadataValue(
            primary: metadataWinner.teamAlias,
            fallback: remoteMetadataWins ? local.teamAlias : remote.teamAlias
        )
        merged.usage = usageWinner.usage
        merged.usageError = usageWinner.usageError
        merged.updatedAt = max(local.updatedAt, remote.updatedAt)
        return merged
    }

    private static func preferredMetadataValue(primary: String?, fallback: String?) -> String? {
        if let primary = normalizedMetadataValue(primary) {
            return primary
        }
        return normalizedMetadataValue(fallback)
    }

    private static func normalizedMetadataValue(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func preferredUsageSource(local: StoredAccount, remote: StoredAccount) -> StoredAccount {
        let localUsageStamp = usageTimestamp(for: local)
        let remoteUsageStamp = usageTimestamp(for: remote)

        if remoteUsageStamp != localUsageStamp {
            return remoteUsageStamp > localUsageStamp ? remote : local
        }

        if remote.usage != local.usage {
            return remote.updatedAt >= local.updatedAt ? remote : local
        }

        if remote.usageError != local.usageError {
            return remote.updatedAt >= local.updatedAt ? remote : local
        }

        return local
    }

    private static func preferredAuthSource(
        local: StoredAccount,
        remote: StoredAccount,
        fallback: StoredAccount
    ) -> StoredAccount {
        guard local.authJSON != remote.authJSON else {
            return fallback
        }

        let localAuthTimestamp = authTimestamp(for: local)
        let remoteAuthTimestamp = authTimestamp(for: remote)
        if localAuthTimestamp != remoteAuthTimestamp {
            return (remoteAuthTimestamp ?? .distantPast) > (localAuthTimestamp ?? .distantPast)
                ? remote
                : local
        }

        return fallback
    }

    private static func authTimestamp(for account: StoredAccount) -> Date? {
        guard let rawValue = account.authJSON["last_refresh"]?.stringValue?
            .trimmingCharacters(in: .whitespacesAndNewlines),
            !rawValue.isEmpty else {
            return nil
        }
        return parseAuthTimestamp(rawValue)
    }

    private static func parseAuthTimestamp(_ value: String) -> Date? {
        for candidate in authTimestampCandidates(for: value) {
            let fractionalFormatter = ISO8601DateFormatter()
            fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let parsed = fractionalFormatter.date(from: candidate) {
                return parsed
            }

            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime]
            if let parsed = formatter.date(from: candidate) {
                return parsed
            }
        }
        return nil
    }

    private static func authTimestampCandidates(for value: String) -> [String] {
        if value.range(of: #"(Z|[+-]\d{2}:\d{2})$"#, options: .regularExpression) != nil {
            return [value]
        }
        return [value, "\(value)Z"]
    }

    private static func usageTimestamp(for account: StoredAccount) -> Int64 {
        if let fetchedAt = account.usage?.fetchedAt {
            return fetchedAt
        }
        if account.usageError != nil {
            return account.updatedAt
        }
        return 0
    }

    private static func shouldKeepLocalOnlyAccount(
        _ localAccount: StoredAccount,
        remoteSyncedAt: Int64
    ) -> Bool {
        localAccount.updatedAt > remoteSyncedAt
    }
}

enum CloudKitSelectionMerge {
    static func shouldApplyRemoteSelection(
        _ remoteSelection: CurrentAccountSelection,
        over localSelection: CurrentAccountSelection?
    ) -> Bool {
        guard let localSelection else { return true }
        return remoteSelection.selectedAt > localSelection.selectedAt
    }

    static func shouldKeepServerSelection(
        _ serverSelection: CurrentAccountSelection,
        over localSelection: CurrentAccountSelection
    ) -> Bool {
        serverSelection == localSelection || serverSelection.selectedAt > localSelection.selectedAt
    }
}
