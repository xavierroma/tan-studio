# Tan Studio Hosted for Codex

Portable Agent Plugins package, version 1.0.0. Connects directly to **https://studio.tan.coffee/mcp** using Streamable HTTP. No local Bun process is needed. This is a private/local package; it has not been submitted to a public directory and contains no credential.

## Install and connect

The distribution ZIP contains a repository marketplace plus this plugin under `plugins/tan-studio-hosted/`. Extract it into a dedicated local directory. In a supported Codex/ChatGPT desktop client, add that directory as a local plugin marketplace, then install **Tan Studio Hosted** and run its setup skill. You can register the source with `codex plugin marketplace add /absolute/path/to/extracted-directory`. Installing the plugin and creating/configuring a credential are distinct actions.

After the exact grant is approved, create the credential in Tan Studio's signed-in **Settings → Access → Agent connections**. Transfer its one-time value directly into the client's private API-key connection field. The manifest declares `auth.type: api_key` and `headerScheme: bearer`; it never contains a secret header. Do not use a general REST API token. If that client does not provide secure API-key setup, do not paste the token into chat or edit the manifest to contain it.

Public submission's connection form does not currently support API-key declarations. This ZIP therefore does not promise one-click iOS/cloud installation or public-directory publishing. The local marketplace is an authoring/private-distribution route.

## Requested access — awaiting confirmation

Proposed label: **Xavier Codex - Tan Studio**. Proposed access: all **16 currently implemented hosted MCP tools** (8 read and 8 write), including revision-protected updates and recoverable roast archiving exposed by the update tool. This is not unrestricted REST, operating-system or physical-roaster access.

Requested term: **five calendar years from issuance**. If issued on 2026-10-17, expiry would be 2031-10-17 at the issuance time (1,826 days). The deployed server currently enforces **1–90 days**. A reviewed server/API/UI change is necessary before that exact grant can be issued. This package neither changes the cap nor creates/configures a credential. Keep revocation available; internal REST delegations still last at most 60 seconds and check parent revocation.

Hosted writes: create/update coffee; update roast fields and recoverably archive/unarchive; record/update brew; add notes; set a profile image from an existing attachment; create labels. Reads cover status, pantry, profile/coffee/roast search, resource context, roast details and attachment metadata. No local attachment upload, device synchronization, credential administration, bridge enrollment/revocation or roast-control commands are exposed.

Server limits remain 256 KiB requests, 1 MiB responses, 20-second execution, 4 concurrent requests per agent and 16 globally, plus rate limits. A five-year lifetime would not remove these limits. No OAuth flow is implemented.

## Official format references

- [Package your plugin](https://developers.openai.com/plugins/build/plugins)
- [MCP authentication and bearer declarations](https://developers.openai.com/plugins/build/plugins#bundled-mcp-servers-and-lifecycle-hooks)

The package uses root `plugin.json`, root `mcp.json`, and `skills/`; OpenAI metadata is under `extensions.com.openai`. Authentication is declared on the server entry in `mcp.json`. No legacy manifest, invented app ID, hooks, runtime scripts or embedded secret is required.
