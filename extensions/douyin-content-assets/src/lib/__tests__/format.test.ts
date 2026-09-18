import { describe, expect, it } from "vitest"
import { formatBytes, formatDateTime, isListTypeKey, toItemStatusKey } from "@extension/lib/format"

describe("formatBytes", () => {
  it("formats byte ranges deterministically", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(1024)).toBe("1.0 KB")
    expect(formatBytes(1536)).toBe("1.5 KB")
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB")
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.0 GB")
  })

  it("returns a placeholder for invalid input instead of throwing", () => {
    expect(formatBytes(-1)).toBe("—")
    expect(formatBytes(Number.NaN)).toBe("—")
  })
})

describe("formatDateTime", () => {
  it("returns a dash for missing or invalid values", () => {
    expect(formatDateTime(null)).toBe("—")
    expect(formatDateTime("")).toBe("—")
    expect(formatDateTime("not-a-date")).toBe("—")
  })

  it("formats a valid ISO timestamp", () => {
    expect(formatDateTime("2026-09-18T00:00:00Z")).not.toBe("—")
  })
})

describe("list type helpers", () => {
  it("accepts only the closed list-type set", () => {
    for (const key of ["favorite", "like", "watch_later", "profile", "other"]) {
      expect(isListTypeKey(key)).toBe(true)
    }
    expect(isListTypeKey("history")).toBe(false)
    expect(isListTypeKey("")).toBe(false)
  })

  it("maps unknown status to the visible new state", () => {
    expect(toItemStatusKey("new")).toBe("new")
    expect(toItemStatusKey("imported")).toBe("imported")
    expect(toItemStatusKey("weird")).toBe("new")
    expect(toItemStatusKey(null)).toBe("new")
  })
})
