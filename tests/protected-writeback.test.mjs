// P11：main 写回点必须经过 PR（受分支保护约束）。
//
// 审计原文：任何可 push main 的身份都能绕过质量闸门 —— release.yml 把
// registry.json upsert 后直推 main，release-please.yml 的 config sync 也直推
// main。两条写回点都改为「bot 分支 + PR」或「fail-with-diff」后，用静态断言
// 钉死：任何 workflow 不允许再出现 `git push origin main` / `git push origin HEAD:main`。
import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const WORKFLOW_DIR = join(ROOT, ".github", "workflows")
const read = (rel) => readFile(join(ROOT, rel), "utf8")

const PUSH_MAIN_RE = /git push origin (?:HEAD:)?main(?!\S*--force)/

describe("P11 写回点必须走 PR", () => {
  it("release.yml 的 registry 写回是 bot 分支 + PR，不再直推 main", async () => {
    const raw = await read(".github/workflows/release.yml")
    assert.doesNotMatch(raw, PUSH_MAIN_RE, "release.yml 仍在直推 main")
    assert.match(raw, /Open registry update pull request/)
    assert.match(raw, /gh pr create/)
    assert.match(raw, /--base main/)
  })

  it("release-please.yml 的 config sync 是 fail-with-diff，不再直推 main", async () => {
    const raw = await read(".github/workflows/release-please.yml")
    assert.doesNotMatch(raw, PUSH_MAIN_RE, "release-please.yml 仍在直推 main")
    assert.match(raw, /Sync release-please config \(fail with diff\)/)
    assert.match(raw, /exit 1/)
  })

  it("全部 workflow 均无直推 main 的步骤", async () => {
    const { readdir } = await import("node:fs/promises")
    const files = (await readdir(WORKFLOW_DIR)).filter((f) => /\.ya?ml$/.test(f))
    for (const file of files) {
      const raw = await read(`.github/workflows/${file}`)
      assert.doesNotMatch(raw, PUSH_MAIN_RE, `${file} 存在直推 main 的步骤`)
    }
  })
})
