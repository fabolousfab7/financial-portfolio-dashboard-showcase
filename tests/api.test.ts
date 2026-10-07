import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import { createApp } from "../server/app";

const app = createApp();

describe("API", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("serves the summary with the demo disclaimer", async () => {
    const r = await request(app).get("/api/portfolio/summary").expect(200);
    expect(r.body.disclaimer).toMatch(/Demo data/);
    expect(Math.round(r.body.kpis.portfolioValueEur)).toBe(125430);
    expect(r.headers["cache-control"]).toBe("no-store");
  });

  it("parses an uploaded Flex statement", async () => {
    const xml = readFileSync(new URL("../demo/raw/ibkr-flex-sample.xml", import.meta.url), "utf8");
    const r = await request(app).post("/api/ibkr/parse").set("content-type", "application/xml").send(xml).expect(200);
    expect(r.body.quality.safeToReplacePositions).toBe(true);
  });

  it("returns 400 on malformed XML", async () => {
    await request(app).post("/api/ibkr/parse").set("content-type", "text/plain").send("<nope>").expect(400);
  });

  it("verifies an extracted invoice", async () => {
    const r = await request(app).post("/api/compta/invoices/verify").send({ supplierName: "X", supplierCountry: "FR", invoiceNumber: "1", invoiceDate: "2026-01-01", currency: "EUR", totalExclVat: 100, vatAmount: 20, totalInclVat: 125, vatRate: 0.2 }).expect(200);
    expect(r.body.status).toBe("needs_review");
  });

  it("keeps the cron endpoint closed without a configured secret", async () => {
    await request(app).get("/api/cron/daily").expect(503);
  });

  it("requires the bearer secret on the cron endpoint", async () => {
    process.env.CRON_SECRET = "test-secret-value";
    await request(app).get("/api/cron/daily").set("authorization", "Bearer wrong").expect(401);
    const r = await request(app).get("/api/cron/daily").set("authorization", "Bearer test-secret-value").expect(200);
    expect(r.body.success).toBe(true);
    expect(r.body.results.map((s: { step: string }) => s.step)).toContain("snapshot_upsert");
  });
});
