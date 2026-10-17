#ifndef TAN_FORWARDING_H
#define TAN_FORWARDING_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define TAN_FORWARD_CAPACITY 32768U
typedef enum { TAN_PEER_UNKNOWN, TAN_PEER_NANO, TAN_PEER_SETUP } tan_peer_t;
typedef struct {
    uint64_t received, forwarded, discarded;
    uint32_t overflows, failures, recoveries;
    size_t high_water;
} tan_forward_stats_t;
/* Callers serialize these bounded, nonblocking operations. No I/O or waits
 * occur under this state lock. A fault invalidates the entire byte stream. */
typedef struct {
    uint8_t bytes[TAN_FORWARD_CAPACITY];
    size_t head, length;
    uint32_t generation;
    bool failed, recovering;
    tan_peer_t peer;
    unsigned prefix;
    tan_forward_stats_t stats;
} tan_forwarder_t;
bool tan_forward_push(tan_forwarder_t *, const uint8_t *, size_t);
size_t tan_forward_pop(tan_forwarder_t *, uint8_t *, size_t, uint32_t *);
void tan_forward_fail(tan_forwarder_t *);
/* Returns true when a known Nano needs USB re-enumeration. Never resets a
 * computer setup connection. Recovery completes before new bytes are accepted. */
bool tan_forward_begin(tan_forwarder_t *);
void tan_forward_recovered(tan_forwarder_t *);
bool tan_forward_current(const tan_forwarder_t *, uint32_t);

#define TAN_WS_CAPACITY 8195U
typedef struct {
    uint8_t bytes[TAN_WS_CAPACITY + 1];
    size_t length, frame_length, frame_received;
    uint8_t opcode, frame_opcode;
    bool message_active, frame_active, frame_fin;
} tan_ws_message_t;
typedef enum { TAN_WS_ERROR, TAN_WS_MORE, TAN_WS_READY } tan_ws_result_t;
/* Supports both SDK delivery chunks and RFC6455 continuation frames. */
tan_ws_result_t tan_ws_feed(tan_ws_message_t *, uint8_t opcode, bool fin,
                            size_t total, size_t offset,
                            const uint8_t *bytes, size_t length);
#endif
