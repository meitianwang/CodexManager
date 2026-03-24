# Copool Simplification Review Checklist

## Review Basis

本次审查按以下原则判断：

- 不过度设计
- 不写过度防御性代码
- 不为了兼容历史/假想场景增加长期复杂度
- 不做兜底和 fallback
- 允许破坏性更新
- 逻辑清晰易懂优先于“看起来完整”
- 测试除了单元测试，还需要覆盖用户操作路径

## Current Baseline

- [x] `swift test` 通过，当前共有 152 个测试
- [x] 现有测试主要是单元测试/展示规则测试
- [x] 已补最小用户操作级 smoke test（模型层）
- [x] `swift test` 资源告警已通过 `Package.swift` 的 `exclude` 清理

## P0: Remove Hidden Recovery And Silent Fallbacks

- [x] 删除 `StoreFileRepository.loadStore()` 里的“截取第一个 JSON 对象继续恢复”逻辑，坏文件直接备份并重置，或者直接失败。
  Evidence: `Sources/Copool/Infrastructure/StoreFileRepository.swift:27-40`, `Sources/Copool/Infrastructure/StoreFileRepository.swift:101-154`
  Reason: 这是典型的静默修复和隐式兜底，会掩盖真实数据问题，也让存储规则变得不可预测。

- [x] 删除 `CloudKitAccountsSyncService.pullRemoteAccountsIfNeeded()` 在远端 payload 无效时把本地快照重新推回远端的逻辑。
  Evidence: `Sources/Copool/Infrastructure/CloudKitAccountsSyncService.swift:134-139`, `Sources/Copool/Infrastructure/CloudKitAccountsSyncService.swift:268-282`
  Reason: 这属于“远端异常时自动补写”的 fallback；在测试环境和单人项目里，显式暴露问题比自动补救更清晰。

- [x] 梳理 proxy runtime 中对请求内容的隐式修正，优先移除“自动改写后重试”这类兼容逻辑。
  Evidence: `Sources/Copool/Infrastructure/SwiftNativeProxyRuntimeService.swift:319-324`, `Sources/Copool/Infrastructure/SwiftNativeProxyRuntimeService.swift:378-415`
  Reason: 当前会把 `reasoning.summary` / `reasoning.effort` 从请求侧静默改写后重试，行为不透明，后续排查会变难。

## P1: Reduce Over-Abstracted Structure

- [x] 收缩 `Domain/Protocols.swift` 的协议层，只保留确实存在多个实现或确实需要稳定替身边界的协议。
  Evidence: `Sources/Copool/Domain/Protocols.swift:3-158`
  Reason: 当前协议数量明显过多，但 `AppContainer` 基本全部直接绑定具体实现，说明很多协议只是为了抽象而抽象。

- [x] 优先把只服务于测试注入的轻量依赖改成更直接的 concrete type 或 closure 注入，避免“一个类型配一个 protocol”。
  Evidence: `Sources/Copool/Domain/Protocols.swift:19-137`, `Sources/Copool/App/AppContainer.swift:71-178`
  Reason: 这个项目只有你自己使用，过多接口层会显著提高理解成本。

- [x] 重新审视 `AppContainer.liveOrCrash()` 里重复构建的第二套 proxy 依赖图，能共用就共用，不能共用就把理由写清楚。
  Evidence: `Sources/Copool/App/AppContainer.swift:20-46`, `Sources/Copool/App/AppContainer.swift:110-126`
  Reason: 当前主流程和 remote mutation sync 各自重新 new 一套 `SwiftNativeProxyRuntimeService` / `CloudflaredService` / `RemoteProxyService` / `ProxyCoordinator`，阅读成本很高。

## P1: Split Files By Real Responsibility

- [x] 拆分 `SwiftNativeProxyRuntimeService.swift`，至少拆成“HTTP surface / request normalization / upstream transport / model mapping”几块。
  Evidence: 文件总长 1666 行；入口和传输逻辑集中在 `Sources/Copool/Infrastructure/SwiftNativeProxyRuntimeService.swift:3-415`
  Reason: 这个文件已经大到无法低成本确认改动影响，继续叠逻辑只会越来越难维护。

- [x] 拆分 `SectionCard.swift`，把基础容器、按钮样式、surface modifier、progress 组件分文件。
  Evidence: 文件总长 1265 行；基础卡片和大量视觉 primitive 混在 `Sources/Copool/UI/SectionCard.swift:6-320`
  Reason: 一个 UI 文件承载过多概念，已经不是“组件复用”，而是“视觉系统全集中”。

- [x] 拆分 `CloudKitAccountsSyncService.swift`，至少把 availability、accounts sync、current selection sync 分开。
  Evidence: `Sources/Copool/Infrastructure/CloudKitAccountsSyncService.swift:8-49`, `Sources/Copool/Infrastructure/CloudKitAccountsSyncService.swift:51-360`
  Reason: 当前一个文件承载多个 actor / service，职责边界不清楚，阅读时需要不断切上下文。

## P1: Remove Compatibility Baggage That Is No Longer Worth Carrying

- [x] 精简 proxy runtime 里的模型兼容映射，只保留你当前真实会用到的模型名。
  Evidence: `Sources/Copool/Infrastructure/SwiftNativeProxyRuntimeService.swift:9-32`
  Reason: 现在维护了一大组稳定名、兼容名、默认版本、默认 UA，本质上是在承担客户端兼容层的复杂度。

- [x] 评估是否还需要 AppSettings / AccountsStore 中的 legacy decode 与 fallback 字段解析；确认可抛弃后就删掉。
  Evidence: `Sources/Copool/Domain/Models.swift` 中存在多处 legacy / fallback 解析分支；测试也仍覆盖 legacy 行为，例如 `Tests/CopoolTests/AppSettingsCodableTests.swift`、`Tests/CopoolTests/StoreFileRepositoryTests.swift`
  Reason: 你的约束已经明确允许破坏性更新，不必长期背着历史格式迁移代码。

- [x] 对视觉层做一次平台收敛，停止在同一组件里同时维护 glass / material / fallback 多套视觉路径。
  Evidence: `Sources/Copool/UI/SectionCard.swift:153-207`, `Sources/Copool/UI/SectionCard.swift:223-265`
  Reason: 这类兼容写法会迅速把视觉组件变成状态机，不符合“逻辑清晰易懂优先”。

## P2: Make Runtime Behavior More Direct

- [x] 清理 `SwiftNativeProxyRuntimeService.status()` 里大量 `try?` 式静默失败，明确哪些状态读取失败应该直接暴露错误。
  Evidence: `Sources/Copool/Infrastructure/SwiftNativeProxyRuntimeService.swift:59-73`
  Reason: `apiKey` 和 `availableAccounts` 读取失败现在直接吞掉，界面看到的是“正常但为空”，这不利于定位真实问题。

- [x] 清理启动期“失败后忽略”的异步任务，尤其是 launch-at-startup 同步。
  Evidence: `Sources/Copool/App/AppContainer.swift:152-158`
  Reason: 这类 catch-and-ignore 容易制造“设置没生效但用户不知道”的灰区行为。

## P2: Fill The Real Verification Gap

- [x] 新增最小用户流 smoke test，而不只是继续补纯规则单元测试。
  Minimum flows:
  1. 启动应用并加载账户列表
  2. 导入或切换当前账户
  3. 打开 Proxy 页并启动/停止本地代理
  4. 修改一项设置并验证状态更新
  Evidence: `Tests` 目录目前只有单元测试；仓库中没有 UI test target，也没有 `XCUIApplication` 使用痕迹
  Reason: 你的项目原则已经明确要求“模拟用户进行操作测试”，当前这部分仍为空白。

- [x] 为 P0/P1 的删减项补最少量回归测试，只验证新规则，不再验证被删除的 fallback 行为。
  Reason: 测试应该保护简化后的明确规则，而不是继续保护历史兼容层。

## Suggested Execution Order

- [x] 第一步：先删 CloudKit 和 store 的隐藏恢复/fallback
- [x] 第二步：删 proxy runtime 的隐式兼容改写
- [x] 第三步：收缩协议层和 `AppContainer` 依赖装配
- [x] 第四步：拆三个超大文件
- [x] 第五步：补用户流 smoke test
- [x] 第六步：清理历史兼容测试和无用资源告警

## Exit Criteria

- [x] 不再出现“数据坏了但框架帮你悄悄修”
- [x] 不再出现“请求不兼容但运行时帮你悄悄改”
- [x] 核心依赖关系能在 `AppContainer` 一眼看懂
- [x] 主要大文件降到可单次审阅的规模
- [x] 至少有一条可重复执行的用户操作级测试路径
