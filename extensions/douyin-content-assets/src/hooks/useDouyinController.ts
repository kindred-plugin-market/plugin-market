/**
 * 页面级 controller：单 owner 管理能力状态与素材列表（DCA-01）。
 *
 * 约束（宿主 coding-standards §3）：
 * - 异步加载带 requestId 过期响应丢弃（切页/刷新竞态不得回写旧数据）；
 * - 可重复点击动作（导入/删除/重试）经 `useGuardedAsync` 防重入；
 * - store 不在此文件——本插件状态简单，controller 即唯一编排者。
 */
import { useCallback, useEffect, useRef, useState } from "react"

import {
  deleteItems,
  getCapabilities,
  importFiles,
  listItems,
  type CapturedItem,
  type DouyinCapabilities,
} from "@extension/services/douyin.repository"
import { isListTypeKey, type ListTypeKey } from "@extension/lib/format"

const PAGE_SIZE = 50

export type LoadPhase = "loading" | "ready" | "failed"

export function useDouyinController() {
  const [capabilities, setCapabilities] = useState<DouyinCapabilities | null>(null)
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null)
  const [items, setItems] = useState<CapturedItem[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [phase, setPhase] = useState<LoadPhase>("loading")
  const [listError, setListError] = useState<string | null>(null)
  const [listType, setListType] = useState<ListTypeKey | "all">("all")
  const [search, setSearch] = useState("")

  // 过期响应丢弃：只有最新一次请求允许回写状态。
  const loadGenerationRef = useRef(0)

  const loadCapabilities = useCallback(async () => {
    setCapabilitiesError(null)
    try {
      const next = await getCapabilities()
      setCapabilities(next)
    } catch (error) {
      setCapabilities(null)
      setCapabilitiesError(typeof error === "string" ? error : String(error))
    }
  }, [])

  const loadItems = useCallback(
    async (nextListType: ListTypeKey | "all", nextSearch: string) => {
      const generation = ++loadGenerationRef.current
      setPhase("loading")
      setListError(null)
      try {
        const page = await listItems({
          offset: 0,
          limit: PAGE_SIZE,
          listType: nextListType === "all" ? undefined : nextListType,
          search: nextSearch.trim() || undefined,
        })
        if (generation !== loadGenerationRef.current) return // 过期响应
        setItems(page.items)
        setTotal(page.total)
        setHasMore(page.hasMore)
        setPhase("ready")
      } catch (error) {
        if (generation !== loadGenerationRef.current) return
        setItems([])
        setTotal(0)
        setHasMore(false)
        setListError(typeof error === "string" ? error : String(error))
        setPhase("failed")
      }
    },
    [],
  )

  const refresh = useCallback(() => {
    void loadCapabilities()
    void loadItems(listType, search)
  }, [loadCapabilities, loadItems, listType, search])

  useEffect(() => {
    void loadCapabilities()
    void loadItems("all", "")
  }, [loadCapabilities, loadItems])

  const changeListType = useCallback(
    (next: string) => {
      const value = next === "all" || isListTypeKey(next) ? next : "all"
      setListType(value)
      void loadItems(value as ListTypeKey | "all", search)
    },
    [loadItems, search],
  )

  const changeSearch = useCallback(
    (next: string) => {
      setSearch(next)
      void loadItems(listType, next)
    },
    [loadItems, listType],
  )

  const importVideos = useCallback(async () => {
    const outcome = await importFiles()
    if (outcome.imported.length > 0 || outcome.duplicates > 0) {
      void loadItems(listType, search)
    }
    return outcome
  }, [loadItems, listType, search])

  const deleteByIds = useCallback(
    async (itemIds: string[], assetIds: string[]) => {
      const outcome = await deleteItems({ itemIds, assetIds })
      if (outcome.itemsDeleted > 0 || outcome.assetsDeleted > 0) {
        void loadItems(listType, search)
      }
      return outcome
    },
    [loadItems, listType, search],
  )

  return {
    capabilities,
    capabilitiesError,
    reloadCapabilities: loadCapabilities,
    items,
    total,
    hasMore,
    phase,
    listError,
    listType,
    search,
    reload: refresh,
    changeListType,
    changeSearch,
    importVideos,
    deleteByIds,
  }
}
