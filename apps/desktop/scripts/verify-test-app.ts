import { mkdir, rename, rm, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

if (process.platform !== "darwin") process.exit(0)

const builtBundle = resolve(
  import.meta.dir,
  "../src-tauri/target/release/bundle/macos/Tan Studio.app"
)
const installDirectory = join(homedir(), "Applications")
const installedBundle = join(installDirectory, "Tan Studio.app")
const stagingBundle = join(
  installDirectory,
  `.Tan Studio.app.staging-${process.pid}`
)

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

async function run(
  executable: string,
  ...arguments_: string[]
): Promise<{ exitCode: number; output: string }> {
  const child = Bun.spawn({
    cmd: [executable, ...arguments_],
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, output: `${stdout}${stderr}` }
}

async function runOrThrow(
  label: string,
  executable: string,
  ...arguments_: string[]
): Promise<void> {
  const result = await run(executable, ...arguments_)
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed: ${result.output}`)
  }
}

await mkdir(installDirectory, { recursive: true })
if (await pathExists(stagingBundle)) {
  await rm(stagingBundle, { recursive: true })
}

let previousBundle: string | undefined
try {
  await runOrThrow(
    "Copying the test app",
    "/usr/bin/ditto",
    "--noextattr",
    "--noacl",
    "--noqtn",
    builtBundle,
    stagingBundle
  )
  await runOrThrow(
    "Clearing test-app attributes",
    "/usr/bin/xattr",
    "-cr",
    stagingBundle
  )
  await runOrThrow(
    "Ad-hoc signing the test app",
    "/usr/bin/codesign",
    "--force",
    "--deep",
    "--sign",
    "-",
    stagingBundle
  )
  await runOrThrow(
    "Verifying the staged test app",
    "/usr/bin/codesign",
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    stagingBundle
  )

  if (await pathExists(installedBundle)) {
    const trashDirectory = join(homedir(), ".Trash")
    await mkdir(trashDirectory, { recursive: true })
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-")
    previousBundle = join(
      trashDirectory,
      `Tan Studio previous ${timestamp}-${process.pid}.app`
    )
    await rename(installedBundle, previousBundle)
  }

  try {
    await rename(stagingBundle, installedBundle)
  } catch (error) {
    if (previousBundle && !(await pathExists(installedBundle))) {
      await rename(previousBundle, installedBundle)
    }
    throw error
  }

  await runOrThrow(
    "Verifying the installed test app",
    "/usr/bin/codesign",
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    installedBundle
  )
} catch (error) {
  if (await pathExists(stagingBundle)) {
    await rm(stagingBundle, { recursive: true })
  }
  throw error
}

process.stdout.write(`Installed verified test app: ${installedBundle}\n`)
