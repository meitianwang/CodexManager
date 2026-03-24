import XCTest
@testable import CodexManager

final class CloudKitProxyControlSyncServiceTests: XCTestCase {
    func testSemanticSnapshotDigestChangesWhenPreferredPortTextChanges() throws {
        var snapshot = makeSnapshot()
        let baselineDigest = try CloudKitProxyControlSyncService.semanticSnapshotDigest(for: snapshot)

        snapshot.preferredProxyPort = nil
        snapshot.preferredProxyPortText = "custom-port"
        let updatedDigest = try CloudKitProxyControlSyncService.semanticSnapshotDigest(for: snapshot)

        XCTAssertNotEqual(updatedDigest, baselineDigest)
    }

    func testSemanticSnapshotDigestChangesWhenRemoteStatusRefreshTimestampChanges() throws {
        var snapshot = makeSnapshot()
        let baselineDigest = try CloudKitProxyControlSyncService.semanticSnapshotDigest(for: snapshot)

        snapshot.remoteStatusesSyncedAt = (snapshot.remoteStatusesSyncedAt ?? 0) + 1_000
        let updatedDigest = try CloudKitProxyControlSyncService.semanticSnapshotDigest(for: snapshot)

        XCTAssertNotEqual(updatedDigest, baselineDigest)
    }

    private func makeSnapshot() -> ProxyControlSnapshot {
        let server = RemoteServerConfig(
            id: "server-1",
            label: "Tokyo",
            host: "1.2.3.4",
            sshPort: 22,
            sshUser: "root",
            authMode: "keyPath",
            identityFile: "~/.ssh/id_ed25519",
            privateKey: nil,
            password: nil,
            remoteDir: "/opt/codex-tools",
            listenPort: 8787
        )

        return ProxyControlSnapshot(
            syncedAt: 1_763_216_000_000,
            sourceDeviceID: "macos-proxy-bridge",
            proxyStatus: ApiProxyStatus(
                running: true,
                port: 8787,
                apiKey: "api-key",
                baseURL: "http://127.0.0.1:8787",
                availableAccounts: 3,
                activeAccountID: "acct-1",
                activeAccountLabel: "Primary",
                lastError: nil
            ),
            preferredProxyPort: 8787,
            preferredProxyPortText: "8787",
            autoStartProxy: true,
            cloudflaredStatus: CloudflaredStatus(
                installed: true,
                binaryPath: "/usr/local/bin/cloudflared",
                running: true,
                tunnelMode: .quick,
                publicURL: "https://example.trycloudflare.com",
                customHostname: nil,
                useHTTP2: true,
                lastError: nil
            ),
            cloudflaredTunnelMode: .quick,
            cloudflaredNamedInput: NamedCloudflaredTunnelInput(
                apiToken: "",
                accountID: "",
                zoneID: "",
                hostname: ""
            ),
            cloudflaredUseHTTP2: true,
            publicAccessEnabled: true,
            remoteServers: [server],
            remoteStatusesSyncedAt: 1_763_216_000_000,
            remoteStatuses: [
                server.id: RemoteProxyStatus(
                    installed: true,
                    serviceInstalled: true,
                    running: true,
                    enabled: true,
                    serviceName: "codexmanager-proxy",
                    pid: 42,
                    baseURL: "http://1.2.3.4:8787",
                    apiKey: "remote-api-key",
                    lastError: nil
                )
            ],
            remoteLogs: [server.id: "hello"],
            lastHandledCommandID: nil,
            lastCommandError: nil
        )
    }
}
