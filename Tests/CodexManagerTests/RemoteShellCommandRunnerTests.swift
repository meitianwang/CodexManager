import XCTest
@testable import CodexManager

final class RemoteShellCommandRunnerTests: XCTestCase {
    func testSSHArgumentsIncludeConfiguredPort() {
        let runner = RemoteShellCommandRunner(fileManager: .default)
        let server = RemoteServerConfig(
            id: "server-1",
            label: "prod",
            host: "example.com",
            sshPort: 2222,
            sshUser: "root",
            authMode: "keyPath",
            identityFile: "/tmp/id_ed25519",
            privateKey: nil,
            password: nil,
            remoteDir: "/opt/codex-tools",
            listenPort: 8787
        )

        let arguments = runner.commandArguments(
            server: server,
            baseCommand: "ssh",
            connectTimeout: 12,
            additionalArguments: ["-p", String(server.sshPort)],
            destinationArgument: "\(server.sshUser)@\(server.host)",
            trailingArguments: ["echo ok"],
            identityPath: server.identityFile
        )

        XCTAssertEqual(arguments.prefix(3), ["ssh", "-p", "2222"])
        XCTAssertTrue(arguments.contains("root@example.com"))
        XCTAssertTrue(arguments.contains("echo ok"))
    }
}
