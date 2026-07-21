#ifndef TAN_SASSI_H
#define TAN_SASSI_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define TAN_SASSI_PRE_HANDSHAKE_FRAME_BYTES 512U
#define TAN_SASSI_NEGOTIATED_PACKET_BYTES 4064U
#define TAN_SASSI_FRAME_OVERHEAD_BYTES 64U
#define TAN_SASSI_MAX_FRAME_BYTES                                             \
    (TAN_SASSI_NEGOTIATED_PACKET_BYTES + TAN_SASSI_FRAME_OVERHEAD_BYTES)
#define TAN_SASSI_MAX_FIELDS 16U

typedef enum {
    TAN_SASSI_EVENT_NONE,
    TAN_SASSI_EVENT_FRAME,
    TAN_SASSI_EVENT_MALFORMED,
    TAN_SASSI_EVENT_CRC_FAILED,
    TAN_SASSI_EVENT_TOO_LARGE,
    TAN_SASSI_EVENT_TRUNCATED,
} tan_sassi_event_kind_t;

typedef struct {
    uint32_t type;
    uint64_t elapsed_ms;
    uint16_t crc_seed;
    uint16_t field_count;
    uint16_t frame_bytes;
    bool connection_request;
    bool connection_supported;
    bool has_sequence;
    uint32_t sequence;
} tan_sassi_frame_t;

typedef struct {
    tan_sassi_event_kind_t kind;
    tan_sassi_frame_t frame;
} tan_sassi_event_t;

typedef struct {
    char buffer[TAN_SASSI_MAX_FRAME_BYTES + 1U];
    size_t length;
    size_t maximum_frame_bytes;
    uint16_t negotiated_crc_seed;
    uint8_t prefix_bytes;
    bool reading_frame;
    bool discard_until_terminator;
    bool negotiated;
} tan_sassi_decoder_t;

void tan_sassi_decoder_init(tan_sassi_decoder_t *decoder);
void tan_sassi_decoder_reset(tan_sassi_decoder_t *decoder);
void tan_sassi_decoder_set_limits(tan_sassi_decoder_t *decoder,
                                  uint32_t maximum_packet_bytes,
                                  uint16_t crc_seed);
tan_sassi_event_t tan_sassi_decoder_push(tan_sassi_decoder_t *decoder,
                                         uint8_t byte);
tan_sassi_event_t tan_sassi_decoder_finish(tan_sassi_decoder_t *decoder);

uint16_t tan_sassi_crc16(const uint8_t *bytes, size_t length,
                         uint16_t initial_value);
bool tan_sassi_field_is_valid(const char *field, size_t length);

#endif
