import Foundation

actor RemoteAccountsMutationSyncService: RemoteAccountsMutationSyncServiceProtocol {
    private let settingsCoordinator: SettingsCoordinator
    private let proxyCoordinator: ProxyCoordinator

    init(
        settingsCoordinator: SettingsCoordinator,
        proxyCoordinator: ProxyCoordinator
    ) {
        self.settingsCoordinator = settingsCoordinator
        self.proxyCoordinator = proxyCoordinator
    }

    func syncConfiguredRemoteAccounts() async -> RemoteAccountsMutationSyncReport {
        do {
            let settings = try await settingsCoordinator.currentSettings()
            guard !settings.remoteServers.isEmpty else { return .empty }

            var synchronizedServerLabels: [String] = []
            var failures: [String] = []

            for server in settings.remoteServers {
                do {
                    _ = try await proxyCoordinator.syncRemoteAccounts(server: server)
                    synchronizedServerLabels.append(remoteServerLabel(for: server))
                } catch {
                    failures.append("\(remoteServerLabel(for: server)): \(error.localizedDescription)")
                }
            }

            return RemoteAccountsMutationSyncReport(
                synchronizedServerLabels: synchronizedServerLabels,
                failures: failures
            )
        } catch {
            return RemoteAccountsMutationSyncReport(
                synchronizedServerLabels: [],
                failures: [error.localizedDescription]
            )
        }
    }

    private func remoteServerLabel(for server: RemoteServerConfig) -> String {
        let label = server.label.trimmingCharacters(in: .whitespacesAndNewlines)
        return label.isEmpty ? server.host : label
    }
}
