#include "test.h"

#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "tan_sassi.h"
#include "tan_sassi_fixtures.h"

static size_t feed(tan_sassi_decoder_t *decoder, const uint8_t *bytes,
                   size_t length, tan_sassi_event_t *last)
{
    size_t events = 0U;
    for (size_t index = 0; index < length; index++) {
        tan_sassi_event_t current = tan_sassi_decoder_push(decoder, bytes[index]);
        if (current.kind != TAN_SASSI_EVENT_NONE) {
            events++;
            *last = current;
        }
    }
    return events;
}

static void write_hex4(char output[4], uint16_t value)
{
    static const char digits[] = "0123456789ABCDEF";
    output[0] = digits[(value >> 12U) & 0xfU];
    output[1] = digits[(value >> 8U) & 0xfU];
    output[2] = digits[(value >> 4U) & 0xfU];
    output[3] = digits[value & 0xfU];
}

static void test_good_and_fragmented(void)
{
    const uint8_t *fixture = (const uint8_t *)TYPE_2_FIXTURE_A;
    size_t length = strlen(TYPE_2_FIXTURE_A);
    for (size_t split = 0U; split <= length; split++) {
        tan_sassi_decoder_t decoder;
        tan_sassi_decoder_init(&decoder);
        tan_sassi_event_t last = {0};
        size_t events = feed(&decoder, fixture, split, &last);
        events += feed(&decoder, fixture + split, length - split, &last);
        TAN_ASSERT(events == 1U);
        TAN_ASSERT(last.kind == TAN_SASSI_EVENT_FRAME);
        TAN_ASSERT(last.frame.type == 2U);
        TAN_ASSERT(last.frame.connection_supported);
        TAN_ASSERT(last.frame.crc_seed == 0x1a2bU);
    }
}

static void test_combined_and_noise(void)
{
    char combined[256];
    int length = snprintf(combined, sizeof(combined), "noise-before-frame%s%s",
                          TYPE_2_FIXTURE_A, TYPE_2_FIXTURE_B);
    TAN_ASSERT(length > 0 && (size_t)length < sizeof(combined));
    tan_sassi_decoder_t decoder;
    tan_sassi_decoder_init(&decoder);
    tan_sassi_event_t last = {0};
    TAN_ASSERT(feed(&decoder, (const uint8_t *)combined, (size_t)length, &last) ==
               2U);
    TAN_ASSERT(last.kind == TAN_SASSI_EVENT_FRAME);
    TAN_ASSERT(last.frame.crc_seed == 0xbeefU);
}

static void test_crc_failure_and_recovery(void)
{
    char corrupted[sizeof(TYPE_2_FIXTURE_A)];
    memcpy(corrupted, TYPE_2_FIXTURE_A, sizeof(corrupted));
    char *capabilities = strstr(corrupted, "|128|");
    TAN_ASSERT(capabilities != NULL);
    capabilities[3] = '9';

    tan_sassi_decoder_t decoder;
    tan_sassi_decoder_init(&decoder);
    tan_sassi_event_t last = {0};
    TAN_ASSERT(feed(&decoder, (const uint8_t *)corrupted,
                    strlen(corrupted), &last) == 1U);
    TAN_ASSERT(last.kind == TAN_SASSI_EVENT_CRC_FAILED);
    TAN_ASSERT(feed(&decoder, (const uint8_t *)TYPE_2_FIXTURE_A,
                    strlen(TYPE_2_FIXTURE_A), &last) == 1U);
    TAN_ASSERT(last.kind == TAN_SASSI_EVENT_FRAME);
}

static void test_maximum_and_oversized(void)
{
    char frame[TAN_SASSI_MAX_FRAME_BYTES + 1U];
    static const char prefix[] = "KL*99|1|";
    size_t body_length = TAN_SASSI_MAX_FRAME_BYTES - 5U;
    size_t payload_length = body_length - (sizeof(prefix) - 1U) - 1U;
    memcpy(frame, prefix, sizeof(prefix) - 1U);
    memset(frame + sizeof(prefix) - 1U, 'A', payload_length);
    frame[body_length - 1U] = '|';
    uint16_t crc = tan_sassi_crc16((const uint8_t *)frame, body_length, 0U);
    write_hex4(&frame[body_length], crc);
    frame[body_length + 4U] = '\r';
    frame[TAN_SASSI_MAX_FRAME_BYTES] = '\0';

    tan_sassi_decoder_t decoder;
    tan_sassi_decoder_init(&decoder);
    tan_sassi_decoder_set_limits(&decoder, TAN_SASSI_NEGOTIATED_PACKET_BYTES,
                                 0U);
    tan_sassi_event_t last = {0};
    TAN_ASSERT(feed(&decoder, (const uint8_t *)frame,
                    TAN_SASSI_MAX_FRAME_BYTES, &last) == 1U);
    TAN_ASSERT(last.kind == TAN_SASSI_EVENT_FRAME);
    TAN_ASSERT(last.frame.frame_bytes == TAN_SASSI_MAX_FRAME_BYTES);

    tan_sassi_decoder_init(&decoder);
    tan_sassi_decoder_set_limits(&decoder, TAN_SASSI_NEGOTIATED_PACKET_BYTES,
                                 0U);
    TAN_ASSERT(feed(&decoder, (const uint8_t *)"KL*", 3U, &last) == 0U);
    size_t errors = 0U;
    for (size_t index = 0U; index < TAN_SASSI_MAX_FRAME_BYTES; index++) {
        tan_sassi_event_t current = tan_sassi_decoder_push(&decoder, 'A');
        if (current.kind != TAN_SASSI_EVENT_NONE) {
            errors++;
            last = current;
        }
    }
    TAN_ASSERT(errors == 1U);
    TAN_ASSERT(last.kind == TAN_SASSI_EVENT_TOO_LARGE);
    (void)tan_sassi_decoder_push(&decoder, '\r');
    TAN_ASSERT(feed(&decoder, (const uint8_t *)TYPE_2_FIXTURE_A,
                    strlen(TYPE_2_FIXTURE_A), &last) == 1U);
    TAN_ASSERT(last.kind == TAN_SASSI_EVENT_FRAME);
}

static void test_truncation_and_fields(void)
{
    tan_sassi_decoder_t decoder;
    tan_sassi_decoder_init(&decoder);
    tan_sassi_event_t last = {0};
    TAN_ASSERT(feed(&decoder, (const uint8_t *)"KL*2|abc", 8U, &last) == 0U);
    TAN_ASSERT(tan_sassi_decoder_finish(&decoder).kind ==
               TAN_SASSI_EVENT_TRUNCATED);
    TAN_ASSERT(tan_sassi_field_is_valid("Line\\vTwo", 9U));
    TAN_ASSERT(!tan_sassi_field_is_valid("bad|field", 9U));
    TAN_ASSERT(!tan_sassi_field_is_valid("bad\nfield", 9U));
}

void test_sassi(void)
{
    test_good_and_fragmented();
    test_combined_and_noise();
    test_crc_failure_and_recovery();
    test_maximum_and_oversized();
    test_truncation_and_fields();
}
