/**
 * Deterministic FIFO realized P&L, computed per ticker.
 *
 * Rules
 * 1. Fills are processed in (timestamp, id) order, so the same input always
 *    yields the same lot matching, whatever order the API returned it in.
 * 2. A BUY opens a lot. Its fee is spread per unit and travels with the lot.
 * 3. A SELL consumes the oldest lots first. Gross P&L ignores fees; net P&L
 *    deducts the sell fee and the share of buy fees attached to consumed units.
 * 4. If a SELL exceeds the units held (history truncated by the API window,
 *    transfer-in without cost basis...), the trade is flagged `incomplete` and
 *    its P&L is `null`. It is never silently computed on a zero cost basis.
 * 5. A ticker must trade in a single currency; mixing currencies is an error
 *    because FIFO arithmetic in mixed units is meaningless.
 *
 * Long-only spot model. Derivatives are handled as round-trips elsewhere.
 */

import type { Currency, Fill } from "./types";
import { EPSILON, round } from "./math";

export interface Lot {
  fillId: string;
  ts: string;
  quantity: number; // remaining units
  price: number;
  feePerUnit: number;
}

export interface LotConsumption {
  buyFillId: string;
  quantity: number;
  price: number;
}

export interface RealizedTrade {
  sellFillId: string;
  ticker: string;
  ts: string;
  currency: Currency;
  quantity: number;
  sellPrice: number;
  proceeds: number;
  costBasis: number | null;
  grossPnl: number | null;
  fees: number | null;
  netPnl: number | null;
  holdingDays: number | null; // quantity-weighted
  matchedLots: LotConsumption[];
  unmatchedQuantity: number;
  incomplete: boolean;
}

export interface OpenPosition {
  ticker: string;
  currency: Currency;
  quantity: number;
  avgCost: number; // excluding fees
  costBasis: number; // including attached buy fees
  lots: Lot[];
}

export interface FifoResult {
  realized: RealizedTrade[];
  open: OpenPosition[];
  warnings: string[];
}

const DAY_MS = 86_400_000;

export function sortFills(fills: readonly Fill[]): Fill[] {
  return [...fills].sort((a, b) => {
    const t = Date.parse(a.ts) - Date.parse(b.ts);
    if (t !== 0) return t;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function validateFill(f: Fill): void {
  if (!(f.quantity > 0)) throw new Error(`Fill ${f.id}: quantity must be > 0`);
  if (!(f.price >= 0)) throw new Error(`Fill ${f.id}: price must be >= 0`);
  if (!(f.fee >= 0)) throw new Error(`Fill ${f.id}: fee must be >= 0`);
  if (Number.isNaN(Date.parse(f.ts))) throw new Error(`Fill ${f.id}: invalid timestamp`);
}

export function computeFifo(fills: readonly Fill[]): FifoResult {
  const queues = new Map<string, Lot[]>();
  const currencies = new Map<string, Currency>();
  const realized: RealizedTrade[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const fill of sortFills(fills)) {
    validateFill(fill);
    if (seen.has(fill.id)) {
      warnings.push(`Duplicate fill ${fill.id} ignored`);
      continue;
    }
    seen.add(fill.id);

    const ccy = currencies.get(fill.ticker);
    if (ccy && ccy !== fill.currency) {
      throw new Error(`Ticker ${fill.ticker} trades in both ${ccy} and ${fill.currency}`);
    }
    currencies.set(fill.ticker, fill.currency);

    const queue = queues.get(fill.ticker) ?? [];
    queues.set(fill.ticker, queue);

    if (fill.side === "BUY") {
      queue.push({
        fillId: fill.id,
        ts: fill.ts,
        quantity: fill.quantity,
        price: fill.price,
        feePerUnit: fill.fee / fill.quantity,
      });
      continue;
    }

    // SELL: consume oldest lots first.
    let remaining = fill.quantity;
    let cost = 0;
    let buyFees = 0;
    let weightedDays = 0;
    const matchedLots: LotConsumption[] = [];

    while (remaining > EPSILON && queue.length > 0) {
      const lot = queue[0]!;
      const take = Math.min(lot.quantity, remaining);
      cost += take * lot.price;
      buyFees += take * lot.feePerUnit;
      weightedDays += take * ((Date.parse(fill.ts) - Date.parse(lot.ts)) / DAY_MS);
      matchedLots.push({ buyFillId: lot.fillId, quantity: take, price: lot.price });
      lot.quantity -= take;
      remaining -= take;
      if (lot.quantity <= EPSILON) queue.shift();
    }

    const unmatched = remaining > EPSILON ? remaining : 0;
    const incomplete = unmatched > 0;
    if (incomplete) {
      warnings.push(
        `Sell ${fill.id} (${fill.ticker}): ${round(unmatched, 8)} units without cost basis — P&L left null`,
      );
    }

    const proceeds = fill.quantity * fill.price;
    const matchedQty = fill.quantity - unmatched;
    realized.push({
      sellFillId: fill.id,
      ticker: fill.ticker,
      ts: fill.ts,
      currency: fill.currency,
      quantity: fill.quantity,
      sellPrice: fill.price,
      proceeds,
      costBasis: incomplete ? null : cost,
      grossPnl: incomplete ? null : proceeds - cost,
      fees: incomplete ? null : fill.fee + buyFees,
      netPnl: incomplete ? null : proceeds - cost - fill.fee - buyFees,
      holdingDays: matchedQty > 0 ? weightedDays / matchedQty : null,
      matchedLots,
      unmatchedQuantity: unmatched,
      incomplete,
    });
  }

  const open: OpenPosition[] = [];
  for (const [ticker, lots] of queues) {
    const quantity = lots.reduce((s, l) => s + l.quantity, 0);
    if (quantity <= EPSILON) continue;
    const gross = lots.reduce((s, l) => s + l.quantity * l.price, 0);
    const fees = lots.reduce((s, l) => s + l.quantity * l.feePerUnit, 0);
    open.push({
      ticker,
      currency: currencies.get(ticker)!,
      quantity,
      avgCost: gross / quantity,
      costBasis: gross + fees,
      lots: lots.map((l) => ({ ...l })),
    });
  }
  open.sort((a, b) => a.ticker.localeCompare(b.ticker));

  return { realized, open, warnings };
}

/** Realized net P&L per ticker (native currency), skipping incomplete trades. */
export function realizedByTicker(trades: readonly RealizedTrade[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of trades) {
    if (t.netPnl === null) continue;
    out.set(t.ticker, (out.get(t.ticker) ?? 0) + t.netPnl);
  }
  return out;
}
