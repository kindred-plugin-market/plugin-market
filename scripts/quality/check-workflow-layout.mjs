#!/usr/bin/env node
/**
 * 工作流「checkout 布局」守卫（P07）。
 *
 * 背景：quality 工作流从仓库根执行 `pnpm run check:i18n-parity -- --bench ../host`，
 * 但宿主 checkout（actions/checkout with `path: host`）落在
 * `$GITHUB_WORKSPACE/host`。`../host` 解析到工作区之外，宿主的 vitest 永远找不到
 * ——quality 因此长期红灯，而同一 SHA 的滚动发布仍在写 build-latest。
 *
 * 这类错误完全静态可见：一个 workflow 只能引用它自己 checkout 出来的目录，而
 * checkout 永远落在工作区内。规则（任一命中即 exit 1）：
 *
 *   R1 host-path-escapes-workspace — `--bench/--host/--market/working-directory`
 *                                    的值不得以 `..` 开头（工作区外不可能是 checkout）。
 *   R2 path-not-checked-out        — 这些值的第一段必须是同一文件里某个
 *                                    `actions/checkout` 的 `path:`（或根，即未指定 path）。
 *
 * 零依赖、文本级扫描：workflow 是配置不是运行时数据，行级规则更易读、更好写
 * 负向测试（与宿主 check-workflow-hygiene.mjs 同族）。
 */
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const workflowsDir = path.join(rootDir, ".github", "workflows")

/** 受约束的「仓库路径」参数：命令行 --flag 与 working-directory。 */
const FLAG_PATTERN = /--(bench|host|market)\s+("[^"]+"|'[^']+'|\S+)/g
const WORKING_DIR_PATTERN = /^\s*working-directory:\s*("[^"]+"|'[^']+'|\S+)\s*$/gm
const CHECKOUT_USES_PATTERN = /uses:\s*actions\/checkout@/
const CHECKOUT_PATH_PATTERN = /^\s+path:\s*("[^"]+"|'[^']+'|\S+)\s*$/m

const unquote = (value) => value.replace(/^["']|["']$/g, "")
const isDynamic = (value) => /[$](\{\{|[A-Z_]+)/.test(value)

function findWorkflowLayoutViolations(file, content) {
  const violations = []
  const report = (rule, detail) => violations.push({ rule, file, detail })

  // 每个 checkout 步骤的 `path:`（步骤边界按下一个 `- ` 列表项判定；checkout 步骤
  // 里不会出现 run 块，因此不需要处理块标量里的伪列表项）。
  const checkoutPaths = new Set(["."])
  const lines = content.split("\n")

  for (let index = 0; index < lines.length; index++) {
    if (!CHECKOUT_USES_PATTERN.test(lines[index])) continue
    const usesIndent = lines[index].length - lines[index].trimStart().length

    let stepIndent = usesIndent
    for (let cursor = index - 1; cursor >= 0 && index - cursor <= 6; cursor--) {
      const previous = lines[cursor]
      if (previous.trim() === "") continue
      const previousIndent = previous.length - previous.trimStart().length
      if (/^\s*-\s/.test(previous) && previousIndent < usesIndent) {
        stepIndent = previousIndent
        break
      }
      if (previousIndent < usesIndent) break
    }

    let end = lines.length - 1
    for (let cursor = index + 1; cursor < lines.length; cursor++) {
      const line = lines[cursor]
      if (line.trim() === "") continue
      const lineIndent = line.length - line.trimStart().length
      if (/^\s*-\s/.test(line) && lineIndent <= stepIndent) {
        end = cursor - 1
        break
      }
    }

    const block = lines.slice(index, end + 1).join("\n")
    const declared = block.match(CHECKOUT_PATH_PATTERN)
    checkoutPaths.add(declared ? unquote(declared[1]) : ".")
    index = end
  }

  const references = []
  for (const match of content.matchAll(FLAG_PATTERN)) {
    references.push({ flag: `--${match[1]}`, value: unquote(match[2]) })
  }
  for (const match of content.matchAll(WORKING_DIR_PATTERN)) {
    references.push({ flag: "working-directory", value: unquote(match[1]) })
  }

  for (const { flag, value } of references) {
    if (isDynamic(value)) continue // 运行期才确定的路径交给用例/审查，静态守卫不猜
    if (value.startsWith("..")) {
      report(
        "R1",
        `${flag} ${value} 指向工作区之外 — actions/checkout 只会把仓库放进 $GITHUB_WORKSPACE，` +
          "`../…` 永远不存在（P07 的实际故障：`--bench ../host` 解析到 $GITHUB_WORKSPACE/../host）",
      )
      continue
    }
    // 只比较第一段：`market/extensions/foo` 属于 market 这个 checkout。
    const root = value.split(/[\\/]/)[0]
    if (!checkoutPaths.has(root)) {
      report(
        "R2",
        `${flag} ${value} 不是本工作流 checkout 出来的目录 — 已 checkout：` +
          `${[...checkoutPaths].sort().join(", ")}`,
      )
    }
  }

  return violations
}

function checkWorkflowLayout(directory = workflowsDir) {
  const violations = []
  const workflowFiles = readdirSync(directory)
    .filter((file) => /\.ya?ml$/i.test(file))
    .sort()
  for (const file of workflowFiles) {
    violations.push(...findWorkflowLayoutViolations(file, readFileSync(path.join(directory, file), "utf8")))
  }
  return violations
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const violations = checkWorkflowLayout()
  if (violations.length > 0) {
    console.error(`发现 ${violations.length} 处工作流布局违规：`)
    for (const { rule, file, detail } of violations) {
      console.error(`  [${rule}] .github/workflows/${file} — ${detail}`)
    }
    process.exit(1)
  }
  console.log("Workflow layout checks passed.")
}

export { checkWorkflowLayout, findWorkflowLayoutViolations }
