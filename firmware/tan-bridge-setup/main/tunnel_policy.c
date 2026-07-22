#include "tunnel_policy.h"

#include <limits.h>

bool tan_tunnel_allows_backend_frame(const uint8_t *bytes, size_t length)
{
    if (bytes == NULL || length < 8U || bytes[0] != 'K' ||
        bytes[1] != 'L' || bytes[2] != '*' || bytes[length - 1U] != '\r') {
        return false;
    }
    for (size_t index = 0U; index + 1U < length; index++) {
        if (bytes[index] < 0x20U || bytes[index] > 0x7eU) {
            return false;
        }
    }

    uint32_t message_type = 0U;
    size_t index = 3U;
    bool has_digit = false;
    while (index + 1U < length && bytes[index] >= '0' && bytes[index] <= '9') {
        uint32_t digit = (uint32_t)(bytes[index] - '0');
        if (message_type > (UINT32_MAX - digit) / 10U) {
            return false;
        }
        has_digit = true;
        message_type = message_type * 10U + digit;
        index++;
    }
    if (!has_digit || index + 1U >= length || bytes[index] != '|') {
        return false;
    }
    return message_type == 1U || message_type == 3U ||
           message_type == 5U || message_type == 7U ||
           message_type == 13U;
}
