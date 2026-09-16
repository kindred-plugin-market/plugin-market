// P13：rolling release 必须只包含当前 main 快照的资产。
//
// 审计原文：build-latest 有 7 个插件的多个历史版本 zip；工作流所称
// “覆盖旧资产”只对同名文件有效，版本变化后旧文件名不会被删除。
// 修复：发布前先清空全部 bench-ext-*.zip 与 provenance 资产再上传。
// 这里用静态断言钉住：build.yml 必须存在 Prune 步骤，且清理范围覆盖
// bench-ext-*.zip 与 provenance 两类资产。
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const read = (rel) => readFile(join(ROOT, rel), "utf8")

describe("P13 rolling release 快照语义", () => {
  it("build.yml 必须有发布前清理旧资产的步骤", async () => {
    const raw = await read(".github/workflows/build.yml")
    assert.match(raw, /- name: Prune stale rolling assets \(P13\)/)
  })

  it("清理范围覆盖 bench-ext-*.zip 与 provenance 资产", async () => {
    const raw = await read(".github/workflows/build.yml")
    const step = raw.split("- name: Prune stale rolling assets (P13)")[1]?.split("\n      - name:")[0]
    assert.ok(step, "Prune 步骤缺失")
    assert.match(step, /bench-ext-\*\.zip/)
    assert.match(step, /provenance/)
    assert.match(step, /delete-asset/)
  })

  it("发布 job 仍上传 dist/*.zip 与 provenance.json", async () => {
    const raw = await read(".github/workflows/build.yml")
    assert.match(raw, /files: \|\n\s+dist\/\*\.zip\n\s+dist\/provenance\.json/)
  })
})
