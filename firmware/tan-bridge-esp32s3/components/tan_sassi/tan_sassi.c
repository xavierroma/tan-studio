#include "tan_sassi.h"

#include <limits.h>
#include <string.h>

typedef struct {
    const char *start;
    size_t length;
} field_span_t;

static tan_sassi_event_t event(tan_sassi_event_kind_t kind)
{
    return (tan_sassi_event_t){.kind = kind};
}

uint16_t tan_sassi_crc16(const uint8_t *bytes, size_t length,
                         uint16_t initial_value)
{
    uint16_t crc = initial_value;
    for (size_t index = 0; index < length; index++) {
        crc ^= (uint16_t)bytes[index] << 8U;
        for (uint8_t bit = 0; bit < 8U; bit++) {
            crc = (crc & 0x8000U) == 0U
                      ? (uint16_t)(crc << 1U)
                      : (uint16_t)((crc << 1U) ^ 0x1021U);
        }
    }
    return crc;
}

bool tan_sassi_field_is_valid(const char *field, size_t length)
{
    if (field == NULL && length != 0U) {
        return false;
    }
    for (size_t index = 0; index < length; index++) {
        unsigned char character = (unsigned char)field[index];
        if (character < 0x20U || character > 0x7eU || character == '|') {
            return false;
        }
    }
    return true;
}

void tan_sassi_decoder_init(tan_sassi_decoder_t *decoder)
{
    memset(decoder, 0, sizeof(*decoder));
    decoder->maximum_frame_bytes = TAN_SASSI_PRE_HANDSHAKE_FRAME_BYTES;
}

void tan_sassi_decoder_reset(tan_sassi_decoder_t *decoder)
{
    tan_sassi_decoder_init(decoder);
}

void tan_sassi_decoder_set_limits(tan_sassi_decoder_t *decoder,
                                  uint32_t maximum_packet_bytes,
                                  uint16_t crc_seed)
{
    uint32_t bounded = maximum_packet_bytes;
    if (bounded > TAN_SASSI_NEGOTIATED_PACKET_BYTES) {
        bounded = TAN_SASSI_NEGOTIATED_PACKET_BYTES;
    }
    decoder->maximum_frame_bytes = bounded + TAN_SASSI_FRAME_OVERHEAD_BYTES;
    if (decoder->maximum_frame_bytes > TAN_SASSI_MAX_FRAME_BYTES) {
        decoder->maximum_frame_bytes = TAN_SASSI_MAX_FRAME_BYTES;
    }
    decoder->negotiated_crc_seed = crc_seed;
    decoder->negotiated = true;
}

static bool parse_unsigned(field_span_t span, unsigned base, uint64_t maximum,
                           uint64_t *value)
{
    if (span.length == 0U) {
        return false;
    }
    uint64_t parsed = 0U;
    for (size_t index = 0; index < span.length; index++) {
        unsigned char character = (unsigned char)span.start[index];
        unsigned digit;
        if (character >= '0' && character <= '9') {
            digit = (unsigned)(character - '0');
        } else if (base == 16U && character >= 'a' && character <= 'f') {
            digit = 10U + (unsigned)(character - 'a');
        } else if (base == 16U && character >= 'A' && character <= 'F') {
            digit = 10U + (unsigned)(character - 'A');
        } else {
            return false;
        }
        if (digit >= base || parsed > (maximum - digit) / base) {
            return false;
        }
        parsed = parsed * base + digit;
    }
    *value = parsed;
    return true;
}

static bool span_equals(field_span_t span, const char *expected)
{
    size_t expected_length = strlen(expected);
    return span.length == expected_length &&
           memcmp(span.start, expected, expected_length) == 0;
}

static bool supported_model(field_span_t span)
{
    static const char model[] = "KN1007B";
    return span.length >= sizeof(model) - 1U &&
           memcmp(span.start, model, sizeof(model) - 1U) == 0 &&
           (span.length == sizeof(model) - 1U ||
            span.start[sizeof(model) - 1U] == '/');
}

static size_t split_fields(const char *start, const char *end,
                           field_span_t *fields, size_t capacity)
{
    size_t count = 0U;
    const char *field_start = start;
    for (const char *cursor = start; cursor <= end; cursor++) {
        if (cursor == end || *cursor == '|') {
            if (count == capacity) {
                return capacity + 1U;
            }
            fields[count++] = (field_span_t){
                .start = field_start,
                .length = (size_t)(cursor - field_start),
            };
            field_start = cursor + 1;
        }
    }
    return count;
}

static tan_sassi_event_t decode_frame(tan_sassi_decoder_t *decoder)
{
    if (decoder->length < 9U) {
        return event(TAN_SASSI_EVENT_MALFORMED);
    }

    char *last_separator = NULL;
    for (size_t index = decoder->length; index > 0U; index--) {
        if (decoder->buffer[index - 1U] == '|') {
            last_separator = &decoder->buffer[index - 1U];
            break;
        }
    }
    if (last_separator == NULL ||
        (size_t)(&decoder->buffer[decoder->length] - last_separator - 1) != 4U) {
        return event(TAN_SASSI_EVENT_MALFORMED);
    }

    field_span_t crc_span = {.start = last_separator + 1, .length = 4U};
    uint64_t supplied_crc;
    if (!parse_unsigned(crc_span, 16U, UINT16_MAX, &supplied_crc)) {
        return event(TAN_SASSI_EVENT_MALFORMED);
    }

    field_span_t fields[2U + TAN_SASSI_MAX_FIELDS];
    size_t field_count = split_fields(&decoder->buffer[3], last_separator,
                                      fields, 2U + TAN_SASSI_MAX_FIELDS);
    if (field_count < 2U || field_count > 2U + TAN_SASSI_MAX_FIELDS) {
        return event(TAN_SASSI_EVENT_MALFORMED);
    }

    uint64_t type;
    uint64_t elapsed_ms;
    if (!parse_unsigned(fields[0], 10U, UINT32_MAX, &type) ||
        !parse_unsigned(fields[1], 16U, UINT64_MAX, &elapsed_ms)) {
        return event(TAN_SASSI_EVENT_MALFORMED);
    }

    uint16_t crc_seed = decoder->negotiated ? decoder->negotiated_crc_seed : 0U;
    bool connection_request = type == 2U;
    if (connection_request) {
        if (field_count != 12U) {
            return event(TAN_SASSI_EVENT_MALFORMED);
        }
        uint64_t candidate_seed;
        if (!parse_unsigned(fields[11], 16U, UINT16_MAX, &candidate_seed)) {
            return event(TAN_SASSI_EVENT_MALFORMED);
        }
        crc_seed = (uint16_t)candidate_seed;
    }

    size_t crc_input_length = (size_t)(last_separator - decoder->buffer) + 1U;
    uint16_t computed_crc = tan_sassi_crc16(
        (const uint8_t *)decoder->buffer, crc_input_length, crc_seed);
    if (computed_crc != (uint16_t)supplied_crc) {
        return event(TAN_SASSI_EVENT_CRC_FAILED);
    }

    tan_sassi_frame_t frame = {
        .type = (uint32_t)type,
        .elapsed_ms = elapsed_ms,
        .crc_seed = crc_seed,
        .field_count = (uint16_t)(field_count - 2U),
        .frame_bytes = (uint16_t)(decoder->length + 1U),
        .connection_request = connection_request,
    };

    if (connection_request) {
        uint64_t platform;
        uint64_t capability_bits;
        uint64_t sassi_version;
        uint64_t maximum_packet_bytes;
        uint64_t maximum_filename_bytes;
        bool numeric = parse_unsigned(fields[2], 10U, UINT32_MAX, &platform) &&
                       parse_unsigned(fields[3], 10U, UINT32_MAX,
                                      &capability_bits) &&
                       parse_unsigned(fields[5], 10U, UINT16_MAX,
                                      &sassi_version) &&
                       parse_unsigned(fields[9], 10U,
                                      TAN_SASSI_NEGOTIATED_PACKET_BYTES,
                                      &maximum_packet_bytes) &&
                       parse_unsigned(fields[10], 10U, 192U,
                                      &maximum_filename_bytes);
        bool identity = fields[4].length == 10U && supported_model(fields[6]) &&
                        span_equals(fields[7], "kaffelogic.com");
        frame.connection_supported =
            numeric && identity && platform == 1U && sassi_version == 1U &&
            maximum_packet_bytes > 0U && maximum_filename_bytes > 0U;
        if (frame.connection_supported) {
            tan_sassi_decoder_set_limits(decoder,
                                         (uint32_t)maximum_packet_bytes,
                                         crc_seed);
        }
    }

    if ((type == 6U || type == 8U || type == 32U) && field_count >= 7U) {
        uint64_t sequence;
        if (parse_unsigned(fields[5], 10U, UINT32_MAX, &sequence)) {
            frame.has_sequence = true;
            frame.sequence = (uint32_t)sequence;
        }
    }

    return (tan_sassi_event_t){
        .kind = TAN_SASSI_EVENT_FRAME,
        .frame = frame,
    };
}

static void begin_or_advance_prefix(tan_sassi_decoder_t *decoder, uint8_t byte)
{
    static const char prefix[] = "KL*";
    if (byte == (uint8_t)prefix[decoder->prefix_bytes]) {
        decoder->prefix_bytes++;
        if (decoder->prefix_bytes == sizeof(prefix) - 1U) {
            memcpy(decoder->buffer, prefix, sizeof(prefix) - 1U);
            decoder->length = sizeof(prefix) - 1U;
            decoder->reading_frame = true;
            decoder->prefix_bytes = 0U;
        }
    } else {
        decoder->prefix_bytes = byte == 'K' ? 1U : 0U;
    }
}

tan_sassi_event_t tan_sassi_decoder_push(tan_sassi_decoder_t *decoder,
                                         uint8_t byte)
{
    if (decoder == NULL) {
        return event(TAN_SASSI_EVENT_MALFORMED);
    }

    if (decoder->discard_until_terminator) {
        if (byte == '\r') {
            decoder->discard_until_terminator = false;
            decoder->prefix_bytes = 0U;
        }
        return event(TAN_SASSI_EVENT_NONE);
    }

    if (!decoder->reading_frame) {
        begin_or_advance_prefix(decoder, byte);
        return event(TAN_SASSI_EVENT_NONE);
    }

    if (byte == '\r') {
        tan_sassi_event_t result = decode_frame(decoder);
        decoder->length = 0U;
        decoder->reading_frame = false;
        decoder->prefix_bytes = 0U;
        return result;
    }

    if (byte < 0x20U || byte > 0x7eU) {
        decoder->length = 0U;
        decoder->reading_frame = false;
        decoder->discard_until_terminator = true;
        return event(TAN_SASSI_EVENT_MALFORMED);
    }

    if (decoder->length + 2U > decoder->maximum_frame_bytes) {
        decoder->length = 0U;
        decoder->reading_frame = false;
        decoder->discard_until_terminator = true;
        return event(TAN_SASSI_EVENT_TOO_LARGE);
    }

    decoder->buffer[decoder->length++] = (char)byte;
    return event(TAN_SASSI_EVENT_NONE);
}

tan_sassi_event_t tan_sassi_decoder_finish(tan_sassi_decoder_t *decoder)
{
    if (decoder == NULL) {
        return event(TAN_SASSI_EVENT_MALFORMED);
    }
    bool truncated = decoder->reading_frame || decoder->discard_until_terminator;
    tan_sassi_decoder_reset(decoder);
    return event(truncated ? TAN_SASSI_EVENT_TRUNCATED : TAN_SASSI_EVENT_NONE);
}
