import Foundation

// MARK: - Chat Completions ↔ Codex Responses Translation

enum ChatToCodexTranslator {
    /// 50 MB — matches CodexUpstreamClient.maxResponseBytes.
    private static let maxAccumulatedTextBytes = 50 * 1024 * 1024

    // MARK: Request: OpenAI Chat → Codex Responses

    static func translateRequest(model: String, messages: [[String: Any]], originalJSON: [String: Any]) -> [String: Any] {
        // reasoning_effort → reasoning.effort (default "medium")
        let effort = (originalJSON["reasoning_effort"] as? String) ?? "medium"

        var codexBody: [String: Any] = [
            "model": model,
            "stream": true,
            "store": false,
            "parallel_tool_calls": true,
            "include": ["reasoning.encrypted_content"],
            "reasoning": ["effort": effort, "summary": "auto"]
        ]

        var instructions = ""
        var input: [[String: Any]] = []

        for message in messages {
            guard let role = message["role"] as? String else { continue }
            let content = extractContent(from: message)

            if role == "system" || role == "developer" {
                if !instructions.isEmpty { instructions += "\n" }
                instructions += content
                continue
            }

            let contentType = role == "assistant" ? "output_text" : "input_text"
            input.append([
                "type": "message",
                "role": role,
                "content": [["type": contentType, "text": content]]
            ])
        }

        codexBody["instructions"] = instructions
        codexBody["input"] = input

        // Forward tools if present
        if let tools = originalJSON["tools"] as? [[String: Any]] {
            codexBody["tools"] = tools.compactMap { tool -> [String: Any]? in
                guard let function = tool["function"] as? [String: Any],
                      let name = function["name"] as? String else { return nil }
                var codexTool: [String: Any] = [
                    "type": "function",
                    "name": name,
                    "strict": false
                ]
                if let desc = function["description"] as? String {
                    codexTool["description"] = desc
                }
                if var params = function["parameters"] as? [String: Any] {
                    params.removeValue(forKey: "$schema")
                    codexTool["parameters"] = params
                }
                return codexTool
            }
        }

        // Note: Codex does not support temperature, top_p, max_output_tokens — omit them.

        return codexBody
    }

    private static func extractContent(from message: [String: Any]) -> String {
        if let text = message["content"] as? String {
            return text
        }
        if let parts = message["content"] as? [[String: Any]] {
            return parts.compactMap { part -> String? in
                if part["type"] as? String == "text" {
                    return part["text"] as? String
                }
                return nil
            }.joined(separator: "\n")
        }
        return ""
    }

    // MARK: Response: Codex SSE → Chat Completion Chunks (streaming)

    static func translateStreamingResponse(model: String, lines: AsyncStream<Data>) -> AsyncStream<Data> {
        let requestID = "chatcmpl-\(UUID().uuidString.prefix(12))"
        let dataPrefix = Data("data: ".utf8)

        return AsyncStream { continuation in
            let task = Task {
                var sentRole = false

                for await line in lines {
                    guard line.starts(with: dataPrefix) else {
                        // Forward empty lines for SSE framing
                        if line == Data("\n".utf8) || line == Data("\r\n".utf8) {
                            continuation.yield(line)
                        }
                        continue
                    }

                    let payload = Data(line.dropFirst(dataPrefix.count))
                    guard let text = String(data: payload, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
                          !text.isEmpty,
                          let event = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
                          let eventType = event["type"] as? String else {
                        continue
                    }

                    switch eventType {
                    case "response.output_text.delta":
                        if !sentRole {
                            let roleChunk = makeStreamChunk(id: requestID, model: model, delta: ["role": "assistant"])
                            continuation.yield(formatSSELine(roleChunk))
                            sentRole = true
                        }
                        if let delta = event["delta"] as? String {
                            let chunk = makeStreamChunk(id: requestID, model: model, delta: ["content": delta])
                            continuation.yield(formatSSELine(chunk))
                        }

                    case "response.completed":
                        let finalChunk = makeStreamChunk(
                            id: requestID,
                            model: model,
                            delta: [:],
                            finishReason: "stop"
                        )
                        continuation.yield(formatSSELine(finalChunk))
                        continuation.yield(Data("data: [DONE]\n\n".utf8))

                    default:
                        break
                    }
                }

                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: Response: Codex SSE → Chat Completion (non-streaming)

    static func collectAndTranslateResponse(model: String, lines: AsyncStream<Data>) async -> HTTPResponse {
        let dataPrefix = Data("data: ".utf8)
        var fullText = ""
        var usage: [String: Any]?
        var truncated = false

        for await line in lines {
            guard line.starts(with: dataPrefix) else { continue }
            let payload = Data(line.dropFirst(dataPrefix.count))
            guard let text = String(data: payload, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !text.isEmpty,
                  let event = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
                  let eventType = event["type"] as? String else {
                continue
            }

            switch eventType {
            case "response.output_text.delta":
                if !truncated, let delta = event["delta"] as? String {
                    fullText += delta
                    if fullText.utf8.count > maxAccumulatedTextBytes {
                        truncated = true
                    }
                }
            case "response.completed":
                if let response = event["response"] as? [String: Any],
                   let u = response["usage"] as? [String: Any] {
                    usage = u
                }
            default:
                break
            }
        }

        let requestID = "chatcmpl-\(UUID().uuidString.prefix(12))"
        var result: [String: Any] = [
            "id": requestID,
            "object": "chat.completion",
            "model": model,
            "choices": [[
                "index": 0,
                "message": [
                    "role": "assistant",
                    "content": fullText
                ],
                "finish_reason": "stop"
            ]]
        ]
        if let usage {
            result["usage"] = usage
        }

        let data = (try? JSONSerialization.data(withJSONObject: result)) ?? Data("{}".utf8)
        return HTTPResponse(
            statusCode: 200,
            headers: ["Content-Type": "application/json; charset=utf-8"],
            body: data
        )
    }

    // MARK: Response: Codex complete → Chat Completion

    static func translateCompleteResponse(model: String, data: Data) -> HTTPResponse {
        // Parse the SSE data to extract completed response
        let lines = data.split(separator: UInt8(ascii: "\n"))
        let dataPrefix = Data("data: ".utf8)
        var fullText = ""
        var usage: [String: Any]?
        var truncated = false

        for line in lines {
            let lineData = Data(line)
            guard lineData.starts(with: dataPrefix) else { continue }
            let payload = Data(lineData.dropFirst(dataPrefix.count))
            guard let text = String(data: payload, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !text.isEmpty,
                  let event = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
                  let eventType = event["type"] as? String else {
                continue
            }

            if !truncated, eventType == "response.output_text.delta",
               let delta = event["delta"] as? String {
                fullText += delta
                if fullText.utf8.count > maxAccumulatedTextBytes {
                    truncated = true
                }
            }
            if eventType == "response.completed",
               let response = event["response"] as? [String: Any],
               let u = response["usage"] as? [String: Any] {
                usage = u
            }
        }

        let requestID = "chatcmpl-\(UUID().uuidString.prefix(12))"
        var result: [String: Any] = [
            "id": requestID,
            "object": "chat.completion",
            "model": model,
            "choices": [[
                "index": 0,
                "message": ["role": "assistant", "content": fullText],
                "finish_reason": "stop"
            ]]
        ]
        if let usage { result["usage"] = usage }

        let responseData = (try? JSONSerialization.data(withJSONObject: result)) ?? Data("{}".utf8)
        return HTTPResponse(
            statusCode: 200,
            headers: ["Content-Type": "application/json; charset=utf-8"],
            body: responseData
        )
    }

    // MARK: - SSE Helpers

    private static func makeStreamChunk(
        id: String,
        model: String,
        delta: [String: Any],
        finishReason: String? = nil
    ) -> [String: Any] {
        var choice: [String: Any] = [
            "index": 0,
            "delta": delta
        ]
        if let finishReason {
            choice["finish_reason"] = finishReason
        } else {
            choice["finish_reason"] = NSNull()
        }

        return [
            "id": id,
            "object": "chat.completion.chunk",
            "model": model,
            "choices": [choice]
        ]
    }

    private static func formatSSELine(_ object: [String: Any]) -> Data {
        guard let json = try? JSONSerialization.data(withJSONObject: object) else {
            return Data()
        }
        var line = Data("data: ".utf8)
        line.append(json)
        line.append(Data("\n\n".utf8))
        return line
    }
}
