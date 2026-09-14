# Plugin Market 文档

本目录收录插件市场侧的架构说明文档与交互式架构图。

## 架构图（docs/diagrams/）

| 图 | FIG | 所有者 | 用途 | 实际 HTML |
| --- | --- | --- | --- | --- |
| Quick Launch 共享清单与场景化启动 | FIG-14 | plugin:quick-launch | 插件消费宿主共享 inventory，仅负责搜索/分类/启动交互 | [quick-launch-inventory-flow.html](./diagrams/quick-launch-inventory-flow.html) |

每张图均为手工维护的离线单文件 HTML（内嵌 CSS/JS/SVG，无外部 fetch/CDN），
支持点击节点/边/编号打开右侧抽屉、场景高亮、中英文切换、键盘导航与 `prefers-reduced-motion`。

## 本地预览

```bash
# 交互式选择文档预览（推荐）
npm start

# 或：直接启动图集门户（:3300）
npm run diagrams

# 或：选择单张图并自动打开浏览器
npm run diagrams:select
```

入口脚本：

- `scripts/menu.mjs` — `npm start` 交互控制台（零外部依赖）
- `docs/diagrams/server.mjs` — 本地静态文档服务（零外部依赖）
- `docs/diagrams/launch.mjs` — 交互式选图并启动预览

## 新增一张图

1. 在 `docs/diagrams/` 放置 `<name>.html`（单文件、离线、内嵌资源）。
2. 在同目录 `specs/<name>.json` 写最小目录元数据（`meta.hand_crafted: true`）。
3. 在 `docs/diagrams/index.html` 的 `<nav>` 增加一条 `<button data-file>`。
4. 更新本文件表格与 `06` 任务台账。
