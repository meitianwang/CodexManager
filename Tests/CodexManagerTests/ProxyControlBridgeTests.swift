import XCTest
@testable import CodexManager

final class ProxyControlBridgeTests: XCTestCase {
    func testStartDoesNotRunBridgeLoopOnIOS() async throws {
        let cloudSyncService = SpyProxyControlCloudSyncService()
        let bridge = makeBridge(
            cloudSyncService: cloudSyncService,
            runtimePlatform: .iOS
        )

        await bridge.start()
        try? await Task.sleep(for: .milliseconds(150))
        await bridge.stop()

        let metrics = await cloudSyncService.readMetrics()
        XCTAssertEqual(metrics.ensurePushSubscriptionCallCount, 0)
        XCTAssertEqual(metrics.pushLocalSnapshotCallCount, 0)
        XCTAssertEqual(metrics.pullPendingCommandCallCount, 0)
    }

    func testStartRunsBridgeLoopOnMacOS() async throws {
        let cloudSyncService = SpyProxyControlCloudSyncService()
        let bridge = makeBridge(
            cloudSyncService: cloudSyncService,
            runtimePlatform: .macOS
        )

        await bridge.start()
        try? await Task.sleep(for: .milliseconds(150))
        await bridge.stop()

        let metrics = await cloudSyncService.readMetrics()
        XCTAssertGreaterThanOrEqual(metrics.ensurePushSubscriptionCallCount, 1)
        XCTAssertGreaterThanOrEqual(metrics.pullPendingCommandCallCount, 1)
        XCTAssertGreaterThanOrEqual(metrics.pushLocalSnapshotCallCount, 1)
    }

    func testStartPublishesSnapshotWithoutWaitingForSlowRemoteStatuses() async throws {
        let cloudSyncService = SpyProxyControlCloudSyncService()
        let slowRemoteService = SlowRemoteProxyService(delay: .milliseconds(600))
        let bridge = makeBridge(
            cloudSyncService: cloudSyncService,
            runtimePlatform: .macOS,
            remoteService: slowRemoteService,
            settings: AppSettings(
                launchAtStartup: false,
                launchCodexAfterSwitch: true,
                autoSmartSwitch: false,
                syncOpencodeOpenaiAuth: false,
                restartEditorsOnSwitch: false,
                restartEditorTargets: [],
                autoStartApiProxy: false,
                remoteServers: [makeRemoteServer()],
                locale: AppLocale.systemDefault.identifier
            )
        )

        await bridge.start()
        try? await Task.sleep(for: .milliseconds(150))

        let metrics = await cloudSyncService.readMetrics()
        XCTAssertGreaterThanOrEqual(metrics.pushLocalSnapshotCallCount, 1)

        await bridge.stop()
    }

    func testRemoteStatusRefreshPublishesUpdatedSnapshotInParallel() async throws {
        let cloudSyncService = SpyProxyControlCloudSyncService()
        let slowRemoteService = SlowRemoteProxyService(delay: .milliseconds(300))
        let bridge = makeBridge(
            cloudSyncService: cloudSyncService,
            runtimePlatform: .macOS,
            remoteService: slowRemoteService,
            settings: AppSettings(
                launchAtStartup: false,
                launchCodexAfterSwitch: true,
                autoSmartSwitch: false,
                syncOpencodeOpenaiAuth: false,
                restartEditorsOnSwitch: false,
                restartEditorTargets: [],
                autoStartApiProxy: false,
                remoteServers: [
                    makeRemoteServer(id: "server-1", label: "Tokyo"),
                    makeRemoteServer(id: "server-2", label: "Seoul"),
                    makeRemoteServer(id: "server-3", label: "Paris"),
                ],
                locale: AppLocale.systemDefault.identifier
            )
        )

        await bridge.start()
        try? await Task.sleep(for: .milliseconds(550))

        let metrics = await cloudSyncService.readMetrics()
        XCTAssertGreaterThanOrEqual(metrics.pushLocalSnapshotCallCount, 2)
        XCTAssertEqual(metrics.lastSnapshotRemoteStatusCount, 3)

        await bridge.stop()
    }

    func testPerformLocalCommandPushesSnapshotImmediately() async throws {
        let cloudSyncService = SpyProxyControlCloudSyncService()
        let bridge = makeBridge(
            cloudSyncService: cloudSyncService,
            runtimePlatform: .macOS
        )

        let command = ProxyControlCommand(
            id: UUID().uuidString,
            createdAt: 1_763_216_000_000,
            sourceDeviceID: "macos-proxy-control",
            kind: .refreshStatus,
            preferredProxyPort: nil,
            autoStartProxy: nil,
            cloudflaredInput: nil,
            remoteServer: nil,
            remoteServerID: nil,
            logLines: nil
        )

        _ = try await bridge.performLocalCommand(command)

        let metrics = await cloudSyncService.readMetrics()
        XCTAssertEqual(metrics.pushLocalSnapshotCallCount, 1)
    }

    func testPerformLocalCommandBroadcastsLocalSnapshotUpdate() async throws {
        let cloudSyncService = SpyProxyControlCloudSyncService()
        let bridge = makeBridge(
            cloudSyncService: cloudSyncService,
            runtimePlatform: .macOS
        )
        let expectation = expectation(description: "proxy snapshot broadcast")

        let observer = NotificationCenter.default.addObserver(
            forName: .codexManagerLocalProxySnapshotDidUpdate,
            object: nil,
            queue: nil
        ) { notification in
            let snapshot = notification.userInfo?[ProxyControlNotificationPayloadKey.snapshot] as? ProxyControlSnapshot
            XCTAssertNotNil(snapshot)
            expectation.fulfill()
        }
        defer {
            NotificationCenter.default.removeObserver(observer)
        }

        let command = ProxyControlCommand(
            id: UUID().uuidString,
            createdAt: 1_763_216_000_000,
            sourceDeviceID: "macos-proxy-control",
            kind: .refreshStatus,
            preferredProxyPort: nil,
            autoStartProxy: nil,
            cloudflaredInput: nil,
            remoteServer: nil,
            remoteServerID: nil,
            logLines: nil
        )

        _ = try await bridge.performLocalCommand(command)
        await fulfillment(of: [expectation], timeout: 1.0)
    }

    func testUpdateProxyConfigurationPersistsIntoPublishedSnapshot() async throws {
        let bridge = makeBridge(
            cloudSyncService: nil,
            runtimePlatform: .macOS
        )
        let proxyConfiguration = ProxyConfiguration(
            preferredPortText: "9000",
            cloudflared: CloudflaredConfiguration(
                enabled: true,
                tunnelMode: .named,
                useHTTP2: true,
                namedHostname: "Proxy.Example.com/"
            )
        )
        let command = ProxyControlCommand(
            id: UUID().uuidString,
            createdAt: 1_763_216_000_000,
            sourceDeviceID: "macos-proxy-control",
            kind: .updateProxyConfiguration,
            preferredProxyPort: nil,
            autoStartProxy: nil,
            cloudflaredInput: nil,
            proxyConfiguration: proxyConfiguration,
            remoteServer: nil,
            remoteServerID: nil,
            logLines: nil
        )

        let snapshot = try await bridge.performLocalCommand(command)

        XCTAssertEqual(snapshot.preferredProxyPortText, "9000")
        XCTAssertEqual(snapshot.publicAccessEnabled, true)
        XCTAssertEqual(snapshot.cloudflaredTunnelMode, .named)
        XCTAssertEqual(snapshot.cloudflaredUseHTTP2, true)
        XCTAssertEqual(snapshot.cloudflaredNamedInput.hostname, "proxy.example.com")
    }

    func testSaveRemoteServerReplacesPreviousIDWhenAdoptingDiscoveredInstance() async throws {
        let existing = makeRemoteServer(id: "draft-server", label: "new-server")
        let bridge = makeBridge(
            cloudSyncService: nil,
            runtimePlatform: .macOS,
            settings: AppSettings(
                launchAtStartup: false,
                launchCodexAfterSwitch: true,
                autoSmartSwitch: false,
                syncOpencodeOpenaiAuth: false,
                restartEditorsOnSwitch: false,
                restartEditorTargets: [],
                autoStartApiProxy: false,
                remoteServers: [existing],
                locale: AppLocale.systemDefault.identifier
            )
        )
        let adopted = RemoteServerConfig(
            id: "server-1",
            label: "Tokyo",
            host: existing.host,
            sshPort: existing.sshPort,
            sshUser: existing.sshUser,
            authMode: existing.authMode,
            identityFile: existing.identityFile,
            privateKey: existing.privateKey,
            password: existing.password,
            remoteDir: "/srv/codexmanager",
            listenPort: 9898
        )
        let command = ProxyControlCommand(
            id: UUID().uuidString,
            createdAt: 1_763_216_000_000,
            sourceDeviceID: "macos-proxy-control",
            kind: .saveRemoteServer,
            preferredProxyPort: nil,
            autoStartProxy: nil,
            cloudflaredInput: nil,
            remoteServer: adopted,
            remoteServerID: nil,
            previousRemoteServerID: "draft-server",
            logLines: nil
        )

        let snapshot = try await bridge.performLocalCommand(command)

        XCTAssertEqual(snapshot.remoteServers.map(\.id), ["server-1"])
        XCTAssertEqual(snapshot.remoteServers.first?.label, "Tokyo")
        XCTAssertEqual(snapshot.remoteServers.first?.remoteDir, "/srv/codexmanager")
        XCTAssertEqual(snapshot.remoteServers.first?.listenPort, 9898)
    }

    private func makeBridge(
        cloudSyncService: ProxyControlCloudSyncServiceProtocol?,
        runtimePlatform: RuntimePlatform,
        remoteService: RemoteProxyServiceProtocol = StubRemoteProxyService(),
        settings: AppSettings = .defaultValue
    ) -> ProxyControlBridge {
        let proxyCoordinator = ProxyCoordinator(
            proxyService: StubProxyRuntimeService(),
            cloudflaredService: StubCloudflaredService(),
            remoteService: remoteService
        )
        let settingsCoordinator = SettingsCoordinator(
            settingsRepository: TestSettingsRepository(settings: settings),
            launchAtStartupService: StubLaunchAtStartupService()
        )

        return ProxyControlBridge(
            proxyCoordinator: proxyCoordinator,
            settingsCoordinator: settingsCoordinator,
            cloudSyncService: cloudSyncService,
            runtimePlatform: runtimePlatform
        )
    }

    private func makeRemoteServer(
        id: String = "server-1",
        label: String = "Tokyo"
    ) -> RemoteServerConfig {
        RemoteServerConfig(
            id: id,
            label: label,
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
    }
}

private struct CloudSyncMetrics {
    var ensurePushSubscriptionCallCount: Int
    var pushLocalSnapshotCallCount: Int
    var pullPendingCommandCallCount: Int
    var lastSnapshotRemoteStatusCount: Int
}

private actor SpyProxyControlCloudSyncService: ProxyControlCloudSyncServiceProtocol {
    private var ensurePushSubscriptionCallCount = 0
    private var pushLocalSnapshotCallCount = 0
    private var pullPendingCommandCallCount = 0
    private var lastSnapshotRemoteStatusCount = 0

    func pushLocalSnapshot(_ snapshot: ProxyControlSnapshot) async throws {
        pushLocalSnapshotCallCount += 1
        lastSnapshotRemoteStatusCount = snapshot.remoteStatuses.count
    }

    func pullRemoteSnapshot() async throws -> ProxyControlSnapshot? {
        nil
    }

    func enqueueCommand(_ command: ProxyControlCommand) async throws {
        _ = command
    }

    func pullPendingCommand() async throws -> ProxyControlCommand? {
        pullPendingCommandCallCount += 1
        return nil
    }

    func ensurePushSubscriptionIfNeeded() async throws {
        ensurePushSubscriptionCallCount += 1
    }

    func readMetrics() -> CloudSyncMetrics {
        CloudSyncMetrics(
            ensurePushSubscriptionCallCount: ensurePushSubscriptionCallCount,
            pushLocalSnapshotCallCount: pushLocalSnapshotCallCount,
            pullPendingCommandCallCount: pullPendingCommandCallCount,
            lastSnapshotRemoteStatusCount: lastSnapshotRemoteStatusCount
        )
    }
}

private struct StubLaunchAtStartupService: LaunchAtStartupServiceProtocol {
    func setEnabled(_ enabled: Bool) throws {
        _ = enabled
    }

    func syncWithStoreValue(_ enabled: Bool) throws {
        _ = enabled
    }
}

private struct StubProxyRuntimeService: ProxyRuntimeService {
    func status() async -> ApiProxyStatus { .idle }

    func start(preferredPort: Int?) async throws -> ApiProxyStatus {
        _ = preferredPort
        return .idle
    }

    func stop() async -> ApiProxyStatus { .idle }

    func refreshAPIKey() async throws -> ApiProxyStatus { .idle }

    func syncAccountsStore() async throws {}
}

private struct StubCloudflaredService: CloudflaredServiceProtocol {
    var statusValue: CloudflaredStatus = .idle

    func status() async -> CloudflaredStatus { statusValue }

    func install() async throws -> CloudflaredStatus { statusValue }

    func start(_ input: StartCloudflaredTunnelInput) async throws -> CloudflaredStatus {
        _ = input
        return statusValue
    }

    func stop() async -> CloudflaredStatus { statusValue }
}

private struct StubRemoteProxyService: RemoteProxyServiceProtocol {
    func status(server: RemoteServerConfig) async -> RemoteProxyStatus {
        _ = server
        return RemoteProxyStatus(
            installed: false,
            serviceInstalled: false,
            running: false,
            enabled: false,
            serviceName: "",
            pid: nil,
            baseURL: "",
            apiKey: nil,
            lastError: nil
        )
    }

    func discover(server: RemoteServerConfig) async throws -> [DiscoveredRemoteProxyInstance] {
        _ = server
        return []
    }

    func deploy(server: RemoteServerConfig) async throws -> RemoteProxyStatus {
        await status(server: server)
    }

    func syncAccounts(server: RemoteServerConfig) async throws -> RemoteProxyStatus {
        await status(server: server)
    }

    func start(server: RemoteServerConfig) async throws -> RemoteProxyStatus {
        await status(server: server)
    }

    func stop(server: RemoteServerConfig) async throws -> RemoteProxyStatus {
        await status(server: server)
    }

    func readLogs(server: RemoteServerConfig, lines: Int) async throws -> String {
        _ = server
        _ = lines
        return ""
    }

    func uninstall(server: RemoteServerConfig, removeRemoteDirectory: Bool) async throws -> RemoteProxyStatus {
        _ = removeRemoteDirectory
        return await status(server: server)
    }
}

private final class SlowRemoteProxyService: RemoteProxyServiceProtocol, @unchecked Sendable {
    private let delay: Duration

    init(delay: Duration) {
        self.delay = delay
    }

    func status(server: RemoteServerConfig) async -> RemoteProxyStatus {
        _ = server
        try? await Task.sleep(for: delay)
        return RemoteProxyStatus(
            installed: true,
            serviceInstalled: true,
            running: true,
            enabled: true,
            serviceName: "codex-tools-proxyd.service",
            pid: 42,
            baseURL: "http://1.2.3.4:8787/v1",
            apiKey: "key",
            lastError: nil
        )
    }

    func deploy(server: RemoteServerConfig) async throws -> RemoteProxyStatus {
        await status(server: server)
    }

    func discover(server: RemoteServerConfig) async throws -> [DiscoveredRemoteProxyInstance] {
        _ = server
        try? await Task.sleep(for: delay)
        return []
    }

    func syncAccounts(server: RemoteServerConfig) async throws -> RemoteProxyStatus {
        await status(server: server)
    }

    func start(server: RemoteServerConfig) async throws -> RemoteProxyStatus {
        await status(server: server)
    }

    func stop(server: RemoteServerConfig) async throws -> RemoteProxyStatus {
        await status(server: server)
    }

    func readLogs(server: RemoteServerConfig, lines: Int) async throws -> String {
        _ = server
        _ = lines
        return ""
    }

    func uninstall(server: RemoteServerConfig, removeRemoteDirectory: Bool) async throws -> RemoteProxyStatus {
        _ = removeRemoteDirectory
        return await status(server: server)
    }
}
