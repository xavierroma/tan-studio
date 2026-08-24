# Non-browser clients present a hosted API token

The hosted API accepts the operator session cookie (ADR-0002) **or** a hosted API token. Only these two, and both must also send a known `X-Tan-Studio-Client` identity.

A token is per-client, minted from behind the operator session, shown once, stored only as a SHA-256 digest, compared in constant time, and revocable on its own. The MCP plugin and any HTTP client use it; they cannot sign in with Google.

The LAN token (`TAN_STUDIO_LAN_TOKEN`) is not reused for this. It is one process-global secret with no attribution and no revocation short of a redeploy, and hosted mode has no launch token at all. On a public origin that would be a second permanent anonymous operator.

An API token cannot mint or revoke tokens; that stays with the operator's own session.
