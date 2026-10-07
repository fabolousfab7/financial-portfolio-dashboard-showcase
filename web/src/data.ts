import flexXml from "../../demo/raw/ibkr-flex-sample.xml?raw";
import { buildDemoDataset } from "../../demo/dataset";

/** The whole dashboard is computed in the browser by the engine, from the raw demo files. */
export const data = buildDemoDataset({ flexXml });
export type Data = typeof data;
