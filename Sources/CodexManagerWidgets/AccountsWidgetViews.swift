import SwiftUI
import WidgetKit
import Foundation
import os

private enum AccountsWidgetStyle {
    static func backgroundGradient(for colorScheme: ColorScheme) -> LinearGradient {
        _ = colorScheme
        return LinearGradient(
            colors: [
                Color(red: 0.42, green: 0.27, blue: 0.82),
                Color(red: 0.25, green: 0.18, blue: 0.58),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    static func primaryTextColor(for colorScheme: ColorScheme) -> Color {
        _ = colorScheme
        return .white
    }

    static func secondaryTextColor(for colorScheme: ColorScheme) -> Color {
        _ = colorScheme
        return Color.white.opacity(0.70)
    }

    static func dividerColor(for colorScheme: ColorScheme) -> Color {
        switch colorScheme {
        case .dark:
            Color.white.opacity(0.18)
        default:
            Color.white.opacity(0.28)
        }
    }

    static func planForeground(for planLabel: String) -> Color {
        switch planLabel.uppercased() {
        case "PLUS":
            return Color(red: 0.18, green: 0.39, blue: 0.92)
        case "TEAM":
            return Color(red: 0.75, green: 0.39, blue: 0.18)
        case "FREE":
            return Color(red: 0.39, green: 0.42, blue: 0.48)
        default:
            return Color(red: 0.35, green: 0.20, blue: 0.84)
        }
    }

    static func planBackground(for planLabel: String) -> Color {
        switch planLabel.uppercased() {
        case "PLUS":
            return Color(red: 0.89, green: 0.93, blue: 1.00)
        case "TEAM":
            return Color(red: 1.00, green: 0.91, blue: 0.82)
        case "FREE":
            return Color(red: 0.93, green: 0.94, blue: 0.96)
        default:
            return Color(red: 0.90, green: 0.87, blue: 1.00)
        }
    }

    static func layout(for family: WidgetFamily, size: CGSize) -> AccountsWidgetLayout {
        let width = size.width
        let scale = layoutScale(for: family, size: size)
        func scaled(_ value: CGFloat) -> CGFloat {
            (value * scale).rounded(.toNearestOrEven)
        }

        let horizontalPadding: CGFloat
        let verticalPadding: CGFloat
        let compactSpacing: CGFloat
        let compactSectionSpacing: CGFloat
        let compactUsageSpacing: CGFloat
        let largeSectionSpacing: CGFloat
        let rowSpacing: CGFloat
        let compactRingSize: CGFloat
        let compactRingLineWidth: CGFloat
        let metricColumnWidth: CGFloat
        let rowMetricColumnWidth: CGFloat
        let chipFontSize: CGFloat
        let compactTitleFontSize: CGFloat
        let compactSubtitleFontSize: CGFloat
        let compactRingValueFontSize: CGFloat
        let compactRingTitleFontSize: CGFloat
        let metricValueFontSize: CGFloat
        let metricLabelFontSize: CGFloat
        let metricIconSize: CGFloat
        let metricResetFontSize: CGFloat
        let metricResetIconSize: CGFloat
        let rowMetricValueFontSize: CGFloat
        let rowMetricLabelFontSize: CGFloat
        let rowMetricIconSize: CGFloat
        let rowResetFontSize: CGFloat
        let rowResetIconSize: CGFloat
        let currentHeaderTitleFontSize: CGFloat
        let currentHeaderDetailFontSize: CGFloat

        switch family {
        case .systemSmall:
            horizontalPadding = 0
            verticalPadding = 0
            let contentWidth = max(width - (horizontalPadding * 2), 1)
            compactSpacing = scaled(14)
            compactSectionSpacing = scaled(8)
            compactUsageSpacing = scaled(8)
            largeSectionSpacing = scaled(14)
            rowSpacing = scaled(10)
            compactRingSize = min(max(contentWidth * 0.40, scaled(64)), scaled(82))
            compactRingLineWidth = scaled(7)
            metricColumnWidth = contentWidth
            rowMetricColumnWidth = contentWidth
            chipFontSize = scaled(11)
            compactTitleFontSize = scaled(15)
            compactSubtitleFontSize = scaled(11)
            compactRingValueFontSize = scaled(18)
            compactRingTitleFontSize = scaled(11)
            metricValueFontSize = scaled(14)
            metricLabelFontSize = scaled(13)
            metricIconSize = scaled(11)
            metricResetFontSize = scaled(11)
            metricResetIconSize = scaled(10)
            rowMetricValueFontSize = scaled(13)
            rowMetricLabelFontSize = scaled(12)
            rowMetricIconSize = scaled(10)
            rowResetFontSize = scaled(10)
            rowResetIconSize = scaled(9)
            currentHeaderTitleFontSize = scaled(17)
            currentHeaderDetailFontSize = scaled(12)
        case .systemMedium:
            horizontalPadding = 0
            verticalPadding = 0
            let contentWidth = max(width - (horizontalPadding * 2), 1)
            compactSpacing = scaled(14)
            compactSectionSpacing = scaled(8)
            compactUsageSpacing = scaled(10)
            largeSectionSpacing = scaled(14)
            rowSpacing = scaled(10)
            compactRingSize = min(max(contentWidth * 0.24, scaled(62)), scaled(80))
            compactRingLineWidth = scaled(7)
            metricColumnWidth = contentWidth
            rowMetricColumnWidth = contentWidth
            chipFontSize = scaled(11)
            compactTitleFontSize = scaled(15)
            compactSubtitleFontSize = scaled(11)
            compactRingValueFontSize = scaled(18)
            compactRingTitleFontSize = scaled(11)
            metricValueFontSize = scaled(14)
            metricLabelFontSize = scaled(13)
            metricIconSize = scaled(11)
            metricResetFontSize = scaled(11)
            metricResetIconSize = scaled(10)
            rowMetricValueFontSize = scaled(13)
            rowMetricLabelFontSize = scaled(12)
            rowMetricIconSize = scaled(10)
            rowResetFontSize = scaled(10)
            rowResetIconSize = scaled(9)
            currentHeaderTitleFontSize = scaled(18)
            currentHeaderDetailFontSize = scaled(12)
        default:
            horizontalPadding = 0
            verticalPadding = 0
            let contentWidth = max(width - (horizontalPadding * 2), 1)
            compactSpacing = scaled(14)
            compactSectionSpacing = scaled(12)
            compactUsageSpacing = scaled(16)
            largeSectionSpacing = scaled(16)
            rowSpacing = scaled(14)
            compactRingSize = min(max(contentWidth * 0.17, scaled(52)), scaled(68))
            compactRingLineWidth = scaled(7)
            metricColumnWidth = contentWidth
            rowMetricColumnWidth = contentWidth
            chipFontSize = scaled(12)
            compactTitleFontSize = scaled(18)
            compactSubtitleFontSize = scaled(13)
            compactRingValueFontSize = scaled(16)
            compactRingTitleFontSize = scaled(11)
            metricValueFontSize = scaled(15)
            metricLabelFontSize = scaled(14)
            metricIconSize = scaled(12)
            metricResetFontSize = scaled(11)
            metricResetIconSize = scaled(10)
            rowMetricValueFontSize = scaled(14)
            rowMetricLabelFontSize = scaled(13)
            rowMetricIconSize = scaled(11)
            rowResetFontSize = scaled(11)
            rowResetIconSize = scaled(10)
            currentHeaderTitleFontSize = scaled(19)
            currentHeaderDetailFontSize = scaled(13)
        }

        return AccountsWidgetLayout(
            family: family,
            horizontalPadding: horizontalPadding,
            verticalPadding: verticalPadding,
            compactSpacing: compactSpacing,
            compactSectionSpacing: compactSectionSpacing,
            compactUsageSpacing: compactUsageSpacing,
            largeSectionSpacing: largeSectionSpacing,
            rowSpacing: rowSpacing,
            compactRingSize: compactRingSize,
            compactRingLineWidth: compactRingLineWidth,
            metricColumnWidth: metricColumnWidth,
            rowMetricColumnWidth: rowMetricColumnWidth,
            chipFontSize: chipFontSize,
            compactTitleFontSize: compactTitleFontSize,
            compactSubtitleFontSize: compactSubtitleFontSize,
            compactRingValueFontSize: compactRingValueFontSize,
            compactRingTitleFontSize: compactRingTitleFontSize,
            metricValueFontSize: metricValueFontSize,
            metricLabelFontSize: metricLabelFontSize,
            metricIconSize: metricIconSize,
            metricResetFontSize: metricResetFontSize,
            metricResetIconSize: metricResetIconSize,
            rowMetricValueFontSize: rowMetricValueFontSize,
            rowMetricLabelFontSize: rowMetricLabelFontSize,
            rowMetricIconSize: rowMetricIconSize,
            rowResetFontSize: rowResetFontSize,
            rowResetIconSize: rowResetIconSize,
            currentHeaderTitleFontSize: currentHeaderTitleFontSize,
            currentHeaderDetailFontSize: currentHeaderDetailFontSize
        )
    }

    private static func layoutScale(for family: WidgetFamily, size: CGSize) -> CGFloat {
        let referenceSize: CGSize

        switch family {
        case .systemSmall:
            referenceSize = CGSize(width: 158, height: 158)
        case .systemMedium:
            referenceSize = CGSize(width: 338, height: 158)
        default:
            referenceSize = CGSize(width: 338, height: 354)
        }

        let widthScale = size.width / max(referenceSize.width, 1)
        let heightScale = size.height / max(referenceSize.height, 1)
        return min(max(min(widthScale, heightScale), 0.72), 1.20)
    }

}

private struct AccountsWidgetLayout {
    let family: WidgetFamily
    let horizontalPadding: CGFloat
    let verticalPadding: CGFloat
    let compactSpacing: CGFloat
    let compactSectionSpacing: CGFloat
    let compactUsageSpacing: CGFloat
    let largeSectionSpacing: CGFloat
    let rowSpacing: CGFloat
    let compactRingSize: CGFloat
    let compactRingLineWidth: CGFloat
    let metricColumnWidth: CGFloat
    let rowMetricColumnWidth: CGFloat
    let chipFontSize: CGFloat
    let compactTitleFontSize: CGFloat
    let compactSubtitleFontSize: CGFloat
    let compactRingValueFontSize: CGFloat
    let compactRingTitleFontSize: CGFloat
    let metricValueFontSize: CGFloat
    let metricLabelFontSize: CGFloat
    let metricIconSize: CGFloat
    let metricResetFontSize: CGFloat
    let metricResetIconSize: CGFloat
    let rowMetricValueFontSize: CGFloat
    let rowMetricLabelFontSize: CGFloat
    let rowMetricIconSize: CGFloat
    let rowResetFontSize: CGFloat
    let rowResetIconSize: CGFloat
    let currentHeaderTitleFontSize: CGFloat
    let currentHeaderDetailFontSize: CGFloat
}

struct AccountsWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var colorScheme
    let entry: AccountsWidgetEntry

    var body: some View {
        GeometryReader { proxy in
            let layout = AccountsWidgetStyle.layout(for: family, size: proxy.size)

            Group {
                switch family {
                case .systemSmall:
                    AccountsWidgetSmallView(card: entry.snapshot.currentCard, layout: layout)
                case .systemMedium:
                    AccountsWidgetMediumView(
                        current: entry.snapshot.currentCard,
                        secondary: entry.snapshot.secondaryCard,
                        layout: layout
                    )
                default:
                    AccountsWidgetLargeView(
                        current: entry.snapshot.currentCard,
                        rows: entry.snapshot.rows,
                        layout: layout
                    )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .containerBackground(for: .widget) {
            AccountsWidgetStyle.backgroundGradient(for: colorScheme)
        }
    }
}

private struct AccountsWidgetSmallView: View {
    let card: AccountsWidgetCardSnapshot?
    let layout: AccountsWidgetLayout

    var body: some View {
        Group {
            if let card {
                AccountsWidgetCompactCardContent(card: card, layout: layout)
            } else {
                AccountsWidgetEmptyState()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .padding(.horizontal, layout.horizontalPadding)
        .padding(.vertical, layout.verticalPadding)
    }
}

private struct AccountsWidgetMediumView: View {
    @Environment(\.widgetContentMargins) private var widgetContentMargins
    let current: AccountsWidgetCardSnapshot?
    let secondary: AccountsWidgetCardSnapshot?
    let layout: AccountsWidgetLayout

    var body: some View {
        let dividerSpacing = max(widgetContentMargins.leading, widgetContentMargins.trailing)

        return HStack(spacing: dividerSpacing) {
            Group {
                if let current {
                    AccountsWidgetCompactCardContent(card: current, layout: layout)
                } else {
                    AccountsWidgetEmptyState()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            AccountsWidgetMediumDivider()

            Group {
                if let secondary {
                    AccountsWidgetCompactCardContent(card: secondary, layout: layout)
                } else {
                    AccountsWidgetEmptyState()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .padding(.horizontal, layout.horizontalPadding)
        .padding(.vertical, layout.verticalPadding)
    }
}

private struct AccountsWidgetLargeView: View {
    @Environment(\.colorScheme) private var colorScheme
    let current: AccountsWidgetCardSnapshot?
    let rows: [AccountsWidgetRowSnapshot]
    let layout: AccountsWidgetLayout

    var body: some View {
        GeometryReader { proxy in
            let groups = largeGroups

            if groups.isEmpty {
                AccountsWidgetEmptyState()
            } else {
                let size = proxy.size
                let groupUnitHeight = size.height / CGFloat(max(groups.count, 1))
                let tagFontSize = min(max(groupUnitHeight * 0.13, 9), 12)
                let tagHorizontalPadding = min(max(size.width * 0.009, 5), 8)
                let tagVerticalPadding = min(max(groupUnitHeight * 0.045, 2), 3)
                let metricSpacing = min(max(size.width * 0.028, 10), 18)
                let detailFontSize = min(max(groupUnitHeight * 0.12, 10), 13)
                let progressHeight = min(max(groupUnitHeight * 0.10, 7), 10)

                VStack(alignment: .leading, spacing: min(max(size.height * 0.018, 4), 8)) {
                    AccountsWidgetLargeHeader(detailFontSize: detailFontSize)

                    ForEach(groups) { group in
                        AccountsWidgetLargeGroupView(
                            group: group,
                            tagFontSize: tagFontSize,
                            tagHorizontalPadding: tagHorizontalPadding,
                            tagVerticalPadding: tagVerticalPadding,
                            metricSpacing: metricSpacing,
                            detailFontSize: detailFontSize,
                            progressHeight: progressHeight
                        )
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
        .padding(.horizontal, layout.horizontalPadding)
        .padding(.vertical, layout.verticalPadding)
    }

    private var largeGroups: [AccountsWidgetLargeGroup] {
        var groups: [AccountsWidgetLargeGroup] = []

        if let current {
            groups.append(
                AccountsWidgetLargeGroup(
                    id: current.id,
                    planLabel: current.planLabel,
                    workspaceLabel: current.workspaceLabel,
                    accountLabel: current.accountLabel,
                    fiveHour: current.fiveHour,
                    oneWeek: current.oneWeek
                )
            )
        }

        groups.append(
            contentsOf: rows.map {
                AccountsWidgetLargeGroup(
                    id: $0.id,
                    planLabel: $0.planLabel,
                    workspaceLabel: $0.workspaceLabel,
                    accountLabel: $0.accountLabel,
                    fiveHour: $0.fiveHour,
                    oneWeek: $0.oneWeek
                )
            }
        )

        return Array(groups.prefix(5))
    }
}

private struct AccountsWidgetCompactCardContent: View {
    @Environment(\.colorScheme) private var colorScheme
    let card: AccountsWidgetCardSnapshot
    let layout: AccountsWidgetLayout

    private var workspaceLabel: String? {
        guard let workspaceLabel = card.workspaceLabel, !workspaceLabel.isEmpty else {
            return nil
        }
        return workspaceLabel
    }

    private var displayAccountName: String {
        card.accountLabel
    }

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let groupSpacing = min(max(size.height * 0.055, 7), 12)
            let tagFontSize = min(max(size.height * 0.07, 9), 12)
            let tagHorizontalPadding = min(max(size.width * 0.035, 5), 10)
            let tagVerticalPadding = min(max(size.height * 0.018, 2), 4)
            let ringSpacing = min(max(size.width * 0.06, 10), 18)
            let ringAreaHeight = size.height * 0.43
            let ringSize = min((size.width - ringSpacing) / 2, ringAreaHeight)
            let ringLineWidth = min(max(ringSize * 0.12, 6), 9)
            let ringValueFontSize = min(max(ringSize * 0.18, 11), 16)
            let ringSubtitleFontSize = min(max(ringSize * 0.20, 12), 17)

            VStack(alignment: .leading, spacing: groupSpacing) {
                HStack(alignment: .top, spacing: 8) {
                    AccountsWidgetAvatar(text: displayAccountName)

                    VStack(alignment: .leading, spacing: 3) {
                        Text(displayAccountName)
                            .font(.system(size: layout.compactTitleFontSize, weight: .bold, design: .rounded))
                            .foregroundStyle(AccountsWidgetStyle.primaryTextColor(for: colorScheme))
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)

                        if let workspaceLabel {
                            Text(workspaceLabel)
                                .font(.system(size: layout.compactSubtitleFontSize, weight: .medium, design: .rounded))
                                .foregroundStyle(AccountsWidgetStyle.secondaryTextColor(for: colorScheme))
                                .lineLimit(1)
                        }
                    }

                    Spacer(minLength: 0)

                    AccountsWidgetTag(
                        text: card.planLabel,
                        backgroundColor: AccountsWidgetStyle.planBackground(for: card.planLabel),
                        foregroundColor: AccountsWidgetStyle.planForeground(for: card.planLabel),
                        font: Font.system(size: tagFontSize, weight: .bold, design: .rounded),
                        horizontalPadding: tagHorizontalPadding,
                        verticalPadding: tagVerticalPadding
                    )
                }

                HStack(spacing: ringSpacing) {
                    AccountsWidgetCompactRing(
                        valueText: card.fiveHour.title,
                        progress: card.fiveHour.progressFraction,
                        tint: Color(red: 0.36, green: 0.80, blue: 0.45),
                        size: ringSize,
                        lineWidth: ringLineWidth,
                        valueFontSize: ringValueFontSize,
                        subtitleFontSize: ringSubtitleFontSize
                    )
                    .frame(maxWidth: .infinity, alignment: .leading)

                    AccountsWidgetCompactRing(
                        valueText: compactOneWeekTitle(card.oneWeek.title),
                        progress: card.oneWeek.progressFraction,
                        tint: Color(red: 0.26, green: 0.60, blue: 0.95),
                        size: ringSize,
                        lineWidth: ringLineWidth,
                        valueFontSize: ringValueFontSize,
                        subtitleFontSize: ringSubtitleFontSize
                    )
                    .frame(maxWidth: .infinity, alignment: .trailing)
                }
                .frame(height: ringAreaHeight, alignment: .center)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(maxHeight: .infinity, alignment: .center)
        }
    }

    private func compactOneWeekTitle(_ title: String) -> String {
        title == "1 week" ? "1w" : title
    }
}

private struct AccountsWidgetAvatar: View {
    let text: String

    var body: some View {
        Text(String(text.prefix(1)).uppercased())
            .font(.system(size: 13, weight: .bold, design: .rounded))
            .foregroundStyle(.white)
            .frame(width: 28, height: 28)
            .background(Color.white.opacity(0.18), in: Circle())
    }
}

private struct AccountsWidgetTag: View {
    let text: String
    let backgroundColor: Color
    let foregroundColor: Color
    let font: Font
    let horizontalPadding: CGFloat
    let verticalPadding: CGFloat

    var body: some View {
        Text(text)
            .font(font)
            .foregroundStyle(foregroundColor)
            .lineLimit(1)
            .minimumScaleFactor(0.72)
            .truncationMode(.tail)
            .padding(.horizontal, horizontalPadding)
            .padding(.vertical, verticalPadding)
            .background(backgroundColor, in: Capsule())
    }
}

private struct AccountsWidgetMediumDivider: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Rectangle()
            .fill(
                LinearGradient(
                    colors: [
                        Color.white.opacity(0),
                        AccountsWidgetStyle.dividerColor(for: colorScheme).opacity(0.4),
                        AccountsWidgetStyle.dividerColor(for: colorScheme),
                        AccountsWidgetStyle.dividerColor(for: colorScheme).opacity(0.4),
                        Color.white.opacity(0),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .frame(width: 1)
            .padding(.vertical, 2)
    }
}

private struct AccountsWidgetCompactRing: View {
    @Environment(\.colorScheme) private var colorScheme
    let valueText: String
    let progress: Double
    let tint: Color
    let size: CGFloat
    let lineWidth: CGFloat
    let valueFontSize: CGFloat
    let subtitleFontSize: CGFloat

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.white.opacity(0.18), lineWidth: lineWidth)

            Circle()
                .trim(from: 0, to: max(0, min(1, progress)))
                .stroke(
                    tint,
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round)
                )
                .rotationEffect(.degrees(-90))

            VStack(spacing: 1) {
                Text(valueText)
                    .font(.system(size: valueFontSize, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(AccountsWidgetStyle.primaryTextColor(for: colorScheme))
                Text("\(Int((max(0, min(1, progress)) * 100).rounded()))%")
                    .font(.system(size: subtitleFontSize, weight: .semibold, design: .rounded))
                    .foregroundStyle(AccountsWidgetStyle.secondaryTextColor(for: colorScheme))
            }
        }
        .frame(width: size, height: size)
    }
}

private struct AccountsWidgetLargeGroup: Identifiable {
    let id: String
    let planLabel: String
    let workspaceLabel: String?
    let accountLabel: String
    let fiveHour: AccountsWidgetWindowSnapshot
    let oneWeek: AccountsWidgetWindowSnapshot
}

private struct AccountsWidgetLargeGroupView: View {
    let group: AccountsWidgetLargeGroup
    let tagFontSize: CGFloat
    let tagHorizontalPadding: CGFloat
    let tagVerticalPadding: CGFloat
    let metricSpacing: CGFloat
    let detailFontSize: CGFloat
    let progressHeight: CGFloat

    var body: some View {
        HStack(alignment: .center, spacing: metricSpacing) {
            HStack(spacing: 7) {
                AccountsWidgetAvatar(text: group.accountLabel)

                VStack(alignment: .leading, spacing: 2) {
                    Text(group.accountLabel)
                        .font(.system(size: detailFontSize, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .lineLimit(1)

                    if let workspaceLabel = group.workspaceLabel {
                        Text(workspaceLabel)
                            .font(.system(size: max(detailFontSize - 2, 9), weight: .medium, design: .rounded))
                            .foregroundStyle(Color.white.opacity(0.68))
                            .lineLimit(1)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: 4) {
                AccountsWidgetTag(
                    text: group.planLabel,
                    backgroundColor: AccountsWidgetStyle.planBackground(for: group.planLabel),
                    foregroundColor: AccountsWidgetStyle.planForeground(for: group.planLabel),
                    font: .system(size: tagFontSize, weight: .bold, design: .rounded),
                    horizontalPadding: tagHorizontalPadding,
                    verticalPadding: tagVerticalPadding
                )
            }
            .frame(width: 78, alignment: .leading)

            AccountsWidgetLargeMetric(
                window: group.fiveHour,
                tint: Color(red: 0.36, green: 0.80, blue: 0.45),
                detailFontSize: detailFontSize,
                progressHeight: progressHeight
            )

            AccountsWidgetLargeMetric(
                window: group.oneWeek,
                tint: Color(red: 0.26, green: 0.60, blue: 0.95),
                detailFontSize: detailFontSize,
                progressHeight: progressHeight
            )

            Text(resetDisplayText(group.fiveHour.resetText))
                .font(.system(size: max(detailFontSize - 1, 9), weight: .medium, design: .rounded))
                .foregroundStyle(Color.white.opacity(0.78))
                .lineLimit(1)
                .frame(width: 92, alignment: .leading)

            Text(group.fiveHour.remainingText)
                .font(.system(size: detailFontSize, weight: .semibold, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(1)
                .frame(width: 72, alignment: .trailing)
        }
        .padding(.vertical, 1)
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private func resetDisplayText(_ text: String) -> String {
        text.replacingOccurrences(of: "Reset at: ", with: "")
    }
}

private struct AccountsWidgetLargeHeader: View {
    let detailFontSize: CGFloat

    var body: some View {
        HStack(spacing: 12) {
            Text("Account")
                .frame(maxWidth: .infinity, alignment: .leading)
            Text("Plan")
                .frame(width: 78, alignment: .leading)
            Text("5h")
                .frame(maxWidth: .infinity, alignment: .leading)
            Text("1w")
                .frame(maxWidth: .infinity, alignment: .leading)
            Text("Reset")
                .frame(width: 92, alignment: .leading)
            Text("Remaining")
                .frame(width: 72, alignment: .trailing)
        }
        .font(.system(size: max(detailFontSize - 2, 9), weight: .bold, design: .rounded))
        .foregroundStyle(Color.white.opacity(0.78))
    }
}

private struct AccountsWidgetLargeMetric: View {
    @Environment(\.colorScheme) private var colorScheme
    let window: AccountsWidgetWindowSnapshot
    let tint: Color
    let detailFontSize: CGFloat
    let progressHeight: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Text(window.title)
                    .font(.system(size: detailFontSize, weight: .semibold, design: .rounded))
                    .foregroundStyle(AccountsWidgetStyle.secondaryTextColor(for: colorScheme))

                AccountsWidgetProgressBar(progress: window.progressFraction, tint: tint, height: progressHeight)
            }

            Text(window.remainingText)
                .font(.system(size: max(detailFontSize - 1, 9), weight: .semibold, design: .rounded))
                .foregroundStyle(AccountsWidgetStyle.secondaryTextColor(for: colorScheme))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct AccountsWidgetProgressBar: View {
    let progress: Double
    let tint: Color
    let height: CGFloat

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.white.opacity(0.12))
                Capsule()
                    .fill(tint)
                    .frame(width: proxy.size.width * max(0, min(1, progress)))
            }
        }
        .frame(height: height)
    }
}

private struct AccountsWidgetEmptyState: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("No Accounts")
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .foregroundStyle(AccountsWidgetStyle.primaryTextColor(for: colorScheme))
            Text("Open CodexManager to sync account usage into the widget.")
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(AccountsWidgetStyle.secondaryTextColor(for: colorScheme))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
