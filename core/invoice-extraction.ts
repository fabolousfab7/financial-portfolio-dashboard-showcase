/**
 * AI-assisted invoice extraction (OCR) with deterministic verification.
 *
 * A vision model reads the invoice and returns structured JSON. The model output is
 * treated as an unverified claim: every extraction is re-checked with accounting
 * rules before it can be booked. Anything that fails is routed to human review
 * instead of being silently corrected.
 */

import type { VatRegime } from "./vat";

export interface InvoiceExtraction {
  supplierName: string | null;
  supplierCountry: string | null; // ISO 3166-1 alpha-2
  supplierVatNumber: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null; // YYYY-MM-DD
  currency: string | null; // ISO 4217
  totalExclVat: number | null;
  vatAmount: number | null;
  totalInclVat: number | null;
  vatRate: number | null; // 0.2 for 20 %
  lineDescription: string | null;
}

export type Severity = "error" | "warning";
export interface ExtractionIssue {
  field: keyof InvoiceExtraction | "consistency";
  severity: Severity;
  message: string;
}

export interface VerifiedExtraction {
  extraction: InvoiceExtraction;
  issues: ExtractionIssue[];
  regime: VatRegime | null;
  status: "ready_to_book" | "needs_review";
}

const FR_VAT_RATES = [0, 0.021, 0.055, 0.1, 0.2];
const EU = new Set(["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK"]);
const ISO4217 = /^[A-Z]{3}$/;

export const EXTRACTION_PROMPT = `You are an accounting assistant. Extract the following fields from the invoice image and answer with ONE JSON object only, no prose:
{"supplierName": string|null, "supplierCountry": ISO-3166 alpha-2|null, "supplierVatNumber": string|null,
 "invoiceNumber": string|null, "invoiceDate": "YYYY-MM-DD"|null, "currency": ISO-4217|null,
 "totalExclVat": number|null, "vatAmount": number|null, "totalInclVat": number|null,
 "vatRate": decimal (0.2 for 20%)|null, "lineDescription": string|null}
Rules: use null when a field is not printed on the document — never guess. Amounts as numbers with a dot decimal separator.`;

/** Extracts the first JSON object from a model response (tolerates code fences). */
export function parseModelJson(text: string): InvoiceExtraction {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model response contains no JSON object");
  return JSON.parse(text.slice(start, end + 1)) as InvoiceExtraction;
}

export function verifyExtraction(x: InvoiceExtraction, today = new Date().toISOString().slice(0, 10)): VerifiedExtraction {
  const issues: ExtractionIssue[] = [];
  const err = (field: ExtractionIssue["field"], message: string) => issues.push({ field, severity: "error", message });
  const warn = (field: ExtractionIssue["field"], message: string) => issues.push({ field, severity: "warning", message });

  for (const f of ["supplierName", "invoiceNumber", "invoiceDate", "currency", "totalInclVat"] as const) {
    if (x[f] === null || x[f] === "") err(f, "Missing mandatory field");
  }
  if (x.currency && !ISO4217.test(x.currency)) err("currency", `"${x.currency}" is not an ISO 4217 code`);
  if (x.invoiceDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(x.invoiceDate) || Number.isNaN(Date.parse(x.invoiceDate))) err("invoiceDate", "Not a valid ISO date");
    else if (x.invoiceDate > today) err("invoiceDate", "Invoice dated in the future");
  }

  // Arithmetic: HT + TVA = TTC, and TVA = HT × rate.
  const { totalExclVat: ht, vatAmount: vat, totalInclVat: ttc, vatRate: rate } = x;
  if (ht !== null && vat !== null && ttc !== null && Math.abs(ht + vat - ttc) > 0.02) {
    err("consistency", `Excl. VAT ${ht} + VAT ${vat} ≠ incl. VAT ${ttc}`);
  }
  if (ht !== null && vat !== null && rate !== null && Math.abs(ht * rate - vat) > 0.02) {
    warn("consistency", `VAT ${vat} ≠ base × rate (${(ht * rate).toFixed(2)}) — rounding per line or mixed rates?`);
  }
  for (const f of ["totalExclVat", "vatAmount", "totalInclVat"] as const) {
    const v = x[f];
    if (v !== null && v < 0) warn(f, "Negative amount — credit note?");
  }

  // VAT regime from the supplier's country.
  let regime: VatRegime | null = null;
  const country = x.supplierCountry?.toUpperCase() ?? null;
  if (!country) warn("supplierCountry", "Unknown supplier country — VAT regime cannot be determined");
  else if (country === "FR") {
    regime = "domestic";
    if (rate !== null && !FR_VAT_RATES.some((r) => Math.abs(r - rate) < 1e-6)) err("vatRate", `${rate} is not a French VAT rate`);
  } else if (EU.has(country)) {
    regime = "intra_eu_reverse_charge";
    if (vat !== null && vat > 0) {
      // Booking it as-is would deduct foreign VAT that is not recoverable through the French return.
      err("vatAmount", "EU supplier charged VAT on a B2B service that should fall under reverse charge — request a corrected invoice");
    }
    if (!x.supplierVatNumber) warn("supplierVatNumber", "Intra-EU invoice without the supplier's VAT number");
  } else {
    regime = "non_eu_import_services";
  }

  const status = issues.some((i) => i.severity === "error") ? "needs_review" : "ready_to_book";
  return { extraction: x, issues, regime, status };
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Live extraction through the Anthropic Messages API (server-side only). */
export async function extractInvoiceWithClaude(
  fetcher: FetchLike,
  apiKey: string,
  image: { base64: string; mediaType: "image/png" | "image/jpeg" | "image/webp" },
  model = "claude-haiku-4-5-20251001",
): Promise<InvoiceExtraction> {
  const res = await fetcher("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: 800,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
            { type: "text", text: EXTRACTION_PROMPT },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}`);
  const body = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = body.content?.find((c) => c.type === "text")?.text ?? "";
  return parseModelJson(text);
}
