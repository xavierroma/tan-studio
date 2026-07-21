#ifndef TAN_USB_DEVICE_H
#define TAN_USB_DEVICE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

#define TAN_USB_DEVICE_RX_CHUNK_BYTES 512U

typedef enum {
    TAN_USB_DEVICE_EVENT_ATTACHED,
    TAN_USB_DEVICE_EVENT_DETACHED,
    TAN_USB_DEVICE_EVENT_ENUMERATED,
    TAN_USB_DEVICE_EVENT_RX,
    TAN_USB_DEVICE_EVENT_QUEUE_SATURATED,
} tan_usb_device_event_kind_t;

typedef struct {
    tan_usb_device_event_kind_t kind;
    size_t length;
    uint8_t bytes[TAN_USB_DEVICE_RX_CHUNK_BYTES];
} tan_usb_device_event_t;

esp_err_t tan_usb_device_init(void);
bool tan_usb_device_next(tan_usb_device_event_t *event, uint32_t timeout_ms);

/* There is intentionally no transmit function in this interface. */
bool tan_usb_device_tx_compiled(void);
bool tan_usb_device_tx_enabled(void);

#endif
