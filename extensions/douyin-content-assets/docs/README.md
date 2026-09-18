# douyin-content-assets（抖音内容资产）

> 状态：**P1（DCA-01）骨架**。采集条目入库 + 本地视频导入；识别（ASR/OCR）随 DCA-02 接入。
> 任务卡与边界：bench 根 `候选任务/07-抖音内容资产插件分阶段实施提示词.md`；预检与决策：宿主 `docs/explanation/decisions.md` D-037。

## 功能范围（当前版本）

- **素材库**：分页浏览采集条目、来源/搜索筛选、软删、导入本地视频（宿主弹原生文件选择器，SHA-256 去重；插件只接触资产 ID 与元数据，不接触本机路径）。
- **采集说明**：Companion 采集步骤 + 宿主能力状态（桥接就绪 / 媒体 worker 未安装 / 批次与单文件上限）。

## 采集链路

1. 用户在抖音页面点击 Bench Companion 图标（activeTab 授权）；
2. Companion 读取**当前页可见**卡片（只读 DOM，不读 Cookie、不拦截 API、不自动翻页）；
3. 用户在 popup 预览确认后经本机桥 `POST /v1/douyin/items/import-batch` 提交（token + Origin 校验，≤100 条 / ≤1 MiB）；
4. 宿主校验域名白名单、归一化分享链接、幂等去重后写入插件私有数据。

## 数据与安全边界

- 私有数据目录：`$APPDATA/extension-data/douyin-content-assets/`（`items.json` / `assets.json` / `media/<assetId>/`），宿主单写入方，版本化 JSON + `atomic_write`。
- IPC 能力面：`douyin_assets_get_capabilities / list_items / import_files / delete_items`（与宿主 `EXTENSION_ALLOWED_COMMANDS`、`contracts.ts`、本 manifest `acl.commands` 四处同步）。
- 删除为软删；卸载默认保留数据（spec §9.3）。
- 不自动下载网页视频；第一版仅支持用户有权处理的本地视频导入。

## 开发与测试

- 构建走宿主工具链（同其他插件）：`pnpm run extensions:sync` / `extensions:stage`（见市场仓 README）。
- 门禁：`pnpm run audit:ext-i18n`、`pnpm run check:i18n-parity -- --bench <host>`、`pnpm run test:extensions -- --host <host>`（host checkout 需与 `.github/host-baseline.txt` 一致）。
- 插件单测：`src/lib/__tests__/format.test.ts`（纯函数）；Rust 侧校验/去重/容器探测单测在宿主 `douyin_content_assets` 模块。

## 待办（后续阶段）

- DCA-02：媒体 worker 接入（ASR/OCR）、任务状态机、时间轴审核与导出（Markdown/CSV/SRT/VTT）。
- DCA-03：安全硬化、fixture 化适配器测试、跨平台验证与发布准备。
