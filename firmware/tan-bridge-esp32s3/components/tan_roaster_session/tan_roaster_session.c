#include "tan_roaster_session.h"

#include <string.h>

static uint64_t now_ms(const tan_roaster_session_t *session)
{
    return session->clock.now == NULL ? 0U
                                      : session->clock.now(session->clock.context);
}

void tan_roaster_session_init(tan_roaster_session_t *session,
                              tan_monotonic_clock_t clock)
{
    memset(session, 0, sizeof(*session));
    session->clock = clock;
    session->state = TAN_ROASTER_SESSION_BOOTING;
}

void tan_roaster_session_start(tan_roaster_session_t *session)
{
    if (session->state == TAN_ROASTER_SESSION_BOOTING) {
        session->state = TAN_ROASTER_SESSION_USB_DETACHED;
    }
}

bool tan_roaster_session_post(tan_roaster_session_t *session,
                              tan_roaster_session_event_t event)
{
    if (session->queue_length == TAN_ROASTER_SESSION_QUEUE_CAPACITY) {
        session->queue_saturations++;
        session->state = TAN_ROASTER_SESSION_FAULTED;
        return false;
    }
    size_t tail = (session->queue_head + session->queue_length) %
                  TAN_ROASTER_SESSION_QUEUE_CAPACITY;
    session->queue[tail] = event;
    session->queue_length++;
    return true;
}

static void observe_sequence(tan_roaster_session_t *session,
                             const tan_sassi_frame_t *frame)
{
    if (!frame->has_sequence || frame->sequence == 0U) {
        return;
    }
    if (frame->sequence == 1U) {
        session->expected_sequence = 2U;
        return;
    }
    if (session->expected_sequence == 0U ||
        frame->sequence != session->expected_sequence) {
        session->sequence_gaps++;
        session->expected_sequence = frame->sequence + 1U;
        session->state = TAN_ROASTER_SESSION_RECOVERING;
        return;
    }
    session->expected_sequence++;
}

static void process(tan_roaster_session_t *session,
                    const tan_roaster_session_event_t *event)
{
    if (session->state == TAN_ROASTER_SESSION_FAULTED) {
        return;
    }

    switch (event->kind) {
    case TAN_ROASTER_EVENT_USB_ATTACHED:
        if (session->state != TAN_ROASTER_SESSION_USB_DETACHED) {
            session->reconnects++;
        }
        session->state = TAN_ROASTER_SESSION_USB_ENUMERATED;
        session->deadline_ms =
            now_ms(session) + TAN_ROASTER_SESSION_OBSERVE_TIMEOUT_MS;
        session->expected_sequence = 0U;
        break;
    case TAN_ROASTER_EVENT_USB_ENUMERATED:
        session->state = TAN_ROASTER_SESSION_OBSERVING;
        session->deadline_ms =
            now_ms(session) + TAN_ROASTER_SESSION_OBSERVE_TIMEOUT_MS;
        break;
    case TAN_ROASTER_EVENT_USB_DETACHED:
        if (session->state != TAN_ROASTER_SESSION_USB_DETACHED) {
            session->reconnects++;
        }
        session->state = TAN_ROASTER_SESSION_USB_DETACHED;
        session->deadline_ms = 0U;
        session->expected_sequence = 0U;
        break;
    case TAN_ROASTER_EVENT_FRAME:
        session->observed_frames++;
        observe_sequence(session, &event->frame);
        if (session->state != TAN_ROASTER_SESSION_RECOVERING) {
            if (event->frame.connection_request &&
                event->frame.connection_supported) {
                session->state = TAN_ROASTER_SESSION_READ_ONLY_READY;
            } else if (session->state != TAN_ROASTER_SESSION_READ_ONLY_READY) {
                session->state = TAN_ROASTER_SESSION_OBSERVING;
            }
        }
        session->deadline_ms = 0U;
        break;
    case TAN_ROASTER_EVENT_PROTOCOL_ERROR:
        session->protocol_errors++;
        session->state = TAN_ROASTER_SESSION_RECOVERING;
        session->deadline_ms = 0U;
        break;
    case TAN_ROASTER_EVENT_CANCEL:
        session->cancellations++;
        session->state = TAN_ROASTER_SESSION_RECOVERING;
        session->deadline_ms = 0U;
        session->expected_sequence = 0U;
        break;
    }
}

bool tan_roaster_session_process_next(tan_roaster_session_t *session)
{
    if (session->queue_length == 0U) {
        return false;
    }
    tan_roaster_session_event_t event = session->queue[session->queue_head];
    session->queue_head =
        (session->queue_head + 1U) % TAN_ROASTER_SESSION_QUEUE_CAPACITY;
    session->queue_length--;
    process(session, &event);
    return true;
}

void tan_roaster_session_tick(tan_roaster_session_t *session)
{
    if (session->deadline_ms != 0U && now_ms(session) >= session->deadline_ms &&
        (session->state == TAN_ROASTER_SESSION_USB_ENUMERATED ||
         session->state == TAN_ROASTER_SESSION_OBSERVING)) {
        session->timeouts++;
        session->state = TAN_ROASTER_SESSION_RECOVERING;
        session->deadline_ms = 0U;
    }
}

tan_roaster_session_snapshot_t
tan_roaster_session_snapshot(const tan_roaster_session_t *session)
{
    return (tan_roaster_session_snapshot_t){
        .state = session->state,
        .reconnects = session->reconnects,
        .timeouts = session->timeouts,
        .sequence_gaps = session->sequence_gaps,
        .queue_saturations = session->queue_saturations,
        .cancellations = session->cancellations,
        .protocol_errors = session->protocol_errors,
        .observed_frames = session->observed_frames,
        .expected_sequence = session->expected_sequence,
    };
}
