---
name: setup
description: Set up the authenticated Tan Studio Hosted connection in Codex without exposing a credential.
---

Explain that this plugin connects to https://studio.tan.coffee/mcp using Streamable HTTP and a per-agent bearer credential. The package contains no token and installing it does not grant access.

Before any persistent credential is created or configured, obtain action-time confirmation of its exact label, read/write capabilities and expiry. The current server allows 1–90 days; never promise that a five-year grant is available until the server supports it. Do not bypass issuance checks, edit credential rows directly, forge an operator session, or substitute a general REST API token.

After the grant is approved, the operator signs in at Tan Studio, opens Settings → Access → Agent connections, creates the approved credential and transfers the one-time value directly into Codex’s private connection credential field. Never ask for the value in conversation, commands, source files or a ZIP. If the installed client cannot collect API-key credentials securely, stop setup and report that concrete limitation instead of embedding a header in the package.

Validate the connection by listing tools and calling tan_status or a read-only search. A full hosted read/write grant currently exposes 16 tools. Do not perform a write merely to test access. Tool approval preferences are separate from server credentials; keep the user's existing preferences.
