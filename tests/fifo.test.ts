import { describe, expect, it } from "vitest";
import { computeFifo } from "../core/fifo";
import type { Fill } from "../core/types";

const f = (id: string, ts: string, side: "BUY" | "SELL", quantity: number, price: number, fee = 0, ticker = "AAA"): Fill => ({
  id, ts, ticker, side, quantity, price, fee, currency: "EUR",
});

describe("computeFifo", () => {
  it("consumes the oldest lots first and splits a lot across sells", () => {
    const r = computeFifo([
      f("b1", "2026-01-01T10:00:00Z", "BUY", 10, 100),
      f("b2", "2026-02-01T10:00:00Z", "BUY", 10, 120),
      f("s1", "2026-03-01T10:00:00Z", "SELL", 15, 130),
    ]);
    const t = r.realized[0]!;
    expect(t.matchedLots).toEqual([
      { buyFillId: "b1", quantity: 10, price: 100 },
      { buyFillId: "b2", quantity: 5, price: 120 },
    ]);
    expect(t.costBasis).toBe(1600);
    expect(t.grossPnl).toBe(15 * 130 - 1600);
    expect(r.open[0]).toMatchObject({ quantity: 5, avgCost: 120 });
  });

  it("separates gross and net P&L, carrying buy fees per unit", () => {
    const r = computeFifo([
      f("b1", "2026-01-01T10:00:00Z", "BUY", 4, 50, 2), // 0.5 per unit
      f("s1", "2026-01-10T10:00:00Z", "SELL", 2, 60, 1),
    ]);
    const t = r.realized[0]!;
    expect(t.grossPnl).toBe(20);
    expect(t.fees).toBe(2); // 1 sell fee + 2 × 0.5
    expect(t.netPnl).toBe(18);
    expect(r.open[0]!.costBasis).toBe(101); // 2 × 50 + 2 × 0.5
  });

  it("is deterministic whatever the input order", () => {
    const fills = [
      f("b1", "2026-01-01T10:00:00Z", "BUY", 1, 10),
      f("b2", "2026-01-01T10:00:00Z", "BUY", 1, 20), // same timestamp: ordered by id
      f("s1", "2026-01-02T10:00:00Z", "SELL", 1, 15),
    ];
    const a = computeFifo(fills);
    const b = computeFifo([...fills].reverse());
    expect(a.realized).toEqual(b.realized);
    expect(a.realized[0]!.matchedLots[0]!.buyFillId).toBe("b1");
  });

  it("never computes P&L on a missing cost basis", () => {
    const r = computeFifo([f("b1", "2026-01-01T10:00:00Z", "BUY", 1, 10), f("s1", "2026-01-02T10:00:00Z", "SELL", 3, 12)]);
    const t = r.realized[0]!;
    expect(t.incomplete).toBe(true);
    expect(t.unmatchedQuantity).toBe(2);
    expect(t.netPnl).toBeNull();
    expect(r.warnings[0]).toMatch(/without cost basis/);
  });

  it("keeps tickers independent and ignores duplicate fill ids", () => {
    const r = computeFifo([
      f("b1", "2026-01-01T10:00:00Z", "BUY", 1, 10, 0, "AAA"),
      f("b1", "2026-01-01T10:00:00Z", "BUY", 1, 10, 0, "AAA"),
      f("b2", "2026-01-01T11:00:00Z", "BUY", 1, 99, 0, "BBB"),
      f("s1", "2026-01-02T10:00:00Z", "SELL", 1, 11, 0, "AAA"),
    ]);
    expect(r.realized[0]!.netPnl).toBe(1);
    expect(r.open.map((o) => o.ticker)).toEqual(["BBB"]);
    expect(r.warnings).toContain("Duplicate fill b1 ignored");
  });

  it("rejects a ticker traded in two currencies", () => {
    expect(() =>
      computeFifo([
        f("b1", "2026-01-01T10:00:00Z", "BUY", 1, 10),
        { ...f("b2", "2026-01-02T10:00:00Z", "BUY", 1, 10), currency: "USD" },
      ]),
    ).toThrow(/both EUR and USD/);
  });
});
