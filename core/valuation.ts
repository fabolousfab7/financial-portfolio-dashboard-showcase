/**
 * Position valuation and net liquidation value (NLV).
 *
 * The same helper must be used by every code path (live page, nightly snapshot,
 * historical recompute). Inlining `qty × price × fx` "for consistency" is the
 * classic way to break the special cases below.
 *
 * Two families, two formulas:
 *
 *   Cash / spot (STK, ETF, CRYPTO_SPOT)
 *     market value  = qty × price ÷ fx_today
 *     unrealized    = qty × price ÷ fx_today − cost basis in EUR at historical FX
 *     → the FX move between purchase and today is part of the P&L.
 *
 *   Derivatives (FUT, CRYPTO_PERP)
 *     market value  = unrealized mark-to-market only (the notional is NOT an asset;
 *                     the margin sits in the cash balance)
 *     unrealized    = qty × (mark − entry) × multiplier ÷ fx_today
 *
 * Applying the spot formula to a perpetual treats its notional as capital and
 * inflates net worth; applying the derivative formula to a USD stock ignores the
 * currency effect. Hence the explicit branch on asset class.
 */

import type { AssetClass, CashBalance, Position } from "./types";
import type { FxProvider } from "./fx";
import { sum } from "./math";

export function isDerivative(assetClass: AssetClass): boolean {
  return assetClass === "FUT" || assetClass === "CRYPTO_PERP";
}

function ownership(p: Position): number {
  const pct = p.ownershipPct ?? 100;
  if (pct < 0 || pct > 100) throw new Error(`${p.ticker}: ownershipPct out of range`);
  return pct / 100;
}

export function positionUnrealizedEur(p: Position, fx: FxProvider, date: string): number {
  const rate = fx.rate(p.currency, date);
  if (isDerivative(p.assetClass)) {
    const mult = p.multiplier ?? 1;
    return ((p.quantity * (p.marketPrice - p.avgCostNative) * mult) / rate) * ownership(p);
  }
  const marketEur = (p.quantity * p.marketPrice) / rate;
  const costEur =
    p.costBasisEur ??
    (p.currency === "EUR"
      ? p.quantity * p.avgCostNative
      : failMissingCost(p)); // never approximate a foreign cost basis with today's rate
  return (marketEur - costEur) * ownership(p);
}

function failMissingCost(p: Position): never {
  throw new Error(
    `${p.ticker}: costBasisEur is required for a ${p.currency} position — ` +
      `converting the entry price at today's rate would hide the FX effect`,
  );
}

export function positionValueEur(p: Position, fx: FxProvider, date: string): number {
  if (isDerivative(p.assetClass)) return positionUnrealizedEur(p, fx, date);
  return ((p.quantity * p.marketPrice) / fx.rate(p.currency, date)) * ownership(p);
}

export function cashValueEur(c: CashBalance, fx: FxProvider, date: string): number {
  return c.amount / fx.rate(c.currency, date);
}

export interface NlvBreakdown {
  positionsEur: number;
  cashEur: number;
  nlvEur: number;
  unrealizedEur: number;
}

export function computeNlv(
  positions: readonly Position[],
  cash: readonly CashBalance[],
  fx: FxProvider,
  date: string,
): NlvBreakdown {
  const positionsEur = sum(positions.map((p) => positionValueEur(p, fx, date)));
  const cashEur = sum(cash.map((c) => cashValueEur(c, fx, date)));
  const unrealizedEur = sum(positions.map((p) => positionUnrealizedEur(p, fx, date)));
  return { positionsEur, cashEur, nlvEur: positionsEur + cashEur, unrealizedEur };
}
