import Foundation

// MARK: - Anthropic Messages API ↔ Codex Responses API Translation

enum AnthropicToCodexTranslator {

    // MARK: - Request: Anthropic Messages → Codex Responses

    static func translateRequest(_ json: [String: Any]) -> (codexBody: [String: Any], model: String, isStream: Bool)? {
        guard let model = json["model"] as? String, !model.isEmpty else { return nil }

        let isStream = (json["stream"] as? Bool) ?? true

        var input: [[String: Any]] = []

        // System message (Anthropic puts it at top-level)
        if let system = json["system"] as? String, !system.isEmpty {
            input.append([
                "type": "message",
                "role": "developer",
                "content": [["type": "input_text", "text": system]]
            ])
        } else if let systemParts = json["system"] as? [Any] {
            var textParts: [[String: Any]] = []
            for raw in systemParts {
                if let part = raw as? [String: Any],
                   (part["type"] as? String) == "text",
                   let text = part["text"] as? String {
                    textParts.append(["type": "input_text", "text": text])
                }
            }
            if !textParts.isEmpty {
                input.append([
                    "type": "message",
                    "role": "developer",
                    "content": textParts
                ])
            }
        }

        // Convert messages
        if let messages = json["messages"] as? [Any] {
            for raw in messages {
                guard let message = raw as? [String: Any],
                      let role = message["role"] as? String else { continue }

                switch role {
                case "user":
                    if let contentArray = message["content"] as? [Any] {
                        var regularParts: [[String: Any]] = []
                        for rawPart in contentArray {
                            guard let part = rawPart as? [String: Any],
                                  let type = part["type"] as? String else { continue }

                            if type == "tool_result" {
                                if !regularParts.isEmpty {
                                    input.append(["type": "message", "role": "user", "content": regularParts])
                                    regularParts = []
                                }
                                let toolUseID = (part["tool_use_id"] as? String) ?? ""
                                let outputText = stringifyToolResultContent(part["content"])
                                input.append([
                                    "type": "function_call_output",
                                    "call_id": toolUseID,
                                    "output": outputText
                                ])
                            } else {
                                let converted = convertSinglePart(part, role: "user")
                                if !converted.isEmpty { regularParts.append(converted) }
                            }
                        }
                        if !regularParts.isEmpty {
                            input.append(["type": "message", "role": "user", "content": regularParts])
                        }
                    } else {
                        let parts = convertContent(message["content"], role: "user")
                        if !parts.isEmpty {
                            input.append(["type": "message", "role": "user", "content": parts])
                        }
                    }

                case "assistant":
                    var textParts: [[String: Any]] = []
                    if let contentArray = message["content"] as? [Any] {
                        for rawPart in contentArray {
                            guard let part = rawPart as? [String: Any],
                                  let type = part["type"] as? String else { continue }
                            switch type {
                            case "text":
                                if let text = part["text"] as? String, !text.isEmpty {
                                    textParts.append(["type": "output_text", "text": text])
                                }
                            case "tool_use":
                                if !textParts.isEmpty {
                                    input.append(["type": "message", "role": "assistant", "content": textParts])
                                    textParts = []
                                }
                                let arguments = stringifyJSON(part["input"])
                                input.append([
                                    "type": "function_call",
                                    "call_id": (part["id"] as? String) ?? "",
                                    "name": (part["name"] as? String) ?? "",
                                    "arguments": arguments
                                ])
                            default:
                                break
                            }
                        }
                    } else if let text = message["content"] as? String, !text.isEmpty {
                        textParts.append(["type": "output_text", "text": text])
                    }
                    if !textParts.isEmpty {
                        input.append(["type": "message", "role": "assistant", "content": textParts])
                    }

                default:
                    break
                }
            }
        }

        // Reasoning — always set (CLIProxyAPI standard)
        var effort = "medium"
        if let thinking = json["thinking"] as? [String: Any] {
            let thinkingType = (thinking["type"] as? String) ?? ""
            if thinkingType == "disabled" { effort = "low" }
            else if thinkingType == "enabled" { effort = "high" }
            else if thinkingType == "adaptive" || thinkingType == "auto" { effort = "high" }
        }

        var payload: [String: Any] = [
            "model": model,
            "stream": true,
            "store": false,
            "instructions": "",
            "parallel_tool_calls": true,
            "include": ["reasoning.encrypted_content"],
            "reasoning": ["effort": effort, "summary": "auto"],
            "input": input
        ]

        // Tools: input_schema → parameters, delete $schema, set strict: false
        if let tools = json["tools"] as? [Any] {
            var converted: [[String: Any]] = []
            for rawTool in tools {
                guard let tool = rawTool as? [String: Any] else { continue }
                var ct: [String: Any] = [
                    "type": "function",
                    "name": (tool["name"] as? String) ?? "",
                    "description": (tool["description"] as? String) ?? "",
                    "strict": false
                ]
                if var schema = tool["input_schema"] as? [String: Any] {
                    schema.removeValue(forKey: "$schema")
                    ct["parameters"] = schema
                }
                converted.append(ct)
            }
            if !converted.isEmpty { payload["tools"] = converted }
        }

        // tool_choice
        if let tc = json["tool_choice"] as? [String: Any] {
            let choiceType = (tc["type"] as? String) ?? ""
            switch choiceType {
            case "auto": payload["tool_choice"] = "auto"
            case "any": payload["tool_choice"] = "required"
            case "tool":
                if let name = tc["name"] as? String {
                    payload["tool_choice"] = ["type": "function", "name": name]
                }
            default: break
            }
            // disable_parallel_tool_use → negate
            if let disable = tc["disable_parallel_tool_use"] as? Bool, disable {
                payload["parallel_tool_calls"] = false
            }
        }

        return (payload, model, isStream)
    }

    // MARK: - Streaming Response: Codex SSE → Anthropic SSE

    static func translateStreamingResponse(model: String, lines: AsyncStream<Data>) -> AsyncStream<Data> {
        let dataPrefix = Data("data: ".utf8)
        let msgID = generateMsgID()

        return AsyncStream { continuation in
            let task = Task {
                // message_start
                let messageStart: [String: Any] = [
                    "type": "message_start",
                    "message": [
                        "id": msgID, "type": "message", "role": "assistant",
                        "content": [] as [Any], "model": model,
                        "stop_reason": NSNull(), "stop_sequence": NSNull(),
                        "usage": ["input_tokens": 0, "output_tokens": 0]
                    ] as [String: Any]
                ]
                continuation.yield(formatEvent("message_start", messageStart))
                continuation.yield(Data("event: ping\ndata: {\"type\": \"ping\"}\n\n".utf8))

                var contentIndex = 0
                var textBlockOpen = false
                var hasToolCall = false
                var outputTokens = 0

                for await line in lines {
                    guard line.starts(with: dataPrefix) else { continue }
                    if let error = CodexUpstreamSSEInspector.error(fromSSELine: line) {
                        if textBlockOpen {
                            continuation.yield(formatEvent("content_block_stop", [
                                "type": "content_block_stop", "index": contentIndex
                            ]))
                        }
                        continuation.yield(formatEvent("error", [
                            "type": "error",
                            "error": ["type": "api_error", "message": error.message]
                        ]))
                        continuation.finish()
                        return
                    }
                    let payload = Data(line.dropFirst(dataPrefix.count))
                    guard let text = String(data: payload, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
                          !text.isEmpty, text != "[DONE]",
                          let event = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
                          let kind = event["type"] as? String else { continue }

                    switch kind {
                    case "response.output_text.delta":
                        let delta = (event["delta"] as? String) ?? ""
                        guard !delta.isEmpty else { continue }
                        if !textBlockOpen {
                            continuation.yield(formatEvent("content_block_start", [
                                "type": "content_block_start", "index": contentIndex,
                                "content_block": ["type": "text", "text": ""]
                            ]))
                            textBlockOpen = true
                        }
                        continuation.yield(formatEvent("content_block_delta", [
                            "type": "content_block_delta", "index": contentIndex,
                            "delta": ["type": "text_delta", "text": delta]
                        ]))

                    case "response.output_text.done":
                        if textBlockOpen {
                            continuation.yield(formatEvent("content_block_stop", [
                                "type": "content_block_stop", "index": contentIndex
                            ]))
                            contentIndex += 1; textBlockOpen = false
                        }

                    case "response.reasoning_summary_text.delta":
                        let delta = (event["delta"] as? String) ?? ""
                        guard !delta.isEmpty else { continue }
                        if !textBlockOpen {
                            continuation.yield(formatEvent("content_block_start", [
                                "type": "content_block_start", "index": contentIndex,
                                "content_block": ["type": "thinking", "thinking": ""]
                            ]))
                            textBlockOpen = true
                        }
                        continuation.yield(formatEvent("content_block_delta", [
                            "type": "content_block_delta", "index": contentIndex,
                            "delta": ["type": "thinking_delta", "thinking": delta]
                        ]))

                    case "response.reasoning_summary_text.done":
                        if textBlockOpen {
                            continuation.yield(formatEvent("content_block_stop", [
                                "type": "content_block_stop", "index": contentIndex
                            ]))
                            contentIndex += 1; textBlockOpen = false
                        }

                    case "response.output_item.added":
                        guard let item = event["item"] as? [String: Any],
                              (item["type"] as? String) == "function_call" else { continue }
                        if textBlockOpen {
                            continuation.yield(formatEvent("content_block_stop", [
                                "type": "content_block_stop", "index": contentIndex
                            ]))
                            contentIndex += 1; textBlockOpen = false
                        }
                        hasToolCall = true
                        continuation.yield(formatEvent("content_block_start", [
                            "type": "content_block_start", "index": contentIndex,
                            "content_block": [
                                "type": "tool_use",
                                "id": "toolu_\(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(24))",
                                "name": (item["name"] as? String) ?? "",
                                "input": [String: Any]()
                            ] as [String: Any]
                        ]))

                    case "response.function_call_arguments.delta":
                        let delta = (event["delta"] as? String) ?? ""
                        guard !delta.isEmpty else { continue }
                        continuation.yield(formatEvent("content_block_delta", [
                            "type": "content_block_delta", "index": contentIndex,
                            "delta": ["type": "input_json_delta", "partial_json": delta]
                        ]))

                    case "response.function_call_arguments.done":
                        continuation.yield(formatEvent("content_block_stop", [
                            "type": "content_block_stop", "index": contentIndex
                        ]))
                        contentIndex += 1

                    case "response.output_item.done":
                        if let item = event["item"] as? [String: Any],
                           (item["type"] as? String) == "function_call" {
                            continuation.yield(formatEvent("content_block_stop", [
                                "type": "content_block_stop", "index": contentIndex
                            ]))
                            contentIndex += 1
                        }

                    case "response.completed":
                        if let response = event["response"] as? [String: Any],
                           let usage = response["usage"] as? [String: Any] {
                            outputTokens = (usage["output_tokens"] as? Int) ?? 0
                        }

                    default:
                        break
                    }
                }

                // Close open block
                if textBlockOpen {
                    continuation.yield(formatEvent("content_block_stop", [
                        "type": "content_block_stop", "index": contentIndex
                    ]))
                }

                // message_delta + message_stop
                let stopReason = hasToolCall ? "tool_use" : "end_turn"
                continuation.yield(formatEvent("message_delta", [
                    "type": "message_delta",
                    "delta": ["stop_reason": stopReason, "stop_sequence": NSNull()] as [String: Any],
                    "usage": ["output_tokens": outputTokens]
                ]))
                continuation.yield(Data("event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n".utf8))

                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: - Non-Streaming: Collect Codex SSE → Anthropic Message

    static func collectAndTranslateResponse(model: String, lines: AsyncStream<Data>) async -> HTTPResponse {
        let dataPrefix = Data("data: ".utf8)
        var completedResponse: [String: Any]?

        for await line in lines {
            if let error = CodexUpstreamSSEInspector.error(fromSSELine: line) {
                return anthropicErrorResponse(statusCode: error.statusCode, message: error.message)
            }
            guard line.starts(with: dataPrefix) else { continue }
            let payload = Data(line.dropFirst(dataPrefix.count))
            if let text = String(data: payload, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
               text.contains("\"response.completed\""),
               let event = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
               let response = event["response"] as? [String: Any] {
                completedResponse = response
            }
        }

        guard let response = completedResponse else {
            return anthropicErrorResponse(statusCode: 502, message: "Failed to collect upstream response")
        }

        let message = buildAnthropicMessage(from: response, model: model)
        let data = (try? JSONSerialization.data(withJSONObject: message)) ?? Data("{}".utf8)
        return HTTPResponse(statusCode: 200, headers: ["Content-Type": "application/json; charset=utf-8"], body: data)
    }

    // MARK: - Build Anthropic Message from completed response

    private static func buildAnthropicMessage(from response: [String: Any], model: String) -> [String: Any] {
        let id = generateMsgID()
        var content: [[String: Any]] = []
        var hasToolCall = false

        if let output = response["output"] as? [Any] {
            for rawItem in output {
                guard let item = rawItem as? [String: Any],
                      let type = item["type"] as? String else { continue }
                switch type {
                case "reasoning":
                    if let summary = item["summary"] as? [Any] {
                        for raw in summary {
                            guard let s = raw as? [String: Any],
                                  (s["type"] as? String) == "summary_text",
                                  let text = s["text"] as? String, !text.isEmpty else { continue }
                            content.append(["type": "thinking", "thinking": text])
                        }
                    }
                case "message":
                    if let msgContent = item["content"] as? [Any] {
                        for raw in msgContent {
                            guard let c = raw as? [String: Any],
                                  (c["type"] as? String) == "output_text",
                                  let text = c["text"] as? String, !text.isEmpty else { continue }
                            content.append(["type": "text", "text": text])
                        }
                    }
                case "function_call":
                    hasToolCall = true
                    let args = (item["arguments"] as? String) ?? "{}"
                    var toolInput: Any = [String: Any]()
                    if let d = args.data(using: .utf8), let p = try? JSONSerialization.jsonObject(with: d) { toolInput = p }
                    content.append([
                        "type": "tool_use",
                        "id": "toolu_\(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(24))",
                        "name": (item["name"] as? String) ?? "",
                        "input": toolInput
                    ])
                default: break
                }
            }
        }

        if content.isEmpty, let text = extractText(from: response), !text.isEmpty {
            content.append(["type": "text", "text": text])
        }

        var usage: [String: Any] = ["input_tokens": 0, "output_tokens": 0]
        if let u = response["usage"] as? [String: Any] {
            usage["input_tokens"] = u["input_tokens"] ?? 0
            usage["output_tokens"] = u["output_tokens"] ?? 0
        }

        return [
            "id": id, "type": "message", "role": "assistant",
            "content": content, "model": model,
            "stop_reason": hasToolCall ? "tool_use" : "end_turn",
            "stop_sequence": NSNull(), "usage": usage
        ]
    }

    static func anthropicErrorResponse(statusCode: Int, message: String) -> HTTPResponse {
        let body: [String: Any] = [
            "type": "error",
            "error": ["type": "api_error", "message": message]
        ]
        let data = (try? JSONSerialization.data(withJSONObject: body)) ?? Data()
        return HTTPResponse(statusCode: statusCode, headers: ["Content-Type": "application/json; charset=utf-8"], body: data)
    }

    // MARK: - Helpers

    private static func convertContent(_ content: Any?, role: String) -> [[String: Any]] {
        let textType = role == "assistant" ? "output_text" : "input_text"
        guard let content else { return [] }
        if let text = content as? String, !text.isEmpty {
            return [["type": textType, "text": text]]
        }
        guard let items = content as? [Any] else { return [] }
        return items.compactMap { raw -> [String: Any]? in
            guard let part = raw as? [String: Any] else { return nil }
            let c = convertSinglePart(part, role: role)
            return c.isEmpty ? nil : c
        }
    }

    private static func convertSinglePart(_ part: [String: Any], role: String) -> [String: Any] {
        let textType = role == "assistant" ? "output_text" : "input_text"
        guard let type = part["type"] as? String else { return [:] }
        switch type {
        case "text":
            if let text = part["text"] as? String, !text.isEmpty { return ["type": textType, "text": text] }
        case "image":
            if let source = part["source"] as? [String: Any] {
                if (source["type"] as? String) == "base64",
                   let mt = source["media_type"] as? String, let d = source["data"] as? String {
                    return ["type": "input_image", "image_url": "data:\(mt);base64,\(d)"]
                }
                if (source["type"] as? String) == "url", let url = source["url"] as? String {
                    return ["type": "input_image", "image_url": url]
                }
            }
        default: break
        }
        return [:]
    }

    private static func stringifyToolResultContent(_ content: Any?) -> String {
        guard let content else { return "" }
        if let text = content as? String { return text }
        if let items = content as? [Any] {
            return items.compactMap { item -> String? in
                guard let obj = item as? [String: Any],
                      (obj["type"] as? String) == "text" else { return nil }
                return obj["text"] as? String
            }.joined(separator: "\n")
        }
        if let data = try? JSONSerialization.data(withJSONObject: content),
           let str = String(data: data, encoding: .utf8) { return str }
        return ""
    }

    private static func stringifyJSON(_ value: Any?) -> String {
        guard let value else { return "{}" }
        if let data = try? JSONSerialization.data(withJSONObject: value),
           let str = String(data: data, encoding: .utf8) { return str }
        return "{}"
    }

    private static func extractText(from response: [String: Any]) -> String? {
        guard let output = response["output"] as? [Any] else { return nil }
        for rawItem in output {
            guard let item = rawItem as? [String: Any] else { continue }
            if let content = item["content"] as? [Any] {
                for rawC in content {
                    guard let c = rawC as? [String: Any],
                          (c["type"] as? String) == "output_text",
                          let text = c["text"] as? String else { continue }
                    return text
                }
            }
        }
        return nil
    }

    private static func generateMsgID() -> String {
        "msg_\(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(24))"
    }

    private static func formatEvent(_ event: String, _ object: [String: Any]) -> Data {
        guard let json = try? JSONSerialization.data(withJSONObject: object) else { return Data() }
        var line = Data("event: \(event)\ndata: ".utf8)
        line.append(json)
        line.append(Data("\n\n".utf8))
        return line
    }
}
