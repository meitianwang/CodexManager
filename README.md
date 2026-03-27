# CodexManager

原生 macOS 应用，用于管理多个 Codex / ChatGPT 账号，支持用量感知的智能切换和本地 API 反向代理。

## 功能概览

### 多账号管理
- 导入并管理多个 ChatGPT / Codex 账号（支持 Free、Plus、Pro、Team、Enterprise 等套餐）
- 实时查看各账号的 5 小时和 1 周用量配额，余量一目了然
- 通过 iCloud / CloudKit 在多台 Mac 之间自动同步账号数据

### 智能切换
- 一键手动切换账号
- 开启「自动智能切换」后，自动选择余量最多的账号
- 切换后可自动重启指定编辑器（VS Code、Cursor、Kiro、Trae 等），立即生效

### 本地 API 代理
- 内置 HTTP 代理服务器，仅监听 127.0.0.1，安全可靠
- 兼容三种主流 API 协议：
  - **OpenAI Chat** — `/v1/chat/completions`
  - **OpenAI Responses** — `/v1/responses`
  - **Anthropic Messages** — `/v1/messages`
- 支持流式响应（SSE Streaming）
- API Key 和端口均可自定义，配置持久化保存
- 可设置「启动时自动开启代理」，省去每次手动操作
- 动态从远程拉取可用模型列表，也可回退到内置模型

### 设置
- 开机自启
- 11 种语言切换（中文、英文、日语、韩语、法语、德语、意大利语、西班牙语、俄语、荷兰语、繁体中文）
- 切换账号后自动重启编辑器

## 安装

### 从 GitHub Releases 下载

前往 [Releases](https://github.com/meitianwang/CodexManager/releases) 页面，下载最新的 DMG 或 ZIP 文件，拖入 Applications 即可。

### 从源码构建

**环境要求：**
- macOS 14.0+
- Xcode 16+
- Swift 6.1+

```bash
# 克隆仓库
git clone https://github.com/meitianwang/CodexManager.git
cd CodexManager

# 直接构建
swift build

# 或生成 Xcode 工程（需要 XcodeGen）
xcodegen generate
open CodexManager.xcodeproj
```

### 打包

```bash
# 本地预览版（ad-hoc 签名，用于测试）
./scripts/package_macos.sh local

# 正式发布版（Developer ID 签名 + 公证）
./scripts/package_macos.sh release
```

产物输出到 `artifacts/macos/` 目录，包含 `.app`、`.zip`、`.dmg` 及对应的 SHA256 校验文件。

## 使用方法

### 代理配置

启动代理后，界面会显示当前的端口和 API Key。将以下环境变量配置到你的 CLI 工具中即可：

**OpenAI 兼容工具（Cursor、VS Code Copilot 等）：**

```bash
OPENAI_BASE_URL=http://localhost:18317/v1
OPENAI_API_KEY=sk-local-xxxx
```

**Anthropic 兼容工具（Claude Code 等）：**

```bash
ANTHROPIC_BASE_URL=http://localhost:18317
ANTHROPIC_API_KEY=sk-local-xxxx
```

**cURL 测试：**

```bash
curl http://localhost:18317/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-local-xxxx" \
  -d '{"model":"gpt-5","messages":[{"role":"user","content":"Hello"}]}'
```

## 架构

项目采用分层架构：

```
App → Features → Behavior → Infrastructure → Domain
```

| 层 | 职责 |
|---|------|
| **Domain** | 核心模型、协议、错误类型 |
| **Infrastructure** | 文件读写、CloudKit 同步、HTTP 服务器、OAuth 认证 |
| **Behavior** | 业务逻辑协调器（账号、代理、设置） |
| **Features** | SwiftUI 视图和 ViewModel（账号、代理、设置） |
| **App** | 入口、依赖注入、菜单栏托盘 |

## 支持的编辑器

账号切换后可自动重启以下编辑器：

- Visual Studio Code
- Visual Studio Code Insiders
- Cursor
- Antigravity
- Kiro
- Trae
- Qoder

## 作者

NikMei

## 许可证

Private - All Rights Reserved
