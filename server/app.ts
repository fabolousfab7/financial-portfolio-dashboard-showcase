/**
 * Express API. In production the same routes read from Supabase (see
 * supabase/schema.sql); in this showcase they serve the computed demo dataset.
 */

import express, { type NextFunction, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { loadDemoDataset } from "../demo/load";
import { FlexError, assessReportQuality, parseFlexReport } from "../core/ibkr-flex";
import { verifyExtraction, type InvoiceExtraction } from "../core/invoice-extraction";
import { runDailySnapshot } from "./cron";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store"); // financial data: never cache
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", demo: true, ts: new Date().toISOString() });
  });

  app.get("/api/portfolio/summary", (_req, res) => {
    const d = loadDemoDataset();
    res.json({ disclaimer: d.disclaimer, asOf: d.asOf, kpis: d.kpis, accounts: d.accounts, wealth: d.wealth });
  });

  app.get("/api/portfolio/timeseries", (req, res) => {
    const d = loadDemoDataset();
    const days = Math.min(Math.max(Number(req.query.days ?? 365) || 365, 1), 3650);
    res.json({ series: d.series.slice(-days - 1) });
  });

  app.get("/api/positions", (_req, res) => res.json({ positions: loadDemoDataset().positions }));

  app.get("/api/trades/realized", (_req, res) => {
    const d = loadDemoDataset();
    res.json({ realized: d.realized, byTicker: d.realizedByTicker, perps: d.perpRoundTrips, swaps: d.swapRegister, brokerCrossCheck: d.brokerCrossCheck });
  });

  app.get("/api/compta/reconciliation", (_req, res) => {
    const d = loadDemoDataset();
    res.json({ ...d.reconciliation, qualified: d.bank.qualified });
  });

  app.get("/api/compta/vat-returns", (_req, res) => res.json({ returns: loadDemoDataset().vat }));

  /** Parse an uploaded Flex statement and report whether it is safe to apply. */
  app.post("/api/ibkr/parse", express.text({ type: ["application/xml", "text/xml", "text/plain"], limit: "5mb" }), (req, res) => {
    try {
      const report = parseFlexReport(String(req.body ?? ""));
      res.json({ quality: assessReportQuality(report), positions: report.openPositions.length, trades: report.trades.length, cash: report.cash });
    } catch (e) {
      if (e instanceof FlexError) return res.status(e.kind === "PARSE_ERROR" ? 400 : 502).json({ error: e.kind, code: e.code, message: e.message });
      throw e;
    }
  });

  /** Verify a model-extracted invoice before booking. */
  app.post("/api/compta/invoices/verify", express.json({ limit: "100kb" }), (req, res) => {
    res.json(verifyExtraction(req.body as InvoiceExtraction));
  });

  app.get("/api/cron/daily", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) return res.status(503).json({ error: "CRON_SECRET not configured" }); // fail closed
    const given = Buffer.from(req.header("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${secret}`);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return res.status(401).json({ error: "unauthorized" });
    res.json(await runDailySnapshot());
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[api]", err);
    res.status(500).json({ error: "internal_error" }); // never leak stack traces or upstream payloads
  });

  return app;
}
