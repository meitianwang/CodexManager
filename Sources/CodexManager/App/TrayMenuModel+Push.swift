import Foundation
import Combine
import os.log

private let pushLogger = Logger(subsystem: "com.nik.mei.codexmanager", category: "TrayMenuModel.Push")

@MainActor
extension TrayMenuModel {
    func configureAccountsSnapshotPushHandlingIfNeeded() {
        guard accountsSnapshotPushCancellable == nil else { return }

        accountsSnapshotPushCancellable = NotificationCenter.default
            .publisher(for: .codexManagerAccountsSnapshotPushDidArrive)
            .sink { [weak self] _ in
                guard let self else { return }
                Task { @MainActor in
                    await self.handleAccountsSnapshotPushNotification()
                }
            }

        Task {
            do {
                try await cloudSyncService?.ensurePushSubscriptionIfNeeded()
            } catch {
                pushLogger.error("Failed to ensure accounts push subscription: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    func configureCurrentSelectionPushHandlingIfNeeded() {
        guard backgroundRefreshPolicy.applyRemoteSelectionSwitchEffects else { return }
        guard currentSelectionPushCancellable == nil else { return }

        currentSelectionPushCancellable = NotificationCenter.default
            .publisher(for: .codexManagerCurrentAccountSelectionPushDidArrive)
            .sink { [weak self] _ in
                guard let self else { return }
                Task { @MainActor in
                    await self.handleCurrentSelectionPushNotification()
                }
            }

        Task {
            do {
                try await currentAccountSelectionSyncService?.ensurePushSubscriptionIfNeeded()
            } catch {
                pushLogger.error("Failed to ensure selection push subscription: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    func reconcileCurrentAccountSelection(
        failOnError: Bool
    ) async throws -> CurrentAccountSelectionPullResult {
        guard let currentAccountSelectionSyncService else { return .noChange }

        do {
            let pullResult = try await currentAccountSelectionSyncService.pullRemoteSelectionIfNeeded()

            if pullResult.changedCurrentAccount,
               backgroundRefreshPolicy.applyRemoteSelectionSwitchEffects,
               let remoteAccountKey = pullResult.accountKey {
                try await applyRemoteSelectionSwitchEffects(accountKey: remoteAccountKey)
                return pullResult
            }

            if !pullResult.didUpdateSelection {
                try await currentAccountSelectionSyncService.pushLocalSelectionIfNeeded()
            }

            return pullResult
        } catch {
            if failOnError {
                throw error
            }
            return .noChange
        }
    }

    func handleAccountsSnapshotPushNotification() async {
        do {
            let pullResult = try await pullCloudAccountsForPushNotification()
            guard pullResult.didUpdateAccounts else { return }
            accounts = try await accountsCoordinator.listAccounts()
            notice = nil
        } catch {
            notice = error.localizedDescription
        }
    }

    func applyRemoteSelectionSwitchEffects(accountKey: String) async throws {
        let accounts = try await accountsCoordinator.listAccounts()
        let matchingAccount = accounts.first(where: { $0.accountKey == accountKey })
            ?? accounts.first(where: \.isCurrent)
        guard let matchingAccount else { return }
        _ = try await accountsCoordinator.switchAccountAndApplySettings(id: matchingAccount.id)
    }

    func handleCurrentSelectionPushNotification() async {
        do {
            let result = try await pullCurrentSelectionForPushNotification()
            guard result.didUpdateSelection else { return }
            accounts = try await accountsCoordinator.listAccounts()
            notice = nil
        } catch {
            notice = error.localizedDescription
        }
    }

    func pullCloudAccountsForPushNotification() async throws -> AccountsCloudSyncPullResult {
        var latest = try await pullCloudAccountsIfNeeded(failOnError: false)
        if latest.didUpdateAccounts {
            return latest
        }

        for attempt in 0..<12 {
            if Task.isCancelled {
                break
            }
            let delay: Duration = attempt < 8 ? .milliseconds(250) : .seconds(1)
            try? await Task.sleep(for: delay)
            latest = try await pullCloudAccountsIfNeeded(failOnError: false)
            if latest.didUpdateAccounts {
                break
            }
        }

        return latest
    }

    func pullCurrentSelectionForPushNotification() async throws -> CurrentAccountSelectionPullResult {
        guard let currentAccountSelectionSyncService else {
            return .noChange
        }

        var result = try await currentAccountSelectionSyncService.pullRemoteSelectionIfNeeded()
        if !result.didUpdateSelection {
            for attempt in 0..<12 {
                if Task.isCancelled {
                    break
                }
                let delay: Duration = attempt < 8 ? .milliseconds(250) : .seconds(1)
                try? await Task.sleep(for: delay)
                result = try await currentAccountSelectionSyncService.pullRemoteSelectionIfNeeded()
                if result.didUpdateSelection {
                    break
                }
            }
        }

        if result.changedCurrentAccount,
           backgroundRefreshPolicy.applyRemoteSelectionSwitchEffects,
           let remoteAccountKey = result.accountKey {
            try await applyRemoteSelectionSwitchEffects(accountKey: remoteAccountKey)
        }

        return result
    }
}
