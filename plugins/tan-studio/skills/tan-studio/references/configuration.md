# Plugin configuration

The plugin runs a local stdio MCP adapter and calls the same Tan Studio HTTP API as the web application. It contains no database, USB, or business logic.

## Connection variables

| Variable                 | Meaning                                                                       | Default                                  |
| ------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------- |
| `TAN_STUDIO_URL`         | Tan Studio service origin. An optional trailing `/api/v1` is normalized away. | `http://xrc.local:8080`                  |
| `TAN_STUDIO_API_TOKEN`   | Bearer token supplied directly to the process.                                | none                                     |
| `TAN_STUDIO_TOKEN_FILE`  | Absolute path to a token file.                                                | token discovery described below          |
| `TAN_STUDIO_CONFIG_FILE` | Persistent JSON configuration path.                                           | `~/.config/tan-studio/codex-plugin.json` |
| `TAN_STUDIO_TIMEOUT_MS`  | Request timeout from 250 to 60,000 ms.                                        | `5000`                                   |

Use the persistent config when Codex is launched from the desktop and cannot inherit shell variables:

```json
{
  "url": "http://xrc.local:8080",
  "tokenFile": "/absolute/path/to/a/token/file",
  "timeoutMs": 5000
}
```

Only `url`, `tokenFile`, and `timeoutMs` are accepted. Store the bearer token in the referenced mode-0600 file, never inside this JSON. Environment variables override file values.

The portable default token file is:

```text
~/.config/tan-studio/token
```

When `TAN_STUDIO_URL` explicitly points to a host other than `tan-studio.local`, the adapter also checks the Mac LAN-service token at:

```text
~/Library/Application Support/com.xavierroma.tanstudio/lan/token
```

For a Raspberry Pi service, provision a dedicated token in the portable file or point `TAN_STUDIO_TOKEN_FILE` to another user-readable file. Never commit a token, place it in a URL, print it in diagnostics, or paste it into a conversation.

## Expected service mode

The MCP adapter targets the always-on headless Tan Studio service. That mode accepts originless authenticated API clients with `X-Tan-Studio-Client: tan-studio-api-v1`. A desktop shell's per-launch in-memory browser token is not an agent credential.

Run `tan_status` after configuration. A successful response should include `apiVersion`, `schemaVersion`, `recoveryState`, feature flags, and a device snapshot. The service may be healthy while the Kaffeelogic is disconnected.
