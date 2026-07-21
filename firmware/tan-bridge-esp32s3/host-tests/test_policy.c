#include "test.h"

#include <string.h>

#include "tan_bridge_api.h"
#include "tan_identity.h"
#include "tan_update.h"
#include "tan_usb_device.h"
#include "tan_wifi.h"

void test_policy(void)
{
    TAN_ASSERT(!tan_usb_device_tx_compiled());
    TAN_ASSERT(!tan_usb_device_tx_enabled());
    TAN_ASSERT(!tan_wifi_is_compiled());
    TAN_ASSERT(!tan_wifi_is_enabled());
    TAN_ASSERT(!tan_bridge_api_is_compiled());
    TAN_ASSERT(!tan_bridge_api_is_enabled());
    TAN_ASSERT(!tan_identity_pairing_is_compiled());
    TAN_ASSERT(!tan_identity_pairing_window_is_open());
    TAN_ASSERT(!tan_update_is_compiled());
    TAN_ASSERT(!tan_update_is_enabled());

    size_t count = 0U;
    const tan_bridge_api_operation_t *operations =
        tan_bridge_api_operations(&count);
    TAN_ASSERT(count == 5U);
    TAN_ASSERT(strcmp(operations[0].operation_id, "getBridgeStatus") == 0);
    TAN_ASSERT(strcmp(operations[4].operation_id, "synchronizeBridge") == 0);
}
