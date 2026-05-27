import XCTest
@testable import CodexManager

final class AccountsTransferMergeTests: XCTestCase {
    func testImportUpdatesMatchingAccountAndInsertsNewAccount() {
        let existing = makeAccount(
            id: "local-1",
            email: "dev@example.com",
            accountID: "acct-1",
            label: "Local",
            updatedAt: 10
        )
        let updated = makeAccount(
            id: "remote-1",
            email: "dev@example.com",
            accountID: "acct-1",
            label: "Remote",
            updatedAt: 20
        )
        let inserted = makeAccount(
            id: "remote-2",
            email: "new@example.com",
            accountID: "acct-2",
            label: "New",
            updatedAt: 20
        )

        let merge = AccountsTransferMerge.applying(
            importedAccounts: [updated, inserted],
            selectedAccountIDs: ["remote-1", "remote-2"],
            to: AccountsStore(accounts: [existing]),
            now: 99
        )

        XCTAssertEqual(merge.result.insertedCount, 1)
        XCTAssertEqual(merge.result.updatedCount, 1)
        XCTAssertEqual(merge.store.accounts.count, 2)
        XCTAssertEqual(merge.store.accounts[0].id, "local-1")
        XCTAssertEqual(merge.store.accounts[0].label, "Remote")
        XCTAssertEqual(merge.store.accounts[0].addedAt, existing.addedAt)
        XCTAssertEqual(merge.store.accounts[0].updatedAt, 99)
        XCTAssertEqual(merge.store.accounts[1].id, "remote-2")
    }

    func testImportAssignsNewIDWhenDifferentAccountCollidesWithExistingID() {
        let existing = makeAccount(
            id: "same-id",
            email: "one@example.com",
            accountID: "acct-1",
            label: "One"
        )
        let imported = makeAccount(
            id: "same-id",
            email: "two@example.com",
            accountID: "acct-2",
            label: "Two"
        )

        let merge = AccountsTransferMerge.applying(
            importedAccounts: [imported],
            selectedAccountIDs: ["same-id"],
            to: AccountsStore(accounts: [existing]),
            now: 99
        )

        XCTAssertEqual(merge.result.insertedCount, 1)
        XCTAssertEqual(merge.store.accounts.count, 2)
        XCTAssertEqual(merge.store.accounts[0].id, "same-id")
        XCTAssertNotEqual(merge.store.accounts[1].id, "same-id")
        XCTAssertEqual(merge.store.accounts[1].email, "two@example.com")
    }

    private func makeAccount(
        id: String,
        email: String,
        accountID: String,
        label: String,
        updatedAt: Int64 = 2
    ) -> StoredAccount {
        StoredAccount(
            id: id,
            label: label,
            email: email,
            accountID: accountID,
            planType: "prolite",
            teamName: nil,
            teamAlias: nil,
            authJSON: .object([
                "auth_mode": .string("chatgpt")
            ]),
            addedAt: 1,
            updatedAt: updatedAt,
            usage: nil,
            usageError: nil,
            principalID: email
        )
    }
}
