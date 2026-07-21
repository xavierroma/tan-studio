#ifndef TAN_ROASTER_SESSION_H
#define TAN_ROASTER_SESSION_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "tan_sassi.h"

#define TAN_ROASTER_SESSION_QUEUE_CAPACITY 8U
#define TAN_ROASTER_SESSION_OBSERVE_TIMEOUT_MS 10000U

typedef enum {
    TAN_ROASTER_SESSION_BOOTING,
    TAN_ROASTER_SESSION_USB_DETACHED,
    TAN_ROASTER_SESSION_USB_ENUMERATED,
    TAN_ROASTER_SESSION_OBSERVING,
    TAN_ROASTER_SESSION_READ_ONLY_READY,
    TAN_ROASTER_SESSION_RECOVERING,
    TAN_ROASTER_SESSION_FAULTED,
} tan_roaster_session_state_t;

typedef uint64_t (*tan_monotonic_now_fn)(void *context);

typedef struct {
    tan_monotonic_now_fn now;
    void *context;
} tan_monotonic_clock_t;

typedef enum {
    TAN_ROASTER_EVENT_USB_ATTACHED,
    TAN_ROASTER_EVENT_USB_ENUMERATED,
    TAN_ROASTER_EVENT_USB_DETACHED,
    TAN_ROASTER_EVENT_FRAME,
    TAN_ROASTER_EVENT_PROTOCOL_ERROR,
    TAN_ROASTER_EVENT_CANCEL,
} tan_roaster_session_event_kind_t;

typedef struct {
    tan_roaster_session_event_kind_t kind;
    tan_sassi_frame_t frame;
} tan_roaster_session_event_t;

typedef struct {
    tan_roaster_session_state_t state;
    uint32_t reconnects;
    uint32_t timeouts;
    uint32_t sequence_gaps;
    uint32_t queue_saturations;
    uint32_t cancellations;
    uint32_t protocol_errors;
    uint32_t observed_frames;
    uint32_t expected_sequence;
} tan_roaster_session_snapshot_t;

typedef struct {
    tan_monotonic_clock_t clock;
    tan_roaster_session_state_t state;
    tan_roaster_session_event_t queue[TAN_ROASTER_SESSION_QUEUE_CAPACITY];
    size_t queue_head;
    size_t queue_length;
    uint64_t deadline_ms;
    uint32_t reconnects;
    uint32_t timeouts;
    uint32_t sequence_gaps;
    uint32_t queue_saturations;
    uint32_t cancellations;
    uint32_t protocol_errors;
    uint32_t observed_frames;
    uint32_t expected_sequence;
} tan_roaster_session_t;

void tan_roaster_session_init(tan_roaster_session_t *session,
                              tan_monotonic_clock_t clock);
void tan_roaster_session_start(tan_roaster_session_t *session);
bool tan_roaster_session_post(tan_roaster_session_t *session,
                              tan_roaster_session_event_t event);
bool tan_roaster_session_process_next(tan_roaster_session_t *session);
void tan_roaster_session_tick(tan_roaster_session_t *session);
tan_roaster_session_snapshot_t
tan_roaster_session_snapshot(const tan_roaster_session_t *session);

#endif
