# CodexManager

A native macOS/iOS application for managing Codex/ChatGPT accounts with usage-based smart switching and local/remote API proxying.

## Features

- **Multi-Account Management**: Import and manage multiple ChatGPT/Codex accounts
- **Smart Switching**: Automatically switch to the account with the most available quota
- **Local API Proxy**: Built-in HTTP proxy server for routing API requests through managed accounts
- **Remote Proxy Nodes**: Deploy and manage proxy instances on remote servers via SSH
- **iCloud Sync**: Seamlessly synchronize accounts and settings across devices via CloudKit
- **Usage Monitoring**: Real-time usage tracking with visual progress indicators

## Building

### Requirements

- Xcode 16+
- macOS 15+ deployment target
- Swift 6.1+

### Build with Swift Package Manager

```bash
swift build
```

### Generate Xcode Project (optional)

```bash
# Requires XcodeGen
xcodegen generate
```

## Architecture

The project follows a clean layered architecture:

```
App → Features → UI → Behavior → Infrastructure → Domain
```

- **Domain**: Core models, protocols, and error types
- **Infrastructure**: File I/O, CloudKit sync, HTTP server, auth management
- **Behavior**: Business logic coordinators (accounts, proxy control)
- **Features**: SwiftUI views and view models (Accounts, Proxy, Settings)
- **App**: Entry point, dependency injection, tray menu

## Author

NikMei

## License

Private - All Rights Reserved
