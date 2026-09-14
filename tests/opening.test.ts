import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeErrorResult} from 'viem';
import {openingGate} from '../src/executor/opening.js';
import {readConfig} from '../src/config.js';
import {allowlistAbi} from '../src/launchpad/abi.js';
import type {Endpoint} from '../src/ronin.js';
const config=readConfig({EXPECTED_WALLET:'0x1111111111111111111111111111111111111111'});
const endpoint=(id:string,call:()=>Promise<unknown>)=>({id,client:{call}} as unknown as Endpoint);
test('opening gate uses successful RPC without waiting for stalled peer',async()=>{
  const stalled=endpoint('stalled',()=>new Promise(()=>{}));
  const fast=endpoint('fast',async()=>({data:'0x'}));
  assert.equal((await openingGate([stalled,fast],config))?.id,'fast');
});
test('not-started waits without permitting a transaction',async()=>{
  const closed=endpoint('closed',async()=>{throw {data:encodeErrorResult({abi:allowlistAbi,errorName:'ErrStageNotStarted'})};});
  assert.equal(await openingGate([closed],config),undefined);
});
test('network failures remain retryable without opening the gate',async()=>{
  const broken=endpoint('broken',async()=>{throw Error('unavailable');});
  await assert.rejects(openingGate([broken],config),/SIMULATION_FAILED/);
});
test('repeated gates do not accumulate requests on a stalled provider',async()=>{
  let calls=0;
  const stalled=endpoint('stalled',()=>{calls++;return new Promise(()=>{});});
  const fast=endpoint('fast',async()=>({data:'0x'}));
  await openingGate([stalled,fast],config);
  await openingGate([stalled,fast],config);
  assert.equal(calls,1);
});
