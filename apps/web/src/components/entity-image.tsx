import { useQuery } from "@tanstack/react-query"
import {
  BeanIcon,
  ChartNoAxesCombinedIcon,
  CoffeeIcon,
  FlameIcon,
} from "lucide-react"
import { useEffect, useMemo } from "react"

import { getAttachmentContent } from "@/lib/api"

type EntityType = "profile" | "coffee" | "roast" | "brew"

const icons = {
  profile: ChartNoAxesCombinedIcon,
  coffee: BeanIcon,
  roast: FlameIcon,
  brew: CoffeeIcon,
} satisfies Record<EntityType, typeof BeanIcon>

export function EntityImage({
  attachmentId,
  entityType,
  alt = "",
  className = "size-12",
}: {
  attachmentId?: number | null | undefined
  entityType: EntityType
  alt?: string
  className?: string
}) {
  const image = useQuery({
    queryKey: ["attachment-content", attachmentId ?? "placeholder"],
    queryFn: () => getAttachmentContent({ id: attachmentId! }),
    enabled: attachmentId != null,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const url = useMemo(
    () => (image.data ? URL.createObjectURL(image.data) : null),
    [image.data]
  )
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url)
    },
    [url]
  )
  const Icon = icons[entityType]

  return (
    <span
      className={`bg-muted text-muted-foreground relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border ${className}`}
      aria-hidden={alt ? undefined : true}
    >
      {url ? (
        <img src={url} alt={alt} className="size-full object-cover" />
      ) : (
        <Icon className="size-1/2" />
      )}
    </span>
  )
}
