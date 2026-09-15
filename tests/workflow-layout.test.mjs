// P07：工作流 checkout 布局的静态不变量。
//
// quality 工作流曾用 `--bench ../host` 指向工作区之外的宿主，宿主 Vitest 永远
// 找不到 → quality 长期红灯而同 SHA 的滚动发布照常写 build-latest。这些用例把
// 「路径必须落在自己 checkout 出来的目录里」变成可执行的约束。
import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  checkWorkflowLayout,
  findWorkflowLayoutViolations,
} from "../scripts/quality/check-workflow-layout.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const CHECKOUT_SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1"
const HOST_SHA = "1003f484e22ec81846794ca191b70796868f53d4"

function workflow(steps) {
  return `name: quality
on:
  push:
    branches: [main]
permissions:
  contents: read
concurrency:
  group: quality
  cancel-in-progress: true
jobs:
  quality:
    runs-on: macos-latest
    timeout-minutes: 30
    steps:
${steps}
`
}

const MARKET_CHECKOUT = `      - uses: actions/checkout@${CHECKOUT_SHA} # v7.0.1`

const HOST_CHECKOUT = `      - name: Checkout pinned host baseline
        uses: actions/checkout@${CHECKOUT_SHA} # v7.0.1
        with:
          repository: indredK/bench
          ref: ${HOST_SHA}
          path: host`

function violationsOf(steps) {
  return findWorkflowLayoutViolations("quality.yml", workflow(steps))
}

test("accepts a host checkout referenced by the path it was checked out to", () => {
  const violations = violationsOf(`${MARKET_CHECKOUT}
${HOST_CHECKOUT}
      - name: Install host dependencies (frozen)
        run: pnpm install --frozen-lockfile
        working-directory: host
      - name: i18n parity vs host baseline
        run: pnpm run check:i18n-parity -- --bench host
      - name: Extension tests (host toolchain)
        run: pnpm run test:extensions -- --host host
`)
  assert.deepEqual(violations, [])
})

test("R1 flags a host path that escapes the workspace", () => {
  const violations = violationsOf(`${MARKET_CHECKOUT}
${HOST_CHECKOUT}
      - name: i18n parity vs host baseline
        run: pnpm run check:i18n-parity -- --bench ../host
      - name: Extension tests (host toolchain)
        run: pnpm run test:extensions -- --host ../host
`)
  assert.deepEqual(
    violations.map((violation) => violation.rule),
    ["R1", "R1"],
  )
})

test("R2 flags a path that no checkout in the workflow produced", () => {
  const violations = violationsOf(`${MARKET_CHECKOUT}
${HOST_CHECKOUT}
      - name: Extension tests (host toolchain)
        run: pnpm run test:extensions -- --host bench
`)
  assert.equal(violations.length, 1)
  assert.equal(violations[0].rule, "R2")
  assert.match(violations[0].detail, /--host bench/)
})

test("R2 flags a working-directory outside the checked out trees", () => {
  const violations = violationsOf(`${MARKET_CHECKOUT}
${HOST_CHECKOUT}
      - name: Install host dependencies (frozen)
        run: pnpm install --frozen-lockfile
        working-directory: bench
`)
  assert.equal(violations.length, 1)
  assert.equal(violations[0].rule, "R2")
})

test("dynamic paths are left to review instead of guessed", () => {
  const violations = violationsOf(`${MARKET_CHECKOUT}
${HOST_CHECKOUT}
      - name: Extension tests (host toolchain)
        run: pnpm run test:extensions -- --host "$BENCH_HOST_DIR"
`)
  assert.deepEqual(violations, [])
})

test("the repository workflows are internally consistent", () => {
  assert.deepEqual(checkWorkflowLayout(), [])
})

test("the quality gate resolves the host inside the workspace", async () => {
  // P10 起门禁本体在 quality-gate.yml（quality.yml 只负责解析基线并调用它）。
  const raw = await readFile(join(ROOT, ".github", "workflows", "quality-gate.yml"), "utf8")
  // 回归断言：这正是 run 34922411421 红掉的那两行。
  assert.match(raw, /check:i18n-parity -- --bench host\b/)
  assert.match(raw, /test:extensions -- --host host\b/)
  assert.doesNotMatch(
    raw,
    /--(?:bench|host)\s+\.\.\//,
    "the host checkout lives at $GITHUB_WORKSPACE/host, never outside the workspace",
  )
})
