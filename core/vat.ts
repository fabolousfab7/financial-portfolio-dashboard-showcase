/**
 * French monthly VAT return (CA3 / form 3310-CA3) — simplified computation.
 *
 * Scope: domestic sales and purchases, plus intra-EU B2B services bought under the
 * reverse-charge mechanism (the buyer self-assesses the VAT and, when fully
 * deductible, deducts it in the same return). Line numbers refer to the form:
 *
 *   16  total gross VAT due        = collected VAT + self-assessed reverse-charge VAT
 *   22  credit carried from the previous return (its line 27)
 *   23  total deductible VAT       = fixed assets + goods & services + reverse charge
 *                                   + catch-up of omitted deductions + line 22
 *   25  VAT credit                 = 23 − 16, when positive
 *   26  refund requested           = monthly refund only if the credit ≥ 760 €
 *   27  credit to carry forward    = 25 − 26
 *   28  net VAT due                = 16 − 23, when positive
 *
 * Illustrative model for a holding company's bookkeeping workflow — not tax advice.
 */

import { round } from "./math";

export type VatRegime = "domestic" | "intra_eu_reverse_charge" | "non_eu_import_services";

export interface VatInvoiceLine {
  id: string;
  date: string;
  direction: "purchase" | "sale";
  regime: VatRegime;
  baseEur: number; // HT
  vatRate: number; // e.g. 0.2
  vatChargedEur: number; // VAT shown on the invoice (0 under reverse charge)
  fixedAsset?: boolean;
}

export interface VatReturnInput {
  period: string; // YYYY-MM
  lines: VatInvoiceLine[];
  previousCreditEur: number; // line 22
  catchUpDeductibleEur?: number; // omitted deductions from earlier months
  requestRefund?: boolean;
}

export interface VatReturn {
  period: string;
  salesBaseEur: number;
  collectedVatEur: number;
  reverseChargeBaseEur: number;
  reverseChargeVatEur: number;
  line16GrossDue: number;
  line22PreviousCredit: number;
  deductibleFixedAssetsEur: number;
  deductibleGoodsServicesEur: number;
  line23TotalDeductible: number;
  line25Credit: number;
  line26RefundRequested: number;
  line27CreditCarriedForward: number;
  line28NetDue: number;
  warnings: string[];
}

export const MONTHLY_REFUND_THRESHOLD_EUR = 760;
export const STANDARD_RATE = 0.2;

export function computeVatReturn(input: VatReturnInput): VatReturn {
  const warnings: string[] = [];
  const lines = input.lines.filter((l) => l.date.startsWith(input.period));
  if (lines.length !== input.lines.length) {
    warnings.push(`${input.lines.length - lines.length} line(s) outside ${input.period} ignored`);
  }

  let salesBase = 0;
  let collected = 0;
  let rcBase = 0;
  let rcVat = 0;
  let dedFixed = 0;
  let dedOther = 0;

  for (const l of lines) {
    if (l.direction === "sale") {
      salesBase += l.baseEur;
      collected += l.vatChargedEur;
      const expected = l.baseEur * l.vatRate;
      if (Math.abs(expected - l.vatChargedEur) > 0.05) {
        warnings.push(`Sale ${l.id}: VAT ${l.vatChargedEur} ≠ base × rate (${round(expected)})`);
      }
      continue;
    }
    if (l.regime === "intra_eu_reverse_charge" || l.regime === "non_eu_import_services") {
      if (l.vatChargedEur > 0) {
        warnings.push(`Purchase ${l.id}: foreign supplier charged VAT under a reverse-charge regime — check the invoice`);
      }
      const v = l.baseEur * STANDARD_RATE;
      rcBase += l.baseEur;
      rcVat += v;
      dedOther += v; // fully deductible assumption
      continue;
    }
    if (l.fixedAsset) dedFixed += l.vatChargedEur;
    else dedOther += l.vatChargedEur;
  }

  const catchUp = input.catchUpDeductibleEur ?? 0;
  const line16 = round(collected + rcVat);
  const line22 = round(input.previousCreditEur);
  const line23 = round(dedFixed + dedOther + catchUp + line22);

  let line25 = 0;
  let line26 = 0;
  let line28 = 0;
  if (line23 > line16) {
    line25 = round(line23 - line16);
    if (input.requestRefund) {
      if (line25 >= MONTHLY_REFUND_THRESHOLD_EUR) line26 = line25;
      else warnings.push(`Refund requested but credit ${line25} € is below the ${MONTHLY_REFUND_THRESHOLD_EUR} € monthly threshold — carried forward`);
    }
  } else {
    line28 = round(line16 - line23);
  }

  return {
    period: input.period,
    salesBaseEur: round(salesBase),
    collectedVatEur: round(collected),
    reverseChargeBaseEur: round(rcBase),
    reverseChargeVatEur: round(rcVat),
    line16GrossDue: line16,
    line22PreviousCredit: line22,
    deductibleFixedAssetsEur: round(dedFixed),
    deductibleGoodsServicesEur: round(dedOther),
    line23TotalDeductible: line23,
    line25Credit: line25,
    line26RefundRequested: line26,
    line27CreditCarriedForward: round(line25 - line26),
    line28NetDue: line28,
    warnings,
  };
}

/** Chains monthly returns: each month's line 27 feeds the next month's line 22. */
export function computeVatYear(
  months: readonly Omit<VatReturnInput, "previousCreditEur">[],
  openingCreditEur = 0,
): VatReturn[] {
  const out: VatReturn[] = [];
  let carried = openingCreditEur;
  for (const m of [...months].sort((a, b) => a.period.localeCompare(b.period))) {
    const r = computeVatReturn({ ...m, previousCreditEur: carried });
    out.push(r);
    carried = r.line27CreditCarriedForward;
  }
  return out;
}
