/**
 * Builds the downloadable Codex plugin ZIP shipped with the web build
 * (and so with the hosted release). It contains a local plugin marketplace
 * plus plugins/tan-studio-hosted from an explicit allowlist, and nothing else:
 * no credential, local config or source cache. Output is byte-deterministic.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { deflateRawSync } from "node:zlib"

export const CODEX_PLUGIN_PATH = "downloads/tan-studio-codex-plugin.zip"
export const HOSTED_MCP_URL = "https://studio.tan.coffee/mcp"

const PLUGIN = "tan-studio-hosted"
/** Every file shipped from plugins/tan-studio-hosted. Add new files here deliberately. */
const PLUGIN_FILES = [
  "plugin.json",
  "mcp.json",
  "README.md",
  "skills/setup/SKILL.md",
  "skills/tan-studio/SKILL.md",
  "assets/icon.png",
  "assets/logo.png",
] as const

/** Patterns that must never appear in a public package. */
const SECRET_PATTERNS: [string, RegExp][] = [
  ["agent credential", /tsapi_[A-Za-z0-9]/u],
  ["API token", /\b[0-9a-f]{64}\b/u],
  ["bearer value", /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/u],
  ["authorization header", /"authorization"\s*:/iu],
]

type Manifest = {
  name: string
  version: string
  extensions?: {
    "com.openai"?: {
      onboardingSkill?: string
      interface?: { composerIcon?: string; logo?: string }
    }
  }
}

export function codexPluginFiles(repositoryRoot: string) {
  const pluginRoot = resolve(repositoryRoot, "plugins", PLUGIN)
  const files = new Map<string, Uint8Array>()
  for (const file of PLUGIN_FILES)
    files.set(
      `plugins/${PLUGIN}/${file}`,
      readFileSync(resolve(pluginRoot, file))
    )
  const text = (file: string) =>
    new TextDecoder().decode(files.get(`plugins/${PLUGIN}/${file}`))
  const manifest = JSON.parse(text("plugin.json")) as Manifest
  const mcp = JSON.parse(text("mcp.json")) as {
    mcpServers: Record<string, Record<string, unknown>>
  }

  if (manifest.name !== PLUGIN)
    throw Error(`plugin.json name must be ${PLUGIN}`)
  const servers = Object.values(mcp.mcpServers)
  const server = servers[0]
  const auth = (
    server?.extensions as { "com.openai"?: { auth?: unknown } } | undefined
  )?.["com.openai"]?.auth as { type?: string; headerScheme?: string }
  if (
    servers.length !== 1 ||
    server?.type !== "streamable-http" ||
    server.url !== HOSTED_MCP_URL ||
    auth?.type !== "api_key" ||
    auth.headerScheme !== "bearer" ||
    "headers" in server
  )
    throw Error(
      `mcp.json must declare one streamable-http server at ${HOSTED_MCP_URL} with api_key bearer auth and no headers`
    )
  const openai = manifest.extensions?.["com.openai"]
  for (const reference of [
    openai?.onboardingSkill,
    openai?.interface?.composerIcon,
    openai?.interface?.logo,
  ]) {
    const path = reference?.replace(/^\.\//u, "")
    if (path && !files.has(`plugins/${PLUGIN}/${path}`))
      throw Error(`plugin.json references ${reference}, which is not packaged`)
  }

  files.set(
    ".agents/plugins/marketplace.json",
    new TextEncoder().encode(
      JSON.stringify(
        {
          name: "tan-studio",
          interface: { displayName: "Tan Studio" },
          plugins: [
            {
              name: PLUGIN,
              source: { source: "local", path: `./plugins/${PLUGIN}` },
              policy: {
                installation: "AVAILABLE",
                authentication: "ON_INSTALL",
              },
              category: "Lifestyle",
            },
          ],
        },
        null,
        2
      ) + "\n"
    )
  )

  for (const [name, bytes] of files) {
    if (name.endsWith(".png")) continue
    const content = new TextDecoder().decode(bytes)
    for (const [label, pattern] of SECRET_PATTERNS)
      if (pattern.test(content))
        throw Error(`${name} looks like it contains a ${label}`)
  }
  return { files, version: manifest.version }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** A deterministic ZIP: sorted entries, fixed 1980-01-01 timestamps, 0644 files. */
export function zip(files: Map<string, Uint8Array>) {
  const local: Buffer[] = [],
    central: Buffer[] = []
  let offset = 0
  for (const name of [...files.keys()].sort()) {
    const data = files.get(name)!,
      compressed = deflateRawSync(data, { level: 9 }),
      fileName = Buffer.from(name, "utf8"),
      crc = crc32(data)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4) // version needed
    header.writeUInt16LE(0x0800, 6) // UTF-8 names
    header.writeUInt16LE(8, 8) // deflate
    header.writeUInt16LE(0, 10) // 00:00
    header.writeUInt16LE(0x21, 12) // 1980-01-01
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(compressed.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(fileName.length, 26)
    header.writeUInt16LE(0, 28)
    local.push(header, fileName, compressed)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(0x0314, 4) // made by Unix, 2.0
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(0x0800, 8)
    entry.writeUInt16LE(8, 10)
    entry.writeUInt16LE(0, 12)
    entry.writeUInt16LE(0x21, 14)
    entry.writeUInt32LE(crc, 16)
    entry.writeUInt32LE(compressed.length, 20)
    entry.writeUInt32LE(data.length, 24)
    entry.writeUInt16LE(fileName.length, 28)
    entry.writeUInt32LE((0o100644 << 16) >>> 0, 38) // regular file, rw-r--r--
    entry.writeUInt32LE(offset, 42)
    central.push(entry, fileName)
    offset += header.length + fileName.length + compressed.length
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.size, 8)
  end.writeUInt16LE(files.size, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...local, directory, end]))
}

export function buildCodexPluginZip(repositoryRoot: string) {
  const { files, version } = codexPluginFiles(repositoryRoot)
  return { bytes: zip(files), version, entries: [...files.keys()].sort() }
}
