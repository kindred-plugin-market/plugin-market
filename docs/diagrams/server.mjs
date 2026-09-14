#!/usr/bin/env node
/**
 * Plugin Market 架构图集 — 本地文档服务（零外部依赖，Node ≥ 18）。
 *
 * 启动：
 *   node docs/diagrams/server.mjs            # 默认端口 3300
 *   DOCS_PORT=3400 node docs/diagrams/server.mjs
 *
 * 访问：http://localhost:3300
 */
import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.DOCS_PORT || 3300)
const HOST = process.env.DOCS_HOST || "127.0.0.1"
const INDEX = path.join(__dirname, "index.html")

const server = http.createServer((req, res) => {
  let pathname = "/"
  try {
    pathname = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`).pathname
  } catch {
    pathname = "/"
  }

  if (pathname === "/" || pathname === "/index.html") {
    if (fs.existsSync(INDEX)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(fs.readFileSync(INDEX))
    } else {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end("<!doctype html><meta charset=utf-8><h1>Plugin Market 架构图集</h1><p>暂无 index.html 门户，可直接访问具体 .html 文件。</p>")
    }
    return
  }

  const rel = pathname.replace(/^\//, "")
  if (rel && !rel.includes("..") && path.extname(rel)) {
    const file = path.join(__dirname, rel)
    if (path.resolve(file).startsWith(path.resolve(__dirname)) && fs.existsSync(file)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(fs.readFileSync(file))
      return
    }
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
  res.end("404 Not Found")
})

server.on("error", (e) => {
  console.error(`[plugin-diagrams] 服务启动失败: ${e.message}`)
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  console.log(`\n[plugin-diagrams] 架构图集已启动: http://localhost:${PORT}  (Ctrl+C 退出)\n`)
  console.log("图集目录: docs/diagrams/")
})

const shutdown = () => server.close(() => process.exit(0))
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
