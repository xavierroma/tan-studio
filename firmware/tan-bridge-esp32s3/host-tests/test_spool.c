#include "test.h"

#include <string.h>

#include "tan_spool.h"

static const uint8_t boot_id[TAN_SPOOL_BOOT_ID_BYTES] = {
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
};

static void test_committed_records(void)
{
    uint8_t storage[512] = {0};
    tan_spool_t spool;
    tan_spool_format(&spool, storage, sizeof(storage));
    const uint8_t first[] = {1, 2, 3};
    const uint8_t second[] = {4, 5, 6, 7};
    TAN_ASSERT(tan_spool_append(&spool, boot_id, 10U, 100U, first,
                                sizeof(first)) == TAN_SPOOL_OK);
    TAN_ASSERT(tan_spool_append(&spool, boot_id, 11U, 200U, second,
                                sizeof(second)) == TAN_SPOOL_OK);
    TAN_ASSERT(spool.record_count == 2U);
    TAN_ASSERT(spool.low_sequence == 10U && spool.high_sequence == 11U);

    tan_spool_record_t record;
    uint8_t payload[4];
    TAN_ASSERT(tan_spool_read(&spool, 1U, &record, payload, sizeof(payload)));
    TAN_ASSERT(record.sequence == 11U && record.monotonic_ms == 200U);
    TAN_ASSERT(memcmp(payload, second, sizeof(second)) == 0);

    tan_spool_t recovered;
    TAN_ASSERT(tan_spool_recover(&recovered, storage, sizeof(storage),
                                 spool.used) == TAN_SPOOL_RECOVERY_CLEAN);
    TAN_ASSERT(recovered.record_count == 2U);
}

static void test_torn_and_power_loss(void)
{
    uint8_t storage[512] = {0};
    tan_spool_t spool;
    tan_spool_format(&spool, storage, sizeof(storage));
    const uint8_t payload[] = {9, 8, 7, 6};
    TAN_ASSERT(tan_spool_append(&spool, boot_id, 1U, 10U, payload,
                                sizeof(payload)) == TAN_SPOOL_OK);
    size_t committed_bytes = spool.used;
    TAN_ASSERT(tan_spool_append_with_budget(
                   &spool, boot_id, 2U, 20U, payload, sizeof(payload),
                   TAN_SPOOL_RECORD_HEADER_BYTES + 2U) == TAN_SPOOL_TORN);

    tan_spool_t recovered;
    TAN_ASSERT(tan_spool_recover(&recovered, storage, sizeof(storage),
                                 spool.used) ==
               TAN_SPOOL_RECOVERY_TORN_RECORD);
    TAN_ASSERT(recovered.record_count == 1U);
    TAN_ASSERT(recovered.used == committed_bytes);
    TAN_ASSERT(recovered.high_sequence == 1U);
}

static void test_corruption_capacity_and_gap(void)
{
    uint8_t storage[128] = {0};
    tan_spool_t spool;
    tan_spool_format(&spool, storage, sizeof(storage));
    const uint8_t payload[] = {1, 2, 3, 4};
    TAN_ASSERT(tan_spool_append(&spool, boot_id, 1U, 10U, payload,
                                sizeof(payload)) == TAN_SPOOL_OK);
    storage[TAN_SPOOL_RECORD_HEADER_BYTES] ^= 0xffU;
    tan_spool_t recovered;
    TAN_ASSERT(tan_spool_recover(&recovered, storage, sizeof(storage),
                                 spool.used) ==
               TAN_SPOOL_RECOVERY_CORRUPT_RECORD);
    TAN_ASSERT(recovered.record_count == 0U);
    TAN_ASSERT(recovered.retention_gap);

    uint8_t small[TAN_SPOOL_RECORD_HEADER_BYTES + TAN_SPOOL_COMMIT_BYTES + 3U];
    tan_spool_format(&spool, small, sizeof(small));
    TAN_ASSERT(tan_spool_append(&spool, boot_id, 1U, 1U, payload,
                                sizeof(payload)) == TAN_SPOOL_FULL);
    TAN_ASSERT(spool.retention_gap);
    TAN_ASSERT(tan_spool_append(&spool, boot_id, 1U, 1U, payload,
                                TAN_SPOOL_MAX_PAYLOAD_BYTES + 1U) ==
               TAN_SPOOL_INVALID);
}

void test_spool(void)
{
    static const uint8_t crc_fixture[] = "123456789";
    TAN_ASSERT(tan_spool_crc32(crc_fixture, sizeof(crc_fixture) - 1U) ==
               0xcbf43926U);
    test_committed_records();
    test_torn_and_power_loss();
    test_corruption_capacity_and_gap();
}
