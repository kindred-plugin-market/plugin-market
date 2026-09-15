// P09：构建/发布的输入必须与质量门禁完全一致，并且可复现。
//
// 审计 R07 的形态：quality 固定宿主 1003f48 / Node 26.8.2 / pnpm 12.4.2 / Action SHA，
// build.yml 与 release.yml 却 checkout 宿主 main、用 Node 24 与 pnpm 11.8.0 及浮动
// Action —— 「测试通过的输入」不是「最终构建输入」，测试结论无法传递到产物。
//
// 与 scripts/quality/check-workflow-layout.mjs 同族：文本级扫描，零依赖（市场仓不引
// YAML 解析器）；workflow 是配置不是运行时数据，行级规则更易读也更好写负向测试。
import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const WORKFLOW_DIR = join(ROOT, ".github", "workflows")
const PUBLISHING = ["build.yml", "release.yml"]

const read = async (rel) => readFile(join(ROOT, rel), "utf8")
const workflowFiles = async () =>
  (await readdir(WORKFLOW_DIR)).filter((name) => /\.ya?ml$/.test(name)).sort()

// 只有与宿主打交道的工作流才有宿主 SHA / Node / pnpm 输入；
// release-please.yml 只管版本 PR 与打 tag，不 checkout 宿主，也不装依赖。
// 门禁本体（quality-gate.yml）由 P10 抽出，它是真正 checkout 宿主并装依赖的地方。
const HOST_WORKFLOWS = ["quality-gate.yml", "build.yml", "release.yml"]
// 从 `.github/host-baseline.txt` 解析宿主 SHA 的三个入口（各自有 baseline job）。
const BASELINE_RESOLVERS = ["quality.yml", "build.yml", "release.yml"]

const matchAll = (raw, pattern) => [...raw.matchAll(pattern)]

describe("宿主基线：唯一来源", () => {
  it(".github/host-baseline.txt 是完整 40 位 commit SHA", async () => {
    assert.match((await read(".github/host-baseline.txt")).trim(), /^[0-9a-f]{40}$/)
  })

  it("三个入口都从基线文件解析宿主 SHA", async () => {
    for (const file of BASELINE_RESOLVERS) {
      const raw = await read(`.github/workflows/${file}`)
      assert.match(raw, /cat \.github\/host-baseline\.txt/, `${file} 必须从唯一来源读宿主 SHA`)
    }
  })

  it("宿主 checkout 的 ref 只能是基线解析结果，不能硬编码", async () => {
    const expected = {
      "quality-gate.yml": /^\$\{\{\s*inputs\.host-ref\s*\}\}$/,
      "build.yml": /^\$\{\{\s*needs\.baseline\.outputs\.sha\s*\}\}$/,
      "release.yml": /^\$\{\{\s*needs\.baseline\.outputs\.sha\s*\}\}$/,
    }
    for (const file of HOST_WORKFLOWS) {
      const raw = await read(`.github/workflows/${file}`)
      const checkout = raw.match(/repository: indredK\/bench\n\s+ref: (.+?)\s*$/m)
      assert.ok(checkout, `${file} 必须 checkout 固定的宿主仓库`)
      assert.match(checkout[1], expected[file], `${file}: 宿主 ref 必须来自基线，实际 ${checkout[1]}`)
      // 除宿主 checkout 外，工作流不得出现任何硬编码的 ref。
      for (const match of matchAll(raw, /^\s*ref:\s*(.+?)\s*$/gm)) {
        assert.match(match[1], /^\$\{\{/, `${file}: ref 不得硬编码（${match[1]}）`)
      }
    }
  })
})

describe("工具链：Node 与 pnpm", () => {
  it(".node-version 固定 26.8.2，package.json 声明最低 24.15.0 与 pnpm 12.4.2", async () => {
    assert.equal((await read(".node-version")).trim(), "26.8.2")
    const pkg = JSON.parse(await read("package.json"))
    assert.equal(pkg.engines.node, ">=24.15.0")
    assert.equal(pkg.packageManager, "pnpm@12.4.2")
  })

  it("每个宿主工作流用 .node-version 且不硬编码 node-version", async () => {
    for (const file of HOST_WORKFLOWS) {
      const raw = await read(`.github/workflows/${file}`)
      const expected = file === "quality-gate.yml" ? ".node-version" : "market/.node-version"
      const declared = matchAll(raw, /node-version-file:\s*(\S+)/g).map((match) => match[1])
      assert.ok(declared.length > 0, `${file} 必须用 node-version-file`)
      for (const value of declared) assert.equal(value, expected, `${file}: ${value}`)
      assert.doesNotMatch(raw, /^\s+node-version:\s/m, `${file} 不得再硬编码 node-version`)
    }
  })

  it("pnpm 版本来自 PNPM_VERSION，且与 packageManager 一致", async () => {
    const pinned = JSON.parse(await read("package.json")).packageManager.replace("pnpm@", "")
    for (const file of HOST_WORKFLOWS) {
      const raw = await read(`.github/workflows/${file}`)
      const declared = matchAll(raw, /PNPM_VERSION:\s*(\S+)/g).map((match) => match[1])
      assert.ok(declared.length > 0, `${file} 必须声明 PNPM_VERSION`)
      for (const value of declared) assert.equal(value, pinned, `${file}: PNPM_VERSION=${value}`)
      const setups = matchAll(raw, /pnpm\/action-setup@\S+(?:\s*#[^\n]*)?\n\s*with:\n\s*version:\s*(.+?)\s*$/gm)
      assert.ok(setups.length > 0, `${file} 必须用 pnpm/action-setup`)
      for (const match of setups) {
        assert.equal(match[1], "${{ env.PNPM_VERSION }}", `${file}: pnpm 版本必须走 env`)
      }
    }
  })
})

describe("Action 固定与发布串行", () => {
  it("所有外部 Action 固定到完整 commit SHA", async () => {
    for (const file of await workflowFiles()) {
      const raw = await read(`.github/workflows/${file}`)
      const uses = matchAll(raw, /^\s*-?\s*uses:\s*(\S+)/gm).map((match) => match[1])
      assert.ok(uses.length > 0, `${file} 应该使用 Action`)
      for (const reference of uses) {
        if (reference.startsWith("./")) continue // 本仓 reusable workflow 不需要固定 SHA
        assert.match(reference, /@[0-9a-f]{40}$/, `${file}: ${reference} 必须固定到 40 位 SHA`)
      }
    }
  })

  it("build 与 release 共用同一个发布并发组且不可被取消", async () => {
    const groups = []
    for (const file of PUBLISHING) {
      const raw = await read(`.github/workflows/${file}`)
      const group = raw.match(/^concurrency:[\s\S]*?^\s+group:\s*(\S+)/m)
      assert.ok(group, `${file} 必须有并发组`)
      groups.push(group[1])
      assert.match(raw, /cancel-in-progress:\s*false/, `${file} 的发布不可被取消`)
    }
    assert.equal(new Set(groups).size, 1, `发布工作流必须串行，实际 ${groups.join(" / ")}`)
  })
})

describe("来源收据：产物必须带输入清单", () => {
  it("build 与 release 都在打包后写 provenance", async () => {
    for (const file of PUBLISHING) {
      const raw = await read(`.github/workflows/${file}`)
      assert.match(raw, /write-provenance\.mjs/, `${file} 必须生成来源收据`)
      assert.match(raw, /--host-sha "\$HOST_SHA"/, `${file}: 宿主 SHA 必须来自基线 job`)
      assert.match(raw, /--market-sha "\$MARKET_SHA"/, `${file}: market SHA 必须来自被构建的提交`)
      assert.match(raw, /--host-dir bench/, `${file} 的收据要记录宿主 Rust channel`)
      assert.ok(
        raw.indexOf("pack-extension.mjs") < raw.indexOf("write-provenance.mjs"),
        `${file}: 收据必须在打包之后生成，否则哈希的是旧产物`,
      )
    }
  })

  it("收据随产物一起发布", async () => {
    const build = await read(".github/workflows/build.yml")
    assert.match(build, /files:\s*\|?\s*\n\s*dist\/\*\.zip\n\s*dist\/provenance\.json/)
    const release = await read(".github/workflows/release.yml")
    assert.match(release, /gh release upload "\$GITHUB_REF_NAME" dist\/\*\.zip dist\/provenance\.json/)
    assert.match(release, /path:\s*\|\s*\n\s*dist\/\*\.zip\n\s*dist\/provenance\.json/, "诊断 artifact 也要带收据")
  })
})
