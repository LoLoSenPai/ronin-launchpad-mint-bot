import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256,type Hex } from 'viem';
import { broadcastSameRaw } from '../src/executor/broadcast.js';
test('all endpoints receive identical bytes and known/nonce errors stay distinct',async()=>{
  const raw='0xdeadbeef' as Hex,seen:Hex[]=[];
  const result=await broadcastSameRaw(raw,[
    {id:'a',send:async x=>{seen.push(x);return keccak256(x);}},
    {id:'b',send:async x=>{seen.push(x);throw Error('already known');}},
    {id:'c',send:async x=>{seen.push(x);throw Error('nonce too low');}},
  ]);
  assert.deepEqual(seen,[raw,raw,raw]);assert.equal(result.hash,keccak256(raw));
  assert.deepEqual(result.results.map(r=>r.status),['accepted','already-known','nonce-too-low']);
});
test('starts all submissions before waiting for a slow endpoint',async()=>{
  const raw='0xabcd' as Hex;let secondStarted=false;
  await broadcastSameRaw(raw,[
    {id:'slow',send:async x=>{await new Promise(r=>setTimeout(r,15));assert.equal(secondStarted,true);return keccak256(x);}},
    {id:'fast',send:async x=>{secondStarted=true;return keccak256(x);}},
  ]);
});
test('timeouts remain ambiguous, errors never disclose RPC secrets',async()=>{
  const result=await broadcastSameRaw('0xabcd',[{id:'a',send:async()=>{throw Error('timeout https://secret-key.example/raw=0xabcd');}}]);
  assert.equal(result.results[0]!.status,'unknown-delivery');assert.ok(!JSON.stringify(result).includes('secret'));
});
test('rejects unexpected provider hash and no endpoints',async()=>{
  const result=await broadcastSameRaw('0xabcd',[{id:'a',send:async()=>keccak256('0x12')}]);
  assert.equal(result.results[0]!.status,'hash-mismatch');
  await assert.rejects(()=>broadcastSameRaw('0xabcd',[]));
});
