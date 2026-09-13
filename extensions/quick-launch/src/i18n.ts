/**
 * 插件内 i18n：独立 i18next 实例，资源仅含本插件命名空间。
 */
import i18next from "i18next"
import { initReactI18next } from "react-i18next"

import en from "../locales/en.json"
import zh from "../locales/zh.json"

const injected =
  typeof window !== "undefined" && (window as { __BENCH_EXT_LOCALE?: string }).__BENCH_EXT_LOCALE
const preferred =
  injected ??
  (typeof navigator !== "undefined" && navigator.language.startsWith("zh") ? "zh" : "en")

void i18next.use(initReactI18next).init({
  resources: {
    zh: { translation: zh.translation },
    en: { translation: en.translation },
  },
  lng: preferred,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
})

export default i18next
