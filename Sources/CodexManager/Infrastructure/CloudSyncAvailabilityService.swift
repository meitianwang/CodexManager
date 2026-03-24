import Foundation
import CloudKit
#if os(macOS)
import Security
#endif

struct CloudSyncAvailabilityService {
    private let containerIdentifier = "iCloud.com.nik.mei.codexmanager"

    func isICloudAvailable() async -> Bool {
        guard Self.hasCloudKitEntitlement() else {
            return false
        }

        let container = CKContainer(identifier: containerIdentifier)
        return await withCheckedContinuation { continuation in
            container.accountStatus { status, _ in
                continuation.resume(returning: status == .available)
            }
        }
    }

    private static func hasCloudKitEntitlement() -> Bool {
        #if os(macOS)
        guard let task = SecTaskCreateFromSelf(nil),
              let value = SecTaskCopyValueForEntitlement(
                task,
                "com.apple.developer.icloud-services" as CFString,
                nil
              ) else {
            return false
        }

        if let services = value as? [String] {
            return services.contains("CloudKit") || services.contains("CloudKit-Anonymous")
        }
        if let services = value as? NSArray {
            return services.contains { element in
                guard let service = element as? String else { return false }
                return service == "CloudKit" || service == "CloudKit-Anonymous"
            }
        }
        return false
        #else
        return true
        #endif
    }
}
