#include "tan_wifi.h"

#include "tan_build_config.h"

bool tan_wifi_is_compiled(void)
{
    return TAN_BRIDGE_WIFI_ENABLED != 0;
}

bool tan_wifi_is_enabled(void)
{
    return false;
}
