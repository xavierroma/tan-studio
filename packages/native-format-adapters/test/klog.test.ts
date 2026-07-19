import { describe, expect, test } from "bun:test"

import { NativeFormatError, parseKlog, serializeLosslessNative } from "../src"

const encode = (value: string) => new TextEncoder().encode(value)

describe("Kaffelogic log parser", () => {
  test("parses native channels, offsets, incidentals and Studio-compatible rows", () => {
    const source = [
      "log_file_name:kaffelogic/roast-logs/log0042.klog",
      "profile_short_name:Washed test",
      "roasting_level:2.5",
      "roast_date:18/07/2026 17:36:08 UTC",
      "first_crack:400",
      "",
      "offsets\t-8.5\t0\t-19.5\t0\t0",
      "time\t#=temp\t=profile\t=actual_ROR\tpower_kW\t#^actual_fan_RPM",
      "0.5\t20.5\t21\t0\t0.9\t14700\t",
      "!first_crack:0",
      "!roast_end:521.216",
      "!roast_date:18/07/2026 17:45:33 UTC",
      "1.5\tbad\t22\t3.2\t0.8\t14600\textra",
      "short\t1",
      "",
    ].join("\n")

    const parsed = parseKlog(encode(source))

    expect(parsed.effectiveMetadata.roast_date).toBe("18/07/2026 17:45:33 UTC")
    expect(parsed.channels).toEqual([
      expect.objectContaining({
        key: "temp",
        rawName: "#=temp",
        offsetMs: -8_500,
        unit: "celsius",
        hiddenByDefault: true,
        reusePreviousScale: true,
      }),
      expect.objectContaining({ key: "profile", unit: "celsius" }),
      expect.objectContaining({
        key: "actual_ROR",
        offsetMs: -19_500,
        unit: "celsius_per_minute",
      }),
      expect.objectContaining({ key: "power_kW", unit: "kilowatts" }),
      expect.objectContaining({ key: "actual_fan_RPM", unit: "rpm" }),
    ])
    expect(parsed.samples).toHaveLength(2)
    expect(parsed.samples[1]?.values.temp).toBe(0)
    expect(parsed.events).toEqual([{ kind: "roast_end", elapsedMs: 521_216 }])
    expect(parsed.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(["invalid_number", "extra_cells", "short_row"])
    )
    expect(parsed.compatibility).toMatchObject({
      level: "degraded",
      safeToImport: false,
      recordingState: "completed",
    })
    expect(serializeLosslessNative(parsed.lossless).bytes).toEqual(
      encode(source)
    )
  })

  test("disambiguates duplicate logical channel names", () => {
    const parsed = parseKlog(
      encode("profile_short_name:Test\n\ntime\t=temp\t#temp\n0\t20\t21\n")
    )

    expect(parsed.channels.map((channel) => channel.key)).toEqual([
      "temp",
      "temp__2",
    ])
    expect(parsed.diagnostics[0]?.code).toBe("duplicate_channel")
    expect(parsed.compatibility.level).toBe("compatible")
  })

  test("matches Studio line normalisation and last-value metadata semantics", () => {
    const parsed = parseKlog(
      encode(
        [
          "profile short name:First\r\n",
          "profile short name:Final\r\n",
          "\r\n",
          "offsets,-5,0\r\n",
          "Time,@BT,&actual_ROR\r\n",
          "-1\t20\t4\r\n",
          "0,21,5\r\n",
        ].join("")
      )
    )

    expect(parsed.effectiveMetadata.profile_short_name).toBe("Final")
    expect(parsed.samples.map((sample) => sample.elapsedMs)).toEqual([
      -1_000, 0,
    ])
    expect(parsed.channels[0]).toMatchObject({
      name: "BT",
      unit: "celsius",
      offsetMs: -5_000,
    })
    expect(parsed.compatibility.safeToImport).toBe(true)
  })

  test("recognises a negative roast end as an interrupted preheat marker", () => {
    const parsed = parseKlog(
      encode(
        "profile_short_name:Stopped preheat\n\ntime\t@temp\n-5\t40\n!roast_end:-12.8161\n"
      )
    )

    expect(parsed.events).toEqual([{ kind: "roast_end", elapsedMs: -12_816 }])
    expect(parsed.compatibility).toMatchObject({
      level: "exact",
      safeToImport: true,
      recordingState: "interrupted",
    })
  })

  test("never returns unsafe semantic values for malformed byte inputs", () => {
    let state = 0x51_7a_2026
    for (let attempt = 0; attempt < 500; attempt += 1) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      const bytes = new Uint8Array((state % 384) + 1)
      for (let index = 0; index < bytes.length; index += 1) {
        state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
        bytes[index] = state & 0xff
      }
      try {
        const parsed = parseKlog(bytes)
        expect(parsed.lossless.originalBytes).toEqual(bytes)
        for (const sample of parsed.samples) {
          expect(Number.isSafeInteger(sample.elapsedMs)).toBe(true)
          for (const value of Object.values(sample.values))
            expect(Number.isFinite(value)).toBe(true)
        }
      } catch (error) {
        expect(error).toBeInstanceOf(NativeFormatError)
      }
    }
  })
})
