#include "tan_update.h"

#include "tan_build_config.h"

bool tan_update_is_compiled(void)
{
    return TAN_BRIDGE_OTA_ENABLED != 0;
}

bool tan_update_is_enabled(void)
{
    return false;
}
