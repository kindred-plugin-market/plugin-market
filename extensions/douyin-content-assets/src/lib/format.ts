/** 纯展示工具：格式化与状态推导（无副作用，独立可测）。 */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—"
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes
  let unit = "B"
  for (const next of units) {
    if (value < 1024) break
    value /= 1024
    unit = next
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit}`
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString()
}

export const LIST_TYPE_KEYS = ["favorite", "like", "watch_later", "profile", "other"] as const
export type ListTypeKey = (typeof LIST_TYPE_KEYS)[number]

export function isListTypeKey(value: string): value is ListTypeKey {
  return (LIST_TYPE_KEYS as readonly string[]).includes(value)
}

/** 条目状态徽章语义：`new`（待导入）| `imported`（已有本地视频）。 */
export type ItemStatusKey = "new" | "imported"

export function toItemStatusKey(status: string | null | undefined): ItemStatusKey {
  return status === "imported" ? "imported" : "new"
}
