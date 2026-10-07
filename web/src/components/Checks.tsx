import { data } from "../data";
import { fmt2 } from "../format";
import { Status } from "./Status";

export function Checks() {
  const failed = data.checks.filter((c) => !c.pass).length;
  return (
    <div className="section">
      <div className="block">
        <header>
          <h2>Integrity checks</h2>
          <p>
            Invariants recomputed every time the dashboard loads. Each number shown elsewhere is derived from raw broker and bank files by the
            engine; these checks prove the pieces agree with each other and with the broker's own statement.
          </p>
        </header>
        <p><strong>{data.checks.length - failed} of {data.checks.length} checks pass.</strong></p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Check</th><th className="num">Expected</th><th className="num">Computed</th><th>Result</th></tr></thead>
            <tbody>
              {data.checks.map((c) => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td className="num">{fmt2(c.expected)}</td>
                  <td className="num">{fmt2(c.actual)}</td>
                  <td><Status kind={c.pass ? "pass" : "fail"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
