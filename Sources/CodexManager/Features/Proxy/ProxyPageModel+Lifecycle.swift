import Foundation

extension ProxyPageModel {
    func bootstrapOnAppLaunch(using settings: AppSettings) async {
        guard !didRunLaunchBootstrap else { return }
        didRunLaunchBootstrap = true

        applySettings(settings)
        await refreshLocalRuntimeStatus()

        guard settings.autoStartApiProxy, !proxyStatus.running else { return }

        do {
            proxyStatus = try await coordinator.startProxy(preferredPort: nil)
            await refreshLocalRuntimeStatus()
        } catch {
            notice = NoticeMessage(style: .error, text: error.localizedDescription)
        }
    }

    func loadIfNeeded() async {
        if !hasLoaded {
            await load()
        } else {
            await refreshForTabEntry()
        }
    }

    func refreshForTabEntry() async {
        do {
            let settings = try await settingsCoordinator.currentSettings()
            applySettings(settings)
            await refreshLocalRuntimeStatus()
        } catch {
            notice = NoticeMessage(style: .error, text: error.localizedDescription)
        }
    }

    func load() async {
        loading = true
        defer { loading = false }

        do {
            let settings = try await settingsCoordinator.currentSettings()
            applySettings(settings)
            await refreshLocalRuntimeStatus()
            hasLoaded = true
        } catch {
            notice = NoticeMessage(style: .error, text: error.localizedDescription)
        }
    }
}
