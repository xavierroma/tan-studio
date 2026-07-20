import { homedir } from "node:os"
import { join } from "node:path"

export const DEFAULT_TAN_STUDIO_URL = "http://tan-studio.local"
export const DEFAULT_TIMEOUT_MS = 5_000

export interface TanStudioConfig {
  baseUrl: string
  token: string
  timeoutMs: number
}

export interface ConfigEnvironment {
  TAN_STUDIO_URL?: string
  TAN_STUDIO_API_URL?: string
  TAN_STUDIO_API_TOKEN?: string
  TAN_STUDIO_TOKEN_FILE?: string
  TAN_STUDIO_TIMEOUT_MS?: string
}

export async function loadConfig(
  environment: ConfigEnvironment = process.env as ConfigEnvironment,
  userHome = homedir()
): Promise<TanStudioConfig> {
  const baseUrl = normalizeBaseUrl(
    environment.TAN_STUDIO_URL ??
      environment.TAN_STUDIO_API_URL ??
      DEFAULT_TAN_STUDIO_URL
  )
  const timeoutMs = parseTimeout(environment.TAN_STUDIO_TIMEOUT_MS)
  const token = await resolveToken(environment, userHome, baseUrl)

  return { baseUrl, token, timeoutMs }
}

export function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value.trim())
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("TAN_STUDIO_URL must use http or https")
  }
  if (parsed.username || parsed.password) {
    throw new Error("TAN_STUDIO_URL must not contain credentials")
  }
  if (parsed.search || parsed.hash) {
    throw new Error("TAN_STUDIO_URL must not contain a query or fragment")
  }

  const path = parsed.pathname.replace(/\/+$/, "")
  if (path && path !== "/api/v1") {
    throw new Error("TAN_STUDIO_URL must be an origin or end with /api/v1")
  }
  parsed.pathname = ""

  return parsed.toString().replace(/\/$/, "")
}

async function resolveToken(
  environment: ConfigEnvironment,
  userHome: string,
  baseUrl: string
): Promise<string> {
  const directToken = environment.TAN_STUDIO_API_TOKEN?.trim()
  if (directToken) return validateToken(directToken)

  const explicitTokenFile = environment.TAN_STUDIO_TOKEN_FILE?.trim()
  const userTokenFile = join(userHome, ".config", "tan-studio", "token")
  const macLanTokenFile = join(
    userHome,
    "Library",
    "Application Support",
    "com.xavierroma.tanstudio",
    "lan",
    "token"
  )
  const candidates = explicitTokenFile
    ? [explicitTokenFile]
    : [
        userTokenFile,
        ...(new URL(baseUrl).hostname === "tan-studio.local"
          ? []
          : [macLanTokenFile]),
      ]

  for (const tokenFile of candidates) {
    try {
      if (!(await Bun.file(tokenFile).exists())) continue
      return validateToken((await Bun.file(tokenFile).text()).trim())
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Invalid Tan Studio")
      ) {
        throw error
      }
    }
  }

  throw new Error(
    `Tan Studio API token is unavailable. Set TAN_STUDIO_API_TOKEN or TAN_STUDIO_TOKEN_FILE (tried ${candidates.join(
      ", "
    )}).`
  )
}

function validateToken(token: string): string {
  if (
    token.length < 16 ||
    token.length > 512 ||
    /\s|[\u0000-\u001f]/u.test(token)
  ) {
    throw new Error("Invalid Tan Studio API token")
  }
  return token
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS

  const timeout = Number(value)
  if (!Number.isInteger(timeout) || timeout < 250 || timeout > 60_000) {
    throw new Error(
      "TAN_STUDIO_TIMEOUT_MS must be an integer from 250 to 60000"
    )
  }
  return timeout
}
