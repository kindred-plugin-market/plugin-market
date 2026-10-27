import { Loader2, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { OperationStatus } from "@extension/model/operations"

interface OperationCancelButtonProps {
  status: OperationStatus
  onCancel: () => void
  compact?: boolean
}

export function OperationCancelButton({
  status,
  onCancel,
  compact = false,
}: OperationCancelButtonProps) {
  const { t } = useTranslation()
  if (status !== "running" && status !== "cancelling") return null

  const cancelling = status === "cancelling"
  const label = t(cancelling ? "appManager.operation.cancelling" : "appManager.operation.cancel")
  const Icon = cancelling ? Loader2 : X

  return (
    <Button
      type="button"
      variant="ghost"
      size={compact ? "icon" : "sm"}
      className={cn("shrink-0", compact && "h-7 w-7")}
      disabled={cancelling}
      title={label}
      aria-label={label}
      onClick={onCancel}
    >
      <Icon size={14} className={cn(cancelling && "animate-spin", !compact && "mr-1")} />
      {!compact && <span>{label}</span>}
    </Button>
  )
}
