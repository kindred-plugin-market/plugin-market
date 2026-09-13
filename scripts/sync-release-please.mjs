#!/usr/bin/env node
/**
 * 同步 release-please 配置：extensions/ 下每个插件目录 = 一个独立发版包。
 *
 * 目的：新增插件时**只需**建 `extensions/<id>/`（含 manifest.json），
 * release-please 配置与版本清单自动补齐 —— 不必手改
 * `release-please-config.json` / `.release-please-manifest.json`。
 *
 * 约定（与既有配置一致）：
 * - package key = `extensions/<id>`，component = `<id>`
 * - extra-files：`manifest.json` 的 `$.version`
 * - 已有包的自定义字段**保留**（本脚本只补齐缺失项，不覆盖人工配置）
 *
 * 用法：
 *   node scripts/sync-release-please.mjs [--check]   # --check：有差异则退出码 1
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const marketDir = path.resolve(scriptDir, "..")

const args = process.argv.slice(2)
const checkOnly = args.includes("--check")

const CONFIG_FILE = "release-please-config.json"
const MANIFEST_FILE = ".release-please-manifest.json"

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"))
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function discoverPlugins() {
  const extDir = path.join(marketDir, "extensions")
  if (!existsSync(extDir)) {
    console.error(`[rp-sync] extensions dir not found: ${extDir}`)
    process.exit(1)
  }
  return readdirSync(extDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(extDir, d.name, "manifest.json")))
    .map((d) => {
      const id = d.name
      const manifest = readJson(path.join(extDir, id, "manifest.json"))
      return { id, version: manifest.version }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

function main() {
  const plugins = discoverPlugins()
  if (plugins.length === 0) {
    console.error("[rp-sync] no plugins found under extensions/")
    process.exit(1)
  }

  const configPath = path.join(marketDir, CONFIG_FILE)
  const manifestPath = path.join(marketDir, MANIFEST_FILE)
  const currentConfig = existsSync(configPath) ? readJson(configPath) : {}
  const currentManifest = existsSync(manifestPath) ? readJson(manifestPath) : {}

  const packages = {}
  for (const { id } of plugins) {
    const key = `extensions/${id}`
    const generated = {
      "release-type": "simple",
      component: id,
      "extra-files": [{ type: "json", path: "manifest.json", jsonpath: "$.version" }],
    }
    // 已有配置优先：只补齐缺失字段，保留人工自定义。
    packages[key] = { ...generated, ...(currentConfig.packages?.[key] ?? {}) }
  }

  const nextConfig = {
    ...(currentConfig.$schema ? { $schema: currentConfig.$schema } : {}),
    ...currentConfig,
    packages,
  }

  const nextManifest = {}
  for (const { id, version } of plugins) {
    const key = `extensions/${id}`
    nextManifest[key] = currentManifest[key] ?? version
  }

  const configChanged = JSON.stringify(nextConfig) !== JSON.stringify(currentConfig)
  const manifestChanged = JSON.stringify(nextManifest) !== JSON.stringify(currentManifest)

  for (const { id } of plugins) {
    const key = `extensions/${id}`
    if (!currentConfig.packages?.[key]) console.log(`[rp-sync] register new package: ${key}`)
  }

  if (checkOnly) {
    if (configChanged || manifestChanged) {
      console.error(`[rp-sync] ${CONFIG_FILE}/${MANIFEST_FILE} out of sync with extensions/`)
      process.exit(1)
    }
    console.log(`[rp-sync] in sync (${plugins.length} plugin(s))`)
    return
  }

  if (configChanged) {
    writeJson(configPath, nextConfig)
    console.log(`[rp-sync] ${CONFIG_FILE} updated (${Object.keys(packages).length} package(s))`)
  }
  if (manifestChanged) {
    writeJson(manifestPath, nextManifest)
    console.log(`[rp-sync] ${MANIFEST_FILE} updated`)
  }
  if (!configChanged && !manifestChanged) {
    console.log(`[rp-sync] already in sync (${plugins.length} plugin(s))`)
  }
}

main()
