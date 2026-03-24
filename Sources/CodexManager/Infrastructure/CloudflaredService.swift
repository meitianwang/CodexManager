import Foundation

#if os(macOS)
actor CloudflaredService: CloudflaredServiceProtocol {
    private let paths: FileSystemPaths
    private let fileManager: FileManager
    private let session: URLSession

    private var process: Process?
    private var mode: CloudflaredTunnelMode?
    private var useHTTP2 = false
    private var customHostname: String?
    private var logPath: URL?
    private var lastError: String?
    private var cleanupAPIToken: String?
    private var cleanupAccountID: String?
    private var cleanupTunnelID: String?

    init(paths: FileSystemPaths, fileManager: FileManager = .default, session: URLSession = .shared) {
        self.paths = paths
        self.fileManager = fileManager
        self.session = session
    }

    func status() async -> CloudflaredStatus {
        let binaryPath = CommandRunner.resolveExecutable("cloudflared")
        let running = process?.isRunning == true

        if !running {
            process = nil
            mode = nil
            useHTTP2 = false
            customHostname = nil
        }

        let resolvedPublicURL: String? = {
            guard running else { return nil }
            switch mode {
            case .quick:
                return withV1Suffix(logPath.flatMap(parseQuickTunnelPublicURL(from:)))
            case .named:
                if let customHostname, !customHostname.isEmpty {
                    return withV1Suffix("https://\(customHostname)")
                }
                return nil
            case nil:
                return nil
            }
        }()

        return CloudflaredStatus(
            installed: binaryPath != nil,
            binaryPath: binaryPath,
            running: running,
            tunnelMode: running ? mode : nil,
            publicURL: resolvedPublicURL,
            customHostname: running ? customHostname : nil,
            useHTTP2: running ? useHTTP2 : false,
            lastError: lastError
        )
    }

    func install() async throws -> CloudflaredStatus {
        if CommandRunner.resolveExecutable("cloudflared") != nil {
            return await status()
        }

        #if os(macOS)
        _ = try CommandRunner.runChecked(
            "/usr/bin/env",
            arguments: ["brew", "install", "cloudflared"],
            errorPrefix: L10n.tr("error.cloudflared.install_failed")
        )
        #else
        throw AppError.io(L10n.tr("error.cloudflared.install_unsupported_platform"))
        #endif

        return await status()
    }

    func start(_ input: StartCloudflaredTunnelInput) async throws -> CloudflaredStatus {
        guard input.apiProxyPort > 0 else {
            throw AppError.invalidData(L10n.tr("error.cloudflared.start_api_proxy_first"))
        }

        guard let binaryPath = CommandRunner.resolveExecutable("cloudflared") else {
            throw AppError.fileNotFound(L10n.tr("error.cloudflared.not_installed"))
        }

        if process?.isRunning == true {
            return await status()
        }

        let logFile = try nextLogFilePath()
        let serviceURL = "http://127.0.0.1:\(input.apiProxyPort)"

        var createdNamedTunnel: NamedTunnelCreateResult?
        var normalizedNamedInput: NamedCloudflaredTunnelInput?

        let launch: (arguments: [String], environment: [String: String]) = try await {
            switch input.mode {
            case .quick:
                try ensureQuickTunnelIsAllowed()
                var environment = ProcessInfo.processInfo.environment
                if input.useHTTP2 {
                    environment["TUNNEL_TRANSPORT_PROTOCOL"] = "http2"
                }
                return (
                    arguments: [
                        "tunnel",
                        "--loglevel", "info",
                        "--logfile", logFile.path,
                        "--no-autoupdate",
                        "--url", serviceURL
                    ],
                    environment: environment
                )

            case .named:
                let named = try normalizeNamedInput(input.named)
                normalizedNamedInput = named

                let created = try await cloudflareClient.createNamedTunnel(input: named)
                createdNamedTunnel = created

                try await cloudflareClient.configureNamedTunnel(
                    input: named,
                    tunnelID: created.id,
                    hostname: named.hostname,
                    serviceURL: serviceURL
                )

                try await cloudflareClient.upsertCNAMERecord(
                    apiToken: named.apiToken,
                    zoneID: named.zoneID,
                    hostname: named.hostname,
                    target: "\(created.id).cfargotunnel.com"
                )

                var arguments = [
                    "tunnel",
                    "--loglevel", "info",
                    "--logfile", logFile.path,
                    "--no-autoupdate"
                ]
                if input.useHTTP2 {
                    arguments.append(contentsOf: ["--protocol", "http2"])
                }
                arguments.append(contentsOf: ["run", "--token", created.token])
                return (arguments, ProcessInfo.processInfo.environment)
            }
        }()

        let (command, stderrPipe) = makeProcess(
            executablePath: binaryPath,
            arguments: launch.arguments,
            environment: launch.environment
        )

        do {
            try command.run()
        } catch {
            throw AppError.io(L10n.tr("error.cloudflared.launch_failed_format", error.localizedDescription))
        }

        process = command
        mode = input.mode
        useHTTP2 = input.useHTTP2
        logPath = logFile
        lastError = nil
        customHostname = normalizedNamedInput?.hostname
        cleanupAPIToken = normalizedNamedInput?.apiToken
        cleanupAccountID = normalizedNamedInput?.accountID
        cleanupTunnelID = createdNamedTunnel?.id

        if input.mode == .quick {
            for _ in 0..<20 {
                if parseQuickTunnelPublicURL(from: logFile) != nil {
                    break
                }
                try? await Task.sleep(for: .milliseconds(300))
            }
        }

        if process?.isRunning != true {
            let errData = stderrPipe.fileHandleForReading.readDataToEndOfFile()
            let errText = String(data: errData, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            lastError = errText.isEmpty ? L10n.tr("error.cloudflared.process_exited_early") : errText

            if let namedInput = normalizedNamedInput, let tunnelID = createdNamedTunnel?.id {
                try? await cloudflareClient.deleteNamedTunnel(
                    apiToken: namedInput.apiToken,
                    accountID: namedInput.accountID,
                    tunnelID: tunnelID
                )
            }

            clearRuntime()
            throw AppError.io(lastError ?? L10n.tr("error.cloudflared.start_failed"))
        }

        return await status()
    }

    func stop() async -> CloudflaredStatus {
        if let process {
            if process.isRunning {
                process.terminate()
                for _ in 0..<20 where process.isRunning {
                    try? await Task.sleep(for: .milliseconds(100))
                }
                if process.isRunning {
                    process.interrupt()
                }
            }
        }

        if let token = cleanupAPIToken,
           let accountID = cleanupAccountID,
           let tunnelID = cleanupTunnelID {
            do {
                try await cloudflareClient.deleteNamedTunnel(
                    apiToken: token,
                    accountID: accountID,
                    tunnelID: tunnelID
                )
            } catch {
                lastError = error.localizedDescription
            }
        }

        clearRuntime()
        return await status()
    }

    private func clearRuntime() {
        process = nil
        mode = nil
        useHTTP2 = false
        customHostname = nil
        cleanupAPIToken = nil
        cleanupAccountID = nil
        cleanupTunnelID = nil
    }

    private func nextLogFilePath() throws -> URL {
        do {
            try fileManager.createDirectory(at: paths.cloudflaredLogDirectory, withIntermediateDirectories: true)
        } catch {
            throw AppError.io(L10n.tr("error.cloudflared.create_log_dir_failed_format", error.localizedDescription))
        }
        let file = paths.cloudflaredLogDirectory
            .appendingPathComponent("cloudflared-\(Int(Date().timeIntervalSince1970)).log", isDirectory: false)
        guard fileManager.createFile(atPath: file.path, contents: nil) else {
            throw AppError.io(L10n.tr("error.cloudflared.create_log_file_failed"))
        }
        return file
    }

    private func makeProcess(
        executablePath: String,
        arguments: [String],
        environment: [String: String]
    ) -> (Process, Pipe) {
        let command = Process()
        command.executableURL = URL(fileURLWithPath: executablePath)
        command.arguments = arguments
        command.environment = environment

        let stdout = Pipe()
        let stderr = Pipe()
        command.standardOutput = stdout
        command.standardError = stderr
        return (command, stderr)
    }

    private func ensureQuickTunnelIsAllowed() throws {
        let home = NSHomeDirectory()
        let cloudflaredDir = URL(fileURLWithPath: home, isDirectory: true)
            .appendingPathComponent(".cloudflared", isDirectory: true)

        let candidates = [
            cloudflaredDir.appendingPathComponent("config.yml", isDirectory: false),
            cloudflaredDir.appendingPathComponent("config.yaml", isDirectory: false),
        ]

        if candidates.contains(where: { fileManager.fileExists(atPath: $0.path) }) {
            throw AppError.invalidData(L10n.tr("error.cloudflared.quick_config_conflict"))
        }
    }

    private func normalizeNamedInput(_ input: NamedCloudflaredTunnelInput?) throws -> NamedCloudflaredTunnelInput {
        guard var input else {
            throw AppError.invalidData(L10n.tr("error.cloudflared.named_required_fields"))
        }

        input.apiToken = input.apiToken.trimmingCharacters(in: .whitespacesAndNewlines)
        input.accountID = input.accountID.trimmingCharacters(in: .whitespacesAndNewlines)
        input.zoneID = input.zoneID.trimmingCharacters(in: .whitespacesAndNewlines)
        input.hostname = input.hostname
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "https://", with: "")
            .replacingOccurrences(of: "http://", with: "")
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            .lowercased()

        guard !input.apiToken.isEmpty, !input.accountID.isEmpty, !input.zoneID.isEmpty, !input.hostname.isEmpty else {
            throw AppError.invalidData(L10n.tr("error.cloudflared.named_required_fields"))
        }
        guard input.hostname.contains(".") else {
            throw AppError.invalidData(L10n.tr("error.cloudflared.named_invalid_hostname"))
        }

        return input
    }

    private func parseQuickTunnelPublicURL(from logFile: URL) -> String? {
        guard let raw = try? String(contentsOf: logFile, encoding: .utf8) else { return nil }

        return raw.split(whereSeparator: \.isWhitespace).compactMap { segment -> String? in
            guard segment.contains("trycloudflare.com") else { return nil }
            let cleaned = segment.trimmingCharacters(in: CharacterSet(charactersIn: "\"'`()[]{};,"))
            if cleaned.hasPrefix("https://") || cleaned.hasPrefix("http://") {
                return cleaned
            }
            return nil
        }.first
    }

    private func withV1Suffix(_ urlString: String?) -> String? {
        guard var value = urlString?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
            return nil
        }

        while value.count > 1 && value.hasSuffix("/") {
            value.removeLast()
        }

        if value.lowercased().hasSuffix("/v1") {
            return value
        }

        return value + "/v1"
    }
    private var cloudflareClient: CloudflareNamedTunnelClient {
        CloudflareNamedTunnelClient(session: session)
    }
}
#else
actor CloudflaredService: CloudflaredServiceProtocol {
    init(paths: FileSystemPaths, fileManager: FileManager = .default, session: URLSession = .shared) {
        _ = paths
        _ = fileManager
        _ = session
    }

    func status() async -> CloudflaredStatus {
        CloudflaredStatus(
            installed: false,
            binaryPath: nil,
            running: false,
            tunnelMode: nil,
            publicURL: nil,
            customHostname: nil,
            useHTTP2: false,
            lastError: PlatformCapabilities.unsupportedOperationMessage
        )
    }

    func install() async throws -> CloudflaredStatus {
        throw AppError.io(PlatformCapabilities.unsupportedOperationMessage)
    }

    func start(_ input: StartCloudflaredTunnelInput) async throws -> CloudflaredStatus {
        _ = input
        throw AppError.io(PlatformCapabilities.unsupportedOperationMessage)
    }

    func stop() async -> CloudflaredStatus {
        await status()
    }
}
#endif
