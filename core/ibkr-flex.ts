/**
 * Interactive Brokers Flex Web Service: client + XML parser.
 *
 * Flex reports are generated asynchronously by IBKR:
 *   1. SendRequest(token, queryId)  → ReferenceCode
 *   2. GetStatement(token, ref)     → the XML report, or "not ready yet" (code 1019)
 * Generating a 365-day report can take longer than a serverless timeout, so the
 * client is split into two NON-blocking phases: the request is stored and the
 * statement is collected on a later pass (next manual sync or nightly cron).
 *
 * Parser notes (learned the hard way):
 * - The open quantity attribute is `position`, not `quantity`.
 * - `positionValue` may be absent: fall back to position × markPrice.
 * - `fifoPnlRealized` is already NET of commission — never deduct the commission again.
 * - Realized P&L is reliable at the CLOSED_LOT level; prefer it over EXECUTION rows.
 * - A degraded report (off-hours, regenerating) can come back with all quantities or
 *   all cost prices at zero. It must never overwrite valid stored data.
 */

import { XMLParser } from "fast-xml-parser";
import type { AssetClass, Currency } from "./types";

// ---------- parsed shapes ----------

export interface FlexOpenPosition {
  accountId: string;
  symbol: string;
  assetClass: AssetClass;
  currency: Currency;
  quantity: number;
  markPrice: number;
  positionValue: number;
  costBasisPrice: number;
  costBasisMoney: number;
  fifoPnlUnrealized: number | null;
  fxRateToBase: number;
  multiplier: number;
}

export interface FlexCash {
  currency: Currency;
  endingCash: number;
}

export interface FlexTrade {
  tradeId: string;
  symbol: string;
  assetClass: AssetClass;
  tradeDate: string; // YYYY-MM-DD
  side: "BUY" | "SELL";
  quantity: number; // positive
  price: number;
  commission: number; // positive cost
  realizedPnl: number; // net of commission, as reported by IBKR
  currency: Currency;
  fxRateToBase: number;
  levelOfDetail: "EXECUTION" | "CLOSED_LOT" | "OTHER";
}

export interface FlexReport {
  accountId: string;
  fromDate: string;
  toDate: string;
  openPositions: FlexOpenPosition[];
  cash: FlexCash[];
  trades: FlexTrade[];
}

// ---------- errors ----------

export type FlexErrorKind =
  | "NOT_READY"
  | "RATE_LIMIT"
  | "INVALID_TOKEN"
  | "QUERY_NOT_FOUND"
  | "PARSE_ERROR"
  | "UNKNOWN";

export class FlexError extends Error {
  constructor(
    readonly kind: FlexErrorKind,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "FlexError";
  }
}

/** Maps IBKR Flex error codes to actionable categories. */
export function classifyFlexError(code: string | null): FlexErrorKind {
  switch (code) {
    case "1019": // statement generation in progress
      return "NOT_READY";
    case "1001": // "could not be generated at this time" — transient, usually cool-down
    case "1018": // too many requests
      return "RATE_LIMIT";
    case "1012": // token expired
    case "1015": // token invalid
      return "INVALID_TOKEN";
    case "1014": // query invalid
      return "QUERY_NOT_FOUND";
    default:
      return "UNKNOWN";
  }
}

// ---------- parsing ----------

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false, // keep raw strings; numbers are parsed explicitly below
  isArray: (name) =>
    ["FlexStatement", "OpenPosition", "CashReportCurrency", "Trade", "Lot"].includes(name),
});

function num(v: unknown): number {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(String(v).replace(/,/g, ""));
  if (!Number.isFinite(n)) throw new FlexError("PARSE_ERROR", null, `Not a number: ${String(v)}`);
  return n;
}

function optNum(v: unknown): number | null {
  return v === undefined || v === null || v === "" ? null : num(v);
}

const ASSET_MAP: Record<string, AssetClass> = {
  STK: "STK",
  ETF: "ETF",
  FUT: "FUT",
  CRYPTO: "CRYPTO_SPOT",
};

function assetClass(category: unknown, subCategory?: unknown): AssetClass {
  if (category === "STK" && subCategory === "ETF") return "ETF";
  const ac = ASSET_MAP[String(category)];
  if (!ac) throw new FlexError("PARSE_ERROR", null, `Unsupported asset category ${String(category)}`);
  return ac;
}

/** IBKR dates come as YYYYMMDD or YYYY-MM-DD, optionally with ;HHMMSS. */
export function normalizeFlexDate(raw: unknown): string {
  const s = String(raw ?? "").split(";")[0]!.trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  throw new FlexError("PARSE_ERROR", null, `Unrecognized Flex date: ${s}`);
}

type Attrs = Record<string, string | undefined>;

export function parseFlexReport(xml: string): FlexReport {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch (e) {
    throw new FlexError("PARSE_ERROR", null, `Invalid XML: ${(e as Error).message}`);
  }

  const status = doc.FlexStatementResponse as Record<string, string> | undefined;
  if (status?.Status === "Fail") {
    const code = status.ErrorCode ? String(status.ErrorCode) : null;
    throw new FlexError(classifyFlexError(code), code, String(status.ErrorMessage ?? "Flex failure"));
  }

  const root = doc.FlexQueryResponse as Record<string, unknown> | undefined;
  const statements = (root?.FlexStatements as Record<string, unknown> | undefined)?.FlexStatement as
    | Record<string, unknown>[]
    | undefined;
  const st = statements?.[0];
  if (!st) throw new FlexError("PARSE_ERROR", null, "No FlexStatement in report");
  const stAttrs = st as unknown as Attrs;

  const rawPositions = ((st.OpenPositions as Record<string, unknown> | undefined)?.OpenPosition ??
    []) as Attrs[];
  const openPositions: FlexOpenPosition[] = rawPositions.map((p) => {
    const quantity = num(p.position ?? p.quantity);
    const markPrice = num(p.markPrice);
    return {
      accountId: String(p.accountId ?? stAttrs.accountId),
      symbol: String(p.symbol),
      assetClass: assetClass(p.assetCategory, p.subCategory),
      currency: String(p.currency) as Currency,
      quantity,
      markPrice,
      positionValue: num(p.positionValue) || quantity * markPrice * num(p.multiplier || 1),
      costBasisPrice: num(p.costBasisPrice),
      costBasisMoney: num(p.costBasisMoney),
      fifoPnlUnrealized: optNum(p.fifoPnlUnrealized),
      fxRateToBase: num(p.fxRateToBase || 1),
      multiplier: num(p.multiplier || 1),
    };
  });

  const rawCash = ((st.CashReport as Record<string, unknown> | undefined)?.CashReportCurrency ??
    []) as Attrs[];
  const cash: FlexCash[] = rawCash
    .filter((c) => c.currency && c.currency !== "BASE_SUMMARY")
    .map((c) => ({ currency: String(c.currency) as Currency, endingCash: num(c.endingCash) }));

  const rawTrades = ((st.Trades as Record<string, unknown> | undefined)?.Trade ?? []) as Attrs[];
  const trades: FlexTrade[] = rawTrades.map((t) => {
    const lod = String(t.levelOfDetail ?? "EXECUTION");
    return {
      tradeId: String(t.tradeID ?? t.transactionID),
      symbol: String(t.symbol),
      assetClass: assetClass(t.assetCategory, t.subCategory),
      tradeDate: normalizeFlexDate(t.tradeDate),
      side: String(t.buySell).startsWith("SELL") ? "SELL" : "BUY",
      quantity: Math.abs(num(t.quantity)),
      price: num(t.tradePrice),
      commission: Math.abs(num(t.ibCommission)),
      realizedPnl: num(t.fifoPnlRealized),
      currency: String(t.currency) as Currency,
      fxRateToBase: num(t.fxRateToBase || 1),
      levelOfDetail: lod === "EXECUTION" || lod === "CLOSED_LOT" ? lod : "OTHER",
    };
  });

  return {
    accountId: String(stAttrs.accountId),
    fromDate: normalizeFlexDate(stAttrs.fromDate),
    toDate: normalizeFlexDate(stAttrs.toDate),
    openPositions,
    cash,
    trades,
  };
}

// ---------- data-quality guards ----------

export interface ReportQuality {
  hasRealPositions: boolean;
  hasValidCostData: boolean;
  hasCash: boolean;
  /** True when the report may replace stored positions. */
  safeToReplacePositions: boolean;
  issues: string[];
}

/**
 * A degraded report must never destroy valid data. The caller only replaces stored
 * positions when this returns `safeToReplacePositions`.
 */
export function assessReportQuality(r: FlexReport): ReportQuality {
  const issues: string[] = [];
  const nonZero = r.openPositions.filter((p) => p.quantity !== 0);
  const hasRealPositions = r.openPositions.length === 0 || nonZero.length > 0;
  if (!hasRealPositions) issues.push("All open positions have quantity 0 (degraded report)");

  const hasValidCostData = nonZero.length === 0 || nonZero.some((p) => p.costBasisPrice !== 0);
  if (!hasValidCostData) issues.push("All cost basis prices are 0 (partial report)");

  const hasCash = r.cash.length > 0;
  if (!hasCash) issues.push("Cash report is empty — keep stored cash balances");

  return {
    hasRealPositions,
    hasValidCostData,
    hasCash,
    safeToReplacePositions: hasRealPositions && hasValidCostData,
    issues,
  };
}

/**
 * Realized P&L per trade: CLOSED_LOT rows when the query includes them,
 * EXECUTION rows otherwise. Commission is informative only.
 */
export function realizedTrades(r: FlexReport): FlexTrade[] {
  const closedLots = r.trades.filter((t) => t.levelOfDetail === "CLOSED_LOT");
  const source = closedLots.length > 0 ? closedLots : r.trades.filter((t) => t.levelOfDetail === "EXECUTION");
  return source.filter((t) => t.realizedPnl !== 0);
}

// ---------- two-phase client ----------

export type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<{ text(): Promise<string> }>;

const FLEX_BASE = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService";

/** Every HTTP call is bounded: a hanging IBKR endpoint must not hold a serverless function. */
async function getText(fetcher: Fetcher, url: string, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { signal: ctrl.signal });
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Phase 1 — ask IBKR to start generating the report. Returns the reference code. */
export async function requestFlexReport(
  fetcher: Fetcher,
  token: string,
  queryId: string,
  timeoutMs = 12_000,
): Promise<string> {
  const url = `${FLEX_BASE}/SendRequest?t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}&v=3`;
  const raw = await getText(fetcher, url, timeoutMs);
  const res = (parser.parse(raw) as Record<string, Record<string, string>>).FlexStatementResponse;
  if (res?.Status !== "Success" || !res.ReferenceCode) {
    const code = res?.ErrorCode ? String(res.ErrorCode) : null;
    throw new FlexError(classifyFlexError(code), code, String(res?.ErrorMessage ?? "SendRequest failed"));
  }
  return String(res.ReferenceCode);
}

export type RetrieveResult = { ready: true; report: FlexReport } | { ready: false; reason: FlexErrorKind };

/** Phase 2 — single, non-blocking attempt to collect the report. */
export async function retrieveFlexReport(
  fetcher: Fetcher,
  token: string,
  referenceCode: string,
  timeoutMs = 12_000,
): Promise<RetrieveResult> {
  const url = `${FLEX_BASE}/GetStatement?t=${encodeURIComponent(token)}&q=${encodeURIComponent(referenceCode)}&v=3`;
  const raw = await getText(fetcher, url, timeoutMs);
  try {
    return { ready: true, report: parseFlexReport(raw) };
  } catch (e) {
    if (e instanceof FlexError && (e.kind === "NOT_READY" || e.kind === "RATE_LIMIT")) {
      return { ready: false, reason: e.kind };
    }
    throw e;
  }
}
