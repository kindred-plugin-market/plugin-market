/**
 * quick-launch 插件入口（从 Bench 内置功能迁移）。
 */
import React from "react"
import { createRoot } from "react-dom/client"
import { Toaster } from "sonner"
import type { ComponentType } from "react"

import "@/styles/index.css"
import "@extension/i18n"
import Page from "@extension/page"

// 插件页以「已激活」状态渲染；feature 元数据在插件上下文中无宿主注入，按需忽略。
const PluginPage = Page as unknown as ComponentType<{ active: boolean }>

const container = document.getElementById("root")
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <PluginPage active={true} />
      <Toaster position="top-center" />
    </React.StrictMode>,
  )
}
