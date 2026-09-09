# 实施手册：Bench Capability Host（MCP + 浏览器扩展）

> 日期：2026-09-09
> 定位：**可执行的实施手册**，不是可行性分析。前置阅读：`docs/browser-extension-export-research.md`、`docs/extension-targets-roadmap.md`
> 目标：把 MCP Server 与浏览器扩展作为同一条技术主线落地，共享一个能力内核。
>
> **落地状态（2026-09-09 第一轮实现完成）**：M0/M1/M2 已交付并验证（见下文
> 「实现偏差」），M3 浏览器扩展 MVP 已交付（bench-companion，vanilla MV3），
> M4 sidecar 构建脚本已接入。剩余项：photo-triage 完整 UI 的扩展内复刻、
> `serve` 模式（图片字节流）、CWS 上架、rmcp 迁移。

---

## 0. 定案架构（先看这个）

### 0.1 一个 Rust 二进制，四种角色

调研中的关键发现改变了架构选择：**MCP 官方 Rust SDK `rmcp` 已于 2026-08-21 从 Tier 2 晋升为 Tier 1**（与 TypeScript / Python / C# / Go 同级，一致性测试 server 67/67、client 50/50），当前版本 3.1.2，实现 MCP `2026-07-28` 规范。

既然 Bench 本体就是 Rust/Tauri，**没有理由再引入 Node 运行时**。定案：

```
                      ┌───────────────────────────────┐
                      │   bench-capabilities (crate)   │  ← 纯业务逻辑，无协议
                      │   唯一事实来源，零重复代码       │
                      └───────────────────────────────┘
                          ▲                       ▲
                          │                       │
              ┌───────────┴─────────┐   ┌─────────┴──────────┐
              │  src-tauri (Bench)  │   │   bench-host (bin)  │
              │  Tauri commands     │   │   协议层            │
              └─────────────────────┘   └─────────────────────┘
                                            │
                        ┌───────────────────┼───────────────────┐
                        │                   │                   │
                  --mode mcp          --mode native        --mode cli
                        │                   │                   │
                  AI 客户端            浏览器扩展             终端 / 脚本
```

`bench-host` 单二进制，按 `argv` 切换角色：

| 模式 | 调用方 | 传输 | 协议 |
| --- | --- | --- | --- |
| `mcp` | Claude / Cursor / ChatGPT / Copilot | stdio | MCP JSON-RPC 2.0（rmcp） |
| `native` | Chrome / Edge / Firefox 扩展 | stdio | Native Messaging（4 字节长度前缀 + JSON） |
| `serve` | 浏览器扩展（大图字节流旁路） | 本地 HTTP | 自定义 + PNA 响应头 |
| `cli` | 终端 / Raycast / 快捷指令 | argv | `--json` 输出 |

**收益：** 一个二进制、一份能力实现、四条分发通道。同时它可作为 **Tauri sidecar** 打包进 Bench（Tauri v2 `bundle.externalBin`）。

### 0.2 为什么先做 MCP（不只是技术原因）

浏览器扩展的安装必须用户手动操作（开开发者模式、加载已解压目录），**无法自动化**。

MCP 完全不同——它的"安装"就是**写一个 JSON 配置文件**：

```json
{
  "mcpServers": {
    "bench": {
      "command": "/Applications/Bench.app/Contents/MacOS/bench-host",
      "args": ["mcp"]
    }
  }
}
```

这意味着 Bench 可以提供**真正的一键安装**：检测已装 AI 客户端 → 写入配置 → 提示重启。**这是 MCP 相对浏览器扩展的决定性体验优势**，也是把它排在第一位的理由。

---

## 1. 仓库与目录结构

在 Bench 主仓库（当前 macOS 侧）改造为 Cargo workspace：

```
bench/
├── Cargo.toml                      # workspace
├── crates/
│   ├── bench-capabilities/         # ⭐ 新增：能力内核，无协议、无 GUI
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── error.rs            # 统一错误类型（协议层映射用）
│   │       ├── photo_triage/{mod,scan,trash,proxy}.rs
│   │       ├── terminology/{mod,repo,search}.rs
│   │       ├── hardware/{mod,query}.rs
│   │       └── clean_space/{mod,scan,cleanup}.rs
│   └── bench-host/                 # ⭐ 新增：协议层二进制
│       ├── Cargo.toml
│       └── src/
│           ├── main.rs             # 模式分发
│           ├── mcp/                # rmcp 实现
│           │   ├── mod.rs
│           │   └── tools/{photo_triage,terminology,hardware,clean_space}.rs
│           ├── native/             # Native Messaging
│           │   ├── mod.rs
│           │   └── framing.rs      # 4 字节长度前缀读写
│           ├── serve/              # 本地 HTTP（图片字节流）
│           └── cli/
├── src-tauri/                      # 现有：Tauri 命令层改为调用 bench-capabilities
│   ├── binaries/                   # sidecar 产物（target triple 后缀）
│   │   ├── bench-host-aarch64-apple-darwin
│   │   └── bench-host-x86_64-apple-darwin
│   ├── capabilities/default.json
│   └── tauri.conf.json
├── extensions/                     # 现有插件源码（UI 层）
└── platforms/
    └── browser/                    # ⭐ 新增：WXT 工程
        ├── wxt.config.ts
        ├── entrypoints/
        │   ├── background.ts
        │   ├── offscreen.html
        │   └── tab/index.html      # photo-triage 需要大画布
        └── src/runtime/{native,fsa}.ts
```

### 1.1 Workspace 声明

```toml
# Cargo.toml
[workspace]
members = ["crates/bench-capabilities", "crates/bench-host"]
resolver = "2"

[workspace.dependencies]
bench-capabilities = { path = "crates/bench-capabilities" }
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
schemars = "1"
rmcp = { version = "3", features = ["server", "macros"] }
```

### 1.2 `bench-host/Cargo.toml`

```toml
[package]
name = "bench-host"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "bench-host"
path = "src/main.rs"

[dependencies]
bench-capabilities = { workspace = true }
tokio = { workspace = true }
serde = { workspace = true }
serde_json = "1"
schemars = { workspace = true }
rmcp = { workspace = true }
clap = { version = "4", features = ["derive"] }
axum = "0.8"          # serve 模式
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
```

---

## 2. 阶段 0：抽取能力内核（M0）

**这是全部工作的地基，必须先做。** 目标：`bench-capabilities` 不依赖 Tauri、不依赖任何协议、可在 `cargo test` 下独立测试。

### 2.1 错误类型统一

```rust
// crates/bench-capabilities/src/error.rs
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CapError {
    #[error("路径不在允许范围内: {0}")]
    PathNotAllowed(String),
    #[error("资源不存在: {0}")]
    NotFound(String),
    #[error("平台不支持: 需要 {required}，当前 {current}")]
    UnsupportedPlatform { required: &'static str, current: &'static str },
    #[error("操作被拒绝: {0}")]
    Denied(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type CapResult<T> = Result<T, CapError>;
```

### 2.2 能力 trait（供协议层统一路由）

```rust
// crates/bench-capabilities/src/lib.rs
pub mod error;
pub mod photo_triage;
pub mod terminology;
pub mod hardware;
pub mod clean_space;

use serde::{Deserialize, Serialize};

/// 每个插件暴露的能力清单，协议层据此生成 MCP tools / NM 命令白名单
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilitySpec {
    pub plugin: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub params_schema: serde_json::Value,
    /// 是否有副作用（写/删除）。协议层据此决定是否要求二次确认
    pub destructive: bool,
    /// 纯浏览器环境下是否可用
    pub browser_native: bool,
}

pub fn all_specs() -> Vec<CapabilitySpec> { /* 各模块拼接 */ }
```

> **设计要点：** `CapabilitySpec` 是 MCP tools 与浏览器扩展命令白名单的**共同数据源**。加一个能力，两个宿主同时获得，无需改两处代码。

### 2.3 迁移步骤

1. 从 `src-tauri/src/**` 中识别现有 photo-triage / clean-space 的业务逻辑（扫描、配对、清理记录等）；
2. 逐个函数迁移到 `bench-capabilities`，**签名从「Tauri 命令」改为「普通 async fn」**，去掉 `AppHandle` 等 Tauri 依赖；
3. `src-tauri` 侧改为薄壳调用：

```rust
// src-tauri/src/commands/photo_triage.rs（改造后）
#[tauri::command]
pub async fn photo_triage_scan(path: String) -> Result<ScanResult, String> {
    bench_capabilities::photo_triage::scan(&path)
        .await
        .map_err(|e| e.to_string())
}
```

4. **验收：** `cargo test -p bench-capabilities` 全绿，且 `cargo tree -p bench-capabilities` 中不应出现 `tauri`。

**估算：3–5 pd**（视现有 Rust 侧代码耦合度，可能上浮）。

---

## 3. 阶段 1：bench-host 二进制骨架（M1）

### 3.1 main.rs

```rust
// crates/bench-host/src/main.rs
mod cli;
mod mcp;
mod native;
mod serve;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "bench-host", about = "Bench capability host")]
struct Cli {
    #[command(subcommand)]
    mode: Mode,
    /// 允许访问的根目录白名单（安全边界，可重复）
    #[arg(long = "allow-root", global = true)]
    allow_roots: Vec<String>,
}

#[derive(Subcommand)]
enum Mode {
    /// MCP stdio server（AI 客户端）
    Mcp,
    /// Chrome/Edge/Firefox Native Messaging host
    Native,
    /// 本地 HTTP 服务（图片字节流旁路）
    Serve { #[arg(long, default_value_t = 0)] port: u16 },
    /// 命令行模式
    Cli(cli::CliArgs),
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // ⚠️ 铁律：日志必须写 stderr。stdout 是协议通道，任何杂散输出都会破坏解析
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cli = Cli::parse();
    let guard = bench_capabilities::Guard::new(cli.allow_roots)?;

    match cli.mode {
        Mode::Mcp => mcp::run(guard).await?,
        Mode::Native => native::run(guard).await?,
        Mode::Serve { port } => serve::run(guard, port).await?,
        Mode::Cli(args) => cli::run(guard, args).await?,
    }
    Ok(())
}
```

> **最容易踩的坑：** MCP 与 Native Messaging 都用 stdio 作为协议通道。`println!`、`dbg!`、任何库打到 stdout 的日志都会导致**协议解析失败且错误信息极难排查**。必须在 CI 里加一个冒烟测试：启动 `--mode mcp`，断言 stdout 的第一条消息是合法 JSON-RPC。

### 3.2 Native Messaging 帧编解码

协议极简，手写即可，无需依赖：

```rust
// crates/bench-host/src/native/framing.rs
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub async fn read_msg<R: AsyncRead + Unpin>(r: &mut R) -> std::io::Result<Option<serde_json::Value>> {
    let mut len_buf = [0u8; 4];
    match r.read_exact(&mut len_buf).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let len = u32::from_ne_bytes(len_buf) as usize;   // 本机字节序
    if len > 64 * 1024 * 1024 {                       // 浏览器→host 上限
        return Err(std::io::Error::other("message too large"));
    }
    let mut body = vec![0u8; len];
    r.read_exact(&mut body).await?;
    Ok(Some(serde_json::from_slice(&body)?))
}

pub async fn write_msg<W: AsyncWrite + Unpin>(w: &mut W, v: &serde_json::Value) -> std::io::Result<()> {
    let body = serde_json::to_vec(v)?;
    // ⚠️ host→浏览器单条上限 1 MB，超限必须分片或改走 serve 模式
    if body.len() > 1024 * 1024 {
        return Err(std::io::Error::other("response exceeds 1MB, use serve mode"));
    }
    w.write_all(&(body.len() as u32).to_ne_bytes()).await?;
    w.write_all(&body).await?;
    w.flush().await
}
```

### 3.3 Host manifest（由 Bench 在导出时写入）

```json
{
  "name": "com.kindred.bench",
  "description": "Bench capability bridge",
  "path": "/Applications/Bench.app/Contents/MacOS/bench-host",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://<32位扩展ID>/"]
}
```

写入位置见 `docs/browser-extension-export-research.md` 第 2.1 节。**注意 `path` 必须是绝对路径**（macOS/Linux 要求）。Bench 需要在导出时把 `--mode native` 通过 wrapper 脚本传进去，因为 Native Messaging 不会带参数：

```sh
#!/bin/sh
# ~/Library/Application Support/Bench/bench-host-nm.sh
exec /Applications/Bench.app/Contents/MacOS/bench-host --mode native "$@"
```

**估算：2–3 pd**

---

## 4. 阶段 2：MCP Server（M2）

### 4.1 tools 设计（首批）

按「AI 客户端真的会用」筛选，不要把所有命令都暴露成 tool——工具越多，模型选错的概率越高。

| tool | 插件 | 副作用 | 说明 |
| --- | --- | --- | --- |
| `terminology_search` | terminology | 无 | 按关键词检索术语，返回层级路径 + 释义 ⭐ 最高价值 |
| `terminology_list_industries` | terminology | 无 | 列出行业/分类树 |
| `hardware_query` | hardware | 无 | 按型号/品类查参数 |
| `hardware_compare` | hardware | 无 | 多型号参数对比 |
| `storage_scan` | clean-space | 无 | 扫描存储占用，返回分类汇总 |
| `storage_list_items` | clean-space | 无 | 列出某分类下的大文件/目录 |
| `dev_projects_scan` | clean-space | 无 | 扫描开发项目缓存 |
| `photo_triage_list_recent` | photo-triage | 无 | 列出最近相册与统计 |
| `photo_triage_export_selection` | photo-triage | **写文件** | 导出「留/删」清单 JSON |
| ~~`*_trash` / `*_delete` / `*_cleanup`~~ | — | **删除** | **不暴露为 tool** |

> **重要设计决策：不提供任何删除类 tool。**
> 理由是 MCP 生态的安全现状——2026 年 1–2 月两个月内出现 30+ 个 MCP 相关 CVE，独立评估中仅 12.9% 的服务器评为"高信任"，且 prompt injection 可诱导 agent 调用危险工具。删除操作一律保留在 Bench 的 GUI 内（有预览、有确认、可撤销）。
> 若确有需求，只能提供 `*_preview`（返回"将释放 X GB、涉及 N 项"，不执行），并在描述中明确写「此工具不会删除任何内容，请在 Bench 应用中执行」。

### 4.2 rmcp 实现骨架

```rust
// crates/bench-host/src/mcp/mod.rs
use rmcp::{
    handler::server::wrapper::Parameters, schemars, tool, tool_router,
    transport::stdio, ServiceExt, ServerHandler,
};
use bench_capabilities::Guard;

#[derive(Clone)]
pub struct BenchHost {
    guard: Guard,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct TermSearchParams {
    /// 搜索关键词
    query: String,
    /// 限定行业（可选）
    #[serde(default)]
    industry: Option<String>,
    #[serde(default = "default_limit")]
    limit: usize,
}
fn default_limit() -> usize { 20 }

#[tool_router]
impl BenchHost {
    #[tool(description = "在术语库中检索术语，返回术语名、所属层级与释义。用于确保文档与代码中的术语用法与团队术语表一致。")]
    async fn terminology_search(
        &self,
        Parameters(p): Parameters<TermSearchParams>,
    ) -> Result<rmcp::model::CallToolResult, rmcp::Error> {
        let hits = bench_capabilities::terminology::search(&p.query, p.industry.as_deref(), p.limit)
            .await
            .map_err(|e| rmcp::Error::internal_error(e.to_string(), None))?;
        Ok(rmcp::model::CallToolResult::structured(hits))
    }

    #[tool(description = "扫描磁盘存储占用，按分类返回占用大小与占比。只读，不会删除任何文件。")]
    async fn storage_scan(&self) -> Result<rmcp::model::CallToolResult, rmcp::Error> {
        let summary = bench_capabilities::clean_space::scan_overview()
            .await
            .map_err(|e| rmcp::Error::internal_error(e.to_string(), None))?;
        Ok(rmcp::model::CallToolResult::structured(summary))
    }
}

pub async fn run(guard: Guard) -> anyhow::Result<()> {
    let service = BenchHost { guard }
        .serve(stdio())
        .await?
        .waiting()
        .await?;
    Ok(())
}
```

> `#[tool]` 的描述文字是**模型判断何时调用的唯一依据**，必须写清楚用途与适用/不适用场景。这比代码质量更影响实际效果。

### 4.3 客户端配置与自动安装

**常见配置路径（需实测确认，各客户端版本会变）：**

| 客户端 | 配置位置 |
| --- | --- |
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Code | `~/.claude.json`（或 `claude mcp add bench -- <path> --mode mcp`） |
| Cursor | 全局 `~/.cursor/mcp.json`，项目级 `<project>/.cursor/mcp.json` |
| VS Code / Copilot | `<project>/.vscode/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |

**Bench 侧「一键接入」实现要点：**

1. 检测：按上表探测文件/目录是否存在，列出已安装的客户端；
2. 写入：**保留已有内容做深合并**，只插入 `mcpServers.bench` 键——直接覆盖会毁掉用户其他 MCP 配置，这是最常见的破坏性 bug；
3. 备份：写入前把原文件复制为 `*.bench-backup-<timestamp>`；
4. 校验：写完后 `serde_json::from_str` 反序列化验证，失败则回滚；
5. 提示：「已写入配置，请重启 XXX 生效」。

```rust
// src-tauri/src/mcp_install.rs（骨架）
fn install_to(path: &Path, bin: &Path) -> anyhow::Result<()> {
    let mut cfg: serde_json::Value = if path.exists() {
        serde_json::from_str(&fs::read_to_string(path)?)?
    } else {
        json!({})
    };
    // 深合并，不动其他 key
    cfg["mcpServers"]["bench"] = json!({
        "command": bin,
        "args": ["mcp"]
    });
    let backup = path.with_extension("bench-backup");
    fs::copy(path, &backup).ok();
    fs::write(path, serde_json::to_string_pretty(&cfg)?)?;
    Ok(())
}
```

### 4.4 测试

```bash
# 1. 冒烟：stdout 首条必须是合法 JSON-RPC
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | bench-host --mode mcp | jq .

# 2. 用 MCP Inspector 交互式验证
npx @modelcontextprotocol/inspector bench-host --mode mcp

# 3. 接入真实客户端验证端到端（Claude Code）
claude mcp add bench -- /Applications/Bench.app/Contents/MacOS/bench-host --mode mcp
```

**估算：3–4 pd**

---

## 5. 阶段 3：浏览器扩展（M3）

完整背景见 `docs/browser-extension-export-research.md`，此处只给可执行部分。

### 5.1 工程初始化

```bash
cd platforms/browser
pnpm dlx wxt@latest init --template react
pnpm add @wxt-dev/module-react webextension-polyfill
```

```jsonc
// package.json scripts
{
  "dev": "wxt",
  "dev:firefox": "wxt -b firefox --mv3",
  "build": "wxt build",
  "build:firefox": "wxt build -b firefox --mv3",
  "zip": "wxt zip",
  "compile": "tsc --noEmit",
  "postinstall": "wxt prepare"
}
```

产物：`.output/chrome-mv3/`、`.output/firefox-mv3/`。打包：`wxt zip -b chrome`。

### 5.2 wxt.config.ts

```ts
import { defineConfig } from "wxt"

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  // ⚠️ 锁定扩展 ID：未上架扩展的 ID 由内容哈希决定，每次改动都会变，
  // 会导致 Native Messaging 的 allowed_origins 失效。必须写死 key。
  // key 由 Bench 导出器注入（见 5.5）
  manifest: ({ browser }) => ({
    key: process.env.BENCH_EXT_KEY,
    permissions: browser === "chrome" ? ["nativeMessaging", "storage"] : ["nativeMessaging", "storage"],
    host_permissions: ["http://127.0.0.1:*/*"],   // 仅 serve 模式需要
    action: { default_title: "Bench" },
    background: { service_worker: "background.ts", type: "module" },
    // Safari / Firefox 不需要 sidePanel，用 browser_specific_settings 区分
  }),
  vite: () => ({
    plugins: [/* tailwindcss() */],
  }),
})
```

### 5.3 后台：Native Messaging 连接管理

```ts
// entrypoints/background.ts
export default defineBackground(() => {
  let port: browser.runtime.Port | null = null

  function connect() {
    try {
      port = browser.runtime.connectNative("com.kindred.bench")
      port.onMessage.addListener(handleHostMessage)
      port.onDisconnect.addListener(() => {
        const err = browser.runtime.lastError
        // 常见失败：host 未注册 / allowed_origins 不匹配 / Bench 未安装
        console.warn("[bench] native host disconnected", err?.message)
        port = null
      })
    } catch (e) {
      console.warn("[bench] native host unavailable, fallback to FSA mode", e)
    }
  }

  // 能力探测：扩展 ↔ 页面握手，决定走 native 还是 fsa
  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "bench:capabilities") {
      sendResponse({ mode: port ? "native" : "fsa", degraded: port ? [] : DEGRADED_COMMANDS })
      return true
    }
    if (msg.type === "bench:invoke" && port) {
      port.postMessage({ id: msg.id, cmd: msg.cmd, params: msg.params })
      return true
    }
  })

  connect()
})
```

**注意（WXT 硬性规则）：** 任何 `browser.*` / `chrome.*` 调用**必须写在 `main()` 内部**。WXT 在构建时会在 Node 环境导入入口文件，顶层调用会直接报错。

### 5.4 前端 RuntimeAdapter

```ts
// src/runtime/index.ts
export type Mode = "native" | "fsa"

export interface Runtime {
  mode: Mode
  invoke<T>(cmd: string, params?: unknown): Promise<T>
  capabilities(): Promise<string[]>
}

// src/runtime/native.ts —— 经 background 中转
export const nativeRuntime: Runtime = {
  mode: "native",
  invoke: (cmd, params) =>
    browser.runtime.sendMessage({ type: "bench:invoke", cmd, params }),
  capabilities: () => browser.runtime.sendMessage({ type: "bench:capabilities" }),
}

// src/runtime/fsa.ts —— 降级实现，见调研文档 R5：删除必须默认禁用
export const fsaRuntime: Runtime = { /* ... */ }
```

现有 `extensions/photo-triage/src/services/*` 替换为注入的 `Runtime`，`use-cases.ts` 与 `hooks/` 保持不变。

### 5.5 导出器（Bench 侧）

`scripts/export-browser-extension.mjs` 的职责：

1. 读 `extensions/<id>/manifest.json` 的 `browser` 段；
2. `wxt build` → 注入 `BENCH_EXT_KEY`；
3. 解压产物到 `~/Library/Application Support/Bench/browser-extensions/<id>/`；
4. 生成 Native Messaging Host manifest，填入实际扩展 ID，写入各浏览器目录；
5. 检测已安装浏览器（macOS 读 `/Applications/*.app/Contents/Info.plist` 的 `CFBundleShortVersionString`）；
6. 输出引导浮层所需的 JSON（浏览器列表、目标路径、步骤文案）。

**估算：8–12 pd**（含降级模式）

---

## 6. 阶段 4：打包与分发（M4）

### 6.1 作为 Tauri sidecar 打包

1. 构建各平台二进制并按 target triple 命名：

```bash
rustc --print host-tuple   # 例如 aarch64-apple-darwin
cargo build --release -p bench-host
cp target/release/bench-host src-tauri/binaries/bench-host-aarch64-apple-darwin
```

2. 声明：

```jsonc
// src-tauri/tauri.conf.json
{ "bundle": { "externalBin": ["binaries/bench-host"] } }
```

3. 权限：

```jsonc
// src-tauri/capabilities/default.json
{
  "permissions": [
    "core:default",
    {
      "identifier": "shell:allow-execute",
      "allow": [{ "name": "binaries/bench-host", "sidecar": true }]
    }
  ]
}
```

4. 从 Rust 启动（供 MCP / serve 模式常驻）：

```rust
use tauri_plugin_shell::{ShellExt, process::CommandEvent};

let (mut rx, child) = app.shell()
    .sidecar("bench-host")?
    .args(["--mode", "serve"])
    .spawn()?;
// ⚠️ 务必保存 CommandChild 句柄，用于退出时 kill
```

> **sidecar 可靠性经验：** `spawn()` 成功 ≠ 进程真的在工作。应做健康检查（如轮询 `/healthz`，3s→6s→12s→24s 退避），30 秒内无响应则置为 Error 态，不要向用户谎报"已连接"。

### 6.2 分发清单

| 产物 | 命令 | 用途 |
| --- | --- | --- |
| MCP Server | 随 Bench 打包（sidecar）+ 一键写配置 | AI 客户端 |
| 浏览器扩展（解压目录） | `wxt build` | chrome://extensions 加载 |
| 浏览器扩展（zip） | `wxt zip -b chrome` | CWS 上传 |
| Firefox xpi | `wxt build -b firefox --mv3` + `web-ext sign` | AMO / 自分发 |

### 6.3 CI 建议

```yaml
# .github/workflows/host.yml（要点）
- run: cargo test -p bench-capabilities
- run: cargo build --release -p bench-host --target ${{ matrix.target }}
- run: pnpm --filter browser run build
- run: pnpm --filter browser run zip
- uses: actions/upload-artifact@v4   # 产物归档
```

**冒烟测试（必须进 CI）：**

```bash
# stdout 纯净性：MCP 模式下 stdout 只能有 JSON-RPC
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | ./bench-host --mode mcp | jq -e '.result.tools | length > 0'
# Native Messaging 帧往返
printf '\x0b\x00\x00\x00{"cmd":"ping"}' | ./bench-host --mode native | xxd | head -2
```

**估算：2–3 pd**

---

## 7. 任务清单

### M0 · 能力内核（3–5 pd）
- [ ] 建 workspace，新增 `crates/bench-capabilities`
- [ ] 定义 `CapError` / `CapResult` / `CapabilitySpec`
- [ ] 迁移 photo-triage 逻辑（扫描、配对、代理图、清单维护）
- [ ] 迁移 terminology / hardware / clean-space
- [ ] `src-tauri` 命令层改为薄壳调用
- [ ] 验收：`cargo test -p bench-capabilities` 通过且依赖树无 tauri

### M1 · bench-host 骨架（2–3 pd）
- [ ] clap 模式分发 + stderr 日志
- [ ] `native/framing.rs` 帧编解码 + 单测（含 1MB 上限、超大消息拒绝）
- [ ] 路径白名单 `Guard`
- [ ] CI 冒烟：stdout 纯净性断言

### M2 · MCP（3–4 pd）
- [ ] 集成 rmcp 3.x，`#[tool_router]` 声明首批 tools（见 4.1，不含删除类）
- [ ] MCP Inspector 验证
- [ ] Bench 内「一键接入」：探测客户端 → 深合并写配置 → 备份 → 校验回滚
- [ ] 真实客户端端到端验证（Claude Code / Cursor 各一次）

### M3 · 浏览器扩展（8–12 pd）
- [ ] WXT 工程 + React + Tailwind（注意 CSP：禁运行时样式注入）
- [ ] background：connectNative 生命周期 + 断连重连
- [ ] RuntimeAdapter：native / fsa 双实现
- [ ] photo-triage 页面接入，降级能力置灰
- [ ] 导出器：key 注入 → 构建 → 解压 → 写 Host manifest → 浏览器探测
- [ ] Bench 内引导浮层

### M4 · 打包与分发（2–3 pd）
- [ ] sidecar 多架构构建与命名
- [ ] `externalBin` + capabilities 权限配置
- [ ] 进程健康检查与退出清理
- [ ] CI 构建与冒烟

**合计：约 18–27 pd**（不含浏览器扩展上架审核等待）

---

## 8. 验收标准

| 项目 | 标准 |
| --- | --- |
| 能力内核 | `cargo test -p bench-capabilities` 全绿；依赖树无 tauri；新增一个能力后 MCP 与浏览器扩展同时可见 |
| MCP | `tools/list` 返回预期工具集；stdout 无任何非 JSON-RPC 输出；一键接入后重启客户端即可调用 |
| 安全 | 无删除类 tool；所有路径参数经过白名单校验；tool 输出不回显用户主目录绝对路径 |
| 浏览器扩展 | Native 模式下与 Bench 端行为一致；Bench 未运行时自动降级且删除类功能置灰 |
| sidecar | Bench 退出时 host 进程被回收，无孤儿进程 |

---

## 8+. 实现偏差记录（2026-09-09 第一轮）

实际实现与手册的差异（原因均为「编译速度 / 依赖面 / 契约系统成本」，行为与手册一致）：

| 手册原案 | 实际实现 | 原因 |
| --- | --- | --- |
| `bench-host` 用 clap 解析 argv | 手写 argv 解析 | 模式仅 4 个，零依赖（对齐 scripts 零依赖哲学） |
| MCP 用 rmcp 3.x | 手写 newline-delimited JSON-RPC 2.0 子集（initialize/tools/list/tools/call/ping） | rmcp 拉入 200+ 依赖；子集 ~150 行且可测，迁移路径保留 |
| tokio async | 全同步 stdio | 两种协议均为行/帧阻塞读写，无需 runtime |
| MCP tools 含 `clean_space_scan_custom_folder` 等 6 个只读 tool | 同左，另加 `terminology_stats`；**删除类零暴露**（dispatcher 单测红线） | 一致 |
| WXT 构建 bench-companion | 手写 vanilla MV3（零构建链） | 首个 MVP 优先证明通路；React UI 复刻列入下一轮 |
| 导出器读磁盘模板目录 | 模板 `include_str!/include_bytes!` 编译期嵌入 | 消除运行时资源路径解析问题 |
| terminology 复用 Rust 逻辑 | host 侧只读 JSON store reader（`terminology-store.json`，camelCase schema 兼容） | 原 storage.rs 强耦合 tauri-plugin-store；只读场景直接读文件更稳 |

已验证（本机）：

- `cargo test -p bench-capabilities -p bench-host`（22 通过）+ 主 crate 467 测试零回归；
- MCP 会话（initialize → tools/list → tools/call 术语搜索，真实 store 8049 条）；
- NM 帧往返：ping / 白名单拒绝（PATH_NOT_ALLOWED）/ 相册扫描 → 摘要统计；
- guard 回归：`/var` → `/private/var` 符号链接 + 未创建目录误拒已修复并加测试；
- sidecar：`node scripts/plugins/build-bench-host.mjs` 产出
  `src-tauri/binaries/bench-host-aarch64-apple-darwin`，`tauri.conf.json`
  externalBin + beforeBuildCommand 已接入。

## 9. 风险与开放问题

| # | 事项 | 处理 |
| --- | --- | --- |
| R1 | `rmcp` 3.x 仍较新，API 有变动（有 3.0 → 3.x 迁移指南） | 锁定版本；升级前看 migration guide |
| R2 | sidecar 二进制体积与多架构构建复杂度 | 先用当前平台（aarch64-apple-darwin），Windows 支持时再补 |
| R3 | MCP 客户端配置路径随版本变化 | 做「自动探测 + 手动指定路径」双通道；写入前备份 |
| R4 | 扩展 ID 漂移导致 Native Messaging 断连 | 固定 `key` + 导出时重写 Host manifest + 扩展内连通性自检 |
| R5 | 浏览器扩展安装无法自动化 | 见 0.2 节：MCP 先行，扩展用引导式安装 + 后续上架 |
| R6 | Chrome LNA 收紧影响 serve 模式 | 主通道走 Native Messaging，serve 只做图片旁路且可降级为 base64 |
| Q1 | `bench-capabilities` 现有代码耦合度未知，M0 估算可能偏低 | 开工前先花 0.5 pd 做代码勘察，再校准估算 |
| Q2 | 是否需要为 Bench GUI 与 host 之间的并发访问加锁（如同时扫描同一目录） | M0 阶段明确：建议 host 侧加进程内任务锁，跨进程冲突用文件锁兜底 |

---

## 附录：关键参考资料

- rmcp（MCP 官方 Rust SDK，Tier 1，v3.1.2）：https://github.com/modelcontextprotocol/rust-sdk
- MCP Rust SDK 晋升 Tier 1 与一致性说明：https://www.digitalapplied.com/blog/mcp-sdk-conformance-tiers-what-tier-1-means
- MCP 规范（2026-07-28）：https://modelcontextprotocol.io/specification/2026-07-28
- Tauri v2 Sidecar：https://tauri.app/develop/sidecar
- Tauri v2 sidecar 实战经验（命名/生命周期/自更新）：https://dev.to/chenxxpro/bundling-a-cli-binary-as-a-tauri-v2-sidecar-lessons-from-building-a-desktop-app-5po
- WXT 构建目标与命令：https://wxt.dev/guide/build-targets
- WXT 目录结构：https://wxt.dev/guide/directory-structure/wxt
- 本仓库：`docs/browser-extension-export-research.md`、`docs/extension-targets-roadmap.md`
