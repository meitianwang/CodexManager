import Foundation

extension ProxyPageModel {
    func refreshStatus() async {
        loading = true
        defer { loading = false }
        proxyStatus = await coordinator.loadStatus()
    }

    func startProxy() async {
        loading = true
        defer { loading = false }

        let preferredPort = Int(preferredPortText)

        do {
            proxyStatus = try await coordinator.startProxy(preferredPort: preferredPort)
            notice = NoticeMessage(style: .success, text: L10n.tr("proxy.notice.api_proxy_started"))
            // Auto-fetch models after start, matching kiro-gateway-swift behavior
            Task {
                try? await Task.sleep(for: .seconds(1))
                self.fetchModels()
            }
        } catch {
            notice = NoticeMessage(style: .error, text: error.localizedDescription)
        }
    }

    func stopProxy() async {
        loading = true
        defer { loading = false }

        proxyStatus = await coordinator.stopProxy()
        notice = NoticeMessage(style: .info, text: L10n.tr("proxy.notice.api_proxy_stopped"))
    }

    func refreshAPIKey() async {
        loading = true
        defer { loading = false }

        do {
            proxyStatus = try await coordinator.refreshAPIKey()
            notice = NoticeMessage(style: .success, text: L10n.tr("proxy.notice.api_key_refreshed"))
        } catch {
            notice = NoticeMessage(style: .error, text: error.localizedDescription)
        }
    }

    func setAutoStartProxy(_ value: Bool) async {
        do {
            let settings = try await settingsCoordinator.updateSettings(
                AppSettingsPatch(autoStartApiProxy: value)
            )
            autoStartProxy = settings.autoStartApiProxy
            notice = NoticeMessage(style: .success, text: L10n.tr("proxy.notice.auto_start_updated"))
        } catch {
            notice = NoticeMessage(style: .error, text: error.localizedDescription)
        }
    }

    func refreshLocalRuntimeStatus() async {
        proxyStatus = await coordinator.loadStatus()
    }
}
