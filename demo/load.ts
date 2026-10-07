/** Node-side loader for the demo dataset (server and tests). */
import { readFileSync } from "node:fs";
import { buildDemoDataset, type DemoDataset } from "./dataset";

let cached: DemoDataset | null = null;

export function loadDemoDataset(): DemoDataset {
  if (!cached) {
    const flexXml = readFileSync(new URL("./raw/ibkr-flex-sample.xml", import.meta.url), "utf8");
    cached = buildDemoDataset({ flexXml });
  }
  return cached;
}
