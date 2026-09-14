import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readAttempt,saveAttempt,lockWallet,type Attempt } from '../src/executor/state.js';
import { keccak256 } from 'viem';
test('attempt survives restart and updates without losing raw transaction',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'ronin-bot-test-')),file=path.join(dir,'attempt.json');
  try {
    assert.equal(await readAttempt(file),undefined);
    const a:Attempt={version:1,wallet:'0x1111111111111111111111111111111111111111',stageIndex:2,nonce:1,hash:keccak256('0xabcd'),raw:'0xabcd',status:'signed',createdAt:new Date().toISOString()};
    await saveAttempt(file,a);assert.deepEqual(await readAttempt(file),a);
    await saveAttempt(file,{...a,status:'broadcast'});
    assert.equal((await readAttempt(file))!.raw,a.raw);
    assert.equal(JSON.parse(await readFile(file,'utf8')).status,'broadcast');
  }finally {await rm(dir,{recursive:true});}
});
test('wallet lock prevents concurrent executors across stages',async()=>{
  const wallet=`test-wallet-${process.pid}`;
  const release=await lockWallet(wallet);
  try{await assert.rejects(()=>lockWallet(wallet),/WALLET_LOCKED/);}finally{await release();}
  await (await lockWallet(wallet))();
});
