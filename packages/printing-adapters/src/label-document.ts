export type Sha256 = string
export type IsoInstant = string

export type PhysicalPoint = { xUm: number; yUm: number }
export type PhysicalRect = PhysicalPoint & { widthUm: number; heightUm: number }
export type SemanticInk =
  | "foreground"
  | "muted"
  | "primary"
  | "accent"
  | "success"
  | "warning"
  | "info"
  | "paper"
  | "black"
  | "white"
export type SemanticStroke = {
  ink: SemanticInk
  widthUm: number
  dashUm?: number[]
}
export type FontRef = {
  family: "geist_sans" | "noto_sans"
  style: "normal" | "italic"
}

export type LabelFieldValueMap = {
  "coffee.name": string
  "coffee.countryCode": string | null
  "coffee.region": string | null
  "coffee.farmProducer": string | null
  "coffee.process": string | null
  "coffee.varieties": string[]
  "provider.name": string | null
  "lot.code": string | null
  "roast.id": string
  "roast.roastedAt": string
  "roast.levelThousandths": number | null
  "roast.greenInputMassMg": number | null
  "roast.roastedYieldMassMg": number | null
  "roast.lossBasisPoints": number | null
  "package.netMassMg": number | null
  "profile.name": string | null
  "profile.revisionNumber": number | null
  "tasting.scoreBasisPoints": number | null
  "tasting.outcome": string | null
  "tasting.nextAction": string | null
  "label.useWindow": string | null
  "label.note": string | null
  "label.imageArtifactHash": Sha256 | null
  "label.opaqueRoastCode": string
}

export type AllowedLabelField = keyof LabelFieldValueMap
export type AllowedLabelFormatter =
  | { kind: "text"; join?: string; uppercase?: boolean }
  | {
      kind: "date"
      style: "short" | "medium" | "iso"
      timezone: "roast" | "local"
    }
  | {
      kind: "mass"
      unit: "g" | "kg" | "oz" | "lb"
      maximumFractionDigits: 0 | 1 | 2
    }
  | { kind: "percent"; maximumFractionDigits: 0 | 1 | 2 }
  | { kind: "number"; maximumFractionDigits: 0 | 1 | 2 | 3 }

export type LabelDataInput = {
  locale: string
  localTimezone: string
  roastTimezone: string
  sources: {
    roastId: string
    coffeeId?: string
    lotId?: string
    packageId?: string
    promotedTastingId?: string
    profileRevisionId?: string
  }
  values: { [K in AllowedLabelField]?: LabelFieldValueMap[K] }
}

export type LabelDataSnapshot = LabelDataInput & {
  schemaVersion: 1
  resolvedAt: IsoInstant
  snapshotHash: Sha256
}

export type LabelElementBase = {
  id: string
  rotationMdeg: number
  opacityBasisPoints: number
}
export type LabelBoxElementBase = LabelElementBase & { frame: PhysicalRect }

export type LabelBinding =
  | { kind: "literal"; value: string }
  | {
      kind: "field"
      path: AllowedLabelField
      format?: AllowedLabelFormatter
      fallback?: string
    }
export type LabelImageBinding =
  | { kind: "artifact"; hash: Sha256 }
  | { kind: "field"; path: "label.imageArtifactHash" }

export type LabelTemplateDocument = {
  schemaVersion: 1
  widthUm: number
  heightUm: number
  bleedUm: number
  safeInsetUm: number
  background: SemanticInk
  elements: LabelTemplateElement[]
}

export type LabelTemplateElement =
  | (LabelBoxElementBase & {
      kind: "text"
      content: LabelBinding
      font: FontRef
      sizeUm: number
      weight: number
      lineHeightBasisPoints: number
      horizontalAlign: "start" | "center" | "end"
      verticalAlign: "start" | "center" | "end"
      maxLines: number
      overflow: "error" | "ellipsis"
    })
  | (LabelElementBase & {
      kind: "line"
      from: PhysicalPoint
      to: PhysicalPoint
      strokeUm: number
      ink: SemanticInk
    })
  | (LabelBoxElementBase & {
      kind: "rect"
      radiusUm: number
      fill?: SemanticInk
      stroke?: SemanticStroke
    })
  | (LabelBoxElementBase & {
      kind: "image"
      artifact: LabelImageBinding
      fit: "contain" | "cover"
    })
  | (LabelBoxElementBase & {
      kind: "qr"
      data: LabelBinding
      correction: "M" | "Q"
      quietModules: number
    })
  | (LabelBoxElementBase & {
      kind: "barcode"
      data: LabelBinding
      symbology: "code128"
      humanReadable: boolean
    })

export type LabelDocument = Omit<LabelTemplateDocument, "elements"> & {
  elements: ResolvedLabelElement[]
}

export type ResolvedLabelElement =
  | (LabelBoxElementBase & {
      kind: "text"
      content: string
      font: FontRef
      sizeUm: number
      weight: number
      lineHeightBasisPoints: number
      horizontalAlign: "start" | "center" | "end"
      verticalAlign: "start" | "center" | "end"
      maxLines: number
      overflow: "error" | "ellipsis"
    })
  | (LabelElementBase & {
      kind: "line"
      from: PhysicalPoint
      to: PhysicalPoint
      strokeUm: number
      ink: SemanticInk
    })
  | (LabelBoxElementBase & {
      kind: "rect"
      radiusUm: number
      fill?: SemanticInk
      stroke?: SemanticStroke
    })
  | (LabelBoxElementBase & {
      kind: "image"
      artifactHash: Sha256
      fit: "contain" | "cover"
    })
  | (LabelBoxElementBase & {
      kind: "qr"
      data: string
      correction: "M" | "Q"
      quietModules: number
    })
  | (LabelBoxElementBase & {
      kind: "barcode"
      data: string
      symbology: "code128"
      humanReadable: boolean
    })
