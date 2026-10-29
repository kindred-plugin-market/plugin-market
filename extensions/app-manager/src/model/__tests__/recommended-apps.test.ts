import { describe, expect, it } from "vitest"
import { getRecommendedInstallList } from "@extension/recommended-apps"

const uninstallable = {
  launch: true,
  reveal: true,
  upgrade: true,
  uninstall: true,
}

describe("recommended app correlation", () => {
  it("does not expose destructive identity from a display-name-only match", () => {
    const chrome = getRecommendedInstallList([
      {
        appId: "app-v1-unrelated",
        name: "Google Chrome",
        bundleId: "unknown",
        sourceId: "",
        version: "1.0",
        installPath: "C:\\Unrelated\\chrome.exe",
        allowedActions: uninstallable,
      },
    ]).find((app) => app.id === "google-chrome")

    expect(chrome?.installed).toBe(true)
    expect(chrome?.installedAppId).toBeUndefined()
    expect(chrome?.installedCanUninstall).toBe(false)
  })

  it("retains destructive identity for an exact package-source match", () => {
    const chrome = getRecommendedInstallList([
      {
        appId: "app-v1-chrome",
        name: "Chrome",
        bundleId: "windows:registry:chrome",
        sourceId: "Google.Chrome",
        version: "1.0",
        installPath: "C:\\Chrome\\chrome.exe",
        allowedActions: uninstallable,
      },
    ]).find((app) => app.id === "google-chrome")

    expect(chrome?.installedAppId).toBe("app-v1-chrome")
    expect(chrome?.installedCanUninstall).toBe(true)
  })

  it("shows native toolbox apps only on macOS and keeps their fixed host IDs", () => {
    const macApps = getRecommendedInstallList([], "macos")
    const winApps = getRecommendedInstallList([], "windows")

    expect(macApps.find((app) => app.id === "local-toolbox")?.nativeToolId).toBe("local-toolbox")
    expect(macApps.find((app) => app.id === "abb-dev-toolbox")?.nativeToolId).toBe(
      "abb-dev-toolbox",
    )
    expect(winApps.some((app) => app.nativeToolId)).toBe(false)
  })
})
