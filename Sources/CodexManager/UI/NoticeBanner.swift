import SwiftUI

struct NoticeBanner: View {
    let notice: NoticeMessage?

    var body: some View {
        if let notice {
            HStack(spacing: 8) {
                Image(systemName: iconName(for: notice.style))
                    .foregroundStyle(accentColor(for: notice.style))
                    .font(.system(size: 16, weight: .semibold))
                Text(notice.text)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(AppTheme.primaryText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(AppTheme.secondaryText)
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 10)
            .noticeSurface(style: notice.style)
            .transition(.opacity.combined(with: .move(edge: transitionEdge)))
        }
    }

    private var transitionEdge: Edge {
        #if os(iOS)
        return .bottom
        #else
        return .top
        #endif
    }

    private func accentColor(for style: NoticeStyle) -> Color {
        switch style {
        case .success:
            return AppTheme.success
        case .info:
            return AppTheme.accent
        case .error:
            return AppTheme.destructive
        }
    }

    private func iconName(for style: NoticeStyle) -> String {
        switch style {
        case .success:
            return "checkmark.circle.fill"
        case .info:
            return "info.circle.fill"
        case .error:
            return "exclamationmark.triangle.fill"
        }
    }
}

private extension View {
    @ViewBuilder
    func noticeSurface(style: NoticeStyle) -> some View {
        #if os(iOS)
        self
            .background {
                RoundedRectangle(
                    cornerRadius: LayoutRules.iOSNoticeCornerRadius,
                    style: .continuous
                )
                .fill(.clear)
                .glassEffect(.regular, in: .rect(cornerRadius: LayoutRules.iOSNoticeCornerRadius))
            }
            .overlay(alignment: .leading) {
                RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                    .fill(noticeAccentColor(style))
                    .frame(width: 3)
                    .padding(.vertical, 8)
                    .padding(.leading, 7)
            }
        #else
        self
            .background {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(noticeBackgroundColor(style))
            }
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(noticeAccentColor(style).opacity(0.20), lineWidth: 1)
            }
        #endif
    }

    private func noticeBackgroundColor(_ style: NoticeStyle) -> Color {
        switch style {
        case .success:
            return Color(red: 0.91, green: 0.98, blue: 0.93)
        case .info:
            return Color(red: 0.92, green: 0.96, blue: 1.00)
        case .error:
            return Color(red: 1.00, green: 0.92, blue: 0.92)
        }
    }

    private func noticeAccentColor(_ style: NoticeStyle) -> Color {
        switch style {
        case .success:
            return AppTheme.success
        case .info:
            return AppTheme.accent
        case .error:
            return AppTheme.destructive
        }
    }
}
