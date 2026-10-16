import test from "node:test";
import assert from "node:assert/strict";
import { peer, exchange, relayOf, composeRelays, identityRelay, traverseExchange, traverseRelay } from "./index.mjs";
test("traversal retains hop order, multiplicity and silent identity", () => {
  const a=peer("a"), b=peer("b");
  const ab=exchange(a,b,{method:"GET",medium:"text/html"});
  const ba=exchange(b,a,{method:"POST",medium:"application/json"});
  const relay=composeRelays(composeRelays(relayOf(ab),relayOf(ba)),relayOf(ab));
  const testimony={ by:"caller", opaque(){ return 1; } };
  const entries=traverseRelay(relay,{provenance:testimony});
  assert.deepEqual(entries.map(e=>[e.subject.value,e.predicate.value,e.object.value]),[
    ["a","GET text/html","b"],["b","POST application/json","a"],["a","GET text/html","b"],
  ]);
  assert.equal(entries.length,3);
  for(const entry of entries) {
    assert.equal(entry.provenance,testimony);
    assert.deepEqual(entry.cell.for,[entry.utterance]);
    assert.deepEqual(entry.cell.against,[]);
  }
  assert.deepEqual(entries[0]?.cell,entries[2]?.cell);
  assert.deepEqual(traverseRelay(identityRelay(a),{provenance:testimony}),[]);
  assert.equal(Object.hasOwn(traverseExchange(ab),"provenance"),false);
  assert.equal(Object.hasOwn(traverseExchange(ab,{provenance:undefined}),"provenance"),false);
  assert.equal(traverseExchange(ab,{provenance:null}).provenance,null);
});

