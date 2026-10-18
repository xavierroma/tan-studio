---
name: setup
description: Set up the authenticated Tan Studio Hosted connection in Codex without exposing a credential.
---

Explain that this plugin connects to https://studio.tan.coffee/mcp using Streamable HTTP and a per-agent bearer credential. The package contains no token and installing it does not grant access.

Ask the user to choose the credential's name, access (read only, or read and write) and lifetime. Tan Studio offers 1–90 days (default 30) or five calendar years; recommend read only unless the user wants the agent to change records. This package carries no pre-approved grant: never inherit another person's grant or a historical approval. Once the user has explicitly confirmed the name, access and lifetime in this conversation or in the Tan Studio form, honor that choice without asking again. Do not bypass issuance checks, edit credential rows directly, forge an operator session, or substitute a general REST API token.

The user signs in at https://studio.tan.coffee, opens Settings → Agents → Agent connections, creates the credential and enters its one-time value directly in Codex's private API-key field for Tan Studio Hosted. Never ask for the value in conversation, commands, source files or a ZIP. If the installed client cannot collect API-key credentials securely, stop setup and report that concrete limitation instead of embedding a header in the package.

Validate the connection in a new conversation by listing tools and calling tan_status or a read-only search. A read and write credential exposes the workflow tools plus one tan_api_* tool for each versioned OpenAPI operation; a read-only credential exposes only read tools. The API keeps its operator-session checks. Do not perform a write merely to test access. Tool approval preferences are separate from server credentials; keep the user's existing preferences.
