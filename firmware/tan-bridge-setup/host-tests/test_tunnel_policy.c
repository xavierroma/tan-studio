#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "tunnel_policy.h"

static bool allowed(const char *frame)
{
    return tan_tunnel_allows_backend_frame((const uint8_t *)frame,
                                           strlen(frame));
}

int main(void)
{
    assert(allowed("KL*1|0|ece2\r"));
    assert(allowed("KL*3|1|0|0000\r"));
    assert(allowed("KL*5|2|/roast-1.klog||1|0000\r"));
    assert(allowed("KL*7|3|/roast-1.klog|0|0000\r"));
    assert(allowed("KL*13|4|0000\r"));

    assert(!allowed("KL*2|0|0000\r"));
    assert(!allowed("KL*9|0|0000\r"));
    assert(!allowed("KL1,0,00,0000\r"));
    assert(!allowed("KL*|0|0000\r"));
    assert(!allowed("KL*1|0|0000"));
    assert(!allowed("KL*1\n|0|0000\r"));
    assert(!allowed("KL*42949672960|0|0000\r"));
    assert(!tan_tunnel_allows_backend_frame(NULL, 0U));

    puts("tan bridge setup tunnel policy tests passed");
    return 0;
}
