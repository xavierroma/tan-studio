# Tan Studio Hosted for Codex

Portable Agent Plugins package, version 1.1.0. Connects directly to **https://studio.tan.coffee/mcp** using Streamable HTTP. No local Bun process is needed. This is a private/local package; it has not been submitted to a public directory and contains no credential.

## Install and connect

1. Download the plugin ZIP from Tan Studio **Settings → Agents** and extract it into a folder you keep. It contains a local plugin marketplace (`.agents/plugins/marketplace.json`) and this plugin under `plugins/tan-studio-hosted/`.
2. Register the folder in a supported Codex client: `codex plugin marketplace add /absolute/path/to/extracted-folder`.
3. In Codex, open **Plugins** and install **Tan Studio Hosted**, or run `codex plugin add tan-studio-hosted@tan-studio`. Installing the plugin does not grant access.
4. Signed in at https://studio.tan.coffee, open **Settings → Agents → Agent connections** and create a credential for this agent. Choose its name, access (read only, or read and write) and lifetime yourself.
5. Enter the one-time value directly in Codex's private API-key field for Tan Studio Hosted. Never paste it into a chat, command, file or this package.
6. Start a new conversation and ask for Tan Studio's status.

The manifest declares `auth.type: api_key` and `headerScheme: bearer`; it never contains a secret header. Do not use a general REST API token. If your client cannot collect an API key securely, stop rather than editing the manifest to hold one. Revoke the credential in Agent connections at any time.

Public submission's connection form does not currently support API-key declarations. This package therefore does not promise one-click iOS/cloud installation or public-directory publishing. The local marketplace is an authoring/private-distribution route.

## What it can do

Reads cover status, pantry, profile/coffee/roast search, resource context, roast details and attachment metadata. With write access: create/update coffee; update roast fields and recoverably archive/unarchive; record/update brew; add notes; set a profile image from an existing attachment; create labels. Every versioned REST operation also has a `tan_api_*` tool. Credential and bridge administration keep their operator-session requirements. Hosted MCP cannot read local files or control a roast.

Server limits: 256 KiB requests (about 190 KB of file content after base64), 1 MiB responses, 20-second execution, 4 concurrent requests per agent and 16 globally, plus rate limits. No OAuth flow is implemented.

## Official format references

- [Package your plugin](https://developers.openai.com/plugins/build/plugins)
- [MCP authentication and bearer declarations](https://developers.openai.com/plugins/build/plugins#bundled-mcp-servers-and-lifecycle-hooks)

The package uses root `plugin.json`, root `mcp.json`, `skills/` and `assets/`; OpenAI metadata is under `extensions.com.openai`. Authentication is declared on the server entry in `mcp.json`. No legacy manifest, invented app ID, hooks, runtime scripts or embedded secret is required.
