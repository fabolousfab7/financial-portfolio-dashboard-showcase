import { data } from "../data";
import { Status } from "./Status";

const FIELDS: [keyof (typeof data.extractions)[number]["extraction"], string][] = [
  ["supplierName", "Supplier"],
  ["supplierCountry", "Country"],
  ["invoiceNumber", "Number"],
  ["invoiceDate", "Date"],
  ["currency", "Currency"],
  ["totalExclVat", "Excl. VAT"],
  ["vatAmount", "VAT"],
  ["totalInclVat", "Incl. VAT"],
  ["vatRate", "VAT rate"],
];

const REGIME: Record<string, string> = {
  domestic: "Domestic VAT",
  intra_eu_reverse_charge: "Intra-EU reverse charge",
  non_eu_import_services: "Non-EU services, reverse charge",
};

export function AiExtraction() {
  return (
    <div className="section">
      <div className="block">
        <header>
          <h2>Invoice extraction with a vision model</h2>
          <p>
            An uploaded invoice is read by a vision model that returns structured JSON. That output is treated as an unverified claim: accounting rules
            re-check every field before anything is booked, and failures go to a person instead of being silently corrected.
          </p>
        </header>
        <div className="note">
          Checks applied to every extraction: mandatory fields present; ISO currency code; date not in the future; excl. VAT + VAT = incl. VAT
          within 0.02; VAT = base × rate; rate exists in France for domestic suppliers; no foreign VAT charged where reverse charge applies; EU VAT number present.
        </div>
        <div className="extractions">
          {data.extractions.map((e) => (
            <article className="doc" key={e.file}>
              <header>
                <h3>{e.file}</h3>
                {e.status === "ready_to_book" ? <Status kind="pass" label="Ready to book" /> : <Status kind="review" />}
              </header>
              <dl>
                {FIELDS.map(([k, label]) => (
                  <div key={k} style={{ display: "contents" }}>
                    <dt>{label}</dt>
                    <dd>{e.extraction[k] === null ? <span className="muted">not printed</span> : k === "vatRate" ? `${Number(e.extraction[k]) * 100} %` : String(e.extraction[k])}</dd>
                  </div>
                ))}
                <dt>Regime</dt>
                <dd>{e.regime ? REGIME[e.regime] : <span className="muted">undetermined</span>}</dd>
              </dl>
              {e.issues.length === 0 ? (
                <ul className="issues none"><li>All checks passed.</li></ul>
              ) : (
                <ul className="issues">
                  {e.issues.map((i, n) => (
                    <li key={n}><strong>{i.severity === "error" ? "Blocking" : "Warning"}:</strong> {i.message}</li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
        <p className="small muted">Recorded model responses on fictional documents. With an API key configured, the server calls the Anthropic Messages API instead.</p>
      </div>
    </div>
  );
}
