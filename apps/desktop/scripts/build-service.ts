import { copyFile, mkdir } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"

const desktopRoot = resolve(import.meta.dirname, "..")
const workspaceRoot = resolve(desktopRoot, "../..")
const manifest = join(workspaceRoot, "apps/service/Cargo.toml")
const binariesDirectory = join(desktopRoot, "src-tauri/binaries")

async function commandOutput(command: string[]) {
  const process = Bun.spawn(command, {
    cwd: workspaceRoot,
    stdout: "pipe",
    stderr: "inherit",
  })
  const output = await new Response(process.stdout).text()
  const exitCode = await process.exited
  if (exitCode !== 0) throw new Error(`${command[0]} exited with ${exitCode}`)
  return output.trim()
}

const targetTriple =
  process.env.TAURI_ENV_TARGET_TRIPLE ??
  process.env.TARGET ??
  (await commandOutput(["rustc", "--print", "host-tuple"]))

if (!/^[a-zA-Z0-9_.-]+$/.test(targetTriple)) {
  throw new Error("Rust returned an invalid target triple")
}

const extension = targetTriple.includes("windows") ? ".exe" : ""
const build = Bun.spawn(
  [
    "cargo",
    "build",
    "--locked",
    "--release",
    "--manifest-path",
    manifest,
    "--target",
    targetTriple,
  ],
  { cwd: workspaceRoot, stdout: "inherit", stderr: "inherit" }
)
const exitCode = await build.exited
if (exitCode !== 0) {
  throw new Error(`Tan Studio service build failed with exit code ${exitCode}`)
}

await mkdir(binariesDirectory, { recursive: true })
const source = join(
  workspaceRoot,
  `apps/service/target/${targetTriple}/release/tan-studio-service${extension}`
)
const output = join(
  binariesDirectory,
  `tan-studio-service-${targetTriple}${extension}`
)
await copyFile(source, output)

console.info(
  `Prepared ${basename(output)} in ${dirname(output).replace(`${workspaceRoot}/`, "")}`
)
