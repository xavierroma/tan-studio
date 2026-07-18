/**
 * Seeded CRC-16/CCITT-XMODEM used by SASSI.
 *
 * Parameters: polynomial 0x1021, MSB first, no reflection and no final XOR.
 */
export function crc16CcittXmodem(input: Uint8Array, initialValue = 0): number {
  assertUint16(initialValue, "initialValue")

  let crc = initialValue
  for (const byte of input) {
    crc ^= byte << 8
    for (let bit = 0; bit < 8; bit += 1) {
      crc =
        (crc & 0x8000) === 0
          ? (crc << 1) & 0xffff
          : ((crc << 1) ^ 0x1021) & 0xffff
    }
  }

  return crc
}

export function formatCrc16(value: number): string {
  assertUint16(value, "value")
  return value.toString(16).toUpperCase().padStart(4, "0")
}

function assertUint16(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError(`${name} must be an unsigned 16-bit integer`)
  }
}
