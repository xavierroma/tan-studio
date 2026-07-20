import assert from "node:assert/strict"
import { resolve } from "node:path"

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

const repositoryRoot = resolve(import.meta.dir, "../../..")
const mcpBundle = resolve(
  process.env.TAN_STUDIO_MCP_BUNDLE ??
    resolve(repositoryRoot, "plugins/tan-studio/dist/server.js")
)
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined
  )
)
const transport = new StdioClientTransport({
  command: "bun",
  args: ["run", mcpBundle],
  cwd: repositoryRoot,
  env: inheritedEnvironment,
  stderr: "inherit",
})
const client = new Client({ name: "tan-studio-live-test", version: "0.1.0" })

try {
  await client.connect(transport)
  const tools = await client.listTools()
  assert.equal(tools.tools.length, 15)
  const resources = await client.listResources()
  assert.equal(resources.resources.length, 2)
  const templates = await client.listResourceTemplates()
  assert.equal(templates.resourceTemplates.length, 4)

  const statusBefore = await call("tan_status")
  const profiles = await call("tan_search_profiles", { limit: 200 })
  const coffees = await call("tan_search_coffees", { limit: 200 })
  const roasts = await call("tan_search_roasts", { limit: 200 })
  const pantry = await call("tan_list_pantry")

  const profileItems = arrayField(profiles, "items")
  const coffeeItems = arrayField(coffees, "items")
  const roastItems = arrayField(roasts, "items")
  assert.equal(numericField(profiles, "returned"), profileItems.length)
  assert.equal(numericField(coffees, "returned"), coffeeItems.length)
  assert.equal(numericField(roasts, "returned"), roastItems.length)
  assert.ok(roastItems.length > 0, "The live database should contain roasts")

  const bounded = await call("tan_search_roasts", { limit: 2 })
  assert.equal(arrayField(bounded, "items").length, 2)
  assert.equal(numericField(bounded, "returned"), 2)
  assert.equal(booleanField(bounded, "truncated"), roastItems.length > 2)

  for (const profile of profileItems) {
    const id = numericField(profile, "id")
    await call("tan_get_context", { resourceType: "profile", id })
    await readJsonResource(`tan://profiles/${id}`)
  }
  for (const coffee of coffeeItems) {
    const id = numericField(coffee, "id")
    await call("tan_get_context", { resourceType: "coffee", id })
    await readJsonResource(`tan://coffees/${id}`)
  }

  let telemetryRoasts = 0
  let telemetryPoints = 0
  const brewIds = new Set<number>()
  for (const roast of roastItems) {
    const id = numericField(roast, "id")
    const detail = await call("tan_get_roast", {
      roastId: id,
      includeTelemetry: true,
      maxPoints: 2_000,
    })
    assert.equal(nestedField(detail, "roast", "id"), id)
    const series = optionalObjectField(detail, "series")
    if (series !== undefined) {
      const points = arrayField(series, "points")
      assert.ok(points.length <= 2_000)
      assertSorted(points.map((point) => numericField(point, "elapsedMs")))
      telemetryRoasts += 1
      telemetryPoints += points.length
    }
    const context = await call("tan_get_context", {
      resourceType: "roast",
      id,
    })
    for (const brew of arrayField(context, "brews")) {
      brewIds.add(numericField(brew, "id"))
    }
    await readJsonResource(`tan://roasts/${id}`)
  }
  assert.ok(
    telemetryRoasts > 0,
    "At least one real roast should have telemetry"
  )
  assert.ok(telemetryPoints > 0, "Real roast telemetry should contain points")

  for (const id of brewIds) {
    await call("tan_get_context", { resourceType: "brew", id })
    await readJsonResource(`tan://brews/${id}`)
  }
  await readJsonResource("tan://pantry")
  await readJsonResource("tan://device")

  let synchronized = false
  if (process.env.TAN_STUDIO_SYNC_DEVICE === "1") {
    const synchronization = await call("tan_sync_device")
    assert.equal(typeof objectField(synchronization, "connection"), "string")
    synchronized = true
  }
  const statusAfter = await call("tan_status")
  const roastsAfter = await call("tan_search_roasts", { limit: 200 })
  assert.ok(arrayField(roastsAfter, "items").length >= roastItems.length)

  process.stdout.write(
    `${JSON.stringify(
      {
        status: "ok",
        mcpBundle,
        deviceBefore: nestedField(statusBefore, "device", "connection"),
        deviceAfter: nestedField(statusAfter, "device", "connection"),
        profiles: profileItems.length,
        coffees: coffeeItems.length,
        roasts: roastItems.length,
        pantry: arrayField(pantry, "items").length,
        brews: brewIds.size,
        telemetryRoasts,
        telemetryPoints,
        synchronized,
      },
      null,
      2
    )}\n`
  )
} finally {
  await client.close()
}

async function call(
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

async function readJsonResource(uri: string): Promise<void> {
  const resource = await client.readResource({ uri })
  assert.equal(resource.contents.length, 1)
  const content = resource.contents[0]
  assert.equal(content?.mimeType, "application/json")
  assert.ok(content && "text" in content)
  JSON.parse(content.text)
}

function objectField(value: unknown, field: string): unknown {
  assert.ok(value !== null && typeof value === "object", field)
  return (value as Record<string, unknown>)[field]
}

function optionalObjectField(
  value: unknown,
  field: string
): Record<string, unknown> | undefined {
  const result = objectField(value, field)
  if (result === undefined) return undefined
  assert.ok(result !== null && typeof result === "object", field)
  return result as Record<string, unknown>
}

function numericField(value: unknown, field: string): number {
  const result = objectField(value, field)
  assert.equal(typeof result, "number", field)
  return result as number
}

function booleanField(value: unknown, field: string): boolean {
  const result = objectField(value, field)
  assert.equal(typeof result, "boolean", field)
  return result as boolean
}

function arrayField(value: unknown, field: string): unknown[] {
  const result = objectField(value, field)
  assert.ok(Array.isArray(result), field)
  return result
}

function nestedField(value: unknown, parent: string, child: string): unknown {
  return objectField(objectField(value, parent), child)
}

function assertSorted(values: number[]): void {
  for (let index = 1; index < values.length; index += 1) {
    assert.ok(values[index - 1]! <= values[index]!)
  }
}
