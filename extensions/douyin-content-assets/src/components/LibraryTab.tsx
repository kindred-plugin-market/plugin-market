import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { FolderInput, RefreshCw, Search, Trash2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { useGuardedAsync } from "@/hooks/useGuardedAsync"
import { getErrorMessage } from "@/lib/tauri/errors"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

import {
  formatBytes,
  formatDateTime,
  LIST_TYPE_KEYS,
  toItemStatusKey,
  type ListTypeKey,
} from "@extension/lib/format"
import type { CapturedItem } from "@extension/services/douyin.repository"
import type { useDouyinController } from "@extension/hooks/useDouyinController"

type Controller = ReturnType<typeof useDouyinController>

/** 素材库：筛选/搜索/导入本地视频/软删。P1 不含识别任务（DCA-02 接入）。 */
export function LibraryTab({ controller }: { controller: Controller }) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const importGuard = useGuardedAsync()
  const deleteGuard = useGuardedAsync()

  const selectedItems = useMemo(
    () => controller.items.filter((item) => selected.has(item.id)),
    [controller.items, selected],
  )

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleImport = () =>
    importGuard.run(async () => {
      try {
        const outcome = await controller.importVideos()
        if (outcome.imported.length === 0 && outcome.duplicates === 0) {
          toast.info(t("douyinAssets.library.importCancelled"))
          return
        }
        toast.success(
          t("douyinAssets.library.importDone", {
            imported: outcome.imported.length,
            duplicates: outcome.duplicates,
          }),
        )
      } catch (error) {
        // `{code,message}` 形态的 reject 经 String() 会变成 [object Object]，必须用
        // 宿主 getErrorMessage 取 message 再套 i18n 前缀（与 app-manager 同一写法）。
        toast.error(
          t("douyinAssets.library.importFailed", {
            message: getErrorMessage(error, t("common.unknown")),
          }),
        )
      }
    })

  const handleDelete = () =>
    deleteGuard.run(async () => {
      setConfirmOpen(false)
      try {
        const outcome = await controller.deleteByIds(
          selectedItems.map((item) => item.id),
          [],
        )
        toast.success(t("douyinAssets.library.deleteDone", { count: outcome.itemsDeleted }))
        setSelected(new Set())
      } catch (error) {
        // 同上：软删失败也要给出可读原因，而不是 [object Object]
        toast.error(
          t("douyinAssets.library.deleteFailed", {
            message: getErrorMessage(error, t("common.unknown")),
          }),
        )
      }
    })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="text-muted-foreground absolute top-2.5 left-2.5" />
          <Input
            className="h-9 w-52 pl-8"
            placeholder={t("douyinAssets.library.searchPlaceholder")}
            value={controller.search}
            onChange={(event) => controller.changeSearch(event.target.value)}
          />
        </div>
        <div className="border-border flex rounded-md border">
          <TypeButton
            active={controller.listType === "all"}
            onClick={() => controller.changeListType("all")}
            label={t("douyinAssets.library.listTypeAll")}
          />
          {LIST_TYPE_KEYS.map((key) => (
            <TypeButton
              key={key}
              active={controller.listType === key}
              onClick={() => controller.changeListType(key)}
              label={t(`douyinAssets.library.listType.${key}`)}
            />
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            title={t("douyinAssets.library.refresh")}
            aria-label={t("douyinAssets.library.refresh")}
            onClick={() => controller.reload()}
          >
            <RefreshCw size={14} />
          </Button>
          <Button size="sm" disabled={importGuard.pending} onClick={() => void handleImport()}>
            <FolderInput size={14} className="mr-1.5" />
            {t("douyinAssets.library.importButton")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={selectedItems.length === 0 || deleteGuard.pending}
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 size={14} className="mr-1.5" />
            {t("douyinAssets.library.deleteButton", { count: selectedItems.length })}
          </Button>
        </div>
      </div>

      <div className="text-muted-foreground text-xs select-none">
        {t("douyinAssets.library.countLine", {
          shown: controller.items.length,
          total: controller.total,
        })}
      </div>

      {controller.items.length === 0 ? (
        <div className="text-muted-foreground flex flex-1 items-center justify-center rounded-md border border-dashed p-8 text-sm">
          {t("douyinAssets.library.empty")}
        </div>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-2">
          {controller.items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              selected={selected.has(item.id)}
              onToggle={() => toggleSelected(item.id)}
            />
          ))}
        </ul>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("douyinAssets.library.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("douyinAssets.library.deleteDescription", { count: selectedItems.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleDelete()}
            >
              {t("common.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function TypeButton({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <Button
      size="xs"
      className={cn(
        "rounded-none border-0 first:rounded-l-md last:rounded-r-md",
        active
          ? "bg-primary text-primary-foreground hover:bg-primary/80"
          : "text-muted-foreground hover:bg-muted bg-transparent",
      )}
      onClick={onClick}
    >
      {label}
    </Button>
  )
}

function ItemRow({
  item,
  selected,
  onToggle,
}: {
  item: CapturedItem
  selected: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const status = toItemStatusKey(item.status)
  return (
    <li className="border-border flex items-start gap-3 rounded-md border p-3">
      <input
        type="checkbox"
        className="mt-1"
        checked={selected}
        onChange={onToggle}
        aria-label={item.title ?? item.id}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {item.title ?? t("douyinAssets.library.untitled")}
          </span>
          <Badge variant={status === "imported" ? "default" : "outline"} className="text-[10px]">
            {t(`douyinAssets.library.status.${status}`)}
          </Badge>
        </div>
        <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {item.author ? <span>{item.author}</span> : null}
          <span>
            {t("douyinAssets.library.listTypeLabel")}:{" "}
            {t(`douyinAssets.library.listType.${item.listType as ListTypeKey}`)}
          </span>
          <span>{formatDateTime(item.capturedAt)}</span>
        </div>
        {item.shareUrl ? (
          <div className="text-muted-foreground mt-1 truncate text-xs" title={item.shareUrl}>
            {item.shareUrl}
          </div>
        ) : null}
      </div>
      <div className="text-muted-foreground shrink-0 text-right text-xs select-none">
        {item.videoAssetId ? t("douyinAssets.library.hasVideo") : null}
      </div>
    </li>
  )
}

// formatBytes 供 DCA-02 资产详情使用；此处保留导出以维持单一实现。
export { formatBytes }
