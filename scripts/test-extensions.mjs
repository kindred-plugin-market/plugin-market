#!/usr/bin/env node
/**
 * 插件测试 runner（P04）：把宿主 src 与插件源复制进宿主 node_modules 的沙箱，
 * 用**宿主的 vitest + 宿主 node_modules** 执行，从而：
 *   - 所有裸导入（react / zustand / @testing-library/…）都落在宿主 node_modules，
 *     天然单份 React（避免宿主 src 与插件测试各解析出一份 → hooks dispatcher 失效）；
 *   - 沙箱位于 root 内，杜绝 /@fs/ 越根服务（rolldown-vite 的 fs.allow/strict
 *     对 root 外文件不生效，见 evidence/PLUGIN/P04/root-host-progress.log）。
 *
 * 沙箱布局（运行前重建、运行后删除）：
 *   <host>/node_modules/.bench-quality-cli/
 *     ├── host/src/                 ← 宿主 src 副本（`@` 指向这里）
 *     └── extensions/<id>/          ← 插件源副本（`@extension` 指向这里；含 setup 与测试）
 *
 * 契约（与 T20 一致）：--host 或 BENCH_HOST_DIR 指定宿主；缺输入/零发现/--id 未命中/
 * 零实测 → 非零退出；报告 expected/discovered/tested/skipped/failed；--json 单份 JSON。
 * **绝不执行规则/命令中的任何系统命令。**
 *
 * 用法：pnpm run test:extensions [--host <dir>] [--id <id>] [--json]
 */

import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const MARKET_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const EXTENSIONS_DIR = join(MARKET_ROOT, "extensions")
const HOST_VITEST = (host) => join(host, "node_modules", ".bin", "vitest")

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

function prepareSandbox(host, pluginIds) {
  // 沙箱采用「覆盖式重建」：cpSync 会覆盖同名文件。不做整树删除——
  // 文件数超过阈值时会触发环境的 safe-delete 防护（需逐次确认）。
  const sandbox = join(host, "node_modules", ".bench-quality-cli")
  mkdirSync(sandbox, { recursive: true })
  // 宿主 src 副本：`@` 指向这里。放在 <host>/node_modules 内 → 其裸导入向上
  // 解析仍落在宿主 node_modules（单份 react/zustand/…）。
  cpSync(join(host, "src"), join(sandbox, "host", "src"), { recursive: true })
  for (const id of pluginIds) {
    cpSync(join(EXTENSIONS_DIR, id), join(sandbox, "extensions", id), {
      recursive: true,
      filter: (source) => !/(^|[\\/])node_modules([\\/]|$)/.test(source),
    })
  }
  return sandbox
}


function main() {
  if (!existsSync(HOST_VITEST(host))) {
    fail(
      "VITEST_NOT_INSTALLED",
      `${HOST_VITEST(host)} was not found`,
      "The pinned host checkout must have its dependencies installed (`pnpm install` in the host).",
    )
  }
  if (!existsSync(EXTENSIONS_DIR)) {
    fail("EXTENSION_MARKET_MISSING", `${EXTENSIONS_DIR} does not exist`)
  }
  if (!existsSync(join(host, "package.json"))) {
    fail("BENCH_HOST_MISSING", `${host} is not a Bench host checkout`, "Pass --host <dir> or set BENCH_HOST_DIR.")
  }

  const all = readdirSync(EXTENSIONS_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  const configured = all
    .filter((entry) => existsSync(join(EXTENSIONS_DIR, entry.name, "vitest.config.ts")))
    .map((entry) => entry.name)
    .sort()
  const expected = all.length

  if (onlyId && !configured.includes(onlyId)) {
    fail("EXTENSION_NOT_FOUND", `plugin "${onlyId}" has no vitest.config.ts`, `Discovered: ${configured.join(", ") || "(none)"}`)
  }
  const targets = onlyId ? [onlyId] : configured
  if (targets.length === 0) {
    fail("EXTENSION_ZERO_DISCOVERY", `no plugin with a vitest.config.ts under ${EXTENSIONS_DIR}`)
  }

  const sandbox = prepareSandbox(host, targets)
  const tested = []
  const failed = []

  for (const pluginId of targets) {
    const configPath = join(host, "node_modules", ".bench-quality-cli", `vitest-${pluginId}.generated.mjs`)
    const pluginSrc = join(sandbox, "extensions", pluginId, "src")
    const config = [
      "import react from '@vitejs/plugin-react'",
      "// 由 scripts/test-extensions.mjs 生成（临时文件，运行后随沙箱删除）。",
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

  // 沙箱保留到下一次运行（视为构建产物，与 .vite-temp 同级、被 git 忽略）。

  const report = {
    host,
    market: MARKET_ROOT,
    expected,
    discovered: configured.length,
    tested: tested.length,
    skipped: expected - configured.length,
    failed: failed.length,
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
}

main()
