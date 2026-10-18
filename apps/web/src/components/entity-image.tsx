import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@tan-studio/ui/components/avatar"
import { useQuery } from "@tanstack/react-query"
import {
  BeanIcon,
  ChartNoAxesCombinedIcon,
  CoffeeIcon,
  FlameIcon,
} from "lucide-react"
import { useEffect, useState } from "react"

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
  imageClassName = "object-cover",
  placeholder = false,
}: {
  attachmentId?: number | null | undefined
  entityType: EntityType
  alt?: string
  className?: string
  imageClassName?: string
  /** Show the icon tile when no image is attached (editors only). */
  placeholder?: boolean
}) {
  const image = useQuery({
    queryKey: ["attachment-content", attachmentId ?? "placeholder"],
    queryFn: () => getAttachmentContent({ id: attachmentId! }),
    enabled: attachmentId != null,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const [object, setObject] = useState<{ blob: Blob; url: string } | null>(null)
  useEffect(() => {
    if (!image.data) {
      setObject(null)
      return
    }
    const url = URL.createObjectURL(image.data)
    setObject({ blob: image.data, url })
    return () => URL.revokeObjectURL(url)
  }, [image.data])
  const url = object?.blob === image.data ? object?.url : null
  const Icon = icons[entityType]
  if (attachmentId == null && !placeholder) return null

  return (
    <Avatar
      className={`rounded-[3px] border after:rounded-[3px] ${className}`}
      aria-hidden={alt ? undefined : true}
    >
      {url ? (
        <AvatarImage
          src={url}
          alt={alt}
          className={`rounded-[3px] ${imageClassName}`}
        />
      ) : null}
      <AvatarFallback className="bg-muted rounded-[3px]">
        <Icon className="size-1/2" />
      </AvatarFallback>
    </Avatar>
  )
}
