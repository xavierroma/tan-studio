import { createHmac, createHash, timingSafeEqual } from "node:crypto"
import { ApiError } from "../api/problem"

type CursorPayload = {
  v: 1
  sessionId: string
  scope: string
  queryHash: string
  offset: number
  expiresAtMs: number
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`
}

function invalidCursor(): ApiError {
  return new ApiError({
    status: 409,
    code: "cursor_expired",
    title: "Cursor expired",
    detail: "The result cursor is invalid or expired. Refresh the first page.",
  })
}

export class CursorService {
  readonly #sessionId: string
  readonly #key: Buffer

  constructor(sessionId: string, launchToken: string) {
    this.#sessionId = sessionId
    this.#key = createHmac("sha256", launchToken)
      .update("tan-studio/cursor/v1")
      .digest()
  }

  queryHash(value: unknown): string {
    return createHash("sha256").update(canonical(value)).digest("hex")
  }

  issue(scope: string, queryHash: string, offset: number): string {
    const payload: CursorPayload = {
      v: 1,
      sessionId: this.#sessionId,
      scope,
      queryHash,
      offset,
      expiresAtMs: Date.now() + 15 * 60_000,
    }
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url")
    const signature = createHmac("sha256", this.#key)
      .update(encoded)
      .digest("base64url")
    return `${encoded}.${signature}`
  }

  read(cursor: string | undefined, scope: string, queryHash: string): number {
    if (!cursor) return 0
    const [encoded, signature, extra] = cursor.split(".")
    if (!encoded || !signature || extra) throw invalidCursor()

    const expected = createHmac("sha256", this.#key).update(encoded).digest()
    let actual: Buffer
    try {
      actual = Buffer.from(signature, "base64url")
    } catch {
      throw invalidCursor()
    }
    if (actual.toString("base64url") !== signature) throw invalidCursor()
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw invalidCursor()

    let payload: CursorPayload
    try {
      if (Buffer.from(encoded, "base64url").toString("base64url") !== encoded)
        throw invalidCursor()
      payload = JSON.parse(
        Buffer.from(encoded, "base64url").toString("utf8")
      ) as CursorPayload
    } catch {
      throw invalidCursor()
    }
    if (
      payload.v !== 1 ||
      payload.sessionId !== this.#sessionId ||
      payload.scope !== scope ||
      payload.queryHash !== queryHash ||
      payload.expiresAtMs < Date.now() ||
      !Number.isSafeInteger(payload.offset) ||
      payload.offset < 0
    ) {
      throw invalidCursor()
    }
    return payload.offset
  }
}
