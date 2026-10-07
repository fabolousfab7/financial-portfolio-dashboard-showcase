import { describe, expect, it } from "vitest";
import { aggregateRoundTrips, classifyPair, holdingFeePcgAccount, normalizeAsset, splitPair, swapToEurLegs, type PerpFill } from "../core/kraken";
import { signKrakenFutures, signKrakenSpot } from "../core/kraken-auth";
import { computeFifo } from "../core/fifo";

describe("asset and pair normalization", () => {
  it("maps Kraken legacy codes", () => {
    expect(normalizeAsset("XXBT")).toBe("BTC");
    expect(normalizeAsset("ZEUR")).toBe("EUR");
    expect(normalizeAsset("ETH.F")).toBe("ETH");
    expect(splitPair("XXBTZEUR")).toEqual({ base: "BTC", quote: "EUR" });
    expect(splitPair("SOLXBT")).toEqual({ base: "SOL", quote: "BTC" });
  });

  it("routes crypto-to-crypto exchanges to the swap register", () => {
    expect(classifyPair("XETHZEUR")).toBe("fiat_quoted");
    expect(classifyPair("ETHUSDT")).toBe("fiat_quoted");
    expect(classifyPair("ETHXBT")).toBe("crypto_crypto_swap");
    expect(classifyPair("ZEURZUSD")).toBe("fiat_conversion");
  });
});

describe("swapToEurLegs", () => {
  it("creates a disposal and an acquisition at the same EUR value", () => {
    const prices: Record<string, number> = { BTC: 92000, ETH: 3450 };
    const [out, inn] = swapToEurLegs(
      { id: "s", ts: "2026-08-12T10:00:00Z", pair: "ETHXBT", side: "SELL", quantity: 0.8, priceInQuote: 0.0375, fee: 0.002, feeAsset: "base" },
      (a) => prices[a]!,
    );
    expect(out).toMatchObject({ ticker: "ETH", side: "SELL", quantity: 0.802 });
    expect(inn).toMatchObject({ ticker: "BTC", side: "BUY", quantity: 0.03 });
    expect(inn.quantity * inn.price).toBeCloseTo(2760, 8);
    expect(out.quantity * out.price - out.fee).toBeCloseTo(2760, 8); // net proceeds = acquisition cost

    const fifo = computeFifo([{ id: "b", ts: "2026-01-01T00:00:00Z", ticker: "ETH", side: "BUY", quantity: 1, price: 3000, fee: 0, currency: "EUR" }, out, inn]);
    expect(fifo.realized[0]!.netPnl).toBeCloseTo(2760 - 0.802 * 3000, 8);
  });
});

describe("perpetual round-trips", () => {
  const fill = (id: string, ts: string, side: "BUY" | "SELL", q: number, p: number, fee = 0): PerpFill => ({ id, ts, symbol: "PF_ETHUSD", side, quantity: q, price: p, fee, currency: "USD" });

  it("closes a long and a short and keeps the open remainder", () => {
    const { closed, openNet } = aggregateRoundTrips([
      fill("1", "2026-01-01T00:00:00Z", "BUY", 2, 3000, 3),
      fill("2", "2026-01-02T00:00:00Z", "SELL", 2, 3200, 3),
      fill("3", "2026-01-03T00:00:00Z", "SELL", 1, 3500),
      fill("4", "2026-01-04T00:00:00Z", "BUY", 1, 3600),
      fill("5", "2026-01-05T00:00:00Z", "SELL", 1, 3700),
    ]);
    expect(closed.map((c) => [c.direction, c.grossPnl, c.netPnl])).toEqual([
      ["LONG", 400, 394],
      ["SHORT", -100, -100],
    ]);
    expect(openNet.get("PF_ETHUSD")).toBe(-1);
  });

  it("splits a fill that flips the position at the zero crossing", () => {
    const { closed, openNet } = aggregateRoundTrips([fill("1", "2026-01-01T00:00:00Z", "BUY", 1, 100), fill("2", "2026-01-02T00:00:00Z", "SELL", 3, 110, 3)]);
    expect(closed[0]).toMatchObject({ direction: "LONG", grossPnl: 10, fees: 1 });
    expect(openNet.get("PF_ETHUSD")).toBe(-2);
  });
});

describe("holding fees → PCG", () => {
  it("maps each fee type to its account", () => {
    expect(holdingFeePcgAccount("rollover", -1)).toBe("661800");
    expect(holdingFeePcgAccount("margin", -1)).toBe("627800");
    expect(holdingFeePcgAccount("funding", -1)).toBe("668000");
    expect(holdingFeePcgAccount("funding", 2)).toBe("768000");
  });
});

describe("request signing", () => {
  const secret = Buffer.from("not-a-real-secret-only-for-tests").toString("base64");
  it("is deterministic and base64-encoded (512-bit HMAC)", () => {
    const a = signKrakenSpot("/0/private/Balance", "1", "nonce=1", secret);
    expect(a).toBe(signKrakenSpot("/0/private/Balance", "1", "nonce=1", secret));
    expect(Buffer.from(a, "base64")).toHaveLength(64);
    expect(signKrakenSpot("/0/private/Balance", "2", "nonce=2", secret)).not.toBe(a);
  });
  it("ignores the /derivatives prefix for futures", () => {
    expect(signKrakenFutures("/derivatives/api/v3/openpositions", "1", "", secret)).toBe(signKrakenFutures("/api/v3/openpositions", "1", "", secret));
  });
});
