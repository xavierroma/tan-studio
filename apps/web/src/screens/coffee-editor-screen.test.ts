import { describe, expect, it } from "vitest"

import type { Coffee } from "@/lib/api"
import { remainingBody } from "./coffee-editor-screen"

const form = (remaining: string) => {
  const data = new FormData()
  data.set("remainingMass", remaining)
  return data
}
const coffee = { remainingMassMg: 640_500 } as Coffee

describe("coffee form green balance", () => {
  it("lets a new coffee default to its purchase when the balance is blank", () => {
    expect(remainingBody(form(""))).toEqual({})
    expect(remainingBody(form("0"))).toEqual({ remainingMassMg: 0 })
  })

  it("never records a correction for an unchanged or blank balance on edit", () => {
    expect(remainingBody(form("640.5"), coffee)).toEqual({})
    expect(remainingBody(form(""), coffee)).toEqual({})
    expect(remainingBody(form("600"), coffee)).toEqual({
      remainingMassMg: 600_000,
    })
  })
})
