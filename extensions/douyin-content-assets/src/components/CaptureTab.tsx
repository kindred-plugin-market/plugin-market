import { useTranslation } from "react-i18next"
import { RefreshCw } from "lucide-react"

import { formatBytes } from "@extension/lib/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { DouyinCapabilities } from "@/lib/tauri/types/douyin-content-assets"

/**
 * 采集说明：Companion 使用步骤 + 宿主能力状态（不假设机器有 worker/模型，
 * 状态一律来自 `douyin_assets_get_capabilities`，D-037）。
 */
export function CaptureTab({
  capabilities,
  error,
  onRetry,
}: {
  capabilities: DouyinCapabilities | null
  error: string | null
  onRetry: () => void
}) {
  const { t } = useTranslation()

  const steps = [1, 2, 3, 4, 5].map((index) => t(`douyinAssets.capture.step${index}`))

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("douyinAssets.capture.howToTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="text-muted-foreground mt-3 text-xs">
            {t("douyinAssets.capture.boundaryNote")}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{t("douyinAssets.capture.capabilitiesTitle")}</CardTitle>
          <Button
            variant="ghost"
            size="icon-sm"
            title={t("douyinAssets.library.refresh")}
            aria-label={t("douyinAssets.library.refresh")}
            onClick={onRetry}
          >
            <RefreshCw size={14} />
          </Button>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-destructive text-sm">{error}</p>
          ) : !capabilities ? (
            <p className="text-muted-foreground text-sm">{t("douyinAssets.loading")}</p>
          ) : (
            <ul className="space-y-3 text-sm">
              <li className="flex items-center gap-2">
                <span>{t("douyinAssets.capture.bridgeReady")}</span>
                <Badge variant={capabilities.capture.bridgeReady ? "default" : "secondary"}>
                  {t(
                    capabilities.capture.bridgeReady
                      ? "douyinAssets.capture.stateReady"
                      : "douyinAssets.capture.stateUnavailable",
                  )}
                </Badge>
              </li>
              <li className="flex items-center gap-2">
                <span>{t("douyinAssets.capture.mediaWorker")}</span>
                <Badge variant="secondary">{t("douyinAssets.capture.stateNotInstalled")}</Badge>
              </li>
              <li className="text-muted-foreground text-xs">
                {t("douyinAssets.capture.limitsLine", {
                  maxBatchItems: capabilities.limits.maxBatchItems,
                  maxImportFileBytes: formatBytes(capabilities.limits.maxImportFileBytes),
                })}
              </li>
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
