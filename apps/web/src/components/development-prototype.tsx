import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@tan-studio/ui/components/alert"
import { ConstructionIcon } from "lucide-react"
import type { ReactNode } from "react"

import { demoDataEnabled } from "@/lib/api"

import { PageHeader } from "./page-header"

type DevelopmentPrototypeProps = {
  title: string
  description: string
  children: ReactNode
}

export function DevelopmentPrototype({
  title,
  description,
  children,
}: DevelopmentPrototypeProps) {
  if (demoDataEnabled) return children

  return (
    <div className="min-h-screen">
      <PageHeader
        eyebrow="Capability not enabled"
        title={title}
        description={description}
      />
      <div className="px-5 py-6 sm:px-7">
        <Alert className="bg-info max-w-3xl">
          <ConstructionIcon />
          <AlertTitle>This workflow is not connected yet</AlertTitle>
          <AlertDescription>
            Tan Studio has not substituted sample coffee, roast, profile, or
            device state. This view will become available when its companion API
            and persistence capability are enabled.
          </AlertDescription>
        </Alert>
      </div>
    </div>
  )
}
