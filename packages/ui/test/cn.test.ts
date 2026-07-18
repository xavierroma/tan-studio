import { describe, expect, test } from "bun:test"
import { cn } from "../src/lib/utils"

describe("cn", () => {
  test("merges semantic utility classes deterministically", () => {
    expect(cn("px-2 text-sm", false && "hidden", "px-4")).toBe("text-sm px-4")
  })
})
