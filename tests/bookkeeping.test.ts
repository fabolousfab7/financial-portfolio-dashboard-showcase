import { describe, expect, it } from "vitest";
import { parseFrenchAmount, parseQontoCsv } from "../core/qonto";
import { nameSimilarity, reconcile, type Invoice } from "../core/reconciliation";
import { computeVatReturn, computeVatYear } from "../core/vat";
import type { BankTransaction } from "../core/qonto";

describe("Qonto CSV", () => {
  const csv = `﻿Date;Référence;Contrepartie;Libellé;Débit;Crédit;Devise
05-01-2026;R1;"ACME; INC";Abonnement;1 234,56;;EUR
06-01-2026;R2;CLIENT;Facture;;2 000,00;EUR
06-01-2026;R2;CLIENT;Facture;;2 000,00;EUR
07-01-2026;R3;X;Bad;abc;;EUR`;

  it("parses French amounts, dates and quoted separators", () => {
    const r = parseQontoCsv(csv);
    expect(r.transactions[0]).toMatchObject({ reference: "R1", date: "2026-01-05", counterparty: "ACME; INC", amount: -1234.56 });
    expect(r.transactions[1]!.amount).toBe(2000);
  });

  it("de-duplicates on the bank reference and reports bad lines", () => {
    const r = parseQontoCsv(csv, new Set(["R1"]));
    expect(r.transactions.map((t) => t.reference)).toEqual(["R2"]);
    expect(r.duplicates).toBe(2);
    expect(r.errors).toEqual([{ line: 5, message: 'Invalid amount "abc"' }]);
  });

  it("rejects malformed amounts", () => {
    expect(parseFrenchAmount("-12,50")).toBe(-12.5);
    expect(() => parseFrenchAmount("12.5.3")).toThrow();
  });
});

describe("reconciliation", () => {
  const inv = (id: string, party: string, date: string, total: number, direction: Invoice["direction"] = "purchase"): Invoice => ({ id, number: id, party, date, direction, totalEur: total });
  const tx = (reference: string, counterparty: string, date: string, amount: number): BankTransaction => ({ reference, counterparty, label: "", date, amount, currency: "EUR" });

  it("scores names regardless of case, accents and legal form", () => {
    expect(nameSimilarity("Société Générale SA", "SOCIETE GENERALE")).toBeGreaterThanOrEqual(0.8);
    expect(nameSimilarity("Alpha Data", "Beta Logistics")).toBe(0);
  });

  it("auto-matches within ±0.10 € and ±3 days, one-to-one", () => {
    const r = reconcile(
      [inv("I1", "Orbitel Mobile SAS", "2026-01-03", 30), inv("I2", "Orbitel Mobile SAS", "2026-02-03", 30)],
      [tx("T1", "ORBITEL MOBILE", "2026-01-05", -30.05), tx("T2", "ORBITEL MOBILE", "2026-02-05", -30)],
    );
    expect(r.matches.map((m) => [m.invoiceId, m.transactionRef])).toEqual([["I2", "T2"], ["I1", "T1"]]);
  });

  it("only suggests when amount or date is outside auto tolerance", () => {
    const r = reconcile([inv("I1", "Lumen Charts Inc.", "2026-05-10", 170.8)], [tx("T1", "LUMEN CHARTS", "2026-05-12", -178)]);
    expect(r.matches).toHaveLength(0);
    expect(r.suggestions[0]).toMatchObject({ invoiceId: "I1", tier: "suggested" });
    expect(r.unmatchedInvoices).toEqual(["I1"]); // stays open until confirmed
  });

  it("never pays a purchase with a credit", () => {
    const r = reconcile([inv("I1", "Acme", "2026-01-01", 100)], [tx("T1", "ACME", "2026-01-01", 100)]);
    expect(r.matches).toHaveLength(0);
    expect(r.suggestions).toHaveLength(0);
  });
});

describe("French VAT return (CA3)", () => {
  const line = (id: string, direction: "purchase" | "sale", regime: "domestic" | "intra_eu_reverse_charge", base: number, vat: number) => ({ id, date: "2026-03-10", direction, regime, baseEur: base, vatRate: 0.2, vatChargedEur: vat });

  it("self-assesses reverse-charge VAT as both due and deductible", () => {
    const r = computeVatReturn({ period: "2026-03", previousCreditEur: 0, lines: [line("a", "purchase", "intra_eu_reverse_charge", 540, 0)] });
    expect(r.line16GrossDue).toBe(108);
    expect(r.line23TotalDeductible).toBe(108);
    expect(r.line28NetDue).toBe(0);
    expect(r.line25Credit).toBe(0);
  });

  it("nets collected VAT against deductions and the carried credit", () => {
    const r = computeVatReturn({ period: "2026-03", previousCreditEur: 54, lines: [line("s", "sale", "domestic", 1500, 300), line("p", "purchase", "domestic", 25, 5)] });
    expect(r.line16GrossDue).toBe(300);
    expect(r.line23TotalDeductible).toBe(59);
    expect(r.line28NetDue).toBe(241);
  });

  it("refunds a credit only above the 760 € monthly threshold", () => {
    const small = computeVatReturn({ period: "2026-03", previousCreditEur: 0, requestRefund: true, lines: [line("p", "purchase", "domestic", 1000, 200)] });
    expect(small.line26RefundRequested).toBe(0);
    expect(small.line27CreditCarriedForward).toBe(200);
    expect(small.warnings[0]).toMatch(/below the 760/);
    const big = computeVatReturn({ period: "2026-03", previousCreditEur: 0, requestRefund: true, lines: [line("p", "purchase", "domestic", 5000, 1000)] });
    expect(big.line26RefundRequested).toBe(1000);
    expect(big.line27CreditCarriedForward).toBe(0);
  });

  it("chains line 27 into the next month's line 22", () => {
    const year = computeVatYear([
      { period: "2026-01", lines: [{ ...line("p", "purchase", "domestic", 50, 10), date: "2026-01-05" }] },
      { period: "2026-02", lines: [{ ...line("s", "sale", "domestic", 100, 20), date: "2026-02-05" }] },
    ]);
    expect(year[1]!.line22PreviousCredit).toBe(10);
    expect(year[1]!.line28NetDue).toBe(10);
  });
});
