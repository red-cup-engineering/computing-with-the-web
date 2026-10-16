import test from "node:test";
import assert from "node:assert/strict";
import { admitTheme, minimal } from "./index.mjs";
test("theme violations assert their own contrary predicates with preserved reasons", () => {
  const good=admitTheme(minimal);
  assert.equal(good.value,"potential");
  assert.equal(good.entries[0]?.predicate.value,"satisfies-theme-contract");
  const bad=admitTheme({name:"bad",head(){return ""},footer(){return ""},wrap(s:string){return s},css:""});
  assert.equal(bad.value,"active");
  assert.equal(bad.admitted,false);
  assert.equal(bad.settlement.kind,"web.theme-assessment");
  assert.equal(bad.entries.length,bad.judgments.length);
  for(const [i,entry] of bad.entries.entries()){
    assert.equal(entry.predicate.value,"violates-theme-contract");
    assert.equal(entry.provenance,bad.judgments[i]?.reason);
    assert.equal(entry.object.value,bad.judgments[i]?.path);
    assert.equal(entry.utterance,bad.utterances[i]);
    assert.deepEqual(entry.cell.for,[entry.utterance]);
    assert.deepEqual(entry.cell.against,[]);
  }
  for(const invalid of [null,1,{}, {name:""}, {...minimal,name:""}, {...minimal,css:4}]){
    assert.equal(admitTheme(invalid).admitted,false);
  }
});

