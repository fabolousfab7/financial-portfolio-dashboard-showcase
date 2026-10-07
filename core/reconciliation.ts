/**
 * Bank reconciliation: invoices ↔ bank transactions.
 *
 * Three tiers, from strict to loose:
 *   1. AUTO      amount within ±0.10 EUR, date within ±3 days, counterparty name matches
 *   2. SUGGEST   amount within ±5 %, date within ±30 days — ranked, a human confirms
 *   3. UNMATCHED everything else, surfaced for manual review
 *
 * Matching is one-to-one and deterministic: candidate pairs are scored, sorted by
 * score then by ids, and assigned greedily so a transaction never pays two invoices.
 */

import type { BankTransaction } from "./qonto";

export interface Invoice {
  id: string;
  number: string;
  party: string;
  date: string; // invoice date, YYYY-MM-DD
  direction: "purchase" | "sale";
  totalEur: number; // TTC, positive
}

export interface Match {
  invoiceId: string;
  transactionRef: string;
  tier: "auto" | "suggested";
  score: number; // 0..1
  amountDelta: number;
  dayDelta: number;
  nameSimilarity: number;
}

export interface ReconciliationResult {
  matches: Match[];
  suggestions: Match[];
  unmatchedInvoices: string[];
  unmatchedTransactions: string[];
}

export interface ReconcileOptions {
  autoAmountTolerance: number;
  autoDayTolerance: number;
  autoMinNameSimilarity: number;
  suggestPctTolerance: number;
  suggestDayTolerance: number;
}

export const DEFAULT_OPTIONS: ReconcileOptions = {
  autoAmountTolerance: 0.1,
  autoDayTolerance: 3,
  autoMinNameSimilarity: 0.5,
  suggestPctTolerance: 0.05,
  suggestDayTolerance: 30,
};

const LEGAL_FORMS = new Set(["sas", "sasu", "sarl", "sa", "eurl", "ltd", "inc", "gmbh", "bv", "llc", "plc", "sca"]);

export function normalizeName(s: string): string[] {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !LEGAL_FORMS.has(t));
}

/** Token Jaccard similarity, with a bonus when one name contains the other. */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeName(a));
  const tb = new Set(normalizeName(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const jaccard = inter / (ta.size + tb.size - inter);
  const contains = [...ta].every((t) => tb.has(t)) || [...tb].every((t) => ta.has(t));
  return contains ? Math.max(jaccard, 0.8) : jaccard;
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

/** A purchase is paid by a debit, a sale by a credit. */
function expectedSign(inv: Invoice): 1 | -1 {
  return inv.direction === "purchase" ? -1 : 1;
}

function candidate(inv: Invoice, tx: BankTransaction): Omit<Match, "tier" | "score"> | null {
  if (Math.sign(tx.amount) !== expectedSign(inv)) return null;
  return {
    invoiceId: inv.id,
    transactionRef: tx.reference,
    amountDelta: Math.abs(Math.abs(tx.amount) - inv.totalEur),
    dayDelta: daysBetween(inv.date, tx.date),
    nameSimilarity: nameSimilarity(inv.party, `${tx.counterparty} ${tx.label}`),
  };
}

function score(c: Omit<Match, "tier" | "score">, inv: Invoice, o: ReconcileOptions): number {
  const amount = 1 - Math.min(c.amountDelta / Math.max(inv.totalEur * o.suggestPctTolerance, 0.01), 1);
  const date = 1 - Math.min(c.dayDelta / o.suggestDayTolerance, 1);
  return 0.5 * amount + 0.2 * date + 0.3 * c.nameSimilarity;
}

function greedy(pairs: Match[], usedInv: Set<string>, usedTx: Set<string>): Match[] {
  const out: Match[] = [];
  pairs
    .sort((a, b) => b.score - a.score || a.invoiceId.localeCompare(b.invoiceId) || a.transactionRef.localeCompare(b.transactionRef))
    .forEach((p) => {
      if (usedInv.has(p.invoiceId) || usedTx.has(p.transactionRef)) return;
      usedInv.add(p.invoiceId);
      usedTx.add(p.transactionRef);
      out.push(p);
    });
  return out;
}

export function reconcile(
  invoices: readonly Invoice[],
  transactions: readonly BankTransaction[],
  options: Partial<ReconcileOptions> = {},
): ReconciliationResult {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const usedInv = new Set<string>();
  const usedTx = new Set<string>();

  const autoPairs: Match[] = [];
  const suggestPairs: Match[] = [];
  for (const inv of invoices) {
    for (const tx of transactions) {
      const c = candidate(inv, tx);
      if (!c) continue;
      const s = score(c, inv, o);
      if (
        c.amountDelta <= o.autoAmountTolerance &&
        c.dayDelta <= o.autoDayTolerance &&
        c.nameSimilarity >= o.autoMinNameSimilarity
      ) {
        autoPairs.push({ ...c, tier: "auto", score: s });
      } else if (c.amountDelta <= inv.totalEur * o.suggestPctTolerance && c.dayDelta <= o.suggestDayTolerance) {
        suggestPairs.push({ ...c, tier: "suggested", score: s });
      }
    }
  }

  const matches = greedy(autoPairs, usedInv, usedTx);
  // Suggestions do not consume items: they stay open until a human confirms.
  const suggestions = greedy(suggestPairs, new Set(usedInv), new Set(usedTx));

  return {
    matches,
    suggestions,
    unmatchedInvoices: invoices.filter((i) => !usedInv.has(i.id)).map((i) => i.id),
    unmatchedTransactions: transactions.filter((t) => !usedTx.has(t.reference)).map((t) => t.reference),
  };
}
