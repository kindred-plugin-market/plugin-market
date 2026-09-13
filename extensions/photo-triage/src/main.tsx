/**
 * photo-triage 插件入口（P2b）。
 *
 * 独立于宿主前端的 React 应用：自带 i18n 资源（photoTriage + common），
 * 复用宿主的 UI 组件库 / Tauri 能力面 wrapper（随 bundle 打包）。
 */
import React from "react"
import { createRoot } from "react-dom/client"
import { Toaster } from "sonner"

import { TooltipProvider } from "@/components/ui/tooltip"

import "@/styles/index.css"
import "@extension/i18n"
import PhotoTriagePage from "@extension/page"

const container = document.getElementById("root")
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      {/* 宿主 main.tsx 在根节点提供 TooltipProvider；插件是独立 React 应用，
          必须自带 —— 否则任何 Tooltip 都会抛 “must be used within TooltipProvider”（白屏）。 */}
      <TooltipProvider>
        <PhotoTriagePage />
        <Toaster position="top-center" />
      </TooltipProvider>
    </React.StrictMode>,
  )
}
