import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

const repositoryRoot = resolve(import.meta.dir, "../../..")
const serviceBinary = resolve(
  process.env.TAN_STUDIO_SERVICE_BIN ??
    join(repositoryRoot, "apps/service/target/debug/tan-studio-service")
)
const mcpBundle = resolve(
  process.env.TAN_STUDIO_MCP_BUNDLE ??
    join(repositoryRoot, "plugins/tan-studio/dist/server.js")
)
const temporaryRoot = await mkdtemp(
  join(tmpdir(), "tan-studio-codex-plugin-e2e-")
)
const webRoot = join(temporaryRoot, "web")
const databasePath = join(temporaryRoot, "tan-studio.sqlite")
const port = await reservePort()
const baseUrl = `http://127.0.0.1:${port}`
const token = randomBytes(32).toString("hex")
const host = `127.0.0.1:${port}`

await mkdir(webRoot)
const service = Bun.spawn([serviceBinary], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    TAN_STUDIO_HEADLESS: "1",
    TAN_STUDIO_BIND_HOST: "127.0.0.1",
    TAN_STUDIO_PORT: String(port),
    TAN_STUDIO_DATABASE_PATH: databasePath,
    TAN_STUDIO_WEB_ROOT: webRoot,
    TAN_STUDIO_LAN_TOKEN: token,
    TAN_STUDIO_ALLOWED_ORIGINS: baseUrl,
    TAN_STUDIO_ALLOWED_HOSTS: host,
    TAN_STUDIO_VERSION: "codex-plugin-e2e",
  },
  stdin: "ignore",
  stdout: "ignore",
  stderr: "pipe",
})

let primaryClient: Client | undefined
let unauthorizedClient: Client | undefined
let unavailableClient: Client | undefined

try {
  await waitForService()

  const profile = await apiPost("/api/v1/profiles", {
    name: "Codex E2E Profile",
    description: "Disposable profile for MCP contract verification",
    designer: "Tan Studio",
    recommendedLevelThousandths: 1234,
    referenceLoadMg: 100_000,
    profile: { source: "codex-plugin-e2e" },
  })
  const coffee = await apiPost("/api/v1/coffees", {
    name: "Codex E2E Coffee",
    provider: "Disposable Provider",
    country: "Testland",
    region: "Ephemeral Valley",
    process: "Washed",
    purchasedMassMg: 1_000_000,
    remainingMassMg: 1_000_000,
    metadata: { disposable: true },
  })
  const roast = await apiPost("/api/v1/roasts", {
    profileId: numericField(profile, "id"),
    coffeeId: numericField(coffee, "id"),
    levelThousandths: 1200,
    greenInputMassMg: 100_000,
    adjustments: { boost: 0.1 },
    roasterParameters: { test: true },
  })

  primaryClient = await connectMcp("e2e-primary", {
    TAN_STUDIO_URL: baseUrl,
    TAN_STUDIO_API_TOKEN: token,
    TAN_STUDIO_TIMEOUT_MS: "2000",
  })

  const tools = await primaryClient.listTools()
  const toolNames = tools.tools.map((tool) => tool.name).sort()
  assert.deepEqual(toolNames, [
    "tan_add_note",
    "tan_create_label",
    "tan_get_context",
    "tan_get_roast",
    "tan_list_pantry",
    "tan_record_brew",
    "tan_search_coffees",
    "tan_search_profiles",
    "tan_search_roasts",
    "tan_status",
    "tan_sync_device",
  ])

  const resources = await primaryClient.listResources()
  assert.deepEqual(resources.resources.map((resource) => resource.uri).sort(), [
    "tan://device",
    "tan://pantry",
  ])
  const templates = await primaryClient.listResourceTemplates()
  assert.deepEqual(
    templates.resourceTemplates.map((template) => template.uriTemplate).sort(),
    [
      "tan://brews/{id}",
      "tan://coffees/{id}",
      "tan://profiles/{id}",
      "tan://roasts/{id}",
    ]
  )

  const status = await callOk(primaryClient, "tan_status")
  assert.equal(
    nestedField(status, "bootstrap", "applicationVersion"),
    "codex-plugin-e2e"
  )
  await callOk(primaryClient, "tan_list_pantry")

  const profiles = await callOk(primaryClient, "tan_search_profiles", {
    query: "Codex E2E",
    limit: 1,
  })
  assert.equal(arrayField(profiles, "items").length, 1)
  const coffees = await callOk(primaryClient, "tan_search_coffees", {
    query: "Ephemeral Valley",
    limit: 1,
  })
  assert.equal(arrayField(coffees, "items").length, 1)
  const roasts = await callOk(primaryClient, "tan_search_roasts", {
    profileId: numericField(profile, "id"),
    coffeeId: numericField(coffee, "id"),
    limit: 1,
  })
  assert.equal(arrayField(roasts, "items").length, 1)

  const roastDetail = await callOk(primaryClient, "tan_get_roast", {
    roastId: numericField(roast, "id"),
    includeTelemetry: true,
    maxPoints: 50,
  })
  assert.equal(
    nestedField(roastDetail, "roast", "id"),
    numericField(roast, "id")
  )
  assert.equal((roastDetail as { series?: unknown }).series, undefined)

  const brew = await callOk(primaryClient, "tan_record_brew", {
    roastId: numericField(roast, "id"),
    brewedAt: "2026-07-20T12:34:56-07:00",
    coffeeGrams: 16.25,
    waterGrams: 251.5,
    waterTemperatureCelsius: 95.5,
    method: "V60",
    grinder: "Codex Grinder",
    grinderSetting: "5.4.1",
    kettle: "Codex Kettle",
    water: "Codex Water",
    note: "Bright and deliberately disposable",
    ratingPercent: 88.25,
  })
  assert.equal(numericField(brew, "coffeeMassMg"), 16_250)
  assert.equal(numericField(brew, "waterMassMg"), 251_500)
  assert.equal(numericField(brew, "waterTemperatureMilliC"), 95_500)
  assert.equal(stringField(brew, "method"), "V60")
  const brewNotes = arrayField(brew, "notes")
  assert.equal(brewNotes.length, 1)
  assert.equal(numericField(brewNotes[0], "ratingBasisPoints"), 8_825)

  const note = await callOk(primaryClient, "tan_add_note", {
    body: "Decrease boost slightly on the next disposable roast",
    kind: "recommendation",
    ratingPercent: 91.2,
    links: [
      { resourceType: "roast", resourceId: numericField(roast, "id") },
      { resourceType: "brew", resourceId: numericField(brew, "id") },
    ],
  })
  assert.equal(stringField(note, "source"), "agent")
  assert.equal(nestedField(note, "attributes", "agent"), "codex")
  assert.equal(numericField(note, "ratingBasisPoints"), 9_120)
  assert.equal(arrayField(note, "links").length, 2)

  const label = await callOk(primaryClient, "tan_create_label", {
    roastId: numericField(roast, "id"),
    copies: 2,
    printer: "PDF test queue",
    widthMillimeters: 50.8,
    heightMillimeters: 30.5,
  })
  assert.equal(numericField(label, "widthMicrometers"), 50_800)
  assert.equal(numericField(label, "heightMicrometers"), 30_500)
  assert.equal(numericField(label, "copies"), 2)
  assert.equal(stringField(label, "status"), "generated")
  assert.notEqual(stringField(label, "status"), "physicallyConfirmed")

  for (const [resourceType, id] of [
    ["profile", numericField(profile, "id")],
    ["coffee", numericField(coffee, "id")],
    ["roast", numericField(roast, "id")],
    ["brew", numericField(brew, "id")],
  ] as const) {
    await callOk(primaryClient, "tan_get_context", { resourceType, id })
    const result = await primaryClient.readResource({
      uri: `tan://${resourceType}s/${id}`,
    })
    assert.equal(result.contents.length, 1)
    assert.equal(result.contents[0]?.mimeType, "application/json")
  }
  await primaryClient.readResource({ uri: "tan://pantry" })
  await primaryClient.readResource({ uri: "tan://device" })

  const rejectedKind = await primaryClient.callTool({
    name: "tan_add_note",
    arguments: {
      body: "The MCP schema must reject this before HTTP",
      kind: "future-kind",
      links: [{ resourceType: "roast", resourceId: numericField(roast, "id") }],
    },
  })
  assert.equal(rejectedKind.isError, true)
  assert.match(JSON.stringify(rejectedKind.content), /invalid arguments/iu)

  const missingRoast = await callError(primaryClient, "tan_record_brew", {
    roastId: 999_999,
    coffeeGrams: 16,
    waterGrams: 250,
  })
  assert.match(missingRoast, /not_found|not found|404/iu)
  assert.doesNotMatch(missingRoast, new RegExp(token, "u"))

  const invalidLink = await callError(primaryClient, "tan_add_note", {
    body: "This must fail atomically",
    links: [{ resourceType: "roast", resourceId: 999_999 }],
  })
  assert.match(invalidLink, /not_found|not found|404|422/iu)
  const notesAfterFailure = await apiGet(
    "/api/v1/notes?resourceType=roast&resourceId=999999"
  )
  assert.equal(arrayField(notesAfterFailure, "items").length, 0)

  unauthorizedClient = await connectMcp("e2e-unauthorized", {
    TAN_STUDIO_URL: baseUrl,
    TAN_STUDIO_API_TOKEN: "0".repeat(64),
    TAN_STUDIO_TIMEOUT_MS: "1000",
  })
  const unauthorized = await callError(unauthorizedClient, "tan_status")
  assert.match(unauthorized, /401|authentication|token/iu)
  assert.doesNotMatch(unauthorized, /0{32}/u)

  const unavailablePort = await reservePort()
  unavailableClient = await connectMcp("e2e-unavailable", {
    TAN_STUDIO_URL: `http://127.0.0.1:${unavailablePort}`,
    TAN_STUDIO_API_TOKEN: token,
    TAN_STUDIO_TIMEOUT_MS: "250",
  })
  const unavailable = await callError(unavailableClient, "tan_status")
  assert.match(unavailable, /fetch|connect|refused|failed|timeout/iu)
  assert.doesNotMatch(unavailable, new RegExp(token, "u"))

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "ok",
        serviceBinary,
        mcpBundle,
        tools: toolNames.length,
        staticResources: resources.resources.length,
        resourceTemplates: templates.resourceTemplates.length,
        created: {
          profile: numericField(profile, "id"),
          coffee: numericField(coffee, "id"),
          roast: numericField(roast, "id"),
          brew: numericField(brew, "id"),
          note: numericField(note, "id"),
          label: numericField(label, "id"),
        },
        verifiedFailures: [
          "missing-resource",
          "invalid-input-schema",
          "atomic-link",
          "unauthorized",
          "unavailable",
        ],
      },
      null,
      2
    )}\n`
  )
} finally {
  await Promise.allSettled([
    primaryClient?.close(),
    unauthorizedClient?.close(),
    unavailableClient?.close(),
  ])
  service.kill("SIGTERM")
  const exitCode = await Promise.race([
    service.exited,
    Bun.sleep(2_000).then(() => undefined),
  ])
  if (exitCode === undefined) service.kill("SIGKILL")
  await rm(temporaryRoot, { recursive: true, force: true })
}

async function connectMcp(
  name: string,
  overrides: Record<string, string>
): Promise<Client> {
  const environment = Object.fromEntries(
    Object.entries({ ...process.env, ...overrides }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  )
  const transport = new StdioClientTransport({
    command: "bun",
    args: ["run", mcpBundle],
    cwd: repositoryRoot,
    env: environment,
    stderr: "pipe",
  })
  const client = new Client({ name, version: "0.1.0" })
  await client.connect(transport)
  return client
}

async function callOk(
  client: Client,
  name: string,
  argumentsValue?: Record<string, unknown>
): Promise<unknown> {
  const result = await client.callTool({
    name,
    ...(argumentsValue !== undefined ? { arguments: argumentsValue } : {}),
  })
  assert.notEqual(result.isError, true, JSON.stringify(result.content))
  assert.ok(result.structuredContent)
  return (result.structuredContent as { data: unknown }).data
}

async function callError(
  client: Client,
  name: string,
  argumentsValue?: Record<string, unknown>
): Promise<string> {
  const result = await client.callTool({
    name,
    ...(argumentsValue !== undefined ? { arguments: argumentsValue } : {}),
  })
  assert.equal(result.isError, true)
  return JSON.stringify(result.content)
}

async function apiPost(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`${path}: ${response.status} ${await response.text()}`)
  }
  return response.json()
}

async function apiGet(path: string): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, { headers: apiHeaders() })
  if (!response.ok) {
    throw new Error(`${path}: ${response.status} ${await response.text()}`)
  }
  return response.json()
}

function apiHeaders(): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-Tan-Studio-Client": "tan-studio-api-v1",
  }
}

async function waitForService(): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthz`)
      if (response.ok) return
    } catch {
      // Service startup is expected to race the first probes.
    }
    await Bun.sleep(50)
  }
  const stderr = await new Response(service.stderr).text()
  throw new Error(`Tan Studio service did not start: ${stderr}`)
}

async function reservePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (address === null || typeof address === "string") {
        server.close()
        reject(new Error("Could not reserve a loopback port"))
        return
      }
      const selectedPort = address.port
      server.close((error) =>
        error ? reject(error) : resolvePort(selectedPort)
      )
    })
  })
}

function numericField(value: unknown, field: string): number {
  assert.ok(value !== null && typeof value === "object")
  const result = (value as Record<string, unknown>)[field]
  assert.equal(typeof result, "number", field)
  return result as number
}

function stringField(value: unknown, field: string): string {
  assert.ok(value !== null && typeof value === "object")
  const result = (value as Record<string, unknown>)[field]
  assert.equal(typeof result, "string", field)
  return result as string
}

function arrayField(value: unknown, field: string): unknown[] {
  assert.ok(value !== null && typeof value === "object")
  const result = (value as Record<string, unknown>)[field]
  assert.ok(Array.isArray(result), field)
  return result
}

function nestedField(value: unknown, parent: string, child: string): unknown {
  assert.ok(value !== null && typeof value === "object")
  const nested = (value as Record<string, unknown>)[parent]
  assert.ok(nested !== null && typeof nested === "object")
  return (nested as Record<string, unknown>)[child]
}
