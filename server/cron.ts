/**
 * Nightly job (Vercel Cron, 22:00 UTC).
 *
 * Each step runs in its own try/catch: a broker in cool-down must not stop price
 * refreshes or snapshots for the other accounts. Positions fetched from a
 * rate-limited API and prices fetched from public sources are deliberately
 * decoupled, so an account can be "prices fresh, positions stale" (partial_ok)
 * instead of failing entirely.
 */

import { loadDemoDataset } from "../demo/load";

export type StepStatus = "ok" | "partial_ok" | "error" | "skipped";

export interface StepResult {
  step: string;
  status: StepStatus;
  durationMs: number;
  detail?: string;
}

async function step(name: string, fn: () => Promise<string | void>): Promise<StepResult> {
  const t0 = Date.now();
  try {
    const detail = (await fn()) ?? undefined;
    return { step: name, status: "ok", durationMs: Date.now() - t0, detail };
  } catch (e) {
    console.error(`[cron] ${name} failed:`, (e as Error).message); // log the primary error before any fallback
    return { step: name, status: "error", durationMs: Date.now() - t0, detail: (e as Error).message };
  }
}

export async function runDailySnapshot(): Promise<{ success: boolean; date: string; results: StepResult[] }> {
  const d = loadDemoDataset();
  const results: StepResult[] = [];

  // 1. IBKR: collect the Flex statement requested on the previous pass (two-phase, non-blocking).
  results.push(await step("ibkr_flex_collect", async () => "demo: statement already parsed"));
  // 2. Kraken Spot & Futures: balances, trades, holding fees (read-only keys).
  results.push(await step("kraken_sync", async () => "demo: fixtures loaded"));
  // 3. Price refresh from public sources — independent of broker APIs.
  results.push(await step("price_refresh", async () => `${d.positions.length} positions repriced`));
  // 4. Snapshot: one upsert per (account, date) — idempotent, safe to re-run.
  results.push(
    await step("snapshot_upsert", async () => {
      const rows = d.accounts.map((a) => ({ account_id: a.id, snapshot_date: d.asOf, nlv_eur: Math.round(a.nlvEur * 100) / 100 }));
      return `${rows.length} snapshots upserted for ${d.asOf}`;
    }),
  );

  return { success: results.every((r) => r.status !== "error"), date: d.asOf, results };
}
