import { defineConfig } from "vite"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dir = path.dirname(fileURLToPath(import.meta.url))
const hostSrc = path.resolve(dir, "../../../tauri-app/src")

export default defineConfig({
  root: dir,
  base: "./",
  resolve: {
    alias: {
      "@": hostSrc,
      "@/i18n/config": path.join(hostSrc, "i18n/config"),
      "@extension": path.join(dir, "src"),
    },
  },
  build: {
    outDir: path.resolve(dir, "../../../tauri-app/src-tauri/extensions/quick-launch/dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.join(dir, "index.html"),
    },
  },
  optimizeDeps: { exclude: ["@extension"] },
})
