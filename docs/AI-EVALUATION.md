# Evaluating model output in financial workflows

Notes from building financial software with AI assistance, and from using a model inside the product (invoice extraction). Each pattern below is a class of error I have seen generated code or model output produce. They share one property: **the wrong answer looks plausible**. None of them throws an exception; all of them quietly misstate a balance, a P&L or a tax figure.

For each pattern: what goes wrong, how to detect it, and where this repository guards against it.

## 1. Aggregating before converting currencies

**Symptom.** A total that mixes USD, EUR and GBP amounts is summed first and converted once at today's rate.
**Why it is wrong.** Each amount belongs to its own date and currency; the sum of mixed units has no meaning.
**Detection.** Recompute the total line by line at each line's own rate. Any material difference means the aggregation order is wrong.
**Guard.** `sumInEur` converts per line; there is no API that converts a mixed total. → `core/fx.ts`, `tests/fx-valuation.test.ts`

## 2. Ignoring the FX effect on foreign positions

**Symptom.** Unrealized P&L on a US stock computed as `qty × (price − entry) × fx_today`.
**Why it is wrong.** It assumes the cost was paid at today's rate. If the dollar fell since purchase, a position that is up in USD can be down in EUR — the formula reports a gain that does not exist.
**Detection.** Ask for the EUR cost basis at the purchase date. If the model cannot produce it, the P&L figure is unsupported.
**Guard.** Spot valuation requires `costBasisEur` for foreign positions and refuses to approximate it. → `core/valuation.ts`

## 3. Valuing a derivative at its notional

**Symptom.** A perpetual swap or future counted as `qty × price` in net worth.
**Why it is wrong.** The notional is exposure, not an asset; the margin is already counted in cash. Net worth is overstated by the full contract value.
**Detection.** Check whether any `FUT` / `PERP` line contributes more than its mark-to-market.
**Guard.** One shared helper branches on asset class; derivatives contribute `qty × (mark − entry) × multiplier`. → `core/valuation.ts`

## 4. Applying a correct fix to the wrong population

**Symptom.** A formula corrected for one asset class (e.g. the FX-per-leg rule for stocks) is generalized to every position, and breaks another class (derivatives, where the opposite formula applies).
**Detection.** Before generalizing any formula, list the distinct asset classes and currencies actually present and test the formula on each.
**Guard.** Tests cover spot EUR, spot USD, futures with multiplier, perps and jointly owned assets separately.

## 5. Replacing a shared helper with an inline calculation

**Symptom.** A refactor "aligns" a figure by replacing a helper call with `qty × price × fx` inline.
**Why it is wrong.** The helper existed precisely to handle the special cases (derivatives, ownership share). The inline version silently drops them — and the bug only shows up in historical snapshots.
**Detection.** Treat any diff that removes a call to a canonical valuation or FX helper as high-risk; read the helper before approving.

## 6. Double-counting fees

**Symptom.** A broker's realized P&L field is reduced by the commission again.
**Why it is wrong.** Some broker fields (IBKR `fifoPnlRealized`) are already net of commission.
**Detection.** Recompute the realized P&L independently from executions and compare with the broker field.
**Guard.** The engine reproduces the broker's figure to the cent and the dashboard shows the comparison. → `brokerCrossCheck` in `demo/dataset.ts`

## 7. Silent fallbacks to zero

**Symptom.** A missing FX rate, price or cost basis is replaced by `0` (or `1`) so the pipeline keeps running.
**Why it is wrong.** The output is a confident number built on a hole. A zero cost basis turns a sale into a 100 % gain.
**Detection.** Search for `?? 0`, `|| 0`, `|| 1` on financial fields; ask what the figure would be if the input were missing.
**Guard.** Missing FX throws; missing cost basis yields `null` P&L with a warning. → `core/fx.ts`, `core/fifo.ts`

## 8. Letting a degraded source overwrite good data

**Symptom.** A sync job deletes stored positions and inserts what the API returned — which, off-hours, was a partial report with all quantities at zero.
**Detection.** Before any destructive write, check the incoming data for impossible states (all zeros, empty cash report).
**Guard.** `assessReportQuality` gates replacement; trades are upserted on the broker's id, never deleted and re-inserted. → `core/ibkr-flex.ts`

## 9. Gaps in a time series treated as zeros

**Symptom.** One account has no snapshot on a given day; the consolidated total drops by that account's value, and period variations explode.
**Detection.** Plot the consolidated series and look for single-day cliffs that recover the next day.
**Guard.** Per-account carry-forward of the last known value. → `core/timeseries.ts`

## 10. Cash flows counted as performance

**Symptom.** "P&L" computed as closing value minus opening value.
**Why it is wrong.** A deposit is not a gain. Transfers between the company's own accounts must also net to zero.
**Guard.** `P&L = closing − opening − external flows`; return by Modified Dietz. The dashboard shows the full roll-forward.

## 11. Trusting extracted documents

**Symptom.** A vision model returns invoice fields with full confidence, including a misread digit or a non-ISO currency.
**Detection.** Accounting identities are free checks: `excl. VAT + VAT = incl. VAT`, `VAT = base × rate`, allowed VAT rates, regime consistency with the supplier's country, dates not in the future.
**Guard.** Every extraction passes `verifyExtraction`; anything with a blocking issue is routed to a person, not auto-corrected. → `core/invoice-extraction.ts`

## 12. Tax treatment that is "usually" right

**Symptom.** A crypto-to-crypto exchange inside a company treated as tax-neutral, or VAT charged by an EU supplier booked as deductible.
**Why it is wrong.** The answer depends on the legal entity and the regime, not on what is common for individuals.
**Guard.** Swaps are booked as disposals at fair value; foreign VAT under a reverse-charge regime blocks booking. Edge cases are flagged for a professional rather than resolved by the model.

---

The common method: **never accept a financial figure without an independent way to recompute it.** The integrity-check tab of the dashboard is that principle applied to the whole system — 14 invariants recomputed on every load.
