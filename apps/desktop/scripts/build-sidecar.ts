import { mkdir } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"

const desktopRoot = resolve(import.meta.dirname, "..")
const workspaceRoot = resolve(desktopRoot, "../..")
const entrypoint = join(desktopRoot, "sidecar/entry.ts")
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

const bunTargets: Record<string, string> = {
  "aarch64-apple-darwin": "bun-darwin-arm64",
  "x86_64-apple-darwin": "bun-darwin-x64",
  "aarch64-pc-windows-msvc": "bun-windows-arm64",
  "x86_64-pc-windows-msvc": "bun-windows-x64-baseline",
  "aarch64-unknown-linux-gnu": "bun-linux-arm64",
  "x86_64-unknown-linux-gnu": "bun-linux-x64-baseline",
  "aarch64-unknown-linux-musl": "bun-linux-arm64-musl",
  "x86_64-unknown-linux-musl": "bun-linux-x64-musl",
}
const bunTarget = bunTargets[targetTriple]
if (!bunTarget) {
  throw new Error(`No reviewed Bun compilation target for ${targetTriple}`)
}

await mkdir(binariesDirectory, { recursive: true })
const extension = targetTriple.includes("windows") ? ".exe" : ""
const output = join(
  binariesDirectory,
  `tan-studio-companion-${targetTriple}${extension}`
)

const build = Bun.spawn(
  [
    "bun",
    "build",
    "--compile",
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
    `--target=${bunTarget}`,
    entrypoint,
    "--outfile",
    output,
  ],
  {
    cwd: workspaceRoot,
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
    },
  }
)

const exitCode = await build.exited
if (exitCode !== 0) {
  throw new Error(`Companion build failed with exit code ${exitCode}`)
}

console.info(
  `Prepared ${basename(output)} in ${dirname(output).replace(`${workspaceRoot}/`, "")}`
)
