import Foundation
import os.log

private let storeLogger = Logger(subsystem: "com.nik.mei.codexmanager", category: "StoreFileRepository")
private let settingsLogger = Logger(subsystem: "com.nik.mei.codexmanager", category: "SettingsFileRepository")

final class StoreFileRepository: AccountsStoreRepository, @unchecked Sendable {
    private let paths: FileSystemPaths
    private let fileManager: FileManager
    private let dateProvider: DateProviding
    private let writer: AtomicFileWriter

    init(
        paths: FileSystemPaths,
        fileManager: FileManager = .default,
        dateProvider: DateProviding = SystemDateProvider(),
        writer: AtomicFileWriter = AtomicFileWriter()
    ) {
        self.paths = paths
        self.fileManager = fileManager
        self.dateProvider = dateProvider
        self.writer = writer
    }

    func loadStore() throws -> AccountsStore {
        let path = paths.accountStorePath
        guard fileManager.fileExists(atPath: path.path) else {
            return AccountsStore()
        }

        let data: Data
        do {
            data = try writer.read(from: path)
        } catch {
            storeLogger.error("Failed to read store: \(error.localizedDescription, privacy: .public)")
            throw AppError.io(L10n.tr("error.store.read_failed_format", error.localizedDescription))
        }

        do {
            return try decodeStore(from: data)
        } catch {
            storeLogger.warning("Store corrupted, backing up and resetting: \(error.localizedDescription, privacy: .public)")
            try backupCorruptedStore(raw: data)
            let emptyStore = AccountsStore()
            try saveStore(emptyStore)
            return emptyStore
        }
    }

    func saveStore(_ store: AccountsStore) throws {
        try fileManager.createDirectory(at: paths.applicationSupportDirectory, withIntermediateDirectories: true)

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

        let data: Data
        do {
            data = try encoder.encode(store)
        } catch {
            throw AppError.invalidData(L10n.tr("error.store.serialize_failed_format", error.localizedDescription))
        }

        try writer.writeAtomically(data: data, to: paths.accountStorePath, fileManager: fileManager)
    }

    private func decodeStore(from data: Data) throws -> AccountsStore {
        let decoder = JSONDecoder()
        do {
            return try decoder.decode(AccountsStore.self, from: data)
        } catch {
            throw AppError.invalidData(L10n.tr("error.store.invalid_format_format", error.localizedDescription))
        }
    }

    private func backupCorruptedStore(raw: Data) throws {
        let filename = "accounts.corrupt-\(dateProvider.unixSecondsNow()).json"
        let backupPath = paths.applicationSupportDirectory.appendingPathComponent(filename, isDirectory: false)

        try fileManager.createDirectory(at: paths.applicationSupportDirectory, withIntermediateDirectories: true)
        try raw.write(to: backupPath, options: .atomic)
        AtomicFileWriter.setPrivatePermissions(at: backupPath)
    }
}

final class SettingsFileRepository: SettingsRepository, @unchecked Sendable {
    private struct LegacyAccountsStore: Codable {
        var version: Int = 1
        var accounts: [StoredAccount] = []
        var currentSelection: CurrentAccountSelection?
        var settings: AppSettings = .defaultValue
    }

    private let paths: FileSystemPaths
    private let fileManager: FileManager
    private let writer: AtomicFileWriter

    init(
        paths: FileSystemPaths,
        fileManager: FileManager = .default,
        writer: AtomicFileWriter = AtomicFileWriter()
    ) {
        self.paths = paths
        self.fileManager = fileManager
        self.writer = writer
    }

    func loadSettings() throws -> AppSettings {
        if fileManager.fileExists(atPath: paths.settingsStorePath.path) {
            return try decodeSettings(from: paths.settingsStorePath)
        }

        if fileManager.fileExists(atPath: paths.accountStorePath.path),
           let legacyStore = try decodeLegacyStore(from: paths.accountStorePath) {
            let migratedSettings = legacyStore.settings
            try saveSettings(migratedSettings)
            try saveAccountsStore(
                AccountsStore(
                    version: legacyStore.version,
                    accounts: legacyStore.accounts,
                    currentSelection: legacyStore.currentSelection
                )
            )
            return migratedSettings
        }

        return .defaultValue
    }

    func saveSettings(_ settings: AppSettings) throws {
        try fileManager.createDirectory(at: paths.applicationSupportDirectory, withIntermediateDirectories: true)

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

        let data: Data
        do {
            data = try encoder.encode(settings)
        } catch {
            throw AppError.invalidData(L10n.tr("error.store.serialize_failed_format", error.localizedDescription))
        }

        try writer.writeAtomically(data: data, to: paths.settingsStorePath, fileManager: fileManager)
    }

    private func decodeSettings(from path: URL) throws -> AppSettings {
        let data: Data
        do {
            data = try writer.read(from: path)
        } catch {
            settingsLogger.error("Failed to read settings: \(error.localizedDescription, privacy: .public)")
            throw AppError.io(L10n.tr("error.store.read_failed_format", error.localizedDescription))
        }

        do {
            return try JSONDecoder().decode(AppSettings.self, from: data)
        } catch {
            throw AppError.invalidData(L10n.tr("error.store.invalid_format_format", error.localizedDescription))
        }
    }

    private func decodeLegacyStore(from path: URL) throws -> LegacyAccountsStore? {
        let data = try Data(contentsOf: path)
        return try? JSONDecoder().decode(LegacyAccountsStore.self, from: data)
    }

    private func saveAccountsStore(_ store: AccountsStore) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

        let data: Data
        do {
            data = try encoder.encode(store)
        } catch {
            throw AppError.invalidData(L10n.tr("error.store.serialize_failed_format", error.localizedDescription))
        }

        try writer.writeAtomically(data: data, to: paths.accountStorePath, fileManager: fileManager)
    }
}
