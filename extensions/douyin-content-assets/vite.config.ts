import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "path"

/**
 * douyin-content-assets 插件独立构建（DCA-01，D-037）。
 *
 * - `@`          → 宿主主包 src（复用 components/ui、lib/tauri、styles，随 bundle 打包）；
 * - `@extension` → 插件自身源码（extensions/douyin-content-assets/src）；
 * - 产物 outDir = `assets/`（经 extensions:stage 打进 resources，或 extensions:sync 同步运行时）；
 * - `base: "./"` 是硬性要求（子路径部署 404 铁律）。
 */
export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      // ⚠️ 顺序铁律：更具体的 "@/i18n/config" 必须放在 "@" 之前，否则被
      // "@" 前缀截胡 → 宿主 i18n 实例混入插件 bundle，t() 全部返回 key 原文。
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
