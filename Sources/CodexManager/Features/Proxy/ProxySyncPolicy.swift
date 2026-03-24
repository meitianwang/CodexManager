import Foundation

enum ProxySyncPolicy {
    enum RemoteControl {
        static let snapshotSyncInterval: Duration = .seconds(1)
        static let snapshotFreshnessWindowMilliseconds: Int64 = 5_000
        static let remoteStatusesFreshnessWindowMilliseconds: Int64 = 12_000
        static let commandAckPollLimit = 24
        static let commandAckPollInterval: Duration = .milliseconds(250)
        static let logAckPollLimit = 36
        static let logAckPollInterval: Duration = .milliseconds(250)
    }

    enum Configuration {
        static let debounceInterval: Duration = .milliseconds(350)
    }

    enum RemoteLogs {
        static let maxCharactersPerServer = 12_000
        private static let truncationMarker = "...\n"

        static func normalize(_ logs: [String: String]) -> [String: String] {
            logs.mapValues(normalize)
        }

        static func normalize(_ log: String) -> String {
            guard log.count > maxCharactersPerServer else { return log }
            let suffixLength = max(0, maxCharactersPerServer - truncationMarker.count)
            return truncationMarker + String(log.suffix(suffixLength))
        }

        static func normalize(_ snapshot: ProxyControlSnapshot) -> ProxyControlSnapshot {
            var snapshot = snapshot
            snapshot.remoteLogs = normalize(snapshot.remoteLogs)
            return snapshot
        }
    }
}
