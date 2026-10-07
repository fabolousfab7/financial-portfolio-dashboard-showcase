import { describe, expect, it } from "vitest";
import { extractInvoiceWithClaude, parseModelJson, verifyExtraction, type InvoiceExtraction } from "../core/invoice-extraction";

const clean: InvoiceExtraction = {
  supplierName: "Atelier Comptable Durance SARL", supplierCountry: "FR", supplierVatNumber: "FR00999999999", invoiceNumber: "A-1",
  invoiceDate: "2026-08-31", currency: "EUR", totalExclVat: 1300, vatAmount: 260, totalInclVat: 1560, vatRate: 0.2, lineDescription: "Closing",
};

describe("verifyExtraction — model output is checked, not trusted", () => {
  it("accepts a consistent domestic invoice", () => {
    const v = verifyExtraction(clean, "2026-09-30");
    expect(v.status).toBe("ready_to_book");
    expect(v.regime).toBe("domestic");
    expect(v.issues).toEqual([]);
  });

  it("catches an OCR misread breaking HT + VAT = TTC", () => {
    const v = verifyExtraction({ ...clean, totalInclVat: 1650 }, "2026-09-30");
    expect(v.status).toBe("needs_review");
    expect(v.issues.some((i) => i.field === "consistency")).toBe(true);
  });

  it("rejects a VAT rate that does not exist in France", () => {
    expect(verifyExtraction({ ...clean, vatRate: 0.19, vatAmount: 247, totalInclVat: 1547 }, "2026-09-30").issues.map((i) => i.field)).toContain("vatRate");
  });

  it("flags foreign VAT charged under reverse charge", () => {
    const v = verifyExtraction({ ...clean, supplierCountry: "CZ", supplierVatNumber: null, vatRate: 0.21, vatAmount: 273, totalInclVat: 1573 }, "2026-09-30");
    expect(v.regime).toBe("intra_eu_reverse_charge");
    expect(v.status).toBe("needs_review");
    expect(v.issues.map((i) => i.field)).toEqual(expect.arrayContaining(["vatAmount", "supplierVatNumber"]));
  });

  it("rejects non-ISO currencies, missing fields and future dates", () => {
    const v = verifyExtraction({ ...clean, currency: "US$", invoiceNumber: null, invoiceDate: "2027-01-01" }, "2026-09-30");
    expect(v.issues.filter((i) => i.severity === "error").map((i) => i.field).sort()).toEqual(["currency", "invoiceDate", "invoiceNumber"]);
  });
});

describe("model I/O", () => {
  it("extracts JSON even when wrapped in a code fence", () => {
    expect(parseModelJson("```json\n" + JSON.stringify(clean) + "\n```").invoiceNumber).toBe("A-1");
    expect(() => parseModelJson("Sorry, I cannot read this.")).toThrow();
  });

  it("sends the image and prompt to the Messages API and parses the answer", async () => {
    let sent: { url: string; body: Record<string, unknown> } | null = null;
    const result = await extractInvoiceWithClaude(
      async (url, init) => {
        sent = { url, body: JSON.parse(init.body) };
        return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(clean) }] }) };
      },
      "test-key",
      { base64: "AAAA", mediaType: "image/png" },
    );
    expect(sent!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(JSON.stringify(sent!.body)).toContain('"type":"image"');
    expect(result.totalInclVat).toBe(1560);
  });
});
