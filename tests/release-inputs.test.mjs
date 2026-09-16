// P12：发布输入加固的静态断言。
//
// 审计原文：release.yml 把 `${{ github.event.inputs.plugin_id }}` 直接插进 shell，
// workflow_dispatch 输入可破坏引号并执行额外命令；tag glob `*-v*` 没有严格 semver
// 与插件 id 校验。indredK/bench 是 public 仓库，build/release checkout 仍传
// BENCH_REPO_TOKEN，凭据默认持久化到 checkout，扩大了插件构建脚本可接触的秘密面。
//
// 这里把修复钉死为可测断言：
//   1. release.yml 不允许出现 `${{ github.event.inputs.plugin_id }}` 模板插值 ——
//      输入必须经 `env: INPUT_PLUGIN_ID` 传入 shell。
//   2. release.yml 的插件 id 解析步骤必须做 allowlist 校验（`^[a-z0-9][a-z0-9-]*$`）
//      且验证 manifest.json 存在。
//   3. tag 触发时必须严格匹配 `<plugin-id>-v<semver>` 并与 manifest 版本比对。
//   4. build.yml / release.yml 的宿主 checkout（indredK/bench，public）不得再传
//      BENCH_REPO_TOKEN，且必须显式 persist-credentials: false。
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const read = (rel) => readFile(join(ROOT, rel), "utf8")

describe("P12 发布输入与凭据边界", () => {
  it("release.yml 不再把 inputs.plugin_id 直接插进 shell", async () => {
    const raw = await read(".github/workflows/release.yml")
    assert.doesNotMatch(raw, /\$\{\{\s*github\.event\.inputs\.plugin_id\s*\}\}/)
    assert.match(raw, /INPUT_PLUGIN_ID:\s*\$\{\{\s*inputs\.plugin_id\s*\}\}/)
    assert.match(raw, /plugin_id="\$\{INPUT_PLUGIN_ID:-\$\{GITHUB_REF_NAME%-v\*\}\}"/)
  })

  it("插件 id 解析步骤做 allowlist 校验并验证 manifest 存在", async () => {
    const raw = await read(".github/workflows/release.yml")
    const step = raw.split("- name: Resolve and validate plugin id (P12)")[1]?.split("\n      - name:")[0]
    assert.ok(step, "P12 解析步骤必须存在")
    assert.match(step, /\[\[\s*"\$plugin_id" =~ \^\[a-z0-9\]\[a-z0-9-\]\*\$/)
    assert.match(step, /market\/extensions\/\$plugin_id\/manifest\.json/)
  })

  it("tag 触发必须严格 semver 且与 manifest 版本比对", async () => {
    const step = (await read(".github/workflows/release.yml"))
      .split("- name: Resolve and validate plugin id (P12)")[1]
      ?.split("\n      - name:")[0]
    assert.match(step, /<plugin-id>-v<X\.Y\.Z>/)
    assert.match(step, /tag_version.*==.*manifest_version|manifest_version.*==.*tag_version|"\$tag_version" == "\$manifest_version"/)
  })

  it("public 宿主 checkout 不携带 BENCH_REPO_TOKEN 且不持久化凭据", async () => {
    for (const file of ["build.yml", "release.yml"]) {
      const raw = await read(`.github/workflows/${file}`)
      const benchCheckout = raw
        .split("- name: Checkout Bench host workspace")[1]
        ?.split("\n      - name:")[0]
      assert.ok(benchCheckout, `${file} 宿主 checkout 步骤缺失`)
      assert.doesNotMatch(benchCheckout, /BENCH_REPO_TOKEN/, `${file} 不得传 BENCH_REPO_TOKEN`)
      assert.match(benchCheckout, /persist-credentials:\s*false/, `${file} 必须 persist-credentials: false`)
    }
  })

  it("BENCH_REPO_TOKEN 不再被任何工作流引用", async () => {
    const { readdir } = await import("node:fs/promises")
    const files = (await readdir(join(ROOT, ".github", "workflows"))).filter((f) => /\.ya?ml$/.test(f))
    for (const file of files) {
      const raw = await read(`.github/workflows/${file}`)
      assert.doesNotMatch(raw, /BENCH_REPO_TOKEN/, `${file} 仍引用 BENCH_REPO_TOKEN`)
    }
  })
})
