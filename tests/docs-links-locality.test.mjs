// 跨仓相对链接守卫：extensions/** 与 docs/** 的 markdown 不得用
// "../../tauri-app/..." 逃逸仓库根 —— 这种链接只在“本地兄弟目录”布局可解析，
// CI 与任何独立 checkout 里都是死链（PR #16 远程失败根因）。指向宿主文档
// 一律用 GitHub blob 绝对 URL。
import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const ESCAPE_RE = /\]\((?:\.\.\/)+tauri-app\//

async function walk(dir, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, acc)
    else if (entry.name.endsWith(".md")) acc.push(full)
  }
  return acc
}

describe("markdown 不得逃逸仓库根指向 tauri-app", () => {
  it("extensions/ 下没有 ../../tauri-app 相对链接", async () => {
    const dir = join(ROOT, "extensions")
    const files = await walk(dir)
    assert.ok(files.length > 0)
    for (const file of files) {
      const raw = await readFile(file, "utf8")
      assert.doesNotMatch(raw, ESCAPE_RE, `${file} 仍含跨仓相对链接`)
    }
  })
})
