#include "test.h"

#include <string.h>

#include "tan_roaster_session.h"
#include "tan_sassi_fixtures.h"

typedef struct {
    uint64_t now_ms;
} fake_clock_t;

typedef struct {
    const uint8_t *bytes;
    size_t length;
    size_t offset;
    size_t maximum_read;
    uint32_t read_count;
    uint32_t write_count;
} mock_transport_t;

static uint64_t fake_now(void *context)
{
    return ((fake_clock_t *)context)->now_ms;
}

static void process(tan_roaster_session_t *session,
                    tan_roaster_session_event_t event)
{
    TAN_ASSERT(tan_roaster_session_post(session, event));
    TAN_ASSERT(tan_roaster_session_process_next(session));
}

static size_t mock_transport_read(mock_transport_t *transport, uint8_t *bytes,
                                  size_t capacity)
{
    size_t available = transport->length - transport->offset;
    size_t length = available < transport->maximum_read
                        ? available
                        : transport->maximum_read;
    if (length > capacity) {
        length = capacity;
    }
    if (length != 0U) {
        memcpy(bytes, &transport->bytes[transport->offset], length);
        transport->offset += length;
        transport->read_count++;
    }
    return length;
}

static void observe_mock_transport(tan_roaster_session_t *session,
                                   mock_transport_t *transport)
{
    tan_sassi_decoder_t decoder;
    tan_sassi_decoder_init(&decoder);
    uint8_t chunk[7];
    size_t length;
    while ((length = mock_transport_read(transport, chunk, sizeof(chunk))) !=
           0U) {
        for (size_t index = 0U; index < length; index++) {
            tan_sassi_event_t event = tan_sassi_decoder_push(&decoder, chunk[index]);
            TAN_ASSERT(event.kind == TAN_SASSI_EVENT_NONE ||
                       event.kind == TAN_SASSI_EVENT_FRAME);
            if (event.kind == TAN_SASSI_EVENT_FRAME) {
                process(session, (tan_roaster_session_event_t){
                                     .kind = TAN_ROASTER_EVENT_FRAME,
                                     .frame = event.frame,
                                 });
            }
        }
    }
}

void test_session(void)
{
    fake_clock_t clock = {.now_ms = 100U};
    mock_transport_t transport = {
        .bytes = (const uint8_t *)TYPE_2_FIXTURE_A,
        .length = strlen(TYPE_2_FIXTURE_A),
        .maximum_read = 3U,
    };
    tan_roaster_session_t session;
    tan_roaster_session_init(
        &session, (tan_monotonic_clock_t){.now = fake_now, .context = &clock});
    TAN_ASSERT(tan_roaster_session_snapshot(&session).state ==
               TAN_ROASTER_SESSION_BOOTING);
    tan_roaster_session_start(&session);
    TAN_ASSERT(tan_roaster_session_snapshot(&session).state ==
               TAN_ROASTER_SESSION_USB_DETACHED);

    process(&session, (tan_roaster_session_event_t){
                          .kind = TAN_ROASTER_EVENT_USB_ATTACHED,
                      });
    process(&session, (tan_roaster_session_event_t){
                          .kind = TAN_ROASTER_EVENT_USB_ENUMERATED,
                      });
    clock.now_ms += TAN_ROASTER_SESSION_OBSERVE_TIMEOUT_MS;
    tan_roaster_session_tick(&session);
    TAN_ASSERT(tan_roaster_session_snapshot(&session).state ==
               TAN_ROASTER_SESSION_RECOVERING);
    TAN_ASSERT(tan_roaster_session_snapshot(&session).timeouts == 1U);

    process(&session, (tan_roaster_session_event_t){
                          .kind = TAN_ROASTER_EVENT_USB_ATTACHED,
                      });
    process(&session, (tan_roaster_session_event_t){
                          .kind = TAN_ROASTER_EVENT_USB_ENUMERATED,
                      });
    observe_mock_transport(&session, &transport);
    TAN_ASSERT(tan_roaster_session_snapshot(&session).state ==
               TAN_ROASTER_SESSION_READ_ONLY_READY);
    TAN_ASSERT(transport.read_count > 1U);
    TAN_ASSERT(transport.offset == transport.length);

    process(&session, (tan_roaster_session_event_t){
                          .kind = TAN_ROASTER_EVENT_FRAME,
                          .frame = {.type = 32U,
                                    .has_sequence = true,
                                    .sequence = 1U},
                      });
    process(&session, (tan_roaster_session_event_t){
                          .kind = TAN_ROASTER_EVENT_FRAME,
                          .frame = {.type = 32U,
                                    .has_sequence = true,
                                    .sequence = 3U},
                      });
    TAN_ASSERT(tan_roaster_session_snapshot(&session).sequence_gaps == 1U);
    TAN_ASSERT(tan_roaster_session_snapshot(&session).state ==
               TAN_ROASTER_SESSION_RECOVERING);

    process(&session, (tan_roaster_session_event_t){
                          .kind = TAN_ROASTER_EVENT_CANCEL,
                      });
    TAN_ASSERT(tan_roaster_session_snapshot(&session).cancellations == 1U);
    process(&session, (tan_roaster_session_event_t){
                          .kind = TAN_ROASTER_EVENT_USB_DETACHED,
                      });
    process(&session, (tan_roaster_session_event_t){
                          .kind = TAN_ROASTER_EVENT_USB_ATTACHED,
                      });
    TAN_ASSERT(tan_roaster_session_snapshot(&session).reconnects >= 2U);
    TAN_ASSERT(transport.write_count == 0U);

    tan_roaster_session_t saturated;
    tan_roaster_session_init(
        &saturated,
        (tan_monotonic_clock_t){.now = fake_now, .context = &clock});
    for (size_t index = 0U; index < TAN_ROASTER_SESSION_QUEUE_CAPACITY; index++) {
        TAN_ASSERT(tan_roaster_session_post(
            &saturated,
            (tan_roaster_session_event_t){.kind = TAN_ROASTER_EVENT_CANCEL}));
    }
    TAN_ASSERT(!tan_roaster_session_post(
        &saturated,
        (tan_roaster_session_event_t){.kind = TAN_ROASTER_EVENT_CANCEL}));
    TAN_ASSERT(tan_roaster_session_snapshot(&saturated).state ==
               TAN_ROASTER_SESSION_FAULTED);
    TAN_ASSERT(tan_roaster_session_snapshot(&saturated).queue_saturations == 1U);
    TAN_ASSERT(transport.write_count == 0U);
}
