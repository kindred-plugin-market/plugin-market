#!/usr/bin/env node
/**
 * 更新插件市场索引 registry.json（P5 双仓库模型的「市场自持」半边）。
 *
 * 目标：只改本仓库（extensions/<id>/ + 走 release-please 发版）就能让 Bench
 * 插件中心看到新插件 / 新版本 —— 无需在 Bench 仓库执行 `update:ext-registry`、
 * 无需手改 registry.json、无需升级 Bench。
 *
 * 语义：**upsert**。只动目标插件的目标版本，保留其他插件条目、保留同一插件的
 * 历史版本、保留 `revoked` 与人工标注的 `yanked`（首次发布则新建条目）。
 *
 * 完整性（sha256 / size）以**真实字节**为准，两个来源都直接对文件计算：
 * - 本地 zip（CI 刚构建、还没上传完 / 或本地验证）：`--zip` 或 `--dist`；
 * - 否则：从 GitHub Release 资产下载（`--from-releases` 等价行为）。
 *
 * 用法：
 *   node scripts/update-registry.mjs --plugin <id> [--version <v>] [--zip <file> | --dist <dir>]
 *   node scripts/update-registry.mjs [--all] [--skip-missing] [--check]
 *   node scripts/update-registry.mjs --all --check        # CI 校验（不落盘）
 */

import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const valueOf = (name) => {
  const i = args.indexOf(name)
  return i !== -1 ? args[i + 1] : undefined
}
const valuesOf = (name) =>
  args.reduce((acc, arg, i) => (arg === name && args[i + 1] ? [...acc, args[i + 1]] : acc), [])

const marketDir = path.resolve(valueOf("--market") ?? path.resolve(scriptDir, ".."))
const distDir = valueOf("--dist")
const zipFile = valueOf("--zip")
const explicitVersion = valueOf("--version")
const skipMissing = flag("--skip-missing")
const checkOnly = flag("--check")

const ORG = "kindred-plugin-market"
const MARKET_REPO = "plugin-market"
const PUBLISHER_NAME = "Kindred Plugin Market"

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SEMVER_RE = /^\d+\.\d+\.\d+$/
const SHA256_RE = /^[0-9a-f]{64}$/

function fail(message) {
  console.error(`[registry] ${message}`)
  process.exit(1)
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"))
}

/** extensions/<id>/ 下带 manifest.json 的目录 = 一个可发布插件。 */
function discoverIds() {
  const extDir = path.join(marketDir, "extensions")
  if (!existsSync(extDir)) fail(`extensions dir not found: ${extDir}`)
  return readdirSync(extDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(extDir, d.name, "manifest.json")))
    .map((d) => d.name)
    .sort()
}

function loadManifest(id) {
  const file = path.join(marketDir, "extensions", id, "manifest.json")
  const manifest = readJson(file)
  if (manifest.id && manifest.id !== id) {
    fail(`${id}: manifest.id \`${manifest.id}\` does not match directory name`)
  }
  const version = manifest.version
  if (typeof version !== "string" || !SEMVER_RE.test(version)) {
    fail(`${id}: manifest.version \`${version}\` is not semver`)
  }
  if (!ID_RE.test(id)) fail(`${id}: invalid extension id`)
  return manifest
}

function assetName(id, version) {
  return `bench-ext-${id}-v${version}.zip`
}

function downloadUrl(id, version) {
  return `https://github.com/${ORG}/${MARKET_REPO}/releases/download/${id}-v${version}/${assetName(id, version)}`
}

async function fetchReleaseAssetBytes(id, version) {
  const tag = `${id}-v${version}`
  const api = `https://api.github.com/repos/${ORG}/${MARKET_REPO}/releases/tags/${tag}`
  const res = await fetch(api, {
    headers: { accept: "application/vnd.github+json", "user-agent": "bench-market-registry" },
  })
  if (!res.ok) throw new Error(`release ${tag} not found (HTTP ${res.status})`)
  const release = await res.json()
  const asset = (release.assets ?? []).find((a) => a.name === assetName(id, version))
  if (!asset) throw new Error(`asset ${assetName(id, version)} missing on release ${tag}`)
  const download = await fetch(asset.browser_download_url, { redirect: "follow" })
  if (!download.ok) throw new Error(`asset download failed (HTTP ${download.status})`)
  return Buffer.from(await download.arrayBuffer())
}

/** zip 字节来源：--zip > --dist/<asset> > GitHub Release 资产。 */
async function resolveBytes(id, version) {
  if (zipFile) {
    if (!existsSync(zipFile)) throw new Error(`--zip not found: ${zipFile}`)
    return { bytes: readFileSync(zipFile), source: `local:${path.relative(marketDir, zipFile)}` }
  }
  if (distDir) {
    const candidate = path.join(distDir, assetName(id, version))
    if (existsSync(candidate)) {
      return { bytes: readFileSync(candidate), source: `dist:${assetName(id, version)}` }
    }
  }
  const bytes = await fetchReleaseAssetBytes(id, version)
  return { bytes, source: `release:${id}-v${version}` }
}

function compareSemverDesc(a, b) {
  const pa = a.split(".").map(Number)
  const pb = b.split(".").map(Number)
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pb[i] - pa[i]
  }
  return 0
}

/** 版本条目 upsert（同版本则更新字节信息，保留 publishedAt / yanked）。 */
function upsertVersion(versions, next) {
  const index = versions.findIndex((v) => v.version === next.version)
  if (index === -1) {
    versions.push(next)
  } else {
    const prev = versions[index]
    versions[index] = {
      version: next.version,
      engines: next.engines,
      downloadUrl: next.downloadUrl,
      sha256: next.sha256,
      size: next.size,
      publishedAt: prev.publishedAt ?? next.publishedAt,
      yanked: prev.yanked ?? false,
    }
  }
  versions.sort((a, b) => compareSemverDesc(a.version, b.version))
}

function upsertEntry(registry, entry) {
  const index = registry.extensions.findIndex((e) => e.id === entry.id)
  if (index === -1) {
    registry.extensions.push(entry)
  } else {
    const prev = registry.extensions[index]
    upsertVersion(prev.versions ?? (prev.versions = []), entry.versions[0])
    registry.extensions[index] = {
      id: entry.id,
      display: entry.display,
      description: entry.description,
      publisher: prev.publisher ?? entry.publisher,
      versions: prev.versions,
    }
  }
  registry.extensions.sort((a, b) => a.id.localeCompare(b.id))
}

function buildEntry(manifest, id, version, bytes) {
  const display = manifest.display ?? { en: id }
  if (!display.en) fail(`${id}: manifest.display.en is required`)
  const description = manifest.description ?? {
    en: display.en,
    ...(display.zh ? { zh: display.zh } : {}),
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  return {
    id,
    display,
    description,
    publisher: { name: PUBLISHER_NAME },
    versions: [
      {
        version,
        engines: manifest.engines ?? { bench: "*" },
        downloadUrl: downloadUrl(id, version),
        sha256,
        size: bytes.length,
        publishedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
        yanked: false,
      },
    ],
  }
}

async function main() {
  const requested = valuesOf("--plugin")
  const ids = requested.length > 0 ? requested : discoverIds()
  if (ids.length === 0) fail("no plugins found under extensions/")
  if (explicitVersion && ids.length !== 1) {
    fail("--version requires exactly one --plugin")
  }
  if (zipFile && ids.length !== 1) fail("--zip requires exactly one --plugin")

  const registryPath = path.join(marketDir, "registry.json")
  const registry = existsSync(registryPath)
    ? readJson(registryPath)
    : { schemaVersion: 1, updatedAt: null, extensions: [], revoked: [] }
  if (!Array.isArray(registry.extensions)) registry.extensions = []
  if (!Array.isArray(registry.revoked)) registry.revoked = []
  // updatedAt 只是「索引刷新时间」，不算内容变更（否则 --check 永远报 changed）。
  const fingerprint = (doc) =>
    JSON.stringify({ schemaVersion: doc.schemaVersion, extensions: doc.extensions, revoked: doc.revoked })
  const before = fingerprint(registry)

  const skipped = []
  for (const id of ids) {
    const manifest = loadManifest(id)
    const version = explicitVersion ?? manifest.version
    if (!SEMVER_RE.test(version)) fail(`${id}: version \`${version}\` is not semver`)
    let bytes
    let source
    try {
      const resolved = await resolveBytes(id, version)
      bytes = resolved.bytes
      source = resolved.source
    } catch (error) {
      if (skipMissing) {
        skipped.push(`${id}@${version} (${error.message})`)
        console.warn(`[registry] skip ${id}@${version}: ${error.message}`)
        continue
      }
      fail(`${id}@${version}: ${error.message}`)
    }
    const entry = buildEntry(manifest, id, version, bytes)
    const sha = entry.versions[0].sha256
    if (!SHA256_RE.test(sha)) fail(`${id}: computed sha256 invalid`)
    upsertEntry(registry, entry)
    console.log(
      `[registry] ${id}@${version}: ${bytes.length} bytes, sha256 ${sha.slice(0, 12)}… (${source})`,
    )
  }

  registry.schemaVersion = 1
  const changed = fingerprint(registry) !== before
  if (changed) registry.updatedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z")
  const after = JSON.stringify(registry, null, 2)

  if (checkOnly) {
    if (changed) {
      console.log("[registry] check: registry.json would change (run without --check to write)")
      console.log(after)
    } else {
      console.log("[registry] check: registry.json already up to date")
    }
    if (skipped.length > 0) console.log(`[registry] skipped: ${skipped.join("; ")}`)
    return
  }

  writeFileSync(registryPath, `${after}\n`)
  console.log(
    `[registry] ${registryPath} written (${registry.extensions.length} extension(s), ${skipped.length} skipped)`,
  )
}

main().catch((error) => fail(error.message))
