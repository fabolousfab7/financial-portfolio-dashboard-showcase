import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  FlexError, assessReportQuality, classifyFlexError, normalizeFlexDate, parseFlexReport, realizedTrades,
  requestFlexReport, retrieveFlexReport, type Fetcher,
} from "../core/ibkr-flex";

const sample = readFileSync(new URL("../demo/raw/ibkr-flex-sample.xml", import.meta.url), "utf8");

const wrap = (body: string) => `<FlexQueryResponse><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20260101" toDate="20260131">${body}</FlexStatement></FlexStatements></FlexQueryResponse>`;

describe("parseFlexReport", () => {
  const r = parseFlexReport(sample);

  it("reads open quantity from the `position` attribute", () => {
    const msft = r.openPositions.find((p) => p.symbol === "MSFT")!;
    expect(msft.quantity).toBe(20);
    expect(msft.currency).toBe("USD");
    expect(r.openPositions.find((p) => p.symbol === "IWDA")!.assetClass).toBe("ETF");
    expect(r.openPositions.find((p) => p.assetClass === "FUT")!.multiplier).toBe(5);
  });

  it("skips the BASE_SUMMARY cash row", () => {
    expect(r.cash.map((c) => c.currency).sort()).toEqual(["EUR", "USD"]);
  });

  it("falls back to quantity × mark when positionValue is missing", () => {
    const x = parseFlexReport(wrap(`<OpenPositions><OpenPosition symbol="A" assetCategory="STK" currency="EUR" position="3" markPrice="10" costBasisPrice="9"/></OpenPositions>`));
    expect(x.openPositions[0]!.positionValue).toBe(30);
  });

  it("prefers CLOSED_LOT rows for realized P&L and both levels agree", () => {
    const closed = realizedTrades(r);
    expect(closed.every((t) => t.levelOfDetail === "CLOSED_LOT")).toBe(true);
    const execTotal = r.trades.filter((t) => t.levelOfDetail === "EXECUTION").reduce((s, t) => s + t.realizedPnl, 0);
    const lotTotal = closed.reduce((s, t) => s + t.realizedPnl, 0);
    expect(lotTotal).toBeCloseTo(execTotal, 6);
  });

  it("normalizes both Flex date formats", () => {
    expect(normalizeFlexDate("20260930;220000")).toBe("2026-09-30");
    expect(normalizeFlexDate("2026-09-30")).toBe("2026-09-30");
    expect(() => normalizeFlexDate("30/09/2026")).toThrow(FlexError);
  });

  it("maps IBKR failure responses to error categories", () => {
    const fail = `<FlexStatementResponse><Status>Fail</Status><ErrorCode>1001</ErrorCode><ErrorMessage>Statement could not be generated at this time.</ErrorMessage></FlexStatementResponse>`;
    expect(() => parseFlexReport(fail)).toThrow(expect.objectContaining({ kind: "RATE_LIMIT", code: "1001" }));
    expect(classifyFlexError("1019")).toBe("NOT_READY");
    expect(classifyFlexError("1015")).toBe("INVALID_TOKEN");
  });
});

describe("degraded report guards", () => {
  it("blocks replacement when every quantity is zero", () => {
    const q = assessReportQuality(parseFlexReport(wrap(`<OpenPositions><OpenPosition symbol="A" assetCategory="STK" currency="EUR" position="0" markPrice="10" costBasisPrice="9"/></OpenPositions><CashReport><CashReportCurrency currency="EUR" endingCash="1"/></CashReport>`)));
    expect(q.safeToReplacePositions).toBe(false);
    expect(q.hasRealPositions).toBe(false);
  });

  it("blocks replacement when every cost price is zero", () => {
    const q = assessReportQuality(parseFlexReport(wrap(`<OpenPositions><OpenPosition symbol="A" assetCategory="STK" currency="EUR" position="5" markPrice="10" costBasisPrice="0"/></OpenPositions>`)));
    expect(q.hasValidCostData).toBe(false);
    expect(q.hasCash).toBe(false);
    expect(q.safeToReplacePositions).toBe(false);
  });

  it("accepts the demo statement", () => {
    expect(assessReportQuality(parseFlexReport(sample)).safeToReplacePositions).toBe(true);
  });
});

describe("two-phase client", () => {
  const respond = (body: string): Fetcher => async () => ({ text: async () => body });

  it("returns the reference code from SendRequest", async () => {
    const ref = await requestFlexReport(respond(`<FlexStatementResponse><Status>Success</Status><ReferenceCode>123456</ReferenceCode></FlexStatementResponse>`), "token", "1");
    expect(ref).toBe("123456");
  });

  it("does not block when the statement is still being generated", async () => {
    const res = await retrieveFlexReport(respond(`<FlexStatementResponse><Status>Fail</Status><ErrorCode>1019</ErrorCode><ErrorMessage>In progress</ErrorMessage></FlexStatementResponse>`), "token", "123456");
    expect(res).toEqual({ ready: false, reason: "NOT_READY" });
  });

  it("surfaces an invalid token as an error", async () => {
    await expect(
      requestFlexReport(respond(`<FlexStatementResponse><Status>Fail</Status><ErrorCode>1015</ErrorCode><ErrorMessage>Token is invalid.</ErrorMessage></FlexStatementResponse>`), "bad", "1"),
    ).rejects.toMatchObject({ kind: "INVALID_TOKEN" });
  });

  it("parses the report once ready", async () => {
    const res = await retrieveFlexReport(respond(sample), "token", "123456");
    expect(res.ready && res.report.accountId).toBe("U0000000");
  });
});
