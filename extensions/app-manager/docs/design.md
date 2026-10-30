# App Manager 技术设计

> 状态：核心代码整改完成；Windows/macOS 真机 smoke 仍是发布前置条件。
> 目标平台：macOS、Windows。

## 1. 模块边界

- 插件前端：[extensions/app-manager/src/](../src/)
- Bench 共享应用清单：[src/shared/app-inventory/](https://github.com/indredK/bench/tree/main/src/shared/app-inventory)
- Bench IPC 契约：[src/lib/tauri/contracts.ts](https://github.com/indredK/bench/blob/main/src/lib/tauri/contracts.ts) · [src/lib/tauri/commands/app-manager.ts](https://github.com/indredK/bench/blob/main/src/lib/tauri/commands/app-manager.ts)
- Bench 后端：[src-tauri/src/app_manager/](https://github.com/indredK/bench/tree/main/src-tauri/src/app_manager)

App Manager 后端 inventory 是应用清单唯一真理源。Quick Launch 只消费带 `revision` 的 snapshot，不维护第二套扫描流程。

## 2. 不可退化的约束

| 领域     | 强制约束                                                                                   |
| -------- | ------------------------------------------------------------------------------------------ |
| IPC      | 启动、定位、授权、升级、卸载只接收稳定 `appId`                                             |
| 来源识别 | 模糊匹配只用于展示；升级/卸载必须有 receipt、package ID 或 ProductCode 等 exact evidence   |
| 并发     | scan/check 使用 single-flight；共享结果带 revision，陈旧结果不得覆盖新状态                 |
| 更新检查 | provider 必须返回 `ok/partial/unsupported/failed`，失败不得显示为“全部最新”                |
| 原地更新 | renderer 只提交 `updateId + inventoryRevision`；URL、hash、签名和目标路径由后端缓存解析    |
| 安全     | 强制 HTTPS、签名或 SHA-512、bundle/team/架构/最低系统版本校验及下载/解压资源上限           |
| 任务     | 阻塞 I/O 进入 `spawn_blocking`；外部进程有 timeout、进程树回收和持久取消状态               |
| UX       | 首载使用 skeleton；刷新保留旧数据并显示真实或 indeterminate 进度；partial 提示不得挤压列表 |

## 3. 平台现状

| 功能      | macOS                                             | Windows                                       |
| --------- | ------------------------------------------------- | --------------------------------------------- |
| 应用发现  | Spotlight + 标准目录 + 用户目录 + 外置卷 fallback | Registry + Start Apps/AUMID + winget 记录     |
| 启动      | 后端解析 `.app`                                   | 后端解析 EXE/AUMID，不经过 `cmd /C start`     |
| 升级/卸载 | Homebrew exact artifact/receipt                   | winget exact ID；MSI 使用校验后的 ProductCode |
| 更新中心  | Homebrew、MAS、Sparkle、Electron/Squirrel         | winget provider；能力缺失显式返回 unsupported |
| 图标      | 按需提取并缓存                                    | EXE 图标提取，失败使用前端 fallback           |

以上是代码能力，不等于真机行为已通过。

## 3.1 私有 Swift 原生工具

- 「本地工具箱」与「ABB 开发工具箱」由 Bench 插件中心的原生应用市场管理，不属于 App Manager 推荐安装目录，也不作为 extension bundle 加载。
- App Manager 不请求或调用私有原生应用安装命令；两款 App 的市场入口、安装、启动与卸载由 Bench 宿主负责。
- 原生应用仍要求 Apple Silicon Mac、GitHub CLI 已登录到可读私有仓库及 Actions Artifacts 的账号。宿主固定仓库与 Artifact，只在当前 `main` SHA 与成功的 macOS CI run 完全一致时下载，并校验 run 元数据、分支、SHA、过期状态与 GitHub SHA-256 digest。
- Artifact ZIP 经路径、符号链接和展开体积检查后，宿主验证固定 Bundle ID、ad-hoc 代码签名结构和处理器兼容性；安装到 `~/Applications/Bench Apps/`，目标路径已占用或任一校验失败时拒绝安装。卸载时校验 Bundle ID 并将 `.app` 移入废纸篓，不删除应用数据；不会移除 quarantine、调用 Gatekeeper 放行命令或自动批准系统提示。
- CI 包保留 90 天；过期后可在 `main` 上手动运行 `verify.yml` 重新生成。个人本机安装无需付费 Apple Developer Program，也无需本机安装 Xcode / XcodeGen；所有用户仍需有私有仓库和 Actions 读取权限。Bench 不读取或保存 GitHub CLI 凭据。
- 本机 ad-hoc 签名下，macOS 可能在重新安装后要求用户再次授予辅助功能权限。
- 本机 ad-hoc 构建只供当前机器使用，不属于外部分发 Release。向没有私有仓库权限的用户分发仍需 Developer ID Application + Apple notarization，或满足 Apple 条件的组织费用豁免。
- 两款应用继续由各自 Swift / SwiftUI 工程维护；改动安装入口不要求迁移到 JavaScript、Rust 或其他语言。

## 4. 修改入口

| 需求                             | 修改位置                                                               |
| -------------------------------- | ---------------------------------------------------------------------- |
| 应用扫描/平台适配                | Bench `src-tauri/src/app_manager/{macos,windows}.rs`                   |
| 来源授权规则                     | Bench `src-tauri/src/app_manager/domain.rs`                            |
| scan/update single-flight 与缓存 | Bench `src-tauri/src/app_manager/state.rs`、`commands.rs`              |
| 更新下载与安装                   | Bench `src-tauri/src/app_manager/installer/`                           |
| 前端更新列表与状态               | `extensions/app-manager/src/hooks/`、`components/SoftwareUpdateView.tsx`|
| IPC DTO/命令                     | Bench 仓库 TS/Rust 两侧契约同时修改                                    |

修改后必须保留上述约束，并为 bug 增加最小回归测试。

## 5. 验证命令

```bash
pnpm run lint:fe
pnpm run test:critical
cargo test --manifest-path src-tauri/Cargo.toml app_manager
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
pnpm run check:docs
git diff --check
```

本机没有 Windows target 时，只能报告本地静态检查和单元测试结果，不能宣称 Windows 行为通过。

## 6. 禁止事项

- 不允许 renderer 提交路径、package ID、下载 URL 或 shell 参数作为最终执行依据。
- 不允许 heuristic 结果开启 upgrade/uninstall。
- 不允许 provider 失败降级为空数组成功。
- 不允许新增第二套 inventory store 或扫描 orchestration。
- 不允许跳过 revision、资源上限、签名身份和恢复边界。

## 7. 完成定义 (Definition of Done)

- macOS/Windows 应用发现、启动、更新和卸载均有目标平台行为测试。
- 错误、partial、unsupported、取消、空状态和刷新状态均有可见反馈。
- IPC 契约、i18n、前端关键测试、Rust 测试和 clippy 全部通过。
- 文档只描述已经实现且可验证的能力；未完成项保留在 `roadmap.md`。
