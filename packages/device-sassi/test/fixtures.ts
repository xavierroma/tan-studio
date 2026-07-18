/**
 * Synthetic, privacy-safe type-2 frames matching the verified Nano 7 shape.
 * The serial is invented and each CRC was recomputed from its synthetic body.
 */
export const TYPE_2_FIXTURE_A =
  "KL*2|00A1F2|1|128|TS00000001|1|KN1007B|kaffelogic.com||4064|192|1A2B|61F7\r"

export const TYPE_2_FIXTURE_B =
  "KL*2|00A331|1|128|TS00000001|1|KN1007B|kaffelogic.com||4064|192|BEEF|8CA9\r"

export const textBytes = (value: string): Uint8Array =>
  new TextEncoder().encode(value)
