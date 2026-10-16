# Hosted Tan Bridge uses authenticated WebSocket over TLS

The hosted Tan Bridge connects outward to
`wss://studio.tan.coffee/device/v1/session`. Caddy terminates public TLS and
passes the WebSocket upgrade through its existing site-wide reverse proxy to
the Rust service on loopback port 8080. No new public port is opened, and the
private raw TCP listener on port 8081 remains available only to the headless
LAN mode described by ADR-0005.

The LAN TCP and hosted WSS Adapters share one bridge-session Module and one
authentication Interface. The first application message is the existing
strict JSON hello with either a ten-minute single-use claim or a durable device
token. Successful claim redemption stores only a token digest and returns the
plain token once for NVS persistence. A revocation timestamp invalidates future
connections, and operator revocation detaches the current device session.

Claim creation and revocation are operator-session-only in hosted mode. Hosted
API tokens cannot enroll or revoke devices. The WebSocket endpoint itself is
public at the HTTP routing layer because a headless Atom has no browser
session, but it accepts no tunnel data before bridge authentication. Host
validation still runs before the upgrade.

After authentication, each WebSocket binary message contains exactly one
existing tunnel record: kind byte, big-endian 16-bit payload length, and at
most 8 KiB of payload. The service and firmware both enforce the verified
read-only SASSI allowlist for backend-to-Nano frames. WebSocket ping/pong,
bounded network timeouts, clock synchronization before TLS, and exponential
reconnect backoff with jitter make WAN failure observable without broadening
device capability.

The Atom setup protocol moves to schema v2 and reports the fixed WSS transport,
host, port, and path. The endpoint is a firmware invariant rather than mutable
setup input. Firmware `0.3.1-hosted` uses the ESP-IDF certificate bundle with
hostname verification. The guarded application-only updater writes the app at
offset `0x10000` and preserves NVS, allowing an identity, Wi-Fi credential, and
matching migrated device token from the local image to survive the update.

This decision supersedes ADR-0005 only for hosted operation and corrects the
unshipped WSS statement in ADR-0003. It does not add OTA, durable offline roast
spooling, profile writes, roast control, or arbitrary serial access.
