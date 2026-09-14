#!/usr/bin/env node
/**
 * 插件双语 locale 门禁（KEY-05）：以 manifest 发现完整插件集合，对每个插件强制校验
 * zh/en 成对、解析前重复 JSON 键、结构/叶子类型、插值 token 一致、非预期空值与真实引用。
 *
 * 与现有 audit-i18n.mjs（仅查 zh 自包含）互补：本脚本补齐“双语 parity + 负向必败”维度。
 * 关键不变量（来自 03 §4 步骤11–12）：
 *   - 不能要求先有 zh.json 才发现插件：发现以 manifest.json 为准。
 *   - 0 插件 / 缺 locale / 未知 --plugin id / 解析失败 必须非零退出。
 *   - expected（manifest 集合）、discovered、checked 数量都输出。
 *
 * 用法：
 *   node scripts/check-i18n-parity.mjs \
 *     --market /abs/plugin-market --bench /abs/tauri-app [--plugin <id>] [--strict-empty]
 */

import { readFileSync, readdirSync, statSync, existsSync, rmSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, "..", "..")

const args = process.argv.slice(2)
const valueOf = (name) => {
  const i = args.indexOf(name)
  return i !== -1 ? args[i + 1] : undefined
}
const onlyPlugin = valueOf("--plugin")
const strictEmpty = args.includes("--strict-empty")

function resolveBenchRoot() {
  const explicit = valueOf("--bench")
  if (explicit) return path.resolve(explicit)
  if (existsSync(path.join(repoRoot, "src"))) return repoRoot
  for (const c of [path.resolve(repoRoot, "..", "bench"), path.resolve(repoRoot, "..", "..", "bench")]) {
    if (existsSync(path.join(c, "src"))) return c
  }
  return repoRoot
}
const root = resolveBenchRoot()
const marketDefault = path.resolve(root, "..", "kindred-plugin-market", "plugin-market")
const marketDir = path.resolve(valueOf("--market") ?? marketDefault)

/* ── 严格 JSON 解析：解析前检测重复键（JSON.parse 会静默去重，掩盖重复键） ── */
function parseStrict(text, label) {
  let i = 0
  const len = text.length
  const isWs = (c) => /\s/.test(c)
  const skipWs = () => {
    while (i < len && isWs(text[i])) i++
  }
  const parseString = () => {
    i++
    let s = ""
    while (i < len) {
      const c = text[i++]
      if (c === "\\") {
        const e = text[i++]
        s += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e === '"' ? '"' : e === "\\" ? "\\" : e
      } else if (c === '"') return s
      else s += c
    }
    throw new Error(`${label}: 未闭合字符串`)
  }
  const parseLiteral = () => {
    const start = i
    while (i < len && !/[,}\]]/.test(text[i])) i++
    return JSON.parse(text.slice(start, i))
  }
  const parseValue = (keyPath) => {
    skipWs()
    const ch = text[i]
    if (ch === "{") return parseObject(keyPath)
    if (ch === "[") return parseArray(keyPath)
    if (ch === '"') return parseString()
    return parseLiteral()
  }
  const parseObject = (keyPath) => {
    i++
    const obj = {}
    skipWs()
    if (text[i] === "}") {
      i++
      return obj
    }
    while (true) {
      skipWs()
      if (text[i] !== '"') throw new Error(`${label}: 期望对象键`)
      const key = parseString()
      const fullKey = keyPath ? `${keyPath}.${key}` : key
      skipWs()
      if (text[i] !== ":") throw new Error(`${label}: 键 ${fullKey} 后期望 :`)
      i++
      const val = parseValue(fullKey)
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        throw new Error(`${label}: 重复 JSON 键 ${fullKey}`)
      }
      obj[key] = val
      skipWs()
      if (text[i] === ",") {
        i++
        continue
      }
      if (text[i] === "}") {
        i++
        return obj
      }
      throw new Error(`${label}: 键 ${fullKey} 后期望 , 或 }`)
    }
  }
  const parseArray = (keyPath) => {
    i++
    const arr = []
    skipWs()
    if (text[i] === "]") {
      i++
      return arr
    }
    while (true) {
      arr.push(parseValue(keyPath))
      skipWs()
      if (text[i] === ",") {
        i++
        continue
      }
      if (text[i] === "]") {
        i++
        return arr
      }
      throw new Error(`${label}: 数组期望 , 或 ]`)
    }
  }
  const result = parseValue("")
  skipWs()
  if (i !== len) throw new Error(`${label}: 尾部多余字符`)
  return result
}

const flatten = (obj, prefix = "") => {
  const out = {}
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flatten(v, key))
    else out[key] = v
  }
  return out
}

const interpTokens = (s) => {
  if (typeof s !== "string") return new Set()
  return new Set([...s.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1].trim()))
}

const walk = (dir, acc = []) => {
  if (!existsSync(dir)) return acc
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx)$/.test(name)) acc.push(p)
  }
  return acc
}

function collectKeys(files) {
  const statics = new Set()
  const dynamics = []
  for (const f of files) {
    const src = readFileSync(f, "utf8")
    for (const m of src.matchAll(/\bt\(\s*["'`]([^"'`]+)["'`]/g)) {
      const raw = m[1]
      if (raw.includes("${")) dynamics.push({ file: f, raw })
      else if (/^[a-zA-Z][\w-]*(\.[\w-]+)+$/.test(raw)) statics.add(raw)
    }
  }
  return { statics: [...statics], dynamics }
}

function resolveHostFiles(specifiers) {
  const files = []
  for (const spec of specifiers) {
    const base = path.join(root, "src", spec.slice(2))
    if (existsSync(base) && statSync(base).isDirectory()) files.push(...walk(base))
    else for (const ext of [".ts", ".tsx"]) if (existsSync(base + ext)) files.push(base + ext)
  }
  return files
}

/* ── 发现插件：以 manifest.json 为准（不依赖 zh.json 是否存在） ── */
function discoverPlugins() {
  const extDir = path.join(marketDir, "extensions")
  if (!existsSync(extDir)) return []
  return readdirSync(extDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(extDir, d.name, "manifest.json")))
    .map((d) => d.name)
    .sort()
}

async function main() {
  const expected = discoverPlugins()
  console.log(`[check-i18n-parity] market: ${marketDir}`)
  console.log(`[check-i18n-parity] expected (manifest): ${expected.length} → ${expected.join(", ") || "(none)"}`)

  if (expected.length === 0) {
    console.error("[check-i18n-parity] FAIL: 0 插件（manifest 集合为空）—— 不能当作通过。")
    process.exit(1)
  }

  const ids = onlyPlugin ? expected.filter((id) => id === onlyPlugin) : expected
  if (onlyPlugin && ids.length === 0) {
    console.error(`[check-i18n-parity] FAIL: 未知 --plugin "${onlyPlugin}"（不在 manifest 集合中）。`)
    process.exit(1)
  }

  let failures = 0
  let checked = 0
  for (const pid of ids) {
    const base = path.join(marketDir, "extensions", pid)
    const zhPath = path.join(base, "locales", "zh.json")
    const enPath = path.join(base, "locales", "en.json")
    const problems = []

    if (!existsSync(zhPath)) problems.push("缺少 locales/zh.json")
    if (!existsSync(enPath)) problems.push("缺少 locales/en.json")
    if (problems.length > 0) {
      failures++
      console.log(`== ${pid} == ✗ ${problems.join("; ")}`)
      continue
    }

    let zhRaw, enRaw
    try {
      zhRaw = parseStrict(readFileSync(zhPath, "utf8"), `${pid}/zh.json`)
    } catch (e) {
      failures++
      console.log(`== ${pid} == ✗ zh.json 解析失败：${e.message}`)
      continue
    }
    try {
      enRaw = parseStrict(readFileSync(enPath, "utf8"), `${pid}/en.json`)
    } catch (e) {
      failures++
      console.log(`== ${pid} == ✗ en.json 解析失败：${e.message}`)
      continue
    }

    const zh = flatten(zhRaw.translation ?? zhRaw)
    const en = flatten(enRaw.translation ?? enRaw)

    // parity：双方叶子键集合必须一致
    const zhKeys = Object.keys(zh)
    const enKeys = Object.keys(en)
    const onlyZh = zhKeys.filter((k) => !(k in en))
    const onlyEn = enKeys.filter((k) => !(k in zh))
    for (const k of onlyZh) problems.push(`key 仅在 zh: ${k}`)
    for (const k of onlyEn) problems.push(`key 仅在 en: ${k}`)

    // 插值 token 一致性 + 非预期空值
    const common = zhKeys.filter((k) => k in en)
    for (const k of common) {
      const tz = interpTokens(zh[k])
      const te = interpTokens(en[k])
      for (const tok of tz) if (!te.has(tok)) problems.push(`插值 ${tok} 仅在 zh.${k}`)
      for (const tok of te) if (!tz.has(tok)) problems.push(`插值 ${tok} 仅在 en.${k}`)
      if (strictEmpty || true) {
        if (zh[k] === "") problems.push(`zh.${k} 为空值`)
        if (en[k] === "") problems.push(`en.${k} 为空值`)
      }
    }

    // 真实引用：源码（含经 @/ 引用的宿主共享模块）引用的 key 必须双语都存在
    const pluginFiles = walk(path.join(base, "src"))
    const hostSpecifiers = new Set()
    for (const f of pluginFiles) {
      const src = readFileSync(f, "utf8")
      for (const m of src.matchAll(/from ["'](@\/[^"']+)["']/g)) hostSpecifiers.add(m[1])
    }
    const hostFiles = resolveHostFiles([...hostSpecifiers])
    const { statics, dynamics } = collectKeys([...pluginFiles, ...hostFiles])
    for (const k of statics) {
      if (!(k in zh) || !(k in en)) problems.push(`引用 key 缺失双语: ${k}`)
    }
    for (const { raw, file } of dynamics) {
      const family = raw.split("${")[0].replace(/\.$/, "")
      const ok = [...zhKeys, ...enKeys].some((k) => k.startsWith(family))
      if (!ok) problems.push(`动态族未覆盖: ${raw} (${path.relative(base, file)})`)
    }

    checked++
    if (problems.length > 0) {
      failures++
      console.log(`== ${pid} == ✗ ${problems.length} 项问题`)
      for (const p of problems.slice(0, 40)) console.log(`    - ${p}`)
    } else {
      console.log(`== ${pid} == ✓ parity leaf=${zhKeys.length} hostModules=${hostSpecifiers.size} refs=${statics.length}`)
    }
  }

  console.log(
    `\n[check-i18n-parity] expected=${expected.length} discovered=${ids.length} checked=${checked} failed=${failures}`,
  )
  process.exit(failures > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(`[check-i18n-parity] ${error.message}`)
  process.exit(1)
})
