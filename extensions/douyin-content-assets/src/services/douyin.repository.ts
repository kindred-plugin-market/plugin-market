import { invokeTauriCommand } from "@/lib/tauri/invoke"
import type {
  CapturedItemPage,
  DeleteOutcome,
  DouyinCapabilities,
  ImportFilesOutcome,
} from "@/lib/tauri/types/douyin-content-assets"

export type {
  CapturedItem,
  CapturedItemPage,
  DeleteOutcome,
  DouyinCapabilities,
  ImportFilesOutcome,
  VideoAsset,
} from "@/lib/tauri/types/douyin-content-assets"

export function getCapabilities(): Promise<DouyinCapabilities> {
  return invokeTauriCommand("douyin_assets_get_capabilities")
}

export function listItems(args: {
  offset?: number
  limit?: number
  listType?: string
  search?: string
}): Promise<CapturedItemPage> {
  return invokeTauriCommand("douyin_assets_list_items", args)
}

/** 打开宿主原生文件选择器导入本地视频；用户取消返回空列表。 */
export function importFiles(): Promise<ImportFilesOutcome> {
  return invokeTauriCommand("douyin_assets_import_files")
}

/** 软删采集条目与/或视频资产（宿主保留数据，可后续物理清理）。 */
export function deleteItems(args: {
  itemIds?: string[]
  assetIds?: string[]
}): Promise<DeleteOutcome> {
  return invokeTauriCommand("douyin_assets_delete_items", args)
}
