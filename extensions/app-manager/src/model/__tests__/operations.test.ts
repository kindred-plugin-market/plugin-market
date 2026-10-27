import { describe, expect, it } from "vitest"
import { isOperationRunning, toOperationState } from "@extension/model/operations"
import type { OperationResult } from "@/lib/tauri/types/app-manager"

describe("app operation state", () => {
  it("treats cancelling operations as active for reentry guards", () => {
    expect(
      isOperationRunning({ app: { status: "cancelling", message: "Cancelling…" } }, "app"),
    ).toBe(true)
  })

  it("returns a user-cancelled operation to the idle state", () => {
    const result: OperationResult = {
      success: false,
      message: "Cancelled by user",
      exitCode: null,
      errorCode: "OPERATION_CANCELLED",
      permissionIssue: false,
    }

    expect(toOperationState(result)).toEqual({ status: "idle", message: "" })
  })
})
