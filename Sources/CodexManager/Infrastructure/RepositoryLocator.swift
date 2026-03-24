import Foundation

enum RepositoryLocator {
    static let proxydManifestRelativePaths = [
        "Sources/CodexManager/Resources/proxyd-src/proxyd/Cargo.toml",
        "src-tauri/proxyd/Cargo.toml",
    ]
    static let proxydBundledManifestRelativePath = "proxyd-src/proxyd/Cargo.toml"
    static let proxydBinaryName = "codex-tools-proxyd"

    static func proxydManifestURL(in root: URL) -> URL? {
        for relativePath in proxydManifestRelativePaths {
            let candidate = root.appendingPathComponent(relativePath, isDirectory: false)
            if FileManager.default.fileExists(atPath: candidate.path) {
                return candidate
            }
        }
        return nil
    }

    static func findRepoRoot(startingAt start: URL = URL(fileURLWithPath: #filePath)) -> URL? {
        var current = start
        if !current.hasDirectoryPath {
            current.deleteLastPathComponent()
        }

        for _ in 0..<12 {
            if proxydManifestURL(in: current) != nil {
                return current
            }
            let next = current.deletingLastPathComponent()
            if next.path == current.path {
                break
            }
            current = next
        }

        var cwd = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        for _ in 0..<8 {
            if proxydManifestURL(in: cwd) != nil {
                return cwd
            }
            let next = cwd.deletingLastPathComponent()
            if next.path == cwd.path {
                break
            }
            cwd = next
        }

        return nil
    }
}
