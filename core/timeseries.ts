/**
 * Portfolio time series and performance measurement.
 *
 * - Daily NLV snapshots per account, aggregated into a consolidated series.
 *   A missing snapshot carries the account's last known value forward; summing
 *   with a gap would make the total drop to zero for a day and explode the variation.
 * - P&L over a period strips external cash flows (deposits, withdrawals):
 *     P&L = NLV_end − NLV_start − net external flows
 * - Return over a period uses Modified Dietz, which time-weights the flows:
 *     R = P&L / (NLV_start + Σ w_i · F_i),  w_i = (T − t_i) / T
 */

import { shiftDate } from "./fx";

export interface Snapshot {
  accountId: string;
  date: string; // YYYY-MM-DD
  nlvEur: number;
}

export interface CashFlow {
  accountId: string;
  date: string;
  amountEur: number; // + deposit into the portfolio, − withdrawal
}

export interface SeriesPoint {
  date: string;
  total: number;
  byAccount: Record<string, number>;
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = shiftDate(d, 1)) out.push(d);
  return out;
}

export function consolidate(snapshots: readonly Snapshot[], from: string, to: string): SeriesPoint[] {
  const byDate = new Map<string, Map<string, number>>();
  const accounts = new Set<string>();
  for (const s of snapshots) {
    accounts.add(s.accountId);
    if (!byDate.has(s.date)) byDate.set(s.date, new Map());
    byDate.get(s.date)!.set(s.accountId, s.nlvEur);
  }
  const last = new Map<string, number>();
  // Seed with the latest value strictly before `from`.
  for (const s of [...snapshots].filter((s) => s.date < from).sort((a, b) => a.date.localeCompare(b.date))) {
    last.set(s.accountId, s.nlvEur);
  }
  return dateRange(from, to).map((date) => {
    const today = byDate.get(date);
    for (const a of accounts) {
      const v = today?.get(a);
      if (v !== undefined) last.set(a, v);
    }
    const byAccount: Record<string, number> = {};
    let total = 0;
    for (const a of accounts) {
      const v = last.get(a);
      if (v === undefined) continue; // account not opened yet
      byAccount[a] = v;
      total += v;
    }
    return { date, total, byAccount };
  });
}

export interface PeriodPerformance {
  startValue: number;
  endValue: number;
  netFlows: number;
  pnl: number;
  modifiedDietz: number | null;
}

export function periodPerformance(
  startValue: number,
  endValue: number,
  flows: readonly { date: string; amountEur: number }[],
  from: string,
  to: string,
): PeriodPerformance {
  const T = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  const inPeriod = flows.filter((f) => f.date > from && f.date <= to);
  const netFlows = inPeriod.reduce((s, f) => s + f.amountEur, 0);
  const pnl = endValue - startValue - netFlows;
  const weighted = inPeriod.reduce((s, f) => s + f.amountEur * ((Date.parse(to) - Date.parse(f.date)) / 86_400_000 / T), 0);
  const denom = startValue + weighted;
  return { startValue, endValue, netFlows, pnl, modifiedDietz: T > 0 && denom > 0 ? pnl / denom : null };
}

/**
 * Variation for a chart window. The plotted window and the reference point are
 * distinct: "24h" compares today with D-1, not with the first point of a 2-day window.
 */
export function windowVariation(series: readonly SeriesPoint[], referenceDays: number): { abs: number; pct: number | null } | null {
  const end = series.at(-1);
  if (!end) return null;
  const refDate = shiftDate(end.date, -referenceDays);
  const ref = [...series].reverse().find((p) => p.date <= refDate);
  if (!ref) return null;
  const abs = end.total - ref.total;
  return { abs, pct: ref.total !== 0 ? abs / ref.total : null };
}
