type Rule = {
  root: string
  accepts: (specifier: string) => boolean
  reason: string
}

const relative = (specifier: string) => specifier.startsWith(".")
const rules: Rule[] = [
  {
    root: "packages/domain/src",
    accepts: relative,
    reason: "Domain code may only import other domain files.",
  },
  {
    root: "packages/application/src",
    accepts: (specifier) =>
      relative(specifier) || specifier === "@tan-studio/domain",
    reason:
      "Application code may depend only on domain code and application-local ports/use cases.",
  },
  {
    root: "packages/api-contract/src",
    accepts: (specifier) => relative(specifier) || specifier === "zod",
    reason:
      "Transport contracts must remain independent of runtime adapters and UI code.",
  },
  {
    root: "packages/ui/src",
    accepts: (specifier) =>
      !specifier.startsWith("@tan-studio/") ||
      specifier.startsWith("@tan-studio/ui/"),
    reason:
      "The shared UI system cannot import product, companion, domain, or infrastructure modules.",
  },
]

const importPattern =
  /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g
const violations: string[] = []

for (const rule of rules) {
  const glob = new Bun.Glob("**/*.{ts,tsx}")
  for await (const relativePath of glob.scan({
    cwd: rule.root,
    onlyFiles: true,
  })) {
    const file = `${rule.root}/${relativePath}`
    const source = await Bun.file(file).text()
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1]
      if (specifier && !rule.accepts(specifier)) {
        violations.push(
          `${file}: disallowed import ${JSON.stringify(specifier)} — ${rule.reason}`
        )
      }
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"))
  process.exit(1)
}

console.info(
  `Architecture boundaries verified across ${rules.length} inward layers.`
)
