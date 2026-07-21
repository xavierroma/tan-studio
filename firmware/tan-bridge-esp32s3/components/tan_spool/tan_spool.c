#include "tan_spool.h"

#include <limits.h>
#include <string.h>

#define TAN_SPOOL_MAGIC 0x54414e53U
#define TAN_SPOOL_COMMIT_MARKER 0x54414e43U

static void write_u16(uint8_t *bytes, uint16_t value)
{
    bytes[0] = (uint8_t)value;
    bytes[1] = (uint8_t)(value >> 8U);
}

static void write_u32(uint8_t *bytes, uint32_t value)
{
    for (uint8_t index = 0; index < 4U; index++) {
        bytes[index] = (uint8_t)(value >> (index * 8U));
    }
}

static void write_u64(uint8_t *bytes, uint64_t value)
{
    for (uint8_t index = 0; index < 8U; index++) {
        bytes[index] = (uint8_t)(value >> (index * 8U));
    }
}

static uint16_t read_u16(const uint8_t *bytes)
{
    return (uint16_t)bytes[0] | (uint16_t)bytes[1] << 8U;
}

static uint32_t read_u32(const uint8_t *bytes)
{
    uint32_t value = 0U;
    for (uint8_t index = 0; index < 4U; index++) {
        value |= (uint32_t)bytes[index] << (index * 8U);
    }
    return value;
}

static uint64_t read_u64(const uint8_t *bytes)
{
    uint64_t value = 0U;
    for (uint8_t index = 0; index < 8U; index++) {
        value |= (uint64_t)bytes[index] << (index * 8U);
    }
    return value;
}

uint32_t tan_spool_crc32(const uint8_t *bytes, size_t length)
{
    uint32_t crc = UINT32_MAX;
    for (size_t index = 0; index < length; index++) {
        crc ^= bytes[index];
        for (uint8_t bit = 0; bit < 8U; bit++) {
            uint32_t mask = (uint32_t)-(int32_t)(crc & 1U);
            crc = (crc >> 1U) ^ (0xedb88320U & mask);
        }
    }
    return crc ^ UINT32_MAX;
}

static void encode_header(uint8_t header[TAN_SPOOL_RECORD_HEADER_BYTES],
                          const uint8_t boot_id[TAN_SPOOL_BOOT_ID_BYTES],
                          uint64_t sequence, uint64_t monotonic_ms,
                          const uint8_t *payload, uint32_t payload_length)
{
    memset(header, 0, TAN_SPOOL_RECORD_HEADER_BYTES);
    write_u32(&header[0], TAN_SPOOL_MAGIC);
    write_u16(&header[4], TAN_SPOOL_RECORD_VERSION);
    write_u16(&header[6], TAN_SPOOL_RECORD_HEADER_BYTES);
    memcpy(&header[8], boot_id, TAN_SPOOL_BOOT_ID_BYTES);
    write_u64(&header[24], sequence);
    write_u64(&header[32], monotonic_ms);
    write_u32(&header[40], payload_length);
    write_u32(&header[44], tan_spool_crc32(payload, payload_length));
    write_u32(&header[48], tan_spool_crc32(header, 48U));
}

static bool decode_header(const uint8_t *header, tan_spool_record_t *record)
{
    if (read_u32(&header[0]) != TAN_SPOOL_MAGIC ||
        read_u16(&header[4]) != TAN_SPOOL_RECORD_VERSION ||
        read_u16(&header[6]) != TAN_SPOOL_RECORD_HEADER_BYTES ||
        read_u32(&header[48]) != tan_spool_crc32(header, 48U)) {
        return false;
    }
    memcpy(record->boot_id, &header[8], TAN_SPOOL_BOOT_ID_BYTES);
    record->sequence = read_u64(&header[24]);
    record->monotonic_ms = read_u64(&header[32]);
    record->payload_length = read_u32(&header[40]);
    record->payload_crc = read_u32(&header[44]);
    return record->payload_length <= TAN_SPOOL_MAX_PAYLOAD_BYTES;
}

void tan_spool_format(tan_spool_t *spool, uint8_t *storage, size_t capacity)
{
    *spool = (tan_spool_t){
        .storage = storage,
        .capacity = capacity,
        .recovery = TAN_SPOOL_RECOVERY_CLEAN,
    };
}

static size_t record_bytes(uint32_t payload_length)
{
    return TAN_SPOOL_RECORD_HEADER_BYTES + (size_t)payload_length +
           TAN_SPOOL_COMMIT_BYTES;
}

tan_spool_recovery_t tan_spool_recover(tan_spool_t *spool, uint8_t *storage,
                                       size_t capacity, size_t bytes_present)
{
    tan_spool_format(spool, storage, capacity);
    if (bytes_present > capacity) {
        spool->recovery = TAN_SPOOL_RECOVERY_CORRUPT_RECORD;
        spool->retention_gap = true;
        return spool->recovery;
    }

    size_t offset = 0U;
    while (offset < bytes_present) {
        if (bytes_present - offset <
            TAN_SPOOL_RECORD_HEADER_BYTES + TAN_SPOOL_COMMIT_BYTES) {
            spool->recovery = TAN_SPOOL_RECOVERY_TORN_RECORD;
            break;
        }
        tan_spool_record_t record;
        if (!decode_header(&storage[offset], &record)) {
            spool->recovery = TAN_SPOOL_RECOVERY_CORRUPT_RECORD;
            spool->retention_gap = true;
            break;
        }
        size_t total = record_bytes(record.payload_length);
        if (total > bytes_present - offset) {
            spool->recovery = TAN_SPOOL_RECOVERY_TORN_RECORD;
            break;
        }
        const uint8_t *payload = &storage[offset + TAN_SPOOL_RECORD_HEADER_BYTES];
        uint32_t commit = read_u32(&storage[offset + total - TAN_SPOOL_COMMIT_BYTES]);
        if (commit != TAN_SPOOL_COMMIT_MARKER) {
            spool->recovery = TAN_SPOOL_RECOVERY_TORN_RECORD;
            break;
        }
        if (tan_spool_crc32(payload, record.payload_length) !=
                record.payload_crc ||
            (spool->record_count != 0U &&
             record.sequence <= spool->high_sequence)) {
            spool->recovery = TAN_SPOOL_RECOVERY_CORRUPT_RECORD;
            spool->retention_gap = true;
            break;
        }
        if (spool->record_count == 0U) {
            spool->low_sequence = record.sequence;
        }
        spool->high_sequence = record.sequence;
        spool->record_count++;
        offset += total;
    }
    spool->used = offset;
    return spool->recovery;
}

tan_spool_result_t tan_spool_append_with_budget(
    tan_spool_t *spool,
    const uint8_t boot_id[TAN_SPOOL_BOOT_ID_BYTES], uint64_t sequence,
    uint64_t monotonic_ms, const uint8_t *payload, uint32_t payload_length,
    size_t write_budget)
{
    if (spool == NULL || spool->storage == NULL || boot_id == NULL ||
        (payload == NULL && payload_length != 0U) ||
        payload_length > TAN_SPOOL_MAX_PAYLOAD_BYTES ||
        (spool->record_count != 0U && sequence <= spool->high_sequence)) {
        return TAN_SPOOL_INVALID;
    }

    size_t total = record_bytes(payload_length);
    if (total > spool->capacity - spool->used) {
        spool->retention_gap = true;
        return TAN_SPOOL_FULL;
    }

    uint8_t header[TAN_SPOOL_RECORD_HEADER_BYTES];
    uint8_t commit[TAN_SPOOL_COMMIT_BYTES];
    encode_header(header, boot_id, sequence, monotonic_ms, payload,
                  payload_length);
    write_u32(commit, TAN_SPOOL_COMMIT_MARKER);

    size_t permitted = write_budget < total ? write_budget : total;
    size_t written = 0U;
    size_t header_bytes = permitted < sizeof(header) ? permitted : sizeof(header);
    memcpy(&spool->storage[spool->used], header, header_bytes);
    written += header_bytes;
    if (written < permitted) {
        size_t remaining = permitted - written;
        size_t payload_bytes = remaining < payload_length ? remaining : payload_length;
        if (payload_bytes != 0U) {
            memcpy(&spool->storage[spool->used + written], payload,
                   payload_bytes);
        }
        written += payload_bytes;
    }
    if (written < permitted) {
        size_t commit_bytes = permitted - written;
        memcpy(&spool->storage[spool->used + written], commit, commit_bytes);
        written += commit_bytes;
    }
    spool->used += written;

    if (written != total) {
        return TAN_SPOOL_TORN;
    }
    if (spool->record_count == 0U) {
        spool->low_sequence = sequence;
    }
    spool->high_sequence = sequence;
    spool->record_count++;
    return TAN_SPOOL_OK;
}

tan_spool_result_t tan_spool_append(tan_spool_t *spool,
                                    const uint8_t boot_id[TAN_SPOOL_BOOT_ID_BYTES],
                                    uint64_t sequence, uint64_t monotonic_ms,
                                    const uint8_t *payload,
                                    uint32_t payload_length)
{
    return tan_spool_append_with_budget(spool, boot_id, sequence, monotonic_ms,
                                        payload, payload_length, SIZE_MAX);
}

bool tan_spool_read(const tan_spool_t *spool, size_t record_index,
                    tan_spool_record_t *record, uint8_t *payload,
                    size_t payload_capacity)
{
    if (spool == NULL || record == NULL || record_index >= spool->record_count) {
        return false;
    }
    size_t offset = 0U;
    for (size_t index = 0; index <= record_index; index++) {
        if (!decode_header(&spool->storage[offset], record)) {
            return false;
        }
        if (index == record_index) {
            if (record->payload_length > payload_capacity ||
                (payload == NULL && record->payload_length != 0U)) {
                return false;
            }
            if (record->payload_length != 0U) {
                memcpy(payload,
                       &spool->storage[offset + TAN_SPOOL_RECORD_HEADER_BYTES],
                       record->payload_length);
            }
            return true;
        }
        offset += record_bytes(record->payload_length);
    }
    return false;
}
