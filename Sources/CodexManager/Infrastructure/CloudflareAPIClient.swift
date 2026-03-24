import Foundation

#if os(macOS)
struct CloudflareNamedTunnelClient {
    private static let apiBaseURL = "https://api.cloudflare.com/client/v4"

    let session: URLSession

    func createNamedTunnel(input: NamedCloudflaredTunnelInput) async throws -> NamedTunnelCreateResult {
        let url = try cloudflareURL(path: "/accounts/\(input.accountID)/cfd_tunnel")
        let body = [
            "name": "codexmanager-\(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased())",
            "config_src": "cloudflare",
        ]
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(input.apiToken)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])

        return try await performRequest(
            request: request,
            failureKey: "error.cloudflared.named_create_failed"
        )
    }

    func configureNamedTunnel(
        input: NamedCloudflaredTunnelInput,
        tunnelID: String,
        hostname: String,
        serviceURL: String
    ) async throws {
        let url = try cloudflareURL(path: "/accounts/\(input.accountID)/cfd_tunnel/\(tunnelID)/configurations")
        let body: [String: Any] = [
            "config": [
                "ingress": [
                    [
                        "hostname": hostname,
                        "service": serviceURL,
                    ],
                    [
                        "service": "http_status:404",
                    ],
                ],
            ],
        ]
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(input.apiToken)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])

        let _: EmptyCloudflareResult = try await performRequest(
            request: request,
            failureKey: "error.cloudflared.named_config_failed"
        )
    }

    func upsertCNAMERecord(
        apiToken: String,
        zoneID: String,
        hostname: String,
        target: String
    ) async throws {
        let listURL = try cloudflareURL(
            path: "/zones/\(zoneID)/dns_records",
            queryItems: [
                URLQueryItem(name: "type", value: "CNAME"),
                URLQueryItem(name: "name", value: hostname),
            ]
        )

        var listRequest = URLRequest(url: listURL)
        listRequest.httpMethod = "GET"
        listRequest.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")

        let existing: [CloudflareDNSRecord] = try await performRequest(
            request: listRequest,
            failureKey: "error.cloudflared.named_dns_query_failed"
        )

        let payload: [String: Any] = [
            "type": "CNAME",
            "name": hostname,
            "content": target,
            "proxied": true,
        ]

        if let first = existing.first {
            let url = try cloudflareURL(path: "/zones/\(zoneID)/dns_records/\(first.id)")
            var request = URLRequest(url: url)
            request.httpMethod = "PUT"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
            request.httpBody = try JSONSerialization.data(withJSONObject: payload, options: [])

            let _: EmptyCloudflareResult = try await performRequest(
                request: request,
                failureKey: "error.cloudflared.named_dns_update_failed"
            )
        } else {
            let url = try cloudflareURL(path: "/zones/\(zoneID)/dns_records")
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")
            request.httpBody = try JSONSerialization.data(withJSONObject: payload, options: [])

            let _: EmptyCloudflareResult = try await performRequest(
                request: request,
                failureKey: "error.cloudflared.named_dns_create_failed"
            )
        }
    }

    func deleteNamedTunnel(apiToken: String, accountID: String, tunnelID: String) async throws {
        let url = try cloudflareURL(path: "/accounts/\(accountID)/cfd_tunnel/\(tunnelID)")
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(apiToken)", forHTTPHeaderField: "Authorization")

        let _: EmptyCloudflareResult = try await performRequest(
            request: request,
            failureKey: "error.cloudflared.named_cleanup_failed"
        )
    }

    private func cloudflareURL(path: String, queryItems: [URLQueryItem] = []) throws -> URL {
        guard var components = URLComponents(string: Self.apiBaseURL + path) else {
            throw AppError.network(L10n.tr("error.cloudflared.api_url_invalid"))
        }
        if !queryItems.isEmpty {
            components.queryItems = queryItems
        }
        guard let url = components.url else {
            throw AppError.network(L10n.tr("error.cloudflared.api_url_invalid"))
        }
        return url
    }

    private func performRequest<T: Decodable>(
        request: URLRequest,
        failureKey: String
    ) async throws -> T {
        let (data, _) = try await session.data(for: request)

        let envelope: CloudflareResponseEnvelope<T>
        do {
            envelope = try JSONDecoder().decode(CloudflareResponseEnvelope<T>.self, from: data)
        } catch {
            throw AppError.network(
                L10n.tr("error.cloudflared.api_response_decode_failed_format", L10n.tr(failureKey))
            )
        }

        if envelope.success {
            if let result = envelope.result {
                return result
            }
            if T.self == EmptyCloudflareResult.self {
                return EmptyCloudflareResult() as! T
            }
            throw AppError.network(
                L10n.tr("error.cloudflared.api_response_empty_format", L10n.tr(failureKey))
            )
        }

        let detail = envelope.errors
            .map { error -> String in
                if let code = error.code {
                    return "[\(code)] \(error.message)"
                }
                return error.message
            }
            .joined(separator: " | ")

        let resolvedDetail = detail.isEmpty ? L10n.tr("error.cloudflared.api_unknown_error") : detail
        throw AppError.network(
            L10n.tr("error.cloudflared.api_request_failed_format", L10n.tr(failureKey), resolvedDetail)
        )
    }
}

struct CloudflareResponseEnvelope<T: Decodable>: Decodable {
    var success: Bool
    var errors: [CloudflareError]
    var result: T?
}

struct CloudflareError: Decodable {
    var code: Int?
    var message: String
}

struct CloudflareDNSRecord: Decodable {
    var id: String
}

struct NamedTunnelCreateResult: Decodable {
    var id: String
    var token: String
}

struct EmptyCloudflareResult: Codable {}
#endif
