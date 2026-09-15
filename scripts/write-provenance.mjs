#!/usr/bin/env node
/**
 * 构建来源收据（P09 / 审计 R07）：
 * 把「这批产物到底是用什么输入造出来的」写成机器可核对的 JSON，随产物一起发布。
 * 审计要求的输入清单：market SHA、host SHA、Node、pnpm、Rust、zip sha256。
 *
 * 关键不变量：
 *   - 两个 SHA 都必须是完整 40 位 commit SHA（不接受分支/短 SHA/浮动 ref）——
 *     否则「测试结论可传递到产物」不成立；
 *   - host SHA 默认读 `.github/host-baseline.txt`（三个工作流共用的唯一来源），
 *     显式传 `--host-sha` 必须与它一致，防止构建侧偷偷用别的宿主；
 *   - dist 里必须至少有一个 zip，逐个记录 sha256 与字节数（缺目录/空目录都失败）；
 *   - `--generated-at` 可固定时间戳，使同一批输入产出逐字节相同的收据。
 *
 * 用法：
 *   node scripts/write-provenance.mjs --dist <dir> [--out <file>] \
 *     [--market-sha <sha>] [--host-sha <sha>] [--host-dir <bench checkout>] \
 *     [--generated-at <iso>]
 * 默认输出 `<dist>/provenance.json`。
 */

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
export const HOST_BASELINE_FILE = ".github/host-baseline.txt"
const SHA_RE = /^[0-9a-f]{40}$/

/** 读取唯一的 HOST_BASELINE_SHA；文件缺失或不是完整 SHA 一律抛错（fail-closed）。 */
export function readHostBaseline(repoRoot = REPO_ROOT) {
  const file = join(repoRoot, HOST_BASELINE_FILE)
  if (!existsSync(file)) {
    throw new Error(`BENCH_HOST_BASELINE_MISSING: ${HOST_BASELINE_FILE} does not exist`)
  }
  const sha = readFileSync(file, "utf8").trim()
  if (!SHA_RE.test(sha)) {
    throw new Error(`BENCH_HOST_BASELINE_INVALID: ${HOST_BASELINE_FILE} must contain a 40-char commit sha, got "${sha}"`)
  }
  return sha
}

/** dist 里的 zip 逐个记录 sha256/size（按文件名排序 → 输出稳定）。 */
export function fingerprintArtifacts(distDir) {
  if (!existsSync(distDir)) {
    throw new Error(`BENCH_DIST_MISSING: ${distDir} does not exist`)
  }
  const files = readdirSync(distDir)
    .filter((name) => name.endsWith(".zip"))
    .sort()
  if (files.length === 0) {
    throw new Error(`BENCH_DIST_EMPTY: no *.zip under ${distDir}`)
  }
  return files.map((file) => {
    const bytes = readFileSync(join(distDir, file))
    return { file, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length }
  })
}

/** 组装收据文档（纯函数，便于测试与复现）。 */
export function buildProvenance({ marketSha, hostSha, nodeVersion, pnpmVersion, rust, artifacts, generatedAt }) {
  for (const [field, value] of [
    ["marketSha", marketSha],
    ["hostSha", hostSha],
  ]) {
    if (!SHA_RE.test(String(value ?? ""))) {
      throw new Error(`BENCH_SHA_INVALID: ${field} must be a 40-char commit sha, got "${value}"`)
    }
  }
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error("BENCH_ARTIFACTS_MISSING: provenance needs at least one artifact")
  }
  return {
    schemaVersion: 1,
    generatedAt,
    market: { repository: "kindred-plugin-market/plugin-market", sha: marketSha },
    host: { repository: "indredK/bench", sha: hostSha, ...(rust ? { rust } : {}) },
    toolchain: { node: nodeVersion, pnpm: pnpmVersion },
    artifacts,
  }
}

function gitHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" })
  return result.status === 0 ? result.stdout.trim() : null
}

function hostRustChannel(hostDir) {
  const file = join(resolve(hostDir), "rust-toolchain.toml")
  if (!existsSync(file)) return undefined
  const channel = readFileSync(file, "utf8").match(/^\s*channel\s*=\s*"([^"]+)"/m)
  return channel ? channel[1] : undefined
}

function valueOf(flag) {
  const index = process.argv.indexOf(flag)
  return index === -1 ? null : process.argv[index + 1]
}

function main() {
  if (process.argv.includes("--help")) {
    console.log("usage: write-provenance.mjs --dist <dir> [--out <file>] [--market-sha <sha>] [--host-sha <sha>] [--host-dir <dir>] [--generated-at <iso>]")
    return
  }
  try {
    const distDir = resolve(valueOf("--dist") ?? "dist")
    const outFile = resolve(valueOf("--out") ?? join(distDir, "provenance.json"))
    const marketSha = valueOf("--market-sha") ?? process.env.GITHUB_SHA ?? gitHead()
    const hostSha = valueOf("--host-sha") ?? readHostBaseline()
    // 显式 --host-sha 与唯一来源不一致 → 直接失败（构建侧不得用别的宿主）。
    const baseline = readHostBaseline()
    if (hostSha !== baseline) {
      throw new Error(`BENCH_HOST_SHA_MISMATCH: --host-sha ${hostSha} != ${HOST_BASELINE_FILE} ${baseline}`)
    }
    const hostDir = valueOf("--host-dir")
    const provenance = buildProvenance({
      marketSha,
      hostSha,
      nodeVersion: process.version,
      pnpmVersion: process.env.PNPM_VERSION ?? null,
      rust: hostDir ? hostRustChannel(hostDir) : undefined,
      artifacts: fingerprintArtifacts(distDir),
      generatedAt: valueOf("--generated-at") ?? new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    })
    writeFileSync(outFile, `${JSON.stringify(provenance, null, 2)}\n`)
    console.log(
      `[provenance] ${outFile} — market=${provenance.market.sha.slice(0, 7)} host=${provenance.host.sha.slice(0, 7)} ` +
        `artifacts=${provenance.artifacts.length} node=${provenance.toolchain.node} pnpm=${provenance.toolchain.pnpm ?? "(unknown)"}`,
    )
  } catch (error) {
    console.error(`[provenance] ${error.message}`)
    process.exit(1)
  }
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (isMain) main()
