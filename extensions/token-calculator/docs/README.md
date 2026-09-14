# Token 计算器（Token Calculator）

> **形态**：bundled 插件（manifest `distribution: "bundled"`，entry `index.html`），由 Bench 内置功能迁移而来。
> **独立 React 应用**：自带 i18n 资源，复用宿主 UI 组件库 / Tauri 能力面 wrapper（随 bundle 打包）。
> **打开方式**：Bench 扩展中心（extension-center）；要求 `engines.bench >= 1.30.0`。

## 定位
管理计费标准、按工作量 / 预算对比模型费用、估算文本 Token 与费用。

## 三个 Tab
- **计费标准（Standards）**：管理计费标准（增 / 改 / 删）。每个标准包含若干模型（`ModelPricing`：输入价、输出价、缓存价等）。数据通过宿主 4 条 ACL 命令读写（见下）。
- **对比（Compare）**：按 **工作量（workload）** 或 **预算（budget）** 对比模型费用；可从标准选取模型，使用倍率预设（1 / 2 / 3 / 5 / 10 / 20 / 50 / 100）与混合单价（每百万 token）。
- **计算器（Calculator）**：估算文本 Token 与费用。估算为字符级启发式（见下），**非**厂商精确 tokenizer。

## 货币与汇率
- 显示货币 USD / CNY 切换（工具栏）。
- 汇率来自 **Frankfurter** 公共接口（`api.frankfurter.app`，无需 API key），USD→CNY，1 小时 TTL 缓存；获取失败时回退到缓存（标记 `stale`）或默认值 `7`（标记 `stale`）。支持手动覆盖。

## ACL 依赖（宿主命令白名单）
`list_pricing_standards` · `create_pricing_standard` · `update_pricing_standard` · `delete_pricing_standard`
> 计费标准持久化由宿主 Rust 侧 `pricing_standard` 存储承接；插件仅经上述命令消费。

## i18n
自带 `zh` / `en` locale（self-contained，符合插件 i18n 审计）。

## 测试
`src/__tests__/pricing.test.ts`（vitest，覆盖 `estimateTokens` / 汇率换算等）。

## 文档索引
- 路线 / 未完成项 / 验收条件 → [roadmap.md](./roadmap.md)
