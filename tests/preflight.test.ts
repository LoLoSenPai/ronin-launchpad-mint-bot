import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeErrorResult } from 'viem';
import { readConfig } from '../src/config.js';
import { simulateNow,simulateAtOpening } from '../src/executor/prepare.js';
import { run } from '../src/executor/run.js';
import { allowlistAbi } from '../src/launchpad/abi.js';
import type { Client } from '../src/ronin.js';
const config=readConfig({EXPECTED_WALLET:'0x1111111111111111111111111111111111111111'});
test('early timestamp revert is classified without treating it as successful simulation',async()=>{
  const data=encodeErrorResult({abi:allowlistAbi,errorName:'ErrStageNotStarted'});
  const client={call:async()=>{throw {cause:{data}};}} as unknown as Client;
  assert.deepEqual(await simulateNow(client,config),{status:'not-started'});
});
test('actual successful eth_call is separate from future hypothetical simulation',async()=>{
  const methods:string[]=[];
  const client={call:async()=>({data:'0x'}),request:async(request:any)=>{methods.push(request.method);assert.equal(request.params[0].blockStateCalls[0].stateOverrides,undefined);return [{calls:[{status:'0x1',gasUsed:'0x186a0'}]}];}} as unknown as Client;
  assert.equal((await simulateNow(client,config)).status,'success');
  assert.equal((await simulateAtOpening(client,config,1789430400n)).status,'hypothetical-success');
  assert.deepEqual(methods,['eth_simulateV1']);
});
test('RPC failure never passes as expected not-started',async()=>{
  const client={call:async()=>{throw Error('network unavailable');}} as unknown as Client;
  await assert.rejects(()=>simulateNow(client,config),/SIMULATION_FAILED/);
});
test('execution is disabled by default before any RPC or signing',async()=>{
  await assert.rejects(()=>run(config),/MAINNET_DISABLED/);
});
test('read-only configuration never needs or exposes the supplied private key',()=>{
  const c=readConfig({RONIN_PRIVATE_KEY:'deliberately-invalid-secret',EXPECTED_WALLET:config.wallet});
  assert.ok(!JSON.stringify(c,(_,v)=>typeof v==='bigint'?v.toString():v).includes('secret'));
  assert.equal(c.enableMainnet,false);
});
