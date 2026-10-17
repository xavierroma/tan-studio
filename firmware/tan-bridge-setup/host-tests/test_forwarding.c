#include "forwarding.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static tan_forwarder_t f;
static uint8_t corpus[200000], output[sizeof(corpus)];

static void fragmented_stream(void) {
    /* Many wraps and arbitrary USB/TLS chunk boundaries, including single
     * bytes and consumer stalls. Actual firmware buffering implementation. */
    for (unsigned seed = 1; seed <= 80; seed++) {
        memset(&f, 0, sizeof(f));
        size_t sent = 0, received = 0;
        unsigned random = seed;
        while (received < sizeof(corpus)) {
            random = random * 1664525U + 1013904223U;
            size_t n = 1 + random % 512;
            if (n > sizeof(corpus) - sent) n = sizeof(corpus) - sent;
            if (n && n <= TAN_FORWARD_CAPACITY - f.length) {
                assert(tan_forward_push(&f, corpus + sent, n)); sent += n;
            }
            if (random % 4 == 0 || f.length > TAN_FORWARD_CAPACITY - 512 || sent == sizeof(corpus)) {
                size_t cap = 1 + (random >> 10) % 1536;
                if (cap > sizeof(output) - received) cap = sizeof(output) - received;
                uint32_t generation;
                received += tan_forward_pop(&f, output + received, cap, &generation);
                assert(tan_forward_current(&f, generation));
            }
        }
        assert(!memcmp(corpus, output, sizeof(corpus)));
        assert(f.stats.received == sizeof(corpus));
        assert(!f.stats.failures && !f.stats.discarded);
    }
}

static void overflow_and_reconnect(void) {
    memset(&f, 0, sizeof(f));
    assert(tan_forward_push(&f, (const uint8_t *)"KL", 2));
    assert(tan_forward_push(&f, (const uint8_t *)"*2|", 3));
    assert(f.peer == TAN_PEER_NANO);
    assert(tan_forward_begin(&f));
    assert(f.recovering && f.length == 0);
    assert(!tan_forward_push(&f, corpus, 512));
    tan_forward_recovered(&f);
    assert(tan_forward_push(&f, corpus, TAN_FORWARD_CAPACITY));
    assert(!tan_forward_push(&f, corpus, 1));
    assert(f.failed && f.length == 0 && f.stats.overflows == 1);
    uint32_t generation;
    assert(tan_forward_pop(&f, output, sizeof(output), &generation) == 0);
    assert(!tan_forward_current(&f, generation));
    assert(tan_forward_begin(&f));
    assert(!tan_forward_current(&f, generation));
    tan_forward_recovered(&f);
    assert(tan_forward_push(&f, corpus, 4064));
    assert(tan_forward_pop(&f, output, sizeof(output), &generation) == 4064);
    assert(!memcmp(corpus, output, 4064));
    assert(tan_forward_current(&f, generation));
    /* Thousands of disconnects: no heap allocation, queue growth or stale data. */
    for (unsigned i = 0; i < 10000; i++) {
        tan_forward_fail(&f);
        assert(tan_forward_begin(&f));
        tan_forward_recovered(&f);
        assert(f.length == 0);
    }
}

static void setup_survives_network_failure(void) {
    memset(&f, 0, sizeof(f));
    const uint8_t json[] = "{\"type\":\"setup.getStatus\"}\n";
    assert(tan_forward_push(&f, json, sizeof(json)));
    assert(f.peer == TAN_PEER_SETUP);
    assert(!tan_forward_begin(&f));
    tan_forward_fail(&f);
    assert(tan_forward_push(&f, json, sizeof(json)));
    uint32_t generation;
    assert(tan_forward_pop(&f, output, sizeof(output), &generation) == sizeof(json));
    assert(!memcmp(json, output, sizeof(json)));
    assert(!tan_forward_begin(&f));
}

static tan_ws_message_t message;
static void websocket_fragments(void) {
    for (size_t total = 1; total <= TAN_WS_CAPACITY; total += 17) {
        for (size_t chunk = 1; chunk <= 2048; chunk *= 2) {
            memset(&message, 0, sizeof(message));
            size_t received = 0;
            while (received < total) {
                size_t n = total - received < chunk ? total - received : chunk;
                tan_ws_result_t result = tan_ws_feed(&message, 2, true, total,
                                                      received, corpus+received, n);
                received += n;
                assert(result == (received == total ? TAN_WS_READY : TAN_WS_MORE));
            }
            assert(message.length == total && !memcmp(message.bytes, corpus, total));
        }
    }
    /* RFC fragments, each delivered in smaller SDK chunks, form one message. */
    for (size_t split = 1; split < 4064; split += 13) {
        memset(&message, 0, sizeof(message));
        assert(tan_ws_feed(&message,2,false,split,0,corpus,split) == TAN_WS_MORE);
        size_t n = 4064-split;
        assert(tan_ws_feed(&message,0,true,n,0,corpus+split,n) == TAN_WS_READY);
        assert(message.length == 4064 && !memcmp(message.bytes,corpus,4064));
    }
    memset(&message,0,sizeof(message));
    assert(tan_ws_feed(&message,0,true,1,0,corpus,1)==TAN_WS_ERROR);
    assert(tan_ws_feed(&message,2,true,20,0,corpus,5)==TAN_WS_MORE);
    assert(tan_ws_feed(&message,2,true,20,6,corpus,1)==TAN_WS_ERROR);
    assert(tan_ws_feed(&message,2,true,20,4,corpus,1)==TAN_WS_ERROR);
    assert(tan_ws_feed(&message,2,true,20,5,corpus,16)==TAN_WS_ERROR);
    assert(tan_ws_feed(&message,2,true,20,0,corpus,5)==TAN_WS_ERROR);
    memset(&message,0,sizeof(message));
    assert(tan_ws_feed(&message,2,false,TAN_WS_CAPACITY,0,corpus,TAN_WS_CAPACITY)==TAN_WS_MORE);
    assert(tan_ws_feed(&message,0,true,1,0,corpus,1)==TAN_WS_ERROR);
    /* Empty final continuation is legal; truncated data is never exposed. */
    memset(&message,0,sizeof(message));
    assert(tan_ws_feed(&message,2,false,12,0,corpus,12)==TAN_WS_MORE);
    assert(tan_ws_feed(&message,0,true,0,0,NULL,0)==TAN_WS_READY);
    assert(message.length==12 && !memcmp(message.bytes,corpus,12));
}

int main(void) {
    for (size_t i = 0; i < sizeof(corpus); i++) corpus[i] = (uint8_t)(i * 31U + i / 251U);
    fragmented_stream(); overflow_and_reconnect();
    setup_survives_network_failure(); websocket_fragments();
    puts("forwarding: 16 MB byte-exact fragmented/stalled streams, saturation, setup isolation, 10000 reconnects and WebSocket boundaries passed");
    return 0;
}
