// P08 / 审计 R04：i18n parity 的宿主输入必须 fail-closed。
//
// 旧行为：`--bench <坏目录>` 不报错，只少解析宿主模块与引用（本机实测 refs 92→91）
// 后照常 exit 0 —— 静态工作流守卫只能挡住已知 YAML 形态。这里用四类负向输入 +
// 一类正向输入把运行时契约钉住。
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { after, describe, it } from "node:test"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const PARITY = join(ROOT, "scripts", "check-i18n-parity.mjs")

const tempDirs = []
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function runParity(bench) {
  return spawnSync(process.execPath, [PARITY, "--market", ROOT, "--bench", bench], {
    cwd: ROOT,
    encoding: "utf8",
  })
}

/** 真实宿主：CI 里是 host/（actions/checkout path: host），本机是 ../../tauri-app。 */
function resolveRealHost() {
  const candidates = [
    process.env.BENCH_HOST_DIR,
    join(ROOT, "host"),
    join(ROOT, "..", "..", "tauri-app"),
  ].filter(Boolean)
  return candidates.find((dir) => existsSync(join(dir, "src", "i18n")))
}

describe("check-i18n-parity 的宿主输入校验（R04）", () => {
  it("不存在的路径 → BENCH_HOST_MISSING", () => {
    const result = runParity(join(tempDir("parity-missing-"), "nope"))
    assert.equal(result.status, 1, `${result.stdout}${result.stderr}`)
    assert.match(result.stderr, /BENCH_HOST_MISSING/)
    assert.match(result.stderr, /不存在/)
    assert.match(result.stderr, /hint: --bench/)
  })

  it("空目录 → BENCH_HOST_MISSING（缺少 package.json）", () => {
    const result = runParity(tempDir("parity-empty-"))
    assert.equal(result.status, 1)
    assert.match(result.stderr, /BENCH_HOST_MISSING/)
    assert.match(result.stderr, /缺少 package\.json/)
  })

  it("错误仓库（有 package.json/src 但不是宿主）→ BENCH_HOST_MISSING（缺少 src/i18n）", () => {
    const dir = tempDir("parity-wrong-")
    mkdirSync(join(dir, "src"), { recursive: true })
    writeFileSync(join(dir, "package.json"), `{ "name": "not-the-bench-host" }\n`)
    const result = runParity(dir)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /BENCH_HOST_MISSING/)
    assert.match(result.stderr, /缺少 src\/i18n/)
  })

  it("宿主骨架存在但模块解析不到 → 报「宿主模块无法解析」（旧实现在这里静默降级）", () => {
    const dir = tempDir("parity-skeleton-")
    mkdirSync(join(dir, "src", "i18n"), { recursive: true })
    mkdirSync(join(dir, "node_modules"), { recursive: true })
    writeFileSync(join(dir, "package.json"), `{ "name": "skeleton-host" }\n`)
    const result = runParity(dir)
    assert.equal(result.status, 1, `${result.stdout}${result.stderr}`)
    assert.match(result.stdout, /宿主模块无法解析/)
    assert.match(result.stdout, /expected=7 discovered=7 checked=7 failed=7/)
  })

  it(
    "真实宿主 + 真实市场 → 7/7 通过",
    { skip: !resolveRealHost() && "no bench host checkout next to the market" },
    () => {
      const result = runParity(resolveRealHost())
      assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
      assert.match(result.stdout, /expected=7 discovered=7 checked=7 failed=0/)
    },
  )
})
