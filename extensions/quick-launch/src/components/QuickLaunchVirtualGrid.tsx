import type { ReactNode } from "react";
import { VirtualGridView } from "@/components/content/VirtualGridView";
import type { AppInfo } from "@/lib/tauri/types/app-manager";

export const QUICK_LAUNCH_VIRTUALIZATION_THRESHOLD = 48;

export function shouldVirtualizeQuickLaunchApps(
  appCount: number,
  expanded: boolean,
): boolean {
  return expanded && appCount > QUICK_LAUNCH_VIRTUALIZATION_THRESHOLD;
}

export function QuickLaunchVirtualGrid({
  apps,
  renderCard,
}: {
  apps: AppInfo[];
  renderCard: (app: AppInfo) => ReactNode;
}) {
  return (
    <div
      className="h-[min(60vh,720px)] min-h-[240px] w-full"
      data-quick-launch-virtual-grid
    >
      <VirtualGridView
        data={apps}
        getRowId={(app) => app.appId}
        renderGridCard={renderCard}
        onItemClick={() => {}}
        estimatedCardHeight={124}
        gridColumns={8}
        minCardWidth={96}
        gap={8}
        rowPadding={[0, 8]}
        wrapperPadding="px-1 py-2"
      />
    </div>
  );
}
