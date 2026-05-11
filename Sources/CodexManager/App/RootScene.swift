import SwiftUI
import Combine
#if canImport(AppKit)
import AppKit
#endif
#if canImport(UIKit)
import UIKit
#endif

struct RootScene: View {
    @State private var selectedTab: AppTab = .accounts
    @StateObject private var accountsModel: AccountsPageModel
    @StateObject private var settingsModel: SettingsPageModel
    @StateObject private var proxyModel: ProxyPageModel
    @ObservedObject private var trayModel: TrayMenuModel
    private let container: AppContainer

    init(container: AppContainer, trayModel: TrayMenuModel) {
        self.container = container
        _accountsModel = StateObject(wrappedValue: container.accountsModel)
        _settingsModel = StateObject(wrappedValue: container.settingsModel)
        _proxyModel = StateObject(wrappedValue: container.proxyModel ?? ProxyPageModel.placeholder)
        self.trayModel = trayModel
    }

    private var runtimeLocale: Locale {
        Locale(identifier: AppLocale.resolve(settingsModel.settings.locale).identifier)
    }

    private var currentNotice: NoticeMessage? {
        switch selectedTab {
        case .accounts:
            return accountsModel.notice
        case .proxy:
            return proxyModel.notice
        case .settings:
            return settingsModel.notice
        }
    }

    private var currentAppLocale: AppLocale {
        AppLocale.resolve(settingsModel.settings.locale)
    }

    var body: some View {
        platformTabShell
        .environment(\.locale, runtimeLocale)
        .onAppear {
            L10n.setLocale(identifier: settingsModel.settings.locale)
        }
        .onChange(of: settingsModel.settings.locale) { _, value in
            L10n.setLocale(identifier: value)
        }
        .onReceive(trayModel.$accounts.removeDuplicates()) { accounts in
            accountsModel.syncFromBackgroundRefresh(accounts)
        }
        .onReceive(trayModel.$isFetchingRemoteUsage.removeDuplicates()) { isRefreshing in
            accountsModel.syncRemoteUsageRefreshActivity(isRefreshing: isRefreshing)
        }
        .task {
            await settingsModel.loadIfNeeded()
        }
        .rootSceneNoticePresentation(currentNotice)
        #if os(macOS)
        .background {
            WindowSizeEnforcer(
                minWidth: LayoutRules.minimumPanelWidth,
                maxWidth: LayoutRules.maximumPanelWidth,
                minHeight: LayoutRules.minimumPanelHeight,
                idealHeight: LayoutRules.defaultPanelHeight
            )
            .frame(width: 0, height: 0)
        }
        .frame(
            minWidth: LayoutRules.minimumPanelWidth,
            idealWidth: LayoutRules.defaultPanelWidth,
            maxWidth: LayoutRules.maximumPanelWidth,
            minHeight: LayoutRules.minimumPanelHeight
        )
        #else
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(uiColor: .systemBackground))
        #endif
    }

    @ViewBuilder
    private var platformTabShell: some View {
        #if os(iOS)
        TabView(selection: $selectedTab) {
            NavigationStack {
                AccountsPageView(
                    model: accountsModel,
                    currentLocale: currentAppLocale,
                    onSelectLocale: { locale in
                        settingsModel.setLocale(locale.identifier)
                    }
                )
            }
            .tag(AppTab.accounts)
            .tabItem {
                Label {
                    Text(AppTab.accounts.toolbarTitle)
                } icon: {
                    Image(systemName: AppTab.accounts.iconName)
                }
            }
        }
        #else
        HStack(spacing: 0) {
            AppSidebar(selectedTab: $selectedTab)

            Divider()

            ZStack(alignment: .topLeading) {
                activePage
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .transition(.opacity.combined(with: .move(edge: .trailing)))
            }
            .background(AppTheme.windowBackground)
        }
        .background(AppTheme.windowBackground)
        .animation(.easeInOut(duration: 0.16), value: selectedTab)
        #endif
    }

    @ViewBuilder
    private var activePage: some View {
        switch selectedTab {
        case .accounts:
            AccountsPageView(
                model: accountsModel,
                currentLocale: currentAppLocale,
                onSelectLocale: { locale in
                    settingsModel.setLocale(locale.identifier)
                }
            )
        case .proxy:
            ProxyPageView(model: proxyModel)
        case .settings:
            SettingsPageView(model: settingsModel)
        }
    }
}

private struct AppSidebar: View {
    @Binding var selectedTab: AppTab

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            AppSidebarHeader()

            VStack(alignment: .leading, spacing: 4) {
                ForEach(AppTab.allCases) { tab in
                    AppSidebarTabButton(
                        tab: tab,
                        isSelected: selectedTab == tab
                    ) {
                        selectedTab = tab
                    }
                }
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.top, 16)
        .padding(.bottom, 14)
        .frame(width: 168)
        .frame(maxHeight: .infinity, alignment: .topLeading)
        .background(AppTheme.sidebarBackground)
    }
}

private struct AppSidebarHeader: View {
    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(AppTheme.accent)
                Image(systemName: "curlybraces")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
            }
            .frame(width: 30, height: 30)

            Text("CodexManager")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.primary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct AppSidebarTabButton: View {
    let tab: AppTab
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: tab.iconName)
                    .font(.system(size: 14, weight: .semibold))
                    .frame(width: 18, alignment: .center)

                Text(tab.toolbarTitle)
                    .font(.system(size: 13, weight: isSelected ? .semibold : .medium))
                    .lineLimit(1)

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .frame(height: 34)
            .foregroundStyle(isSelected ? AppTheme.accentStrong : .secondary)
            .background {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(isSelected ? AppTheme.accentSoft : Color.clear)
            }
            .overlay(alignment: .leading) {
                if isSelected {
                    RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                        .fill(AppTheme.accent)
                        .frame(width: 3, height: 16)
                        .padding(.leading, 1)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

private struct DeferredPagePlaceholder: View {
    var body: some View {
        VStack {
            ProgressView()
                .controlSize(.large)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}

private extension View {
    @ViewBuilder
    func rootSceneNoticePresentation(_ notice: NoticeMessage?) -> some View {
        #if os(iOS)
        self
            .animation(.easeInOut(duration: 0.2), value: notice)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                NoticeBanner(notice: notice)
                    .allowsHitTesting(false)
                    .padding(.horizontal, LayoutRules.pagePadding)
                    .padding(.bottom, 6)
            }
        #else
        self
            .overlay(alignment: .top) {
                NoticeBanner(notice: notice)
                    .padding(.horizontal, LayoutRules.pagePadding)
                    .padding(.top, 6)
                    .allowsHitTesting(false)
                    .zIndex(10)
            }
        #endif
    }
}

#if canImport(AppKit)
private struct WindowSizeEnforcer: NSViewRepresentable {
    let minWidth: CGFloat
    let maxWidth: CGFloat
    let minHeight: CGFloat
    let idealHeight: CGFloat

    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        DispatchQueue.main.async {
            apply(on: view.window)
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async {
            apply(on: nsView.window)
        }
    }

    private func apply(on window: NSWindow?) {
        guard let window else { return }
        window.contentMinSize = NSSize(width: minWidth, height: minHeight)
        window.contentMaxSize = NSSize(width: maxWidth, height: .greatestFiniteMagnitude)

        var targetSize = window.contentLayoutRect.size
        let clampedWidth = min(max(targetSize.width, minWidth), maxWidth)
        let clampedHeight = max(targetSize.height, minHeight)

        guard clampedWidth != targetSize.width || clampedHeight != targetSize.height else { return }
        targetSize.width = clampedWidth
        targetSize.height = clampedHeight > 0 ? clampedHeight : idealHeight
        window.setContentSize(targetSize)
    }
}
#else
private struct WindowSizeEnforcer: View {
    let minWidth: CGFloat
    let maxWidth: CGFloat
    let minHeight: CGFloat
    let idealHeight: CGFloat

    var body: some View {
        EmptyView()
    }
}
#endif


private extension AppTab {
    var iconName: String {
        switch self {
        case .accounts: return "person.2.fill"
        case .proxy: return "server.rack"
        case .settings: return "gearshape.fill"
        }
    }

    var titleTranslationKey: String {
        switch self {
        case .accounts: return "tab.accounts"
        case .proxy: return "tab.proxy"
        case .settings: return "tab.settings"
        }
    }

    var titleKey: LocalizedStringKey {
        switch self {
        case .accounts: return "tab.accounts"
        case .proxy: return "tab.proxy"
        case .settings: return "tab.settings"
        }
    }

    var toolbarTitle: String {
        L10n.tr(titleTranslationKey)
    }
}
