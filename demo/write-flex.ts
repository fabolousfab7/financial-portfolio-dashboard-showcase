import { writeFileSync } from "node:fs";
import { generateFlexXml } from "./flex-generator";

writeFileSync(new URL("./raw/ibkr-flex-sample.xml", import.meta.url), generateFlexXml());
console.log("demo/raw/ibkr-flex-sample.xml written");
