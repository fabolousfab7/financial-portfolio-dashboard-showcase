import { useState } from "react";
import { data } from "./data";
import { fmtDate } from "./format";
import { Overview } from "./components/Overview";
import { Trading } from "./components/Trading";
import { Bookkeeping } from "./components/Bookkeeping";
import { AiExtraction } from "./components/AiExtraction";
import { Checks } from "./components/Checks";

const TABS = [
  { id: "overview", label: "Overview", render: () => <Overview /> },
  { id: "trading", label: "Trading P&L", render: () => <Trading /> },
  { id: "books", label: "Bookkeeping & VAT", render: () => <Bookkeeping /> },
  { id: "ai", label: "AI invoice extraction", render: () => <AiExtraction /> },
  { id: "checks", label: "Integrity checks", count: `${data.checks.filter((c) => c.pass).length}/${data.checks.length}`, render: () => <Checks /> },
] as const;

export function App() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("overview");
  const current = TABS.find((t) => t.id === tab)!;
  return (
    <>
      <div className="banner" role="note">{data.disclaimer}</div>
      <div className="shell">
        <header className="masthead">
          <div>
            <h1>{data.entityName} — consolidated wealth</h1>
            <p className="sub">Holding company and personal accounts, as of {fmtDate(data.asOf)}. All figures in EUR.</p>
          </div>
        </header>
        <nav className="tabs" role="tablist" aria-label="Dashboard sections">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
              {"count" in t && <span className="count">{t.count}</span>}
            </button>
          ))}
        </nav>
        <main role="tabpanel">{current.render()}</main>
        <footer className="site">
          <span>{data.disclaimer} Accounts, amounts, suppliers and transactions are fictional; tickers are used for realism and their prices here are not market data.</span>
          <span>Every figure is computed in your browser by the open-source engine in <code>core/</code>, from the raw files in <code>demo/raw</code>.</span>
        </footer>
      </div>
    </>
  );
}
