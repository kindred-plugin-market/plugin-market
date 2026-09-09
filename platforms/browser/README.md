# Browser Extensions（浏览器扩展）

本目录存放 Bench 能力的浏览器侧出口。**源真身在 Bench 仓库**
`src-tauri/resources/browser-extension/bench-companion/`（由 Tauri 侧
`include_str!` 编译期嵌入，导出命令从这里写出），本目录是同步副本，供
review 与发布使用（与 `extensions/` 的 sync 模式一致）。

## bench-companion（v0.1.0）

Bench 官方伴随扩展：经 **Native Messaging**（`com.kindred.bench`）调用本机
`bench-host`，提供：

- **popup**：术语库实时搜索（terminology）+ 连接状态；
- **面板（options page）**：存储扫描（clean-space 只读扫描）、照片筛选相册
  摘要（photo-triage manifest 统计）、MCP 配置指引；
- Bench 未运行 / 未注册 host 时自动降级为「未连接」态并展示原因。

## 固定扩展 ID

`manifest.json` 携带固定 `key`，扩展 ID 恒为
`dmcfgfpfilhgcoddmciglpjdggkpinje` —— 与 bench-host NM manifest 的
`allowed_origins` 永久匹配（扩展 ID 漂移是 Native Messaging 断连的头号原因，
见 `docs/browser-extension-export-research.md` R3）。

## 安装方式

1. **推荐**：Bench 应用 → 插件中心 → 「跨端接入」→「导出浏览器扩展」
   （自动写出已解压扩展 + 注册 NM host + 引导浮层）；
2. 手动：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 →
   选择本目录（需先构建并注册 bench-host，见实施手册）。

## 同步

```bash
# Bench 仓库（源） → 本仓库（副本）
cp -R ~/Documents/github/tauri-app/src-tauri/resources/browser-extension/bench-companion \
      platforms/browser/
```
