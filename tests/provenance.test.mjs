// P09：来源收据脚本的自身测试（纯函数 + 进程级）。
//
// 收据是「测试结论可传递到产物」的凭证，因此它自己必须 fail-closed：
// SHA 必须是完整 40 位、dist 必须真的有 zip、host SHA 必须与唯一来源一致、
// 同一批输入必须产出逐字节相同的收据。
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { after, describe, it } from "node:test"

import {
  HOST_BASELINE_FILE,
  buildProvenance,
  fingerprintArtifacts,
  readHostBaseline,
} from "../scripts/write-provenance.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const SCRIPT = join(ROOT, "scripts", "write-provenance.mjs")
const MARKET_SHA = "a".repeat(40)

const tempDirs = []
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "provenance-"))
  tempDirs.push(dir)
  return dir
}

function distWith(zips) {
  const dir = tempDir()
  for (const [name, body] of Object.entries(zips)) writeFileSync(join(dir, name), body)
  return dir
}

function runScript(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, PNPM_VERSION: "12.4.1" },
  })
}

describe("宿主基线读取", () => {
  it("真实仓库给出完整 SHA", () => {
    assert.match(readHostBaseline(ROOT), /^[0-9a-f]{40}$/)
  })

  it("缺文件 / 非完整 SHA 一律抛错", () => {
    const empty = tempDir()
    assert.throws(() => readHostBaseline(empty), /BENCH_HOST_BASELINE_MISSING/)
    const bad = tempDir()
    mkdirSync(join(bad, ".github"), { recursive: true })
    writeFileSync(join(bad, HOST_BASELINE_FILE), "main\n")
    assert.throws(() => readHostBaseline(bad), /BENCH_HOST_BASELINE_INVALID/)
  })
})

describe("产物指纹", () => {
  it("按文件名排序并记录 sha256/size", () => {
    const dir = distWith({ "b.zip": "second\n", "a.zip": "first\n" })
    const artifacts = fingerprintArtifacts(dir)
    assert.deepEqual(
      artifacts.map((entry) => entry.file),
      ["a.zip", "b.zip"],
    )
    assert.equal(artifacts[0].sha256, createHash("sha256").update("first\n").digest("hex"))
    assert.equal(artifacts[0].size, "first\n".length)
  })

  it("dist 不存在或没有 zip 都失败", () => {
    assert.throws(() => fingerprintArtifacts(join(tempDir(), "nope")), /BENCH_DIST_MISSING/)
    assert.throws(() => fingerprintArtifacts(distWith({ "note.txt": "x" })), /BENCH_DIST_EMPTY/)
  })
})

describe("收据文档", () => {
  const base = {
    marketSha: MARKET_SHA,
    hostSha: "b".repeat(40),
    nodeVersion: "v26.8.2",
    pnpmVersion: "12.4.1",
    artifacts: [{ file: "a.zip", sha256: "c".repeat(64), size: 1 }],
    generatedAt: "2026-09-15T00:00:00Z",
  }

  it("记录 market/host/toolchain/artifacts，Rust channel 只在提供时出现", () => {
    const doc = buildProvenance(base)
    assert.equal(doc.schemaVersion, 1)
    assert.equal(doc.market.sha, MARKET_SHA)
    assert.equal(doc.host.sha, base.hostSha)
    assert.equal(doc.toolchain.pnpm, "12.4.1")
    assert.equal(doc.host.rust, undefined)
    assert.equal(buildProvenance({ ...base, rust: "1.98.1" }).host.rust, "1.98.1")
  })

  it("SHA 不是完整 40 位、或没有产物 → 抛错", () => {
    assert.throws(() => buildProvenance({ ...base, marketSha: "main" }), /BENCH_SHA_INVALID/)
    assert.throws(() => buildProvenance({ ...base, hostSha: "1003f48" }), /BENCH_SHA_INVALID/)
    assert.throws(() => buildProvenance({ ...base, artifacts: [] }), /BENCH_ARTIFACTS_MISSING/)
  })
})

describe("命令行行为", () => {
  it("同一批输入 + 固定时间戳 → 逐字节相同的收据", () => {
    const dir = distWith({ "bench-ext-demo-v1.0.0.zip": "zip-bytes" })
    const out1 = join(tempDir(), "p1.json")
    const out2 = join(tempDir(), "p2.json")
    const args = ["--dist", dir, "--market-sha", MARKET_SHA, "--generated-at", "2026-09-15T00:00:00Z"]
    assert.equal(runScript([...args, "--out", out1]).status, 0)
    assert.equal(runScript([...args, "--out", out2]).status, 0)
    assert.equal(readFileSync(out1, "utf8"), readFileSync(out2, "utf8"))

    const doc = JSON.parse(readFileSync(out1, "utf8"))
    assert.equal(doc.market.sha, MARKET_SHA)
    assert.equal(doc.host.sha, readHostBaseline(ROOT))
    assert.equal(doc.toolchain.pnpm, "12.4.1")
    assert.deepEqual(doc.artifacts.map((entry) => entry.file), ["bench-ext-demo-v1.0.0.zip"])
  })

  it("host SHA 与唯一来源不一致 → 失败（构建侧不得换宿主）", () => {
    const dir = distWith({ "a.zip": "x" })
    const result = runScript(["--dist", dir, "--market-sha", MARKET_SHA, "--host-sha", "c".repeat(40)])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /BENCH_HOST_SHA_MISMATCH/)
  })

  it("非法 market SHA / 缺 dist → 失败", () => {
    const dir = distWith({ "a.zip": "x" })
    assert.match(
      runScript(["--dist", dir, "--market-sha", "v1.35.0"]).stderr,
      /BENCH_SHA_INVALID/,
    )
    assert.match(
      runScript(["--dist", join(tempDir(), "missing"), "--market-sha", MARKET_SHA]).stderr,
      /BENCH_DIST_MISSING/,
    )
  })
})
