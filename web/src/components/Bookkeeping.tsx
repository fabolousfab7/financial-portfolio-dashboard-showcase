import { data } from "../data";
import { fmt2, fmtDate, fmtEur, fmtEur2 } from "../format";
import { Status } from "./Status";

const PERIOD = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export function Bookkeeping() {
  const rec = data.reconciliation;
  const txByRef = new Map(data.bank.transactions.map((t) => [t.reference, t]));
  return (
    <div className="section">
      <div className="block">
        <header>
          <h2>Bank reconciliation</h2>
          <p>
            {data.bank.transactions.length} movements imported from the Qonto CSV export, de-duplicated on the bank reference. Movements that are not
            invoices (shareholder contribution, transfers to brokers, bank fees) are qualified to their ledger account first; the rest are matched to invoices.
          </p>
        </header>
        <div className="stat-row">
          <div><span className="v">{rec.matches.length}</span><span className="l">Matched automatically</span></div>
          <div><span className="v">{rec.suggestions.length}</span><span className="l">Suggested, awaiting confirmation</span></div>
          <div><span className="v">{rec.unmatchedInvoices.length - rec.suggestions.length}</span><span className="l">Invoice not yet paid</span></div>
          <div><span className="v">{data.bank.qualified.length}</span><span className="l">Qualified non-invoice movements</span></div>
          <div><span className="v">{fmtEur(data.bank.balanceEur)}</span><span className="l">Bank balance rebuilt from movements</span></div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Invoice</th><th>Supplier or client</th><th className="num">Invoice total</th><th>Bank movement</th><th className="num">Amount gap</th><th className="num">Days</th><th>Result</th></tr></thead>
            <tbody>
              {[...rec.suggestions, ...rec.matches.slice().sort((a, b) => a.invoice.localeCompare(b.invoice))].map((m) => {
                const tx = txByRef.get(m.transactionRef)!;
                return (
                  <tr key={m.invoiceId}>
                    <td>{m.invoice}</td>
                    <td>{m.party}</td>
                    <td className="num">{fmtEur2(m.amount)}</td>
                    <td className="small">{fmtDate(tx.date)}, {tx.counterparty}<div className="muted">{fmtEur2(Math.abs(tx.amount))}</div></td>
                    <td className="num small">{fmtEur2(m.amountDelta)}</td>
                    <td className="num small">{Math.round(m.dayDelta)}</td>
                    <td>{m.tier === "auto" ? <Status kind="pass" label="Matched" /> : <Status kind="review" label="Suggested" />}</td>
                  </tr>
                );
              })}
              {rec.unmatchedInvoices.filter((n) => !rec.suggestions.some((s) => s.invoice === n)).map((n) => (
                <tr key={n}><td>{n}</td><td colSpan={5} className="muted">No payment found yet</td><td><Status kind="manual" label="Open" /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">Auto: amount within ±0.10 €, date within ±3 days and matching counterparty. Suggested: amount within 5 %, date within 30 days. One bank movement can settle one invoice only.</p>
      </div>

      <div className="block">
        <header>
          <h2>Monthly VAT returns (CA3)</h2>
          <p>Built from the booked invoices. Intra-EU and non-EU services are self-assessed under the reverse-charge mechanism: the VAT is both due and deductible. Each month's credit carries into the next return.</p>
        </header>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Period</th><th className="num">Collected</th><th className="num">Reverse charge</th><th className="num">Gross due (16)</th>
                <th className="num">Credit brought in (22)</th><th className="num">Deductible (23)</th><th className="num">Carried forward (27)</th><th className="num">Net due (28)</th>
              </tr>
            </thead>
            <tbody>
              {data.vat.map((v) => (
                <tr key={v.period}>
                  <td>{PERIOD(v.period)}</td>
                  <td className="num">{fmt2(v.collectedVatEur)}</td>
                  <td className="num">{fmt2(v.reverseChargeVatEur)}</td>
                  <td className="num">{fmt2(v.line16GrossDue)}</td>
                  <td className="num">{fmt2(v.line22PreviousCredit)}</td>
                  <td className="num">{fmt2(v.line23TotalDeductible)}</td>
                  <td className="num">{fmt2(v.line27CreditCarriedForward)}</td>
                  <td className="num">{v.line28NetDue > 0 ? <strong>{fmt2(v.line28NetDue)}</strong> : fmt2(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">Amounts in EUR. A monthly refund can only be claimed for a credit of at least 760 €; below that it is carried forward. Simplified model for illustration, not tax advice.</p>
      </div>
    </div>
  );
}
