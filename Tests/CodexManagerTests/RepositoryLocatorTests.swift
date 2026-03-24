import XCTest
@testable import CodexManager

final class RepositoryLocatorTests: XCTestCase {
    func testProxydManifestURLPrefersCurrentSourceLayout() throws {
        let root = try makeTemporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }

        let currentManifest = root
            .appendingPathComponent("Sources/CodexManager/Resources/proxyd-src/proxyd", isDirectory: true)
        let legacyManifest = root
            .appendingPathComponent("src-tauri/proxyd", isDirectory: true)
        try FileManager.default.createDirectory(at: currentManifest, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: legacyManifest, withIntermediateDirectories: true)
        FileManager.default.createFile(
            atPath: currentManifest.appendingPathComponent("Cargo.toml").path,
            contents: Data()
        )
        FileManager.default.createFile(
            atPath: legacyManifest.appendingPathComponent("Cargo.toml").path,
            contents: Data()
        )

        let manifest = RepositoryLocator.proxydManifestURL(in: root)

        XCTAssertEqual(
            manifest?.path,
            currentManifest.appendingPathComponent("Cargo.toml").path
        )
    }

    func testFindRepoRootDiscoversCurrentSourceLayoutFromNestedFile() throws {
        let root = try makeTemporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }

        let manifestDirectory = root
            .appendingPathComponent("Sources/CodexManager/Resources/proxyd-src/proxyd", isDirectory: true)
        try FileManager.default.createDirectory(at: manifestDirectory, withIntermediateDirectories: true)
        FileManager.default.createFile(
            atPath: manifestDirectory.appendingPathComponent("Cargo.toml").path,
            contents: Data()
        )

        let nestedFile = root
            .appendingPathComponent("Sources/CodexManager/App/AppContainer.swift", isDirectory: false)
        try FileManager.default.createDirectory(
            at: nestedFile.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        FileManager.default.createFile(atPath: nestedFile.path, contents: Data())

        let locatedRoot = RepositoryLocator.findRepoRoot(startingAt: nestedFile)

        XCTAssertEqual(locatedRoot?.path, root.path)
    }

    private func makeTemporaryRoot() throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("codexmanager-repository-locator-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }
}
