// P08：插件测试 runner 的 fail-closed 自身测试。
//
// runner 是「插件覆盖率」的唯一执行者，它自己的行为必须可被负向验证。这里用假
// vitest（stub）与临时市场/宿主 fixture 跑真实的 runner 进程：
//   - expected 由 manifest.json 决定，缺测试契约必败（不能退化成「跳过」）；
//   - 每次运行一次性沙箱，结束后无残留（删文件不会污染下一次运行）；
//   - 单插件失败后计数正确、且覆盖率不完整必须非零退出；
//   - 含空格的宿主路径可运行（路径必须按数组传递，不能被 shell 拆词）。
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { after, describe, it } from "node:test"

import { discoverExtensions, missingTestContract } from "../scripts/test-extensions.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const RUNNER = join(ROOT, "scripts", "test-extensions.mjs")
const SANDBOX_PREFIX = ".bench-quality-cli-"

const STUB_VITEST = `#!/usr/bin/env node
// 假 vitest：只用于 runner 自身测试。BENCH_TEST_STUB_FAIL=<id> 表示让该插件的运行失败。
const config = process.argv[process.argv.indexOf("--config") + 1] ?? ""
const failFor = process.env.BENCH_TEST_STUB_FAIL
if (failFor && config.includes("vitest-" + failFor + ".generated.mjs")) {
  console.error("stub vitest: intentional failure for " + failFor)
  process.exit(1)
}
console.log("stub vitest: ok " + config)
process.exit(0)
`

const tempDirs = []
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

function makeHost({ withVitest = true, space = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), space ? "bench host " : "bench-host-"))
  tempDirs.push(dir)
  mkdirSync(join(dir, "src"), { recursive: true })
  writeFileSync(join(dir, "package.json"), `{ "name": "bench-host" }\n`)
  if (withVitest) {
    mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true })
    const bin = join(dir, "node_modules", ".bin", "vitest")
    writeFileSync(bin, STUB_VITEST)
    chmodSync(bin, 0o755)
  }
  return dir
}

function makeMarket(ids, { contract = true, extraDirs = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "market-"))
  tempDirs.push(dir)
  mkdirSync(join(dir, "extensions"), { recursive: true })
  for (const id of ids) {
    const pluginDir = join(dir, "extensions", id)
    mkdirSync(join(pluginDir, "src"), { recursive: true })
    writeFileSync(join(pluginDir, "manifest.json"), `${JSON.stringify({ id, name: id, version: "1.0.0" })}\n`)
    if (contract) {
      writeFileSync(join(pluginDir, "vitest.config.ts"), "export default {}\n")
      writeFileSync(join(pluginDir, "vitest.setup.ts"), "export {}\n")
    }
    writeFileSync(join(pluginDir, "src", `${id}.test.ts`), "// fixture test\n")
  }
  for (const name of extraDirs) mkdirSync(join(dir, "extensions", name), { recursive: true })
  return dir
}

function runRunner({ host, market, args = [], env = {} }) {
  return spawnSync(process.execPath, [RUNNER, "--host", host, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, BENCH_MARKET_DIR: market, ...env },
  })
}

const reportOf = (result) => JSON.parse(result.stdout)

describe("runner 发现逻辑（纯函数）", () => {
  it("expected 由 manifest.json 决定，没有 manifest 的目录只被报告", () => {
    const market = makeMarket(["b-plugin", "a-plugin"], { extraDirs: ["notes"] })
    assert.deepEqual(discoverExtensions(join(market, "extensions")), {
      expected: ["a-plugin", "b-plugin"],
      ignored: ["notes"],
    })
  })

  it("缺 config 与缺 setup 都会被点名（沿用传入顺序，main 传的是已排序集合）", () => {
    const market = makeMarket(["ok", "no-config"])
    rmSync(join(market, "extensions", "no-config", "vitest.config.ts"))
    rmSync(join(market, "extensions", "ok", "vitest.setup.ts"))
    assert.deepEqual(missingTestContract(join(market, "extensions"), ["no-config", "ok"]), [
      { id: "no-config", missing: ["vitest.config.ts"] },
      { id: "ok", missing: ["vitest.setup.ts"] },
    ])
  })
})

describe("runner 进程行为", () => {
  it("缺测试契约必败（不退化成 skipped）", () => {
    const market = makeMarket(["with-config", "no-config"])
    rmSync(join(market, "extensions", "no-config", "vitest.config.ts"))
    const host = makeHost()
    const result = runRunner({ host, market })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /EXTENSION_CONFIG_MISSING/)
    assert.match(result.stderr, /no-config \(vitest\.config\.ts\)/)
    // 一个都不该跑：契约不完整时不能产出部分绿灯。
    assert.doesNotMatch(result.stdout, /\[test:extensions\] with-config/)
  })

  it("零发现必败（空 extensions 目录）", () => {
    const market = makeMarket([])
    const host = makeHost()
    const result = runRunner({ host, market })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /EXTENSION_ZERO_DISCOVERY/)
  })

  it("--id 未命中必败并列出已发现集合", () => {
    const market = makeMarket(["alpha"])
    const host = makeHost()
    const result = runRunner({ host, market, args: ["--id", "zzz"] })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /EXTENSION_NOT_FOUND/)
    assert.match(result.stderr, /Discovered: alpha/)
  })

  it("一次性沙箱：每次唯一且在结束后不存在", () => {
    const market = makeMarket(["one", "two"])
    const host = makeHost()
    const first = runRunner({ host, market, args: ["--json"] })
    assert.equal(first.status, 0, first.stderr)
    const firstReport = reportOf(first)
    assert.equal(firstReport.tested, 2)
    assert.match(firstReport.sandbox, new RegExp(`${SANDBOX_PREFIX}[^/]+$`))
    assert.equal(existsSync(firstReport.sandbox), false, "沙箱必须在 finally 里被删除")

    const second = runRunner({ host, market, args: ["--json"] })
    assert.equal(second.status, 0, second.stderr)
    const secondReport = reportOf(second)
    assert.notEqual(secondReport.sandbox, firstReport.sandbox, "每次运行必须是新沙箱")
    const leftovers = readdirSync(join(host, "node_modules")).filter((name) => name.startsWith(SANDBOX_PREFIX))
    assert.deepEqual(leftovers, [], "宿主 node_modules 不得残留沙箱")
  })

  it("删除插件源文件不会把旧文件带到下一次运行", () => {
    const market = makeMarket(["solo"])
    const host = makeHost()
    // 预置污染：模拟上一次运行留下的、已被删除的源文件。
    const stale = join(host, "node_modules", `${SANDBOX_PREFIX}stale`, "extensions", "solo", "src")
    mkdirSync(stale, { recursive: true })
    writeFileSync(join(stale, "deleted-file.test.ts"), "// stale\n")

    const result = runRunner({ host, market, args: ["--json"] })
    assert.equal(result.status, 0, result.stderr)
    const report = reportOf(result)
    assert.equal(existsSync(join(report.sandbox, "extensions", "solo", "src", "deleted-file.test.ts")), false)
  })

  it("单插件失败后计数正确且覆盖率不完整必败", () => {
    const market = makeMarket(["alpha", "beta", "gamma"])
    const host = makeHost()
    const result = runRunner({ host, market, args: ["--json"], env: { BENCH_TEST_STUB_FAIL: "beta" } })
    assert.equal(result.status, 1)
    const report = reportOf(result)
    assert.equal(report.expected, 3)
    assert.equal(report.tested, 1)
    assert.equal(report.failed, 1)
    assert.equal(report.skipped, 1)
    assert.deepEqual(report.failedIds, ["beta"])
    assert.deepEqual(report.testedIds, ["alpha"])
    assert.match(result.stderr, /FAILED: beta/)
    assert.equal(existsSync(report.sandbox), false, "失败路径也必须清理沙箱")
  })

  it("含空格的宿主路径可运行", () => {
    const market = makeMarket(["solo"])
    const host = makeHost({ space: true })
    assert.match(host, / /)
    const result = runRunner({ host, market, args: ["--json"] })
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
    assert.equal(reportOf(result).tested, 1)
  })

  it("宿主没装依赖时给出 VITEST_NOT_INSTALLED", () => {
    const market = makeMarket(["solo"])
    const host = makeHost({ withVitest: false })
    const result = runRunner({ host, market })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /VITEST_NOT_INSTALLED/)
  })
})

describe("真实市场静态契约（8/8 的前提）", () => {
  it("每个插件目录都有 manifest.json，测试契约完整", () => {
    const { expected, ignored } = discoverExtensions(join(ROOT, "extensions"))
    assert.equal(expected.length, 8, `期望 8 个插件，实际 ${expected.length}`)
    assert.deepEqual(ignored, [], "extensions/ 下不允许出现没有 manifest.json 的目录")
    assert.deepEqual(missingTestContract(join(ROOT, "extensions"), expected), [])
  })
})
