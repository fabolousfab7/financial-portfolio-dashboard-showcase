type Kind = "ok" | "partial" | "manual" | "pass" | "fail" | "review";

const META: Record<Kind, { label: string; color: string; shape: "check" | "half" | "dash" | "cross" | "flag" }> = {
  ok: { label: "Synced", color: "var(--good)", shape: "check" },
  pass: { label: "Pass", color: "var(--good)", shape: "check" },
  partial: { label: "Partial", color: "var(--warning)", shape: "half" },
  review: { label: "Needs review", color: "var(--warning)", shape: "flag" },
  manual: { label: "Manual", color: "var(--ink-3)", shape: "dash" },
  fail: { label: "Fail", color: "var(--critical)", shape: "cross" },
};

/** Status is always icon + label, never colour alone. */
export function Status({ kind, label }: { kind: Kind; label?: string }) {
  const m = META[kind];
  return (
    <span className="status">
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="6.25" fill="none" stroke={m.color} strokeWidth="1.5" />
        {m.shape === "check" && <path d="M4 7.2 6.1 9.2 10 5" fill="none" stroke={m.color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />}
        {m.shape === "half" && <path d="M7 1.5a5.5 5.5 0 0 1 0 11z" fill={m.color} />}
        {m.shape === "dash" && <path d="M4.5 7h5" stroke={m.color} strokeWidth="1.6" strokeLinecap="round" />}
        {m.shape === "cross" && <path d="M4.8 4.8l4.4 4.4M9.2 4.8l-4.4 4.4" stroke={m.color} strokeWidth="1.6" strokeLinecap="round" />}
        {m.shape === "flag" && <path d="M7 3.8v4M7 10.1v.1" stroke={m.color} strokeWidth="1.8" strokeLinecap="round" />}
      </svg>
      {label ?? m.label}
    </span>
  );
}
