import SwiftUI
import CloudKit
#if canImport(AppKit)
import AppKit
#endif
#if canImport(UIKit)
import UIKit
#endif

@main
struct CodexManagerApp: App {
    private let container: AppContainer
    @StateObject private var trayModel: TrayMenuModel
    #if os(macOS)
    @NSApplicationDelegateAdaptor(CodexManagerAppDelegate.self) private var appDelegate
    #elseif os(iOS)
    @UIApplicationDelegateAdaptor(CodexManagerAppDelegate.self) private var appDelegate
    #endif

    init() {
        let container = AppContainer.liveOrCrash()
        self.container = container
        _trayModel = StateObject(wrappedValue: container.trayModel)
        Task { @MainActor in
            container.trayModel.startBackgroundRefresh()
            #if os(macOS)
            await container.proxyControlBridge.start()
            #endif
        }
    }

    var body: some Scene {
        #if os(macOS)
        MenuBarExtra {
            TrayPopoverView(trayModel: trayModel)
        } label: {
            menuBarIcon
        }
        .menuBarExtraStyle(.window)

        Window("CodexManager", id: "main-panel") {
            RootScene(container: container, trayModel: trayModel)
                .frame(
                    minWidth: LayoutRules.minimumPanelWidth,
                    idealWidth: LayoutRules.defaultPanelWidth,
                    maxWidth: LayoutRules.maximumPanelWidth,
                    minHeight: LayoutRules.minimumPanelHeight,
                    idealHeight: LayoutRules.defaultPanelHeight
                )
        }
        .windowResizability(.contentSize)
        .defaultPosition(.center)
        #else
        WindowGroup {
            RootScene(container: container, trayModel: trayModel)
        }
        #endif
    }

    #if os(macOS)
    private var menuBarIcon: Image {
        #if canImport(AppKit)
        if let icon = makeMenuBarSymbolImage() {
            return Image(nsImage: icon)
        }
        #endif
        return Image(systemName: "tray.2")
    }

    #if canImport(AppKit)
    private func makeMenuBarSymbolImage() -> NSImage? {
        guard let base = NSImage(systemSymbolName: "tray.2", accessibilityDescription: "CodexManager") else {
            return nil
        }

        let symbolConfig = NSImage.SymbolConfiguration(pointSize: 17, weight: .black, scale: .large)
        let configured = base.withSymbolConfiguration(symbolConfig) ?? base

        let canvasSize = NSSize(width: 18, height: 18)
        let symbolSize = configured.size
        guard symbolSize.width > 0, symbolSize.height > 0 else {
            configured.isTemplate = true
            return configured
        }

        let fitScale = min(canvasSize.width / symbolSize.width, canvasSize.height / symbolSize.height) * 1.08
        let drawSize = NSSize(width: symbolSize.width * fitScale, height: symbolSize.height * fitScale)
        let drawRect = NSRect(
            x: (canvasSize.width - drawSize.width) / 2,
            y: (canvasSize.height - drawSize.height) / 2,
            width: drawSize.width,
            height: drawSize.height
        )

        let canvas = NSImage(size: canvasSize)
        canvas.lockFocus()
        configured.draw(
            in: drawRect,
            from: .zero,
            operation: .sourceOver,
            fraction: 1
        )
        canvas.unlockFocus()
        canvas.isTemplate = true
        return canvas
    }
    #endif
    #endif
}

// MARK: - Tray Popover View

#if os(macOS)
struct TrayPopoverView: View {
    @ObservedObject var trayModel: TrayMenuModel
    @Environment(\.openWindow) private var openWindow

    private var currentAccount: AccountSummary? {
        trayModel.accounts.first(where: { $0.isCurrent })
    }

    private var totalAccounts: Int {
        trayModel.accounts.count
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Status header
            statusSection
                .padding(.horizontal, 16)
                .padding(.top, 16)
                .padding(.bottom, 12)

            Divider()
                .padding(.horizontal, 12)

            // Actions
            VStack(spacing: 2) {
                TrayActionButton(
                    icon: "macwindow",
                    title: L10n.tr("tray.action.open_panel"),
                    action: {
                        openWindow(id: "main-panel")
                        NSApp.activate(ignoringOtherApps: true)
                    }
                )

                TrayActionButton(
                    icon: "power",
                    title: L10n.tr("tray.action.quit"),
                    isDestructive: true,
                    action: {
                        NSApp.terminate(nil)
                    }
                )
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 8)
        }
        .frame(width: 260)
    }

    @ViewBuilder
    private var statusSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            // App icon + title
            HStack(spacing: 10) {
                Image(systemName: "tray.2.fill")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Color.accentColor)

                VStack(alignment: .leading, spacing: 2) {
                    Text("CodexManager")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.primary)

                    if let account = currentAccount {
                        Text(L10n.tr("tray.status.current_format", account.label))
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                    } else {
                        Text(L10n.tr("tray.status.no_account"))
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer(minLength: 0)
            }

            // Quick stats
            if totalAccounts > 0 {
                HStack(spacing: 12) {
                    StatChip(
                        icon: "person.2.fill",
                        text: L10n.tr("tray.status.accounts_count_format", "\(totalAccounts)")
                    )

                    if let account = currentAccount, let usage = account.usage?.fiveHour {
                        let remaining = max(0, Int((100 - usage.usedPercent).rounded()))
                        StatChip(
                            icon: "chart.bar.fill",
                            text: L10n.tr("tray.status.remaining_format", "\(remaining)%")
                        )
                    }
                }
                .padding(.top, 4)
            }
        }
    }
}

private struct StatChip: View {
    let icon: String
    let text: String

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 10))
            Text(text)
                .font(.system(size: 11, weight: .medium))
        }
        .foregroundStyle(.secondary)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background {
            Capsule()
                .fill(.quaternary)
        }
    }
}

private struct TrayActionButton: View {
    let icon: String
    let title: String
    var isDestructive: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .medium))
                    .frame(width: 20, alignment: .center)
                Text(title)
                    .font(.system(size: 13))
                Spacer(minLength: 0)
            }
            .foregroundStyle(isDestructive ? Color.red : Color.primary)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background {
            RoundedRectangle(cornerRadius: 6)
                .fill(.clear)
        }
        .onHover { hovering in
            if hovering {
                NSCursor.pointingHand.push()
            } else {
                NSCursor.pop()
            }
        }
    }
}
#endif

// MARK: - App Delegates

#if os(macOS)
@MainActor
private final class CodexManagerAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        _ = notification
        NSApplication.shared.registerForRemoteNotifications()
    }

    func application(_ application: NSApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        _ = application
        _ = deviceToken
    }

    func application(_ application: NSApplication, didReceiveRemoteNotification userInfo: [String : Any]) {
        _ = application
        handleRemoteNotification(userInfo)
    }
}
#elseif os(iOS)
@MainActor
private final class CodexManagerAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey : Any]? = nil
    ) -> Bool {
        _ = launchOptions
        application.registerForRemoteNotifications()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        _ = application
        _ = deviceToken
    }

    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable : Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        _ = application
        let handled = handleRemoteNotification(userInfo)
        completionHandler(handled ? .newData : .noData)
    }
}
#endif

@discardableResult
private func handleRemoteNotification(_ userInfo: [AnyHashable: Any]) -> Bool {
    let payload = userInfo.reduce(into: [String: Any]()) { partialResult, entry in
        if let key = entry.key as? String {
            partialResult[key] = entry.value
        }
    }

    guard let notification = CKNotification(fromRemoteNotificationDictionary: payload) else {
        return false
    }

    if notification.subscriptionID == CloudKitCurrentAccountSelectionSyncService.pushSubscriptionID {
        NotificationCenter.default.post(name: .codexManagerCurrentAccountSelectionPushDidArrive, object: nil)
        return true
    }

    if notification.subscriptionID == CloudKitAccountsSyncService.pushSubscriptionID {
        NotificationCenter.default.post(name: .codexManagerAccountsSnapshotPushDidArrive, object: nil)
        return true
    }

    if notification.subscriptionID == CloudKitProxyControlSyncService.pushSubscriptionID {
        NotificationCenter.default.post(name: .codexManagerProxyControlPushDidArrive, object: nil)
        return true
    }

    return false
}
