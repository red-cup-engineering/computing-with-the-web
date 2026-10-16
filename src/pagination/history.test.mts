import test from "node:test";
import assert from "node:assert/strict";
import { paginateFeed, feedHistoryClaim, foldFeedHistoryClaims } from "./index.mjs";
import type { KnowledgeReading } from "../taxonomy/four.mjs";
test("feed history retains classifications, witnesses and contrary claims", () => {
  const witness={by:"supplied",opaque(){return true;}};
  const first=paginateFeed([1,2,3],2,0), last=paginateFeed([1,2,3],2,1), single=paginateFeed([1],2,0);
  const cases=[
    [first,"complete","active"],[last,"complete","active"],[single,"complete","potential"],
    [first,"archive","active"],[last,"archive","potential"],
    [first,"subscription","potential"],[last,"subscription","active"],
  ] as const;
  for(const [page,kind,value] of cases) {
    const claim=feedHistoryClaim(page,kind,witness);
    assert.equal(claim.value,value);
    assert.equal(claim.predicate,"feed-history:"+(value==="active"?"not-":"")+kind);
    assert.equal(claim.witness,witness);
    assert.equal(claim.evidence.provenance,witness);
    assert.deepEqual(claim.evidence.cell.for,[claim.utterance]);
    assert.deepEqual(claim.evidence.cell.against,[]);
  }
  const implicit=feedHistoryClaim(first,"complete");
  assert.deepEqual(implicit.witness,{page:0,claim:"complete"});
  assert.equal(feedHistoryClaim(first,"complete",null).witness,null);
});
test("feed folds use the real knowledge join and absurd identity for all readings", () => {
  const base=feedHistoryClaim(paginateFeed([1],2,0),"complete");
  const readings: readonly KnowledgeReading[]=["absurd","potential","active","stable"];
  const expected=[["absurd","potential","active","stable"],["potential","potential","stable","stable"],["active","stable","active","stable"],["stable","stable","stable","stable"]];
  assert.equal(foldFeedHistoryClaims([]),"absurd");
  for(const [i,left] of readings.entries())for(const [j,right] of readings.entries()){
    const claims=[{...base,value:left},{...base,value:right}];
    assert.equal(foldFeedHistoryClaims(claims),expected[i]?.[j]);
    assert.equal(foldFeedHistoryClaims([...claims].reverse()),expected[i]?.[j]);
    assert.equal(foldFeedHistoryClaims([...claims,...claims]),expected[i]?.[j]);
  }
});

