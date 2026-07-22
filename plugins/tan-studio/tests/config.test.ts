import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  DEFAULT_TAN_STUDIO_URL,
  loadConfig,
  normalizeBaseUrl,
} from "../src/config"

describe("Tan Studio plugin configuration", () => {
  test("defaults to the current always-on Mac LAN origin", async () => {
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

  test("loads persistent non-secret config with environment overrides", async () => {
    const userHome = await mkdtemp(join(tmpdir(), "tan-studio-plugin-"))
    const configDirectory = join(userHome, ".config", "tan-studio")
    const tokenFile = join(configDirectory, "service-token")
    try {
      await mkdir(configDirectory, { recursive: true })
      await writeFile(tokenFile, "c".repeat(64), { mode: 0o600 })
      await writeFile(
        join(configDirectory, "codex-plugin.json"),
        JSON.stringify({
          url: "http://configured.local:8080/api/v1",
          tokenFile,
          timeoutMs: 7_500,
        })
      )

      expect(await loadConfig({}, userHome)).toEqual({
        baseUrl: "http://configured.local:8080",
        token: "c".repeat(64),
        timeoutMs: 7_500,
      })
      expect(
        await loadConfig(
          {
            TAN_STUDIO_URL: "http://override.local:9000",
            TAN_STUDIO_API_TOKEN: "d".repeat(64),
            TAN_STUDIO_TIMEOUT_MS: "9000",
          },
          userHome
        )
      ).toEqual({
        baseUrl: "http://override.local:9000",
        token: "d".repeat(64),
        timeoutMs: 9_000,
      })
    } finally {
      await rm(userHome, { recursive: true, force: true })
    }
  })

  test("rejects secret-like or unknown persistent config fields", async () => {
    const userHome = await mkdtemp(join(tmpdir(), "tan-studio-plugin-"))
    const configDirectory = join(userHome, ".config", "tan-studio")
    try {
      await mkdir(configDirectory, { recursive: true })
      await writeFile(
        join(configDirectory, "codex-plugin.json"),
        JSON.stringify({ token: "must-not-live-here" })
      )
      expect(loadConfig({}, userHome)).rejects.toThrow(
        "Unknown Tan Studio plugin config field"
      )
    } finally {
      await rm(userHome, { recursive: true, force: true })
    }
  })
})
