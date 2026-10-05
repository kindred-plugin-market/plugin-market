import { describe, expect, it } from "vitest"

import {
  applyOverrides,
  autoClassifyApps,
  incompleteInventoryProviders,
} from "@extension/services/quick-launch.use-cases"
import { classifyInventory } from "@extension/classification-engine"
import { SCENE_RULES_VERSION } from "@extension/scenes"
import type { AppInfo, ProviderStatus } from "@/lib/tauri/types/app-manager"

function app(overrides: Partial<AppInfo> = {}): AppInfo {
  return {
    appId: "app-v1-demo",
    name: "Demo",
    version: "1.0.0",
    bundleId: "com.example.demo",
    installPath: "/Applications/Demo.app",
    source: "Bundle",
    sourceType: "MacBundle",
    sourceId: "",
    sourceConfidence: 1,
    canUpgrade: false,
    canUninstall: false,
    upgradeAvailable: false,
    lastOperationResult: null,
    lastModified: 0,
    isSystemApp: false,
    iconBase64: null,
    allowedActions: { launch: true, reveal: true, upgrade: false, uninstall: false },
    ...overrides,
  }
}

describe("quick launch classification", () => {
  it("never includes an app without a verified launch target", () => {
    const result = autoClassifyApps([
      app(),
      app({
        appId: "app-v1-disabled",
        name: "Disabled",
        allowedActions: { launch: false, reveal: true, upgrade: false, uninstall: false },
      }),
    ])

    expect(Object.values(result).flat()).toContain("app-v1-demo")
    expect(Object.values(result).flat()).not.toContain("app-v1-disabled")
  })

  it("binds derived classification to an explicit rule version", () => {
    const snapshot = classifyInventory([app({ name: "Safari", bundleId: "com.apple.Safari" })])
    expect(snapshot.ruleVersion).toBe(SCENE_RULES_VERSION)
    expect(snapshot.scenes.browser).toEqual(["app-v1-demo"])
  })

  it("skips empty labels but keeps visible RTL names with direction marks", () => {
    const result = autoClassifyApps([
      app(),
      app({ appId: "app-v1-empty", name: "   " }),
      app({ appId: "app-v1-mark-only", name: "\u200e\u200f" }),
      app({ appId: "app-v1-rtl", name: "\u200eمساعدة\u200e" }),
    ])

    const classified = Object.values(result).flat()
    expect(classified).toContain("app-v1-demo")
    expect(classified).toContain("app-v1-rtl")
    expect(classified).not.toContain("app-v1-empty")
    expect(classified).not.toContain("app-v1-mark-only")
  })

  it("does not let saved overrides reintroduce unlaunchable or unlabeled apps", () => {
    const visible = app()
    const blank = app({ appId: "app-v1-blank", name: "\u200e" })
    const unavailable = app({
      appId: "app-v1-unavailable",
      name: "Unavailable",
      allowedActions: { launch: false, reveal: true, upgrade: false, uninstall: false },
    })
    const scene = autoClassifyApps([visible])
    const result = applyOverrides(
      scene,
      { "app-v1-blank": "other", "app-v1-unavailable": "other" },
      new Map([
        [visible.appId, visible],
        [blank.appId, blank],
        [unavailable.appId, unavailable],
      ]),
    )

    expect(Object.values(result).flat()).not.toContain(blank.appId)
    expect(Object.values(result).flat()).not.toContain(unavailable.appId)
  })

  it("warns for incomplete providers but treats unsupported providers as expected", () => {
    const providers: ProviderStatus[] = [
      { provider: "filesystem", state: "ok", errorCode: null },
      { provider: "homebrew", state: "unsupported", errorCode: "UNSUPPORTED" },
      { provider: "spotlight", state: "partial", errorCode: "SPOTLIGHT_PARTIAL" },
      { provider: "registry", state: "timedOut", errorCode: "TIMEOUT" },
    ]

    expect(incompleteInventoryProviders(providers)).toEqual(["spotlight", "registry"])
  })
})
