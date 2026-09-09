# Bench 插件 → 浏览器扩展导出能力调研

> 调研日期：2026-09-09
> 调研目标：评估「插件市场中的能力（以 photo-triage 为首个样本）扩展为浏览器插件，并在 Bench 中提供一键导出 / 安装按钮」的可行性与落地路径。
> 结论优先级：先给结论与推荐，再给证据与工程细节。

---

## 0. 摘要（TL;DR）

**三个核心判断：**

1. **能力本身可以迁移，但必须替换数据层。** 现有插件是「React UI + Tauri IPC」结构，UI 与业务逻辑与平台无关，可复用率约 70–85%；数据层（15 个 `photo_triage_*` 命令）全部依赖本地文件系统，浏览器沙箱内无法直接执行。

2. **「点一下就自动装好、无任何弹窗」在技术上做不到。** 这是浏览器厂商**刻意设计**的限制，不是实现难度问题。Chrome / Edge / Firefox / Safari 均不提供第三方程序静默安装扩展的公开 API。最接近的自动化是「打开 `chrome://extensions` + 预置解压目录 + 分步引导」，用户仍需手动开启开发者模式并点「加载已解压的扩展程序」。

3. **推荐架构：双模运行时（Native Messaging 为主，File System Access 为降级）。** Bench 注册一个 Native Messaging Host，浏览器扩展通过 `chrome.runtime.connectNative()` 复用 Bench 的全部本地能力（能力 100% 保留，权限面最小）；当 Bench 未运行时，自动降级到浏览器原生 File System Access API（能力约 70%，仅限 Chromium 系）。

**推荐落地节奏：**

| 阶段 | 产物 | 说明 |
| --- | --- | --- |
| P0（先做） | 导出 **已解压目录 / ZIP** + Bench 内引导式安装浮层 | 零外部依赖、零费用、当天可用；缺点是需手动开启开发者模式 |
| P1 | 发布到 Chrome Web Store（正式版），按钮 → 商店详情页 / 内联安装 | $5 一次性费用，换来「真正的安装体验 + 自动更新」 |
| P2 | Firefox AMO unlisted 签名、Edge Add-ons | 边际成本低，复用同一套 WXT 构建 |
| P3（可选） | Safari（需 Apple Developer $99/年 + Xcode + 审核） | 成本显著，建议按需求驱动再启动 |

---

## 1. 现状盘点

### 1.1 当前插件契约

`extensions/<id>/manifest.json`（Bench Extension Spec，schemaVersion 2）：

```json
{
  "schemaVersion": 2,
  "id": "photo-triage",
  "version": "0.1.0",
  "distribution": "bundled",
  "entry": { "index": "index.html" },
  "acl": { "commands": [ "photo_triage_scan", ... ] },
  "engines": { "bench": ">=1.30.0" }
}
```

运行时形态（据构建配置与别名约定推断，已确认）：

- 构建：独立 Vite 应用，`base: "./"`，产物 `assets/`，`assetsDir: "bundle"`；
- 部署：宿主 webview 的 `tauri://localhost/ext/<id>/` 子路径下；
- 数据层：`@/lib/tauri/commands/photo-triage` → Tauri IPC → Rust 后端；
- UI 层：React + Tailwind + 自带 i18n（`locales/{zh,en}.json`）；
- 复用宿主：`@` 别名指向宿主 `src/`（UI 组件库、Tauri wrapper 随 bundle 打包）。

### 1.2 photo-triage 能力清单与浏览器可用性

| 命令 | 语义 | 浏览器原生可行性 | 依赖 Native Host |
| --- | --- | --- | --- |
| `photo_triage_scan` | 递归扫描目录、枚举照片 | ⚠️ 部分（FSA 目录遍历，慢且无 EXIF 加速） | ✅ 建议 |
| `photo_triage_scan_status` | 扫描进度 | ✅ 纯状态 | — |
| `photo_triage_list_recent` | 最近相册列表 | ✅ IndexedDB 持久化 | — |
| `photo_triage_open` | 打开原图 | ⚠️ 需 `File` 句柄 / temp URL | — |
| `photo_triage_capabilities` | 能力探测 | ✅ 硬编码 + 特性检测 | — |
| `photo_triage_ensure_proxy` | 生成缩略图/代理图 | ⚠️ 可用 `createImageBitmap` + OffscreenCanvas 自建 | ✅ 更快 |
| `photo_triage_original_path` | 取原始绝对路径 | ❌ FSA 无法暴露真实路径（安全设计） | ✅ 必需 |
| `photo_triage_trash` | 移入系统废纸篓 | ❌ 无系统级回收站 API | ✅ 必需 |
| `photo_triage_restore` | 从废纸篓恢复 | ❌ 同上 | ✅ 必需 |
| `photo_triage_move` | 移动到目标目录 | ⚠️ `FileSystemHandle.move()` 支持度差，建议「复制+删除」 | ✅ 建议 |
| `photo_triage_reveal` | 在 Finder 中显示 | ❌ | ✅ 必需 |
| `photo_triage_prune` | 清理失效清单项 | ✅ | — |
| `photo_triage_empty_dirs` / `delete_empty_dirs` | 空目录扫描 / 删除 | ⚠️ / ⚠️ | ✅ 建议 |
| `photo_triage_export` | 导出选择结果 | ✅ `showSaveFilePicker` / `downloads` | — |

**结论：** 15 个命令中，**4 个（trash / restore / original_path / reveal）在纯浏览器环境下无解**，这 4 个恰好是「用户敢用删除功能」的心理安全线（可恢复）。因此：

> 纯浏览器版要么砍掉「移入废纸篓 + 恢复」，要么自建「软删除」语义（移动到用户指定的 `.bench-trash` 目录 + IndexedDB 记录原路径），但**无法与系统废纸篓打通**，用户误删后不会在 Finder 废纸篓里找到。

### 1.3 代码可复用性评估

| 目录 / 文件 | 复用率 | 说明 |
| --- | --- | --- |
| `src/lib/{pairing,grouping,drag}.ts` | ~100% | 纯算法，无平台依赖 |
| `src/components/*`（10 个） | ~95% | 纯 React UI；需处理 CSP（禁内联脚本/样式）与滚动容器差异 |
| `src/hooks/useKeyboardShortcuts.ts` | ~90% | 注意与浏览器快捷键冲突（需提供禁用 / 自定义） |
| `src/hooks/usePhotoTriageController.ts` | ~85% | 控制器骨架可复用，底层调用需换成 adapter |
| `src/page.tsx` | ~90% | 布局可直接复用 |
| `locales/{zh,en}.json` | 100% | 可直用，或桥接到 `chrome.i18n` |
| `src/services/*` | **需重写** | IPC 命令封装 → RuntimeAdapter |
| `src/store.ts` | ~95% | Zustand/自建 store，仅持久化后端需换（IndexedDB） |
| `vite.config.ts` | 需改造 | 改为 WXT 或 Vite + 扩展插件 |

**整体复用率估算：70–85%。**

---

## 2. 能力迁移：三条技术路线

### 2.1 路线 A：Native Messaging 桥接（推荐主力）

**原理：** Bench 在用户态注册一个 Native Messaging Host，浏览器扩展通过 `chrome.runtime.connectNative('com.kindred.bench')` 与之通信，Host 进程转调 Bench 本地能力（或直接复用 Rust 命令 / CLI）。

**注册位置（无需 root）：**

| 平台 / 浏览器 | Host manifest 路径 |
| --- | --- |
| macOS · Chrome | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.kindred.bench.json` |
| macOS · Chrome Beta / Dev | `~/Library/Application Support/Google/Chrome Beta/NativeMessagingHosts/...` |
| macOS · Edge | `~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/...` |
| macOS · Chromium | `~/.config/chromium/NativeMessagingHosts/...` |
| macOS · Firefox | `~/Library/Application Support/Mozilla/NativeMessagingHosts/...` |
| Windows · Chrome / Edge | `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.kindred.bench`（默认值 = json 绝对路径） |
| Linux | `~/.config/google-chrome/NativeMessagingHosts/...` |

**Host manifest 示例：**

```json
{
  "name": "com.kindred.bench",
  "description": "Bench native capability bridge",
  "path": "/Applications/Bench.app/Contents/MacOS/bench-nm-host",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://abcdefghijklmnopabcdefghijklmnop/"]
}
```

**协议：** stdin/stdout，每条消息 = 4 字节小端 uint32 长度前缀 + UTF-8 JSON。

**关键约束（必须写进设计）：**

| 约束 | 数值 / 影响 | 应对 |
| --- | --- | --- |
| Host → 浏览器单条消息上限 | **1 MB** | 缩略图走分片或 base64（约 200KB 可容纳）；大图改走本地 HTTP 或 temp 文件 |
| 浏览器 → Host 单条消息上限 | 4 GB（64 MiB 为常见保守值） | 无压力 |
| `allowed_origins` | **不支持通配符**（早期支持，现已被移除） | 必须在扩展 manifest 中固定 `"key"` 字段以锁定扩展 ID；或由 Bench 在导出/安装时按实际 ID 动态生成 Host manifest |
| 权限敏感度 | `nativeMessaging` 是 CWS **敏感权限**，触发人工审核 | 在提交表单中明确说明用途；提供「未安装 Bench 时降级」的说明 |
| 进程模型 | `connectNative` 长连接保活；`sendNativeMessage` 每调用起一次进程 | 扫描/批量操作必须走 `connectNative` |

**优点：** 能力 100% 复用；扩展权限面最小；同一套 Host 可服务 Chrome / Edge / Firefox（Safari 也支持 native messaging）。
**缺点：** 依赖 Bench 已安装且 Host 已注册（Bench 首次启动或插件导出时自动写入即可）；Safari 需额外处理。

### 2.2 路线 B：纯浏览器（File System Access API）

**能力来源：**

```ts
const dirHandle = await window.showDirectoryPicker({ id: "photo-triage", mode: "readwrite" })
// 持久化到 IndexedDB，下次可 queryPermission / requestPermission 恢复
for await (const [name, handle] of dirHandle.entries()) { /* ... */ }
const file = await fileHandle.getFile()
```

| 能力 | API | 支持度 |
| --- | --- | --- |
| 目录选择 / 枚举 | `showDirectoryPicker()` | Chrome / Edge 86+，Chromium 系；**Firefox、Safari 不支持** |
| 句柄持久化 | IndexedDB + `queryPermission()` | Chromium 系 |
| 缩略图生成 | `createImageBitmap()` + `OffscreenCanvas` | 广泛支持 |
| 删除 | `FileSystemHandle.remove()` | Chromium 系（**直接删除，无回收站**） |
| 移动 | `FileSystemHandle.move()` | 支持度差 → 用「复制 + 删除」兜底 |
| 写文件 / 导出 | `showSaveFilePicker()` | Chromium 系 |
| 降级方案 | `<input type="file" webkitdirectory>` | 全浏览器可用，但句柄**不可持久化**，每次需重选 |

**必须接受的取舍：**

1. **无系统废纸篓。** 需自建 `.bench-trash/` + IndexedDB 索引模拟回收站；用户不会在 Finder 废纸篓看到文件。
2. **无法获取真实绝对路径。** FSA 刻意屏蔽（`photo_triage_original_path` 不可用），影响「导出清单、与 Bench 端结果互认」等场景。
3. **无法在 Finder / Explorer 中定位**（`reveal` 不可用）。
4. **仅限 Chromium 系**，Firefox / Safari 用户完全用不了。

**优点：** 零依赖、纯前端、无敏感权限、CWS 审核最顺。
**缺点：** 能力打折，且与 Bench 端行为不一致（同一份 UI 两种语义，增加心智负担与支持成本）。

### 2.3 路线 C：本地 HTTP / WebSocket 服务

Bench 起一个 `127.0.0.1:<port>` 服务，扩展用 `fetch` / `WebSocket` 调用。

**重大风险：Chrome 142 起默认启用 Local Network Access（LNA）。**

- 对 `http://127.0.0.1` / 私有地址的请求需通过 **PNA 预检（OPTIONS）**；
- 服务端必须返回：
  ```
  Access-Control-Allow-Origin: chrome-extension://<id>   // 不能是 *
  Access-Control-Allow-Private-Network: true
  Vary: Origin, Access-Control-Request-Private-Network
  ```
- 且 **Chromium 会额外弹一次用户权限提示**（Loopback 地址 `127.0.0.0/8` 可豁免混合内容检查，但策略仍在收紧，需实测）；
- Firefox / Safari 对 loopback 有各自更窄的规则，行为不一致。

**还有：** 端口需动态分配 + 服务发现（写端口到固定文件或 mDNS）、需 token 认证防止其他本地程序/网页调用、需处理休眠与重启。

**定位：** 作为 Native Messaging 的**补充通道**（专供大文件 / 图片字节流，规避 1 MB 消息上限），不建议作为主通道。

### 2.4 路线对比与推荐

| 维度 | A · Native Messaging | B · File System Access | C · 本地 HTTP |
| --- | --- | --- | --- |
| 能力完整度 | **100%** | ~70% | 100% |
| 浏览器覆盖 | Chrome / Edge / Firefox / Safari | **仅 Chromium** | Chromium（Firefox 规则不同） |
| 权限敏感度 | 高（`nativeMessaging`） | 低 | 中（host_permissions） |
| 实现复杂度 | 中（协议 + 注册） | 低 | 中（CORS + 端口 + 认证） |
| 依赖 Bench 运行 | **是** | 否 | **是** |
| 传输大 payload | 受限（1 MB）→ 需配合 C | 原生 | 好 |

> **推荐：A + B 双模。**
> 启动顺序：`探测 Native Host 可用` → 可用走 A（全能力，UI 显示「已连接 Bench」徽标）→ 不可用走 B（降级，UI 明示受限能力并置灰 trash/restore/reveal）。大图字节流统一走 C（本地 HTTP）。

---

## 3. 安装与分发：能不能「点一下就装好」

### 3.1 硬事实

**静默安装不可行。** 这是浏览器厂商对抗恶意软件的显式设计：

- Chrome 只提供三条官方路径：**Chrome Web Store（含内联安装）**、**企业策略**、**开发者模式加载已解压目录**；
- `chrome.developerPrivate`（`loadUnpacked`）仅 `chrome://extensions` 页面可用，**普通扩展无法调用**；
- 直接改写 Chrome Profile 的 `Preferences` / `Secure Preferences` 注入扩展会被签名校验拦下，并被 Chrome 当作「未经策略安装」清理——**不可靠，不推荐**。

### 3.2 各渠道矩阵

| 方式 | 可行性 | 自动化程度 | 关键约束 |
| --- | --- | --- | --- |
| **静默安装** | ❌ | — | 所有主流浏览器均禁止 |
| **开发者模式 · 加载已解压目录** | ✅ | 半自动 | 用户须手动开启「开发者模式」；**Chrome 每次启动会弹「请停用开发者模式扩展程序」提示**，长期体验受损；不会自动更新 |
| **拖拽 .crx 到扩展页** | ⚠️ | 半自动 | Chrome 对非商店来源 crx 的限制持续收紧（仅临时生效 / 被禁用），**不建议作为主路径** |
| **命令行 `--load-extension=<dir>`** | ⚠️ | 全自动但脆弱 | 需 Chrome **完全退出**后启动；用户下次正常启动即失效；窗口带自动化痕迹；macOS 需 `open -a "Google Chrome" --args --load-extension=...` |
| **企业策略 `ExtensionInstallForcelist` / `ExtensionSettings`** | ✅（企业） | 全自动 | **macOS 上，非 CWS 来源的扩展仅在设备受 MDM 管理 / 加入域 / 注册 Chrome Enterprise Core 时才允许强制安装**；个人设备不可用 |
| **Chrome Web Store 常规安装** | ✅ | 手动点击 | $5 一次性开发者注册费 + 2FA；审核 1–3 个工作日（2026 年因提交量激增，部分延长至数周）；需隐私政策、权限理由、截图、单用途声明 |
| **CWS 内联安装 `chrome.webstore.install()`** | ✅ | **最接近「一键」** | 必须先发布到 CWS；调用页面域名需在 CWS 后台**验证所有权**；必须在用户手势中调用；**只能装同源 CWS 上的扩展** |
| **Firefox AMO（listed）** | ✅ | 手动 | 免费；需人工审核 |
| **Firefox unlisted 签名 xpi** | ✅ | 半自动 | 免费；AMO 自动签名后可**自托管分发**并安装（用户需确认） |
| **Edge Add-ons** | ✅ | 手动 | 免费；MV3 兼容 Chrome 产物 |
| **Safari** | ⚠️ | 手动 | 需 **Apple Developer Program（$99/年）** + `xcrun safari-web-extension-converter` 生成 Xcode 工程 + 签名 + App Store 审核 |

### 3.3 推荐 UX：三段式引导

Bench 中「导出为浏览器扩展」按钮点击后的行为设计：

**P0 版本（无商店依赖）**

1. Bench 在后台：
   - 生成扩展产物 → 解压到固定目录
     `~/Library/Application Support/Bench/browser-extensions/<pluginId>/`
   - 写入 Native Messaging Host manifest（填入实际扩展 ID）
   - 检测已安装的 Chromium 系浏览器（macOS 读 `/Applications/*.app` 的 `CFBundleShortVersionString`；Windows 读注册表卸载项）
2. 弹出 Bench 内浮层（**不用系统弹窗，用自带 UI，可控可追踪**）：
   - 顶部：目标浏览器选择（自动高亮检测结果）
   - 中部：3–4 步图文卡片（① 打开 chrome://extensions → ② 打开右上角「开发者模式」→ ③ 点「加载已解压的扩展程序」→ ④ 选择路径）
   - 路径旁一键复制按钮
   - 「打开浏览器扩展页面」按钮：**注意 `chrome://` 协议不能被系统默认 http handler 处理**，macOS 需 `open -a "Google Chrome" chrome://extensions`，Windows 需直接执行 Chrome 二进制并传参
3. 底部：折叠的「为什么需要这些步骤？」说明 + 「改用 Chrome 应用商店版（更简单）」链接（P1 上线后启用）

**P1 版本（已发布商店）**

- 按钮行为改为：无痕打开 `https://chromewebstore.google.com/detail/<id>`，或打开自有 https 落地页调用 `chrome.webstore.install()` 实现真正的一键安装。
- 落地页域名必须在 CWS 开发者后台完成验证。

### 3.4 各浏览器差异速查

| | Chrome / Edge | Firefox | Safari |
| --- | --- | --- | --- |
| manifest 版本 | MV3（强制） | MV3（支持，部分 API 不同；MV2 仍可用） | MV3 子集 |
| 后台 | Service Worker（无 DOM） | Background page（**有 DOM**） | Background page |
| offscreen document | 需要（Chrome 109+） | 不需要 | 不适用 |
| `browser.*` / Promise | 需 `webextension-polyfill` | 原生 `browser.*` | 部分 |
| Native Messaging | ✅ | ✅ | ✅ |
| File System Access | ✅ | ❌ | ❌ |
| 发布成本 | $5 一次性 | 免费 | $99/年 |

---

## 4. 工程落地方案

### 4.1 目标产物

| 产物 | 用途 | 生成方式 |
| --- | --- | --- |
| 已解压目录 | 「加载已解压的扩展程序」 | WXT build 输出 |
| `.zip` | 商店上传 / 归档分发 | `cd dist && zip -r ../<id>-chrome.zip .`（**打包目录内容，不含外层目录**） |
| `.crx`（可选） | 企业自托管更新 | `chrome --pack-extension=<dir> --pack-extension-key=<pem>`；配套 update manifest XML |
| `.xpi` | Firefox | `web-ext build` / 直接 zip；自分发需 `web-ext sign` 走 unlisted |
| Safari `.app` | App Store | `xcrun safari-web-extension-converter` + Xcode |

### 4.2 插件 manifest 扩展字段设计

在现有 Bench Extension Spec 上**增量**增加（不破坏现有宿主兼容性）：

```jsonc
{
  "schemaVersion": 2,
  "id": "photo-triage",
  "version": "0.1.0",
  "distribution": "bundled",
  "entry": { "index": "index.html" },
  "acl": { "commands": [ "photo_triage_scan", "..." ] },
  "engines": { "bench": ">=1.30.0" },

  // ↓ 新增：浏览器导出声明
  "browser": {
    "exportable": true,
    "display": { "zh": "照片筛选", "en": "Photo Triage" },
    "entry": "src/page.tsx",
    "defaultSurface": "tab",            // popup | sidepanel | tab
    "minWidth": 1024,
    "surfaceReason": "照片筛选需要大画布，popup 尺寸不足",
    "runtime": {
      "modes": ["native", "fsa"],       // 优先 native，降级 fsa
      "nativeHost": "com.kindred.bench",
      "degraded": ["photo_triage_trash", "photo_triage_restore",
                   "photo_triage_original_path", "photo_triage_reveal"]
    },
    "permissions": {                     // 供导出器生成 manifest
      "native": ["nativeMessaging", "storage"],
      "fsa": ["storage"]
    }
  }
}
```

`browser.runtime.degraded` 让导出器与 UI 自动知道哪些功能需要在降级模式置灰，无需硬编码。

### 4.3 Runtime Adapter 抽象

```ts
// 现有：src/services/photo-triage.repository.ts（直接 re-export Tauri 命令）
// 改为：按运行时注入不同实现，接口保持一致

export interface PhotoTriageRuntime {
  scan(src: string): Promise<ScanResult>
  scanStatus(): Promise<ScanStatus>
  ensureProxy(id: string, kind: ProxyKind): Promise<string | null>
  trash(ids: string[]): Promise<boolean>
  restore(ids: string[]): Promise<boolean>
  move(ids: string[], target: string): Promise<boolean>
  reveal(path: string): Promise<boolean>
  capabilities(): Promise<Capabilities>   // ← 关键：UI 依据此置灰降级能力
  // ...
}

// bench   : TauriRuntime      （现有实现，零改动）
// native  : NativeMessagingRuntime（connectNative → com.kindred.bench）
// fsa     : FileSystemAccessRuntime（showDirectoryPicker + IndexedDB）
```

`use-cases.ts` 与 `hooks/` **保持不动**，只替换注入的 runtime。这是让「一套 UI 跑三个平台」的关键。

### 4.4 目录与构建

建议新增 `platforms/browser/`（与 `extensions/` 平级）：

```
platforms/browser/
├── wxt.config.ts              # 一次构建出 chrome / firefox / edge
├── entrypoints/
│   ├── background.ts          # service worker：connectNative 保活 + 消息路由
│   ├── sidepanel/index.html   # 或 tab 全页
│   └── offscreen.html         # 图片解码 / EXIF 解析（Chrome 无 DOM 时需要）
├── src/
│   ├── runtime/{native,fsa}.ts
│   └── bridge/proxy-url.ts    # 大图走本地 HTTP 直出
└── scripts/
    └── export.mjs             # 读 extensions/<id>/manifest.json 的 browser 段 → 生成产物
```

**构建工具选型：推荐 WXT。**

| 工具 | 定位 | 评价 |
| --- | --- | --- |
| **WXT** | 全框架，Vite 底座，文件式入口 | ✅ 推荐：跨浏览器支持最好（Chrome/Firefox/Safari/Edge），内置 zip + 自动发布，活跃维护 |
| Plasmo | React 优先，资料最多 | ⚠️ 维护趋缓，Parcel 自建打包器，锁定深 |
| CRXJS | Vite 插件，最轻 | ⚠️ 跨浏览器弱，适合已有 Vite 工程最小改造 |

因为现有插件已经是 Vite + React，WXT 的接入成本最低（`wxt.config.ts` 里挂 React 插件 + Tailwind）。

**CSP 注意：** MV3 禁止内联脚本/样式与 `unsafe-eval`。Tailwind 运行时（JIT in-browser）不可用，必须用构建期产物；若引入 WASM（EXIF 解析）需声明 `'wasm-unsafe-eval'`。

### 4.5 Bench 侧按钮实现要点

1. **浏览器探测**
   - macOS：`ls /Applications` 匹配 `Google Chrome.app`、`Microsoft Edge.app`、`Firefox.app`、`Arc.app`…；读 `Contents/Info.plist` 的 `CFBundleShortVersionString`。
   - Windows：注册表 `HKLM/HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\*`。
2. **打开 `chrome://` 内部页**
   - 通用 `open` / `shell.open` 走系统 URL handler，**处理不了 `chrome://` 协议**，必须直接调用浏览器二进制：
     - macOS：`open -a "Google Chrome" "chrome://extensions"`
     - Windows：`"<chrome.exe路径>" chrome://extensions`
3. **扩展 ID 固定**
   - 未发布扩展的 ID 由内容哈希决定，每次改动都会变 → Native Messaging `allowed_origins` 会失效。
   - 解决：在生成产物时写入固定的 `"key"` 字段（由一把 **Bench 全局固定私钥**派生，不要每个插件一把）。这把私钥需纳入仓库密钥管理，安全等级等同发布签名密钥。
   - 或者：Native Host manifest 在每次导出时按实际 ID 重写（更简单，但用户重装后需重新导出）。**建议两者都做**：固定 key 为默认，导出时校验并按需重写 Host manifest。
4. **Native Host 注册时机**
   - Bench 首次启动 / 每次「导出为浏览器扩展」时写入；
   - Host 可执行文件放到 Bench 的 Application Support 目录，升级 Bench 时路径保持稳定。

---

## 5. 权限与合规

1. **Chrome Web Store（2026 现状）**
   - 开发者注册费 **$5 一次性**；强制开启 Google 账号 2FA；需验证联系邮箱。
   - **Single Purpose Policy**：扩展必须有单一明确用途。若一个扩展同时导出 photo-triage + terminology + hardware，会被判违规 → **必须一个插件一个扩展 ID**。
   - 权限最小化：`nativeMessaging` 是敏感权限，**必然触发人工审核**，需在提交表单逐项说明理由。
   - 涉及用户数据必须提供**隐私政策 URL**（可访问、非 404）。
   - 2026-07-01 公布、2026-08-01 起执行的新政策进一步收紧「披露的单一用途」与「数据收集」之间的一致性，并要求显著披露数据收集行为。
   - 审核时长：官方称多数几天内完成，但 2026 年 4 月起因提交量激增，部分延长至数周。
2. **分发形态选择**：CWS 支持 Public / Unlisted（链接可见）/ Private（指定账号）。P1 阶段可先 **Unlisted** 灰度，验证通过再转 Public。
3. **Firefox**：`nativeMessaging` 允许；listed 需人工审核，unlisted 自动签名可自托管。
4. **数据出境**：本方案全部数据留在本地，隐私政策可写「不收集、不上传任何数据」，是审核加分项——**务必确保实现与声明一致**（不要加任何埋点上报本地文件路径）。

---

## 6. 风险清单

| # | 风险 | 等级 | 缓解 |
| --- | --- | --- | --- |
| R1 | 「一键自动安装」预期落空 | 高 | 文档中明确产品预期：P0 是「引导式安装」，P1 才是「一键」；Bench UI 文案避免承诺「自动安装」 |
| R2 | 开发者模式扩展每次启动弹「停用开发者模式扩展程序」 | 高 | 只能靠上架 CWS 彻底解决；P0 阶段在浮层里显式告知 |
| R3 | 扩展 ID 漂移导致 Native Messaging 断连 | 中 | 固定 `key` + 导出时重写 Host manifest + 扩展内连通性自检与「重新配对」入口 |
| R4 | Chrome LNA / PNA 政策继续收紧，本地 HTTP 通道被拦 | 中 | 主通道走 Native Messaging；本地 HTTP 只做图片字节流旁路，且做好降级到 base64 的准备 |
| R5 | 纯浏览器降级模式下「删除不可恢复」引发数据损失 | **高** | 降级模式必须**默认禁用删除**，或强制先移动到用户显式指定的 `.bench-trash` 目录并提示「此操作不经过系统废纸篓」 |
| R6 | FSA 在扩展页面（`chrome-extension://`）中的可用性存在实现差异 | 中 | **Spike 阶段必须实测**；准备 `<input type="file" webkitdirectory>` 兜底（代价：无法持久化句柄） |
| R7 | Safari 成本（$99/年 + Xcode + 审核） | 中 | 列为 P3，按需求驱动；WXT 已能产出 Safari 工程，边际成本主要是账号与审核 |
| R8 | 快捷键与浏览器冲突 | 低 | 提供快捷键自定义 + 一键禁用 |
| R9 | Tailwind / 宿主 UI 库在 CSP 下失效 | 中 | 构建期产出 CSS，禁止运行时样式注入；抽查 bundle 内是否残留内联 `on*` 属性 |

---

## 7. 路线图与工作量估算

> 以「1 名熟悉本代码库的开发者」为基准，人日（pd）为粗估。

| 阶段 | 任务 | 估算 |
| --- | --- | --- |
| **Spike（必做，1 周内）** | ① 扩展页面中 `showDirectoryPicker` 实测；② Native Messaging Host 在 macOS Chrome 上跑通 echo；③ 1 MB 消息上限实测与缩略图方案验证 | 2–3 pd |
| **M1 · 基础设施** | Runtime Adapter 抽象 + `browser` manifest 字段 + WXT 工程骨架 + photo-triage 接 native 模式跑通 | 5–8 pd |
| **M2 · 导出器** | `export.mjs`：生成产物 / 解压到固定目录 / 写 Host manifest / 浏览器探测 / 固定 key | 3–5 pd |
| **M3 · Bench 按钮与引导** | 插件详情页按钮 + 三段式引导浮层 + 连通性自检 | 3–4 pd |
| **M4 · 降级模式** | FSA runtime + 软删除语义 + 能力置灰与提示 | 4–6 pd |
| **M5 · 上架** | CWS 注册 / 隐私政策 / 素材 / 提交 + Firefox unlisted + Edge | 2–4 pd（不含审核等待） |
| **合计（到 P0 可用）** | M1 + M2 + M3 | **约 11–17 pd** |
| **合计（到 P1 上架）** | 全部 | **约 19–30 pd** |

---

## 8. 待验证清单（Spike）

在进入编码前，以下 6 项必须实测确认（建议一次性做完，产出一份 `docs/spike-notes.md`）：

1. [ ] 在 `chrome-extension://` 的**独立标签页**与 **sidePanel** 中分别调用 `showDirectoryPicker()`，记录是否成功、句柄能否持久化到 IndexedDB。
2. [ ] 在 **popup** 中调用 `showDirectoryPicker()`，确认是否因失焦导致 popup 关闭（预期会）。
3. [ ] macOS Chrome 上注册 Native Messaging Host 并跑通双向 echo；测量 host→浏览器 1 MB 上限的真实行为与超限报错。
4. [ ] 缩略图方案对比：`createImageBitmap` + OffscreenCanvas（扩展页内） vs Native Host 返回 base64 vs 本地 HTTP 直出，给出延迟与内存数据。
5. [ ] 未上架扩展**固定 `key` 后 ID 是否稳定**，以及 `allowed_origins` 是否接受该 ID。
6. [ ] Chrome 当前稳定版对「已解压扩展」的启动提示行为（是否每次启动都弹「停用开发者模式扩展程序」）。

---

## 9. 决策建议

1. **不要让「自动安装」成为 P0 的验收标准**——它在浏览器厂商层面被禁止。P0 的合理目标是「**3 步引导内完成安装**」，P1 通过上架 CWS 达到「一键」。
2. **优先做 Native Messaging 而非纯浏览器版。** 前者能力完整、与 Bench 端行为一致，避免维护两套语义；后者看似简单，但「删除不可恢复」会直接损害产品信任。
3. **一个插件一个扩展 ID**（CWS Single Purpose Policy 要求），导出器需支持批量导出。
4. **先跑 Spike 再写方案代码**——R6（FSA 在扩展页的可用性）是唯一可能颠覆架构判断的不确定性，2–3 人日即可消除。

---

## 附录：关键参考资料

**官方文档**

- Chrome Native Messaging：https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- `chrome.offscreen` API：https://developer.chrome.com/docs/extensions/reference/api/offscreen
- File System Access API：https://developer.chrome.com/docs/capabilities/web-apis/file-system-access
- WICG File System Access 规范：https://wicg.github.io/file-system-access/
- Safari Web Extension Converter：https://developer.apple.com/documentation/safariservices/converting_a_web_extension_for_safari
- Chrome 企业扩展策略（Mac）：https://support.google.com/chrome/a/answer/7517624

**政策与时效信息（2026-09 检索）**

- Chrome Web Store 发布要求清单：https://extensionbooster.com/blog/chrome-web-store-publishing-requirements-2026-complete-checklist
  （$5 一次性注册费、2FA 强制、Single Purpose、敏感权限人工审核、2026-07/08 数据披露新规）
- Chrome Local Network Access（Chrome 142 起）：https://blog.paulserban.eu/post/why-chrome-restricts-local-network-access-how-to-adapt/
  （PNA 预检、`Access-Control-Allow-Private-Network: true`）
- 跨浏览器发布成本与 Safari 实况：http://extensionbooster.net/blog/cross-browser-extension-development-chrome-firefox-safari-edge-guide
- 扩展框架横评（WXT / Plasmo / CRXJS）：https://dev.to/extensionbooster/plasmo-vs-crxjs-vs-wxt-which-chrome-extension-framework-should-you-use-in-2026-37o4

**本仓库相关文件**

- `extensions/photo-triage/manifest.json`（能力白名单）
- `extensions/photo-triage/src/services/photo-triage.use-cases.ts`（业务逻辑，可复用主体）
- `extensions/photo-triage/vite.config.ts`（当前构建与别名约定）
- `registry.json`（市场索引，后续可扩展 browser 版本条目）
