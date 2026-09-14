import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeEventTopics,keccak256,type Hex } from 'viem';
import { mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { monitor } from '../src/executor/monitor.js';
import { type Attempt,readAttempt } from '../src/executor/state.js';
import type { Endpoint } from '../src/ronin.js';
import { nftAbi } from '../src/launchpad/abi.js';
import { YAKKAMON } from '../src/launchpad/yakkamon.js';

const wallet='0x1111111111111111111111111111111111111111';
const attempt:Attempt={version:1,wallet,stageIndex:2,nonce:4,hash:keccak256('0xabcd'),raw:'0xabcd',status:'broadcast',createdAt:'2026-09-12T00:00:00Z'};
const blockHash=keccak256('0x12');
const mintLog={address:YAKKAMON.nft,topics:encodeEventTopics({abi:nftAbi,eventName:'Transfer',args:{from:'0x0000000000000000000000000000000000000000',to:wallet,tokenId:1n}}),data:'0x' as Hex};

function endpoint(status='success',logs:unknown[]=[mintLog],hash=blockHash,head=12n,id='mock'):Endpoint {
  return {id,latencyMs:0,block:head,timestamp:0n,client:{
    getTransactionReceipt:async()=>({status,logs,blockNumber:10n,blockHash,gasUsed:200000n,effectiveGasPrice:40n}),
    getBlock:async(args:any)=>args.blockTag?{number:head}:{hash},
    sendRawTransaction:async()=>{throw Error('must not send');},
  } as unknown as Endpoint['client']};
}

test('confirmation requires canonical blocks AND mint Transfer to expected wallet',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'ronin-monitor-test-')),file=path.join(dir,'attempt.json');
  try {
    await monitor({...attempt},[endpoint()],file,()=>false,100);
    assert.equal((await readAttempt(file))!.status,'confirmed');
    await assert.rejects(()=>monitor({...attempt},[endpoint('success',[])],file,()=>false,100),/SUCCESS_RECEIPT_WITHOUT_EXPECTED_NFT/);
  }finally{await rm(dir,{recursive:true});}
});

test('reverted receipt persists terminal failure with no new transaction',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'ronin-monitor-test-')),file=path.join(dir,'attempt.json');
  try {
    await assert.rejects(()=>monitor({...attempt},[endpoint('reverted')],file,()=>false,100),/MINT_REVERTED/);
    assert.equal((await readAttempt(file))!.status,'reverted');
  }finally{await rm(dir,{recursive:true});}
});

test('a slow provider does not block a fast provider and each provider has one request in flight',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'ronin-monitor-test-')),file=path.join(dir,'attempt.json');
  let inFlight=0,maxInFlight=0;
  const slow={...endpoint('success',[mintLog],blockHash,12n,'slow'),client:{
    getTransactionReceipt:async()=>{inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);return new Promise<never>(()=>{});},
    getBlock:async()=>{throw Error('unreachable');},
    sendRawTransaction:async()=>{throw Error('unreachable');},
  } as unknown as Endpoint['client']};
  const fast=endpoint('success',[mintLog],blockHash,12n,'fast');
  try {
    await monitor({...attempt},[slow,fast],file,()=>false,500);
    assert.equal(maxInFlight,1);
  }finally{await rm(dir,{recursive:true});}
});

test('nullable and zero-hash preconfirmations are logged but never confirmed',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'ronin-monitor-test-')),file=path.join(dir,'attempt.json');
  const lines:string[]=[];
  const originalLog=console.log;
  console.log=(line?:unknown)=>{lines.push(String(line));};
  let calls=0;
  const pending={...endpoint(),client:{
    getTransactionReceipt:async()=>({status:'success',logs:[],blockNumber:calls++===0?null:10n,blockHash:calls===1?null:'0x0000000000000000000000000000000000000000000000000000000000000000',gasUsed:0n,effectiveGasPrice:0n}),
    getBlock:async()=>{throw Error('preconfirmation must not query blocks');},
    sendRawTransaction:async()=>{throw Error('must not send');},
  } as unknown as Endpoint['client']};
  try {
    await assert.rejects(()=>monitor({...attempt},[pending],file,()=>false,550),/MONITOR_TIMEOUT/);
    assert.equal(await readAttempt(file),undefined);
    assert.ok(lines.some(line=>JSON.parse(line).event==='receipt-preconfirmation'));
    assert.ok(calls>=2);
  }finally{console.log=originalLog;await rm(dir,{recursive:true});}
});

test('a non-canonical receipt permits identical-byte rebroadcast again',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'ronin-monitor-test-')),file=path.join(dir,'attempt.json');
  const realNow=Date.now,realStarted=realNow();
  Date.now=()=>realStarted+(realNow()-realStarted)*50;
  let sent:Hex|undefined;
  const reorganized={...endpoint('success',[mintLog],blockHash,12n,'reorg'),client:{
    getTransactionReceipt:async()=>({status:'success',logs:[mintLog],blockNumber:10n,blockHash,gasUsed:200000n,effectiveGasPrice:40n}),
    getBlock:async(args:any)=>args.blockTag?{number:12n}:{hash:keccak256('0x13')},
    sendRawTransaction:async({serializedTransaction}:{serializedTransaction:Hex})=>{sent=serializedTransaction;return attempt.hash;},
  } as unknown as Endpoint['client']};
  try {
    await assert.rejects(()=>monitor({...attempt},[reorganized],file,()=>false,40_000),/MONITOR_TIMEOUT/);
    assert.equal(sent,attempt.raw);
    assert.equal(await readAttempt(file),undefined);
  }finally{Date.now=realNow;await rm(dir,{recursive:true});}
});
