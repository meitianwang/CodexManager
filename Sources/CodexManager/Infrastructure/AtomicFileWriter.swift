import Foundation
import os.log

private let fileWriterLogger = Logger(subsystem: "com.nik.mei.codexmanager", category: "AtomicFileWriter")

/// Thread-safe atomic file writer shared by all file-backed repositories.
/// Provides NSLock-based synchronization and atomic write-then-replace semantics.
final class AtomicFileWriter: @unchecked Sendable {
    private let lock = NSLock()

    /// Read data from the given URL while holding the lock to prevent concurrent writes.
    func read(from url: URL) throws -> Data {
        lock.lock()
        defer { lock.unlock() }
        return try Data(contentsOf: url)
    }

    /// Atomically write `data` to `destination`, creating intermediate directories if needed.
    func writeAtomically(data: Data, to destination: URL, fileManager: FileManager = .default) throws {
        lock.lock()
        defer { lock.unlock() }

        let parentDirectory = destination.deletingLastPathComponent()
        try fileManager.createDirectory(at: parentDirectory, withIntermediateDirectories: true)

        let tempURL = parentDirectory
            .appendingPathComponent(".\(destination.lastPathComponent).tmp-\(UUID().uuidString)", isDirectory: false)

        do {
            try data.write(to: tempURL, options: .withoutOverwriting)
            Self.setPrivatePermissions(at: tempURL)
            _ = try fileManager.replaceItemAt(destination, withItemAt: tempURL)
            Self.setPrivatePermissions(at: destination)
        } catch {
            try? fileManager.removeItem(at: tempURL)
            if !fileManager.fileExists(atPath: destination.path) {
                do {
                    try data.write(to: destination, options: .atomic)
                    Self.setPrivatePermissions(at: destination)
                    return
                } catch {
                    fileWriterLogger.error("Atomic write fallback failed: \(error.localizedDescription, privacy: .public)")
                    throw AppError.io(L10n.tr("error.store.write_failed_format", error.localizedDescription))
                }
            }
            fileWriterLogger.error("Atomic write failed: \(error.localizedDescription, privacy: .public)")
            throw AppError.io(L10n.tr("error.store.atomic_write_failed_format", error.localizedDescription))
        }
    }

    static func setPrivatePermissions(at url: URL) {
        #if canImport(Darwin)
        _ = chmod(url.path, S_IRUSR | S_IWUSR)
        #endif
    }
}
