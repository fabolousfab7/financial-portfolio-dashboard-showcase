import { describe, expect, it } from "vitest";
import { consolidate, periodPerformance, windowVariation } from "../core/timeseries";

describe("consolidated series", () => {
  it("carries a missing snapshot forward per account", () => {
    const s = consolidate(
      [
        { accountId: "a", date: "2026-01-01", nlvEur: 100 },
        { accountId: "b", date: "2026-01-01", nlvEur: 50 },
        { accountId: "a", date: "2026-01-02", nlvEur: 110 }, // b missing on the 2nd
        { accountId: "a", date: "2026-01-03", nlvEur: 120 },
        { accountId: "b", date: "2026-01-03", nlvEur: 40 },
      ],
      "2026-01-01",
      "2026-01-03",
    );
    expect(s.map((p) => p.total)).toEqual([150, 160, 160]);
  });

  it("measures window variation against the reference date", () => {
    const s = consolidate(
      [
        { accountId: "a", date: "2026-01-01", nlvEur: 100 },
        { accountId: "a", date: "2026-01-02", nlvEur: 90 },
        { accountId: "a", date: "2026-01-03", nlvEur: 99 },
      ],
      "2026-01-01",
      "2026-01-03",
    );
    expect(windowVariation(s, 1)).toEqual({ abs: 9, pct: 0.1 });
  });
});

describe("period performance", () => {
  it("removes external flows from P&L and time-weights them (Modified Dietz)", () => {
    const p = periodPerformance(1000, 2100, [{ date: "2026-07-02", amountEur: 1000 }], "2026-01-01", "2026-12-31");
    expect(p.pnl).toBe(100);
    // flow weight ≈ half a year: 100 / (1000 + ~500)
    expect(p.modifiedDietz!).toBeCloseTo(100 / (1000 + 1000 * (182 / 364)), 3);
  });
});
