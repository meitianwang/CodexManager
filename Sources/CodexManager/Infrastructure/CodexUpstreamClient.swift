import Foundation
import os.log

private let upstreamLogger = Logger(subsystem: "com.nik.mei.codexmanager", category: "CodexUpstream")

struct CodexUpstreamRequest: Sendable {
    var method: String
    var url: URL
    var body: Data
    var headers: [String: String]
    var accessToken: String
    var accountID: String
    var isStream: Bool
}

protocol CodexUpstreamClientProtocol: Sendable {
    func execute(request: CodexUpstreamRequest) async throws -> CodexUpstreamResult
}

enum CodexUpstreamError: Error, LocalizedError {
    case httpError(statusCode: Int, body: Data)
    case eventError(statusCode: Int, message: String, body: Data)
    case networkError(Error)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .httpError(let statusCode, _):
            return "HTTP \(statusCode): \(Self.categoryForStatus(statusCode))"
        case .eventError(let statusCode, let message, _):
            return "SSE \(statusCode): \(message)"
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
        case .eventError(let code, _, _): return code
        case .networkError: return 502
        case .invalidResponse: return 502
        }
    }

    var isRetryable: Bool {
        switch self {
        case .httpError(let code, let body):
            if code == 401 { return true }
            if code == 429 { return true }
            if code == 403 { return Self.isModelRestricted(body) || Self.isAuthFailure(body) }
            if code >= 500 { return true }
            return false
        case .eventError(let code, _, let body):
            if code == 401 { return true }
            if code == 429 { return true }
            if code == 403 { return Self.isModelRestricted(body) || Self.isAuthFailure(body) }
            if code >= 500 { return true }
            return false
        case .networkError:
            return true
        case .invalidResponse:
            return false
        }
    }

    var isAuthenticationFailure: Bool {
        switch self {
        case .httpError(let code, let body), .eventError(let code, _, let body):
            return code == 401 || Self.isAuthFailure(body)
        case .networkError, .invalidResponse:
            return false
        }
    }

    var isRateLimited: Bool {
        switch self {
        case .httpError(let code, _), .eventError(let code, _, _):
            return code == 429
        case .networkError, .invalidResponse:
            return false
        }
    }

    var isModelRestriction: Bool {
        switch self {
        case .httpError(let code, let body), .eventError(let code, _, let body):
            return code == 403 && Self.isModelRestricted(body)
        case .networkError, .invalidResponse:
            return false
        }
    }

    private static func isModelRestricted(_ body: Data) -> Bool {
        let text = String(data: body.prefix(1024), encoding: .utf8) ?? ""
        return text.contains("model_restricted") || text.contains("model_not_found")
    }

    private static func isAuthFailure(_ body: Data) -> Bool {
        let text = String(data: body.prefix(1024), encoding: .utf8) ?? ""
        return text.contains("authentication") || text.contains("unauthorized") || text.contains("invalid_api_key")
    }
}

struct CodexUpstreamSSEError: Sendable {
    var statusCode: Int
    var message: String
    var body: Data
}

enum CodexUpstreamSSEInspector {
    private static let dataPrefix = Data("data: ".utf8)

    static func event(fromSSELine line: Data) -> (type: String, object: [String: Any], rawText: String)? {
        guard line.starts(with: dataPrefix) else { return nil }
        let payload = Data(line.dropFirst(dataPrefix.count))
        guard let text = String(data: payload, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
            !text.isEmpty,
            let object = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
            let type = object["type"] as? String else {
            return nil
        }
        return (type, object, text)
    }

    static func error(fromSSELine line: Data) -> CodexUpstreamSSEError? {
        guard let event = event(fromSSELine: line) else { return nil }
        let errorObject: [String: Any]?
        switch event.type {
        case "response.error":
            errorObject = event.object["error"] as? [String: Any]
        case "response.failed":
            if let response = event.object["response"] as? [String: Any] {
                errorObject = response["error"] as? [String: Any]
            } else {
                errorObject = event.object["error"] as? [String: Any]
            }
        default:
            return nil
        }

        let message = normalizedErrorMessage(errorObject: errorObject, fallback: event.type)
        let statusCode = statusCode(errorObject: errorObject, message: message)
        return CodexUpstreamSSEError(
            statusCode: statusCode,
            message: message,
            body: Data(event.rawText.utf8)
        )
    }

    static func isReadyForClient(fromSSELine line: Data) -> Bool {
        guard let event = event(fromSSELine: line) else { return false }
        switch event.type {
        case "response.output_text.delta",
             "response.reasoning_summary_text.delta",
             "response.output_item.added",
             "response.function_call_arguments.delta",
             "response.completed":
            return true
        default:
            return false
        }
    }

    private static func normalizedErrorMessage(errorObject: [String: Any]?, fallback: String) -> String {
        let candidates = [
            errorObject?["message"] as? String,
            errorObject?["code"] as? String,
            errorObject?["type"] as? String
        ]
        for candidate in candidates {
            if let trimmed = candidate?.trimmingCharacters(in: .whitespacesAndNewlines),
               !trimmed.isEmpty {
                return trimmed
            }
        }
        return fallback
    }

    private static func statusCode(errorObject: [String: Any]?, message: String) -> Int {
        if let status = errorObject?["status"] as? Int {
            return status
        }
        if let statusCode = errorObject?["status_code"] as? Int {
            return statusCode
        }

        let text = [
            message,
            errorObject?["code"] as? String,
            errorObject?["type"] as? String
        ]
            .compactMap { $0 }
            .joined(separator: " ")
            .lowercased()

        if text.contains("quota")
            || text.contains("rate")
            || text.contains("limit")
            || text.contains("too_many_requests") {
            return 429
        }
        if text.contains("auth")
            || text.contains("unauthorized")
            || text.contains("invalid_api_key") {
            return 401
        }
        if text.contains("model_restricted")
            || text.contains("model_not_found")
            || text.contains("permission")
            || text.contains("forbidden") {
            return 403
        }
        return 502
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

final class CodexUpstreamClient: CodexUpstreamClientProtocol, Sendable {
    private static let maxResponseBytes = 50 * 1024 * 1024 // 50MB
    private static let blockedForwardedHeaders: Set<String> = [
        "authorization",
        "x-api-key",
        "host",
        "content-length",
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
        "accept-encoding",
        "chatgpt-account-id"
    ]

    private let session: URLSession

    init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 300
        config.timeoutIntervalForResource = 600
        self.session = URLSession(configuration: config)
    }

    func execute(request: CodexUpstreamRequest) async throws -> CodexUpstreamResult {
        var urlRequest = URLRequest(url: request.url)
        urlRequest.httpMethod = request.method
        if !request.body.isEmpty {
            urlRequest.httpBody = request.body
        }

        for (name, value) in request.headers {
            if Self.isForwardableHeader(name) {
                urlRequest.setValue(value, forHTTPHeaderField: name)
            }
        }

        if !request.body.isEmpty && urlRequest.value(forHTTPHeaderField: "Content-Type") == nil {
            urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        urlRequest.setValue("Bearer \(request.accessToken)", forHTTPHeaderField: "Authorization")
        urlRequest.setValue(request.accountID, forHTTPHeaderField: "ChatGPT-Account-ID")

        if urlRequest.value(forHTTPHeaderField: "User-Agent") == nil {
            urlRequest.setValue(CodexUpstreamIdentity.userAgent, forHTTPHeaderField: "User-Agent")
        }
        if urlRequest.value(forHTTPHeaderField: "originator") == nil {
            urlRequest.setValue(CodexUpstreamIdentity.originator, forHTTPHeaderField: "originator")
        }
        if urlRequest.value(forHTTPHeaderField: "version") == nil {
            urlRequest.setValue(AppVersion.current, forHTTPHeaderField: "version")
        }

        if request.isStream {
            urlRequest.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        } else {
            urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")
        }

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

    private static func isForwardableHeader(_ name: String) -> Bool {
        !blockedForwardedHeaders.contains(name.lowercased())
    }
}
