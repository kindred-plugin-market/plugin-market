import { defineConfig } from "vite"
import type { Plugin } from "vite"
import react from "@vitejs/plugin-react"
import path from "path"

function quickLaunchCssGuard(): Plugin {
  return {
    name: "quick-launch-css-contract",
    apply: "build",
    generateBundle(_options, bundle) {
      const css = Object.values(bundle)
        .filter((asset) => asset.type === "asset" && asset.fileName.endsWith(".css"))
        .map((asset) =>
          typeof asset.source === "string"
            ? asset.source
            : new TextDecoder().decode(asset.source),
        )
        .join("\n")
      const required = [
        "grid-template-columns:repeat(4,minmax(0,1fr))",
        "height:min(60vh,720px)",
        "min-height:240px",
      ]
      const missing = required.filter((declaration) => !css.includes(declaration))
      if (missing.length > 0) {
        this.error(`Quick Launch CSS is missing required layout rules: ${missing.join(", ")}`)
      }
    },
  }
}

/**
 * quick-launch 插件独立构建（从 Bench 内置功能迁移，D 系列）。
 *
 * - `@`          → 宿主主包 src（复用 components/ui、lib/tauri、styles，随 bundle 打包）；
 * - `@extension` → 插件自身源码（extensions/quick-launch/src）；
 * - 产物 outDir = `assets/`（经 extensions:stage 打进 resources，或 extensions:sync 同步运行时）；
 * - `base: "./"` 是硬性要求（子路径部署 404 铁律）。
 */
export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  plugins: [react(), quickLaunchCssGuard()],
  resolve: {
    alias: {
      // ⚠️ 顺序铁律：vite alias 按声明顺序匹配，"@" 是前缀规则（"@" + "/"），
      // 必须把更具体的 "@/i18n/config" 放在 "@" **之前**，否则会被 "@" 截胡
      // （P5 教训：别名放在 "@" 之后 = 完全不生效，宿主 config 混入插件
      // bundle 并覆盖插件 i18n 实例，t() 全部返回 key 原文）。
      "@/i18n/config": path.resolve(import.meta.dirname, "./src/i18n.ts"),
      "@": path.resolve(import.meta.dirname, "../../src"),
      "@extension": path.resolve(import.meta.dirname, "./src"),
    },
  },
  build: {
    outDir: "assets",
    assetsDir: "bundle",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
})
