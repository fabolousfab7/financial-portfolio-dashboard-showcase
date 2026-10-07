/**
 * Kraken Spot & Futures helpers: asset normalization, trade classification,
 * holding-fee mapping and perpetual round-trip aggregation.
 * Request signing lives in `kraken-auth.ts` (server-only, uses node:crypto).
 *
 * Only read-only API permissions are ever needed by this application
 * (balances, trade history, ledger). Keys never transit through the client.
 */

import type { Currency, Fill } from "./types";

// ---------- asset & pair normalization ----------

const ASSET_ALIASES: Record<string, string> = {
  XXBT: "BTC",
  XBT: "BTC",
  XETH: "ETH",
  XXDG: "DOGE",
  XDG: "DOGE",
  ZEUR: "EUR",
  ZUSD: "USD",
  ZGBP: "GBP",
  ZCHF: "CHF",
};

export function normalizeAsset(raw: string): string {
  const upper = raw.toUpperCase().replace(/\.(F|S|M|B)$/, ""); // staking / earn suffixes
  return ASSET_ALIASES[upper] ?? upper;
}

export const FIAT = new Set(["EUR", "USD", "GBP", "CHF", "JPY"]);
export const STABLES = new Set(["USDT", "USDC", "DAI"]);
const QUOTES = ["ZEUR", "ZUSD", "ZGBP", "EUR", "USD", "GBP", "CHF", "JPY", "USDT", "USDC", "DAI", "XXBT", "XBT", "BTC", "XETH", "ETH"];

/** Splits a Kraken pair (e.g. XXBTZEUR, ETHUSDT, SOLXBT) into base and quote. */
export function splitPair(pair: string): { base: string; quote: string } {
  const p = pair.toUpperCase().replace("/", "");
  for (const q of QUOTES) {
    if (p.endsWith(q) && p.length > q.length) {
      return { base: normalizeAsset(p.slice(0, -q.length)), quote: normalizeAsset(q) };
    }
  }
  throw new Error(`Cannot split Kraken pair ${pair}`);
}

export type TradeCategory =
  | "fiat_quoted" // crypto bought/sold against fiat or stablecoin → FIFO P&L
  | "crypto_crypto_swap" // crypto exchanged for crypto → separate taxable-event register
  | "fiat_conversion"; // currency exchange (EUR↔USD) → not a trading P&L line

/**
 * For a company there is no deferral on crypto-to-crypto exchanges: each swap is a
 * disposal valued at fair value on its date, so swaps are routed to their own
 * register instead of being mixed into the fiat-quoted FIFO.
 */
export function classifyPair(pair: string): TradeCategory {
  const { base, quote } = splitPair(pair);
  if (FIAT.has(base) && FIAT.has(quote)) return "fiat_conversion";
  if (FIAT.has(quote) || STABLES.has(quote)) return "fiat_quoted";
  return "crypto_crypto_swap";
}

// ---------- holding fees → French chart of accounts (PCG) ----------

export type HoldingFeeType = "rollover" | "margin" | "funding";

/**
 * Margin rollover is financial interest (6618), opening/closing margin fees are
 * service fees (6278); funding payments are financial charges (668) or income (768)
 * depending on their sign.
 */
export function holdingFeePcgAccount(type: HoldingFeeType, amountSigned: number): string {
  if (type === "rollover") return "661800";
  if (type === "margin") return "627800";
  return amountSigned >= 0 ? "768000" : "668000";
}

// ---------- perpetual round-trips ----------

export interface PerpFill {
  id: string;
  ts: string;
  symbol: string; // e.g. PF_ETHUSD
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  fee: number;
  currency: Currency;
}

export interface RoundTrip {
  symbol: string;
  direction: "LONG" | "SHORT";
  openedAt: string;
  closedAt: string;
  maxQuantity: number;
  grossPnl: number;
  fees: number;
  netPnl: number;
  currency: Currency;
  fills: string[];
}

/**
 * Groups perpetual fills into round-trips: a round-trip starts when the net
 * position leaves 0 and ends when it returns to 0. Cash-flow P&L of a closed
 * round-trip is Σ(sell notional) − Σ(buy notional).
 * A fill that flips the position (long → short) is split at the zero crossing.
 */
export function aggregateRoundTrips(fills: readonly PerpFill[]): { closed: RoundTrip[]; openNet: Map<string, number> } {
  const sorted = [...fills].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || a.id.localeCompare(b.id));
  const state = new Map<string, { net: number; cash: number; fees: number; max: number; openedAt: string; ids: string[]; ccy: Currency }>();
  const closed: RoundTrip[] = [];

  for (const f of sorted) {
    let qty = f.quantity;
    while (qty > 1e-12) {
      const s = state.get(f.symbol);
      const sign = f.side === "BUY" ? 1 : -1;
      if (!s || s.net === 0) {
        state.set(f.symbol, { net: sign * qty, cash: -sign * qty * f.price, fees: f.fee * (qty / f.quantity), max: qty, openedAt: f.ts, ids: [f.id], ccy: f.currency });
        qty = 0;
        continue;
      }
      const reducing = Math.sign(s.net) !== sign;
      const take = reducing ? Math.min(qty, Math.abs(s.net)) : qty;
      s.net += sign * take;
      s.cash += -sign * take * f.price;
      s.fees += f.fee * (take / f.quantity);
      s.max = Math.max(s.max, Math.abs(s.net));
      if (!s.ids.includes(f.id)) s.ids.push(f.id);
      qty -= take;
      if (Math.abs(s.net) < 1e-12) {
        const direction = sign === -1 ? "LONG" : "SHORT"; // closed by a sell ⇒ it was long
        closed.push({
          symbol: f.symbol,
          direction,
          openedAt: s.openedAt,
          closedAt: f.ts,
          maxQuantity: s.max,
          grossPnl: s.cash,
          fees: s.fees,
          netPnl: s.cash - s.fees,
          currency: s.ccy,
          fills: s.ids,
        });
        state.set(f.symbol, { ...s, net: 0 });
      }
    }
  }

  const openNet = new Map<string, number>();
  for (const [sym, s] of state) if (Math.abs(s.net) > 1e-12) openNet.set(sym, s.net);
  return { closed, openNet };
}

// ---------- crypto-to-crypto swaps ----------

export interface CryptoSwap {
  id: string;
  ts: string;
  pair: string; // e.g. ETHXBT
  side: "BUY" | "SELL"; // side on the base asset
  quantity: number; // base units
  priceInQuote: number;
  fee: number;
  feeAsset: "base" | "quote"; // Kraken lets the user choose the fee currency
}

/**
 * Splits a crypto-to-crypto swap into two EUR-valued legs so both assets keep a
 * consistent FIFO history. For a company, the disposed asset is sold at its EUR
 * fair value on the swap date (taxable event), and the acquired asset enters the
 * books at that same value. The fee, valued in EUR, is attached to the disposal.
 */
export function swapToEurLegs(swap: CryptoSwap, eurPrice: (asset: string, ts: string) => number): [Fill, Fill] {
  const { base, quote } = splitPair(swap.pair);
  const grossQuote = swap.quantity * swap.priceInQuote;
  const valueEur = grossQuote * eurPrice(quote, swap.ts);
  const feeAssetName = swap.feeAsset === "base" ? base : quote;
  const feeEur = swap.fee * eurPrice(feeAssetName, swap.ts);

  // Quantities that actually leave and enter the account.
  let soldAsset: string, soldQty: number, boughtAsset: string, boughtQty: number;
  if (swap.side === "SELL") {
    soldAsset = base;
    soldQty = swap.quantity + (swap.feeAsset === "base" ? swap.fee : 0);
    boughtAsset = quote;
    boughtQty = grossQuote - (swap.feeAsset === "quote" ? swap.fee : 0);
  } else {
    soldAsset = quote;
    soldQty = grossQuote + (swap.feeAsset === "quote" ? swap.fee : 0);
    boughtAsset = base;
    boughtQty = swap.quantity - (swap.feeAsset === "base" ? swap.fee : 0);
  }
  return [
    { id: `${swap.id}-out`, ts: swap.ts, ticker: soldAsset, side: "SELL", quantity: soldQty, price: (valueEur + feeEur) / soldQty, fee: feeEur, currency: "EUR" },
    { id: `${swap.id}-in`, ts: swap.ts, ticker: boughtAsset, side: "BUY", quantity: boughtQty, price: valueEur / boughtQty, fee: 0, currency: "EUR" },
  ];
}
