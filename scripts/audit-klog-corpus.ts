import { readdir } from "node:fs/promises"
import { basename, relative, resolve } from "node:path"

import {
  assertKlogImportable,
  parseKlog,
} from "../packages/native-format-adapters/src"

const corpusDirectory = Bun.argv[2]
if (!corpusDirectory) {
  throw new Error("Usage: bun run audit:klog -- /absolute/path/to/logs")
}

const root = resolve(corpusDirectory)
const files = (await readdir(root, { recursive: true, withFileTypes: true }))
  .filter(
    (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".klog")
  )
  .map((entry) => resolve(entry.parentPath, entry.name))
  .sort()

const results: Array<Record<string, unknown>> = []
let rejected = 0
for (const file of files) {
  try {
    const document = parseKlog(
      new Uint8Array(await Bun.file(file).arrayBuffer())
    )
    assertKlogImportable(document)
    results.push({
      file: relative(root, file) || basename(file),
      parserVersion: document.parserVersion,
      sourceHash: document.lossless.sourceHash,
      sourceBytes: document.lossless.originalBytes.byteLength,
      lineEnding: document.lossless.lineEnding,
      delimiter: document.delimiter,
      metadataKeys: [...new Set(document.metadata.map((entry) => entry.key))],
      channelNames: document.channels.map((channel) => channel.rawName),
      schemaFingerprint: document.compatibility.schemaFingerprint,
      sampleCount: document.samples.length,
      firstElapsedMs: document.samples[0]?.elapsedMs ?? null,
      lastElapsedMs: document.samples.at(-1)?.elapsedMs ?? null,
      eventKinds: document.events.map((event) => event.kind),
      recordingState: document.compatibility.recordingState,
      compatibility: document.compatibility.level,
      diagnostics: document.diagnostics.map(({ severity, code, line }) => ({
        severity,
        code,
        line: line ?? null,
      })),
    })
  } catch (error) {
    rejected += 1
    results.push({
      file: relative(root, file) || basename(file),
      rejected: true,
      code:
        error instanceof Error && "code" in error
          ? String(error.code)
          : "unknown_error",
      message:
        error instanceof Error ? error.message : "Unknown parser failure",
    })
  }
}

process.stdout.write(
  `${JSON.stringify(
    {
      parser: "tan-studio-klog",
      parserVersion: 2,
      root: basename(root),
      fileCount: files.length,
      accepted: files.length - rejected,
      rejected,
      results,
    },
    null,
    2
  )}\n`
)

if (rejected > 0) process.exitCode = 1
