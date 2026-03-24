import SwiftUI

enum AccountsAnimationRules {
    static let collapseToggle = Animation.easeInOut(duration: 0.2)
    static let contentReorder = Animation.spring(response: 0.36, dampingFraction: 0.84)
    static let cardHoverOverlay = Animation.easeInOut(duration: 0.16)
    static let cardEntranceBase = Animation.spring(response: 0.5, dampingFraction: 0.86)
    static let cardEntranceMaximumDelay = 0.28
    static let cardEntranceStepDelay = 0.035
    static let collapsedOverlayMinimumPressDuration = 0.35

    static func cardEntrance(index: Int) -> Animation {
        cardEntranceBase.delay(
            min(cardEntranceMaximumDelay, Double(index) * cardEntranceStepDelay)
        )
    }
}
