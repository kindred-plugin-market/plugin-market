# plugin-market（Bench 插件市场）

> [**Bench**](https://github.com/indredK/bench) 的插件发布仓库：`extensions/` 下每个子目录是一个
> 独立 bundled 插件（契约见 Bench `docs/extension-spec.md`），push `<pluginId>-v<version>` tag
> 自动构建并发布 GitHub Release；`registry.json` 为插件市场索引（宿主经 `BENCH_EXT_REGISTRY_URL`
> 拉取，校验 sha256 → 下载 Release 资产 → 安装）。

## 当前插件

| 插件 | 说明 | manifest 版本 |
| --- | --- | --- |
| [`token-calculator`](./extensions/token-calculator/docs/README.md) | Token 计算器：管理计费标准 / 按工作量·预算对比模型费用 / 估算文本 Token 与费用 | 1.1.2 |
| [`quick-launch`](./extensions/quick-launch/) | 快捷启动：场景化应用启动网格（搜索/分类/拖拽排序/虚拟化） | 1.0.0 |
| [`app-manager`](./extensions/app-manager/) | 应用管理：检查更新/升级/卸载/批量操作，复用同一份后端应用清单 | 1.0.0 |
| [`photo-triage`](./extensions/photo-triage/) | 照片筛选：相册「留 / 删」快速分拣 | 0.1.0 |
| [`terminology`](./extensions/terminology/) | 术语库：三层术语管理 + 搜索/置顶 | 1.0.0 |
| [`hardware`](./extensions/hardware/) | 硬件查询：多品类参数对比（纯前端零 IPC） | 1.0.0 |
| [`clean-space`](./extensions/clean-space/) | 存储空间：存储总览 / dev-cleaner / 自定义清理（macOS） | 1.0.0 |

## 跨端出口（bench-host）

`platforms/browser/bench-companion/` 是 Bench 官方浏览器扩展（源真身在
Bench 仓库 `src-tauri/resources/browser-extension/`，经 include 嵌入由
Tauri 命令 `browser_ext_export` 一键导出）。它经 Native Messaging
（`com.kindred.bench`）调用本机 `bench-host` 二进制——同一个二进制也是
**MCP server**（`bench-host mcp`，供 Claude / Cursor 等接入）。架构与实施
细节见 `docs/implementation-playbook-mcp-and-browser.md`。

## 发布一个插件（推送即发版，零手工）

改动 push 到 `main` 后无需任何手工步骤（不打 tag、不点合并）：

1. 修改插件（Bench 仓库开发 → `pnpm run sync:ext-repos` 同步到本仓库）；
2. 以 conventional commit（`feat:` / `fix:` / `feat!:`）提交并 push 到 `main`；
3. `release-please.yml` 自动创建/更新 release PR（bump `manifest.json` 版本 + CHANGELOG）
   并给它开启 **auto-merge**（合并失败时回退为直接 squash 合并）；
4. 合并后 release-please 自动打 `<pluginId>-v<version>` tag 并创建 GitHub Release
   → 接力 `release.yml` 构建 zip、上传资产、把该版本 **upsert** 进 `registry.json` 并推回 `main`。

### 一次前置设置（仓库 Settings）

- General → 勾选 **Allow auto-merge**（workflow 会尝试用 API 自动开启；无 admin 权限时忽略并回退直接合并）
- Actions → General → 勾选 **Allow GitHub Actions to create and approve pull requests**
- 可选：配置 secret `RELEASE_PLEASE_TOKEN`（≤366 天的 fine-grained PAT，仅本仓库
  contents/pull-requests 写权限）。用它时 PR 合并产生的 push 会正常触发 workflow，闭环更快；
  不配也能跑（`pull_request.closed` → self-dispatch 兜底，行为一致）。

Bench 每次打开插件中心都实时拉本仓库的 `registry.json`（宿主常量
`OFFICIAL_REGISTRY_URL`，可用 `BENCH_EXT_REGISTRY_URL` 覆盖），所以索引一推完，
市场里就能看到新插件 / 新版本并点安装 —— **不用升级 Bench，也不用改 Bench 仓库**。

## 新增一个插件

只需要在 `extensions/<id>/` 建目录（含 `manifest.json`）。push 到 `main` 后
`scripts/sync-release-please.mjs` 自动把它登记进 `release-please-config.json` 与
`.release-please-manifest.json`（既有包的自定义配置保留），随后走上面的发版流程。

## registry.json 手工维护（兜底）

需要重算或修正索引时在本仓库执行：

```bash
node scripts/update-registry.mjs --all --skip-missing          # 从 Release 资产重算 sha256/size
node scripts/update-registry.mjs --all --check                 # 只校验、不落盘
node scripts/update-registry.mjs --plugin <id> --zip <file>    # 用本地 zip 登记
```

upsert 语义：只动目标插件的目标版本，保留其他插件、历史版本，以及人工标注的
`yanked` / `revoked`。

## CI 密钥

流水线拉取 Bench 私有宿主工作区需要 `BENCH_REPO_TOKEN` secret（有 Bench 仓库 read
权限的 PAT）。

## 工程化基线与质量门禁

| 工具 | 版本 | 说明 |
| ---- | ---- | ---- |
| Node（本机/开发/主 CI） | `26.8.2` | [.node-version](.node-version)；最低支持 `>=24.15.0`（engines） |
| pnpm | `12.4.1` | `packageManager`；`allowBuilds.lefthook: false` 必须保留 |
| 宿主基线 | [.github/host-baseline.txt](.github/host-baseline.txt) | 构建/测试共用的唯一 HOST_BASELINE_SHA；改它等于换宿主输入 |
| 来源收据 | `dist/provenance.json` | 发布产物附带：market SHA、host SHA、Node、pnpm、宿主 Rust channel、各 zip sha256/size |

质量门禁由 [bench-quality-cli](https://github.com/kindred-plugin-market/bench-quality-cli)（`plugin-market` profile）生成：
`partial-staging`（拒绝部分暂存，先于 lefthook）→ `whitespace` → `markdown-links` → `commitlint`；
诊断与恢复见生成器文档（`.bench-quality.json` 记录 profile/features/文件 hash）。

## 插件 i18n 与测试（CI 同款命令）

```bash
pnpm run audit:ext-i18n                                  # 7 插件 zh 自包含审计
ln -sfn ../../tauri-app host                             # 本地复现 CI 布局（host/ 已被 git 忽略）
pnpm run check:i18n-parity -- --bench host               # 双语 parity（对照固定宿主基线）
pnpm run test:extensions -- --host host                  # 七插件真实测试（宿主工具链）
```

- 宿主输入固定为 **`.github/host-baseline.txt`** 里的 HOST_BASELINE_SHA，三个工作流
  （quality / build / release）读同一个文件，构建与测试的输入因此完全一致；显式传
  `--bench/--host` 时路径必须落在工作区内（`host`，不是 `../host`：checkout 只会落在
  `$GITHUB_WORKSPACE`，`../…` 永远不存在）。
- `test:extensions` 报告 `expected/discovered/tested/skipped/failed`，缺输入/零发现/
  `--id` 未命中/零实测一律非零退出；测试以**宿主的 vitest + 宿主 node_modules** 执行
  （root=host），保证插件与宿主共享同一份 React（避免双实例导致 hooks 失效）。

## CI 分工

| 工作流 | 权限 | 内容 |
| ------ | ---- | ---- |
| `quality-gate.yml` | `contents: read` | **门禁本体**：i18n 链 + 七插件测试 + parity（宿主按基线固定）。只能被调用，不自行触发，故无法绕过 |
| `quality.yml` | `contents: read` | PR / main 推送 / 手动：解析宿主基线 → 调用门禁 |
| `build.yml` | 顶层只读，`build` job `contents: write` | **门禁绿之后**才构建滚动 Release（`build-latest`）并附 `provenance.json` |
| `release.yml` | 顶层只读，`build` job `contents: write` | **门禁绿之后**才构建 tag 版本 → `gh release upload` + 写回 `registry.json` |
| `release-please.yml` | 内容/issue/PR/actions 写 | 版本 PR 与打 tag，不构建插件 |

发布 job 一律 `needs: gate`：门禁红/取消/跳过时构建与发布整体 skipped（`tests/publish-gate.test.mjs`
用语义模型与负向 fixture 锁定这条关系）。
