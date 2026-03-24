import XCTest
@testable import CodexManager

final class RemoteServerConfigurationTests: XCTestCase {
    func testMakeDraftUsesSharedDefaults() {
        let draft = RemoteServerConfiguration.makeDraft(id: "server-1")

        XCTAssertEqual(draft.id, "server-1")
        XCTAssertEqual(draft.label, RemoteServerConfiguration.defaultLabel)
        XCTAssertEqual(draft.sshPort, RemoteServerConfiguration.defaultSSHPort)
        XCTAssertEqual(draft.sshUser, RemoteServerConfiguration.defaultSSHUser)
        XCTAssertEqual(draft.authMode, RemoteServerConfiguration.defaultAuthMode)
        XCTAssertEqual(draft.remoteDir, RemoteServerConfiguration.defaultRemoteDir)
        XCTAssertEqual(draft.listenPort, RemoteServerConfiguration.defaultProxyPort)
    }

    func testNormalizeTrimsFieldsAndBackfillsID() {
        let normalized = RemoteServerConfiguration.normalize(
            RemoteServerConfig(
                id: "   ",
                label: "  Tokyo  ",
                host: " 1.2.3.4 ",
                sshPort: 22,
                sshUser: " root ",
                authMode: " keyPath ",
                identityFile: " ~/.ssh/id_ed25519 ",
                privateKey: "  ",
                password: "\nsecret\n",
                remoteDir: " /opt/codex-tools ",
                listenPort: 8787
            ),
            makeID: { "generated-id" }
        )

        XCTAssertEqual(normalized.id, "generated-id")
        XCTAssertEqual(normalized.label, "Tokyo")
        XCTAssertEqual(normalized.host, "1.2.3.4")
        XCTAssertEqual(normalized.sshUser, "root")
        XCTAssertEqual(normalized.authMode, "keyPath")
        XCTAssertEqual(normalized.identityFile, "~/.ssh/id_ed25519")
        XCTAssertNil(normalized.privateKey)
        XCTAssertEqual(normalized.password, "secret")
        XCTAssertEqual(normalized.remoteDir, "/opt/codex-tools")
    }

    func testUpsertReplacesExistingServerByID() {
        let existing = [
            RemoteServerConfig(
                id: "server-1",
                label: "Old",
                host: "1.1.1.1",
                sshPort: 22,
                sshUser: "root",
                authMode: "keyPath",
                identityFile: nil,
                privateKey: nil,
                password: nil,
                remoteDir: "/opt/codex-tools",
                listenPort: 8787
            )
        ]

        let merged = RemoteServerConfiguration.upsert(
            RemoteServerConfig(
                id: "server-1",
                label: " New ",
                host: " 2.2.2.2 ",
                sshPort: 2200,
                sshUser: " admin ",
                authMode: " password ",
                identityFile: nil,
                privateKey: nil,
                password: " pass ",
                remoteDir: " /srv/codex ",
                listenPort: 9797
            ),
            into: existing
        )

        XCTAssertEqual(merged.count, 1)
        XCTAssertEqual(merged[0].label, "New")
        XCTAssertEqual(merged[0].host, "2.2.2.2")
        XCTAssertEqual(merged[0].sshUser, "admin")
        XCTAssertEqual(merged[0].authMode, "password")
        XCTAssertEqual(merged[0].password, "pass")
        XCTAssertEqual(merged[0].remoteDir, "/srv/codex")
        XCTAssertEqual(merged[0].listenPort, 9797)
    }

    func testDeploymentPlanSanitizesServiceName() {
        XCTAssertEqual(
            RemoteProxyDeploymentPlan.serviceName(for: "prod server/01"),
            "codex-tools-proxyd-prod-server-01.service"
        )
    }

    func testAdoptingDiscoveredInstanceBackfillsIdentityLabelAndEndpoint() {
        let draft = RemoteServerConfig(
            id: "draft-1",
            label: "new-server",
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
        let instance = DiscoveredRemoteProxyInstance(
            serviceName: "codex-tools-proxyd-server-1.service",
            serverID: "server-1",
            label: "Tokyo",
            remoteDir: "/srv/codexmanager",
            listenPort: 9898,
            installed: true,
            serviceInstalled: true,
            running: true,
            enabled: true,
            pid: 42,
            apiKeyPresent: true,
            baseURL: "http://1.2.3.4:9898/v1"
        )

        let adopted = RemoteServerConfiguration.adoptingDiscoveredInstance(instance, into: draft)

        XCTAssertEqual(adopted.id, "server-1")
        XCTAssertEqual(adopted.label, "Tokyo")
        XCTAssertEqual(adopted.remoteDir, "/srv/codexmanager")
        XCTAssertEqual(adopted.listenPort, 9898)
        XCTAssertEqual(adopted.host, draft.host)
    }

    func testDeploymentPlanSystemdUnitCarriesRemoteServerMetadata() {
        let server = RemoteServerConfig(
            id: "server-1",
            label: "Tokyo 01",
            host: "1.2.3.4",
            sshPort: 22,
            sshUser: "root",
            authMode: "keyPath",
            identityFile: "~/.ssh/id_ed25519",
            privateKey: nil,
            password: nil,
            remoteDir: "/srv/codex",
            listenPort: 8787
        )

        let unit = RemoteProxyDeploymentPlan.renderSystemdUnit(
            server: server,
            serviceName: "codex-tools-proxyd-server-1.service"
        )

        XCTAssertTrue(unit.contains("Environment=\"CODEXMANAGER_SERVER_ID=server-1\""))
        XCTAssertTrue(unit.contains("Environment=\"CODEXMANAGER_SERVER_LABEL=Tokyo 01\""))
    }

    func testDeploymentPlanInstallCommandReplacesConflictingServiceByDirectoryOrPort() {
        let server = RemoteServerConfig(
            id: "server-1",
            label: "Prod",
            host: "1.2.3.4",
            sshPort: 22,
            sshUser: "root",
            authMode: "keyPath",
            identityFile: "~/.ssh/id_ed25519",
            privateKey: nil,
            password: nil,
            remoteDir: "/srv/codex tools",
            listenPort: 8787
        )
        let command = RemoteProxyDeploymentPlan.renderInstallCommand(
            server: server,
            serviceName: "codex-tools-proxyd-server-1.service",
            stageDir: "/tmp/codex-tools-remote-server-1-123",
            shellQuote: { value in "'\(value)'" }
        )

        XCTAssertTrue(command.contains("TARGET_DIR='/srv/codex tools'"))
        XCTAssertTrue(command.contains("TARGET_PORT='8787'"))
        XCTAssertTrue(command.contains("[ \"$UNIT_NAME\" = \"$TARGET_UNIT\" ] && continue"))
        XCTAssertTrue(command.contains("WORK_DIR=$(sed -n 's/^WorkingDirectory=//p' \"$UNIT_PATH\" | head -n 1)"))
        XCTAssertTrue(command.contains("PORT=$(sed -n 's/^ExecStart=.* --port \\([0-9][0-9]*\\).*$/\\1/p' \"$UNIT_PATH\" | head -n 1)"))
        XCTAssertTrue(command.contains("if [ \"$WORK_DIR\" = \"$TARGET_DIR\" ] || [ \"$PORT\" = \"$TARGET_PORT\" ]; then"))
        XCTAssertTrue(command.contains("rm -f \"/etc/systemd/system/$UNIT_NAME\" \"/lib/systemd/system/$UNIT_NAME\""))
    }

    func testDeploymentPlanDiscoverCommandParsesWorkingDirectoryAndPort() {
        let command = RemoteProxyDeploymentPlan.renderDiscoverCommand(
            shellQuote: { value in "'\(value)'" }
        )

        XCTAssertTrue(command.contains("MARKER='__CodexManager_DISCOVERY__'"))
        XCTAssertTrue(command.contains("WORK_DIR=$(sed -n 's/^WorkingDirectory=//p' \"$UNIT_PATH\" | head -n 1)"))
        XCTAssertTrue(command.contains("SERVER_ID=$(sed -n"))
        XCTAssertTrue(command.contains("CODEXMANAGER_SERVER_ID"))
        XCTAssertTrue(command.contains("LABEL=$(sed -n"))
        XCTAssertTrue(command.contains("CODEXMANAGER_SERVER_LABEL"))
        XCTAssertTrue(command.contains("PORT=$(sed -n 's/^ExecStart=.* --port \\([0-9][0-9]*\\).*$/\\1/p' \"$UNIT_PATH\" | head -n 1)"))
        XCTAssertTrue(command.contains("server_id=%s"))
        XCTAssertTrue(command.contains("label=%s"))
        XCTAssertTrue(command.contains("api_key_present=%s"))
    }

    func testDeploymentPlanSyncAccountsCommandRestartsOnlyWhenRequested() {
        let restartCommand = RemoteProxyDeploymentPlan.renderSyncAccountsCommand(
            remoteDir: "/srv/codex",
            serviceName: "codex-tools-proxyd-server-1.service",
            stageDir: "/tmp/stage",
            shouldRestartService: true,
            shellQuote: { value in "'\(value)'" }
        )
        let noRestartCommand = RemoteProxyDeploymentPlan.renderSyncAccountsCommand(
            remoteDir: "/srv/codex",
            serviceName: "codex-tools-proxyd-server-1.service",
            stageDir: "/tmp/stage",
            shouldRestartService: false,
            shellQuote: { value in "'\(value)'" }
        )

        XCTAssertTrue(restartCommand.contains("systemctl restart \"$UNIT\""))
        XCTAssertFalse(noRestartCommand.contains("systemctl restart \"$UNIT\""))
        XCTAssertTrue(noRestartCommand.contains("true"))
    }

    func testDeploymentPlanUninstallCommandStopsDisablesAndRemovesServiceArtifacts() {
        let command = RemoteProxyDeploymentPlan.renderUninstallCommand(
            remoteDir: "/srv/codex",
            serviceName: "codex-tools-proxyd-server-1.service",
            removeRemoteDirectory: false,
            shellQuote: { value in "'\(value)'" }
        )

        XCTAssertTrue(command.contains("systemctl stop \"$UNIT\""))
        XCTAssertTrue(command.contains("systemctl disable \"$UNIT\""))
        XCTAssertTrue(command.contains("systemctl daemon-reload"))
        XCTAssertTrue(command.contains("rm -f '/srv/codex/codex-tools-proxyd' '/srv/codex/accounts.json'"))
    }
}
