import SwiftUI

extension ProxyPageModel {
    var preferredPortBinding: Binding<String> {
        Binding(
            get: { self.preferredPortText },
            set: { self.updatePreferredPortText($0) }
        )
    }

    var autoStartProxyBinding: Binding<Bool> {
        Binding(
            get: { self.autoStartProxy },
            set: { value in
                self.dispatchAutoStartProxyUpdate(value)
            }
        )
    }

    func dispatchRefreshAPIKey() {
        Task { await refreshAPIKey() }
    }

    func dispatchAutoStartProxyUpdate(_ value: Bool) {
        Task { await setAutoStartProxy(value) }
    }
}
