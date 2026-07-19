import { Badge } from "@tan-studio/ui/components/badge"
import {
  CircleCheckIcon,
  CircleDashedIcon,
  Clock3Icon,
  OctagonAlertIcon,
  PlugZapIcon,
} from "lucide-react"

import type { RoastStatus } from "@/types"

const content: Record<
  RoastStatus,
  {
    label: string
    variant: "success" | "warning" | "info" | "secondary" | "destructive"
    icon: typeof CircleCheckIcon
  }
> = {
  tasted: { label: "Tasted", variant: "success", icon: CircleCheckIcon },
  "needs-tasting": { label: "Taste due", variant: "warning", icon: Clock3Icon },
  ready: { label: "Plan ready", variant: "info", icon: PlugZapIcon },
  imported: { label: "Imported", variant: "secondary", icon: CircleDashedIcon },
  interrupted: {
    label: "Interrupted",
    variant: "destructive",
    icon: OctagonAlertIcon,
  },
}

export function StatusChip({ status }: { status: RoastStatus }) {
  const item = content[status]
  const Icon = item.icon
  return (
    <Badge variant={item.variant}>
      <Icon data-icon="inline-start" />
      {item.label}
    </Badge>
  )
}
