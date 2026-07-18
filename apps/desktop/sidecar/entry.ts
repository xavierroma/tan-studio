import { isAbsolute } from "node:path"

type LaunchRecord = {
  protocolVersion: 1
  launchToken: string
  databasePath: string
  allowedOrigin: string
  development: boolean
}

const MAX_LAUNCH_RECORD_BYTES = 16 * 1024

async function readLaunchRecord(): Promise<LaunchRecord> {
  const reader = Bun.stdin.stream().getReader()
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let buffered = ""
  let receivedBytes = 0

  while (true) {
    const { done, value: chunk } = await reader.read()
    if (done) throw new Error("launch_record_missing")
    receivedBytes += chunk.byteLength
    if (receivedBytes > MAX_LAUNCH_RECORD_BYTES) {
      throw new Error("launch_record_too_large")
    }
    buffered += decoder.decode(chunk, { stream: true })

    const newline = buffered.indexOf("\n")
    if (newline === -1) continue
    if (buffered.slice(newline + 1).length !== 0) {
      throw new Error("launch_record_trailing_data")
    }

    const parsed: unknown = JSON.parse(buffered.slice(0, newline))
    return validateLaunchRecord(parsed)
  }
}

function validateLaunchRecord(value: unknown): LaunchRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("launch_record_invalid")
  }

  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const expectedKeys = [
    "allowedOrigin",
    "databasePath",
    "development",
    "launchToken",
    "protocolVersion",
  ]
  if (keys.join("|") !== expectedKeys.join("|")) {
    throw new Error("launch_record_invalid")
  }

  if (
    record.protocolVersion !== 1 ||
    typeof record.launchToken !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(record.launchToken) ||
    typeof record.databasePath !== "string" ||
    !isAbsolute(record.databasePath) ||
    record.databasePath.includes("\0") ||
    typeof record.allowedOrigin !== "string" ||
    !["tauri://localhost", "http://127.0.0.1:1420"].includes(
      record.allowedOrigin
    ) ||
    typeof record.development !== "boolean" ||
    (record.development && record.allowedOrigin !== "http://127.0.0.1:1420") ||
    (!record.development && record.allowedOrigin !== "tauri://localhost")
  ) {
    throw new Error("launch_record_invalid")
  }

  return record as LaunchRecord
}

const launch = await readLaunchRecord()
process.env.TAN_STUDIO_LAUNCH_TOKEN = launch.launchToken
process.env.TAN_STUDIO_DATABASE_PATH = launch.databasePath
process.env.TAN_STUDIO_ALLOWED_ORIGIN = launch.allowedOrigin
process.env.TAN_STUDIO_PORT = "0"
if (launch.development) process.env.TAN_STUDIO_DEV = "1"

await import("../../companion/src/index")

export {}
