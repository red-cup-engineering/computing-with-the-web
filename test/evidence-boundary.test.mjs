import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const target=new URL("../dist/evidence.mjs",import.meta.url).href;
const scenarios=[
  ["missing export","@red-cup-engineering/signcell/mark","({})","must export mark"],
  ["noncallable export","@red-cup-engineering/signcell/mark","({...real,mark:7})","must export mark"],
  ["malformed mark","@red-cup-engineering/signcell/mark","({...real,mark:()=>({kind:'wrong',value:'x'})})","mark returned an invalid carrier"],
  ["malformed utterance","@red-cup-engineering/signcell/utterance","({...real,utterEvidence:()=>({kind:'utterance.carrier',token:{},claim:{}})})","utterance returned an invalid carrier"],
  ["malformed cell","@red-cup-engineering/signcell/cell","({...real,cell:()=>({subject:1,predicate:2,object:3,for:{},against:[]})})","cell returned an invalid carrier"],
];
for(const [name,request,replacement,message]of scenarios)test("evidence boundary refuses "+name,()=>{
  // Each substitution exists only in this disposable test process. Production has no injection hook.
  const source="import Module from 'node:module'; const original=Module._load; Module._load=function(request,...args){const real=original.call(this,request,...args);return request==="+JSON.stringify(request)+"?"+replacement+":real;}; const {mark,webEvidence}=await import("+JSON.stringify(target)+"); webEvidence(mark('s'),mark('p'),mark('o'));";
  const result=spawnSync(process.execPath,["--input-type=module","-e",source],{encoding:"utf8",timeout:20000});
  assert.equal(result.error,undefined);
  assert.notEqual(result.status,0);
  assert.ok(result.stderr.includes(message),result.stderr);
});

