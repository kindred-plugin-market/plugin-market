import { useTranslation } from "react-i18next"
import { FeatureLoadError } from "@/components/common/FeatureLoadError"
import { ScrollableArea } from "@/components/common/ScrollableArea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { useDouyinController } from "@extension/hooks/useDouyinController"
import { LibraryTab } from "@extension/components/LibraryTab"
import { CaptureTab } from "@extension/components/CaptureTab"

export default function DouyinContentAssetsPage() {
  const { t } = useTranslation()
  const controller = useDouyinController()

  if (controller.phase === "loading" && controller.items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-muted-foreground">{t("douyinAssets.loading")}</p>
      </div>
    )
  }

  if (controller.phase === "failed" && controller.items.length === 0) {
    return (
      <FeatureLoadError
        title={t("douyinAssets.loadFailedTitle")}
        description={controller.listError ?? t("douyinAssets.loadFailedFallback")}
        onRetry={() => controller.reload()}
      />
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t("douyinAssets.title")}</h1>
      </div>

      <Tabs defaultValue="library" className="flex flex-1 flex-col overflow-hidden">
        <TabsList className="mb-4 w-fit select-none">
          <TabsTrigger value="library" className="select-none">
            {t("douyinAssets.tabs.library")}
          </TabsTrigger>
          <TabsTrigger value="capture" className="select-none">
            {t("douyinAssets.tabs.capture")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="library" className="flex min-h-0 flex-1 flex-col" forceMount>
          <ScrollableArea
            className="flex min-h-0 flex-1 flex-col"
            wrapperClassName="flex min-h-0 flex-1"
          >
            <LibraryTab controller={controller} />
          </ScrollableArea>
        </TabsContent>

        <TabsContent value="capture" className="flex min-h-0 flex-1 flex-col" forceMount>
          <ScrollableArea
            className="flex min-h-0 flex-1 flex-col"
            wrapperClassName="flex min-h-0 flex-1"
          >
            <CaptureTab
              capabilities={controller.capabilities}
              error={controller.capabilitiesError}
              onRetry={() => void controller.reloadCapabilities()}
            />
          </ScrollableArea>
        </TabsContent>
      </Tabs>
    </div>
  )
}
