# CodexManager

A native macOS app for managing multiple Codex / ChatGPT accounts with usage-aware smart switching and a local API reverse proxy.

原生 macOS 应用，用于管理多个 Codex / ChatGPT 账号，支持用量感知的智能切换和本地 API 反向代理。

## Features / 功能概览

### Multi-Account Management / 多账号管理
- Import and manage multiple ChatGPT / Codex accounts (Free, Plus, Pro, Team, Enterprise)
- Real-time usage monitoring with 5-hour and 1-week quota windows
- Automatic sync across Macs via iCloud / CloudKit

---

- 导入并管理多个 ChatGPT / Codex 账号（支持 Free、Plus、Pro、Team、Enterprise 等套餐）
- 实时查看各账号的 5 小时和 1 周用量配额，余量一目了然
- 通过 iCloud / CloudKit 在多台 Mac 之间自动同步账号数据

### Smart Switching / 智能切换
- One-click manual account switching
- Auto Smart Switch: automatically picks the account with the most remaining quota
- Optionally restart editors (VS Code, Cursor, Kiro, Trae, etc.) after switching

---

- 一键手动切换账号
- 开启「自动智能切换」后，自动选择余量最多的账号
- 切换后可自动重启指定编辑器（VS Code、Cursor、Kiro、Trae 等），立即生效

### Local API Proxy / 本地 API 代理
- Built-in HTTP proxy server, listens on 127.0.0.1 only
- Three API protocols:
  - **OpenAI Chat** — `/v1/chat/completions`
  - **OpenAI Responses** — `/v1/responses`
  - **Anthropic Messages** — `/v1/messages`
- SSE streaming support
- Configurable API Key and port, persisted across launches
- Optional auto-start on app launch
- Dynamic remote model list with built-in fallback

---

- 内置 HTTP 代理服务器，仅监听 127.0.0.1，安全可靠
- 兼容三种主流 API 协议：
  - **OpenAI Chat** — `/v1/chat/completions`
  - **OpenAI Responses** — `/v1/responses`
  - **Anthropic Messages** — `/v1/messages`
- 支持流式响应（SSE Streaming）
- API Key 和端口均可自定义，配置持久化保存
- 可设置「启动时自动开启代理」，省去每次手动操作
- 动态从远程拉取可用模型列表，也可回退到内置模型

### Settings / 设置
- Launch at login
- 11 languages (English, Simplified Chinese, Traditional Chinese, Japanese, Korean, French, German, Italian, Spanish, Russian, Dutch)
- Auto-restart editors on account switch

---

- 开机自启
- 11 种语言切换（中文、英文、日语、韩语、法语、德语、意大利语、西班牙语、俄语、荷兰语、繁体中文）
- 切换账号后自动重启编辑器

## Installation / 安装

### Download from GitHub Releases / 从 GitHub Releases 下载

Go to the [Releases](https://github.com/meitianwang/CodexManager/releases) page, download the latest DMG or ZIP, and drag the app into Applications.

前往 [Releases](https://github.com/meitianwang/CodexManager/releases) 页面，下载最新的 DMG 或 ZIP 文件，拖入 Applications 即可。

### Build from Source / 从源码构建

**Requirements / 环境要求：**
- macOS 14.0+
- Xcode 16+
- Swift 6.1+

```bash
git clone https://github.com/meitianwang/CodexManager.git
cd CodexManager

# Build directly
swift build

# Or generate Xcode project (requires XcodeGen)
xcodegen generate
open CodexManager.xcodeproj
```

### Packaging / 打包

```bash
# Local preview (ad-hoc signed, for testing)
./scripts/package_macos.sh local

# Release build (Developer ID signed + notarized)
./scripts/package_macos.sh release
```

Artifacts are output to `artifacts/macos/`, including `.app`, `.zip`, `.dmg` and their SHA256 checksums.

产物输出到 `artifacts/macos/` 目录，包含 `.app`、`.zip`、`.dmg` 及对应的 SHA256 校验文件。

## Usage / 使用方法

### Proxy Configuration / 代理配置

After starting the proxy, the UI shows the current port and API Key. Set these environment variables in your CLI tools:

启动代理后，界面会显示当前的端口和 API Key。将以下环境变量配置到你的 CLI 工具中即可：

**OpenAI-compatible tools (Cursor, VS Code Copilot, etc.)：**

```bash
OPENAI_BASE_URL=http://localhost:18317/v1
OPENAI_API_KEY=sk-local-xxxx
```

**Anthropic-compatible tools (Claude Code, etc.)：**

```bash
ANTHROPIC_BASE_URL=http://localhost:18317
ANTHROPIC_API_KEY=sk-local-xxxx
```

**cURL test：**

```bash
curl http://localhost:18317/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-local-xxxx" \
  -d '{"model":"gpt-5","messages":[{"role":"user","content":"Hello"}]}'
```

## Architecture / 架构

```
App → Features → Behavior → Infrastructure → Domain
```

| Layer | Responsibility |
|-------|---------------|
| **Domain** | Core models, protocols, error types / 核心模型、协议、错误类型 |
| **Infrastructure** | File I/O, CloudKit sync, HTTP server, OAuth / 文件读写、CloudKit 同步、HTTP 服务器、OAuth 认证 |
| **Behavior** | Business logic coordinators / 业务逻辑协调器（账号、代理、设置） |
| **Features** | SwiftUI views and ViewModels / SwiftUI 视图和 ViewModel |
| **App** | Entry point, DI, menu bar tray / 入口、依赖注入、菜单栏托盘 |

## Supported Editors / 支持的编辑器

Auto-restart on account switch / 账号切换后可自动重启：

- Visual Studio Code
- Visual Studio Code Insiders
- Cursor
- Antigravity
- Kiro
- Trae
- Qoder

## Author / 作者

NikMei

## License / 许可证

Private - All Rights Reserved
