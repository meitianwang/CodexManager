import Foundation
import Network

enum ProxyHTTPResponse {
    case complete(HTTPResponse)
    case streaming(statusCode: Int, headers: [String: String], body: AsyncStream<Data>)
}

final class ProxyHTTPServer: @unchecked Sendable {
    typealias RequestHandler = @Sendable (HTTPRequest) async -> ProxyHTTPResponse

    private static let maxInboundRequestBytes = 8 * 1024 * 1024

    private let listener: NWListener
    private let queue: DispatchQueue
    private let handler: RequestHandler
    private let connectionLock = NSLock()
    private var activeConnections: [NWConnection] = []

    init(port: UInt16, loopbackOnly: Bool = true, handler: @escaping RequestHandler) throws {
        guard let nwPort = NWEndpoint.Port(rawValue: port) else {
            throw AppError.invalidData(L10n.tr("error.proxy_runtime.invalid_port_format", String(port)))
        }
        let parameters = NWParameters.tcp
        if loopbackOnly {
            parameters.requiredLocalEndpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: nwPort)
            self.listener = try NWListener(using: parameters)
        } else {
            self.listener = try NWListener(using: parameters, on: nwPort)
        }
        self.queue = DispatchQueue(label: "com.nik.mei.codexmanager.proxy.server", qos: .userInitiated)
        self.handler = handler
    }

    var actualPort: UInt16? {
        listener.port?.rawValue
    }

    func start() {
        listener.newConnectionHandler = { [weak self] connection in
            self?.handle(connection: connection)
        }
        listener.start(queue: queue)
    }

    func stop() {
        listener.cancel()
        connectionLock.lock()
        let connections = activeConnections
        activeConnections.removeAll()
        connectionLock.unlock()
        for connection in connections {
            connection.cancel()
        }
    }

    private func handle(connection: NWConnection) {
        connectionLock.lock()
        activeConnections.append(connection)
        connectionLock.unlock()
        connection.start(queue: queue)
        readRequest(on: connection, buffer: Data())
    }

    private func readRequest(on connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else {
                connection.cancel()
                return
            }

            if error != nil {
                self.removeConnection(connection)
                connection.cancel()
                return
            }

            var working = buffer
            if let data, !data.isEmpty {
                working.append(data)
            }

            if working.count > Self.maxInboundRequestBytes {
                let response = HTTPResponse.text(statusCode: 413, text: "Request Too Large")
                self.sendComplete(response: response, on: connection)
                return
            }

            if let request = SimpleHTTPServer.parseRequest(from: working) {
                Task {
                    let result = await self.handler(request)
                    switch result {
                    case .complete(let response):
                        self.sendComplete(response: response, on: connection)
                    case .streaming(let statusCode, let headers, let body):
                        await self.sendStreaming(
                            statusCode: statusCode,
                            headers: headers,
                            body: body,
                            on: connection
                        )
                    }
                }
                return
            }

            if isComplete {
                let response = HTTPResponse.text(statusCode: 400, text: "Bad Request")
                self.sendComplete(response: response, on: connection)
                return
            }

            self.readRequest(on: connection, buffer: working)
        }
    }

    private func sendComplete(response: HTTPResponse, on connection: NWConnection) {
        let payload = Self.encodeHTTPResponse(
            statusCode: response.statusCode,
            headers: response.headers,
            body: response.body,
            keepAlive: false
        )
        connection.send(content: payload, completion: .contentProcessed { [weak self] _ in
            connection.cancel()
            self?.removeConnection(connection)
        })
    }

    private func sendStreaming(
        statusCode: Int,
        headers: [String: String],
        body: AsyncStream<Data>,
        on connection: NWConnection
    ) async {
        var allHeaders = headers
        allHeaders["Content-Type"] = "text/event-stream; charset=utf-8"
        allHeaders["Cache-Control"] = "no-cache"
        allHeaders["Connection"] = "keep-alive"
        allHeaders["Transfer-Encoding"] = "chunked"

        let headerPayload = Self.encodeHTTPHeaders(statusCode: statusCode, headers: allHeaders)
        do {
            try await sendAsync(data: headerPayload, on: connection)
        } catch {
            connection.cancel()
            removeConnection(connection)
            return
        }

        let streamTask = Task {
            for await chunk in body {
                let encoded = Self.encodeChunk(chunk)
                try await sendAsync(data: encoded, on: connection)
            }
        }

        do {
            try await streamTask.value
        } catch {
            // Downstream write failed — cancel the upstream stream task
            streamTask.cancel()
        }

        // Send terminal chunk
        let terminal = Data("0\r\n\r\n".utf8)
        try? await sendAsync(data: terminal, on: connection)
        connection.cancel()
        removeConnection(connection)
    }

    private func sendAsync(data: Data, on connection: NWConnection) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            connection.send(content: data, completion: .contentProcessed { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            })
        }
    }

    private func removeConnection(_ connection: NWConnection) {
        connectionLock.lock()
        activeConnections.removeAll { $0 === connection }
        connectionLock.unlock()
    }

    // MARK: - HTTP Encoding

    private static func encodeHTTPResponse(statusCode: Int, headers: [String: String], body: Data, keepAlive: Bool) -> Data {
        var allHeaders = headers
        allHeaders["Content-Length"] = String(body.count)
        if !keepAlive {
            allHeaders["Connection"] = "close"
        }

        var output = encodeHTTPHeaders(statusCode: statusCode, headers: allHeaders)
        output.append(body)
        return output
    }

    private static func encodeHTTPHeaders(statusCode: Int, headers: [String: String]) -> Data {
        let reason = reasonPhrase(for: statusCode)
        var lines: [String] = ["HTTP/1.1 \(statusCode) \(reason)"]
        for (key, value) in headers {
            lines.append("\(key): \(value)")
        }
        lines.append("\r\n")
        return Data(lines.joined(separator: "\r\n").utf8)
    }

    private static func encodeChunk(_ data: Data) -> Data {
        var output = Data("\(String(data.count, radix: 16))\r\n".utf8)
        output.append(data)
        output.append(Data("\r\n".utf8))
        return output
    }

    private static func reasonPhrase(for statusCode: Int) -> String {
        switch statusCode {
        case 200: return "OK"
        case 400: return "Bad Request"
        case 401: return "Unauthorized"
        case 404: return "Not Found"
        case 413: return "Payload Too Large"
        case 429: return "Too Many Requests"
        case 500: return "Internal Server Error"
        case 502: return "Bad Gateway"
        case 503: return "Service Unavailable"
        default: return "HTTP"
        }
    }
}

