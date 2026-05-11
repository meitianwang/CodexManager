import SwiftUI
#if canImport(AppKit)
import AppKit
#endif

enum AppTheme {
    static let accent = Color(red: 0.02, green: 0.48, blue: 0.55)
    static let accentStrong = Color(red: 0.00, green: 0.36, blue: 0.43)
    static let destructive = Color(red: 0.78, green: 0.18, blue: 0.17)
    static let success = Color(red: 0.12, green: 0.52, blue: 0.30)

    static var accentSoft: Color {
        accent.opacity(0.11)
    }

    static var accentSubtle: Color {
        accent.opacity(0.055)
    }

    #if canImport(AppKit)
    static var windowBackground: Color {
        Color(nsColor: .windowBackgroundColor)
    }

    static var sidebarBackground: Color {
        Color(nsColor: .controlBackgroundColor).opacity(0.76)
    }

    static var panelBackground: Color {
        Color(nsColor: .textBackgroundColor).opacity(0.92)
    }

    static var elevatedBackground: Color {
        Color(nsColor: .controlBackgroundColor).opacity(0.9)
    }

    static var controlBackground: Color {
        Color(nsColor: .controlBackgroundColor)
    }

    static var mutedBackground: Color {
        Color(nsColor: .underPageBackgroundColor).opacity(0.64)
    }

    static var separator: Color {
        Color(nsColor: .separatorColor).opacity(0.72)
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
        mutedBackground.opacity(0.9)
    }
}
