/**
 * 页面级 controller：单 owner 管理能力状态与素材列表（DCA-01）。
 *
 * 约束（宿主 coding-standards §3）：
 * - 异步加载带 requestId 过期响应丢弃（切页/刷新竞态不得回写旧数据）；
 * - 可重复点击动作（导入/删除/重试）经 `useGuardedAsync` 防重入；
 * - store 不在此文件——本插件状态简单，controller 即唯一编排者。
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { getErrorMessage } from "@/lib/tauri/errors"
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
  // 后端 reject 的是 `{code,message}` 对象，`String(error)` 只会显示 [object Object]；
  // 统一走宿主的 getErrorMessage，并带一条 i18n 兜底文案（message 为空时界面不至于空白）。
  const { t } = useTranslation()
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
      setCapabilitiesError(getErrorMessage(error, t("douyinAssets.loadFailedFallback")))
    }
  }, [t])

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
        setListError(getErrorMessage(error, t("douyinAssets.loadFailedFallback")))
        setPhase("failed")
      }
    },
    [t],
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
