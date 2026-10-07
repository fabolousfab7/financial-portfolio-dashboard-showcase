/**
 * Runs the financial engine over the fictional raw inputs and returns everything
 * the dashboard displays. Isomorphic: used by the React app (in the browser), the
 * Express API and the tests. Raw broker files are passed in as strings.
 */

import { computeFifo, type RealizedTrade } from "../core/fifo";
import { TableFxProvider, toEur, type FxProvider } from "../core/fx";
import { assessReportQuality, parseFlexReport, realizedTrades, type ReportQuality } from "../core/ibkr-flex";
import { aggregateRoundTrips, classifyPair, swapToEurLegs, type RoundTrip } from "../core/kraken";
import { round, sum } from "../core/math";
import { parseQontoCsv, type BankTransaction } from "../core/qonto";
import { reconcile, type Match } from "../core/reconciliation";
import { consolidate, periodPerformance, type CashFlow, type Snapshot } from "../core/timeseries";
import type { CashBalance, Fill, Position } from "../core/types";
import { computeNlv, isDerivative, positionUnrealizedEur, positionValueEur } from "../core/valuation";
import { computeVatYear, type VatReturn } from "../core/vat";
import { verifyExtraction, type VerifiedExtraction } from "../core/invoice-extraction";
import { buildWealthReport, type Holding, type WealthReport } from "../core/wealth";
import * as F from "./fixtures";

// ---------- output types ----------

export interface AccountRow {
  id: string;
  name: string;
  entity: "holding" | "personal";
  source: string;
  nlvEur: number;
  cashEur: number;
  positionsEur: number;
  ytdPnlEur: number;
  syncStatus: "ok" | "partial" | "manual";
  syncNote: string;
}

export interface PositionRow {
  accountId: string;
  accountName: string;
  ticker: string;
  assetClass: Position["assetClass"];
  quantity: number;
  price: number;
  currency: string;
  valueEur: number;
  unrealizedEur: number;
  ownershipPct: number;
}

export interface RealizedRow {
  id: string;
  accountId: string;
  ticker: string;
  date: string;
  quantity: number;
  currency: string;
  netPnlNative: number | null;
  netPnlEur: number | null; // FX per leg
  fxEffectEur: number | null; // part of the EUR P&L caused by the currency move
  holdingDays: number | null;
  lots: { buyId: string; buyDate: string; quantity: number; price: number }[];
}

export interface Check {
  name: string;
  expected: number;
  actual: number;
  pass: boolean;
}

export interface DemoDataset {
  disclaimer: string;
  entityName: string;
  asOf: string;
  yearStart: string;
  kpis: {
    portfolioValueEur: number;
    cashEur: number;
    ytdPnlEur: number;
    ytdReturnModifiedDietz: number | null;
    realizedYtdEur: number;
    unrealizedEur: number;
    externalFlowsYtdEur: number;
  };
  accounts: AccountRow[];
  series: { date: string; total: number; byAccount: Record<string, number> }[];
  positions: PositionRow[];
  realized: RealizedRow[];
  realizedByTicker: { ticker: string; netPnlEur: number; trades: number }[];
  brokerCrossCheck: { ticker: string; engineNative: number; brokerReported: number; difference: number }[];
  perpRoundTrips: (RoundTrip & { netPnlEur: number })[];
  swapRegister: { id: string; date: string; pair: string; disposed: string; acquired: string; valueEur: number; realizedEur: number | null }[];
  flexQuality: ReportQuality;
  bank: { transactions: BankTransaction[]; balanceEur: number; qualified: { reference: string; account: string; label: string }[] };
  reconciliation: { matches: (Match & { invoice: string; party: string; amount: number })[]; suggestions: (Match & { invoice: string; party: string; amount: number })[]; unmatchedInvoices: string[]; unmatchedTransactions: string[] };
  vat: VatReturn[];
  extractions: (VerifiedExtraction & { file: string })[];
  wealth: WealthReport;
  checks: Check[];
}

// ---------- helpers ----------

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** Seeded daily snapshots pinned at both ends (opening value and engine NLV). */
function generateSnapshots(accountId: string, endNlv: number, seed: number): Snapshot[] {
  const plan = F.SNAPSHOT_PLAN[accountId]!;
  const days: string[] = [];
  for (let d = F.YEAR_START; d <= F.AS_OF; ) {
    days.push(d);
    const n = new Date(`${d}T00:00:00Z`);
    n.setUTCDate(n.getUTCDate() + 1);
    d = n.toISOString().slice(0, 10);
  }
  const N = days.length - 1;
  const rand = mulberry32(seed);
  const walk = [0];
  for (let i = 1; i <= N; i++) walk.push(walk[i - 1]! + gaussian(rand));
  const sigma = plan.opening * plan.dailyVol;
  const missing = new Set(F.MISSING_SNAPSHOTS[accountId] ?? []);
  const out: Snapshot[] = [];
  days.forEach((date, i) => {
    if (missing.has(date)) return;
    const bridge = walk[i]! - (i / N) * walk[N]!;
    const flows = plan.flows.filter((f) => f.date <= date).reduce((s, f) => s + f.amountEur, 0);
    // Qonto has no market risk: its P&L is the step function of booked expenses.
    const pnl = (i / N) * plan.ytdPnl + sigma * bridge;
    let value = plan.opening + flows + pnl;
    if (i === N) value = endNlv;
    out.push({ accountId, date, nlvEur: round(value, 2) });
  });
  return out;
}

function realizedRows(accountId: string, trades: RealizedTrade[], fills: Fill[], fx: FxProvider): RealizedRow[] {
  const byId = new Map(fills.map((f) => [f.id, f]));
  return trades.map((t) => {
    const lots = t.matchedLots.map((l) => {
      const buy = byId.get(l.buyFillId)!;
      return { buyId: l.buyFillId, buyDate: buy.ts.slice(0, 10), quantity: l.quantity, price: l.price, fee: (buy.fee / buy.quantity) * l.quantity };
    });
    let netEur: number | null = null;
    let fxEffect: number | null = null;
    if (t.netPnl !== null) {
      const sellDate = t.ts.slice(0, 10);
      const sellFee = byId.get(t.sellFillId)!.fee;
      const proceedsEur = toEur(fx, t.proceeds - sellFee, t.currency, sellDate);
      const costEur = sum(lots.map((l) => toEur(fx, l.quantity * l.price + l.fee, t.currency, l.buyDate)));
      netEur = proceedsEur - costEur;
      fxEffect = netEur - toEur(fx, t.netPnl, t.currency, sellDate);
    }
    return {
      id: t.sellFillId, accountId, ticker: t.ticker, date: t.ts.slice(0, 10), quantity: t.quantity, currency: t.currency,
      netPnlNative: t.netPnl, netPnlEur: netEur, fxEffectEur: fxEffect, holdingDays: t.holdingDays,
      lots: lots.map(({ fee: _fee, ...l }) => l),
    };
  });
}

// ---------- build ----------

export function buildDemoDataset(input: { flexXml: string }): DemoDataset {
  const fx = new TableFxProvider(F.buildFxTable());
  const asOf = F.AS_OF;
  const checks: Check[] = [];
  const check = (name: string, expected: number, actual: number, tol = 0.01) =>
    checks.push({ name, expected: round(expected), actual: round(actual), pass: Math.abs(expected - actual) <= tol });

  // --- IBKR: parse the Flex XML statement ---
  const flex = parseFlexReport(input.flexXml);
  const flexQuality = assessReportQuality(flex);
  const ibkrExecFills: Fill[] = flex.trades
    .filter((t) => t.levelOfDetail === "EXECUTION")
    .map((t) => ({ id: t.tradeId, ts: `${t.tradeDate}T00:00:00Z`, ticker: t.symbol, side: t.side, quantity: t.quantity, price: t.price, fee: t.commission, currency: t.currency }));
  const ibkrFifo = computeFifo(ibkrExecFills);
  const ibkrPositions: Position[] = flex.openPositions.map((p) => {
    if (p.assetClass === "FUT") {
      return { accountId: "ibkr", ticker: p.symbol, assetClass: "FUT", quantity: p.quantity, marketPrice: p.markPrice, currency: p.currency, avgCostNative: p.costBasisPrice, multiplier: p.multiplier };
    }
    // Cost basis in EUR at the FX of each purchase date (FX per leg).
    const open = ibkrFifo.open.find((o) => o.ticker === p.symbol)!;
    const costBasisEur = sum(open.lots.map((l) => toEur(fx, l.quantity * (l.price + l.feePerUnit), p.currency, l.ts.slice(0, 10))));
    return { accountId: "ibkr", ticker: p.symbol, assetClass: p.assetClass, quantity: p.quantity, marketPrice: p.markPrice, currency: p.currency, avgCostNative: p.costBasisPrice, costBasisEur };
  });
  const ibkrCash: CashBalance[] = flex.cash.map((c) => ({ accountId: "ibkr", currency: c.currency, amount: c.endingCash }));

  // Engine vs broker: our FIFO must reproduce IBKR's own fifoPnlRealized.
  const brokerByTicker = new Map<string, number>();
  for (const t of realizedTrades(flex)) brokerByTicker.set(t.symbol, (brokerByTicker.get(t.symbol) ?? 0) + t.realizedPnl);
  const brokerCrossCheck = [...brokerByTicker].map(([ticker, broker]) => {
    const engine = sum(ibkrFifo.realized.filter((r) => r.ticker === ticker).map((r) => r.netPnl ?? 0));
    return { ticker, engineNative: round(engine), brokerReported: round(broker), difference: round(engine - broker) };
  });

  // --- Kraken Spot: fiat-quoted fills + crypto-to-crypto swaps as EUR legs ---
  const eurPrice = (asset: string, ts: string) => {
    const p = F.CRYPTO_EUR_PRICES[ts.slice(0, 10)]?.[asset];
    if (p === undefined) throw new Error(`No EUR price for ${asset} on ${ts}`);
    return p;
  };
  const swapLegs = F.KRAKEN_SWAPS.flatMap((s) => {
    if (classifyPair(s.pair) !== "crypto_crypto_swap") throw new Error(`${s.pair} is not a swap`);
    return swapToEurLegs(s, eurPrice);
  });
  const krakenFills = [...F.KRAKEN_SPOT_FILLS, ...swapLegs];
  const krakenFifo = computeFifo(krakenFills);
  const krakenPositions: Position[] = krakenFifo.open.map((o) => ({
    accountId: "kraken_spot", ticker: o.ticker, assetClass: "CRYPTO_SPOT", quantity: o.quantity,
    marketPrice: F.KRAKEN_SPOT_MARKET[o.ticker]!, currency: "EUR", avgCostNative: o.avgCost, costBasisEur: o.costBasis,
  }));
  const swapRegister = F.KRAKEN_SWAPS.map((s) => {
    const out = krakenFifo.realized.find((r) => r.sellFillId === `${s.id}-out`)!;
    const inn = swapLegs.find((l) => l.id === `${s.id}-in`)!;
    return {
      id: s.id, date: s.ts.slice(0, 10), pair: s.pair,
      disposed: `${round(out.quantity, 6)} ${out.ticker}`, acquired: `${round(inn.quantity, 6)} ${inn.ticker}`,
      valueEur: round(inn.quantity * inn.price), realizedEur: out.netPnl === null ? null : round(out.netPnl),
    };
  });

  // --- Kraken Futures: round-trips + open position ---
  const rt = aggregateRoundTrips(F.KRAKEN_PERP_FILLS);
  const perpRoundTrips = rt.closed.map((r) => ({ ...r, netPnlEur: round(toEur(fx, r.netPnl, r.currency, r.closedAt.slice(0, 10))) }));
  const lastClose = rt.closed.at(-1)?.closedAt ?? "";
  const perpPositions: Position[] = [...rt.openNet].map(([symbol, net]) => {
    const openFills = F.KRAKEN_PERP_FILLS.filter((f) => f.symbol === symbol && f.ts > lastClose);
    const entry = sum(openFills.map((f) => f.quantity * f.price)) / sum(openFills.map((f) => f.quantity));
    return { accountId: "kraken_futures", ticker: symbol, assetClass: "CRYPTO_PERP", quantity: net, marketPrice: F.KRAKEN_PERP_MARK[symbol]!, currency: "USD", avgCostNative: entry };
  });

  // --- Qonto: CSV import, qualification, reconciliation ---
  const csv = parseQontoCsv(F.QONTO_CSV);
  if (csv.errors.length) throw new Error(`Qonto CSV errors: ${JSON.stringify(csv.errors)}`);
  const qontoBalance = F.QONTO_OPENING_BALANCE + sum(csv.transactions.map((t) => t.amount));
  const qualified = csv.transactions.flatMap((t) => {
    const rule = F.QUALIFICATION_RULES.find((r) => r.match.test(`${t.counterparty} ${t.label}`));
    return rule ? [{ reference: t.reference, account: rule.account, label: rule.label }] : [];
  });
  const qualifiedRefs = new Set(qualified.map((q) => q.reference));
  const rec = reconcile(F.INVOICES, csv.transactions.filter((t) => !qualifiedRefs.has(t.reference)));
  const invoiceById = new Map(F.INVOICES.map((i) => [i.id, i]));
  const decorate = (m: Match) => {
    const inv = invoiceById.get(m.invoiceId)!;
    return { ...m, invoice: inv.number, party: inv.party, amount: inv.totalEur };
  };

  // --- all positions & cash ---
  const positions: Position[] = [...ibkrPositions, ...krakenPositions, ...perpPositions, ...F.MANUAL_POSITIONS];
  const cash: CashBalance[] = [...ibkrCash, ...F.KRAKEN_SPOT_CASH, ...F.KRAKEN_FUTURES_CASH, { accountId: "qonto", currency: "EUR", amount: qontoBalance }, ...F.MANUAL_CASH];

  // --- accounts, snapshots, performance ---
  const snapshots: Snapshot[] = [];
  const accounts: AccountRow[] = F.ACCOUNTS.map((a, idx) => {
    const nlv = computeNlv(positions.filter((p) => p.accountId === a.id), cash.filter((c) => c.accountId === a.id), fx, asOf);
    const plan = F.SNAPSHOT_PLAN[a.id]!;
    const planned = plan.opening + sum(plan.flows.map((f) => f.amountEur)) + plan.ytdPnl;
    check(`${a.name}: snapshot plan end value = engine NLV`, planned, nlv.nlvEur);
    snapshots.push(...generateSnapshots(a.id, nlv.nlvEur, 1000 + idx * 97));
    const syncStatus: AccountRow["syncStatus"] = a.source === "manual" ? "manual" : a.source === "kraken_futures" ? "partial" : "ok";
    const syncNote =
      syncStatus === "manual" ? "Positions entered manually; prices refreshed nightly"
        : syncStatus === "partial" ? "Prices fresh — position sync retried at next run (API timeout)"
          : a.source === "qonto_csv" ? "Balance rebuilt from imported CSV" : "Synced";
    return {
      id: a.id, name: a.name, entity: a.entity, source: a.source, nlvEur: nlv.nlvEur, cashEur: nlv.cashEur,
      positionsEur: nlv.positionsEur, ytdPnlEur: nlv.nlvEur - plan.opening - sum(plan.flows.map((f) => f.amountEur)), syncStatus, syncNote,
    };
  });

  const series = consolidate(snapshots, F.YEAR_START, asOf);
  const externalFlows: CashFlow[] = Object.entries(F.SNAPSHOT_PLAN).flatMap(([accountId, p]) =>
    p.flows.filter((f) => f.external).map((f) => ({ accountId, date: f.date, amountEur: f.amountEur })),
  );
  const startTotal = series[0]!.total;
  const endTotal = series.at(-1)!.total;
  const perf = periodPerformance(startTotal, endTotal, externalFlows, F.YEAR_START, asOf);

  const portfolioValue = sum(accounts.map((a) => a.nlvEur));
  const cashTotal = sum(accounts.map((a) => a.cashEur));
  check("Consolidated series end = sum of account NLVs", portfolioValue, endTotal);
  check("YTD P&L = Σ account YTD P&L", sum(accounts.map((a) => a.ytdPnlEur)), perf.pnl);
  check("Qonto balance = opening + Σ CSV movements", 11250, qontoBalance);
  for (const b of brokerCrossCheck) check(`FIFO engine vs IBKR fifoPnlRealized — ${b.ticker}`, b.brokerReported, b.engineNative);

  // --- position rows ---
  const accountName = new Map(F.ACCOUNTS.map((a) => [a.id, a.name]));
  const positionRows: PositionRow[] = positions.map((p) => ({
    accountId: p.accountId, accountName: accountName.get(p.accountId)!, ticker: p.ticker, assetClass: p.assetClass,
    quantity: p.quantity, price: p.marketPrice, currency: p.currency, valueEur: positionValueEur(p, fx, asOf),
    unrealizedEur: positionUnrealizedEur(p, fx, asOf), ownershipPct: p.ownershipPct ?? 100,
  })).sort((a, b) => b.valueEur - a.valueEur);

  // --- realized ---
  const realized = [
    ...realizedRows("ibkr", ibkrFifo.realized, ibkrExecFills, fx),
    ...realizedRows("kraken_spot", krakenFifo.realized, krakenFills, fx),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const tickerMap = new Map<string, { netPnlEur: number; trades: number }>();
  for (const r of realized) {
    if (r.netPnlEur === null) continue;
    const e = tickerMap.get(r.ticker) ?? { netPnlEur: 0, trades: 0 };
    e.netPnlEur += r.netPnlEur;
    e.trades += 1;
    tickerMap.set(r.ticker, e);
  }
  for (const r of perpRoundTrips) {
    const e = tickerMap.get(r.symbol) ?? { netPnlEur: 0, trades: 0 };
    e.netPnlEur += r.netPnlEur;
    e.trades += 1;
    tickerMap.set(r.symbol, e);
  }
  const realizedByTicker = [...tickerMap].map(([ticker, v]) => ({ ticker, netPnlEur: round(v.netPnlEur), trades: v.trades })).sort((a, b) => b.netPnlEur - a.netPnlEur);

  // --- VAT ---
  const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09"].map((m) => ({
    period: `2026-${m}`,
    lines: F.INVOICES.filter((i) => i.date.startsWith(`2026-${m}`)).map((i) => ({
      id: i.number, date: i.date, direction: i.direction, regime: i.regime, baseEur: i.baseEur, vatRate: i.vatRate, vatChargedEur: i.vatEur,
    })),
    requestRefund: false,
  }));
  const vat = computeVatYear(months, 0);

  // --- AI extraction verification ---
  const extractions = F.RECORDED_EXTRACTIONS.map((e) => ({ file: e.file, ...verifyExtraction(e.modelOutput, asOf) }));

  // --- wealth ---
  const holdings: Holding[] = [
    ...positionRows.map((p) => {
      const entity = F.ACCOUNTS.find((a) => a.id === p.accountId)!.entity;
      return {
        accountId: p.accountId, label: p.ticker, entity,
        bucket: isDerivative(p.assetClass) ? ("derivatives" as const) : p.assetClass === "CRYPTO_SPOT" ? ("crypto" as const) : ("equities" as const),
        valueEur: p.valueEur, unrealizedGainEur: p.unrealizedEur,
        taxWrapper: entity === "holding" ? ("corporate" as const) : p.accountId === "pea" ? ("pea" as const) : ("crypto_personal" as const),
      };
    }),
    ...accounts.map((a) => ({ accountId: a.id, label: `${a.name} cash`, entity: a.entity, bucket: "cash" as const, valueEur: a.cashEur, unrealizedGainEur: 0, taxWrapper: a.entity === "holding" ? ("corporate" as const) : ("cash" as const) })),
  ];
  const wealth = buildWealthReport(holdings, F.TAX_ASSUMPTIONS);

  return {
    disclaimer: F.DEMO_DISCLAIMER,
    entityName: F.ENTITY_NAME,
    asOf,
    yearStart: F.YEAR_START,
    kpis: {
      portfolioValueEur: portfolioValue,
      cashEur: cashTotal,
      ytdPnlEur: perf.pnl,
      ytdReturnModifiedDietz: perf.modifiedDietz,
      realizedYtdEur: sum(realized.map((r) => r.netPnlEur ?? 0)) + sum(perpRoundTrips.map((r) => r.netPnlEur)),
      unrealizedEur: sum(positionRows.map((p) => p.unrealizedEur)),
      externalFlowsYtdEur: perf.netFlows,
    },
    accounts,
    series,
    positions: positionRows,
    realized,
    realizedByTicker,
    brokerCrossCheck,
    perpRoundTrips,
    swapRegister,
    flexQuality,
    bank: { transactions: csv.transactions, balanceEur: qontoBalance, qualified },
    reconciliation: { matches: rec.matches.map(decorate), suggestions: rec.suggestions.map(decorate), unmatchedInvoices: rec.unmatchedInvoices.map((id) => invoiceById.get(id)!.number), unmatchedTransactions: rec.unmatchedTransactions },
    vat,
    extractions,
    wealth,
    checks,
  };
}
