import Foundation
import os.log

private let upstreamLogger = Logger(subsystem: "com.nik.mei.codexmanager", category: "CodexUpstream")

struct CodexUpstreamRequest: Sendable {
    var url: URL
    var body: Data
    var accessToken: String
    var accountID: String
    var isStream: Bool
}

enum CodexUpstreamError: Error, LocalizedError {
    case httpError(statusCode: Int, body: Data)
    case networkError(Error)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .httpError(let statusCode, _):
            return "HTTP \(statusCode): \(Self.categoryForStatus(statusCode))"
        case .networkError(let error):
            return error.localizedDescription
        case .invalidResponse:
            return "Invalid upstream response"
        }
    }

    /// Sanitized description safe for logs and client responses — never includes raw body.
    private static func categoryForStatus(_ code: Int) -> String {
        switch code {
        case 401: return "authentication_error"
        case 403: return "permission_denied"
        case 429: return "rate_limited"
        case 400: return "bad_request"
        case 404: return "not_found"
        case 500...599: return "upstream_server_error"
        default: return "upstream_error"
        }
    }

    var statusCode: Int {
        switch self {
        case .httpError(let code, _): return code
        case .networkError: return 502
        case .invalidResponse: return 502
        }
    }

    var isRetryable: Bool {
        switch self {
        case .httpError(let code, let body):
            if code == 429 { return true }
            if code == 403 { return isModelRestricted(body) || isAuthFailure(body) }
            if code >= 500 { return true }
            return false
        case .networkError:
            return true
        case .invalidResponse:
            return false
        }
    }

    private func isModelRestricted(_ body: Data) -> Bool {
        let text = String(data: body.prefix(1024), encoding: .utf8) ?? ""
        return text.contains("model_restricted") || text.contains("model_not_found")
    }

    private func isAuthFailure(_ body: Data) -> Bool {
        let text = String(data: body.prefix(1024), encoding: .utf8) ?? ""
        return text.contains("authentication") || text.contains("unauthorized") || text.contains("invalid_api_key")
    }
}

enum CodexUpstreamResult: Sendable {
    case complete(statusCode: Int, data: Data, headers: [String: String])
    case stream(statusCode: Int, lines: AsyncStream<Data>, headers: [String: String])
}

/// Codex upstream identity constants. Update when upstream CLI version changes.
enum CodexUpstreamIdentity {
    static let userAgent = "codex_cli_rs/0.116.0 (Mac OS 26.0.1; arm64) Apple_Terminal/464"
    static let originator = "codex_cli_rs"
}

final class CodexUpstreamClient: Sendable {
    private static let maxResponseBytes = 50 * 1024 * 1024 // 50MB

    private let session: URLSession

    init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 300
        config.timeoutIntervalForResource = 600
        self.session = URLSession(configuration: config)
    }

    func execute(request: CodexUpstreamRequest) async throws -> CodexUpstreamResult {
        var urlRequest = URLRequest(url: request.url)
        urlRequest.httpMethod = "POST"
        urlRequest.httpBody = request.body
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.setValue("Bearer \(request.accessToken)", forHTTPHeaderField: "Authorization")
        urlRequest.setValue(CodexUpstreamIdentity.userAgent, forHTTPHeaderField: "User-Agent")
        urlRequest.setValue(CodexUpstreamIdentity.originator, forHTTPHeaderField: "Originator")
        urlRequest.setValue(request.accountID, forHTTPHeaderField: "Chatgpt-Account-Id")

        if request.isStream {
            urlRequest.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        } else {
            urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")
        }
        urlRequest.setValue("Keep-Alive", forHTTPHeaderField: "Connection")

        upstreamLogger.debug("Upstream request: \(request.url.absoluteString, privacy: .public)")

        let (asyncBytes, response): (URLSession.AsyncBytes, URLResponse)
        do {
            (asyncBytes, response) = try await session.bytes(for: urlRequest)
        } catch {
            throw CodexUpstreamError.networkError(error)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw CodexUpstreamError.invalidResponse
        }

        let responseHeaders = Self.extractHeaders(httpResponse)

        if httpResponse.statusCode < 200 || httpResponse.statusCode >= 300 {
            var errorData = Data()
            for try await byte in asyncBytes {
                errorData.append(byte)
                if errorData.count > 8192 { break }
            }
            throw CodexUpstreamError.httpError(statusCode: httpResponse.statusCode, body: errorData)
        }

        if request.isStream {
            let stream = AsyncStream<Data> { continuation in
                let task = Task {
                    for try await line in asyncBytes.lines {
                        // Re-add newline — SSE framing depends on it
                        var lineData = Data(line.utf8)
                        lineData.append(UInt8(ascii: "\n"))
                        continuation.yield(lineData)
                    }
                    continuation.finish()
                }
                continuation.onTermination = { _ in
                    task.cancel()
                }
            }
            return .stream(
                statusCode: httpResponse.statusCode,
                lines: stream,
                headers: responseHeaders
            )
        } else {
            // Collect full response using URLSession.data for efficiency
            var collected = Data()
            collected.reserveCapacity(4096)
            for try await byte in asyncBytes {
                collected.append(byte)
                if collected.count > Self.maxResponseBytes {
                    throw CodexUpstreamError.httpError(
                        statusCode: 413,
                        body: Data()
                    )
                }
            }
            return .complete(
                statusCode: httpResponse.statusCode,
                data: collected,
                headers: responseHeaders
            )
        }
    }

    private static func extractHeaders(_ response: HTTPURLResponse) -> [String: String] {
        var headers: [String: String] = [:]
        for (key, value) in response.allHeaderFields {
            headers[String(describing: key)] = String(describing: value)
        }
        return headers
    }
}
