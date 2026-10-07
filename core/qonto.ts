/**
 * Qonto CSV import (French export format).
 *
 * - `;` separator, optional quotes, BOM tolerated
 * - dates `DD-MM-YYYY` or `DD/MM/YYYY`
 * - decimal comma, optional space / narrow no-break space thousands separator
 * - de-duplication on the bank's transaction reference, so re-importing an
 *   overlapping export is idempotent
 */

export interface BankTransaction {
  reference: string;
  date: string; // YYYY-MM-DD
  counterparty: string;
  label: string;
  amount: number; // signed: credit > 0, debit < 0
  currency: string;
}

export interface CsvImportResult {
  transactions: BankTransaction[];
  duplicates: number;
  errors: { line: number; message: string }[];
}

export function parseFrenchAmount(raw: string): number {
  const cleaned = raw.trim().replace(/[\s  ]/g, "").replace(/€/g, "").replace(",", ".");
  if (cleaned === "") return 0;
  if (!/^[-+]?\d+(\.\d+)?$/.test(cleaned)) throw new Error(`Invalid amount "${raw}"`);
  return Number(cleaned);
}

export function parseFrenchDate(raw: string): string {
  const m = raw.trim().match(/^(\d{2})[-/](\d{2})[-/](\d{4})/);
  if (!m) throw new Error(`Invalid date "${raw}"`);
  const [, d, mo, y] = m;
  const iso = `${y}-${mo}-${d}`;
  if (Number.isNaN(Date.parse(iso))) throw new Error(`Invalid date "${raw}"`);
  return iso;
}

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === ";" && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Header names are matched case-insensitively; adapt `columns` to your export. */
export const DEFAULT_COLUMNS = {
  date: "date",
  reference: "référence",
  counterparty: "contrepartie",
  label: "libellé",
  debit: "débit",
  credit: "crédit",
  currency: "devise",
};

export function parseQontoCsv(
  csv: string,
  existingReferences: ReadonlySet<string> = new Set(),
  columns = DEFAULT_COLUMNS,
): CsvImportResult {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { transactions: [], duplicates: 0, errors: [] };

  const header = splitLine(lines[0]!).map((h) => h.toLowerCase());
  const idx = Object.fromEntries(
    Object.entries(columns).map(([k, name]) => [k, header.indexOf(name.toLowerCase())]),
  ) as Record<keyof typeof DEFAULT_COLUMNS, number>;
  for (const required of ["date", "reference", "debit", "credit"] as const) {
    if (idx[required] < 0) throw new Error(`Missing column "${columns[required]}"`);
  }

  const seen = new Set(existingReferences);
  const transactions: BankTransaction[] = [];
  const errors: CsvImportResult["errors"] = [];
  let duplicates = 0;

  lines.slice(1).forEach((line, i) => {
    const cells = splitLine(line);
    const at = (k: keyof typeof DEFAULT_COLUMNS) => (idx[k] >= 0 ? cells[idx[k]] ?? "" : "");
    try {
      const reference = at("reference");
      if (!reference) throw new Error("Missing reference");
      if (seen.has(reference)) {
        duplicates++;
        return;
      }
      const debit = Math.abs(parseFrenchAmount(at("debit")));
      const credit = Math.abs(parseFrenchAmount(at("credit")));
      if (debit > 0 && credit > 0) throw new Error("Both debit and credit are filled");
      seen.add(reference);
      transactions.push({
        reference,
        date: parseFrenchDate(at("date")),
        counterparty: at("counterparty"),
        label: at("label"),
        amount: credit > 0 ? credit : -debit,
        currency: at("currency") || "EUR",
      });
    } catch (e) {
      errors.push({ line: i + 2, message: (e as Error).message });
    }
  });

  return { transactions, duplicates, errors };
}
