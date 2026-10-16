// Supplementary audit against the exact independently obtained supplier source.
// Usage: node test/audit-data-provider.mjs /path/to/d974d4ec-src-four.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as installed from "@red-cup-engineering/computer-data-engineering-services-section/four";

const sourcePath = process.argv[2];
if (!sourcePath) throw new TypeError("Provide the pinned Data src/four.mjs");
const bytes = readFileSync(sourcePath);
const gitBlob = content => createHash("sha1").update("blob " + content.length + "\0").update(content).digest("hex");
const sourceBlob = gitBlob(bytes);
assert.equal(sourceBlob, "680fdd6f16dd1442761f03dfb99202b172026ce8");
const pinned = await import(pathToFileURL(resolve(sourcePath)).href);
const names = ["absurd", "potential", "active", "stable"];
assert.deepEqual(pinned.readingFamilies.knowledge, names);
assert.deepEqual(installed.readingFamilies.knowledge, names);
assert.equal(typeof pinned.knowledgeJoinReading, "function");
assert.equal(typeof installed.knowledgeJoinReading, "function");
const comparisons = [];
for (const left of names) for (const right of names) {
  const sourceResult = pinned.knowledgeJoinReading(left, right);
  const installedResult = installed.knowledgeJoinReading(left, right);
  assert.ok(names.includes(sourceResult));
  assert.ok(names.includes(installedResult));
  assert.equal(installedResult, sourceResult);
  comparisons.push({ left, right, sourceResult, installedResult });
}
assert.equal(comparisons.length, 16);
// Check the supplier's actual exception class and message, including "families".
for (const supplier of [pinned, installed]) {
  assert.throws(() => supplier.knowledgeJoinReading("potential", "true"), {
    name: "TypeError",
    message: "four: potential (knowledge) and true (truth) are named in different families",
  });
}
const require = createRequire(import.meta.url);
const installedPath = require.resolve("@red-cup-engineering/computer-data-engineering-services-section/four");
const installedBytes = readFileSync(installedPath);
console.log(JSON.stringify({
  observedAt: new Date().toISOString(),
  sourceCommit: "d974d4ec978a9da73c51ac3f958cdbc10f254e23",
  sourceBlob,
  installedPath,
  installedBlob: gitBlob(installedBytes),
  installedSha512: createHash("sha512").update(installedBytes).digest("hex"),
  installedVersion: require("@red-cup-engineering/computer-data-engineering-services-section/package.json").version,
  identicalWholeFile: bytes.equals(installedBytes),
  mixedFamilyRejection: "Both providers throw the exact expected TypeError",
  comparisons,
}, null, 2));

