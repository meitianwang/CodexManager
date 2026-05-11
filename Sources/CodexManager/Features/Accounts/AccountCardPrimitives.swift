import SwiftUI

private enum AccountCardOverlayLayout {
    static let actionReservationWidth: CGFloat = 144
}

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
            toneColor = .gray
        case .orange, .pink, .indigo, .teal:
            toneColor = AppTheme.accent
        }
        surfaceTint = isCurrent ? AppTheme.accentSubtle : nil
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
    let isCollapsed: Bool
    let isCurrent: Bool
    let palette: AccountCardPalette
    let onDelete: () -> Void

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    AccountTagView(
                        text: presentation.planLabel,
                        backgroundColor: palette.toneColor.opacity(0.11),
                        foregroundColor: palette.toneColor
                    )
                    if let teamNameTag = presentation.teamNameTag {
                        AccountTagView(
                            text: teamNameTag,
                            backgroundColor: AppTheme.mutedBackground,
                            foregroundColor: palette.toneColor,
                            allowsCompression: true
                        )
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    Spacer(minLength: 0)
                }
            }

            if !isCollapsed {
                Button(role: .destructive, action: onDelete) {
                    Image(systemName: "trash")
                }
                .codexManagerActionButtonStyle(
                    prominent: false,
                    tint: AppTheme.destructive,
                    density: .compact,
                    iOSStyle: .liquidGlass
                )
                .foregroundStyle(AppTheme.destructive)
            }
        }
    }
}

struct AccountCardExpandedUsageSection: View {
    let presentation: AccountCardPresentation

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            AccountWindowSection(presentation: presentation.fiveHourWindow, tint: AppTheme.accent)
            AccountWindowSection(presentation: presentation.oneWeekWindow, tint: AppTheme.accent)

            HStack(spacing: 8) {
                Text(L10n.tr("accounts.card.credits_format", presentation.creditsText))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.trailing, AccountCardOverlayLayout.actionReservationWidth)
                Spacer(minLength: 0)
            }
        }
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
                    tint: AppTheme.accent
                ),
                AccountCompactRingDescriptor(
                    id: "one-week",
                    valueText: compactPercentText(presentation.compactUsage.oneWeekRemainingPercent),
                    subtitleText: "1w",
                    progress: compactProgress(presentation.compactUsage.oneWeekRemainingPercent),
                    tint: AppTheme.accent
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

struct AccountCardBottomOverlay: View {
    let isCollapsed: Bool
    let isCurrent: Bool
    let switching: Bool
    let refreshing: Bool
    let isRefreshEnabled: Bool
    let usageError: String?
    let palette: AccountCardPalette
    let onSwitch: () -> Void
    let onRefresh: () -> Void

    var body: some View {
        if !isCollapsed {
            HStack(alignment: .bottom, spacing: 10) {
                if let usageError, !usageError.isEmpty {
                    AccountUsageErrorOverlay(text: usageError)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Spacer(minLength: 0)
                }

                AccountTrailingActionCluster(
                    isCurrent: isCurrent,
                    switching: switching,
                    refreshing: refreshing,
                    isRefreshEnabled: isRefreshEnabled,
                    palette: palette,
                    onSwitch: onSwitch,
                    onRefresh: onRefresh
                )
            }
            .padding(8)
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

private struct AccountWindowSection: View {
    let presentation: AccountWindowPresentation
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(presentation.title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.primary)
                Spacer(minLength: 0)
                Text(presentation.remainingText)
                    .font(.caption.weight(.semibold))
                    .monospacedDigit()
                Text(presentation.usedText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }

            LiquidProgressBar(progress: presentation.remainingPercent / 100, tint: tint)

            HStack(spacing: 4) {
                Image(systemName: "clock")
                    .font(.system(size: 10, weight: .medium))
                Text(presentation.resetText)
                    .font(.caption2)
            }
            .foregroundStyle(.secondary)
        }
    }
}

private struct AccountSwitchButton: View {
    let switching: Bool
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
                    Label(L10n.tr("accounts.card.switch_to_this"), systemImage: "arrow.left.arrow.right.circle.fill")
                        .lineLimit(1)
                }
            }
        }
        .codexManagerActionButtonStyle(
            prominent: true,
            tint: AppTheme.accent,
            density: .compact,
            iOSStyle: .liquidGlass
        )
        .disabled(switching)
        .accessibilityLabel(Text(L10n.tr("accounts.card.switch_to_this")))
    }
}

private struct AccountRefreshButton: View {
    let refreshing: Bool
    let isEnabled: Bool
    let onRefresh: () -> Void

    var body: some View {
        Button {
            onRefresh()
        } label: {
            if refreshing {
                ProgressView()
                    .controlSize(.small)
            } else {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 14, weight: .semibold))
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

private struct AccountTrailingActionCluster: View {
    let isCurrent: Bool
    let switching: Bool
    let refreshing: Bool
    let isRefreshEnabled: Bool
    let palette: AccountCardPalette
    let onSwitch: () -> Void
    let onRefresh: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            if isCurrent {
                AccountTagView(
                    text: L10n.tr("accounts.card.current"),
                    backgroundColor: AppTheme.accentSoft,
                    foregroundColor: palette.toneColor
                )
            } else {
                AccountSwitchButton(
                    switching: switching,
                    labelStyle: .iconOnly,
                    onSwitch: onSwitch
                )
            }

            AccountRefreshButton(
                refreshing: refreshing,
                isEnabled: isRefreshEnabled,
                onRefresh: onRefresh
            )
        }
    }
}

private struct AccountUsageErrorOverlay: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption2.weight(.medium))
            .foregroundStyle(AppTheme.destructive)
            .multilineTextAlignment(.leading)
            .lineLimit(3)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(AppTheme.destructive.opacity(0.06), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(AppTheme.destructive.opacity(0.18), lineWidth: 1)
            }
    }
}
