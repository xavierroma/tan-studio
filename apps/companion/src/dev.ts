process.env.TAN_STUDIO_DEV ??= "1"
process.env.TAN_STUDIO_PORT ??= "4317"
process.env.TAN_STUDIO_SEED_DEMO ??= "1"
process.env.TAN_STUDIO_DATABASE_PATH ??= "tan-studio-development.sqlite"

await import("./index")

export {}
