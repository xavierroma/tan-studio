#include "tan_identity.h"

#include "tan_build_config.h"

bool tan_identity_pairing_is_compiled(void)
{
    return TAN_BRIDGE_PAIRING_ENABLED != 0;
}

bool tan_identity_pairing_window_is_open(void)
{
    return false;
}
