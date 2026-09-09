# plugin-market（Bench 插件市场）

> [**Bench**](https://github.com/indredK/bench) 的插件发布仓库：`extensions/` 下每个子目录是一个
> 独立 bundled 插件（契约见 Bench `docs/extension-spec.md`），push `<pluginId>-v<version>` tag
> 自动构建并发布 GitHub Release；`registry.json` 为插件市场索引（宿主经 `BENCH_EXT_REGISTRY_URL`
> 拉取，校验 sha256 → 下载 Release 资产 → 安装）。

## 当前插件

| 插件 | 说明 | manifest 版本 |
| --- | --- | --- |
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

## 发布一个插件

```bash
# 1. 修改对应插件（Bench 仓库开发 → pnpm run sync:ext-repos 同步到本仓库）
# 2. 更新该插件 manifest.json 的 version
# 3. 打 tag 推送
git tag photo-triage-v0.1.1
git push origin photo-triage-v0.1.1
# CI 自动：构建 → 发布 Release；随后在 Bench 仓库更新 registry.json（sha256）
```

## registry.json 维护

在 Bench 仓库执行：

```bash
pnpm run update:ext-registry -- --market ~/Documents/github/kindred-plugin-market/plugin-market
```

（脚本会对每个插件跑 pack 取 sha256/size，重写 `registry.json`；commit + push 后
Bench 端市场立即可见新版本。）

## CI 密钥

流水线拉取 Bench 私有宿主工作区需要 `BENCH_REPO_TOKEN` secret（有 Bench 仓库 read
权限的 PAT）。
