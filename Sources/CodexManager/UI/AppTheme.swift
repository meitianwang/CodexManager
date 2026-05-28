import SwiftUI
#if canImport(AppKit)
import AppKit
#endif

enum AppTheme {
    static let accent = Color(red: 0.35, green: 0.20, blue: 0.84)
    static let accentStrong = Color(red: 0.27, green: 0.13, blue: 0.73)
    static let destructive = Color(red: 0.91, green: 0.17, blue: 0.18)
    static let success = Color(red: 0.10, green: 0.61, blue: 0.28)
    static let info = Color(red: 0.18, green: 0.42, blue: 0.84)
    static let warning = Color(red: 0.87, green: 0.38, blue: 0.13)

    static let primaryText = Color(red: 0.07, green: 0.07, blue: 0.09)
    static let secondaryText = Color(red: 0.34, green: 0.35, blue: 0.39)

    static var accentSoft: Color {
        accent.opacity(0.13)
    }

    static var accentSubtle: Color {
        accent.opacity(0.06)
    }

    static var currentBadgeBackground: Color {
        Color(red: 0.86, green: 0.96, blue: 0.88)
    }

    static var currentBadgeForeground: Color {
        Color(red: 0.07, green: 0.48, blue: 0.20)
    }

    static func planForeground(for planLabel: String) -> Color {
        switch planLabel.uppercased() {
        case "PLUS":
            return Color(red: 0.15, green: 0.38, blue: 0.84)
        case "TEAM":
            return warning
        case "FREE":
            return Color(red: 0.38, green: 0.40, blue: 0.45)
        default:
            return accent
        }
    }

    static func planBackground(for planLabel: String) -> Color {
        switch planLabel.uppercased() {
        case "PLUS":
            return Color(red: 0.89, green: 0.93, blue: 1.00)
        case "TEAM":
            return Color(red: 1.00, green: 0.92, blue: 0.84)
        case "FREE":
            return Color(red: 0.93, green: 0.94, blue: 0.96)
        default:
            return Color(red: 0.91, green: 0.88, blue: 1.00)
        }
    }

    #if canImport(AppKit)
    static var windowBackground: Color {
        Color(red: 0.98, green: 0.98, blue: 0.99)
    }

    static var sidebarBackground: Color {
        Color(red: 0.97, green: 0.96, blue: 0.99)
    }

    static var panelBackground: Color {
        Color.white.opacity(0.97)
    }

    static var elevatedBackground: Color {
        Color.white.opacity(0.94)
    }

    static var controlBackground: Color {
        Color.white.opacity(0.96)
    }

    static var mutedBackground: Color {
        Color(red: 0.95, green: 0.95, blue: 0.97)
    }

    static var separator: Color {
        Color.black.opacity(0.11)
    }
    #else
    static var windowBackground: Color {
        Color(uiColor: .systemBackground)
    }

    static var sidebarBackground: Color {
        Color(uiColor: .secondarySystemBackground)
    }

    static var panelBackground: Color {
        Color(uiColor: .systemBackground)
    }

    static var elevatedBackground: Color {
        Color(uiColor: .secondarySystemBackground)
    }

    static var controlBackground: Color {
        Color(uiColor: .secondarySystemBackground)
    }

    static var mutedBackground: Color {
        Color(uiColor: .tertiarySystemBackground)
    }

    static var separator: Color {
        Color.secondary.opacity(0.2)
    }
    #endif

    static var progressTrack: Color {
        Color.black.opacity(0.08)
    }
}
