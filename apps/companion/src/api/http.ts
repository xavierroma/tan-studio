import type { Context } from "hono"
import type { ZodType } from "zod"
import { validationError } from "./problem"

export async function parseJson<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let input: unknown
  try {
    input = await c.req.json()
  } catch (error) {
    if (error instanceof SyntaxError) throw error
    throw new SyntaxError("Malformed JSON")
  }
  const result = schema.safeParse(input)
  if (!result.success) throw validationError(result.error)
  return result.data
}

export function isoInstant(epochMs: number): string {
  return new Date(epochMs).toISOString()
}

export function revisionEtag(revision: number): string {
  return `"revision:${revision}"`
}

export function setResourceHeaders(c: Context, revision: number): void {
  c.header("ETag", revisionEtag(revision))
}

export function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US")
}

export function newId(): string {
  return Bun.randomUUIDv7()
}
