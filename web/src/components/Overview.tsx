import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { data } from "../data";
import { fmtDate, fmtEur, fmtPct } from "../format";
import { Signed } from "./Signed";
import { Status } from "./Status";

const SOURCE_LABEL: Record<string, string> = {
  ibkr_flex: "IBKR Flex Query (XML)",
  kraken_spot: "Kraken Spot REST API",
  kraken_futures: "Kraken Futures REST API",
  qonto_csv: "Qonto CSV import",
  manual: "Manual entry",
};

function NlvChart() {
  const series = data.series.map((p) => ({ date: p.date, total: Math.round(p.total) }));
  const min = Math.min(...series.map((p) => p.total));
  const max = Math.max(...series.map((p) => p.total));
  const step = 10_000;
  const lo = Math.floor((min - (max - min) * 0.05) / step) * step;
  const hi = Math.ceil((max + (max - min) * 0.05) / step) * step;
  const ticks = Array.from({ length: (hi - lo) / step + 1 }, (_, i) => lo + i * step);
  return (
    <div className="chart-frame" role="img" aria-label={`Net liquidation value from ${fmtEur(series[0]!.total)} to ${fmtEur(series.at(-1)!.total)}`}>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="nlvFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--line)" stopOpacity={0.16} />
              <stop offset="100%" stopColor="var(--line)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--rule)" strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}
            ticks={series.filter((p) => p.date.endsWith("-01")).map((p) => p.date)}
            tick={{ fill: "var(--ink-3)", fontSize: 12 }}
            axisLine={{ stroke: "var(--rule)" }}
            tickLine={false}
          />
          <YAxis
            domain={[lo, hi]}
            ticks={ticks}
            tickFormatter={(v: number) => `€${Math.round(v / 1000)}k`}
            tick={{ fill: "var(--ink-3)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip
            cursor={{ stroke: "var(--ink-3)", strokeWidth: 1 }}
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--rule)", borderRadius: 6, color: "var(--ink)", fontSize: 13 }}
            labelFormatter={(d) => fmtDate(String(d))}
            formatter={(v) => [fmtEur(Number(v)), "Net liquidation value"]}
          />
          <Area type="monotone" dataKey="total" stroke="var(--line)" strokeWidth={2} fill="url(#nlvFill)" dot={false} activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function Allocation() {
  const rows = [...data.accounts].sort((a, b) => b.nlvEur - a.nlvEur);
  const max = Math.max(...rows.map((r) => r.nlvEur));
  return (
    <div className="block">
      <header>
        <h2>Allocation by account</h2>
        <p>Holding company and personal accounts consolidated in EUR. Jointly held assets count for the owned share only.</p>
      </header>
      <div className="legend" aria-hidden="true">
        <span><i style={{ background: "var(--line)" }} />Holding company</span>
        <span><i style={{ background: "#1baf7a" }} />Personal</span>
      </div>
      <div className="bars">
        {rows.map((r) => (
          <div className="bar-row" key={r.id}>
            <span>{r.name}</span>
            <div className="bar-track" title={`${r.name}: ${fmtEur(r.nlvEur)}`}>
              <div className={`bar-fill ${r.entity}`} style={{ width: `${(r.nlvEur / max) * 100}%` }} />
            </div>
            <span className="num" style={{ textAlign: "right" }}>{fmtEur(r.nlvEur)}</span>
          </div>
        ))}
      </div>
      <div className="facts">
        <span>Holding <strong>{fmtEur(data.wealth.byEntity.holding)}</strong></span>
        <span>Personal <strong>{fmtEur(data.wealth.byEntity.personal)}</strong></span>
        <span>Indicative after-tax value <strong>{fmtEur(data.wealth.indicativeNetEur)}</strong></span>
      </div>
      <p className="small muted">{data.wealth.assumptions}</p>
    </div>
  );
}

export function Overview() {
  const k = data.kpis;
  const opening = k.portfolioValueEur - k.externalFlowsYtdEur - k.ytdPnlEur;
  return (
    <div className="section">
      <div className="block">
        <header>
          <h2>Year to date, {fmtDate(data.yearStart)} to {fmtDate(data.asOf)}</h2>
        </header>
        <div className="rollforward" aria-label="Portfolio roll-forward">
          <div className="term"><span className="label">Opening value</span><span className="value">{fmtEur(opening)}</span></div>
          <span className="op" aria-hidden="true">+</span>
          <div className="term"><span className="label">External contributions</span><span className="value">{fmtEur(k.externalFlowsYtdEur)}</span></div>
          <span className="op" aria-hidden="true">+</span>
          <div className="term"><span className="label">YTD P&amp;L</span><span className="value"><Signed value={k.ytdPnlEur} /></span></div>
          <span className="op" aria-hidden="true">=</span>
          <div className="term closing"><span className="label">Portfolio value</span><span className="value">{fmtEur(k.portfolioValueEur)}</span></div>
        </div>
        <div className="facts">
          <span>Cash <strong>{fmtEur(k.cashEur)}</strong></span>
          <span>Return (Modified Dietz) <strong>{fmtPct(k.ytdReturnModifiedDietz)}</strong></span>
          <span>Realized P&amp;L <strong>{fmtEur(k.realizedYtdEur)}</strong></span>
          <span>Unrealized on open positions <strong>{fmtEur(k.unrealizedEur)}</strong></span>
        </div>
        <p className="small muted">Transfers between the holding's own accounts net to zero and are not contributions. P&amp;L excludes all external cash flows.</p>
      </div>

      <div className="block">
        <header>
          <h2>Net liquidation value</h2>
          <p>Daily snapshots per account, consolidated. A day without a snapshot carries the last known value forward instead of dropping to zero.</p>
        </header>
        <NlvChart />
      </div>

      <div className="grid-2">
        <div className="block">
          <header>
            <h2>Accounts</h2>
            <p>Each integration syncs independently: a broker in cool-down never blocks price refreshes elsewhere.</p>
          </header>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Account</th><th className="hide-sm">Source</th><th className="num">Value</th><th className="num">YTD P&amp;L</th><th>Status</th></tr>
              </thead>
              <tbody>
                {data.accounts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.name}<div className="small muted">{a.entity === "holding" ? "Holding company" : "Personal"}</div></td>
                    <td className="small hide-sm">{SOURCE_LABEL[a.source]}</td>
                    <td className="num">{fmtEur(a.nlvEur)}</td>
                    <td className="num"><Signed value={a.ytdPnlEur} /></td>
                    <td title={a.syncNote}><Status kind={a.syncStatus} />{a.syncStatus !== "ok" || a.source === "qonto_csv" ? <div className="small muted hide-sm">{a.syncNote}</div> : null}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td>Total</td><td className="hide-sm" /><td className="num">{fmtEur(k.portfolioValueEur)}</td><td className="num"><Signed value={k.ytdPnlEur} /></td><td /></tr>
              </tfoot>
            </table>
          </div>
        </div>
        <Allocation />
      </div>
    </div>
  );
}
