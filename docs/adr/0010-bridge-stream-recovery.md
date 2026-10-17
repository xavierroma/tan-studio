# Bound USB buffering and restart failed bridge streams

Firmware `0.3.4-hosted` / `hosted-wss-v5` replaces the operational 0.3.1
forwarding implementation. The installed 0.3.2 source was unavailable; this
change is derived from inspected source and reproduced failures, not a claim
that all differences in that image have been recovered.

During the first hardware startup, 0.3.3 retained identity and Wi-Fi credentials
but repeatedly remained at the pre-TLS clock synchronization gate. The inherited
retry loop disconnected and reassociated Wi-Fi on every clock or socket retry.
Version 0.3.4 reuses an associated interface with an address, and restarts failed
SNTP attempts across three public servers. Successful SNTP remains active for
periodic correction. Certificate and hostname verification remain required.
The production-function host test verifies that failed time synchronization
does not disconnect Wi-Fi and that a lost association still reconnects.

The former 16-event USB queue ignored enqueue failure and the forwarding mutex
timeout silently discarded chunks. A network reconnect could also replay an
old SASSI CRC seed while the Nano still considered its USB session established.
This produced either corrupted streams or a backend session receiving no bytes.
An observed bridged file failure was isolated by a successful direct download
whose SHA-256 matched the retained original, but its exact corrupted wire bytes
were not captured.

Use one 32 KiB byte ring with bounded memory copies under a short critical
section. Never hold that lock across USB, WebSocket or semaphore waits. Saturation,
mutex timeout, socket failure, malformed WebSocket delivery order and USB write
failure invalidate the whole stream. A connection generation prevents popped
bytes from an earlier session being forwarded into a later connection. The
network task cannot destroy a client while the USB consumer is sending through
it. The main consumer yields at least every eight chunks, even under continuous
input, so it cannot indefinitely starve the idle task.

On authenticated attachment, a USB peer already recognized by its `KL*` prefix
is re-enumerated by removing the Atom's USB data connection for 250 ms. This
restarts SASSI negotiation with a fresh Nano request; there is no cached-handshake
replay. This does not power-cycle/reset the Nano or write its files. JSON setup
peers remain connected and usable during network failure. This updates the RAM
bootstrap-replay detail of ADR-0008, while preserving its TLS, device credential,
endpoint and command-allowlist boundaries. No OTA or durable spool is added.

Forwarding counters in USB status expose queue high-water, overflow, failure,
recovery and byte counts. Counters are volatile per boot; persistent watchdog
counters remain unchanged. Expected offline/recovery discards are counted, so
discard count by itself is not an overflow alarm. Startup never erases NVS on
initialization errors. The physical updater writes only the application after
checking a clean source commit and artifact checksum against the build manifest.

Authenticated WSS sessions may send a strict schema-1 text message with type
`diagnostics`: uptime, boot/watchdog/brownout counts and forwarding counters.
No other post-authentication text message is accepted. JSON is capped at 2 KiB,
values are unsigned numbers, unknown fields fail closed, and the backend logs at
most once per five seconds. Firmware emits on attachment and every 30 seconds.
This additive contract permits physical acceptance and ongoing observation
without moving the Atom back to a computer. Existing firmware can omit it.

The canonical backend schedules unseen native-file paths before refreshing
known ones, retaining profile-before-log ordering within each group. This avoids
starving new roasts behind a recurring old-file transfer fault. Every selected
file is still downloaded, CRC/sequence checked and imported only when complete;
hash-based deduplication is unchanged. Completed imports remain counted if a
later transfer fails. There is no blind packet retry or partial-file import.

Validation includes ASan/UBSan tests of the actual C ring and extracted production
ESP adapter functions: saturation, mutex/socket/USB failure, stale generations,
setup isolation, 16 MB of varied fragmented/stalled streams, 10,000 reconnects
and WebSocket gaps/overlaps/bounds. A Rust integration test imports a new log
before an old log's corrupt second packet, verifies old bytes unchanged, then
reconnects and finishes without duplicates. Physical acceptance additionally
requires a complete hosted Nano sync, stable watchdog counters, retained
provisioning and a clean repeat/reconnect. Unit tests alone are insufficient.
