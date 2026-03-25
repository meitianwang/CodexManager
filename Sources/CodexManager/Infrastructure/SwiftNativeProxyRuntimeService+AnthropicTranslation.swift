import Foundation

// MARK: - Anthropic ↔ Responses API Translation
// Adapted from CLIProxyAPI/internal/translator/claude/openai/chat-completions/

extension SwiftNativeProxyRuntimeService {

    // MARK: - Anthropic Request → Responses Request
    // Mirrors CLIProxyAPI's ConvertOpenAIRequestToClaude but in reverse:
    // Anthropic Messages API → Codex Responses API

    func convertAnthropicRequestToResponses(_ request: [String: Any]) throws -> (payload: [String: Any], downstreamStream: Bool) {
        guard let rawModel = request["model"] as? String, !rawModel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw AppError.invalidData(L10n.tr("error.proxy_runtime.missing_model"))
        }
        let model = try mapClientModelToUpstream(rawModel)

        let downstreamStream = (request["stream"] as? Bool) ?? true

        // Build input array from Anthropic messages
        var input: [[String: Any]] = []

        // Handle system message (Anthropic puts it at top-level)
        if let system = request["system"] as? String, !system.isEmpty {
            input.append([
                "type": "message",
                "role": "developer",
                "content": [["type": "input_text", "text": system]]
            ])
        } else if let systemParts = request["system"] as? [Any] {
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
        if let messages = request["messages"] as? [Any] {
            for raw in messages {
                guard let message = raw as? [String: Any],
                      let role = message["role"] as? String else { continue }

                switch role {
                case "user":
                    let parts = convertAnthropicContentToCodexParts(message["content"], role: "user")
                    // Check for tool_result content blocks
                    if let contentArray = message["content"] as? [Any] {
                        var regularParts: [[String: Any]] = []
                        for rawPart in contentArray {
                            guard let part = rawPart as? [String: Any],
                                  let type = part["type"] as? String else { continue }

                            if type == "tool_result" {
                                // Flush accumulated regular parts as a user message
                                if !regularParts.isEmpty {
                                    input.append([
                                        "type": "message",
                                        "role": "user",
                                        "content": regularParts
                                    ])
                                    regularParts = []
                                }
                                // Convert tool_result → function_call_output
                                let toolUseID = (part["tool_use_id"] as? String) ?? ""
                                let outputText = stringifyAnthropicToolResultContent(part["content"])
                                input.append([
                                    "type": "function_call_output",
                                    "call_id": toolUseID,
                                    "output": outputText
                                ])
                            } else {
                                let converted = convertAnthropicSinglePartToCodex(part, role: "user")
                                if !converted.isEmpty { regularParts.append(converted) }
                            }
                        }
                        if !regularParts.isEmpty {
                            input.append([
                                "type": "message",
                                "role": "user",
                                "content": regularParts
                            ])
                        }
                    } else if !parts.isEmpty {
                        input.append([
                            "type": "message",
                            "role": "user",
                            "content": parts
                        ])
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
                                // Flush text parts first
                                if !textParts.isEmpty {
                                    input.append([
                                        "type": "message",
                                        "role": "assistant",
                                        "content": textParts
                                    ])
                                    textParts = []
                                }
                                // Convert tool_use → function_call
                                let toolID = (part["id"] as? String) ?? ""
                                let toolName = (part["name"] as? String) ?? ""
                                let toolInput = part["input"]
                                let arguments = stringifyJSONField(toolInput)
                                input.append([
                                    "type": "function_call",
                                    "call_id": toolID,
                                    "name": toolName,
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
                        input.append([
                            "type": "message",
                            "role": "assistant",
                            "content": textParts
                        ])
                    }

                default:
                    break
                }
            }
        }

        // Build reasoning config
        var reasoning: [String: Any] = ["effort": "medium", "summary": "auto"]
        if let thinking = request["thinking"] as? [String: Any] {
            let thinkingType = (thinking["type"] as? String) ?? ""
            if thinkingType == "disabled" {
                reasoning["effort"] = "low"
            } else if thinkingType == "enabled" || thinkingType == "adaptive" {
                reasoning["effort"] = "high"
            }
        }
        reasoning = Self.normalizedReasoningForUpstream(reasoning, upstreamModel: model)

        var payload: [String: Any] = [
            "model": model,
            "stream": true,
            "store": false,
            "instructions": "",
            "parallel_tool_calls": true,
            "include": ["reasoning.encrypted_content"],
            "reasoning": reasoning,
            "input": input
        ]

        // Convert tools
        if let tools = request["tools"] as? [Any] {
            var convertedTools: [[String: Any]] = []
            for rawTool in tools {
                guard let tool = rawTool as? [String: Any] else { continue }
                let name = (tool["name"] as? String) ?? ""
                let description = (tool["description"] as? String) ?? ""
                var converted: [String: Any] = [
                    "type": "function",
                    "name": name,
                    "description": description
                ]
                if let inputSchema = tool["input_schema"] as? [String: Any] {
                    converted["parameters"] = inputSchema
                }
                convertedTools.append(converted)
            }
            if !convertedTools.isEmpty {
                payload["tools"] = convertedTools
            }
        }

        // Convert tool_choice
        if let toolChoice = request["tool_choice"] as? [String: Any] {
            let choiceType = (toolChoice["type"] as? String) ?? ""
            switch choiceType {
            case "auto":
                payload["tool_choice"] = "auto"
            case "any":
                payload["tool_choice"] = "required"
            case "tool":
                if let name = toolChoice["name"] as? String {
                    payload["tool_choice"] = ["type": "function", "function": ["name": name]]
                }
            default:
                break
            }
        }

        // max_tokens
        if let maxTokens = request["max_tokens"] as? Int {
            payload["max_output_tokens"] = maxTokens
        }

        return (payload, downstreamStream)
    }

    // MARK: - Responses SSE → Anthropic SSE
    // Adapted from CLIProxyAPI's ConvertClaudeResponseToOpenAI (reversed direction)

    func convertResponsesSSEToAnthropicSSE(_ sseData: Data, fallbackModel: String) throws -> Data {
        let events = parseSSEEvents(from: sseData)
        let model = normalizeModelForClient(fallbackModel)
        let msgID = "msg_\(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(24))"

        var lines = ""
        var contentIndex = 0
        var inputTokens = 0
        var outputTokens = 0
        _ = inputTokens  // Used only in completed event

        // message_start
        let messageStart: [String: Any] = [
            "type": "message_start",
            "message": [
                "id": msgID,
                "type": "message",
                "role": "assistant",
                "content": [] as [Any],
                "model": model,
                "stop_reason": NSNull(),
                "stop_sequence": NSNull(),
                "usage": ["input_tokens": 0, "output_tokens": 0]
            ] as [String: Any]
        ]
        lines += "event: message_start\ndata: \(jsonString(messageStart))\n\n"
        lines += "event: ping\ndata: {\"type\": \"ping\"}\n\n"

        var textBlockOpen = false
        var hasToolCall = false

        for event in events {
            guard event.data != "[DONE]",
                  let payloadData = event.data.data(using: .utf8),
                  let parsed = try? JSONSerialization.jsonObject(with: payloadData) as? [String: Any],
                  let kind = parsed["type"] as? String else { continue }

            switch kind {
            case "response.output_text.delta":
                let delta = (parsed["delta"] as? String) ?? ""
                guard !delta.isEmpty else { continue }
                if !textBlockOpen {
                    // content_block_start for text
                    let blockStart: [String: Any] = [
                        "type": "content_block_start",
                        "index": contentIndex,
                        "content_block": ["type": "text", "text": ""]
                    ]
                    lines += "event: content_block_start\ndata: \(jsonString(blockStart))\n\n"
                    textBlockOpen = true
                }
                let blockDelta: [String: Any] = [
                    "type": "content_block_delta",
                    "index": contentIndex,
                    "delta": ["type": "text_delta", "text": delta]
                ]
                lines += "event: content_block_delta\ndata: \(jsonString(blockDelta))\n\n"

            case "response.output_text.done":
                if textBlockOpen {
                    let blockStop: [String: Any] = [
                        "type": "content_block_stop",
                        "index": contentIndex
                    ]
                    lines += "event: content_block_stop\ndata: \(jsonString(blockStop))\n\n"
                    contentIndex += 1
                    textBlockOpen = false
                }

            case "response.reasoning_summary_text.delta":
                let delta = (parsed["delta"] as? String) ?? ""
                guard !delta.isEmpty else { continue }
                if !textBlockOpen {
                    let blockStart: [String: Any] = [
                        "type": "content_block_start",
                        "index": contentIndex,
                        "content_block": ["type": "thinking", "thinking": ""]
                    ]
                    lines += "event: content_block_start\ndata: \(jsonString(blockStart))\n\n"
                    textBlockOpen = true
                }
                let thinkDelta: [String: Any] = [
                    "type": "content_block_delta",
                    "index": contentIndex,
                    "delta": ["type": "thinking_delta", "thinking": delta]
                ]
                lines += "event: content_block_delta\ndata: \(jsonString(thinkDelta))\n\n"

            case "response.reasoning_summary_text.done":
                if textBlockOpen {
                    let blockStop: [String: Any] = [
                        "type": "content_block_stop",
                        "index": contentIndex
                    ]
                    lines += "event: content_block_stop\ndata: \(jsonString(blockStop))\n\n"
                    contentIndex += 1
                    textBlockOpen = false
                }

            case "response.output_item.added":
                guard let item = parsed["item"] as? [String: Any],
                      (item["type"] as? String) == "function_call" else { continue }
                // Close text block if open
                if textBlockOpen {
                    let blockStop: [String: Any] = [
                        "type": "content_block_stop",
                        "index": contentIndex
                    ]
                    lines += "event: content_block_stop\ndata: \(jsonString(blockStop))\n\n"
                    contentIndex += 1
                    textBlockOpen = false
                }
                hasToolCall = true
                // Start tool_use content block
                let toolID = "toolu_\(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(24))"
                let toolName = (item["name"] as? String) ?? ""
                let blockStart: [String: Any] = [
                    "type": "content_block_start",
                    "index": contentIndex,
                    "content_block": [
                        "type": "tool_use",
                        "id": toolID,
                        "name": toolName,
                        "input": [String: Any]()
                    ] as [String: Any]
                ]
                lines += "event: content_block_start\ndata: \(jsonString(blockStart))\n\n"

            case "response.function_call_arguments.delta":
                let delta = (parsed["delta"] as? String) ?? ""
                guard !delta.isEmpty else { continue }
                let argDelta: [String: Any] = [
                    "type": "content_block_delta",
                    "index": contentIndex,
                    "delta": ["type": "input_json_delta", "partial_json": delta]
                ]
                lines += "event: content_block_delta\ndata: \(jsonString(argDelta))\n\n"

            case "response.function_call_arguments.done",
                 "response.output_item.done":
                if let item = parsed["item"] as? [String: Any],
                   (item["type"] as? String) == "function_call" {
                    let blockStop: [String: Any] = [
                        "type": "content_block_stop",
                        "index": contentIndex
                    ]
                    lines += "event: content_block_stop\ndata: \(jsonString(blockStop))\n\n"
                    contentIndex += 1
                } else if kind == "response.function_call_arguments.done" {
                    let blockStop: [String: Any] = [
                        "type": "content_block_stop",
                        "index": contentIndex
                    ]
                    lines += "event: content_block_stop\ndata: \(jsonString(blockStop))\n\n"
                    contentIndex += 1
                }

            case "response.completed":
                // Extract usage
                if let response = parsed["response"] as? [String: Any],
                   let usage = response["usage"] as? [String: Any] {
                    inputTokens = (usage["input_tokens"] as? Int) ?? 0
                    outputTokens = (usage["output_tokens"] as? Int) ?? 0
                }

            default:
                break
            }
        }

        // Close any open text block
        if textBlockOpen {
            let blockStop: [String: Any] = [
                "type": "content_block_stop",
                "index": contentIndex
            ]
            lines += "event: content_block_stop\ndata: \(jsonString(blockStop))\n\n"
        }

        // message_delta with stop_reason
        let stopReason = hasToolCall ? "tool_use" : "end_turn"
        let msgDelta: [String: Any] = [
            "type": "message_delta",
            "delta": ["stop_reason": stopReason, "stop_sequence": NSNull()] as [String: Any],
            "usage": ["output_tokens": outputTokens]
        ]
        lines += "event: message_delta\ndata: \(jsonString(msgDelta))\n\n"

        // message_stop
        lines += "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"

        return Data(lines.utf8)
    }

    // MARK: - Completed Responses → Anthropic Non-Streaming Response

    func convertCompletedResponseToAnthropicMessage(_ response: [String: Any], fallbackModel: String) -> [String: Any] {
        let id = "msg_\(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(24))"
        let model = normalizeModelForClient(fallbackModel)

        var content: [[String: Any]] = []
        var hasToolCall = false

        if let output = response["output"] as? [Any] {
            for rawItem in output {
                guard let item = rawItem as? [String: Any],
                      let type = item["type"] as? String else { continue }

                switch type {
                case "reasoning":
                    if let summary = item["summary"] as? [Any] {
                        for rawSummary in summary {
                            guard let summaryObject = rawSummary as? [String: Any] else { continue }
                            if (summaryObject["type"] as? String) == "summary_text",
                               let text = summaryObject["text"] as? String,
                               !text.isEmpty {
                                content.append([
                                    "type": "thinking",
                                    "thinking": text
                                ])
                            }
                        }
                    }
                case "message":
                    if let msgContent = item["content"] as? [Any] {
                        for rawContent in msgContent {
                            guard let contentObj = rawContent as? [String: Any] else { continue }
                            if (contentObj["type"] as? String) == "output_text",
                               let text = contentObj["text"] as? String, !text.isEmpty {
                                content.append([
                                    "type": "text",
                                    "text": text
                                ])
                            }
                        }
                    }
                case "function_call":
                    hasToolCall = true
                    let toolID = "toolu_\(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(24))"
                    let name = (item["name"] as? String) ?? ""
                    let arguments = (item["arguments"] as? String) ?? "{}"
                    var toolInput: Any = [String: Any]()
                    if let data = arguments.data(using: .utf8),
                       let parsed = try? JSONSerialization.jsonObject(with: data) {
                        toolInput = parsed
                    }
                    content.append([
                        "type": "tool_use",
                        "id": toolID,
                        "name": name,
                        "input": toolInput
                    ])
                default:
                    break
                }
            }
        }

        // Fallback: extract text from output_text
        if content.isEmpty {
            let text = extractAssistantText(fromCompletedResponse: response)
            if !text.isEmpty {
                content.append(["type": "text", "text": text])
            }
        }

        let stopReason = hasToolCall ? "tool_use" : "end_turn"

        var usage: [String: Any] = ["input_tokens": 0, "output_tokens": 0]
        if let responseUsage = response["usage"] as? [String: Any] {
            usage["input_tokens"] = responseUsage["input_tokens"] ?? 0
            usage["output_tokens"] = responseUsage["output_tokens"] ?? 0
        }

        return [
            "id": id,
            "type": "message",
            "role": "assistant",
            "content": content,
            "model": model,
            "stop_reason": stopReason,
            "stop_sequence": NSNull(),
            "usage": usage
        ]
    }

    // MARK: - Helpers

    private func convertAnthropicContentToCodexParts(_ content: Any?, role: String) -> [[String: Any]] {
        let textType = role == "assistant" ? "output_text" : "input_text"
        guard let content else { return [] }

        if let text = content as? String {
            guard !text.isEmpty else { return [] }
            return [["type": textType, "text": text]]
        }

        guard let items = content as? [Any] else { return [] }
        var parts: [[String: Any]] = []
        for raw in items {
            guard let part = raw as? [String: Any] else { continue }
            let converted = convertAnthropicSinglePartToCodex(part, role: role)
            if !converted.isEmpty { parts.append(converted) }
        }
        return parts
    }

    private func convertAnthropicSinglePartToCodex(_ part: [String: Any], role: String) -> [String: Any] {
        let textType = role == "assistant" ? "output_text" : "input_text"
        guard let type = part["type"] as? String else { return [:] }

        switch type {
        case "text":
            if let text = part["text"] as? String, !text.isEmpty {
                return ["type": textType, "text": text]
            }
        case "image":
            // Anthropic base64 image → input_image data URL
            if let source = part["source"] as? [String: Any],
               (source["type"] as? String) == "base64",
               let mediaType = source["media_type"] as? String,
               let data = source["data"] as? String {
                return ["type": "input_image", "image_url": "data:\(mediaType);base64,\(data)"]
            }
            // URL image
            if let source = part["source"] as? [String: Any],
               (source["type"] as? String) == "url",
               let url = source["url"] as? String {
                return ["type": "input_image", "image_url": url]
            }
        default:
            break
        }
        return [:]
    }

    private func stringifyAnthropicToolResultContent(_ content: Any?) -> String {
        guard let content else { return "" }

        if let text = content as? String { return text }

        if let items = content as? [Any] {
            let texts = items.compactMap { item -> String? in
                guard let obj = item as? [String: Any] else { return nil }
                if (obj["type"] as? String) == "text" {
                    return obj["text"] as? String
                }
                return nil
            }
            return texts.joined(separator: "\n")
        }

        return stringifyContent(content)
    }
}
