import { afterAll, beforeAll, expect, test } from "bun:test"
import { appendFileSync, existsSync, writeFileSync } from "node:fs"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { randomBytes } from "node:crypto"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"

import { OpenApiTanStudioGateway } from "../src/api"
import { createTanStudioServer } from "../src/mcp"

/**
 * Drives the hosted MCP attachment tools against a real, spawned headless
 * service with a throwaway database. Build the service first
 * (`cargo build --manifest-path apps/service/Cargo.toml`); without the binary
 * this test is skipped. TAN_STUDIO_TEST_DATA_DIR keeps the database and
 * TAN_STUDIO_REPRO_LOG records the observed revisions.
 */
const repositoryRoot = resolve(import.meta.dir, "../../..")
const serviceBinary = resolve(
  process.env.TAN_STUDIO_SERVICE_BIN ??
    join(repositoryRoot, "apps/service/target/debug/tan-studio-service")
)
const available = existsSync(serviceBinary)
const log = process.env.TAN_STUDIO_REPRO_LOG
const record = (line: string) => {
  if (log) appendFileSync(log, `${line}\n`)
}

let service: ReturnType<typeof Bun.spawn> | undefined
let dataDirectory = ""
let client: Client
let gateway: OpenApiTanStudioGateway

async function reservePort() {
  return new Promise<number>((resolvePort, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close(() =>
        typeof address === "object" && address
          ? resolvePort(address.port)
          : reject(new Error("No port"))
      )
    })
  })
}

beforeAll(async () => {
  if (!available) return
  dataDirectory =
    process.env.TAN_STUDIO_TEST_DATA_DIR ??
    (await mkdtemp(join(tmpdir(), "tan-studio-attachment-test-")))
  await mkdir(join(dataDirectory, "web"), { recursive: true })
  const [port, bridgePort] = [await reservePort(), await reservePort()]
  const baseUrl = `http://127.0.0.1:${port}`
  const token = randomBytes(32).toString("hex")
  service = Bun.spawn([serviceBinary], {
    env: {
      ...process.env,
      TAN_STUDIO_HEADLESS: "1",
      TAN_STUDIO_BIND_HOST: "127.0.0.1",
      TAN_STUDIO_PORT: String(port),
      TAN_STUDIO_BRIDGE_PORT: String(bridgePort),
      TAN_STUDIO_DATABASE_PATH: join(dataDirectory, "notebook.sqlite"),
      TAN_STUDIO_WEB_ROOT: join(dataDirectory, "web"),
      TAN_STUDIO_LAN_TOKEN: token,
      TAN_STUDIO_ALLOWED_ORIGINS: baseUrl,
      TAN_STUDIO_ALLOWED_HOSTS: `127.0.0.1:${port}`,
      // Never touch a USB device from tests.
      TAN_STUDIO_SIMULATED_NANO: "smoke",
      TAN_STUDIO_SIMULATION_E2E: "1",
    },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  })
  for (let attempt = 0; ; attempt++) {
    const ready = await fetch(`${baseUrl}/api/v1/system/bootstrap`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Tan-Studio-Client": "tan-studio-api-v1",
      },
    }).catch(() => undefined)
    if (ready?.ok) break
    if (attempt > 100) throw new Error("Service did not start")
    await Bun.sleep(100)
  }
  gateway = new OpenApiTanStudioGateway({ baseUrl, token, timeoutMs: 10_000 })
  const server = createTanStudioServer(gateway, { hosted: true, write: true })
  client = new Client({ name: "attachment-service-test", version: "1" })
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ])
  if (log) writeFileSync(log, `Service ${serviceBinary} on ${baseUrl}\n`)
})

afterAll(async () => {
  await client?.close()
  service?.kill()
  await service?.exited
  if (dataDirectory && !process.env.TAN_STUDIO_TEST_DATA_DIR)
    await rm(dataDirectory, { recursive: true, force: true })
})

type ToolResult = { isError?: boolean; content: Array<{ text: string }> }
async function tool(name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({
    name,
    arguments: args,
  })) as ToolResult
  const text = result.content[0]!.text
  return {
    isError: Boolean(result.isError),
    data: JSON.parse(
      result.isError ? text : text.slice(text.indexOf("\n\n") + 2)
    ),
  }
}
/**
 * A complete, viewable single-page PDF (catalog, page tree, page, font, text
 * content stream, byte-exact xref and trailer) with fictional contents.
 */
const pdf = (label: string) => {
  const escape = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`)
  const lines = [
    `Fictional ${label}`,
    "Tan Studio test fixture - not a real document",
  ]
  const stream = `BT /F1 14 Tf 56 760 Td (${escape(lines[0]!)}) Tj 0 -22 Td /F1 10 Tf (${escape(lines[1]!)}) Tj ET`
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ]
  let body = "%PDF-1.4\n"
  const offsets = objects.map((object, i) => {
    const offset = Buffer.byteLength(body)
    body += `${i + 1} 0 obj\n${object}\nendobj\n`
    return offset
  })
  const xref = Buffer.byteLength(body)
  body +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, "latin1")
}

test.skipIf(!available)(
  "hosted MCP attaches a PDF to a fictional coffee and recovers from bad revisions",
  async () => {
    const coffee = (
      await tool("tan_create_coffee", {
        name: "Fictional Attachment Lot",
        provider: "Sample Importer",
      })
    ).data
    const sister = (
      await tool("tan_create_coffee", { name: "Fictional Sister Lot" })
    ).data
    record(`coffee ${coffee.id} "${coffee.name}" revision ${coffee.revision}`)

    // An existing, complete attachment must stay untouched throughout.
    const existingPdf = pdf("receipt: 1 kg green coffee, EUR 24.00")
    const existing = (
      await tool("tan_api_create_attachment", {
        body: {
          title: "Fictional receipt",
          filename: "fictional-receipt.pdf",
          mediaType: "application/pdf",
          links: [{ resourceType: "coffee", resourceId: coffee.id }],
        },
      })
    ).data
    const existingStored = (
      await tool("tan_api_put_attachment_content", {
        path: { id: existing.id },
        headers: { "If-Match": existing.revision },
        contentBase64: existingPdf.toString("base64"),
      })
    ).data
    record(
      `existing attachment ${existing.id}: revision ${existing.revision} -> ${existingStored.revision}`
    )

    // 1. create -> upload with the revision create returned -> link -> download.
    const specPdf = pdf("spec sheet: washed, 1900-2150 m")
    const created = (
      await tool("tan_api_create_attachment", {
        body: {
          title: "Fictional spec sheet",
          filename: "fictional-spec.pdf",
          mediaType: "application/pdf",
          links: [{ resourceType: "coffee", resourceId: coffee.id }],
        },
      })
    ).data
    expect(created.revision).toBe(1)
    record(
      `create attachment ${created.id}: revision ${created.revision}, sha256 ${created.sha256}`
    )
    const uploaded = await tool("tan_api_put_attachment_content", {
      path: { id: created.id },
      headers: { "If-Match": created.revision },
      contentBase64: specPdf.toString("base64"),
    })
    expect(uploaded.isError).toBe(false)
    expect(uploaded.data.revision).toBe(created.revision + 1)
    record(
      `upload with If-Match ${created.revision} (number as returned): ok, revision ${uploaded.data.revision}`
    )
    const linked = await tool("tan_api_replace_attachment_links", {
      path: { id: created.id },
      headers: { "If-Match": uploaded.data.revision },
      body: {
        links: [
          { resourceType: "coffee", resourceId: coffee.id },
          { resourceType: "coffee", resourceId: sister.id },
        ],
      },
    })
    expect(linked.isError).toBe(false)
    record(
      `link with If-Match ${uploaded.data.revision}: ok, revision ${linked.data.revision}`
    )
    const downloaded = await tool("tan_api_get_attachment_content", {
      path: { id: created.id },
    })
    expect(Buffer.from(downloaded.data.contentBase64, "base64")).toEqual(
      specPdf
    )
    expect(downloaded.data.mediaType).toBe("application/pdf")
    record(`download: ${specPdf.length} bytes, byte-for-byte equal`)
    if (log)
      writeFileSync(
        log.replace(/\.txt$/u, "-spec.pdf"),
        Buffer.from(downloaded.data.contentBase64, "base64")
      )

    // 2. Malformed vs stale If-Match: distinct, both with currentRevision.
    const malformed = await tool("tan_api_put_attachment_content", {
      path: { id: created.id },
      headers: { "If-Match": 'W/"revision:3"' },
      contentBase64: pdf("rejected").toString("base64"),
    })
    expect(malformed.isError).toBe(true)
    expect(malformed.data).toMatchObject({
      error: "revision_header_invalid",
      status: 412,
      currentRevision: linked.data.revision,
    })
    record(
      `malformed If-Match W/"revision:3": ${malformed.data.error}, currentRevision ${malformed.data.currentRevision}`
    )
    const stale = await tool("tan_api_put_attachment_content", {
      path: { id: created.id },
      headers: { "If-Match": created.revision },
      contentBase64: pdf("rejected").toString("base64"),
    })
    expect(stale.isError).toBe(true)
    expect(stale.data).toMatchObject({
      error: "revision_precondition_failed",
      status: 412,
      currentRevision: linked.data.revision,
    })
    expect(stale.data.recovery).toContain("Fetch the record again")
    record(
      `stale If-Match ${created.revision}: ${stale.data.error}, currentRevision ${stale.data.currentRevision}`
    )

    // 3. Recovery: re-read, retry with currentRevision, no duplicates.
    const reread = (
      await tool("tan_api_get_attachment", { path: { id: created.id } })
    ).data
    expect(reread.revision).toBe(stale.data.currentRevision)
    const revisedPdf = pdf("spec sheet, revised: washed, 2000 m")
    const retried = await tool("tan_api_put_attachment_content", {
      path: { id: created.id },
      headers: { "If-Match": stale.data.currentRevision },
      contentBase64: revisedPdf.toString("base64"),
    })
    expect(retried.isError).toBe(false)
    expect(retried.data.id).toBe(created.id)
    record(
      `retry with currentRevision ${stale.data.currentRevision}: ok, revision ${retried.data.revision}`
    )

    const listed = (
      await tool("tan_list_attachments", {
        resourceType: "coffee",
        resourceId: coffee.id,
      })
    ).data.items as Array<{
      id: number
      revision: number
      sha256: string
      links: Array<{ resourceId: number }>
    }>
    expect(listed.map((item) => item.id).sort()).toEqual(
      [existing.id, created.id].sort()
    )
    const spec = listed.find((item) => item.id === created.id)!
    expect(spec.links.map((link) => link.resourceId).sort()).toEqual(
      [coffee.id, sister.id].sort()
    )
    const receipt = listed.find((item) => item.id === existing.id)!
    expect(receipt.revision).toBe(existingStored.revision)
    expect(receipt.sha256).toBe(existingStored.sha256)
    const final = await tool("tan_api_get_attachment_content", {
      path: { id: created.id },
    })
    expect(Buffer.from(final.data.contentBase64, "base64")).toEqual(revisedPdf)
    const receiptBytes = await tool("tan_api_get_attachment_content", {
      path: { id: existing.id },
    })
    expect(Buffer.from(receiptBytes.data.contentBase64, "base64")).toEqual(
      existingPdf
    )
    record(
      `coffee ${coffee.id} attachments: ${listed.map((item) => `${item.id}@r${item.revision}`).join(", ")} (no duplicates)`
    )
    record(
      `attachment ${created.id} links: coffees ${spec.links.map((l) => l.resourceId).join(", ")}; bytes = revised PDF`
    )
    record(
      `existing attachment ${existing.id} unchanged at revision ${receipt.revision}, bytes equal`
    )
  },
  60_000
)
