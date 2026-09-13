/**
 * Feature Store / 功能状态: store state and simple actions; 只存状态与简单动作.
 */
import { create } from "zustand"
import type { OperationStatus } from "@extension/model/operations"
import { createAppManagerBasicActions } from "@extension/model/store-basic-actions"
import { createInitialAppManagerState } from "@extension/model/store-state"
import type { AppFilterKey, AppManagerState } from "@extension/model/store-types"
import { APP_FILTER_OPTIONS } from "@extension/model/store-types"

export type { AppFilterKey, AppManagerState, OperationStatus }
export { APP_FILTER_OPTIONS }

export const useAppManagerStore = create<AppManagerState>((set) => ({
  ...createInitialAppManagerState(),
  ...createAppManagerBasicActions(set),
}))
