import { Fragment, useState } from "react";
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { data } from "../data";
import { fmt2, fmtDate, fmtEur, fmtMoney, fmtNum, fmtSigned } from "../format";
import { Signed } from "./Signed";
import { Status } from "./Status";

const ASSET_LABEL: Record<string, string> = { STK: "Equity", ETF: "ETF", FUT: "Future", CRYPTO_SPOT: "Crypto", CRYPTO_PERP: "Perpetual" };

/** Value label outside the bar end, on the side the bar grows towards. */
function BarValueLabel(props: { x?: unknown; y?: unknown; width?: unknown; height?: unknown; value?: unknown }) {
  const x = Number(props.x), y = Number(props.y), w = Number(props.width), h = Number(props.height), v = Number(props.value);
  const neg = v < 0;
  const left = Math.min(x, x + w);
  const right = Math.max(x, x + w);
  return (
    <text x={neg ? left - 6 : right + 6} y={y + h / 2} dy="0.35em" textAnchor={neg ? "end" : "start"} fill="var(--ink)" fontSize={12}>
      {fmtSigned(v)}
    </text>
  );
}

function RealizedChart() {
  const rows = data.realizedByTicker;
  return (
    <div className="chart-frame" role="img" aria-label="Realized net P&L by instrument">
      <ResponsiveContainer width="100%" height={rows.length * 38 + 16}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 8 }} barCategoryGap={10}>
          <XAxis type="number" hide allowDataOverflow domain={[Math.min(0, ...rows.map((r) => r.netPnlEur)) * 1.6, Math.max(0, ...rows.map((r) => r.netPnlEur)) * 1.12]} />
          <YAxis type="category" dataKey="ticker" width={92} tick={{ fill: "var(--ink-2)", fontSize: 13 }} axisLine={{ stroke: "var(--rule)" }} tickLine={false} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--rule)", borderRadius: 6, color: "var(--ink)", fontSize: 13 }}
            formatter={(v, _n, item) => [`${fmtSigned(Number(v), true)} · ${(item.payload as { trades: number }).trades} closed`, "Net realized"]}
          />
          <Bar dataKey="netPnlEur" radius={4} isAnimationActive={false}>
            {rows.map((r) => <Cell key={r.ticker} fill={r.netPnlEur >= 0 ? "var(--pos)" : "var(--neg)"} />)}
            <LabelList dataKey="netPnlEur" content={BarValueLabel} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function RealizedTable() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th><th>Instrument</th><th className="num">Qty sold</th><th className="num">Net (trade ccy)</th>
            <th className="num">Net (EUR)</th><th className="num">of which FX</th><th className="num">Held</th>
          </tr>
        </thead>
        <tbody>
          {data.realized.map((r) => (
            <Fragment key={r.id}>
              <tr>
                <td>{fmtDate(r.date)}</td>
                <td>
                  <button className="expander" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                    {r.ticker}
                  </button>
                  <div className="small muted">{r.lots.length} lot{r.lots.length > 1 ? "s" : ""} matched</div>
                </td>
                <td className="num">{fmtNum(r.quantity)}</td>
                <td className="num">{r.netPnlNative === null ? "n/a" : fmtMoney(r.netPnlNative, r.currency)}</td>
                <td className="num"><Signed value={r.netPnlEur} cents /></td>
                <td className="num">{r.currency === "EUR" ? <span className="muted">none</span> : <Signed value={r.fxEffectEur} cents />}</td>
                <td className="num">{r.holdingDays === null ? "n/a" : `${Math.round(r.holdingDays)} d`}</td>
              </tr>
              {open === r.id && r.lots.map((l) => (
                <tr className="lots" key={`${r.id}-${l.buyId}`}>
                  <td />
                  <td colSpan={2}>Lot {l.buyId}, bought {fmtDate(l.buyDate)}</td>
                  <td className="num">{fmtNum(l.quantity)} @ {fmtMoney(l.price, r.currency)}</td>
                  <td colSpan={3} />
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Trading() {
  return (
    <div className="section">
      <div className="block">
        <header>
          <h2>Realized P&amp;L by instrument</h2>
          <p>Deterministic FIFO per ticker, net of all fees. Perpetual futures are aggregated into round-trips; the crypto-to-crypto swap is a disposal at EUR fair value.</p>
        </header>
        <RealizedChart />
      </div>

      <div className="block">
        <header>
          <h2>Closed trades</h2>
          <p>
            EUR results use the exchange rate of each leg: proceeds at the sale date, cost at each purchase date. The FX column isolates the
            currency effect: the dollar weakened over the period, so US gains shrink once expressed in euros. Select an instrument to see the lots it consumed.
          </p>
        </header>
        <RealizedTable />
      </div>

      <div className="grid-2">
        <div className="block">
          <header>
            <h2>Engine vs broker statement</h2>
            <p>The FIFO engine recomputes every closed position and must agree with the realized P&amp;L reported in the IBKR Flex statement.</p>
          </header>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Ticker</th><th className="num">Engine</th><th className="num">IBKR reported</th><th className="num">Difference</th><th>Result</th></tr></thead>
              <tbody>
                {data.brokerCrossCheck.map((b) => (
                  <tr key={b.ticker}>
                    <td>{b.ticker}</td>
                    <td className="num">{fmt2(b.engineNative)}</td>
                    <td className="num">{fmt2(b.brokerReported)}</td>
                    <td className="num">{Math.abs(b.difference).toFixed(2)}</td>
                    <td><Status kind={Math.abs(b.difference) < 0.005 ? "pass" : "fail"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">Amounts in each instrument's trading currency. Report quality: {data.flexQuality.safeToReplacePositions ? "complete, safe to apply" : data.flexQuality.issues.join("; ")}.</p>
        </div>

        <div className="block">
          <header>
            <h2>Perpetual round-trips</h2>
            <p>A round-trip opens when the net position leaves zero and closes when it returns to zero.</p>
          </header>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Contract</th><th>Side</th><th>Closed</th><th className="num">Net (USD)</th><th className="num">Net (EUR)</th></tr></thead>
              <tbody>
                {data.perpRoundTrips.map((r) => (
                  <tr key={r.closedAt}>
                    <td>{r.symbol}</td><td>{r.direction === "LONG" ? "Long" : "Short"}</td><td>{fmtDate(r.closedAt)}</td>
                    <td className="num">{fmtMoney(r.netPnl, "USD")}</td><td className="num"><Signed value={r.netPnlEur} cents /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Crypto-to-crypto swap register</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Disposed</th><th>Acquired</th><th className="num">Fair value</th><th className="num">Realized</th></tr></thead>
              <tbody>
                {data.swapRegister.map((s) => (
                  <tr key={s.id}><td>{fmtDate(s.date)}</td><td>{s.disposed}</td><td>{s.acquired}</td><td className="num">{fmtEur(s.valueEur)}</td><td className="num"><Signed value={s.realizedEur} cents /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="block">
        <header>
          <h2>Open positions</h2>
          <p>Spot positions are valued at market; derivatives contribute only their mark-to-market, never their notional.</p>
        </header>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Instrument</th><th>Account</th><th className="num">Quantity</th><th className="num">Price</th><th className="num">Value (EUR)</th><th className="num">Unrealized (EUR)</th></tr></thead>
            <tbody>
              {data.positions.map((p) => (
                <tr key={`${p.accountId}-${p.ticker}`}>
                  <td>{p.ticker}<div className="small muted">{ASSET_LABEL[p.assetClass]}{p.ownershipPct < 100 ? `, ${p.ownershipPct} % owned` : ""}</div></td>
                  <td className="small">{p.accountName}</td>
                  <td className="num">{fmtNum(p.quantity)}</td>
                  <td className="num">{fmtMoney(p.price, p.currency)}</td>
                  <td className="num">{fmtEur(p.valueEur)}</td>
                  <td className="num"><Signed value={p.unrealizedEur} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
