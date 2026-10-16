// Rebuild only the pure SWARM fixture from independently obtained pinned files.
// Usage: node test/extract-swarm-taxonomy-fixture.mjs /path/to/pinned-swarm-src
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import ts from "typescript";

const sourceDirectory = process.argv[2];
if (!sourceDirectory) throw new TypeError("Provide the pinned SWARM src directory");
const selections = [
  ["taxonomy.mts", "0a1ae231b3cf419eee5b9959ccfadaf025ec8797", ["taxonomyItemFromTraceEntry", "taxonomyAlgebraFromTraceEntry", "termsFromTraceEntry", "termPairsFromTraceEntry", "relationDocument", "traceEntryItemId", "chargeLabel", "displayPredicate", "objectOf", "displayTerm", "instantOf", "instantCandidate", "subjectFamily", "absolute", "ensureBaseUrl"]],
  ["canonical.mts", "3a7afeee0fdcf53285d61b2b30c0f9206b34fb37", ["stableKey", "canonicalId", "canonicalAny"]],
  ["trace.mts", "d6758b68ffbc008ffe91cc99686b2f672f8b2946", ["traceEntryId", "traceEntryDigest"]],
];
const provenance = { repository: "emsenn/swarm", commit: "72847d0a5a0e3303a0ec417e793daabb0634fa8d", purpose: "Actual pure consumer projection functions; no consumer HTTP adapter or live migration", inputs: [] };
let selected = 'import { createHash } from "node:crypto";\n';
for (const [file, expected, names] of selections) {
  const source = readFileSync(join(sourceDirectory, file), "utf8");
  const bytes = Buffer.from(source);
  const gitBlob = createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
  if (gitBlob !== expected) throw new Error("Pinned source identity mismatch: " + file);
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const functions = tree.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text));
  if (functions.length !== names.length) throw new Error("Missing source function in " + file);
  for (const node of functions) selected += node.getText(tree).replace(/^export /, "") + "\n";
  provenance.inputs.push({ file: "src/" + file, gitBlob, functions: names });
}
selected += "export { taxonomyItemFromTraceEntry, taxonomyAlgebraFromTraceEntry, relationDocument };\n";
const result = ts.transpileModule(selected, { compilerOptions: { target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
if (result.diagnostics.some(d => d.category === ts.DiagnosticCategory.Error)) throw new Error("projection source parse error");
const header = "// Generated only from named functions in emsenn/swarm@72847d0a5a0e3303a0ec417e793daabb0634fa8d.\n// See swarm-taxonomy-provenance.json. Type erasure only; no invented projection or HTTP adapter.\n";
writeFileSync(new URL("./fixtures/swarm-taxonomy-projection.mjs", import.meta.url), header + result.outputText);
writeFileSync(new URL("./fixtures/swarm-taxonomy-provenance.json", import.meta.url), JSON.stringify(provenance, null, 2) + "\n");

