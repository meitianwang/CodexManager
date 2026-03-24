import Foundation
import Combine

@MainActor
final class AccountsPageViewStore: ObservableObject {
    @Published private(set) var contentPresentation: AccountsPageContentPresentation
    @Published private(set) var macActionBarPresentation: AccountsActionBarPresentation
    @Published private(set) var leadingToolbarButtons: [AccountsActionButtonDescriptor<AccountsPageActionIntent>]
    @Published private(set) var trailingToolbarButtons: [AccountsActionButtonDescriptor<AccountsPageActionIntent>]

    private let model: AccountsPageModel
    private var cancellables: Set<AnyCancellable> = []

    init(model: AccountsPageModel) {
        self.model = model
        contentPresentation = model.makeContentPresentation()
        macActionBarPresentation = model.makeMacActionBarPresentation()
        leadingToolbarButtons = model.leadingToolbarButtons
        trailingToolbarButtons = model.trailingToolbarButtons
        bind()
    }

    private func bind() {
        model.objectWillChange
        .sink { [weak self] in
            guard let self else { return }
            Task { @MainActor [weak self] in
                self?.refreshPresentations()
            }
        }
        .store(in: &cancellables)
    }

    private func refreshPresentations() {
        let nextContent = model.makeContentPresentation()
        if contentPresentation != nextContent {
            contentPresentation = nextContent
        }

        let nextMacActionBar = model.makeMacActionBarPresentation()
        if macActionBarPresentation != nextMacActionBar {
            macActionBarPresentation = nextMacActionBar
        }

        let nextLeading = model.leadingToolbarButtons
        if leadingToolbarButtons != nextLeading {
            leadingToolbarButtons = nextLeading
        }

        let nextTrailing = model.trailingToolbarButtons
        if trailingToolbarButtons != nextTrailing {
            trailingToolbarButtons = nextTrailing
        }
    }
}
