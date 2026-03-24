import Foundation
import os
#if canImport(WidgetKit)
import WidgetKit
#endif

actor AccountsWidgetSnapshotWriter {
    private let logger = Logger(subsystem: "CodexManager", category: "AccountsWidgetSnapshotWriter")
    private let snapshotBuilder: AccountsWidgetSnapshotBuilder
    private let snapshotStore: AccountsWidgetSnapshotStore
    private let localeProvider: @Sendable () async -> Locale
    private let timeZoneProvider: @Sendable () async -> TimeZone

    init(
        snapshotBuilder: AccountsWidgetSnapshotBuilder = AccountsWidgetSnapshotBuilder(),
        snapshotStore: AccountsWidgetSnapshotStore = AccountsWidgetSnapshotStore(),
        localeProvider: @escaping @Sendable () async -> Locale,
        timeZoneProvider: @escaping @Sendable () async -> TimeZone = { .autoupdatingCurrent }
    ) {
        self.snapshotBuilder = snapshotBuilder
        self.snapshotStore = snapshotStore
        self.localeProvider = localeProvider
        self.timeZoneProvider = timeZoneProvider
    }

    func write(accounts: [AccountSummary]) async {
        let locale = await localeProvider()
        let timeZone = await timeZoneProvider()
        let snapshot = snapshotBuilder.build(
            accounts: accounts,
            locale: locale,
            timeZone: timeZone
        )

        do {
            try snapshotStore.save(snapshot)
        } catch {
            logger.error("Widget snapshot save failed: \(error.localizedDescription, privacy: .public)")
            return
        }

        #if canImport(WidgetKit)
        await MainActor.run {
            WidgetCenter.shared.reloadTimelines(ofKind: AccountsWidgetConfiguration.kind)
        }
        #endif
    }
}
