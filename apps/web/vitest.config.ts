import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

import { CODEX_PLUGIN_PATH, HOSTED_MCP_URL } from "./codex-plugin-package"

export default defineConfig({
  plugins: [react()],
  define: {
    __TAN_CODEX_PLUGIN__: JSON.stringify({
      href: `/${CODEX_PLUGIN_PATH}`,
      version: "test",
      bytes: 0,
      endpoint: HOSTED_MCP_URL,
    }),
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "*.test.ts"],
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
  },
})
