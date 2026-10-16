import test from "node:test";
import assert from "node:assert/strict";
import fixtures from "./fixtures/indieauth-byte-fixtures.json" with { type: "json" };
import { mintToken, verifyToken, tokenHasScope, bearerFromHeader } from "../dist/indieauth/index.mjs";
for(const fixture of fixtures.fixtures) test("IndieAuth bytes: "+fixture.name,()=>{
  const minted=mintToken(fixture.params,fixture.secret);
  assert.equal(minted.token,fixture.canonicalToken);
  assert.equal(minted.token===fixture.legacyToken,fixture.equal);
  const verified=verifyToken(fixture.legacyToken,fixture.secret,{now:30000});
  assert.equal(verified.valid,true);
  assert.equal(verified.claims.me,fixture.params.me);
  assert.equal(tokenHasScope(verified.claims,"update"),true);
  assert.equal(bearerFromHeader("Bearer "+fixture.legacyToken),fixture.legacyToken);
  assert.equal(verifyToken(fixture.legacyToken,fixture.secret,{now:70000}).reason,"token expired");
  assert.equal(verifyToken(fixture.legacyToken,fixture.secret+"wrong",{now:30000}).reason,"signature mismatch");
});
test("IndieAuth uses canonical JSON admission without changing token verification",()=>{
  const params=fixtures.fixtures[0].params;
  for(const extra of [{bad:undefined},{bad:NaN},{bad:()=>1}]){
    assert.throws(()=>mintToken({...params,extra},"secret"),TypeError);
  }
  assert.equal(verifyToken("bad","secret").valid,false);
});

