import Foundation

struct RemoteShellCommandRunner {
    let fileManager: FileManager

    func runSSH(
        server: RemoteServerConfig,
        command: String,
        timeout: TimeInterval = 60,
        connectTimeout: Int = 12
    ) throws -> String {
        let result = try runCommand(
            server: server,
            baseCommand: "ssh",
            timeout: timeout,
            connectTimeout: connectTimeout,
            additionalArguments: ["-p", String(server.sshPort)],
            destinationArgument: "\(server.sshUser)@\(server.host)",
            trailingArguments: [command]
        )
        guard result.status == 0 else {
            throw AppError.io(L10n.tr("error.remote.ssh_command_failed_format", result.stderr.isEmpty ? result.stdout : result.stderr))
        }
        return result.stdout
    }

    func runSCP(
        server: RemoteServerConfig,
        localPath: String,
        remotePath: String,
        timeout: TimeInterval = 90,
        connectTimeout: Int = 12
    ) throws {
        let result = try runCommand(
            server: server,
            baseCommand: "scp",
            timeout: timeout,
            connectTimeout: connectTimeout,
            additionalArguments: ["-P", String(server.sshPort)],
            destinationArgument: localPath,
            trailingArguments: ["\(server.sshUser)@\(server.host):\(remotePath)"]
        )
        guard result.status == 0 else {
            throw AppError.io(L10n.tr("error.remote.scp_failed_format", result.stderr.isEmpty ? result.stdout : result.stderr))
        }
    }

    func shellQuote(_ value: String) -> String {
        if value.isEmpty { return "''" }
        return "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    func withRootPrivileges(_ command: String) -> String {
        "if [ \"$(id -u)\" = \"0\" ]; then \(command); else sudo sh -lc \(shellQuote(command)); fi"
    }

    private func runCommand(
        server: RemoteServerConfig,
        baseCommand: String,
        timeout: TimeInterval,
        connectTimeout: Int,
        additionalArguments: [String],
        destinationArgument: String,
        trailingArguments: [String]
    ) throws -> CommandResult {
        try withTemporaryIdentityFile(for: server) { identityPath in
            return try CommandRunner.run(
                "/usr/bin/env",
                arguments: commandArguments(
                    server: server,
                    baseCommand: baseCommand,
                    connectTimeout: connectTimeout,
                    additionalArguments: additionalArguments,
                    destinationArgument: destinationArgument,
                    trailingArguments: trailingArguments,
                    identityPath: identityPath
                ),
                timeout: timeout
            )
        }
    }

    func commandArguments(
        server: RemoteServerConfig,
        baseCommand: String,
        connectTimeout: Int,
        additionalArguments: [String],
        destinationArgument: String,
        trailingArguments: [String],
        identityPath: String?
    ) -> [String] {
        var args: [String] = []
        if server.authMode == "password", let password = server.password {
            args.append(contentsOf: ["sshpass", "-p", password, baseCommand])
        } else {
            args.append(baseCommand)
        }

        args.append(contentsOf: additionalArguments)
        args.append(contentsOf: [
            "-o", "StrictHostKeyChecking=accept-new",
            "-o", "ConnectTimeout=\(connectTimeout)",
            "-o", "ServerAliveInterval=10",
            "-o", "ServerAliveCountMax=2",
        ])
        if server.authMode != "password" {
            args.append(contentsOf: ["-o", "BatchMode=yes"])
        }
        if let identityPath {
            args.append(contentsOf: ["-i", identityPath])
        }
        args.append(destinationArgument)
        args.append(contentsOf: trailingArguments)
        return args
    }

    private func withTemporaryIdentityFile<Result>(
        for server: RemoteServerConfig,
        _ operation: (String?) throws -> Result
    ) throws -> Result {
        switch server.authMode {
        case "keyContent":
            let temporaryKey = fileManager.temporaryDirectory
                .appendingPathComponent("codex-tools-key-\(UUID().uuidString)", isDirectory: false)
            try server.privateKey?.write(to: temporaryKey, atomically: true, encoding: .utf8)
            #if canImport(Darwin)
            _ = chmod(temporaryKey.path, S_IRUSR | S_IWUSR)
            #endif
            defer { try? fileManager.removeItem(at: temporaryKey) }
            return try operation(temporaryKey.path)
        case "password":
            return try operation(nil)
        default:
            return try operation(server.identityFile)
        }
    }
}
