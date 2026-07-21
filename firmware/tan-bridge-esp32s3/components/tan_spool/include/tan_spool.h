#ifndef TAN_SPOOL_H
#define TAN_SPOOL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define TAN_SPOOL_RECORD_VERSION 1U
#define TAN_SPOOL_BOOT_ID_BYTES 16U
#define TAN_SPOOL_MAX_PAYLOAD_BYTES 4064U
#define TAN_SPOOL_RECORD_HEADER_BYTES 52U
#define TAN_SPOOL_COMMIT_BYTES 4U

typedef enum {
    TAN_SPOOL_OK,
    TAN_SPOOL_FULL,
    TAN_SPOOL_INVALID,
    TAN_SPOOL_TORN,
} tan_spool_result_t;

typedef enum {
    TAN_SPOOL_RECOVERY_CLEAN,
    TAN_SPOOL_RECOVERY_TORN_RECORD,
    TAN_SPOOL_RECOVERY_CORRUPT_RECORD,
} tan_spool_recovery_t;

typedef struct {
    uint8_t boot_id[TAN_SPOOL_BOOT_ID_BYTES];
    uint64_t sequence;
    uint64_t monotonic_ms;
    uint32_t payload_length;
    uint32_t payload_crc;
} tan_spool_record_t;

typedef struct {
    uint8_t *storage;
    size_t capacity;
    size_t used;
    size_t record_count;
    uint64_t low_sequence;
    uint64_t high_sequence;
    bool retention_gap;
    tan_spool_recovery_t recovery;
} tan_spool_t;

void tan_spool_format(tan_spool_t *spool, uint8_t *storage, size_t capacity);
tan_spool_recovery_t tan_spool_recover(tan_spool_t *spool, uint8_t *storage,
                                       size_t capacity, size_t bytes_present);
tan_spool_result_t tan_spool_append(tan_spool_t *spool,
                                    const uint8_t boot_id[TAN_SPOOL_BOOT_ID_BYTES],
                                    uint64_t sequence, uint64_t monotonic_ms,
                                    const uint8_t *payload,
                                    uint32_t payload_length);
tan_spool_result_t tan_spool_append_with_budget(
    tan_spool_t *spool,
    const uint8_t boot_id[TAN_SPOOL_BOOT_ID_BYTES], uint64_t sequence,
    uint64_t monotonic_ms, const uint8_t *payload, uint32_t payload_length,
    size_t write_budget);
bool tan_spool_read(const tan_spool_t *spool, size_t record_index,
                    tan_spool_record_t *record, uint8_t *payload,
                    size_t payload_capacity);
uint32_t tan_spool_crc32(const uint8_t *bytes, size_t length);

#endif
