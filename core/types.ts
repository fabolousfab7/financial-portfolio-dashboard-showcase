/**
 * Shared domain types for the financial engine.
 *
 * Conventions
 * - Dates are ISO strings (`YYYY-MM-DD` for value dates, full ISO for timestamps).
 * - Amounts are plain numbers in the currency stated next to them. Conversion to
 *   the reporting currency (EUR) is always explicit and always happens per line,
 *   before any aggregation (see `fx.ts`).
 */

export type Iso4217 = "EUR" | "USD" | "GBP" | "CHF" | "JPY";
/** Stablecoins are tracked separately but valued as USD (documented assumption). */
export type Stablecoin = "USDT" | "USDC" | "DAI";
export type Currency = Iso4217 | Stablecoin;

export type AssetClass =
  | "STK" // listed equity
  | "ETF"
  | "FUT" // exchange-traded future
  | "CRYPTO_SPOT"
  | "CRYPTO_PERP"; // perpetual swap

export type Side = "BUY" | "SELL";

/** A single execution, as normalized from any broker or exchange. */
export interface Fill {
  id: string;
  ts: string;
  ticker: string;
  side: Side;
  quantity: number; // always positive
  price: number; // per unit, in `currency`
  fee: number; // always positive, in `currency`
  currency: Currency;
}

export interface Position {
  accountId: string;
  ticker: string;
  assetClass: AssetClass;
  quantity: number; // signed for derivatives (short < 0)
  marketPrice: number; // native currency
  currency: Currency;
  /** Entry price in native currency (cost basis price). */
  avgCostNative: number;
  /**
   * Cost basis in EUR at the historical FX rate of each purchase.
   * Required for cash/spot assets held in a foreign currency; ignored for derivatives.
   */
  costBasisEur?: number;
  /** Contract multiplier for futures (e.g. 5 for MES). Defaults to 1. */
  multiplier?: number;
  /** Share of the position economically owned (jointly held assets). Defaults to 100. */
  ownershipPct?: number;
}

export interface CashBalance {
  accountId: string;
  currency: Currency;
  amount: number;
}

export type Entity = "holding" | "personal";

export interface Account {
  id: string;
  name: string;
  entity: Entity;
  source: "ibkr_flex" | "kraken_spot" | "kraken_futures" | "qonto_csv" | "manual";
  baseCurrency: Currency;
}
