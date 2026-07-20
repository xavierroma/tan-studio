import { describe, expect, test } from "bun:test"

import {
  DEFAULT_TAN_STUDIO_URL,
  loadConfig,
  normalizeBaseUrl,
} from "../src/config"

describe("Tan Studio plugin configuration", () => {
  test("defaults to the Raspberry Pi mDNS origin", async () => {
    const config = await loadConfig(
      { TAN_STUDIO_API_TOKEN: "a".repeat(64) },
      "/unused"
    )

    expect(config.baseUrl).toBe(DEFAULT_TAN_STUDIO_URL)
    expect(config.timeoutMs).toBe(5_000)
  })

  test("accepts an API URL and normalizes it to an origin", () => {
    expect(normalizeBaseUrl("http://coffee.local:8080/api/v1/")).toBe(
      "http://coffee.local:8080"
    )
  })

  test("rejects embedded credentials and unrelated paths", () => {
    expect(() => normalizeBaseUrl("http://secret@coffee.local")).toThrow(
      "must not contain credentials"
    )
    expect(() => normalizeBaseUrl("http://coffee.local/admin")).toThrow(
      "must be an origin"
    )
  })

  test("never accepts a whitespace-bearing token", async () => {
    expect(
      loadConfig(
        { TAN_STUDIO_API_TOKEN: "not a valid secret token" },
        "/unused"
      )
    ).rejects.toThrow("Invalid Tan Studio API token")
  })
})
