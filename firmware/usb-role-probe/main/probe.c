/*
 * Tan Studio USB role probe
 *
 * This is intentionally not bridge firmware. It presents one passive CDC-ACM
 * device, records host/enumeration observations in NVS, and never replies to
 * roaster traffic. The only transmit path requires the exact local diagnostic
 * command TAN_PROBE_DUMP followed by CR or LF.
 */

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "tinyusb.h"
#include "tinyusb_cdc_acm.h"
#include "tinyusb_default_config.h"

#define PROBE_MAGIC 0x54414e50U
#define PROBE_SCHEMA 1U
#define RX_CHUNK_SIZE 512U
#define COMMAND_SIZE 32U
#define FRAME_PREFIX_SIZE 16U
#define DIAGNOSTIC_BIT_RATE 921600U

typedef struct {
    uint32_t magic;
    uint32_t schema;
    uint32_t boot_number;
    uint32_t attached_count;
    uint32_t detached_count;
    uint32_t line_state_count;
    uint32_t line_coding_count;
    uint32_t dtr;
    uint32_t rts;
    uint32_t bit_rate;
    uint32_t rx_callbacks;
    uint32_t rx_bytes;
    uint32_t dropped_events;
    uint32_t sassi_frames;
    uint32_t malformed_sassi_frames;
    uint32_t last_sassi_type;
    uint32_t last_frame_length;
    uint32_t longest_frame_length;
} probe_session_t;

typedef enum {
    APP_EVENT_USB_ATTACHED,
    APP_EVENT_USB_DETACHED,
    APP_EVENT_LINE_STATE,
    APP_EVENT_LINE_CODING,
    APP_EVENT_RX,
} app_event_kind_t;

typedef struct {
    app_event_kind_t kind;
    uint32_t value_a;
    uint32_t value_b;
    size_t length;
    uint8_t bytes[RX_CHUNK_SIZE];
} app_event_t;

static QueueHandle_t event_queue;
static nvs_handle_t probe_nvs;
static probe_session_t current_session;
static probe_session_t previous_session;
static bool previous_available;
static volatile uint32_t callback_drop_count;

static char command_buffer[COMMAND_SIZE];
static size_t command_length;
static char frame_prefix[FRAME_PREFIX_SIZE];
static size_t frame_prefix_length;
static uint32_t frame_length;

static bool valid_session(const probe_session_t *session)
{
    return session->magic == PROBE_MAGIC && session->schema == PROBE_SCHEMA;
}

static bool has_observations(const probe_session_t *session)
{
    return session->attached_count != 0 || session->detached_count != 0 ||
           session->line_state_count != 0 || session->line_coding_count != 0 ||
           session->rx_callbacks != 0 || session->rx_bytes != 0 ||
           session->dropped_events != 0;
}

static bool load_session(const char *key, probe_session_t *session)
{
    size_t size = sizeof(*session);
    memset(session, 0, sizeof(*session));
    return nvs_get_blob(probe_nvs, key, session, &size) == ESP_OK &&
           size == sizeof(*session) && valid_session(session);
}

static void store_session(const char *key, const probe_session_t *session)
{
    ESP_ERROR_CHECK(nvs_set_blob(probe_nvs, key, session, sizeof(*session)));
    ESP_ERROR_CHECK(nvs_commit(probe_nvs));
}

static void initialize_sessions(void)
{
    probe_session_t saved_current;
    uint32_t boot_number = 0;

    previous_available = load_session("previous", &previous_session);
    if (load_session("current", &saved_current)) {
        boot_number = saved_current.boot_number;
        if (has_observations(&saved_current)) {
            previous_session = saved_current;
            previous_available = true;
            store_session("previous", &previous_session);
        }
    }

    memset(&current_session, 0, sizeof(current_session));
    current_session.magic = PROBE_MAGIC;
    current_session.schema = PROBE_SCHEMA;
    current_session.boot_number = boot_number + 1;
    store_session("current", &current_session);
}

static void enqueue_event(const app_event_t *event)
{
    if (xQueueSend(event_queue, event, 0) != pdTRUE) {
        __atomic_add_fetch(&callback_drop_count, 1, __ATOMIC_RELAXED);
    }
}

static void usb_event_callback(tinyusb_event_t *event, void *argument)
{
    (void)argument;
    app_event_t message = {0};

    if (event->id == TINYUSB_EVENT_ATTACHED) {
        message.kind = APP_EVENT_USB_ATTACHED;
        enqueue_event(&message);
    } else if (event->id == TINYUSB_EVENT_DETACHED) {
        message.kind = APP_EVENT_USB_DETACHED;
        enqueue_event(&message);
    }
}

static void cdc_rx_callback(int interface, cdcacm_event_t *event)
{
    (void)event;
    app_event_t message = {.kind = APP_EVENT_RX};

    if (tinyusb_cdcacm_read(interface, message.bytes, sizeof(message.bytes),
                            &message.length) == ESP_OK &&
        message.length != 0) {
        enqueue_event(&message);
    }
}

static void cdc_line_state_callback(int interface, cdcacm_event_t *event)
{
    (void)interface;
    app_event_t message = {
        .kind = APP_EVENT_LINE_STATE,
        .value_a = event->line_state_changed_data.dtr ? 1U : 0U,
        .value_b = event->line_state_changed_data.rts ? 1U : 0U,
    };
    enqueue_event(&message);
}

static void cdc_line_coding_callback(int interface, cdcacm_event_t *event)
{
    (void)interface;
    app_event_t message = {
        .kind = APP_EVENT_LINE_CODING,
        .value_a = event->line_coding_changed_data.p_line_coding->bit_rate,
    };
    enqueue_event(&message);
}

static uint32_t parse_sassi_type(void)
{
    if (frame_prefix_length < 5 || memcmp(frame_prefix, "KL*", 3) != 0) {
        return UINT32_MAX;
    }

    uint32_t type = 0;
    bool saw_digit = false;
    for (size_t index = 3; index < frame_prefix_length; index++) {
        char character = frame_prefix[index];
        if (character == '|') {
            return saw_digit ? type : UINT32_MAX;
        }
        if (character < '0' || character > '9') {
            return UINT32_MAX;
        }
        saw_digit = true;
        type = type * 10U + (uint32_t)(character - '0');
    }
    return UINT32_MAX;
}

static void finish_frame(void)
{
    if (frame_prefix_length >= 3 && memcmp(frame_prefix, "KL*", 3) == 0) {
        uint32_t type = parse_sassi_type();
        if (type == UINT32_MAX) {
            current_session.malformed_sassi_frames++;
        } else {
            current_session.sassi_frames++;
            current_session.last_sassi_type = type;
            current_session.last_frame_length = frame_length;
            if (frame_length > current_session.longest_frame_length) {
                current_session.longest_frame_length = frame_length;
            }
        }
    }

    frame_prefix_length = 0;
    frame_length = 0;
}

static bool finish_command(void)
{
    static const char diagnostic_command[] = "TAN_PROBE_DUMP";
    bool matches = command_length == sizeof(diagnostic_command) - 1 &&
                   memcmp(command_buffer, diagnostic_command,
                          sizeof(diagnostic_command) - 1) == 0;
    command_length = 0;
    return matches;
}

static bool observe_bytes(const uint8_t *bytes, size_t length)
{
    bool dump_requested = false;

    for (size_t index = 0; index < length; index++) {
        uint8_t byte = bytes[index];

        if (byte == '\r' || byte == '\n') {
            if (finish_command()) {
                dump_requested = true;
            }
        } else if (command_length < sizeof(command_buffer)) {
            command_buffer[command_length++] = (char)byte;
        } else {
            command_length = 0;
        }

        if (byte == '\r') {
            finish_frame();
        } else {
            if (frame_prefix_length < sizeof(frame_prefix)) {
                frame_prefix[frame_prefix_length++] = (char)byte;
            }
            if (frame_length != UINT32_MAX) {
                frame_length++;
            }
        }
    }

    return dump_requested;
}

static int format_session(char *output, size_t capacity,
                          const probe_session_t *session)
{
    return snprintf(
        output, capacity,
        "{\"boot\":%lu,\"attached\":%lu,\"detached\":%lu,"
        "\"lineStateChanges\":%lu,\"lineCodingChanges\":%lu,"
        "\"dtr\":%lu,\"rts\":%lu,\"bitRate\":%lu,"
        "\"rxCallbacks\":%lu,\"rxBytes\":%lu,\"droppedEvents\":%lu,"
        "\"sassiFrames\":%lu,\"malformedSassiFrames\":%lu,"
        "\"lastSassiType\":%lu,\"lastFrameLength\":%lu,"
        "\"longestFrameLength\":%lu}",
        (unsigned long)session->boot_number,
        (unsigned long)session->attached_count,
        (unsigned long)session->detached_count,
        (unsigned long)session->line_state_count,
        (unsigned long)session->line_coding_count,
        (unsigned long)session->dtr, (unsigned long)session->rts,
        (unsigned long)session->bit_rate,
        (unsigned long)session->rx_callbacks,
        (unsigned long)session->rx_bytes,
        (unsigned long)session->dropped_events,
        (unsigned long)session->sassi_frames,
        (unsigned long)session->malformed_sassi_frames,
        (unsigned long)session->last_sassi_type,
        (unsigned long)session->last_frame_length,
        (unsigned long)session->longest_frame_length);
}

static void send_diagnostic(void)
{
    char previous_json[512];
    char current_json[512];
    char response[1200];

    format_session(previous_json, sizeof(previous_json), &previous_session);
    format_session(current_json, sizeof(current_json), &current_session);
    int length = snprintf(
        response, sizeof(response),
        "{\"schemaVersion\":1,\"probe\":\"tan-usb-role\","
        "\"previousAvailable\":%s,\"previous\":%s,\"current\":%s}\n",
        previous_available ? "true" : "false", previous_json, current_json);

    if (length > 0 && (size_t)length < sizeof(response)) {
        tinyusb_cdcacm_write_queue(TINYUSB_CDC_ACM_0,
                                   (const uint8_t *)response, (size_t)length);
        tinyusb_cdcacm_write_flush(TINYUSB_CDC_ACM_0, pdMS_TO_TICKS(100));
    }
}

static void process_event(const app_event_t *event)
{
    bool dump_requested = false;
    bool persist_immediately = event->kind != APP_EVENT_RX;
    current_session.dropped_events =
        __atomic_load_n(&callback_drop_count, __ATOMIC_RELAXED);

    switch (event->kind) {
    case APP_EVENT_USB_ATTACHED:
        current_session.attached_count++;
        break;
    case APP_EVENT_USB_DETACHED:
        current_session.detached_count++;
        break;
    case APP_EVENT_LINE_STATE:
        current_session.line_state_count++;
        current_session.dtr = event->value_a;
        current_session.rts = event->value_b;
        break;
    case APP_EVENT_LINE_CODING:
        current_session.line_coding_count++;
        current_session.bit_rate = event->value_a;
        break;
    case APP_EVENT_RX:
        current_session.rx_callbacks++;
        current_session.rx_bytes += (uint32_t)event->length;
        dump_requested = observe_bytes(event->bytes, event->length);
        // Persist the initial proof, then stop writing flash for continuous
        // unsolicited traffic. This probe only needs to prove enumeration and
        // SASSI receipt; later counters remain available in the current boot.
        persist_immediately = current_session.rx_callbacks <= 16U ||
                              (current_session.sassi_frames > 0U &&
                               current_session.sassi_frames <= 4U);
        break;
    }

    if (persist_immediately) {
        store_session("current", &current_session);
    }
    // The sentinel line coding is set only by the Mac-side reader. Even if the
    // diagnostic token somehow appeared in roaster traffic, the probe remains
    // silent unless this separate local condition has also been established.
    if (dump_requested && current_session.dtr != 0U &&
        current_session.bit_rate == DIAGNOSTIC_BIT_RATE) {
        send_diagnostic();
    }
}

void app_main(void)
{
    esp_err_t nvs_result = nvs_flash_init();
    if (nvs_result == ESP_ERR_NVS_NO_FREE_PAGES ||
        nvs_result == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        nvs_result = nvs_flash_init();
    }
    ESP_ERROR_CHECK(nvs_result);
    ESP_ERROR_CHECK(nvs_open("tan_probe", NVS_READWRITE, &probe_nvs));
    initialize_sessions();

    event_queue = xQueueCreate(16, sizeof(app_event_t));
    if (event_queue == NULL) {
        abort();
    }

    tinyusb_config_t usb_config = TINYUSB_DEFAULT_CONFIG();
    usb_config.event_cb = usb_event_callback;
    ESP_ERROR_CHECK(tinyusb_driver_install(&usb_config));

    const tinyusb_config_cdcacm_t cdc_config = {
        .cdc_port = TINYUSB_CDC_ACM_0,
        .callback_rx = cdc_rx_callback,
        .callback_rx_wanted_char = NULL,
        .callback_line_state_changed = cdc_line_state_callback,
        .callback_line_coding_changed = cdc_line_coding_callback,
    };
    ESP_ERROR_CHECK(tinyusb_cdcacm_init(&cdc_config));

    app_event_t event;
    while (true) {
        if (xQueueReceive(event_queue, &event, portMAX_DELAY) == pdTRUE) {
            process_event(&event);
        }
    }
}
