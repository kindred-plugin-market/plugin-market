import { defineConfig } from "vitest/config"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dir = path.dirname(fileURLToPath(import.meta.url))
const hostSrc = path.resolve(dir, "../../../tauri-app/src")

export default defineConfig({
  resolve: {
    alias: {
      "@": hostSrc,
      "@/i18n/config": path.join(hostSrc, "i18n/config"),
      "@extension": path.join(dir, "src"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: [path.join(dir, "vitest.setup.ts")],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
})
