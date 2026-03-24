import Foundation

enum AccountCardAccent: Equatable {
    case orange
    case pink
    case gray
    case indigo
    case teal
}

struct AccountWindowPresentation: Equatable {
    let title: String
    let usedPercent: Double
    let usedText: String
    let remainingText: String
    let resetText: String
}

struct AccountCompactUsagePresentation: Equatable {
    let fiveHourUsedPercent: Double?
    let oneWeekUsedPercent: Double?
}

struct AccountCardPresentation: Equatable {
    let accent: AccountCardAccent
    let planLabel: String
    let teamNameTag: String?
    let displayAccountName: String
    let creditsText: String
    let fiveHourWindow: AccountWindowPresentation
    let oneWeekWindow: AccountWindowPresentation
    let compactUsage: AccountCompactUsagePresentation

    init(account: AccountSummary, isCollapsed: Bool, locale: Locale) {
        let planLabel = account.normalizedPlanLabel
        self.planLabel = planLabel
        accent = Self.accent(for: planLabel)
        teamNameTag = account.shouldDisplayWorkspaceTag ? account.displayTeamName : nil
        displayAccountName = Self.displayName(for: account, isCollapsed: isCollapsed)
        creditsText = Self.creditsText(for: account)
        fiveHourWindow = Self.windowPresentation(
            title: L10n.tr("accounts.window.five_hour"),
            window: account.usage?.fiveHour,
            locale: locale
        )
        oneWeekWindow = Self.windowPresentation(
            title: L10n.tr("accounts.window.one_week"),
            window: account.usage?.oneWeek,
            locale: locale
        )
        compactUsage = AccountCompactUsagePresentation(
            fiveHourUsedPercent: Self.compactUsedPercent(account.usage?.fiveHour),
            oneWeekUsedPercent: Self.compactUsedPercent(account.usage?.oneWeek)
        )
    }

    private static func accent(for planLabel: String) -> AccountCardAccent {
        switch planLabel {
        case "PRO":
            .orange
        case "PLUS":
            .pink
        case "FREE":
            .gray
        case "ENTERPRISE", "BUSINESS":
            .indigo
        default:
            .teal
        }
    }

    private static func displayName(for account: AccountSummary, isCollapsed: Bool) -> String {
        AccountDisplayNameFormatter.format(
            account: account,
            style: isCollapsed ? .localPart : .full
        )
    }

    private static func creditsText(for account: AccountSummary) -> String {
        guard let credits = account.usage?.credits else { return "--" }
        if credits.unlimited { return L10n.tr("accounts.card.unlimited") }
        return credits.balance ?? "--"
    }

    private static func windowPresentation(
        title: String,
        window: UsageWindow?,
        locale: Locale
    ) -> AccountWindowPresentation {
        let usedRaw = clamped(window?.usedPercent, fallback: 100)
        let used = roundedPercent(usedRaw)
        let remaining = max(0, 100 - used)
        return AccountWindowPresentation(
            title: title,
            usedPercent: used,
            usedText: L10n.tr("accounts.window.used_format", percent(used)),
            remainingText: L10n.tr("accounts.window.remaining_format", percent(remaining)),
            resetText: L10n.tr("accounts.window.reset_at_format", formatResetAt(window?.resetAt, locale: locale))
        )
    }

    private static func compactUsedPercent(_ window: UsageWindow?) -> Double? {
        guard let used = window?.usedPercent else { return nil }
        return clamped(used, fallback: used)
    }

    private static func clamped(_ value: Double?, fallback: Double) -> Double {
        guard let value else { return fallback }
        return max(0, min(100, value))
    }

    private static func roundedPercent(_ value: Double) -> Double {
        Double(Int(value.rounded()))
    }

    private static func percent(_ value: Double) -> String {
        "\(Int(value.rounded()))%"
    }

    private static func formatResetAt(_ epoch: Int64?, locale: Locale) -> String {
        guard let epoch else { return "--" }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.dateStyle = .short
        formatter.timeStyle = .medium
        return formatter.string(from: Date(timeIntervalSince1970: TimeInterval(epoch)))
    }
}
