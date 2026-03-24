import XCTest
@testable import CodexManager

final class AccountsWidgetSnapshotStoreTests: XCTestCase {
    func testLoadReturnsEmptyForInvalidSnapshotData() throws {
        let tempDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tempDirectory, withIntermediateDirectories: true)
        let snapshotURL = tempDirectory.appendingPathComponent("accounts-widget.json", isDirectory: false)
        try Data("not json".utf8).write(to: snapshotURL, options: .atomic)

        let store = AccountsWidgetSnapshotStore(
            fileManager: .default,
            snapshotURLProvider: { snapshotURL }
        )

        XCTAssertEqual(store.load(), .empty)
    }

    func testSaveWritesSnapshotToExplicitURL() throws {
        let tempDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let snapshotURL = tempDirectory.appendingPathComponent("accounts-widget.json", isDirectory: false)
        let snapshot = AccountsWidgetSnapshot(
            generatedAt: 1,
            currentCard: AccountsWidgetCardSnapshot(
                id: "current",
                planLabel: "PRO",
                workspaceLabel: nil,
                accountLabel: "current@example.com",
                fiveHour: AccountsWidgetWindowSnapshot(
                    title: "5h",
                    progressFraction: 0.2,
                    usedText: "20%",
                    remainingText: "80%",
                    resetText: "--"
                ),
                oneWeek: AccountsWidgetWindowSnapshot(
                    title: "1w",
                    progressFraction: 0.3,
                    usedText: "30%",
                    remainingText: "70%",
                    resetText: "--"
                )
            ),
            secondaryCard: nil,
            rows: []
        )

        let store = AccountsWidgetSnapshotStore(
            fileManager: .default,
            snapshotURLProvider: { snapshotURL }
        )

        try store.save(snapshot)

        let data = try Data(contentsOf: snapshotURL)
        let decoded = try JSONDecoder().decode(AccountsWidgetSnapshot.self, from: data)
        XCTAssertEqual(decoded, snapshot)
    }
}
