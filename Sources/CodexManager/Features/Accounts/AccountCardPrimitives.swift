import SwiftUI

enum AccountCardMorphRules {
    static let response = 0.34
    static let dampingFraction = 0.84
    static let titleExpansionProgress = 0.68
    static let animation = Animation.spring(response: response, dampingFraction: dampingFraction)
    static let contentAnimation = Animation.easeInOut(duration: 0.12)

    static var titleExpansionDelay: Duration {
        .seconds(response * titleExpansionProgress)
    }
}

enum AccountCardSwitchButtonLabelStyle {
    case iconOnly
    case expanded
}

struct AccountCardPalette {
    let toneColor: Color
    let surfaceTint: Color?

    init(accent: AccountCardAccent, isCurrent: Bool) {
        switch accent {
        case .gray:
            toneColor = AppTheme.planForeground(for: "FREE")
        case .orange, .teal:
            toneColor = AppTheme.planForeground(for: "TEAM")
        case .pink:
            toneColor = AppTheme.planForeground(for: "PLUS")
        case .indigo:
            toneColor = AppTheme.accent
        }
        _ = isCurrent
        surfaceTint = nil
    }
}

private struct AccountCardSurfaceModifier: ViewModifier {
    let cornerRadius: CGFloat
    let tint: Color?

    func body(content: Content) -> some View {
        content.cardSurface(cornerRadius: cornerRadius, tint: tint)
    }
}

extension View {
    func accountCardSurface(
        cornerRadius: CGFloat = 12,
        tint: Color? = nil
    ) -> some View {
        modifier(AccountCardSurfaceModifier(cornerRadius: cornerRadius, tint: tint))
    }
}

struct AccountCardHeaderSection: View {
    let presentation: AccountCardPresentation
    let isCurrent: Bool

    var body: some View {
        HStack(spacing: 8) {
            AccountTagView(
                text: presentation.planLabel,
                backgroundColor: AppTheme.planBackground(for: presentation.planLabel),
                foregroundColor: AppTheme.planForeground(for: presentation.planLabel),
                font: .system(size: 10, weight: .semibold),
                horizontalPadding: 8,
                verticalPadding: 4
            )

            Spacer(minLength: 0)

            if isCurrent {
                AccountTagView(
                    text: L10n.tr("accounts.card.current"),
                    backgroundColor: AppTheme.currentBadgeBackground,
                    foregroundColor: AppTheme.currentBadgeForeground,
                    font: .system(size: 10, weight: .semibold),
                    horizontalPadding: 8,
                    verticalPadding: 4
                )
            } else {
                Image(systemName: "ellipsis")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(AppTheme.primaryText)
                    .frame(width: 18, height: 18)
            }
        }
    }
}

struct AccountCardExpandedUsageSection: View {
    let presentation: AccountCardPresentation
    let usageError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 18) {
                AccountQuotaRing(
                    presentation: presentation.fiveHourWindow,
                    tint: AppTheme.success
                )

                AccountQuotaRing(
                    presentation: presentation.oneWeekWindow,
                    tint: AppTheme.info
                )

                VStack(alignment: .leading, spacing: 5) {
                    Text(L10n.tr("accounts.window.reset_header"))
                        .font(.system(size: 11, weight: .regular))
                        .foregroundStyle(AppTheme.secondaryText)
                    AccountResetTimeRow(window: presentation.fiveHourWindow)
                    AccountResetTimeRow(window: presentation.oneWeekWindow)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 12)
            }

            if let usageError, !usageError.isEmpty {
                Text(usageError)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(AppTheme.destructive)
                    .lineLimit(2)
            }
        }
    }
}

private struct AccountResetTimeRow: View {
    let window: AccountWindowPresentation

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(window.title)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(AppTheme.secondaryText)
                .lineLimit(1)
            Text(window.resetValueText)
                .font(.system(size: 10, weight: .regular))
                .foregroundStyle(AppTheme.primaryText)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .monospacedDigit()
    }
}

struct AccountCardCompactUsageSection: View {
    let presentation: AccountCardPresentation

    var body: some View {
        AccountCompactUsageRow(
            rings: [
                AccountCompactRingDescriptor(
                    id: "five-hour",
                    valueText: compactPercentText(presentation.compactUsage.fiveHourRemainingPercent),
                    subtitleText: "5h",
                    progress: compactProgress(presentation.compactUsage.fiveHourRemainingPercent),
                    tint: AppTheme.success
                ),
                AccountCompactRingDescriptor(
                    id: "one-week",
                    valueText: compactPercentText(presentation.compactUsage.oneWeekRemainingPercent),
                    subtitleText: "1w",
                    progress: compactProgress(presentation.compactUsage.oneWeekRemainingPercent),
                    tint: AppTheme.info
                ),
            ],
            spacing: 12,
            ringSize: 48,
            lineWidth: 5.5
        )
        .frame(maxWidth: .infinity, alignment: .center)
    }

    private func compactProgress(_ remainingPercent: Double?) -> Double {
        guard let remainingPercent else { return 0 }
        return max(0, min(1, remainingPercent / 100))
    }

    private func compactPercentText(_ remainingPercent: Double?) -> String {
        guard let remainingPercent else { return "--" }
        return "\(Int(remainingPercent.rounded()))%"
    }
}

struct AccountCardExpandedActions: View {
    let isCurrent: Bool
    let switching: Bool
    let refreshing: Bool
    let isRefreshEnabled: Bool
    let onSwitch: () -> Void
    let onRefresh: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            AccountSwitchButton(
                switching: switching,
                isEnabled: !isCurrent,
                labelStyle: .expanded,
                onSwitch: onSwitch
            )

            AccountRefreshButton(
                refreshing: refreshing,
                isEnabled: isRefreshEnabled,
                labelStyle: .expanded,
                onRefresh: onRefresh
            )

            Spacer(minLength: 0)

            Button(role: .destructive, action: onDelete) {
                Label("Delete", systemImage: "trash")
                    .lineLimit(1)
            }
            .codexManagerActionButtonStyle(
                prominent: false,
                tint: AppTheme.destructive,
                density: .compact,
                iOSStyle: .liquidGlass
            )
        }
    }
}

struct AccountCollapsedSwitchOverlay: View {
    let isVisible: Bool
    let switching: Bool
    let onDismiss: () -> Void
    let onSwitch: () -> Void

    var body: some View {
        if isVisible {
            ZStack {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(AppTheme.panelBackground)
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(AppTheme.separator, lineWidth: 1)
                    }
                    .onTapGesture {
                        onDismiss()
                    }

                AccountSwitchButton(
                    switching: switching,
                    labelStyle: .expanded,
                    onSwitch: onSwitch
                )
            }
            .transition(.opacity)
        }
    }
}

private struct AccountQuotaRing: View {
    let presentation: AccountWindowPresentation
    let tint: Color

    var body: some View {
        VStack(spacing: 4) {
            ZStack {
                LiquidProgressRing(
                    progress: presentation.remainingPercent / 100,
                    tint: tint,
                    lineWidth: 5.5
                )

                VStack(spacing: 1) {
                    Text(compactWindowTitle(presentation.title))
                        .font(.system(size: 12, weight: .semibold))
                    Text("\(Int(presentation.remainingPercent.rounded()))%")
                        .font(.system(size: 10, weight: .semibold))
                }
                .foregroundStyle(AppTheme.primaryText)
                .monospacedDigit()
            }
            .frame(width: 54, height: 54)

            Text(presentation.usedText)
                .font(.system(size: 10, weight: .regular))
                .foregroundStyle(AppTheme.secondaryText)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .frame(width: 58)
    }

    private func compactWindowTitle(_ title: String) -> String {
        title == "1 week" ? "1w" : title
    }
}

private struct AccountSwitchButton: View {
    let switching: Bool
    var isEnabled = true
    let labelStyle: AccountCardSwitchButtonLabelStyle
    let onSwitch: () -> Void

    var body: some View {
        Button {
            onSwitch()
        } label: {
            if switching {
                ProgressView()
                    .controlSize(.small)
            } else {
                switch labelStyle {
                case .iconOnly:
                    Image(systemName: "arrow.left.arrow.right.circle.fill")
                        .font(.system(size: 14, weight: .semibold))
                case .expanded:
                    Label("Switch", systemImage: "arrow.left.arrow.right")
                        .lineLimit(1)
                }
            }
        }
        .codexManagerActionButtonStyle(
            prominent: false,
            tint: AppTheme.accent,
            density: .compact,
            iOSStyle: .liquidGlass
        )
        .disabled(switching || !isEnabled)
        .accessibilityLabel(Text(L10n.tr("accounts.card.switch_to_this")))
    }
}

private struct AccountRefreshButton: View {
    let refreshing: Bool
    let isEnabled: Bool
    var labelStyle: AccountCardSwitchButtonLabelStyle = .iconOnly
    let onRefresh: () -> Void

    var body: some View {
        Button {
            onRefresh()
        } label: {
            if refreshing {
                ProgressView()
                    .controlSize(.small)
            } else {
                switch labelStyle {
                case .iconOnly:
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 14, weight: .semibold))
                case .expanded:
                    Label(L10n.tr("common.refresh"), systemImage: "arrow.clockwise")
                        .lineLimit(1)
                }
            }
        }
        .codexManagerActionButtonStyle(
            prominent: false,
            tint: AppTheme.accent,
            density: .compact,
            iOSStyle: .liquidGlass
        )
        .foregroundStyle(AppTheme.accent)
        .disabled(!isEnabled)
        .accessibilityLabel(Text(L10n.tr("common.refresh_usage")))
    }
}
