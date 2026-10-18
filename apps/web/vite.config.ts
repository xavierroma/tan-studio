import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

import {
  buildCodexPluginZip,
  CODEX_PLUGIN_PATH,
  HOSTED_MCP_URL,
} from "./codex-plugin-package"

const repositoryRoot = path.resolve(import.meta.dirname, "../..")

/** Ships the Codex plugin ZIP with every build and serves it in dev. */
function codexPluginDownload(): Plugin {
  return {
    name: "tan-studio-codex-plugin",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: CODEX_PLUGIN_PATH,
        source: buildCodexPluginZip(repositoryRoot).bytes,
      })
    },
    configureServer(server) {
      server.middlewares.use(`/${CODEX_PLUGIN_PATH}`, (_request, response) => {
        // Rebuilt per request so dev always serves the current source.
        const { bytes } = buildCodexPluginZip(repositoryRoot)
        response.setHeader("Content-Type", "application/zip")
        response.setHeader("Cache-Control", "no-cache")
        response.end(Buffer.from(bytes))
      })
    },
  }
}

const codexPlugin = buildCodexPluginZip(repositoryRoot)

export default defineConfig({
  plugins: [react(), tailwindcss(), codexPluginDownload()],
  define: {
    __TAN_CODEX_PLUGIN__: JSON.stringify({
      href: `/${CODEX_PLUGIN_PATH}`,
      version: codexPlugin.version,
      bytes: codexPlugin.bytes.length,
      endpoint: HOSTED_MCP_URL,
    }),
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  preview: {
    port: 1420,
    strictPort: true,
  },
})
