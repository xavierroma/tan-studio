import { resolve } from "node:path"

const pluginRoot = resolve(import.meta.dir, "..")
for (const entry of ["server", "http-server"]) {
  const outputPath = resolve(pluginRoot, `dist/${entry}.js`)
  const build = await Bun.build({
    entrypoints: [resolve(pluginRoot, `src/${entry}.ts`)],
    minify: true,
    naming: `${entry}.js`,
    outdir: resolve(pluginRoot, "dist"),
    target: "bun",
  })

  if (!build.success) {
    for (const log of build.logs) console.error(log)
    process.exit(1)
  }

  // Bun can preserve indentation inside bundled dependency template literals as
  // physical trailing whitespace. Normalizing line endings here keeps the
  // checked-in executable deterministic and `git diff --check` clean.
  const bundled = await Bun.file(outputPath).text()
  await Bun.write(outputPath, bundled.replace(/[\t ]+$/gmu, ""))

  console.log(`Built ${outputPath}`)
}
