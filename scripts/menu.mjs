#!/usr/bin/env node
/**
 * kindred-plugin-market 交互式控制台（零外部依赖，Node ≥ 18）。
 *
 *   npm start
 *
 * 仅做文档预览入口：选择一张架构图，后台启动本地静态服务并打开浏览器。
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
import readline from "node:readline"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const menu = [
  {
    group: "文档预览",
    items: [
      { key: "diagrams", label: "启动架构图集门户(:3300, 浏览器内选图)", script: "diagrams" },
      { key: "diagrams:select", label: "选择单张架构图并本地预览", script: "diagrams:select" },
    ],
  },
  {
    group: "说明",
    items: [
      { key: "readme", label: "在终端打印仓库 README 路径", action: "readme" },
    ],
  },
]

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

function ask(q) {
  return new Promise((r) => rl.question(q, (a) => r(a.trim())))
}

function runScript(script) {
  const child = spawn("node", ["docs/diagrams/" + (script === "diagrams" ? "server.mjs" : "launch.mjs")], {
    cwd: rootDir,
    env: { ...process.env, DOCS_PORT: script === "diagrams" ? "3300" : "3300" },
    stdio: "inherit",
  })
  const shutdown = () => { try { child.kill("SIGTERM") } catch {}; process.exit(0) }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

async function main() {
  if (!process.stdin.isTTY) {
    console.error("此脚本需要在交互式终端运行：npm start")
    process.exit(1)
  }
  console.log("\n  Kindred Plugin Market 控制台\n")
  while (true) {
    menu.forEach((g, gi) => {
      console.log(`  [${gi + 1}] ${g.group}`)
      g.items.forEach((it, ii) => console.log(`      ${gi + 1}.${ii + 1}  ${it.label}`))
    })
    console.log("      0   退出")
    const ans = await ask("\n  选择分组.序号 或 0: ")
    if (ans === "0" || ans === "q") { console.log("再见"); process.exit(0) }
    const m = ans.match(/^(\d+)\.(\d+)$/)
    if (!m) { console.log("  格式应为 分组.序号，例如 1.2\n"); continue }
    const gi = Number(m[1]) - 1, ii = Number(m[2]) - 1
    const g = menu[gi]
    if (!g || !g.items[ii]) { console.log("  无效选择\n"); continue }
    const item = g.items[ii]
    if (item.action === "readme") {
      console.log(`\n  仓库说明: ${path.join(rootDir, "README.md")}\n`)
      continue
    }
    rl.close()
    runScript(item.script)
    return
  }
}

main()
