/**
 * Wealth reporting: consolidated view across legal entities and asset classes,
 * with an indicative after-tax liquidation value.
 *
 * Tax parameters are inputs, not constants: they change with legislation and with
 * the holder's situation, and the report states which assumptions it used.
 */

import type { Entity } from "./types";

export interface Holding {
  accountId: string;
  label: string;
  entity: Entity;
  bucket: "equities" | "crypto" | "cash" | "derivatives";
  valueEur: number;
  unrealizedGainEur: number;
  /** Tax wrapper key used to look up the applicable assumption. */
  taxWrapper: "corporate" | "pea" | "crypto_personal" | "cash";
}

export interface TaxAssumptions {
  /** Effective rate applied to gains when realized, per wrapper. */
  gainRate: Record<Holding["taxWrapper"], number>;
  /** Additional rate when distributing corporate equity to the shareholder. */
  distributionRate: number;
  label: string;
}

export interface WealthReport {
  grossEur: number;
  byEntity: Record<Entity, number>;
  byBucket: Record<Holding["bucket"], number>;
  indicativeNetEur: number;
  assumptions: string;
}

export function buildWealthReport(holdings: readonly Holding[], tax: TaxAssumptions): WealthReport {
  const byEntity: Record<Entity, number> = { holding: 0, personal: 0 };
  const byBucket: Record<Holding["bucket"], number> = { equities: 0, crypto: 0, cash: 0, derivatives: 0 };
  let gross = 0;
  let net = 0;
  for (const h of holdings) {
    gross += h.valueEur;
    byEntity[h.entity] += h.valueEur;
    byBucket[h.bucket] += h.valueEur;
    const gainTax = Math.max(0, h.unrealizedGainEur) * tax.gainRate[h.taxWrapper];
    let afterTax = h.valueEur - gainTax;
    if (h.entity === "holding") afterTax *= 1 - tax.distributionRate;
    net += afterTax;
  }
  return { grossEur: gross, byEntity, byBucket, indicativeNetEur: net, assumptions: tax.label };
}
