import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  cpSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { inflateRawSync } from "node:zlib"
import { afterEach, describe, expect, it } from "vitest"

import { buildCodexPluginZip, HOSTED_MCP_URL } from "./codex-plugin-package"

const root = resolve(import.meta.dirname, "../..")

/** Reads a ZIP through its central directory, the way extractors do. */
function unzip(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes),
    end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = buffer.readUInt16LE(end + 10)
  let at = buffer.readUInt32LE(end + 16)
  const files = new Map<string, { data: Buffer; mode: number }>()
  for (let i = 0; i < count; i++) {
    const nameLength = buffer.readUInt16LE(at + 28),
      extra = buffer.readUInt16LE(at + 30),
      comment = buffer.readUInt16LE(at + 32),
      mode = buffer.readUInt32LE(at + 38) >>> 16,
      offset = buffer.readUInt32LE(at + 42),
      size = buffer.readUInt32LE(at + 20),
      name = buffer.toString("utf8", at + 46, at + 46 + nameLength)
    const start =
      offset +
      30 +
      buffer.readUInt16LE(offset + 26) +
      buffer.readUInt16LE(offset + 28)
    files.set(name, {
      data: inflateRawSync(buffer.subarray(start, start + size)),
      mode,
    })
    at += 46 + nameLength + extra + comment
  }
  return files
}

let scratch: string | undefined
afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true })
  scratch = undefined
})

describe("downloadable Codex plugin", () => {
  it("ships exactly the hosted plugin and a local marketplace that points at it", () => {
    const { bytes, entries } = buildCodexPluginZip(root)
    expect(entries).toEqual([
      ".agents/plugins/marketplace.json",
      "plugins/tan-studio-hosted/README.md",
      "plugins/tan-studio-hosted/assets/icon.png",
      "plugins/tan-studio-hosted/assets/logo.png",
      "plugins/tan-studio-hosted/mcp.json",
      "plugins/tan-studio-hosted/plugin.json",
      "plugins/tan-studio-hosted/skills/setup/SKILL.md",
      "plugins/tan-studio-hosted/skills/tan-studio/SKILL.md",
    ])
    const files = unzip(bytes)
    expect([...files.keys()].sort()).toEqual(entries)
    for (const { mode } of files.values()) expect(mode).toBe(0o100644)

    const marketplace = JSON.parse(
      files.get(".agents/plugins/marketplace.json")!.data.toString()
    )
    const entry = marketplace.plugins[0]
    expect(entry.source).toEqual({
      source: "local",
      path: "./plugins/tan-studio-hosted",
    })
    expect(files.has(`${entry.source.path.slice(2)}/plugin.json`)).toBe(true)

    const manifest = JSON.parse(
      files.get("plugins/tan-studio-hosted/plugin.json")!.data.toString()
    )
    expect(manifest.name).toBe(entry.name)
    const ui = manifest.extensions["com.openai"]
    for (const ref of [
      ui.onboardingSkill,
      ui.interface.composerIcon,
      ui.interface.logo,
    ])
      expect(files.has(`plugins/tan-studio-hosted/${ref.slice(2)}`)).toBe(true)
    expect(ui.interface.brandColor).toBe("#B6151B")

    const server = JSON.parse(
      files.get("plugins/tan-studio-hosted/mcp.json")!.data.toString()
    ).mcpServers["tan-studio"]
    expect(server.url).toBe(HOSTED_MCP_URL)
    expect(server.extensions["com.openai"].auth).toEqual({
      type: "api_key",
      headerScheme: "bearer",
    })
    expect(server.headers).toBeUndefined()
  })

  it("is generic and secret-free", () => {
    const text = [...unzip(buildCodexPluginZip(root).bytes)]
      .filter(([name]) => !name.endsWith(".png"))
      .map(([, file]) => file.data.toString())
      .join("\n")
    expect(text).not.toMatch(/tsapi_|Authorization|Bearer\s+\S{8,}/u)
    // One operator's approved grant must not travel with the public package.
    expect(text).not.toMatch(
      /Approved (grant|label|term)|Xavier Codex|2031-10-17/u
    )
    expect(text).not.toMatch(/do not ask (to approve it )?again/iu)
    expect(text).toContain("Settings → Agents")
  })

  it("is byte-for-byte reproducible", () => {
    expect(buildCodexPluginZip(root).bytes).toEqual(
      buildCodexPluginZip(root).bytes
    )
  })

  it("refuses to package a credential", () => {
    scratch = mkdtempSync(join(tmpdir(), "tan-plugin-"))
    cpSync(
      join(root, "plugins/tan-studio-hosted"),
      join(scratch, "plugins/tan-studio-hosted"),
      {
        recursive: true,
      }
    )
    const readme = join(scratch, "plugins/tan-studio-hosted/README.md")
    writeFileSync(
      readme,
      `${readFileSync(readme, "utf8")}\ntsapi_fictionalsecret\n`
    )
    expect(() => buildCodexPluginZip(scratch!)).toThrow(/agent credential/)
  })
})
