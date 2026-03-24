import XCTest
@testable import CodexManager

final class RemoteProxyAccountsPayloadBuilderTests: XCTestCase {
    func testBuildMapsLocaleToRemoteCompatibleIdentifier() throws {
        let fileManager = FileManager.default
        let tempDirectory = fileManager.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try fileManager.createDirectory(at: tempDirectory, withIntermediateDirectories: true)
        defer { try? fileManager.removeItem(at: tempDirectory) }

        let storePath = tempDirectory.appendingPathComponent("accounts.json", isDirectory: false)
        let authPath = tempDirectory.appendingPathComponent("auth.json", isDirectory: false)

        let store = AccountsStore(
            version: 1,
            accounts: [
                StoredAccount(
                    id: UUID().uuidString,
                    label: "test@example.com",
                    email: "test@example.com",
                    accountID: "acc-1",
                    planType: "team",
                    teamName: nil,
                    teamAlias: nil,
                    authJSON: .object([
                        "auth_mode": .string("chatgpt"),
                        "tokens": .object([
                            "access_token": .string("access"),
                            "id_token": .string(makeJWT(email: "test@example.com", accountID: "acc-1", planType: "team")),
                            "account_id": .string("acc-1"),
                        ]),
                    ]),
                    addedAt: 1,
                    updatedAt: 1,
                    usage: nil,
                    usageError: nil,
                    principalID: nil
                ),
            ],
            currentSelection: nil,
            settings: AppSettings(
                launchAtStartup: false,
                launchCodexAfterSwitch: true,
                autoSmartSwitch: false,
                syncOpencodeOpenaiAuth: false,
                localProxyHostAPIOnly: false,
                restartEditorsOnSwitch: false,
                restartEditorTargets: [],
                autoStartApiProxy: false,
                proxyConfiguration: .defaultValue,
                remoteServers: [],
                locale: AppLocale.japanese.identifier
            )
        )

        let data = try JSONEncoder().encode(store)
        try data.write(to: storePath, options: .atomic)

        let payload = try RemoteProxyAccountsPayloadBuilder(
            sourceAccountStorePath: storePath,
            sourceAuthPath: authPath,
            fileManager: fileManager
        ).build()

        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: payload) as? [String: Any])
        let settings = try XCTUnwrap(root["settings"] as? [String: Any])
        XCTAssertEqual(settings["locale"] as? String, "ja-JP")
    }

    private func makeJWT(email: String, accountID: String, planType: String) -> String {
        let header = ["alg": "none", "typ": "JWT"]
        let payload: [String: Any] = [
            "email": email,
            "https://api.openai.com/auth": [
                "chatgpt_account_id": accountID,
                "chatgpt_plan_type": planType,
            ],
        ]
        return "\(base64URL(header)).\(base64URL(payload)).signature"
    }

    private func base64URL(_ object: [String: Any]) -> String {
        let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        return data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
