import { chmod, copyFile, mkdir } from "node:fs/promises"
import { basename, join, resolve } from "node:path"

const desktopRoot = resolve(import.meta.dirname, "..")
const workspaceRoot = resolve(desktopRoot, "../..")
const bridgeRoot = resolve(desktopRoot, "../serial-bridge")
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
    "--release",
    "--locked",
    "--target",
    targetTriple,
    "--manifest-path",
    join(bridgeRoot, "Cargo.toml"),
  ],
  {
    cwd: workspaceRoot,
    stdout: "inherit",
    stderr: "inherit",
  }
)
if ((await build.exited) !== 0) throw new Error("Serial bridge build failed")

const source = join(
  bridgeRoot,
  "target",
  targetTriple,
  "release",
  `tan-studio-serial-bridge${extension}`
)
await mkdir(binariesDirectory, { recursive: true })
const destination = join(
  binariesDirectory,
  `tan-studio-serial-bridge-${targetTriple}${extension}`
)
await copyFile(source, destination)
if (!targetTriple.includes("windows")) await chmod(destination, 0o755)

console.info(`Prepared ${basename(destination)} for the desktop bundle`)
