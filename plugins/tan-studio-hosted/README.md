# Tan Studio Hosted for Codex

Portable Agent Plugins package, version 1.0.1. Connects directly to **https://studio.tan.coffee/mcp** using Streamable HTTP. No local Bun process is needed. This is a private/local package; it has not been submitted to a public directory and contains no credential.

## Install and connect

The distribution ZIP contains a repository marketplace plus this plugin under `plugins/tan-studio-hosted/`. Extract it into a dedicated local directory. In a supported Codex/ChatGPT desktop client, add that directory as a local plugin marketplace, then install **Tan Studio Hosted** and run its setup skill. You can register the source with `codex plugin marketplace add /absolute/path/to/extracted-directory`. Installing the plugin and creating/configuring a credential are distinct actions.

After the exact grant is approved, create the credential in Tan Studio's signed-in **Settings → Access → Agent connections**. Transfer its one-time value directly into the client's private API-key connection field. The manifest declares `auth.type: api_key` and `headerScheme: bearer`; it never contains a secret header. Do not use a general REST API token. If that client does not provide secure API-key setup, do not paste the token into chat or edit the manifest to contain it.

Public submission's connection form does not currently support API-key declarations. This ZIP therefore does not promise one-click iOS/cloud installation or public-directory publishing. The local marketplace is an authoring/private-distribution route.

## Approved grant — user completes secure issuance

Approved label: **Xavier Codex - Tan Studio**. The original approved grant covered 16 hosted workflow tools. On 2026-10-17 the operator requested complete programmatic API exposure. The catalog now derives one `tan_api_*` tool per versioned OpenAPI operation, alongside those workflow tools. Read/write grants and the REST API's operator-session checks still apply; no operating-system or physical-roaster access is added.

Approved term: **five calendar years from issuance**. Select **Five calendar years** in the signed-in Agent connections form. If issued on 2026-10-17, expiry is 2031-10-17 at the issuance time. The server calculates the calendar expiry; it retains the 30-day default for other grants. The exact expiry appears in the credential list after issuance. This package contains no credential and does not issue one. Keep revocation available; internal REST delegations still last at most 60 seconds and check parent revocation.

The operator confirmed this exact full read/write five-year grant on 2026-10-17. Do not ask to approve it again within that authorized setup. The user must create it in their own signed-in browser so its one-time value stays with them, then enter that value into the client's private credential field. Account-wide installation is separate from the local marketplace route and has not been completed.

Hosted writes: create/update coffee; update roast fields and recoverably archive/unarchive; record/update brew; add notes; set a profile image from an existing attachment; create labels. Reads cover status, pantry, profile/coffee/roast search, resource context, roast details and attachment metadata. The schema-derived API tools also expose profile editing, record creation and deletion, attachment content and link operations, settings, preferences, and device sync status. Credential and bridge administration keep their existing operator-session requirements. Hosted MCP cannot read local files or control a roast. See [the adapter contract](../tan-studio/README.md#boundary) for fields, binary transport, and limits.

Server limits remain 256 KiB requests, 1 MiB responses, 20-second execution, 4 concurrent requests per agent and 16 globally, plus rate limits. A five-year lifetime would not remove these limits. No OAuth flow is implemented.

## Official format references

- [Package your plugin](https://developers.openai.com/plugins/build/plugins)
- [MCP authentication and bearer declarations](https://developers.openai.com/plugins/build/plugins#bundled-mcp-servers-and-lifecycle-hooks)

The package uses root `plugin.json`, root `mcp.json`, and `skills/`; OpenAI metadata is under `extensions.com.openai`. Authentication is declared on the server entry in `mcp.json`. No legacy manifest, invented app ID, hooks, runtime scripts or embedded secret is required.
