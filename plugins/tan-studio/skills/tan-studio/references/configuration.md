# Plugin configuration

The plugin runs a client-side stdio MCP adapter and calls the same hosted Tan Studio HTTP API as the web application. It contains no database, USB, or business logic.

## Connection variables

| Variable                 | Meaning                                                                       | Default                                  |
| ------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------- |
| `TAN_STUDIO_URL`         | Tan Studio service origin. An optional trailing `/api/v1` is normalized away. | `https://studio.tan.coffee`              |
| `TAN_STUDIO_API_TOKEN`   | Bearer token supplied directly to the process.                                | none                                     |
| `TAN_STUDIO_TOKEN_FILE`  | Absolute path to a token file.                                                | token discovery described below          |
| `TAN_STUDIO_CONFIG_FILE` | Persistent JSON configuration path.                                           | `~/.config/tan-studio/mcp.json`          |
| `TAN_STUDIO_TIMEOUT_MS`  | Request timeout from 250 to 60,000 ms.                                        | `5000`                                   |

Use the persistent config when an MCP client cannot inherit shell variables:

```json
{
  "url": "https://studio.tan.coffee",
  "tokenFile": "/absolute/path/to/a/token/file",
  "timeoutMs": 5000
}
```

Only `url`, `tokenFile`, and `timeoutMs` are accepted. Store the bearer token in the referenced mode-0600 file, never inside this JSON. Environment variables override file values.

The default token file is:

```text
~/.config/tan-studio/token
```

Provision a dedicated token for each MCP client in the default file or point `TAN_STUDIO_TOKEN_FILE` to another user-readable mode-0600 file. Never reuse device credentials, commit a token, place it in a URL, print it in diagnostics, or paste it into a conversation.

## Expected service mode

The MCP adapter targets the hosted Tan Studio service. It authenticates with a dedicated bearer token and identifies itself with `X-Tan-Studio-Client: tan-studio-api-v1`. A browser session cookie is not an agent credential.

Run `tan_status` after configuration. A successful response should include `apiVersion`, `schemaVersion`, `recoveryState`, feature flags, and a device snapshot. The service may be healthy while the Kaffeelogic is disconnected.
