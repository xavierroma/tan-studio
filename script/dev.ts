const workspaceRoot = new URL("..", import.meta.url).pathname

const service = Bun.spawn(
  [
    "cargo",
    "run",
    "--manifest-path",
    "apps/service/Cargo.toml",
    "--bin",
    "tan-studio-service",
  ],
  {
    cwd: workspaceRoot,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, TAN_STUDIO_DEV: "1" },
  }
)

const web = Bun.spawn(["bun", "run", "--cwd", "apps/web", "dev"], {
  cwd: workspaceRoot,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
  env: process.env,
})

let stopping = false
function stop() {
  if (stopping) return
  stopping = true
  service.kill()
  web.kill()
}

process.on("SIGINT", stop)
process.on("SIGTERM", stop)

const exitCode = await Promise.race([service.exited, web.exited])
stop()
await Promise.allSettled([service.exited, web.exited])
process.exit(exitCode)
