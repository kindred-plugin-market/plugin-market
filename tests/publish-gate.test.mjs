// P10：发布/滚动构建必须依赖同 SHA 的质量门禁。
//
// 审计 R03 的形态：同 SHA 上 Build 12:54:08 完成并发布，quality 12:55:02 才出结论
// —— 两条工作流互不依赖，「同 SHA 都成功」不等于存在质量门禁，时间顺序已经证明产物
// 早于测试结论落地。这里把关系钉死：门禁只有一份定义，发布 job 必须 needs 它。
import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const WORKFLOW_DIR = join(ROOT, ".github", "workflows")
const GATE = "quality-gate.yml"
const CALLERS = ["quality.yml", "build.yml", "release.yml"]
// 发布入口 → 它的发布 job 名。
const PUBLISHERS = [
  ["build.yml", "build"],
  ["release.yml", "build"],
]

const read = async (rel) => readFile(join(ROOT, rel), "utf8")
const readWorkflow = (file) => read(`.github/workflows/${file}`)

/**
 * 取某个 job 块的 `needs:` 列表（文本级解析）。
 * job 键缩进固定 2 空格，job 内容缩进 ≥4；遇到 0/2 空格的非空行即视为块结束。
 * 支持 `needs: [a, b]`、`needs: a` 与 YAML 列表三种写法。
 */
function needsOf(raw, jobName) {
  const lines = raw.split("\n")
  const start = lines.findIndex((line) => line === `  ${jobName}:`)
  if (start === -1) return null
  let end = lines.length
  for (let index = start + 1; index < lines.length; index++) {
    if (lines[index].trim() !== "" && /^( {2}\S|\S)/.test(lines[index])) {
      end = index
      break
    }
  }
  const block = lines.slice(start + 1, end)
  const needsIndex = block.findIndex((line) => /^\s+needs:/.test(line))
  if (needsIndex === -1) return []
  const inline = block[needsIndex].match(/needs:\s*(.+?)\s*$/)
  if (inline) {
    return inline[1]
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  }
  const items = []
  for (let index = needsIndex + 1; index < block.length; index++) {
    const item = block[index].match(/^\s*-\s*(\S+)\s*$/)
    if (!item) break
    items.push(item[1])
  }
  return items
}

/** 语义模型：给定各依赖 job 的结论，这个发布 job 会不会真的执行。 */
function publishRuns(needs, results) {
  if (needs === null) return false // job 不存在 → 什么都不发
  if (needs.length === 0) return true // 没有依赖：任何输入下都会发布（P10 之前的形态）
  return needs.every((name) => results[name] === "success")
}

describe("门禁只有一份定义", () => {
  it("只有 quality-gate.yml 跑插件测试与 parity", async () => {
    const files = (await readdir(WORKFLOW_DIR)).filter((name) => /\.ya?ml$/.test(name))
    for (const file of files) {
      const raw = await readWorkflow(file)
      const hasGateCommands = /test:extensions|check:i18n-parity|audit:ext-i18n/.test(raw)
      assert.equal(hasGateCommands, file === GATE, `${file} ${hasGateCommands ? "重复" : "缺少"}了门禁命令`)
    }
  })

  it("门禁只能被调用，不能自己触发", async () => {
    const raw = await readWorkflow(GATE)
    assert.match(raw, /^on:\n  workflow_call:/m)
    assert.doesNotMatch(raw, /^ {2}(push|pull_request|schedule):/m, "门禁不得自行触发（避免绕过 needs）")
  })

  it("三个工作流都调用同一份门禁，并传入基线解析出的宿主 SHA", async () => {
    for (const file of CALLERS) {
      const raw = await readWorkflow(file)
      assert.match(raw, new RegExp(`uses: \\./\\.github/workflows/${GATE}`), `${file} 必须调用门禁`)
      assert.match(
        raw,
        /with:\s*\n\s+host-ref:\s*\$\{\{\s*needs\.baseline\.outputs\.sha\s*\}\}/,
        `${file} 必须把基线 SHA 交给门禁`,
      )
      assert.ok(needsOf(raw, "gate")?.includes("baseline"), `${file} 的门禁必须先解析基线`)
    }
  })
})

describe("发布必须依赖门禁", () => {
  it("build 与 release 的发布 job 都 needs 门禁", async () => {
    for (const [file, job] of PUBLISHERS) {
      const needs = needsOf(await readWorkflow(file), job)
      assert.ok(needs, `${file} 必须有发布 job ${job}`)
      assert.ok(needs.includes("gate"), `${file}:${job} 必须 needs 门禁，实际 ${JSON.stringify(needs)}`)
      assert.ok(needs.includes("baseline"))
    }
  })

  it("门禁红 / 取消 / 跳过时发布 job 都不执行", async () => {
    for (const [file, job] of PUBLISHERS) {
      const needs = needsOf(await readWorkflow(file), job)
      assert.equal(publishRuns(needs, { baseline: "success", gate: "success" }), true, `${file}: 门禁绿才发布`)
      for (const result of ["failure", "cancelled", "skipped"]) {
        assert.equal(
          publishRuns(needs, { baseline: "success", gate: result }),
          false,
          `${file}: gate=${result} 时必须跳过发布`,
        )
      }
    }
  })

  it("负向 fixture：P10 之前「发布 job 无 needs」在任何输入下都发布", () => {
    const preP10 = `name: Build (main)
on:
  push:
    branches: [main]
permissions:
  contents: write
jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - run: node scripts/plugins/pack-extension.mjs demo
`
    assert.deepEqual(needsOf(preP10, "build"), [])
    assert.equal(
      publishRuns(needsOf(preP10, "build"), { quality: "failure" }),
      true,
      "没有 needs 的发布 job 无法被质量结论约束——这正是 12:54 发布、12:55 才红的那次形态",
    )
  })
})
