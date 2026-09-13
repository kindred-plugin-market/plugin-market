# plugin-market（Bench 插件市场）

> [**Bench**](https://github.com/indredK/bench) 的插件发布仓库：`extensions/` 下每个子目录是一个
> 独立 bundled 插件（契约见 Bench `docs/extension-spec.md`），push `<pluginId>-v<version>` tag
> 自动构建并发布 GitHub Release；`registry.json` 为插件市场索引（宿主经 `BENCH_EXT_REGISTRY_URL`
> 拉取，校验 sha256 → 下载 Release 资产 → 安装）。

## 当前插件

| 插件 | 说明 | manifest 版本 |
| --- | --- | --- |
| [`token-calculator`](./extensions/token-calculator/) | Token 计算器：管理计费标准 / 按工作量·预算对比模型费用 / 估算文本 Token 与费用 | 1.0.0 |
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

## 发布一个插件（全自动）

改动合并到 `main` 后无需任何手工步骤：

1. 修改插件（Bench 仓库开发 → `pnpm run sync:ext-repos` 同步到本仓库）；
2. 以 conventional commit 提交并 push 到 `main`；
3. `release-please.yml` 自动维护 release PR（bump `manifest.json` 版本 + CHANGELOG）；
4. 合并 PR → 自动打 `<pluginId>-v<version>` tag 并创建 Release → 接力 `release.yml`
   构建 zip、上传资产、把该版本 **upsert** 进 `registry.json` 并推回 `main`。

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
