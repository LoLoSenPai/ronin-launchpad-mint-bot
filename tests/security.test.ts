import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData,parseGwei,type Address,type Hex } from 'viem';
import { readConfig } from '../src/config.js';
import { mintData,decodeMint,YAKKAMON } from '../src/launchpad/yakkamon.js';
import { allowlistAbi,launchpadAbi,nftAbi } from '../src/launchpad/abi.js';
import { validateTransaction,type MintTransaction } from '../src/security.js';
const wallet='0x1111111111111111111111111111111111111111' as Address;
const config=readConfig({EXPECTED_WALLET:wallet,MAX_TOTAL_GAS_RON:'1'});
const tx:MintTransaction={type:'eip1559',chainId:2020,to:YAKKAMON.launchpad,data:mintData(wallet),value:0n,nonce:1,gas:300000n,maxFeePerGas:parseGwei('100'),maxPriorityFeePerGas:parseGwei('40')};
test('canonical nested mint decodes to pinned OG parameters',()=>{
  const mint=decodeMint(tx.data);
  assert.equal(mint.outerSelector,'0xfb4d364c');assert.equal(mint.innerSelector,'0x55110a0c');
  assert.equal(mint.stageType,2);assert.equal(mint.stageIndex,2);assert.equal(mint.extraData,'0x');
  assert.equal(mint.recipient,wallet);assert.equal(mint.mintQuantity,1n);
  assert.ok(validateTransaction(tx,config,10n)>0n);
});
test('rejects wrong chain, destination, value, nonce and gas caps',()=>{
  for(const changes of [{chainId:1},{to:wallet},{value:1n},{nonce:-1},{gas:0n},{gas:2000001n},{maxFeePerGas:parseGwei('501')},{maxPriorityFeePerGas:1n}]) {
    assert.throws(()=>validateTransaction({...tx,...changes},config,0n));
  }
});
test('rejects arbitrary inner approvals even inside approved execute selector',()=>{
  const approve=encodeFunctionData({abi:nftAbi,functionName:'setApprovalForAll',args:[wallet,true]});
  assert.throws(()=>validateTransaction({...tx,data:encodeFunctionData({abi:launchpadAbi,functionName:'execute',args:[2,approve]})},config,0n));
});
test('rejects unapproved stage, recipient, NFT, quantity, extraData, mintAll',()=>{
  const base={nftContract:YAKKAMON.nft,recipient:wallet,mintQuantity:1n,isMintAllPossible:false,stageIndex:2,extraData:'0x' as Hex};
  for(const changes of [{nftContract:wallet},{recipient:YAKKAMON.nft},{mintQuantity:2n},{isMintAllPossible:true},{stageIndex:4},{extraData:'0x01' as Hex}]) {
    const inner=encodeFunctionData({abi:allowlistAbi,functionName:'mintAllowList',args:[{...base,...changes}]});
    const data=encodeFunctionData({abi:launchpadAbi,functionName:'execute',args:[2,inner]});
    assert.throws(()=>validateTransaction({...tx,data},config,0n));
  }
});
test('rejects trailing data and truncated encoding',()=>{
  assert.throws(()=>validateTransaction({...tx,data:`${tx.data}00`},config,0n),/NON_CANONICAL_CALLDATA/);
  assert.throws(()=>validateTransaction({...tx,data:tx.data.slice(0,40) as Hex},config,0n));
});
test('budget cannot be bypassed with execution-only calculation',()=>{
  const cap={...config,maxTotalGas:tx.gas*tx.maxFeePerGas};
  assert.throws(()=>validateTransaction(tx,cap,1n),/TOTAL_GAS_CAP_EXCEEDED/);
});
test('missing budget and expected wallet fail closed',()=>{
  assert.throws(()=>validateTransaction(tx,{...config,maxTotalGas:undefined},0n));
  assert.throws(()=>validateTransaction(tx,{...config,wallet:undefined},0n));
});
