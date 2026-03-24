enum AccountCardInteractionPlatform {
    case macOS
    case iOS
}

struct AccountCardInteractionPresentation: Equatable {
    let canHoverSwitchOverlay: Bool
    let canRevealCollapsedSwitchOverlay: Bool
    let isCollapsedSwitchOverlayVisible: Bool

    init(
        isCollapsed: Bool,
        isCurrent: Bool,
        switching: Bool,
        isHoveringCollapsedSwitch: Bool,
        isCollapsedSwitchOverlayPresented: Bool,
        platform: AccountCardInteractionPlatform
    ) {
        canHoverSwitchOverlay = platform == .macOS && isCollapsed && !isCurrent
        canRevealCollapsedSwitchOverlay = isCollapsed && !isCurrent && !switching

        guard isCollapsed && !isCurrent else {
            isCollapsedSwitchOverlayVisible = false
            return
        }

        switch platform {
        case .iOS:
            isCollapsedSwitchOverlayVisible = isCollapsedSwitchOverlayPresented || switching
        case .macOS:
            isCollapsedSwitchOverlayVisible = isHoveringCollapsedSwitch || switching
        }
    }
}
