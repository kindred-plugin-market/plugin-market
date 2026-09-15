#!/usr/bin/env node
/**
 * 插件测试 runner（P04；P08 起 fail-closed）：把宿主 src 与插件源复制进宿主
 * node_modules 下的一次性沙箱，用**宿主的 vitest + 宿主 node_modules** 执行，从而：
 *   - 所有裸导入（react / zustand / @testing-library/…）都落在宿主 node_modules，
 *     天然单份 React（避免宿主 src 与插件测试各解析出一份 → hooks dispatcher 失效）；
 *   - 沙箱位于 root 内，杜绝 /@fs/ 越根服务（rolldown-vite 的 fs.allow/strict
 *     对 root 外文件不生效，见 evidence/PLUGIN/P04/root-host-progress.log）。
 *
 * P08（审计 R06）修正的三件事：
 *   1. **expected 由 manifest.json 决定**，不再由“哪些目录带 vitest.config.ts”反推：
 *      实际插件集合是清单事实，测试配置缺失属于失败，不属于“跳过”；
 *   2. **每次运行新建唯一沙箱，运行后删除**：覆盖式复用固定沙箱会让源码删除/重命名
 *      后的旧文件留到下一次运行，产生假绿；
 *   3. **skipped 必须为 0**：覆盖率不完整一律非零退出（EXTENSION_COVERAGE_INCOMPLETE）。
 *
 * 沙箱布局（每次唯一，finally 清理）：
 *   <host>/node_modules/.bench-quality-cli-XXXXXX/
 *     ├── host/src/                 ← 宿主 src 副本（`@` 指向这里）
 *     ├── extensions/<id>/          ← 插件源副本（`@extension` 指向这里；含 setup 与测试）
 *     └── vitest-<id>.generated.mjs ← 本脚本生成的 vitest 配置
 *
 * 契约（与 T20 一致）：--host 或 BENCH_HOST_DIR 指定宿主；缺输入/零发现/--id 未命中/
 * 缺测试契约/零实测/覆盖率不完整 → 非零退出；报告 expected/discovered/tested/skipped/
 * failed/ignored；--json 输出单份 JSON（含 sandbox 路径）。
 * **绝不执行规则/命令中的任何系统命令。**
 *
 * 用法：pnpm run test:extensions [--host <dir>] [--id <id>] [--json]
 * 测试可用 BENCH_MARKET_DIR 指向 fixture 市场（见 tests/test-extensions.test.mjs）。
 */

import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const MARKET_ROOT = resolve(
  process.env.BENCH_MARKET_DIR ?? join(dirname(fileURLToPath(import.meta.url)), ".."),
)
const EXTENSIONS_DIR = join(MARKET_ROOT, "extensions")
const HOST_VITEST = (host) => join(host, "node_modules", ".bin", "vitest")
const SANDBOX_PREFIX = ".bench-quality-cli-"

const valueOf = (flag) => {
  const index = process.argv.indexOf(flag)
  return index === -1 ? null : process.argv[index + 1]
}
const hostInput = valueOf("--host") ?? process.env.BENCH_HOST_DIR
const host = resolve(hostInput ?? join(MARKET_ROOT, "..", "..", "tauri-app"))
const onlyId = valueOf("--id")
const json = process.argv.includes("--json")
const progress = json ? console.error : console.log

function fail(code, message, hint) {
  console.error(`${code}: ${message}`)
  if (hint) console.error(`hint: ${hint}`)
  process.exit(1)
}

/* ── 发现与契约（纯函数，供自身测试直接调用） ───────────────────────────── */

/** 发现插件：以 manifest.json 为准；没有 manifest 的目录不算插件，但会被报告。 */
export function discoverExtensions(extensionsDir) {
  if (!existsSync(extensionsDir)) return { expected: [], ignored: [] }
  const dirs = readdirSync(extensionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  return {
    expected: dirs.filter((id) => existsSync(join(extensionsDir, id, "manifest.json"))).sort(),
    ignored: dirs.filter((id) => !existsSync(join(extensionsDir, id, "manifest.json"))).sort(),
  }
}

/** 可测性契约：manifest 里的每个插件都必须同时带 vitest.config.ts 与 vitest.setup.ts。 */
export function missingTestContract(extensionsDir, ids) {
  const required = ["vitest.config.ts", "vitest.setup.ts"]
  return ids
    .map((id) => ({
      id,
      missing: required.filter((file) => !existsSync(join(extensionsDir, id, file))),
    }))
    .filter((entry) => entry.missing.length > 0)
}

/**
 * 删除一次性沙箱，保证 finally 一定能清干净。
 *
 * CI 与普通终端直接 rmSync；某些环境（agent 终端会注入 safe-delete 风格的 shim，
 * 拦截单次 >500 文件的删除）会抛错，此时退回一个不带 NODE_OPTIONS 的子进程删除。
 * 清理失败必须被看见：残留沙箱会污染下一次运行。
 */
function removeSandbox(sandbox) {
  try {
    rmSync(sandbox, { recursive: true, force: true })
    return
  } catch (error) {
    const fallback = spawnSync(
      process.execPath,
      ["-e", "require('node:fs').rmSync(process.argv[1], { recursive: true, force: true })", sandbox],
      { stdio: "ignore", env: { ...process.env, NODE_OPTIONS: "" } },
    )
    if (fallback.status !== 0 || existsSync(sandbox)) {
      console.error(`SANDBOX_CLEANUP_FAILED: ${sandbox} — ${error.message}`)
      console.error("hint: remove it manually; a leftover sandbox can pollute the next run.")
      process.exitCode = 1
    }
  }
}

function prepareSandbox(host, pluginIds, sandbox) {
  // 宿主 src 副本：`@` 指向这里。放在 <host>/node_modules 内 → 其裸导入向上
  // 解析仍落在宿主 node_modules（单份 react/zustand/…）。
  cpSync(join(host, "src"), join(sandbox, "host", "src"), { recursive: true })
  for (const id of pluginIds) {
    cpSync(join(EXTENSIONS_DIR, id), join(sandbox, "extensions", id), {
      recursive: true,
      filter: (source) => !/(^|[\\/])node_modules([\\/]|$)/.test(source),
    })
  }
}

/* ── 主流程 ───────────────────────────────────────────────────────────── */

function main() {
  if (!existsSync(HOST_VITEST(host))) {
    fail(
      "VITEST_NOT_INSTALLED",
      `${HOST_VITEST(host)} was not found`,
      "The pinned host checkout must have its dependencies installed (`pnpm install` in the host).",
    )
  }
  if (!existsSync(join(host, "package.json"))) {
    fail("BENCH_HOST_MISSING", `${host} is not a Bench host checkout`, "Pass --host <dir> or set BENCH_HOST_DIR.")
  }
  if (!existsSync(EXTENSIONS_DIR)) {
    fail("EXTENSION_MARKET_MISSING", `${EXTENSIONS_DIR} does not exist`)
  }

  const { expected, ignored } = discoverExtensions(EXTENSIONS_DIR)
  if (expected.length === 0) {
    fail(
      "EXTENSION_ZERO_DISCOVERY",
      `no plugin with a manifest.json under ${EXTENSIONS_DIR}`,
      "插件集合以 manifest.json 为准；空集合不能当作通过。",
    )
  }
  // 缺测试契约立即失败：不能因为“没有 vitest.config.ts”就把插件从覆盖率里剔除。
  const incomplete = missingTestContract(EXTENSIONS_DIR, expected)
  if (incomplete.length > 0) {
    fail(
      "EXTENSION_CONFIG_MISSING",
      incomplete.map((entry) => `${entry.id} (${entry.missing.join(", ")})`).join("; "),
      `manifest 集合共 ${expected.length} 个插件，全部都必须可测；补齐配置或从 manifest 集合中移除。`,
    )
  }
  if (onlyId && !expected.includes(onlyId)) {
    fail("EXTENSION_NOT_FOUND", `plugin "${onlyId}" has no manifest.json`, `Discovered: ${expected.join(", ")}`)
  }

  const targets = onlyId ? [onlyId] : expected
  const sandbox = mkdtempSync(join(host, "node_modules", SANDBOX_PREFIX))
  const tested = []
  const failed = []

  try {
    prepareSandbox(host, targets, sandbox)

    for (const pluginId of targets) {
      const configPath = join(sandbox, `vitest-${pluginId}.generated.mjs`)
      const pluginSrc = join(sandbox, "extensions", pluginId, "src")
      const config = [
        "import react from '@vitejs/plugin-react'",
        "// 由 scripts/test-extensions.mjs 生成（一次性沙箱内，运行后随沙箱删除）。",
        "export default {",
        `  root: ${JSON.stringify(host)},`,
        "  plugins: [react()],",
        "  resolve: { alias: {",
        `    '@/i18n/config': ${JSON.stringify(join(pluginSrc, "i18n.ts"))},`,
        `    '@': ${JSON.stringify(join(sandbox, "host", "src"))},`,
        `    '@extension': ${JSON.stringify(pluginSrc)},`,
        "  } },",
        "  test: {",
        "    // 沙箱位于 node_modules 内：关闭默认 exclude（否则测试会被 **/node_modules/** 过滤掉）。",
        "    exclude: [],",
        "    globals: true,",
        "    environment: 'jsdom',",
        `    setupFiles: [${JSON.stringify(join(sandbox, "extensions", pluginId, "vitest.setup.ts"))}],`,
        `    include: [${JSON.stringify(join(pluginSrc, "**", "*.{test,spec}.{ts,tsx}"))}],`,
        "    css: false,",
        "  },",
        "}",
        "",
      ].join("\n")
      writeFileSync(configPath, config)

      progress(`[test:extensions] ${pluginId} …`)
      const result = spawnSync(HOST_VITEST(host), ["run", "--config", configPath], {
        cwd: host,
        encoding: "utf8",
        env: { ...process.env, BENCH_HOST_DIR: host, BENCH_MARKET_DIR: MARKET_ROOT },
        stdio: json ? "pipe" : "inherit",
      })

      if (result.status !== 0) {
        failed.push(pluginId)
        if (json) {
          console.error(String(result.stdout ?? ""))
          console.error(String(result.stderr ?? ""))
        }
        break
      }
      tested.push(pluginId)
    }
  } finally {
    // 一次性沙箱：无论成功、失败还是异常都不留残留，避免旧文件污染下一次运行。
    removeSandbox(sandbox)
  }

  const report = {
    host,
    market: MARKET_ROOT,
    sandbox,
    expected: expected.length,
    discovered: expected.length,
    tested: tested.length,
    skipped: expected.length - tested.length - failed.length,
    failed: failed.length,
    ignored,
    testedIds: tested,
    failedIds: failed,
  }
  if (json) console.log(JSON.stringify(report, null, 2))
  else {
    console.log(
      `[test:extensions] expected=${report.expected} discovered=${report.discovered} tested=${report.tested} ` +
        `skipped=${report.skipped} failed=${report.failed}`,
    )
  }

  if (failed.length > 0) {
    console.error(`[test:extensions] FAILED: ${failed.join(", ")}`)
    process.exit(1)
  }
  if (tested.length === 0) {
    fail("EXTENSION_ZERO_TESTED", "no plugin was actually tested")
  }
  if (report.skipped > 0) {
    fail(
      "EXTENSION_COVERAGE_INCOMPLETE",
      `skipped=${report.skipped} of expected=${report.expected}`,
      "覆盖率必须完整：manifest 集合里的每个插件都要真的跑过。",
    )
  }
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (isMain) main()
