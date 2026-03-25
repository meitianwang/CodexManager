import Foundation

extension ProxyPageModel {
    func updatePreferredPortText(_ value: String) {
        guard preferredPortText != value else { return }
        preferredPortText = value
        scheduleProxyConfigurationSync()
    }

    var currentProxyConfiguration: ProxyConfiguration {
        ProxyConfiguration(preferredPortText: preferredPortText)
    }

    func applySettings(_ settings: AppSettings) {
        autoStartProxy = settings.autoStartApiProxy
        applyProxyConfiguration(settings.proxyConfiguration)
    }

    private func applyProxyConfiguration(_ configuration: ProxyConfiguration) {
        let normalized = configuration.normalized()
        preferredPortText = normalized.preferredPortText
        lastSyncedProxyConfiguration = normalized
    }

    private func scheduleProxyConfigurationSync() {
        Task { [weak self] in
            guard let self else { return }
            let configuration = self.currentProxyConfiguration
            guard configuration != self.lastSyncedProxyConfiguration else { return }
            do {
                _ = try await self.settingsCoordinator.updateSettings(
                    AppSettingsPatch(proxyConfiguration: configuration)
                )
                self.lastSyncedProxyConfiguration = configuration
            } catch {
                self.notice = NoticeMessage(style: .error, text: error.localizedDescription)
            }
        }
    }
}
