#include "tan_usb_device.h"

#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "tinyusb.h"
#include "tinyusb_cdc_acm.h"
#include "tinyusb_default_config.h"

#define TAN_USB_DEVICE_QUEUE_LENGTH 8U

static QueueHandle_t event_queue;
static volatile bool queue_saturated;

static void enqueue(const tan_usb_device_event_t *event)
{
    if (xQueueSend(event_queue, event, 0) != pdTRUE) {
        __atomic_store_n(&queue_saturated, true, __ATOMIC_RELAXED);
    }
}

static void usb_event_callback(tinyusb_event_t *event, void *argument)
{
    (void)argument;
    tan_usb_device_event_t message = {0};

    if (event->id == TINYUSB_EVENT_ATTACHED) {
        message.kind = TAN_USB_DEVICE_EVENT_ATTACHED;
        enqueue(&message);
    } else if (event->id == TINYUSB_EVENT_DETACHED) {
        message.kind = TAN_USB_DEVICE_EVENT_DETACHED;
        enqueue(&message);
    }
}

static void cdc_rx_callback(int interface, cdcacm_event_t *event)
{
    (void)event;
    tan_usb_device_event_t message = {.kind = TAN_USB_DEVICE_EVENT_RX};
    if (tinyusb_cdcacm_read(interface, message.bytes, sizeof(message.bytes),
                            &message.length) == ESP_OK &&
        message.length != 0U) {
        enqueue(&message);
    }
}

static void cdc_line_state_callback(int interface, cdcacm_event_t *event)
{
    (void)interface;
    if (event->line_state_changed_data.dtr ||
        event->line_state_changed_data.rts) {
        tan_usb_device_event_t message = {
            .kind = TAN_USB_DEVICE_EVENT_ENUMERATED,
        };
        enqueue(&message);
    }
}

esp_err_t tan_usb_device_init(void)
{
    event_queue = xQueueCreate(TAN_USB_DEVICE_QUEUE_LENGTH,
                               sizeof(tan_usb_device_event_t));
    if (event_queue == NULL) {
        return ESP_ERR_NO_MEM;
    }

    tinyusb_config_t usb_config = TINYUSB_DEFAULT_CONFIG();
    usb_config.event_cb = usb_event_callback;
    esp_err_t result = tinyusb_driver_install(&usb_config);
    if (result != ESP_OK) {
        return result;
    }

    const tinyusb_config_cdcacm_t cdc_config = {
        .cdc_port = TINYUSB_CDC_ACM_0,
        .callback_rx = cdc_rx_callback,
        .callback_rx_wanted_char = NULL,
        .callback_line_state_changed = cdc_line_state_callback,
        .callback_line_coding_changed = NULL,
    };
    return tinyusb_cdcacm_init(&cdc_config);
}

bool tan_usb_device_next(tan_usb_device_event_t *event, uint32_t timeout_ms)
{
    if (event == NULL || event_queue == NULL) {
        return false;
    }
    if (__atomic_exchange_n(&queue_saturated, false, __ATOMIC_RELAXED)) {
        *event = (tan_usb_device_event_t){
            .kind = TAN_USB_DEVICE_EVENT_QUEUE_SATURATED,
        };
        return true;
    }
    return xQueueReceive(event_queue, event, pdMS_TO_TICKS(timeout_ms)) == pdTRUE;
}
