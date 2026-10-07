import { describe, expect, it } from "vitest";
import { loadDemoDataset } from "../demo/load";
import { generateFlexXml } from "../demo/flex-generator";
import { readFileSync } from "node:fs";

describe("demo dataset (end-to-end)", () => {
  const d = loadDemoDataset();

  it("produces the documented headline figures from raw inputs", () => {
    expect(Math.round(d.kpis.portfolioValueEur)).toBe(125430);
    expect(Math.round(d.kpis.ytdPnlEur)).toBe(8720);
    expect(Math.round(d.kpis.cashEur)).toBe(22500);
  });

  it("passes every internal consistency check", () => {
    const failed = d.checks.filter((c) => !c.pass);
    expect(failed).toEqual([]);
    expect(d.checks.length).toBeGreaterThan(10);
  });

  it("reproduces the broker's realized P&L to the cent", () => {
    for (const b of d.brokerCrossCheck) expect(Math.abs(b.difference)).toBeLessThan(0.005);
  });

  it("is labelled as demo data", () => {
    expect(d.disclaimer).toBe("Demo data — no real financial information.");
  });

  it("ships the XML that the generator produces", () => {
    const committed = readFileSync(new URL("../demo/raw/ibkr-flex-sample.xml", import.meta.url), "utf8");
    expect(committed).toBe(generateFlexXml());
  });

  it("routes questionable AI extractions to review", () => {
    expect(d.extractions.map((e) => e.status)).toEqual(["ready_to_book", "needs_review", "needs_review"]);
  });
});
