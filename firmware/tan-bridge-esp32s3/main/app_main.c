#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>

#include "esp_err.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "tan_board.h"
#include "tan_bridge_api.h"
#include "tan_identity.h"
#include "tan_roaster_session.h"
#include "tan_sassi.h"
#include "tan_update.h"
#include "tan_usb_device.h"
#include "tan_wifi.h"

static uint64_t monotonic_ms(void *context)
{
    (void)context;
    return (uint64_t)(esp_timer_get_time() / 1000);
}

static void post_and_process(tan_roaster_session_t *session,
                             tan_roaster_session_event_t event)
{
    if (!tan_roaster_session_post(session, event)) {
        return;
    }
    (void)tan_roaster_session_process_next(session);
}

static void observe_usb_bytes(tan_roaster_session_t *session,
                              tan_sassi_decoder_t *decoder,
                              const uint8_t *bytes, size_t length)
{
    for (size_t index = 0; index < length; index++) {
        tan_sassi_event_t decoded = tan_sassi_decoder_push(decoder, bytes[index]);
        if (decoded.kind == TAN_SASSI_EVENT_FRAME) {
            post_and_process(session, (tan_roaster_session_event_t){
                                          .kind = TAN_ROASTER_EVENT_FRAME,
                                          .frame = decoded.frame,
                                      });
        } else if (decoded.kind != TAN_SASSI_EVENT_NONE) {
            post_and_process(session, (tan_roaster_session_event_t){
                                          .kind = TAN_ROASTER_EVENT_PROTOCOL_ERROR,
                                      });
        }
    }
}

static void require_receive_only_policy(void)
{
    if (tan_usb_device_tx_compiled() || tan_usb_device_tx_enabled() ||
        tan_wifi_is_compiled() || tan_wifi_is_enabled() ||
        tan_bridge_api_is_compiled() || tan_bridge_api_is_enabled() ||
        tan_identity_pairing_is_compiled() ||
        tan_identity_pairing_window_is_open() || tan_update_is_compiled() ||
        tan_update_is_enabled()) {
        abort();
    }
}

void app_main(void)
{
    ESP_ERROR_CHECK(tan_board_init());
    require_receive_only_policy();

    tan_sassi_decoder_t decoder;
    tan_sassi_decoder_init(&decoder);

    tan_roaster_session_t session;
    tan_roaster_session_init(
        &session, (tan_monotonic_clock_t){.now = monotonic_ms});
    tan_roaster_session_start(&session);

    ESP_ERROR_CHECK(tan_usb_device_init());
    tan_usb_device_event_t usb_event;
    while (true) {
        if (tan_usb_device_next(&usb_event, 20U)) {
            switch (usb_event.kind) {
            case TAN_USB_DEVICE_EVENT_ATTACHED:
                post_and_process(&session, (tan_roaster_session_event_t){
                                               .kind = TAN_ROASTER_EVENT_USB_ATTACHED,
                                           });
                break;
            case TAN_USB_DEVICE_EVENT_ENUMERATED:
                post_and_process(&session, (tan_roaster_session_event_t){
                                               .kind = TAN_ROASTER_EVENT_USB_ENUMERATED,
                                           });
                break;
            case TAN_USB_DEVICE_EVENT_DETACHED:
                tan_sassi_decoder_reset(&decoder);
                post_and_process(&session, (tan_roaster_session_event_t){
                                               .kind = TAN_ROASTER_EVENT_USB_DETACHED,
                                           });
                break;
            case TAN_USB_DEVICE_EVENT_RX:
                observe_usb_bytes(&session, &decoder, usb_event.bytes,
                                  usb_event.length);
                break;
            case TAN_USB_DEVICE_EVENT_QUEUE_SATURATED:
                post_and_process(&session, (tan_roaster_session_event_t){
                                               .kind = TAN_ROASTER_EVENT_PROTOCOL_ERROR,
                                           });
                break;
            }
        }
        tan_roaster_session_tick(&session);
        vTaskDelay(pdMS_TO_TICKS(1));
    }
}
