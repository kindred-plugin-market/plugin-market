/**
 * Test / 测试: verify behavior only; 只验证行为与契约.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { useAppManagerController } from "@extension/hooks/useAppManagerController"
import { useAppManagerStore } from "@extension/store"
import { requestFeatureRefresh } from "@/features/refresh"
import { appManagerUseCases } from "@extension/services/app-manager.use-cases"
import { reconcileManagedUpdateAvailability } from "@extension/hooks/useAppManagerUpdates"
import { SoftwareUpdateView } from "@extension/components/SoftwareUpdateView"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cancelAppUpdate } from "@/lib/tauri/commands/app-manager"
import type { AppInfo, OperationResult, UpdateInfo } from "@/lib/tauri/types/app-manager"

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: () => {},
  },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock("@/shared/context-menu/useContextMenuRegistration", () => ({
  useContextMenuRegistration: () => {},
}))

vi.mock("@extension/hooks/useInstallEvents", () => ({
  useInstallEvents: () => {},
}))

vi.mock("@/platform/capabilities", () => ({
  canUseDesktopFeatures: () => true,
  canUseTauriEvents: () => false,
}))

vi.mock("@/platform/clipboard", () => ({
  writeClipboardText: vi.fn(async () => {}),
}))

vi.mock("@/lib/tauri/commands/app-manager", () => ({
  batchUninstallApps: vi.fn(async () => ({ total: 0, succeeded: 0, failed: 0, results: [] })),
  batchUpgradeApps: vi.fn(async () => ({ total: 0, succeeded: 0, failed: 0, results: [] })),
  cancelBatchOperation: vi.fn(async () => true),
  cancelAppUpdate: vi.fn(async () => {}),
  cancelAppInventoryScan: vi.fn(async () => true),
  getCachedAppInventory: vi.fn(async () => null),
  checkAllAppUpdates: vi.fn(async () => []),
  checkManagedAppUpdates: vi.fn(async () => []),
  getAppIconBase64: vi.fn(async () => null),
  installApp: vi.fn(async () => ({
    success: true,
    message: "ok",
    exitCode: 0,
    errorCode: null,
    permissionIssue: false,
  })),
  installPrivateNativeTool: vi.fn(async () => ({
    success: true,
    message: "ok",
    exitCode: 0,
    errorCode: null,
    permissionIssue: false,
  })),
  installAppUpdate: vi.fn(async () => {}),
  launchApp: vi.fn(async () => {}),
  authorizeMacApp: vi.fn(async () => ({
    success: true,
    message: "ok",
    exitCode: null,
    errorCode: null,
    permissionIssue: false,
  })),
  openInMacAppStore: vi.fn(async () => {}),
  openMacAppStoreUpdates: vi.fn(async () => {}),
  revealAppInFinder: vi.fn(async () => {}),
  scanInstalledApps: vi.fn(async () => ({
    apps: [],
    totalCount: 0,
    userCount: 0,
    systemCount: 0,
    scanTimeMs: 0,
    managedCount: 0,
    platformCapabilities: {
      brewAvailable: true,
      wingetAvailable: false,
      flatpakAvailable: false,
      snapAvailable: false,
      aptAvailable: false,
    },
    lastScanTime: 0,
    lastUpdateCheck: 0,
  })),
  uninstallApp: vi.fn(async () => ({
    success: true,
    message: "ok",
    exitCode: 0,
    errorCode: null,
    permissionIssue: false,
  })),
  upgradeApp: vi.fn(async () => ({
    success: true,
    message: "ok",
    exitCode: 0,
    errorCode: null,
    permissionIssue: false,
  })),
}))

function HookHarness({ active }: { active: boolean }) {
  useAppManagerController(active)
  return null
}

function OperationHarness() {
  const controller = useAppManagerController(false)
  const app = { appId: "app-1", name: "Demo" } as AppInfo
  return (
    <>
      <span data-testid="operation-status">{controller.getOpStatus("app-1")}</span>
      <button type="button" onClick={() => void controller.cancelAppOperation("app-1")}>
        cancel operation
      </button>
      <button type="button" onClick={() => controller.handleUpgradeFromColumn(app)}>
        open upgrade
      </button>
      <button type="button" onClick={() => void controller.handleConfirmAction()}>
        confirm upgrade
      </button>
    </>
  )
}

describe("useAppManagerController refresh routing", () => {
  beforeEach(() => {
    useAppManagerStore.getState().reset()
    useAppManagerStore.setState({
      scanned: true,
      updatesScanned: true,
      lastUpdateCheck: Date.now(),
    })

    vi.spyOn(appManagerUseCases, "loadPreferences").mockReturnValue({
      activeFilter: "all",
      sorting: [{ id: "name", desc: false }],
    })
    vi.spyOn(appManagerUseCases, "loadViewMode").mockReturnValue("table")
    vi.spyOn(appManagerUseCases, "savePreferences").mockImplementation(() => {})
    vi.spyOn(appManagerUseCases, "saveViewMode").mockImplementation(() => {})
    vi.spyOn(appManagerUseCases, "isAvailable").mockReturnValue(true)
    vi.spyOn(appManagerUseCases, "scanInstalledApps").mockResolvedValue({
      apps: [],
      totalCount: 0,
      userCount: 0,
      systemCount: 0,
      scanTimeMs: 0,
      managedCount: 0,
      lastScanTime: 0,
      lastUpdateCheck: 0,
      platformCapabilities: {
        brewAvailable: true,
        wingetAvailable: false,
        flatpakAvailable: false,
        snapAvailable: false,
        aptAvailable: false,
      },
    })
    vi.spyOn(appManagerUseCases, "findManagedAppUpdates").mockResolvedValue(new Set())
    vi.spyOn(appManagerUseCases, "checkAllAppUpdates").mockResolvedValue({
      updates: [],
      error: null,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("subscribes to operation status changes", () => {
    render(<OperationHarness />)

    expect(screen.getByTestId("operation-status").textContent).toBe("idle")
    act(() => {
      useAppManagerStore.setState({
        operations: { "app-1": { status: "running", message: "upgrading" } },
      })
    })

    expect(screen.getByTestId("operation-status").textContent).toBe("running")
  })

  it("marks cancellation in progress and restores running state when the cancel IPC fails", async () => {
    let rejectCancel: (error: Error) => void = () => {}
    const cancelPending = new Promise<void>((_, reject) => {
      rejectCancel = reject
    })
    vi.mocked(cancelAppUpdate).mockReturnValue(cancelPending)
    useAppManagerStore.setState({
      operations: { "app-1": { status: "running", message: "upgrading" } },
    })
    render(<OperationHarness />)

    fireEvent.click(screen.getByRole("button", { name: "cancel operation" }))
    expect(screen.getByTestId("operation-status").textContent).toBe("cancelling")
    expect(cancelAppUpdate).toHaveBeenCalledWith("app-1")

    await act(async () => {
      rejectCancel(new Error("IPC unavailable"))
      await cancelPending.catch(() => undefined)
    })

    expect(screen.getByTestId("operation-status").textContent).toBe("running")
  })

  it("does not let an older success timer clear a newer operation result", async () => {
    vi.useFakeTimers()
    const success: OperationResult = {
      success: true,
      message: "upgraded",
      exitCode: 0,
      errorCode: null,
      permissionIssue: false,
    }
    vi.spyOn(appManagerUseCases, "runAppOperation").mockResolvedValue({
      appId: "app-1",
      kind: "upgrade",
      result: success,
      shouldRescan: false,
    })
    render(<OperationHarness />)

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "open upgrade" }))
      fireEvent.click(screen.getByRole("button", { name: "confirm upgrade" }))
    })
    expect(screen.getByTestId("operation-status").textContent).toBe("success")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
      fireEvent.click(screen.getByRole("button", { name: "open upgrade" }))
      fireEvent.click(screen.getByRole("button", { name: "confirm upgrade" }))
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    expect(screen.getByTestId("operation-status").textContent).toBe("success")
  })

  it("routes shell refresh to update checks when the software update tab is active", async () => {
    const scanInstalledApps = vi.spyOn(appManagerUseCases, "scanInstalledApps")
    const checkAllAppUpdates = vi.spyOn(appManagerUseCases, "checkAllAppUpdates")

    render(<HookHarness active={true} />)

    act(() => {
      useAppManagerStore.getState().setActiveTab("softwareUpdate")
    })

    await act(async () => {
      await requestFeatureRefresh("app-manager")
    })

    expect(checkAllAppUpdates).toHaveBeenCalledWith(true)
    expect(scanInstalledApps).not.toHaveBeenCalled()
  })

  it("clears stale update flags when a successful check returns no updates", () => {
    const staleApp = {
      appId: "app-v1-stale",
      upgradeAvailable: true,
    } as AppInfo

    const [reconciled] = reconcileManagedUpdateAvailability([staleApp], new Set())

    expect(reconciled.upgradeAvailable).toBe(false)
  })

  it("keeps the update list in the flexible content area when a warning is visible", () => {
    const update: UpdateInfo = {
      updateId: "update-v1-firefox",
      inventoryRevision: 1,
      appId: "app-v1-firefox",
      appName: "Firefox",
      source: "homebrew",
      currentVersion: "151.0",
      latestVersion: "152.0.5",
      downloadUrl: null,
      adamId: null,
      releaseNotesUrl: null,
      releaseNotesInline: null,
      size: null,
      sourceMeta: null,
      feedUrl: null,
      ignored: false,
    }

    const { container } = render(
      <TooltipProvider>
        <SoftwareUpdateView
          apps={[]}
          updates={[update]}
          searchQuery=""
          loading={false}
          scanned={true}
          error=""
          warning="Electron, Sparkle"
          lastUpdateCheck={0}
          selectedIds={new Set()}
          selectedUpdate={null}
          sourceFilter="all"
          expandedGroups={{} as Record<UpdateInfo["source"], boolean>}
          updateOperations={{}}
          onSearchQueryChange={() => {}}
          onRecheck={() => {}}
          onToggleGroup={() => {}}
          onToggleSelect={() => {}}
          onChangeSourceFilter={() => {}}
          onRowClick={() => {}}
          onCloseDetail={() => {}}
          onRowAction={() => {}}
          onGroupAction={() => {}}
          onOpenExternal={() => {}}
        />
      </TooltipProvider>,
    )

    const root = container.firstElementChild
    expect(root?.classList.contains("flex")).toBe(true)
    expect(root?.classList.contains("grid")).toBe(false)
    // warning 现以 toast 形式提示，不进入视图 DOM，故列表仍正常渲染于弹性内容区
    expect(screen.queryByText("Electron, Sparkle")).toBeNull()
    expect(screen.getByText("Firefox")).toBeTruthy()
  })
})
