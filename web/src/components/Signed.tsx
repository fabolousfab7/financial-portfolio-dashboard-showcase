import { fmtSigned } from "../format";

/** A signed amount: sign in the text, polarity dot as a secondary cue. */
export function Signed({ value, cents = false }: { value: number | null; cents?: boolean }) {
  if (value === null) return <span className="muted">n/a</span>;
  const rounded = Math.round(value * (cents ? 100 : 1));
  return <span className={rounded > 0 ? "pos" : rounded < 0 ? "neg" : undefined}>{fmtSigned(value, cents)}</span>;
}
