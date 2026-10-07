/**
 * DEMO FIXTURES — 100 % FICTIONAL.
 *
 * Every account, amount, price, supplier and transaction in this file is invented
 * for demonstration. Tickers are used for realism only; their prices here are not
 * market data. Nothing in this repository comes from a real portfolio.
 *
 * The figures are calibrated so that the engine, run over these raw inputs,
 * produces round headline numbers (portfolio value, cash, YTD P&L).
 */

import type { Account, CashBalance, Fill, Position } from "../core/types";
import type { CryptoSwap, PerpFill } from "../core/kraken";
import type { Invoice } from "../core/reconciliation";
import type { VatInvoiceLine } from "../core/vat";
import type { InvoiceExtraction } from "../core/invoice-extraction";
import type { FxTable } from "../core/fx";
import { dateRange } from "../core/timeseries";

export const DEMO_DISCLAIMER = "Demo data — no real financial information.";
export const ENTITY_NAME = "Demo Holding SAS";
export const YEAR_START = "2025-12-31"; // reference date for YTD figures
export const AS_OF = "2026-09-30";

// ---------- accounts ----------

export const ACCOUNTS: Account[] = [
  { id: "ibkr", name: "Interactive Brokers", entity: "holding", source: "ibkr_flex", baseCurrency: "EUR" },
  { id: "kraken_spot", name: "Kraken Spot", entity: "holding", source: "kraken_spot", baseCurrency: "EUR" },
  { id: "kraken_futures", name: "Kraken Futures", entity: "holding", source: "kraken_futures", baseCurrency: "EUR" },
  { id: "qonto", name: "Qonto business account", entity: "holding", source: "qonto_csv", baseCurrency: "EUR" },
  { id: "pea", name: "Equity savings plan (PEA)", entity: "personal", source: "manual", baseCurrency: "EUR" },
  { id: "self_custody", name: "Self-custody wallets", entity: "personal", source: "manual", baseCurrency: "EUR" },
  { id: "joint_wallet", name: "Joint wallet (50 %)", entity: "personal", source: "manual", baseCurrency: "EUR" },
];

// ---------- FX: EURUSD, ECB convention (1 EUR = x USD), business days only ----------

export function buildFxTable(): FxTable {
  const table: FxTable = {};
  const days = dateRange("2025-12-01", AS_OF);
  const n = days.length - 1;
  days.forEach((d, i) => {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) return; // no fixing on weekends
    const t = i / n;
    const drift = 1.04 + 0.13 * t;
    const wiggle = 0.012 * Math.sin(i / 9) + 0.006 * Math.sin(i / 3.7);
    table[d] = { USD: Math.round((drift + wiggle * (1 - t)) * 10000) / 10000 };
  });
  table[AS_OF] = { USD: 1.17 };
  return table;
}

// ---------- IBKR (fills feed the generated Flex XML) ----------

export interface IbkrFill extends Fill {
  assetCategory: "STK";
  subCategory?: "ETF";
}

export const IBKR_FILLS: IbkrFill[] = [
  { id: "T1001", ts: "2026-01-20T15:42:00Z", ticker: "NVDA", side: "BUY", quantity: 40, price: 128, fee: 1, currency: "USD", assetCategory: "STK" },
  { id: "T1002", ts: "2026-01-27T09:15:00Z", ticker: "ASML", side: "BUY", quantity: 5, price: 640, fee: 3, currency: "EUR", assetCategory: "STK" },
  { id: "T1003", ts: "2026-02-03T09:31:00Z", ticker: "IWDA", side: "BUY", quantity: 40, price: 101.2, fee: 2, currency: "EUR", assetCategory: "STK", subCategory: "ETF" },
  { id: "T1004", ts: "2026-02-12T16:05:00Z", ticker: "MSFT", side: "BUY", quantity: 30, price: 455, fee: 1, currency: "USD", assetCategory: "STK" },
  { id: "T1005", ts: "2026-03-16T14:48:00Z", ticker: "TSLA", side: "BUY", quantity: 15, price: 342, fee: 1, currency: "USD", assetCategory: "STK" },
  { id: "T1006", ts: "2026-04-22T18:20:00Z", ticker: "TSLA", side: "SELL", quantity: 15, price: 301.4, fee: 1, currency: "USD", assetCategory: "STK" },
  { id: "T1007", ts: "2026-05-07T17:55:00Z", ticker: "NVDA", side: "SELL", quantity: 40, price: 161.25, fee: 1, currency: "USD", assetCategory: "STK" },
  { id: "T1008", ts: "2026-05-20T10:02:00Z", ticker: "IWDA", side: "BUY", quantity: 30, price: 104.8, fee: 2, currency: "EUR", assetCategory: "STK", subCategory: "ETF" },
  { id: "T1009", ts: "2026-06-18T19:10:00Z", ticker: "MSFT", side: "SELL", quantity: 10, price: 498, fee: 1, currency: "USD", assetCategory: "STK" },
  { id: "T1010", ts: "2026-07-09T08:47:00Z", ticker: "ASML", side: "BUY", quantity: 3, price: 705, fee: 3, currency: "EUR", assetCategory: "STK" },
  { id: "T1011", ts: "2026-08-26T13:30:00Z", ticker: "IWDA", side: "SELL", quantity: 10, price: 107.1, fee: 2, currency: "EUR", assetCategory: "STK", subCategory: "ETF" },
];

export const IBKR_MARKET: Record<string, { price: number; currency: "USD" | "EUR"; subCategory?: "ETF" }> = {
  MSFT: { price: 526.5, currency: "USD" },
  ASML: { price: 720, currency: "EUR" },
  IWDA: { price: 108, currency: "EUR", subCategory: "ETF" },
};

/** One micro E-mini S&P 500 future, long. */
export const IBKR_FUTURE = { symbol: "MESZ6", quantity: 1, entry: 6640, mark: 6698.5, multiplier: 5, currency: "USD" as const };

export const IBKR_CASH = [
  { currency: "EUR" as const, endingCash: 4200 },
  { currency: "USD" as const, endingCash: 1170 },
];

// ---------- Kraken Spot (EUR-quoted) ----------

export const KRAKEN_SPOT_FILLS: Fill[] = [
  { id: "KS-01", ts: "2026-01-14T08:12:00Z", ticker: "BTC", side: "BUY", quantity: 0.1, price: 78000, fee: 15.6, currency: "EUR" },
  { id: "KS-02", ts: "2026-02-09T12:40:00Z", ticker: "ETH", side: "BUY", quantity: 2, price: 2950, fee: 11.8, currency: "EUR" },
  { id: "KS-03", ts: "2026-03-03T07:55:00Z", ticker: "BTC", side: "BUY", quantity: 0.05, price: 84500, fee: 8.45, currency: "EUR" },
  { id: "KS-04", ts: "2026-05-28T15:21:00Z", ticker: "ETH", side: "BUY", quantity: 1.302, price: 3320, fee: 11.24, currency: "EUR" },
  { id: "KS-05", ts: "2026-07-21T19:03:00Z", ticker: "BTC", side: "SELL", quantity: 0.06, price: 101200, fee: 12.14, currency: "EUR" },
];

/** A crypto-to-crypto exchange: 0.8 ETH sold for 0.03 BTC, fee paid in ETH. */
export const KRAKEN_SWAPS: CryptoSwap[] = [
  { id: "KS-06", ts: "2026-08-12T10:30:00Z", pair: "ETHXBT", side: "SELL", quantity: 0.8, priceInQuote: 0.0375, fee: 0.002, feeAsset: "base" },
];

/** EUR reference prices used to value swaps on their date. */
export const CRYPTO_EUR_PRICES: Record<string, Record<string, number>> = {
  "2026-08-12": { BTC: 92000, ETH: 3450 },
};

export const KRAKEN_SPOT_MARKET: Record<string, number> = { BTC: 95000, ETH: 3800 };
export const KRAKEN_SPOT_CASH: CashBalance[] = [{ accountId: "kraken_spot", currency: "EUR", amount: 2100 }];

// ---------- Kraken Futures (USD-margined perpetual) ----------

export const KRAKEN_PERP_FILLS: PerpFill[] = [
  { id: "KF-01", ts: "2026-02-24T13:00:00Z", symbol: "PF_ETHUSD", side: "BUY", quantity: 2, price: 2980, fee: 2.98, currency: "USD" },
  { id: "KF-02", ts: "2026-03-19T09:45:00Z", symbol: "PF_ETHUSD", side: "SELL", quantity: 2, price: 3215, fee: 3.22, currency: "USD" },
  { id: "KF-03", ts: "2026-06-02T16:10:00Z", symbol: "PF_ETHUSD", side: "SELL", quantity: 1.5, price: 3640, fee: 2.73, currency: "USD" },
  { id: "KF-04", ts: "2026-06-26T11:25:00Z", symbol: "PF_ETHUSD", side: "BUY", quantity: 1.5, price: 3905, fee: 2.93, currency: "USD" },
  { id: "KF-05", ts: "2026-09-08T14:05:00Z", symbol: "PF_ETHUSD", side: "SELL", quantity: 1, price: 4563, fee: 2.28, currency: "USD" },
];
export const KRAKEN_PERP_MARK: Record<string, number> = { PF_ETHUSD: 4446 };
export const KRAKEN_FUTURES_CASH: CashBalance[] = [{ accountId: "kraken_futures", currency: "USD", amount: 1755 }];

// ---------- manually tracked personal accounts ----------

export const MANUAL_POSITIONS: Position[] = [
  { accountId: "pea", ticker: "CW8", assetClass: "ETF", quantity: 30, marketPrice: 560, currency: "EUR", avgCostNative: 498 },
  { accountId: "pea", ticker: "ESE", assetClass: "ETF", quantity: 300, marketPrice: 29, currency: "EUR", avgCostNative: 26.1 },
  { accountId: "self_custody", ticker: "BTC", assetClass: "CRYPTO_SPOT", quantity: 0.18, marketPrice: 95000, currency: "EUR", avgCostNative: 55000 },
  { accountId: "self_custody", ticker: "SOL", assetClass: "CRYPTO_SPOT", quantity: 40, marketPrice: 161, currency: "EUR", avgCostNative: 118 },
  { accountId: "joint_wallet", ticker: "ETH", assetClass: "CRYPTO_SPOT", quantity: 6, marketPrice: 3800, currency: "EUR", avgCostNative: 2100, ownershipPct: 50 },
];
export const MANUAL_CASH: CashBalance[] = [
  { accountId: "pea", currency: "EUR", amount: 450 },
  { accountId: "self_custody", currency: "USDC", amount: 2340 },
];

// ---------- Qonto (business bank) ----------

export const QONTO_OPENING_BALANCE = 510;

/** Qonto-style French CSV export. Movements tagged to balance-sheet accounts are qualified, not reconciled. */
export const QONTO_CSV = `Date;Référence;Contrepartie;Libellé;Débit;Crédit;Devise
05-01-2026;QNT-0001;ORBITEL MOBILE;Prélèvement forfait mobile;30,00;;EUR
08-01-2026;QNT-0002;COMPTOIR LOGICIEL;Abonnement logiciel comptable;36,00;;EUR
02-02-2026;QNT-0003;ASSOCIE UNIQUE;Apport en compte courant d'associé;;20 000,00;EUR
05-02-2026;QNT-0004;ORBITEL MOBILE;Prélèvement forfait mobile;30,00;;EUR
09-02-2026;QNT-0005;COMPTOIR LOGICIEL;Abonnement logiciel comptable;36,00;;EUR
16-02-2026;QNT-0006;NORTHWIND MKT DATA;Market data subscription;120,00;;EUR
05-03-2026;QNT-0007;ORBITEL MOBILE;Prélèvement forfait mobile;30,00;;EUR
10-03-2026;QNT-0008;INTERACTIVE BROKERS;Virement vers compte titres;5 000,00;;EUR
12-03-2026;QNT-0009;EVALYX TRADING CHALLENGE;Evaluation fee;540,00;;EUR
16-03-2026;QNT-0010;NORTHWIND MKT DATA;Market data subscription;120,00;;EUR
06-04-2026;QNT-0011;ORBITEL MOBILE;Prélèvement forfait mobile;30,00;;EUR
07-04-2026;QNT-0012;COMPTOIR LOGICIEL;Abonnement logiciel comptable;36,00;;EUR
15-04-2026;QNT-0013;KRAKEN;Virement vers compte crypto;3 000,00;;EUR
16-04-2026;QNT-0014;NORTHWIND MKT DATA;Market data subscription;120,00;;EUR
05-05-2026;QNT-0015;ORBITEL MOBILE;Prélèvement forfait mobile;30,00;;EUR
12-05-2026;QNT-0016;LUMEN CHARTS;Card payment USD 199.00;178,00;;EUR
05-06-2026;QNT-0017;ORBITEL MOBILE;Prélèvement forfait mobile;30,00;;EUR
05-06-2026;QNT-0018;COMPTOIR LOGICIEL;Abonnement logiciel comptable;36,00;;EUR
30-06-2026;QNT-0019;BANQUE;Frais de tenue de compte;8,00;;EUR
06-07-2026;QNT-0020;ORBITEL MOBILE;Prélèvement forfait mobile;30,00;;EUR
20-07-2026;QNT-0021;DEMO SUBSIDIARY;Règlement facture prestations;;1 800,00;EUR
05-08-2026;QNT-0022;ORBITEL MOBILE;Prélèvement forfait mobile;30,00;;EUR
03-09-2026;QNT-0023;ATELIER COMPTABLE DURANCE;Honoraires clôture;1 560,00;;EUR
07-09-2026;QNT-0024;ORBITEL MOBILE;Prélèvement forfait mobile;30,00;;EUR
`;

/** Rules that qualify non-invoice movements (one-click buttons in the UI). */
export const QUALIFICATION_RULES: { match: RegExp; account: string; label: string }[] = [
  { match: /compte courant/i, account: "455000", label: "Shareholder current account" },
  { match: /interactive brokers/i, account: "512100", label: "Transfer to broker" },
  { match: /kraken/i, account: "512200", label: "Transfer to crypto exchange" },
  { match: /frais de tenue/i, account: "627000", label: "Bank fees (no invoice)" },
];

// ---------- invoices (bookkeeping, reconciliation, VAT) ----------

export interface DemoInvoice extends Invoice {
  supplierCountry: string;
  baseEur: number;
  vatEur: number;
  vatRate: number;
  regime: VatInvoiceLine["regime"];
  pcgAccount: string;
}

function monthly(prefix: string, party: string, days: [string, number][], base: number, vat: number, pcg: string): DemoInvoice[] {
  return days.map(([date], i) => ({
    id: `${prefix}-${String(i + 1).padStart(2, "0")}`,
    number: `${prefix}-${date.slice(0, 7).replace("-", "")}`,
    party,
    date,
    direction: "purchase" as const,
    totalEur: base + vat,
    supplierCountry: "FR",
    baseEur: base,
    vatEur: vat,
    vatRate: 0.2,
    regime: "domestic" as const,
    pcgAccount: pcg,
  }));
}

export const INVOICES: DemoInvoice[] = [
  ...monthly("ORB", "Orbitel Mobile SAS", ["2026-01-03", "2026-02-03", "2026-03-03", "2026-04-03", "2026-05-03", "2026-06-03", "2026-07-03", "2026-08-03", "2026-09-04"].map((d) => [d, 0] as [string, number]), 25, 5, "626100"),
  ...monthly("CPT", "Comptoir Logiciel SAS", ["2026-01-06", "2026-02-07", "2026-04-05", "2026-06-03", "2026-09-04"].map((d) => [d, 0] as [string, number]), 30, 6, "618100"),
  ...["2026-02-14", "2026-03-14", "2026-04-14"].map((date, i) => ({
    id: `NWD-0${i + 1}`, number: `NW-26-${110 + i}`, party: "Northwind Market Data Ltd", date, direction: "purchase" as const,
    totalEur: 120, supplierCountry: "IE", baseEur: 120, vatEur: 0, vatRate: 0.2, regime: "intra_eu_reverse_charge" as const, pcgAccount: "618100",
  })),
  { id: "EVX-01", number: "EVX-2026-0311", party: "Evalyx Trading Challenge s.r.o.", date: "2026-03-11", direction: "purchase", totalEur: 540, supplierCountry: "CZ", baseEur: 540, vatEur: 0, vatRate: 0.2, regime: "intra_eu_reverse_charge", pcgAccount: "617000" },
  { id: "LUM-01", number: "LC-55120", party: "Lumen Charts Inc.", date: "2026-05-10", direction: "purchase", totalEur: 170.8, supplierCountry: "US", baseEur: 170.8, vatEur: 0, vatRate: 0.2, regime: "non_eu_import_services", pcgAccount: "618100" },
  { id: "SUB-01", number: "DH-2026-001", party: "Demo Subsidiary SAS", date: "2026-07-15", direction: "sale", totalEur: 1800, supplierCountry: "FR", baseEur: 1500, vatEur: 300, vatRate: 0.2, regime: "domestic", pcgAccount: "706000" },
  { id: "ACD-01", number: "ACD-26-0831", party: "Atelier Comptable Durance SARL", date: "2026-08-31", direction: "purchase", totalEur: 1560, supplierCountry: "FR", baseEur: 1300, vatEur: 260, vatRate: 0.2, regime: "domestic", pcgAccount: "622600" },
];

// ---------- AI invoice extraction: recorded model outputs ----------

/** Raw JSON responses as returned by the vision model, before verification. */
export const RECORDED_EXTRACTIONS: { file: string; modelOutput: InvoiceExtraction }[] = [
  {
    file: "atelier-comptable-2026-08.pdf",
    modelOutput: {
      supplierName: "Atelier Comptable Durance SARL", supplierCountry: "FR", supplierVatNumber: "FR00999999999",
      invoiceNumber: "ACD-26-0831", invoiceDate: "2026-08-31", currency: "EUR",
      totalExclVat: 1300, vatAmount: 260, totalInclVat: 1560, vatRate: 0.2, lineDescription: "Annual closing engagement",
    },
  },
  {
    file: "evalyx-2026-03.pdf",
    modelOutput: {
      supplierName: "Evalyx Trading Challenge s.r.o.", supplierCountry: "CZ", supplierVatNumber: null,
      invoiceNumber: "EVX-2026-0311", invoiceDate: "2026-03-11", currency: "EUR",
      totalExclVat: 540, vatAmount: 113.4, totalInclVat: 653.4, vatRate: 0.21, lineDescription: "Trading evaluation — 100k account",
    },
  },
  {
    file: "lumen-charts-receipt.png",
    modelOutput: {
      supplierName: "Lumen Charts Inc.", supplierCountry: "US", supplierVatNumber: null,
      invoiceNumber: "LC-55120", invoiceDate: "2026-05-10", currency: "US$",
      totalExclVat: 199, vatAmount: 0, totalInclVat: 189, vatRate: null, lineDescription: "Charting platform — annual plan",
    },
  },
];

// ---------- snapshot generation parameters ----------

/**
 * Opening NLV (at YEAR_START), external/internal flows and YTD P&L per account.
 * Daily snapshots are generated as: opening + cumulative flows + a seeded random
 * path pinned to the YTD P&L (Brownian bridge). End values are checked against
 * the engine's own valuation of the positions above.
 */
export const SNAPSHOT_PLAN: Record<string, { opening: number; ytdPnl: number; dailyVol: number; flows: { date: string; amountEur: number; external: boolean }[] }> = {
  ibkr: { opening: 19050, ytdPnl: 2640, dailyVol: 0.009, flows: [{ date: "2026-03-10", amountEur: 5000, external: false }] },
  kraken_spot: { opening: 18310, ytdPnl: 1690, dailyVol: 0.022, flows: [{ date: "2026-04-15", amountEur: 3000, external: false }] },
  kraken_futures: { opening: 2010, ytdPnl: -410, dailyVol: 0.03, flows: [] },
  qonto: {
    opening: QONTO_OPENING_BALANCE, ytdPnl: -1260, dailyVol: 0, flows: [
      { date: "2026-02-02", amountEur: 20000, external: true },
      { date: "2026-03-10", amountEur: -5000, external: false },
      { date: "2026-04-15", amountEur: -3000, external: false },
    ],
  },
  pea: {
    opening: 22070, ytdPnl: 1180, dailyVol: 0.008,
    flows: ["01", "02", "03", "04", "05", "06", "07", "08", "09"].map((m) => ({ date: `2026-${m}-05`, amountEur: 300, external: true })),
  },
  self_custody: { opening: 21830, ytdPnl: 3710, dailyVol: 0.025, flows: [] },
  joint_wallet: { opening: 10230, ytdPnl: 1170, dailyVol: 0.028, flows: [] },
};

/** Days on which the futures API was unreachable: no snapshot written (carry-forward test). */
export const MISSING_SNAPSHOTS: Record<string, string[]> = {
  kraken_futures: ["2026-05-17", "2026-05-18", "2026-05-19"],
};

export const TAX_ASSUMPTIONS = {
  label: "Illustrative rates for demonstration only — configure for the applicable legislation and situation.",
  gainRate: { corporate: 0.25, pea: 0.186, crypto_personal: 0.314, cash: 0 },
  distributionRate: 0.314,
};
