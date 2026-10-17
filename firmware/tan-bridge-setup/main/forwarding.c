#include "forwarding.h"
#include <string.h>

static void discard(tan_forwarder_t *f) {
    f->stats.discarded += f->length;
    f->head = f->length = 0;
}
void tan_forward_fail(tan_forwarder_t *f) {
    if (!f->failed) f->stats.failures++;
    f->failed = true;
    discard(f);
}
bool tan_forward_push(tan_forwarder_t *f, const uint8_t *data, size_t length) {
    if (!data && length) { tan_forward_fail(f); return false; }
    f->stats.received += length;
    for (size_t i = 0; i < length && f->peer == TAN_PEER_UNKNOWN; i++) {
        if (data[i] == '{') f->peer = TAN_PEER_SETUP;
        else if (data[i] == (uint8_t)"KL*"[f->prefix]) {
            if (++f->prefix == 3) f->peer = TAN_PEER_NANO;
        } else f->prefix = data[i] == 'K' ? 1U : 0U;
    }
    if ((f->failed || f->recovering) && f->peer != TAN_PEER_SETUP) {
        f->stats.discarded += length;
        return false;
    }
    if (length > TAN_FORWARD_CAPACITY - f->length) {
        f->stats.overflows++;
        tan_forward_fail(f);
        f->stats.discarded += length;
        return false;
    }
    size_t tail = (f->head + f->length) % TAN_FORWARD_CAPACITY;
    size_t first = length < TAN_FORWARD_CAPACITY - tail ? length : TAN_FORWARD_CAPACITY - tail;
    if (first) memcpy(f->bytes + tail, data, first);
    if (length > first) memcpy(f->bytes, data + first, length - first);
    f->length += length;
    if (f->length > f->stats.high_water) f->stats.high_water = f->length;
    return true;
}
size_t tan_forward_pop(tan_forwarder_t *f, uint8_t *out, size_t capacity, uint32_t *generation) {
    *generation = f->generation;
    if ((f->failed || f->recovering) && f->peer != TAN_PEER_SETUP) return 0;
    size_t n = capacity < f->length ? capacity : f->length;
    size_t first = n < TAN_FORWARD_CAPACITY - f->head ? n : TAN_FORWARD_CAPACITY - f->head;
    if (first) memcpy(out, f->bytes + f->head, first);
    if (n > first) memcpy(out + first, f->bytes, n - first);
    f->head = (f->head + n) % TAN_FORWARD_CAPACITY;
    f->length -= n;
    return n;
}
bool tan_forward_begin(tan_forwarder_t *f) {
    f->generation++;
    f->failed = false;
    f->recovering = f->peer == TAN_PEER_NANO;
    if (f->recovering) { discard(f); f->stats.recoveries++; }
    return f->recovering;
}
void tan_forward_recovered(tan_forwarder_t *f) { discard(f); f->recovering = false; }
bool tan_forward_current(const tan_forwarder_t *f, uint32_t generation) {
    return !f->failed && !f->recovering && f->generation == generation;
}
tan_ws_result_t tan_ws_feed(tan_ws_message_t *m, uint8_t opcode, bool fin,
                            size_t total, size_t offset,
                            const uint8_t *bytes, size_t length) {
    if ((!bytes && length) || total > TAN_WS_CAPACITY ||
        offset > total || length > total - offset) return TAN_WS_ERROR;
    if (!offset) {
        if (m->frame_active) return TAN_WS_ERROR;
        if (opcode == 1 || opcode == 2) {
            if (m->message_active || m->length) return TAN_WS_ERROR;
            m->opcode = opcode;
            m->message_active = true;
        } else if (opcode != 0 || !m->message_active) return TAN_WS_ERROR;
        if (total > TAN_WS_CAPACITY - m->length) return TAN_WS_ERROR;
        m->frame_length = total;
        m->frame_received = 0;
        m->frame_opcode = opcode;
        m->frame_fin = fin;
        m->frame_active = true;
    }
    if (!m->frame_active || m->frame_length != total ||
        m->frame_received != offset || m->frame_opcode != opcode ||
        m->frame_fin != fin) return TAN_WS_ERROR;
    if (length) memcpy(m->bytes + m->length, bytes, length);
    m->length += length;
    m->frame_received += length;
    if (m->frame_received != total) return TAN_WS_MORE;
    m->frame_active = false;
    if (!fin) return TAN_WS_MORE;
    m->message_active = false;
    m->bytes[m->length] = 0;
    return TAN_WS_READY;
}
