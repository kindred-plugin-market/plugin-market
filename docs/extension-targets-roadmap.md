# Bench 插件市场：能力外溢方向规划

> 日期：2026-09-09
> 姊妹篇：`docs/browser-extension-export-research.md`（浏览器扩展专项调研）
> 本文回答：除了浏览器插件，plugin-market 的能力还可以往哪些方向扩展？优先级如何排？

---

## 0. 先建立一个判断框架

当前插件的本质结构是两层：

```
┌─────────────────────────────────────────┐
│  View    React UI + i18n（平台无关）      │  ← 复用率高
├─────────────────────────────────────────┤
│  Capability  Tauri IPC → Rust 后端       │  ← 平台绑定，需替换
└─────────────────────────────────────────┘
```

因此「扩展」不是重写，而是**给同一套能力换宿主（Host）或换形态（Form）**。所有候选方向可以按三类归位：

| 类别 | 含义 | 候选 |
| --- | --- | --- |
| **A · 换宿主** | 装进别人已有的 GUI 宿主 | 浏览器扩展、VS Code / JetBrains、Raycast / Alfred、Obsidian、uTools |
| **B · 换形态** | 去掉 GUI，变成可被调用的东西 | CLI、MCP Server、npm SDK / 本地 API、Web App / PWA |
| **C · 换触达** | 深入操作系统 | Finder 扩展、Quick Look、Share Extension、快捷指令、菜单栏 |

评估时只用四个维度：**目标用户在不在那儿** / **Bench 现有资产能复用多少** / **分发摩擦多大** / **是否反哺 Bench 主产品**。

---

## 1. 核心洞察：先做「能力出口」，不要一个个做宿主

如果为每个宿主都单独写一遍适配，N 个宿主 = N 份成本。**正确做法是先建一个进程外的能力出口**，让所有宿主共享：

```
                    ┌──────────────────────────┐
                    │  Bench Capability Host    │
                    │  （独立进程，Rust/Node）    │
                    └──────────────────────────┘
                       ▲      ▲      ▲       ▲
        stdio(JSON-RPC)│      │stdio │  HTTP  │ IPC
                       │      │(NM)  │        │
              ┌────────┴┐ ┌───┴────┐ │  ┌─────┴─────┐
              │MCP Server│ │Browser │ │  │ CLI / SDK │
              └──────────┘ │Extension│ │  └───────────┘
                           └────────┘ │
                                      ▼
                              Web App / 本地 HTTP
```

**关键发现：MCP 的 stdio transport 与 Chrome Native Messaging 是同一形态**——都是「父进程启动子进程 + stdin/stdout + 长度前缀/行分隔 JSON + 能力清单（tools/list ↔ capabilities）」。

> 也就是说：浏览器扩展调研里要建的 Native Messaging Host，只要再包一层 MCP 的 JSON-RPC 语义（`tools/list`、`tools/call`），就同时得到了一个 MCP Server。**一次投入，两个宿主。**

这是本规划中**性价比最高的一步**，应作为所有外溢工作的起点。

---

## 2. 候选方向逐一评估

### 2.1 MCP Server ⭐⭐⭐⭐⭐（强烈建议，T0）

**是什么：** 把插件能力暴露为 MCP tools，让 Claude Desktop / Claude Code / Cursor / VS Code Copilot / ChatGPT / Gemini 等 AI 客户端直接调用。

**为什么现在是窗口期：**
- MCP 已于 2025-12 由 Anthropic 捐赠给 Linux Foundation 旗下的 Agentic AI Foundation，OpenAI / Google / Microsoft / AWS 共同背书，**已是中立标准而非某家私有协议**；
- 2026 年 ChatGPT、Claude、Gemini、Copilot、Cursor 等主流客户端原生支持；
- 官方 MCP Registry 在 2026-05 已有约 9,652 条服务器记录，独立普查统计超 17,000 个；TS/Python SDK 月下载量从 200 万增长到 2025-12 的 9,700 万；
- 本地 stdio 模式是 Claude / Cursor 的一等公民，**不需要任何云服务、不需要上架审核、不需要账号**。

**适配度：**

| 插件 | 作为 MCP tools 的价值 | 说明 |
| --- | --- | --- |
| **terminology** | ⭐⭐⭐⭐⭐ | `search_term` / `list_industries` / `add_term` —— 让 AI 在写代码、写文档时使用**你自己的术语表**，解决"AI 翻译腔/术语不一致"的真实痛点 |
| **hardware** | ⭐⭐⭐⭐⭐ | 纯查表，零副作用，`query_specs` / `compare_models` —— AI 回答硬件选型问题时的权威数据源 |
| **clean-space** | ⭐⭐⭐⭐ | `scan_storage` / `list_large_dirs` / `clean_dev_projects` —— 「帮我看看磁盘被什么吃了」是高频 AI 使用场景（**删除类 tool 必须加 confirm 语义**） |
| **photo-triage** | ⭐⭐ | 强交互、强视觉，与对话形态不匹配。仅适合暴露 `list_recent` / `export_selection` 这类查询 |

**成本：** 在完成 Native Messaging Host 的前提下，**边际约 2–4 人日**（协议适配 + tools 声明生成）。
**风险：** 生态安全口碑不佳——2026 年初两个月内出现 30+ 个 MCP 相关 CVE，独立评估中仅 12.9% 的服务器评为"高信任"。因此需要：路径白名单校验、删除类操作强制二次确认、不在 tool 输出里回显敏感绝对路径。

> **结论：这是当前投入产出比最高的方向，且与浏览器扩展工作高度复用。建议在 Native Messaging Host 落地时同步交付。**

---

### 2.2 Web App / PWA ⭐⭐⭐⭐（T0，成本最低）

**是什么：** 把插件直接部署为静态站点，浏览器打开即用。

**关键事实：** `hardware` 的 `acl.commands` 为空——**纯前端、零 IPC**，意味着它已经 100% 可以直接静态部署，**几乎零改造成本**。

| 插件 | 可行性 | 备注 |
| --- | --- | --- |
| hardware | ✅ 零成本 | 数据内嵌，直接 `vite build` 部署 |
| terminology | ✅ 低成本 | 数据层换 IndexedDB + 导入/导出 JSON |
| photo-triage | ⚠️ 中 | 需 File System Access API，仅 Chromium；能力降级同浏览器扩展的 B 路线 |
| clean-space | ❌ 不可行 | 强依赖 macOS 系统 API，无浏览器等价物 |

**收益：**
- 一个链接即可分享，零安装摩擦——**是获客与口碑传播最强的形态**；
- 可加 PWA manifest 实现「安装到桌面」，在 Chromium 上接近原生体验；
- 是 MCP / 浏览器扩展 / CLI 的现成演示页与文档站。

**成本：** hardware 约 0.5 人日；terminology 约 2–3 人日。
**风险：** 低。注意 PWA 在 Safari 上的能力限制（无 FSA）。

> **结论：先拿 hardware 做一个静态站点试水，成本可忽略，用于验证"插件能力独立可用"这件事的号召力。**

---

### 2.3 CLI ⭐⭐⭐⭐（T1，是所有自动化的底座）

**是什么：** `bench clean-space scan --json`、`bench terminology search "SSR"` 这类命令行。

**价值常被低估：**
- CLI 是 **MCP Server、CI 集成、脚本化、Alfred/Raycast 扩展的最小底座**——有 CLI 之后，上面那些方向的成本都会大幅下降；
- 用户画像（开发者）天然接受 CLI；
- `--json` 输出让它可以被任意管道消费；
- 可以复用 Tauri 后端的 Rust 代码，或做成 Rust binary / Node CLI 随 Bench 分发。

**成本：** 2–4 人日（命令注册 + 输出格式化 + 帮助文档）。
**风险：** 需要设计好输出契约（建议统一 `{ ok, data, error }` 信封 + `--json` / `--plain` 双模式），否则后续每个消费方都要写特化解析。

> **结论：不做 CLI，则 MCP 和 launcher 扩展都要各写一遍适配。它是被低估的杠杆点。**

---

### 2.4 VS Code / Cursor 扩展 ⭐⭐⭐（T1）

**适配度：**
- **terminology ⭐⭐⭐⭐⭐**：侧边栏术语树 + 选中文本右键「查术语」+ 补全建议——**这是术语库最自然的使用场景**，因为术语问题就发生在写代码/写文档的时刻；
- hardware ⭐⭐⭐：查参数，场景偏弱；
- clean-space / photo-triage ⭐：场景不匹配。

**成本：** 3–6 人日（TreeView / Webview + 命令注册 + 配置）。
**分发：** 免费；但**重要变更——Azure DevOps 的全局 PAT 将于 2026-12-01 退役**，之后发布必须改用 Microsoft Entra ID 的 workload identity federation + managed identity，CI 配置复杂度显著上升。**如果计划做，建议避开年底窗口，或直接一次性按新认证方式搭建。**
**收益：** VS Code 装机量巨大，且 terminology 的场景契合度是真的高。

---

### 2.5 Raycast / Alfred 扩展 ⭐⭐⭐（T2）

**Raycast 契合度意外的好：**
- **扩展用 React + TypeScript 编写**——与现有插件技术栈完全一致；
- 免费发布（PR 到 `raycast/extensions` 仓库），审核 3–7 个工作日，PR 14 天无响应标 stale、21 天关闭；
- macOS-only，与 Bench 当前「macOS 优先、Windows 后续」的节奏吻合；
- Raycast 支持 Script Commands——**如果已有 CLI，可以先用 Script Command 零成本试水，验证需求后再做正式扩展**。

**适配：** terminology（查词，⭐⭐⭐⭐⭐）、clean-space（快速扫描/清理，⭐⭐⭐⭐）、hardware（⭐⭐⭐）。
**风险：** 用户量受限于 Raycast 装机量；Raycast 明确会拒绝「与已有扩展或 Raycast 原生功能价值重叠」的提交，需先查重。

> **建议路径：有 CLI 之后 → 先发 Script Commands（近乎零成本）→ 有真实用量 → 再做正式扩展。**

---

### 2.6 Obsidian / uTools 等垂直宿主 ⭐⭐（T3，按需）

- **Obsidian**：terminology 做 Obsidian 插件（术语侧边栏 + 双链）契合度高，且 Obsidian 插件发布免费、社区活跃。属于「特定受众的高满意度」选项。
- **uTools**：国内插件式启动器，受众与分发生态与 Raycast 类似，中文用户触达更好，但生态规模与技术文档弱于 Raycast。
- **JetBrains**：与 VS Code 重叠，且用户群重叠度高，优先级应低于 VS Code。

---

### 2.7 macOS 系统集成 ⭐⭐（T3，慎选）

| 形态 | 适配 | 判断 |
| --- | --- | --- |
| **菜单栏 App（Menubar）** | clean-space（一键扫描/清理） | ⭐⭐⭐⭐ 相对低成本，Tauri 原生支持，可作为 Bench 的轻量常驻入口 |
| **Finder Sync Extension** | photo-triage | ⭐⭐ 需 Swift/ObjC + App 沙箱，成本高 |
| **Quick Look 预览扩展** | photo-triage | ⭐⭐ 同上 |
| **Share Extension / 快捷指令** | photo-triage、clean-space | ⭐⭐⭐ 快捷指令（Shortcuts）可通过 CLI 低成本接入，性价比优于原生扩展 |
| **Spotlight 索引** | terminology | ⭐⭐ 需系统级索引集成 |

> **判断：** 除「菜单栏 App」与「快捷指令（复用 CLI）」外，原生系统扩展都需要 Swift 能力与 App Store 级别的工程投入，**在 Bench 主产品站稳之前不建议**。

---

## 3. 还有一类：市场自身的平台化（不是新宿主，但可能更重要）

以上都在讨论「能力装到哪儿」。但 plugin-market 作为**市场**本身，还有一组独立方向：

| 方向 | 说明 | 价值 |
| --- | --- | --- |
| **开放第三方开发者** | 发布插件契约（extension-spec）公开文档 + 脚手架 CLI（`create-bench-extension`）+ 插件校验器（`bench ext lint`） | 从「自己的 4 个插件」变成「生态」。这是让市场有生命力的**唯一**路径 |
| **插件签名与信任体系** | 现有 `registry.json` 已有 sha256 与 `revoked` 字段，可升级为「作者签名 + 权限审计 + 评级」 | 为第三方开放做准备；当前 sha256 只能防传输损坏，不能防作者作恶 |
| **权限审计面板** | 现有 `acl.commands` 白名单已是很好的基础，可做成「安装前展示该插件会调用哪些命令」的用户可见界面 | 差异化信任卖点，尤其当插件与本地文件系统强相关时 |
| **云同步** | terminology 术语库、clean-space 清理记录的跨设备同步 | 提升留存，但引入服务端与隐私复杂度，需谨慎 |
| **插件间互操作** | 事件总线 / 跨插件 API（如 photo-triage 导出 → clean-space 消费） | 早期做会过度设计，建议等插件数 >10 再考虑 |

> **个人判断：** 如果 Bench 的目标不只是「一个工具」而是「一个平台」，**第三方开发者生态的优先级应当高于第 3 宿主**。4 个插件 × 5 个宿主，不如 40 个插件 × 2 个宿主。

---

## 4. 优先级矩阵

| 方向 | 用户在哪 | 资产复用 | 分发摩擦 | 反哺 Bench | 成本 | **建议** |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| **MCP Server** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 低 | **T0 · 立即做** |
| **Web / PWA（hardware）** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | 极低 | **T0 · 立即做** |
| **CLI** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 低 | **T1 · 底座，先做** |
| **浏览器扩展** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | 中高 | **T1**（已有专项调研） |
| **VS Code 扩展** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | 中 | **T1**（terminology 优先） |
| **Raycast（Script Command）** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ | 极低 | **T2 · CLI 之后顺手做** |
| **菜单栏 App** | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 中 | **T2** |
| **Obsidian / uTools** | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐ | 中 | **T3 · 按需** |
| **macOS 原生扩展** | ⭐⭐ | ⭐ | ⭐ | ⭐⭐ | 高 | **T3 · 暂缓** |
| **第三方开发者生态** | — | — | — | ⭐⭐⭐⭐⭐ | 高 | **战略项，需单独立项** |

---

## 5. 建议执行顺序

```
第 0 步：Bench Capability Host（进程外能力出口）
        └─ 输出：Native Messaging Host + MCP Server（同一进程，两套协议）
        └─ 成本：5–8 pd（MCP 部分边际 2–4 pd）
        └─ 收益：一次性解锁「浏览器扩展」+「所有 AI 客户端」两个宿主

第 1 步：CLI（有 Host 后成本极低）
        └─ 输出：bench <plugin> <command> [--json]
        └─ 成本：2–4 pd
        └─ 收益：解锁自动化、CI、Raycast Script Commands、快捷指令

第 2 步：Web / PWA（hardware 静态部署）
        └─ 成本：0.5–3 pd
        └─ 收益：零摩擦分享，验证「插件能力独立可用」的号召力

第 3 步：浏览器扩展（按专项调研的 M1–M3）
        └─ 成本：11–17 pd 到 P0 可用
        └─ 前提：第 0 步已完成

第 4 步：VS Code 扩展（terminology）
        └─ 成本：3–6 pd
        └─ 注意：2026-12 起发布认证方式变更

第 5 步：Raycast 正式扩展 / 菜单栏 App
        └─ 成本：3–5 pd
        └─ 前提：Script Command 版已有真实用量验证
```

---

## 6. 三个需要提前决定的问题

1. **Bench 的定位是「工具」还是「平台」？**
   这决定资源分配。若是平台，第三方开发者生态（签名、脚手架、公开 spec）应优先于第 3、4 个宿主。

2. **Windows 支持的时间点？**
   目前 clean-space 是 `platforms: ["macos"]`，Raycast 与 macOS 系统扩展都是 macOS-only。若 Windows 排期靠前，Raycast / 原生扩展的优先级应下调，Web / MCP / CLI（跨平台）应上调。

3. **是否接受"能力降级"的一致性成本？**
   一旦同一能力在不同宿主表现不同（如浏览器版没有系统废纸篓），支持成本与用户困惑会持续累积。建议明确一条原则：**降级必须显式告知，且不允许静默改变删除语义。**

---

## 7. 时效性提示（2026-09 核实）

- **VS Code 扩展发布**：Azure DevOps 全局 PAT 于 **2026-12-01 退役**，须改用 Microsoft Entra ID + workload identity federation / managed identity。现有基于 PAT 的 CI 需在年内迁移。
- **MCP**：2025-12 捐赠给 Linux Foundation 旗下 Agentic AI Foundation，已成为中立标准；2026 年主流 AI 客户端原生支持。规格持续演进（2025-11-25 周年版本、2026-07-28 版本）。
- **Raycast**：扩展须以 PR 提交至 `raycast/extensions`，审核约 3–7 个工作日；PR 14 天无响应标 stale、21 天关闭。
- **Chrome Web Store**：2026-07-01 公布、2026-08-01 执行的新政策收紧数据收集披露（详见姊妹篇）。

---

## 附录：参考来源

- MCP 生态与采用现状：https://novakit.ai/blog/mcp-model-context-protocol-explained
- MCP 2026 完整参考（含 registry 数量、各厂商实现差异）：https://alicelabs.ai/en/insights/model-context-protocol-guide-2026
- Claude / ChatGPT / Gemini 的 MCP 实现差异：https://dev.to/zehranur/how-claude-chatgpt-and-gemini-each-built-mcp-differently-3kd
- VS Code 扩展发布（含 PAT 退役通知）：https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- Raycast 扩展准则：https://manual.raycast.com/extensions-guidelines
- Raycast 发布流程：https://developers.raycast.com/basics/publish-an-extension
- 本仓库：`registry.json`、`extensions/*/manifest.json`、README.md
