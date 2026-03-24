import Foundation

enum RemoteProxyOutputParser {
    static func parseStatusOutput(
        _ output: String,
        serviceName: String,
        host: String,
        listenPort: Int
    ) -> RemoteProxyStatus {
        var installed = false
        var serviceInstalled = false
        var running = false
        var enabled = false
        var pid: Int?
        var apiKey: String?

        for line in output.split(whereSeparator: \.isNewline) {
            let text = String(line)
            guard let value = text.split(separator: "=", maxSplits: 1).dropFirst().first else {
                continue
            }
            if text.hasPrefix("installed=") {
                installed = value == "1"
            } else if text.hasPrefix("service_installed=") {
                serviceInstalled = value == "1"
            } else if text.hasPrefix("running=") {
                running = value == "1"
            } else if text.hasPrefix("enabled=") {
                enabled = value == "1"
            } else if text.hasPrefix("pid=") {
                pid = Int(value)
            } else if text.hasPrefix("api_key=") {
                let key = String(value).trimmingCharacters(in: .whitespacesAndNewlines)
                apiKey = key.isEmpty ? nil : key
            }
        }

        return RemoteProxyStatus(
            installed: installed,
            serviceInstalled: serviceInstalled,
            running: running,
            enabled: enabled,
            serviceName: serviceName,
            pid: pid,
            baseURL: "http://\(host):\(listenPort)/v1",
            apiKey: apiKey,
            lastError: nil
        )
    }

    static func parseDiscoveryOutput(
        _ output: String,
        host: String
    ) -> [DiscoveredRemoteProxyInstance] {
        var discovered: [DiscoveredRemoteProxyInstance] = []
        var currentFields: [String: String] = [:]

        func finishCurrentInstance() {
            guard let serviceName = currentFields["service_name"],
                  let remoteDir = currentFields["remote_dir"],
                  let listenPortText = currentFields["listen_port"],
                  let listenPort = Int(listenPortText) else {
                currentFields = [:]
                return
            }

            discovered.append(
                DiscoveredRemoteProxyInstance(
                    serviceName: serviceName,
                    serverID: resolvedDiscoveredServerID(
                        explicitServerID: currentFields["server_id"],
                        serviceName: serviceName
                    ),
                    label: normalizedMetadataValue(currentFields["label"]),
                    remoteDir: remoteDir,
                    listenPort: listenPort,
                    installed: parseFlag(currentFields["installed"]),
                    serviceInstalled: parseFlag(currentFields["service_installed"]),
                    running: parseFlag(currentFields["running"]),
                    enabled: parseFlag(currentFields["enabled"]),
                    pid: currentFields["pid"].flatMap(Int.init),
                    apiKeyPresent: parseFlag(currentFields["api_key_present"]),
                    baseURL: "http://\(host):\(listenPort)/v1"
                )
            )
            currentFields = [:]
        }

        for rawLine in output.split(whereSeparator: \.isNewline) {
            let line = String(rawLine)
            if line == RemoteProxyDeploymentPlan.discoveryRecordMarker {
                finishCurrentInstance()
                continue
            }
            let components = line.split(separator: "=", maxSplits: 1)
            guard components.count == 2 else { continue }
            currentFields[String(components[0])] = String(components[1])
        }
        finishCurrentInstance()
        return discovered
    }

    private static func parseFlag(_ value: String?) -> Bool {
        value == "1"
    }

    private static func normalizedMetadataValue(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func resolvedDiscoveredServerID(
        explicitServerID: String?,
        serviceName: String
    ) -> String? {
        if let explicit = normalizedMetadataValue(explicitServerID) {
            return explicit
        }
        let prefix = "codex-tools-proxyd-"
        let suffix = ".service"
        guard serviceName.hasPrefix(prefix), serviceName.hasSuffix(suffix) else { return nil }
        let start = serviceName.index(serviceName.startIndex, offsetBy: prefix.count)
        let end = serviceName.index(serviceName.endIndex, offsetBy: -suffix.count)
        let candidate = String(serviceName[start..<end])
        return normalizedMetadataValue(candidate)
    }
}
