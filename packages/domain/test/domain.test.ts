import { describe, expect, test } from "bun:test"
import {
  DomainRuleError,
  basisPoints,
  createCoffeeIdentity,
  createGreenLot,
  createInventoryTransaction,
  createInventoryTransfer,
  createNextRoastPlan,
  createProvider,
  createRoast,
  createTasting,
  entityId,
  finalizeRoast,
  idempotencyKey,
  instantMs,
  inventoryBalance,
  markNextRoastPlanUsed,
  roastLevelThousandths,
  transitionNextRoastPlan,
} from "../src"

const ids = {
  provider: entityId("Provider", "018f0c3a-1111-7111-8111-111111111111"),
  coffee: entityId("Coffee", "018f0c3a-2222-7222-8222-222222222222"),
  purchaseLine: entityId(
    "PurchaseLine",
    "018f0c3a-3333-7333-8333-333333333333"
  ),
  lotA: entityId("GreenLot", "018f0c3a-4444-7444-8444-444444444444"),
  lotB: entityId("GreenLot", "018f0c3a-5555-7555-8555-555555555555"),
  transfer: entityId(
    "InventoryTransfer",
    "018f0c3a-6666-7666-8666-666666666666"
  ),
  txnA: entityId(
    "InventoryTransaction",
    "018f0c3a-7777-7777-8777-777777777777"
  ),
  txnB: entityId(
    "InventoryTransaction",
    "018f0c3a-8888-7888-8888-888888888888"
  ),
  roast: entityId("Roast", "018f0c3a-9999-7999-8999-999999999999"),
  tasting: entityId("Tasting", "018f0c3a-aaaa-7aaa-8aaa-aaaaaaaaaaaa"),
  scale: entityId(
    "TastingScaleRevision",
    "018f0c3a-bbbb-7bbb-8bbb-bbbbbbbbbbbb"
  ),
  plan: entityId("NextRoastPlan", "018f0c3a-cccc-7ccc-8ccc-cccccccccccc"),
}
const now = instantMs(1_720_000_000_000)
const key = idempotencyKey("018f0c3a-dddd-4ddd-8ddd-dddddddddddd")

describe("catalog entities", () => {
  test("normalizes lookup names without changing display text", () => {
    const provider = createProvider({
      id: ids.provider,
      displayName: "  Bali Beans  ",
      now,
    })
    expect(provider.displayName).toBe("Bali Beans")
    expect(provider.normalizedName).toBe("bali beans")
    expect(provider.revision).toBe(1)
  })

  test("rejects invalid coffee altitude ranges and duplicate varieties", () => {
    expect(() =>
      createCoffeeIdentity({
        id: ids.coffee,
        displayName: "Gesha",
        altitudeMinMetres: 2_000,
        altitudeMaxMetres: 1_500,
        now,
      })
    ).toThrow(DomainRuleError)

    expect(() =>
      createCoffeeIdentity({
        id: ids.coffee,
        displayName: "Gesha",
        varieties: ["Gesha", "gesha"],
        now,
      })
    ).toThrow("duplicate")
  })

  test("requires a positive received lot mass", () => {
    expect(() =>
      createGreenLot({
        id: ids.lotA,
        purchaseLineId: ids.purchaseLine,
        internalCode: "LOT-1",
        receivedMassMg: 0,
        receivedAt: now,
        sourceTimezone: "America/Los_Angeles",
        now,
      })
    ).toThrow("positive")
  })
})

describe("inventory ledger", () => {
  test("builds a balanced transfer and enforces available stock", () => {
    const result = createInventoryTransfer({
      transferId: ids.transfer,
      sourceTransactionId: ids.txnA,
      destinationTransactionId: ids.txnB,
      sourceLotId: ids.lotA,
      destinationLotId: ids.lotB,
      massMg: 250_000,
      sourceBalanceMg: 1_000_000 as ReturnType<typeof inventoryBalance>,
      occurredAt: now,
      reason: "Moved to a sealed container",
      idempotencyKey: key,
    })
    expect(result.source.deltaMg).toBe(-250_000)
    expect(result.destination.deltaMg).toBe(250_000)
    expect(result.source.transferId).toBe(result.transfer.id)

    expect(() =>
      createInventoryTransfer({
        transferId: ids.transfer,
        sourceTransactionId: ids.txnA,
        destinationTransactionId: ids.txnB,
        sourceLotId: ids.lotA,
        destinationLotId: ids.lotB,
        massMg: 2_000_000,
        sourceBalanceMg: 1_000_000 as ReturnType<typeof inventoryBalance>,
        occurredAt: now,
        reason: "Impossible move",
        idempotencyKey: key,
      })
    ).toThrow("insufficient")
  })

  test("rejects malformed ledger semantics", () => {
    expect(() =>
      createInventoryTransaction({
        id: ids.txnA,
        lotId: ids.lotA,
        kind: "roast_consumption",
        deltaMg: 100,
        occurredAt: now,
        reason: "Wrong sign",
        sourceRoastId: ids.roast,
        idempotencyKey: key,
      })
    ).toThrow("negative")
  })
})

describe("roast knowledge", () => {
  test("finalization is idempotent and rejects changed retry inputs", () => {
    const roast = createRoast({
      id: ids.roast,
      greenLotId: ids.lotA,
      coffeeId: ids.coffee,
      profileRevisionId: null,
      roastedAt: now,
      sourceTimezone: "America/Los_Angeles",
      roastLevelThousandths: roastLevelThousandths(2_400),
      developmentBasisPoints: basisPoints(1_700),
      greenInputMassMg: 100_000,
      now,
    })
    const completed = finalizeRoast(roast, {
      finalizationKey: key,
      roastedYieldMassMg: 84_000,
      result: "success",
      endReason: "Profile completed",
      now,
    })
    expect(
      finalizeRoast(completed, {
        finalizationKey: key,
        roastedYieldMassMg: 84_000,
        result: "success",
        endReason: "Profile completed",
        now,
      })
    ).toBe(completed)
    expect(() =>
      finalizeRoast(completed, {
        finalizationKey: key,
        roastedYieldMassMg: 83_000,
        result: "success",
        endReason: "Profile completed",
        now,
      })
    ).toThrow("different inputs")
  })

  test("tastings are immutable records and plans have a closed lifecycle", () => {
    const tasting = createTasting({
      id: ids.tasting,
      roastId: ids.roast,
      tastedAt: now,
      sourceTimezone: "America/Los_Angeles",
      restAgeMs: 86_400_000,
      scaleRevisionId: ids.scale,
      scoreBasisPoints: 8_500,
      descriptors: ["Jasmine", "Peach"],
      outcome: "positive",
      createdAt: now,
    })
    expect(tasting.rootTastingId).toBe(tasting.id)
    expect(Object.isFrozen(tasting)).toBe(true)

    const draft = createNextRoastPlan({
      id: ids.plan,
      coffeeId: ids.coffee,
      lotId: ids.lotA,
      objective: "Preserve florals while adding sweetness",
      proposedSettings: {
        profileRevisionId: null,
        roastLevelThousandths: roastLevelThousandths(2_300),
        greenLoadMassMg: null,
        rationale: "Shorten development",
      },
      now,
    })
    const ready = transitionNextRoastPlan(draft, "ready", now)
    const used = markNextRoastPlanUsed(ready, ids.roast, now)
    expect(used.status).toBe("used")
    expect(() => transitionNextRoastPlan(used, "cancelled", now)).toThrow(
      "Cannot transition"
    )
  })
})
