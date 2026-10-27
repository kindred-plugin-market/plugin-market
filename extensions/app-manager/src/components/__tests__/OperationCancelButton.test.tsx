import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { OperationCancelButton } from "@extension/components/OperationCancelButton"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe("OperationCancelButton", () => {
  it("offers an accessible cancel action and disables it while cancellation is pending", () => {
    const onCancel = vi.fn()
    const { rerender } = render(
      <OperationCancelButton status="running" onCancel={onCancel} compact />,
    )
    const cancelButton = screen.getByRole("button", { name: "appManager.operation.cancel" })

    expect(cancelButton.getAttribute("title")).toBe("appManager.operation.cancel")
    fireEvent.click(cancelButton)
    expect(onCancel).toHaveBeenCalledOnce()

    rerender(<OperationCancelButton status="cancelling" onCancel={onCancel} compact />)
    expect(
      screen.getByRole("button", { name: "appManager.operation.cancelling" }).hasAttribute("disabled"),
    ).toBe(true)
  })
})
