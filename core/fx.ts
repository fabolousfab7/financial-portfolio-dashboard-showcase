/**
 * Historical FX conversion to EUR.
 *
 * Rates follow the ECB reference convention: for each date, 1 EUR = `rate` units
 * of the foreign currency. So `amountEur = amountForeign / rate`.
 *
 * Rules enforced here (each one corrected a real class of reporting bug):
 * - Convert every line at the rate of its own date, THEN aggregate.
 *   Summing USD + EUR + GBP first and converting once is wrong.
 * - No hard-coded rate and no silent fallback to 0 or 1: a missing rate throws.
 * - Weekends and holidays roll back to the latest published rate, within a
 *   bounded look-back window.
 * - Stablecoins are valued as USD. This is an explicit assumption, surfaced in
 *   the output, not a hidden shortcut.
 */

import type { Currency } from "./types";
import { sum } from "./math";

export type FxTable = Record<string, Partial<Record<Currency, number>>>;

export class FxRateUnavailableError extends Error {
  constructor(
    readonly currency: string,
    readonly date: string,
  ) {
    super(`No EUR rate for ${currency} on or before ${date}`);
    this.name = "FxRateUnavailableError";
  }
}

const STABLECOIN_PROXY: Partial<Record<Currency, Currency>> = {
  USDT: "USD",
  USDC: "USD",
  DAI: "USD",
};

export interface FxProvider {
  /** Units of `currency` per 1 EUR on `date` (EUR itself is 1). */
  rate(currency: Currency, date: string): number;
}

export class TableFxProvider implements FxProvider {
  private readonly dates: string[];

  constructor(
    private readonly table: FxTable,
    private readonly maxLookbackDays = 7,
  ) {
    this.dates = Object.keys(table).sort();
  }

  rate(currency: Currency, date: string): number {
    if (currency === "EUR") return 1;
    const proxied = STABLECOIN_PROXY[currency] ?? currency;
    const day = date.slice(0, 10);
    const floor = shiftDate(day, -this.maxLookbackDays);
    // Latest published date <= requested date, within the look-back window.
    for (let i = this.dates.length - 1; i >= 0; i--) {
      const d = this.dates[i]!;
      if (d > day) continue;
      if (d < floor) break;
      const r = this.table[d]?.[proxied];
      if (r !== undefined) {
        if (!(r > 0)) throw new Error(`Invalid FX rate ${r} for ${proxied} on ${d}`);
        return r;
      }
    }
    throw new FxRateUnavailableError(currency, day);
  }
}

export function shiftDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function toEur(fx: FxProvider, amount: number, currency: Currency, date: string): number {
  return amount / fx.rate(currency, date);
}

export interface MoneyLine {
  amount: number;
  currency: Currency;
  date: string;
}

/** Convert each line at its own date, then sum. */
export function sumInEur(fx: FxProvider, lines: readonly MoneyLine[]): number {
  return sum(lines.map((l) => toEur(fx, l.amount, l.currency, l.date)));
}

/** Tells the caller when an assumption (stablecoin proxy) was used. */
export function fxAssumption(currency: Currency): string | null {
  const proxy = STABLECOIN_PROXY[currency];
  return proxy ? `${currency} valued at the ${proxy} reference rate` : null;
}
