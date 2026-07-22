#ifndef TAN_TUNNEL_POLICY_H
#define TAN_TUNNEL_POLICY_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/*
 * This is a narrow mutation boundary, not a complete SASSI validator. The
 * backend owns framing and CRC validation. The dongle independently verifies
 * that backend traffic is a printable, framed request of an already observed
 * read-only type before forwarding any byte to the Nano.
 */
bool tan_tunnel_allows_backend_frame(const uint8_t *bytes, size_t length);

#endif
