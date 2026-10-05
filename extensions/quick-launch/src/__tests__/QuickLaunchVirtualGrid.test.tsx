import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppInfo } from "@/lib/tauri/types/app-manager";
import {
  QUICK_LAUNCH_VIRTUALIZATION_THRESHOLD,
  QuickLaunchVirtualGrid,
  shouldVirtualizeQuickLaunchApps,
} from "@extension/components/QuickLaunchVirtualGrid";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 124,
    getVirtualItems: () =>
      Array.from({ length: Math.min(count, 4) }, (_, index) => ({
        index,
        size: 124,
        start: index * 124,
      })),
  }),
}));

function makeApps(count: number): AppInfo[] {
  return Array.from(
    { length: count },
    (_, index) =>
      ({
        appId: `app-v1-${index}`,
      }) as AppInfo,
  );
}

describe("Quick Launch large scene virtualization", () => {
  it.each([0, 1, QUICK_LAUNCH_VIRTUALIZATION_THRESHOLD])(
    "keeps %i apps on the normal grid path",
    (count) => {
      expect(shouldVirtualizeQuickLaunchApps(count, true)).toBe(false);
    },
  );

  it.each([50, 500, 2000])(
    "virtualizes an expanded scene with %i apps",
    (count) => {
      expect(shouldVirtualizeQuickLaunchApps(count, true)).toBe(true);
      expect(shouldVirtualizeQuickLaunchApps(count, false)).toBe(false);

      const apps = makeApps(count);
      const { container } = render(
        <QuickLaunchVirtualGrid
          apps={apps}
          renderCard={(app) => (
            <button data-app-card={app.appId}>{app.appId}</button>
          )}
        />,
      );

      expect(
        container.querySelector("[data-quick-launch-virtual-grid]"),
      ).toHaveClass("h-[min(60vh,720px)]", "min-h-[240px]");
      expect(document.querySelector("[data-total-count]")).toHaveAttribute(
        "data-total-count",
        String(count),
      );
      expect(screen.getAllByRole("button").length).toBeLessThan(80);
      expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
    },
  );
});
