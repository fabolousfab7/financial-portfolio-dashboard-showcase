const eur0 = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur2 = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat("en-IE", { maximumFractionDigits: 6 });
const pct = new Intl.NumberFormat("en-IE", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const fmtEur = (v: number) => eur0.format(Math.round(v) === 0 ? 0 : v);
export const fmtEur2 = (v: number) => eur2.format(v);
export const fmtSigned = (v: number, cents = false) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${(cents ? eur2 : eur0).format(Math.abs(v))}`;
export const fmtNum = (v: number) => num.format(v);
export const fmtPct = (v: number | null) => (v === null ? "n/a" : `${v > 0 ? "+" : ""}${pct.format(v)}`);
export const fmtDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const fmtMoney = (v: number, ccy: string) => `${v.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy}`;
export const fmt2 = (v: number) => v.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
