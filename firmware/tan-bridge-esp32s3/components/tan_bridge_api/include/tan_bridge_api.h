#ifndef TAN_BRIDGE_API_H
#define TAN_BRIDGE_API_H

#include <stdbool.h>
#include <stddef.h>

typedef enum {
    TAN_BRIDGE_HTTP_GET,
    TAN_BRIDGE_HTTP_POST,
} tan_bridge_http_method_t;

typedef struct {
    tan_bridge_http_method_t method;
    const char *path;
    const char *operation_id;
} tan_bridge_api_operation_t;

bool tan_bridge_api_is_compiled(void);
bool tan_bridge_api_is_enabled(void);
const tan_bridge_api_operation_t *tan_bridge_api_operations(size_t *count);

#endif
