#include "tan_bridge_api.h"

#include "tan_build_config.h"

static const tan_bridge_api_operation_t operations[] = {
    {TAN_BRIDGE_HTTP_GET, "/bridge/v1/status", "getBridgeStatus"},
    {TAN_BRIDGE_HTTP_GET, "/bridge/v1/files", "listBridgeFiles"},
    {TAN_BRIDGE_HTTP_GET, "/bridge/v1/files/{hash}", "downloadBridgeFile"},
    {TAN_BRIDGE_HTTP_GET, "/bridge/v1/events", "observeBridgeEvents"},
    {TAN_BRIDGE_HTTP_POST, "/bridge/v1/synchronize", "synchronizeBridge"},
};

bool tan_bridge_api_is_compiled(void)
{
    return TAN_BRIDGE_API_ENABLED != 0;
}

bool tan_bridge_api_is_enabled(void)
{
    return false;
}

const tan_bridge_api_operation_t *tan_bridge_api_operations(size_t *count)
{
    if (count != NULL) {
        *count = sizeof(operations) / sizeof(operations[0]);
    }
    return operations;
}
