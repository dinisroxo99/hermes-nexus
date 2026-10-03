import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { produceStrongDirectCouplingWitness } from "../src/lib/direct-coupling-producer.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const observationPath = process.argv[2];
const outPath = process.argv[3];
if (!observationPath || !outPath) {
  process.stderr.write("usage: emit-track-b-direct-coupling-witness.js <observation.json> <witness.json>\n");
  process.exit(2);
}
const observation = JSON.parse(fs.readFileSync(observationPath, "utf8"));
const witness = produceStrongDirectCouplingWitness(root, observation);
const omitted = witness.coverage.unresolvedOrOmitted;
if (omitted.requiredPartsUnresolved.length !== 0 || omitted.requiredPartsOmitted.length !== 0) {
  throw new Error("refusing to write a witness with unresolved or omitted required parts");
}
if (witness.initialSatisfaction.satisfied !== true || witness.oneSidedViolation.equalAfter !== false) {
  throw new Error("refusing to write a witness that is not initially satisfied and one-sided violated");
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(witness, null, 2)}\n`);
