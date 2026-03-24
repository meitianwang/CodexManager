import Foundation

struct RemoteProxydBinaryBuilder {
    let repoRoot: URL?
    let fileManager: FileManager
    let commandRunner: RemoteShellCommandRunner

    func buildBinary(for server: RemoteServerConfig) throws -> URL {
        let platform = try detectRemoteLinuxPlatform(for: server)
        guard let manifestPath = proxydManifestPath() else {
            throw AppError.io(L10n.tr("error.remote.unavailable_missing_proxyd_source"))
        }
        guard CommandRunner.resolveExecutable("cargo") != nil else {
            throw AppError.io("\(L10n.tr("error.remote.build_proxyd_failed")): cargo command not found")
        }

        try ensureLinuxBuildDependenciesIfNeeded()
        let targetDir = try proxydBuildTargetDirectory()
        let manifestDirectory = manifestPath.deletingLastPathComponent()
        var buildErrors: [String] = []

        for target in [platform.primaryTarget, platform.fallbackTarget] {
            try ensureRustTargetAddedIfPossible(target)
            let binaryPath = targetDir
                .appendingPathComponent(target, isDirectory: true)
                .appendingPathComponent("release", isDirectory: true)
                .appendingPathComponent(RepositoryLocator.proxydBinaryName, isDirectory: false)

            if fileManager.isExecutableFile(atPath: binaryPath.path) {
                return binaryPath
            }

            for build in buildAttemptCommands(manifestPath: manifestPath, target: target, targetDir: targetDir) {
                let result = try CommandRunner.run(
                    "/usr/bin/env",
                    arguments: build.command,
                    currentDirectory: manifestDirectory
                )
                if result.status == 0, fileManager.isExecutableFile(atPath: binaryPath.path) {
                    return binaryPath
                }
                let details = result.stderr.isEmpty ? result.stdout : result.stderr
                let compact = details.trimmingCharacters(in: .whitespacesAndNewlines)
                let message = compact.isEmpty ? "exit \(result.status)" : compact
                buildErrors.append("\(build.label): \(message)")
            }
        }

        let suffix = buildErrors.isEmpty ? "" : " \(buildErrors.joined(separator: " | "))"
        throw AppError.io("\(L10n.tr("error.remote.build_proxyd_failed")):\(suffix)")
    }

    private func proxydManifestPath() -> URL? {
        if let repoRoot {
            if let manifest = RepositoryLocator.proxydManifestURL(in: repoRoot),
               fileManager.fileExists(atPath: manifest.path) {
                return manifest
            }
        }

        let bundled = Bundle.main.resourceURL?
            .appendingPathComponent(RepositoryLocator.proxydBundledManifestRelativePath, isDirectory: false)
        if let bundled, fileManager.fileExists(atPath: bundled.path) {
            return bundled
        }

        return nil
    }

    private func proxydBuildTargetDirectory() throws -> URL {
        let caches = try fileManager.url(
            for: .cachesDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let path = caches
            .appendingPathComponent("CodexManager", isDirectory: true)
            .appendingPathComponent("proxyd-target", isDirectory: true)
        try fileManager.createDirectory(at: path, withIntermediateDirectories: true)
        return path
    }

    private func ensureRustTargetAddedIfPossible(_ target: String) throws {
        guard CommandRunner.resolveExecutable("rustup") != nil else {
            return
        }
        _ = try? CommandRunner.run("/usr/bin/env", arguments: ["rustup", "target", "add", target])
    }

    private func buildAttemptCommands(manifestPath: URL, target: String, targetDir: URL) -> [BuildAttempt] {
        let manifest = manifestPath.path
        let targetDirPath = targetDir.path
        var attempts: [BuildAttempt] = []

        if CommandRunner.resolveExecutable("cross") != nil {
            attempts.append(
                BuildAttempt(
                    label: "cross \(target)",
                    command: [
                        "cross", "build",
                        "--manifest-path", manifest,
                        "--release",
                        "--target", target,
                        "--target-dir", targetDirPath,
                    ]
                )
            )
        }

        if hasCargoZigbuild() {
            attempts.append(
                BuildAttempt(
                    label: "cargo zigbuild \(target)",
                    command: [
                        "cargo", "zigbuild",
                        "--manifest-path", manifest,
                        "--release",
                        "--target", target,
                        "--target-dir", targetDirPath,
                    ]
                )
            )
        }

        attempts.append(
            BuildAttempt(
                label: "cargo build \(target)",
                command: [
                    "cargo", "build",
                    "--manifest-path", manifest,
                    "--release",
                    "--target", target,
                    "--target-dir", targetDirPath,
                ]
            )
        )

        return attempts
    }

    private func hasCargoZigbuild() -> Bool {
        guard CommandRunner.resolveExecutable("zig") != nil else {
            return false
        }
        if CommandRunner.resolveExecutable("cargo-zigbuild") != nil {
            return true
        }
        guard CommandRunner.resolveExecutable("cargo") != nil else {
            return false
        }
        if let help = try? CommandRunner.run("/usr/bin/env", arguments: ["cargo", "zigbuild", "--help"]) {
            return help.status == 0
        }
        return false
    }

    private func ensureLinuxBuildDependenciesIfNeeded() throws {
        if CommandRunner.resolveExecutable("cross") != nil || hasCargoZigbuild() {
            return
        }

        #if os(macOS)
        guard CommandRunner.resolveExecutable("brew") != nil else {
            return
        }

        if CommandRunner.resolveExecutable("zig") == nil {
            _ = try CommandRunner.runChecked(
                "/usr/bin/env",
                arguments: ["brew", "install", "zig"],
                errorPrefix: "\(L10n.tr("error.remote.build_proxyd_failed")) (install zig)"
            )
        }

        if !hasCargoZigbuild() {
            _ = try CommandRunner.runChecked(
                "/usr/bin/env",
                arguments: ["cargo", "install", "cargo-zigbuild", "--locked"],
                errorPrefix: "\(L10n.tr("error.remote.build_proxyd_failed")) (install cargo-zigbuild)"
            )
        }
        #endif
    }

    private func detectRemoteLinuxPlatform(for server: RemoteServerConfig) throws -> RemoteLinuxPlatform {
        let output = try commandRunner.runSSH(
            server: server,
            command: "uname -s && uname -m"
        )
        let lines = output
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        let os = lines.first ?? ""
        let arch = lines.count > 1 ? lines[1] : ""

        guard os == "Linux" else {
            let value = os.isEmpty ? "unknown" : os
            throw AppError.io("Remote deploy supports Linux only (detected: \(value))")
        }

        switch arch {
        case "x86_64", "amd64":
            return RemoteLinuxPlatform(
                primaryTarget: "x86_64-unknown-linux-musl",
                fallbackTarget: "x86_64-unknown-linux-gnu"
            )
        case "aarch64", "arm64":
            return RemoteLinuxPlatform(
                primaryTarget: "aarch64-unknown-linux-musl",
                fallbackTarget: "aarch64-unknown-linux-gnu"
            )
        default:
            let value = arch.isEmpty ? "unknown" : arch
            throw AppError.io("Unsupported remote Linux architecture: \(value)")
        }
    }
}

private struct RemoteLinuxPlatform {
    let primaryTarget: String
    let fallbackTarget: String
}

private struct BuildAttempt {
    let label: String
    let command: [String]
}
