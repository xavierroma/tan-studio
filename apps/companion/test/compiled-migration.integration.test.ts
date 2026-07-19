import { expect, test } from "bun:test"
import { CryptoHasher } from "bun"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

async function outputText(
  stream: ReadableStream<Uint8Array> | null
): Promise<string> {
  return stream ? new Response(stream).text() : ""
}

test("compiled executable embeds and applies migration SQL", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "tan-studio-migration-smoke-")
  )
  const executablePath = join(temporaryDirectory, "migration-smoke")
  const databasePath = join(temporaryDirectory, "compiled.sqlite")
  const entrypoint = fileURLToPath(
    new URL("./fixtures/compiled-migration-smoke.ts", import.meta.url)
  )
  const migrationPath = fileURLToPath(
    new URL("../migrations/0002_roast_brew_workflow.sql", import.meta.url)
  )
  const expectedSqlSha256 = new CryptoHasher("sha256")
    .update(await Bun.file(migrationPath).text())
    .digest("hex")

  try {
    const build = Bun.spawn({
      cmd: [
        process.execPath,
        "build",
        "--compile",
        entrypoint,
        "--outfile",
        executablePath,
      ],
      stdout: "pipe",
      stderr: "pipe",
    })
    const [buildExit, buildStderr] = await Promise.all([
      build.exited,
      outputText(build.stderr),
    ])
    expect(buildExit, buildStderr).toBe(0)

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const run = Bun.spawn({
        cmd: [executablePath, databasePath],
        stdout: "pipe",
        stderr: "pipe",
      })
      const [exitCode, stdout, stderr] = await Promise.all([
        run.exited,
        outputText(run.stdout),
        outputText(run.stderr),
      ])
      expect(exitCode, stderr).toBe(0)
      expect(JSON.parse(stdout)).toEqual({
        version: 2,
        name: "roast_brew_workflow",
        sqlSha256: expectedSqlSha256,
      })
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
})
