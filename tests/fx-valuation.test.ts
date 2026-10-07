import { describe, expect, it } from "vitest";
import { FxRateUnavailableError, TableFxProvider, sumInEur, toEur } from "../core/fx";
import { computeNlv, positionUnrealizedEur, positionValueEur } from "../core/valuation";
import type { Position } from "../core/types";

const fx = new TableFxProvider({
  "2026-01-02": { USD: 1.05 },
  "2026-06-30": { USD: 1.17 },
  "2026-07-03": { USD: 1.17 }, // Friday
});

describe("historical FX", () => {
  it("rolls weekends back to the last fixing", () => {
    expect(fx.rate("USD", "2026-07-05")).toBe(1.17); // Sunday → Friday
  });

  it("throws instead of falling back to 0 or 1", () => {
    expect(() => fx.rate("USD", "2025-12-01")).toThrow(FxRateUnavailableError);
    expect(() => fx.rate("GBP", "2026-07-03")).toThrow(FxRateUnavailableError);
  });

  it("values stablecoins at the USD rate", () => {
    expect(toEur(fx, 117, "USDT", "2026-06-30")).toBeCloseTo(100, 10);
  });

  it("converts each line at its own date before summing", () => {
    const lines = [
      { amount: 105, currency: "USD" as const, date: "2026-01-02" }, // 100 €
      { amount: 117, currency: "USD" as const, date: "2026-06-30" }, // 100 €
    ];
    expect(sumInEur(fx, lines)).toBeCloseTo(200, 10);
    // Converting the 222 USD total once at today's rate would give 189.74 €.
    expect(toEur(fx, 222, "USD", "2026-06-30")).not.toBeCloseTo(200, 0);
  });
});

describe("valuation", () => {
  const usdStock: Position = {
    accountId: "a", ticker: "XYZ", assetClass: "STK", quantity: 10, marketPrice: 104, currency: "USD",
    avgCostNative: 100, costBasisEur: 1000 / 1.05, // bought 10 × $100 when EURUSD = 1.05
  };

  it("captures the FX effect on a foreign spot position (FX per leg)", () => {
    // +4 % in USD, but the dollar fell from 1.05 to 1.17: the position lost money in EUR.
    const pnl = positionUnrealizedEur(usdStock, fx, "2026-06-30");
    expect(pnl).toBeCloseTo(1040 / 1.17 - 1000 / 1.05, 8);
    expect(pnl).toBeLessThan(0);
  });

  it("refuses to approximate a foreign cost basis with today's rate", () => {
    const { costBasisEur: _omit, ...noCost } = usdStock;
    expect(() => positionUnrealizedEur(noCost, fx, "2026-06-30")).toThrow(/costBasisEur is required/);
  });

  it("values a derivative at its mark-to-market, not its notional", () => {
    const perp: Position = { accountId: "a", ticker: "PF_ETHUSD", assetClass: "CRYPTO_PERP", quantity: -2, marketPrice: 3900, currency: "USD", avgCostNative: 4017 };
    expect(positionValueEur(perp, fx, "2026-06-30")).toBeCloseTo((-2 * (3900 - 4017)) / 1.17, 8); // +200 €
  });

  it("applies the futures multiplier and ownership share", () => {
    const fut: Position = { accountId: "a", ticker: "MES", assetClass: "FUT", quantity: 1, marketPrice: 6058.5, currency: "USD", avgCostNative: 6000, multiplier: 5 };
    expect(positionValueEur(fut, fx, "2026-06-30")).toBeCloseTo(250, 8);
    const joint: Position = { accountId: "a", ticker: "ETH", assetClass: "CRYPTO_SPOT", quantity: 2, marketPrice: 3000, currency: "EUR", avgCostNative: 2000, ownershipPct: 50 };
    expect(positionValueEur(joint, fx, "2026-06-30")).toBe(3000);
    expect(positionUnrealizedEur(joint, fx, "2026-06-30")).toBe(1000);
  });

  it("computes NLV as positions + cash", () => {
    const n = computeNlv([usdStock], [{ accountId: "a", currency: "USD", amount: 117 }], fx, "2026-06-30");
    expect(n.nlvEur).toBeCloseTo(1040 / 1.17 + 100, 8);
  });
});
