#include "tan_usb_device.h"

#include "tan_build_config.h"

bool tan_usb_device_tx_compiled(void)
{
    return TAN_BRIDGE_SASSI_TX_ENABLED != 0;
}

bool tan_usb_device_tx_enabled(void)
{
    return false;
}
