import type { CompanionDatabase } from "./database"
import { withImmediateTransaction } from "./database"

const id = (suffix: string) =>
  `00000000-0000-7000-8000-${suffix.padStart(12, "0")}`

export const seedIds = {
  providers: { osito: id("1"), forest: id("2") },
  coffees: {
    guji: id("11"),
    bensa: id("12"),
    elParaiso: id("13"),
    lasFlores: id("14"),
  },
  purchases: { osito2025041: id("21"), forest2025052: id("22") },
  purchaseLines: {
    guji: id("31"),
    bensa: id("32"),
    elParaiso: id("33"),
    lasFlores: id("34"),
  },
  lots: {
    guji: id("41"),
    bensa: id("42"),
    elParaiso: id("43"),
    lasFlores: id("44"),
  },
  profiles: {
    naturalLight: id("51"),
    washedLight: id("52"),
    filterOmni: id("53"),
  },
  profileRevisions: {
    natural12: id("61"),
    natural11: id("62"),
    natural10: id("63"),
    washed7: id("64"),
    washed6: id("65"),
    filter18: id("66"),
  },
  roasts: {
    gujiR12: id("71"),
    gujiR11a: id("72"),
    gujiR11b: id("73"),
    elR7: id("74"),
    elR6: id("75"),
    elOmni: id("76"),
  },
} as const

const at = (value: string) => Date.parse(value)
const createdAt = at("2026-05-06T15:00:00.000Z")

type SeedRoast = {
  id: string
  lotId: string
  coffeeId: string
  profileRevisionId: string
  profileName: string
  profileRevisionNumber: number
  roastedAt: number
  level: number
  loadMg: number
  yieldMg: number
  development: number
  score: number | null
  descriptors: string[]
  tastingNotes: string | null
  conclusion: string | null
  nextAction: string | null
  providerId: string
  providerName: string
  purchaseId: string
  purchaseReference: string
  coffeeName: string
  lotCode: string
  countryCode: string
  region: string
  farmProducer: string
  process: string
  varieties: string[]
}

const roasts: SeedRoast[] = [
  {
    id: seedIds.roasts.gujiR12,
    lotId: seedIds.lots.guji,
    coffeeId: seedIds.coffees.guji,
    profileRevisionId: seedIds.profileRevisions.natural12,
    profileName: "Natural Light",
    profileRevisionNumber: 12,
    roastedAt: at("2026-07-18T16:42:00.000Z"),
    level: 1100,
    loadMg: 90_000,
    yieldMg: 76_500,
    development: 1240,
    score: 8800,
    descriptors: ["jasmine", "peach", "honey"],
    tastingNotes: "Jasmine · peach",
    conclusion:
      "Best expression so far. Preserve Maillard shape; soften fan transition after first crack.",
    nextAction: "Create r13 with gentler post-FC fan step.",
    providerId: seedIds.providers.osito,
    providerName: "Osito Coffee",
    purchaseId: seedIds.purchases.osito2025041,
    purchaseReference: "PO-2025-041",
    coffeeName: "Guji Shakiso",
    lotCode: "ETH-GUJ-24-07",
    countryCode: "ET",
    region: "Guji",
    farmProducer: "Kayon Mountain",
    process: "Natural",
    varieties: ["Heirloom"],
  },
  {
    id: seedIds.roasts.gujiR11a,
    lotId: seedIds.lots.guji,
    coffeeId: seedIds.coffees.guji,
    profileRevisionId: seedIds.profileRevisions.natural11,
    profileName: "Natural Light",
    profileRevisionNumber: 11,
    roastedAt: at("2026-07-14T15:27:00.000Z"),
    level: 1100,
    loadMg: 90_000,
    yieldMg: 76_000,
    development: 1320,
    score: 8200,
    descriptors: ["cocoa"],
    tastingNotes: "Thin finish",
    conclusion: "Good aromatics, but the finish lost sweetness.",
    nextAction: "Shorten the late declining phase.",
    providerId: seedIds.providers.osito,
    providerName: "Osito Coffee",
    purchaseId: seedIds.purchases.osito2025041,
    purchaseReference: "PO-2025-041",
    coffeeName: "Guji Shakiso",
    lotCode: "ETH-GUJ-24-07",
    countryCode: "ET",
    region: "Guji",
    farmProducer: "Kayon Mountain",
    process: "Natural",
    varieties: ["Heirloom"],
  },
  {
    id: seedIds.roasts.gujiR11b,
    lotId: seedIds.lots.guji,
    coffeeId: seedIds.coffees.guji,
    profileRevisionId: seedIds.profileRevisions.natural11,
    profileName: "Natural Light",
    profileRevisionNumber: 11,
    roastedAt: at("2026-07-09T17:36:00.000Z"),
    level: 1000,
    loadMg: 90_000,
    yieldMg: 77_000,
    development: 1190,
    score: 8500,
    descriptors: ["floral", "lemon"],
    tastingNotes: "Floral · lemon",
    conclusion: "Bright and floral with slightly sharp acidity.",
    nextAction: "Add a little more development after first crack.",
    providerId: seedIds.providers.osito,
    providerName: "Osito Coffee",
    purchaseId: seedIds.purchases.osito2025041,
    purchaseReference: "PO-2025-041",
    coffeeName: "Guji Shakiso",
    lotCode: "ETH-GUJ-24-07",
    countryCode: "ET",
    region: "Guji",
    farmProducer: "Kayon Mountain",
    process: "Natural",
    varieties: ["Heirloom"],
  },
  {
    id: seedIds.roasts.elR7,
    lotId: seedIds.lots.elParaiso,
    coffeeId: seedIds.coffees.elParaiso,
    profileRevisionId: seedIds.profileRevisions.washed7,
    profileName: "Washed Light",
    profileRevisionNumber: 7,
    roastedAt: at("2026-07-17T23:08:00.000Z"),
    level: 1000,
    loadMg: 100_000,
    yieldMg: 84_000,
    development: 1280,
    score: 8600,
    descriptors: ["rose", "lychee"],
    tastingNotes: "Rose · lychee",
    conclusion: "Perfumed, clean and juicy.",
    nextAction: "Repeat before changing the profile.",
    providerId: seedIds.providers.forest,
    providerName: "Forest Coffee",
    purchaseId: seedIds.purchases.forest2025052,
    purchaseReference: "PO-2025-052",
    coffeeName: "El Paraíso",
    lotCode: "COL-HUI-25-03",
    countryCode: "CO",
    region: "Huila",
    farmProducer: "Finca El Paraíso",
    process: "Thermal shock",
    varieties: ["Castillo"],
  },
  {
    id: seedIds.roasts.elR6,
    lotId: seedIds.lots.elParaiso,
    coffeeId: seedIds.coffees.elParaiso,
    profileRevisionId: seedIds.profileRevisions.washed6,
    profileName: "Washed Light",
    profileRevisionNumber: 6,
    roastedAt: at("2026-07-11T20:22:00.000Z"),
    level: 1100,
    loadMg: 100_000,
    yieldMg: 83_000,
    development: 1350,
    score: null,
    descriptors: [],
    tastingNotes: "Tasting due day 5",
    conclusion: null,
    nextAction: null,
    providerId: seedIds.providers.forest,
    providerName: "Forest Coffee",
    purchaseId: seedIds.purchases.forest2025052,
    purchaseReference: "PO-2025-052",
    coffeeName: "El Paraíso",
    lotCode: "COL-HUI-25-03",
    countryCode: "CO",
    region: "Huila",
    farmProducer: "Finca El Paraíso",
    process: "Thermal shock",
    varieties: ["Castillo"],
  },
  {
    id: seedIds.roasts.elOmni,
    lotId: seedIds.lots.elParaiso,
    coffeeId: seedIds.coffees.elParaiso,
    profileRevisionId: seedIds.profileRevisions.filter18,
    profileName: "Filter Omni",
    profileRevisionNumber: 18,
    roastedAt: at("2026-07-04T16:10:00.000Z"),
    level: 1000,
    loadMg: 90_000,
    yieldMg: 76_000,
    development: 1290,
    score: 8300,
    descriptors: ["citrus"],
    tastingNotes: "Citrus · dry finish",
    conclusion: "Clear citrus but slightly drying.",
    nextAction: "Reduce final temperature.",
    providerId: seedIds.providers.forest,
    providerName: "Forest Coffee",
    purchaseId: seedIds.purchases.forest2025052,
    purchaseReference: "PO-2025-052",
    coffeeName: "El Paraíso",
    lotCode: "COL-HUI-25-03",
    countryCode: "CO",
    region: "Huila",
    farmProducer: "Finca El Paraíso",
    process: "Thermal shock",
    varieties: ["Castillo"],
  },
]

export function seedDatabase(database: CompanionDatabase): void {
  const existing = database
    .query("SELECT count(*) AS count FROM providers")
    .get() as { count: number }
  if (existing.count > 0) return

  withImmediateTransaction(database, () => {
    const provider = database.query(`INSERT INTO providers
      (id, display_name, normalized_name, aliases_json, contact_json, reference_notes,
       default_currency_code, notes, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, '[]', '{"websiteUrl":null,"email":null,"phone":null}', ?, 'USD', ?, ?, ?)`)
    provider.run(
      seedIds.providers.osito,
      "Osito Coffee",
      "osito coffee",
      "Mockup purchase source",
      "Green coffee supplier",
      createdAt,
      createdAt
    )
    provider.run(
      seedIds.providers.forest,
      "Forest Coffee",
      "forest coffee",
      "Mockup purchase source",
      "Green coffee supplier",
      createdAt,
      createdAt
    )

    const coffee = database.query(`INSERT INTO coffee_identities
      (id, display_name, normalized_name, country_code, region, farm_producer, process, varieties_json,
       altitude_min_m, altitude_max_m, harvest_label, notes, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`)
    coffee.run(
      seedIds.coffees.guji,
      "Guji Shakiso",
      "guji shakiso",
      "ET",
      "Guji",
      "Kayon Mountain",
      "Natural",
      '["Heirloom"]',
      1900,
      2100,
      "2024/25",
      createdAt,
      createdAt
    )
    coffee.run(
      seedIds.coffees.bensa,
      "Bensa Bombe",
      "bensa bombe",
      "ET",
      "Sidama",
      "Bombe Washing Station",
      "Washed",
      '["Heirloom"]',
      1950,
      2200,
      "2024/25",
      createdAt,
      createdAt
    )
    coffee.run(
      seedIds.coffees.elParaiso,
      "El Paraíso",
      "el paraíso",
      "CO",
      "Huila",
      "Finca El Paraíso",
      "Thermal shock",
      '["Castillo"]',
      1700,
      1900,
      "2025",
      createdAt,
      createdAt
    )
    coffee.run(
      seedIds.coffees.lasFlores,
      "Las Flores",
      "las flores",
      "CO",
      "Huila",
      "Finca Las Flores",
      "Anaerobic washed",
      '["Pink Bourbon"]',
      1750,
      1950,
      "2025",
      createdAt,
      createdAt
    )

    const purchase = database.query(`INSERT INTO green_purchases
      (id, provider_id, supplier_reference, purchased_at_ms, received_at_ms, source_timezone,
       total_mass_mg, currency_code, total_cost_minor, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, 'America/Los_Angeles', ?, 'USD', ?, ?, ?)`)
    purchase.run(
      seedIds.purchases.osito2025041,
      seedIds.providers.osito,
      "PO-2025-041",
      at("2026-04-29T19:00:00Z"),
      at("2026-05-06T19:00:00Z"),
      5_000_000,
      9_450,
      createdAt,
      createdAt
    )
    purchase.run(
      seedIds.purchases.forest2025052,
      seedIds.providers.forest,
      "PO-2025-052",
      at("2026-06-24T19:00:00Z"),
      at("2026-06-29T19:00:00Z"),
      3_000_000,
      8_120,
      createdAt,
      createdAt
    )

    const line = database.query(`INSERT INTO purchase_lines
      (id, purchase_id, coffee_id, ordered_mass_mg, received_mass_mg, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
    line.run(
      seedIds.purchaseLines.guji,
      seedIds.purchases.osito2025041,
      seedIds.coffees.guji,
      2_500_000,
      2_500_000,
      createdAt,
      createdAt
    )
    line.run(
      seedIds.purchaseLines.bensa,
      seedIds.purchases.osito2025041,
      seedIds.coffees.bensa,
      2_500_000,
      2_500_000,
      createdAt,
      createdAt
    )
    line.run(
      seedIds.purchaseLines.elParaiso,
      seedIds.purchases.forest2025052,
      seedIds.coffees.elParaiso,
      1_200_000,
      1_200_000,
      createdAt,
      createdAt
    )
    line.run(
      seedIds.purchaseLines.lasFlores,
      seedIds.purchases.forest2025052,
      seedIds.coffees.lasFlores,
      1_800_000,
      1_800_000,
      createdAt,
      createdAt
    )

    const lot = database.query(`INSERT INTO green_lots
      (id, purchase_line_id, internal_code, received_mass_mg, on_hand_mass_mg, received_at_ms,
       source_timezone, storage_location, state, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, 'America/Los_Angeles', 'Coffee cabinet', 'active', ?, ?)`)
    lot.run(
      seedIds.lots.guji,
      seedIds.purchaseLines.guji,
      "ETH-GUJ-24-07",
      2_500_000,
      1_420_000,
      at("2026-05-06T19:00:00Z"),
      createdAt,
      createdAt
    )
    lot.run(
      seedIds.lots.bensa,
      seedIds.purchaseLines.bensa,
      "ETH-SID-25-02",
      2_500_000,
      2_080_000,
      at("2026-05-06T19:00:00Z"),
      createdAt,
      createdAt
    )
    lot.run(
      seedIds.lots.elParaiso,
      seedIds.purchaseLines.elParaiso,
      "COL-HUI-25-03",
      1_200_000,
      780_000,
      at("2026-06-29T19:00:00Z"),
      createdAt,
      createdAt
    )
    lot.run(
      seedIds.lots.lasFlores,
      seedIds.purchaseLines.lasFlores,
      "COL-HUI-25-09",
      1_800_000,
      1_640_000,
      at("2026-06-29T19:00:00Z"),
      createdAt,
      createdAt
    )

    const inventory = database.query(`INSERT INTO inventory_transactions
      (id, lot_id, transaction_kind, delta_mg, occurred_at_ms, reason, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
    const balances = [
      [seedIds.lots.guji, 2_500_000, 1_420_000],
      [seedIds.lots.bensa, 2_500_000, 2_080_000],
      [seedIds.lots.elParaiso, 1_200_000, 780_000],
      [seedIds.lots.lasFlores, 1_800_000, 1_640_000],
    ] as const
    balances.forEach(([lotId, receivedMassMg, balanceMg], index) => {
      inventory.run(
        id(String(301 + index * 2)),
        lotId,
        "receipt",
        receivedMassMg,
        createdAt,
        "Initial lot receipt",
        createdAt
      )
      inventory.run(
        id(String(302 + index * 2)),
        lotId,
        "adjustment",
        balanceMg - receivedMassMg,
        at("2026-07-18T17:00:00Z"),
        "Opening demo balance reconciliation",
        createdAt
      )
    })

    const profile = database.query(`INSERT INTO profiles
      (id, display_name, normalized_name, family, origin, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, 'user', ?, ?)`)
    profile.run(
      seedIds.profiles.naturalLight,
      "Natural Light",
      "natural light",
      "light",
      createdAt,
      createdAt
    )
    profile.run(
      seedIds.profiles.washedLight,
      "Washed Light",
      "washed light",
      "light",
      createdAt,
      createdAt
    )
    profile.run(
      seedIds.profiles.filterOmni,
      "Filter Omni",
      "filter omni",
      "omni",
      createdAt,
      createdAt
    )

    const revision = database.query(`INSERT INTO profile_revisions
      (id, profile_id, revision_number, schema_version, short_name, document_json, created_at_ms)
      VALUES (?, ?, ?, 1, ?, '{}', ?)`)
    revision.run(
      seedIds.profileRevisions.natural12,
      seedIds.profiles.naturalLight,
      12,
      "Natural Light r12",
      createdAt
    )
    revision.run(
      seedIds.profileRevisions.natural11,
      seedIds.profiles.naturalLight,
      11,
      "Natural Light r11",
      createdAt
    )
    revision.run(
      seedIds.profileRevisions.natural10,
      seedIds.profiles.naturalLight,
      10,
      "Natural Light r10",
      createdAt
    )
    revision.run(
      seedIds.profileRevisions.washed7,
      seedIds.profiles.washedLight,
      7,
      "Washed Light r7",
      createdAt
    )
    revision.run(
      seedIds.profileRevisions.washed6,
      seedIds.profiles.washedLight,
      6,
      "Washed Light r6",
      createdAt
    )
    revision.run(
      seedIds.profileRevisions.filter18,
      seedIds.profiles.filterOmni,
      18,
      "Filter Omni r18",
      createdAt
    )

    const roastStatement = database.query(`INSERT INTO roasts
      (id, green_lot_id, coffee_id, profile_revision_id, roasted_at_ms, source_timezone,
       level_thousandths, development_basis_points, green_input_mass_mg, roasted_yield_mass_mg,
       end_reason, result, status, notes, promoted_tasting_id, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, 'America/Los_Angeles', ?, ?, ?, ?, 'profile_complete', 'success', 'completed', '', ?, ?, ?)`)
    const tasting = database.query(`INSERT INTO tastings
      (id, roast_id, tasted_at_ms, source_timezone, score_basis_points, descriptors_json, notes,
       conclusion, next_action, created_at_ms) VALUES (?, ?, ?, 'America/Los_Angeles', ?, ?, ?, ?, ?, ?)`)
    const library = database.query(`INSERT INTO roast_library_rows
      (roast_id, revision, roasted_at_ms, coffee_id, coffee_name, provider_id, provider_name,
       purchase_id, purchase_reference, green_lot_id, lot_code, country_code, region, farm_producer,
       process, varieties_json, profile_revision_id, profile_name, profile_revision_number,
       roast_level_thousandths, green_input_mass_mg, roasted_yield_mass_mg, roast_loss_basis_points,
       development_basis_points, tasting_score_basis_points, tasting_descriptors_json, tasting_notes,
       tasting_conclusion, tags_json, result, status, needs_tasting)
      VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'success', 'completed', ?)`)
    const fts = database.query(`INSERT INTO roast_library_fts
      (roast_id, coffee_name, provider_name, farm_producer, process, tasting_notes, tasting_conclusion)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)

    for (const roast of roasts) {
      const tastingId =
        roast.score == null ? null : id(String(100 + roasts.indexOf(roast)))
      roastStatement.run(
        roast.id,
        roast.lotId,
        roast.coffeeId,
        roast.profileRevisionId,
        roast.roastedAt,
        roast.level,
        roast.development,
        roast.loadMg,
        roast.yieldMg,
        tastingId,
        roast.roastedAt,
        roast.roastedAt
      )
      if (tastingId) {
        tasting.run(
          tastingId,
          roast.id,
          roast.roastedAt + 5 * 86_400_000,
          roast.score,
          JSON.stringify(roast.descriptors),
          roast.tastingNotes ?? "",
          roast.conclusion ?? "",
          roast.nextAction ?? "",
          roast.roastedAt + 5 * 86_400_000
        )
      }
      const loss = Math.round(
        ((roast.loadMg - roast.yieldMg) / roast.loadMg) * 10_000
      )
      library.run(
        roast.id,
        roast.roastedAt,
        roast.coffeeId,
        roast.coffeeName,
        roast.providerId,
        roast.providerName,
        roast.purchaseId,
        roast.purchaseReference,
        roast.lotId,
        roast.lotCode,
        roast.countryCode,
        roast.region,
        roast.farmProducer,
        roast.process,
        JSON.stringify(roast.varieties),
        roast.profileRevisionId,
        roast.profileName,
        roast.profileRevisionNumber,
        roast.level,
        roast.loadMg,
        roast.yieldMg,
        loss,
        roast.development,
        roast.score,
        JSON.stringify(roast.descriptors),
        roast.tastingNotes,
        roast.conclusion,
        roast.score == null ? 1 : 0
      )
      fts.run(
        roast.id,
        roast.coffeeName,
        roast.providerName,
        roast.farmProducer,
        roast.process,
        roast.tastingNotes,
        roast.conclusion
      )
    }

    const targetRoast = seedIds.roasts.gujiR12
    database
      .query(
        `INSERT INTO roast_sample_streams
      (roast_id, stream_version, channel_schema_json, row_count, first_elapsed_ms, last_elapsed_ms, reconciliation_state)
      VALUES (?, 1, ?, 187, 0, 558000, 'reconciled')`
      )
      .run(
        targetRoast,
        JSON.stringify([
          { id: "temperature", unit: "milli_celsius" },
          { id: "profileTemperature", unit: "milli_celsius" },
          { id: "ror", unit: "milli_celsius_per_minute" },
        ])
      )
    const sample = database.query(`INSERT INTO roast_series_points
      (roast_id, sample_seq, elapsed_ms, temperature_milli_c, profile_temperature_milli_c, ror_milli_c_per_min)
      VALUES (?, ?, ?, ?, ?, ?)`)
    for (let sequence = 0; sequence < 187; sequence += 1) {
      const elapsedMs = sequence * 3_000
      const progress = elapsedMs / 558_000
      const temperature = Math.round(
        (25 + 193 * progress ** 0.64 + Math.sin(progress * 16) * 1.1) * 1_000
      )
      const profileTemperature = Math.round(
        (25 + 194 * progress ** 0.66) * 1_000
      )
      const ror = Math.round(
        (28 * Math.exp(-progress * 2.4) + 4 + Math.sin(progress * 11) * 0.8) *
          1_000
      )
      sample.run(
        targetRoast,
        sequence,
        elapsedMs,
        temperature,
        profileTemperature,
        ror
      )
    }

    const event = database.query(`INSERT INTO roast_events
      (id, roast_id, event_kind, elapsed_ms, temperature_milli_c, source, created_at_ms)
      VALUES (?, ?, ?, ?, ?, 'native', ?)`)
    event.run(id("201"), targetRoast, "start", 0, 25_000, roasts[0]!.roastedAt)
    event.run(
      id("202"),
      targetRoast,
      "colour",
      184_000,
      145_000,
      roasts[0]!.roastedAt
    )
    event.run(
      id("203"),
      targetRoast,
      "first_crack",
      448_000,
      198_000,
      roasts[0]!.roastedAt
    )
    event.run(
      id("204"),
      targetRoast,
      "end",
      558_000,
      218_200,
      roasts[0]!.roastedAt
    )

    const annotation = database.query(`INSERT INTO annotations
      (id, roast_id, elapsed_ms, temperature_milli_c, annotation_type, text, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    annotation.run(
      id("211"),
      targetRoast,
      324_000,
      172_100,
      "observation",
      "Aromatics lifted — keep this momentum next time",
      roasts[0]!.roastedAt,
      roasts[0]!.roastedAt
    )
    annotation.run(
      id("212"),
      targetRoast,
      478_000,
      203_800,
      "check",
      "Check RoR flick — fan change may be too abrupt",
      roasts[0]!.roastedAt,
      roasts[0]!.roastedAt
    )
    annotation.run(
      id("213"),
      targetRoast,
      558_000,
      218_200,
      "decision",
      "Colour looked even; no smoke",
      roasts[0]!.roastedAt,
      roasts[0]!.roastedAt
    )
  })
}
