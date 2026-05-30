import Foundation

enum AccountsPageActionIntent: String, Hashable {
    case importCurrentAuth
    case importAccountsBackup
    case exportAccountsBackup
    case addAccount
    case smartSwitch
    case warmUpWeeklyQuota
    case refreshUsage
    case toggleCollapse
}

enum AccountsActionContentStyle: Equatable {
    case label
    case icon
}

enum AccountsActionSurfaceStyle: Equatable {
    case neutral
    case prominent
    case mint
}

struct AccountsActionButtonDescriptor<Intent: Hashable>: Identifiable, Equatable {
    let intent: Intent
    let title: String?
    let systemImage: String
    let accessibilityLabel: String
    let isEnabled: Bool
    let isSpinning: Bool
    let contentStyle: AccountsActionContentStyle
    let surfaceStyle: AccountsActionSurfaceStyle

    var id: String {
        String(describing: intent)
    }
}

enum AccountsActionPresentation {
    static func desktopButtons(
        isImporting: Bool,
        isFileImporting: Bool,
        isExporting: Bool,
        isAdding: Bool,
        switchingAccountID: String?,
        canRefreshUsage: Bool,
        isRefreshSpinnerActive: Bool,
        canWarmUpWeeklyQuota: Bool = true,
        isWeeklyQuotaWarmupActive: Bool = false
    ) -> [AccountsActionButtonDescriptor<AccountsPageActionIntent>] {
        [
            AccountsActionButtonDescriptor(
                intent: .exportAccountsBackup,
                title: isExporting
                    ? L10n.tr("accounts.action.exporting")
                    : L10n.tr("accounts.action.export_accounts"),
                systemImage: "square.and.arrow.up",
                accessibilityLabel: isExporting
                    ? L10n.tr("accounts.action.exporting")
                    : L10n.tr("accounts.action.export_accounts"),
                isEnabled: !isImporting && !isFileImporting && !isExporting && !isAdding,
                isSpinning: false,
                contentStyle: .label,
                surfaceStyle: .neutral
            ),
            AccountsActionButtonDescriptor(
                intent: .importAccountsBackup,
                title: isFileImporting
                    ? L10n.tr("accounts.action.importing")
                    : L10n.tr("accounts.action.import_backup"),
                systemImage: "tray.and.arrow.down",
                accessibilityLabel: isFileImporting
                    ? L10n.tr("accounts.action.importing")
                    : L10n.tr("accounts.action.import_backup"),
                isEnabled: !isImporting && !isFileImporting && !isExporting && !isAdding,
                isSpinning: false,
                contentStyle: .label,
                surfaceStyle: .neutral
            ),
            AccountsActionButtonDescriptor(
                intent: .importCurrentAuth,
                title: isImporting
                    ? L10n.tr("accounts.action.importing")
                    : L10n.tr("accounts.action.import_current_auth"),
                systemImage: "square.and.arrow.down",
                accessibilityLabel: isImporting
                    ? L10n.tr("accounts.action.importing")
                    : L10n.tr("accounts.action.import_current_auth"),
                isEnabled: !isImporting && !isFileImporting && !isExporting && !isAdding,
                isSpinning: false,
                contentStyle: .label,
                surfaceStyle: .neutral
            ),
            AccountsActionButtonDescriptor(
                intent: .addAccount,
                title: isAdding
                    ? L10n.tr("accounts.action.waiting_for_login")
                    : L10n.tr("accounts.action.add_account"),
                systemImage: "plus",
                accessibilityLabel: isAdding
                    ? L10n.tr("accounts.action.waiting_for_login")
                    : L10n.tr("accounts.action.add_account"),
                isEnabled: !isImporting && !isFileImporting && !isExporting && !isAdding,
                isSpinning: false,
                contentStyle: .label,
                surfaceStyle: .prominent
            ),
            AccountsActionButtonDescriptor(
                intent: .smartSwitch,
                title: L10n.tr("accounts.action.smart_switch"),
                systemImage: "wand.and.stars",
                accessibilityLabel: L10n.tr("accounts.action.smart_switch"),
                isEnabled: !isImporting && !isFileImporting && !isExporting && !isAdding && switchingAccountID == nil,
                isSpinning: false,
                contentStyle: .label,
                surfaceStyle: .neutral
            ),
            AccountsActionButtonDescriptor(
                intent: .warmUpWeeklyQuota,
                title: isWeeklyQuotaWarmupActive
                    ? L10n.tr("accounts.action.warming_up_weekly_quota")
                    : L10n.tr("accounts.action.warm_up_weekly_quota"),
                systemImage: "flame",
                accessibilityLabel: isWeeklyQuotaWarmupActive
                    ? L10n.tr("accounts.action.warming_up_weekly_quota")
                    : L10n.tr("accounts.action.warm_up_weekly_quota"),
                isEnabled: !isImporting
                    && !isFileImporting
                    && !isExporting
                    && !isAdding
                    && switchingAccountID == nil
                    && canWarmUpWeeklyQuota,
                isSpinning: false,
                contentStyle: .label,
                surfaceStyle: .neutral
            ),
            AccountsActionButtonDescriptor(
                intent: .refreshUsage,
                title: nil,
                systemImage: "arrow.trianglehead.clockwise.rotate.90",
                accessibilityLabel: L10n.tr("common.refresh_usage"),
                isEnabled: canRefreshUsage,
                isSpinning: isRefreshSpinnerActive,
                contentStyle: .icon,
                surfaceStyle: .mint
            )
        ]
    }

    static func leadingToolbarButtons(
        isImporting: Bool,
        isAdding: Bool
    ) -> [AccountsActionButtonDescriptor<AccountsPageActionIntent>] {
        [
            AccountsActionButtonDescriptor(
                intent: .addAccount,
                title: nil,
                systemImage: "plus",
                accessibilityLabel: isAdding
                    ? L10n.tr("accounts.action.waiting_for_login")
                    : L10n.tr("accounts.action.add_account"),
                isEnabled: !isImporting && !isAdding,
                isSpinning: false,
                contentStyle: .icon,
                surfaceStyle: .neutral
            )
        ]
    }

    static func trailingToolbarButtons(
        canRefreshUsage: Bool,
        isRefreshSpinnerActive: Bool,
        areAllAccountsCollapsed: Bool
    ) -> [AccountsActionButtonDescriptor<AccountsPageActionIntent>] {
        [
            AccountsActionButtonDescriptor(
                intent: .refreshUsage,
                title: nil,
                systemImage: "arrow.trianglehead.clockwise.rotate.90",
                accessibilityLabel: L10n.tr("common.refresh_usage"),
                isEnabled: canRefreshUsage,
                isSpinning: isRefreshSpinnerActive,
                contentStyle: .icon,
                surfaceStyle: .neutral
            ),
            AccountsActionButtonDescriptor(
                intent: .toggleCollapse,
                title: nil,
                systemImage: areAllAccountsCollapsed ? "chevron.down" : "chevron.up",
                accessibilityLabel: areAllAccountsCollapsed
                    ? L10n.tr("accounts.action.expand_all")
                    : L10n.tr("accounts.action.collapse_all"),
                isEnabled: true,
                isSpinning: false,
                contentStyle: .icon,
                surfaceStyle: .neutral
            )
        ]
    }

}
