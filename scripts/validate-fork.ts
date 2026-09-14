import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createPublicClient,createTestClient,http,defineChain,type Address,type Hex } from 'viem';
import { readConfig } from '../src/config.js';
import { preflight,prepare } from '../src/executor/prepare.js';
import { buildStaged,assertStagedFresh } from '../src/executor/staged.js';
import { openingGate } from '../src/executor/opening.js';
import { launchpadAbi,nftAbi } from '../src/launchpad/abi.js';
import { YAKKAMON,mintData,expectedStage } from '../src/launchpad/yakkamon.js';
import { makeClient,type Client } from '../src/ronin.js';
import { json,requireThat,sleep } from '../src/util.js';

// Hardcoded loopback destination and chain 31337: this script never sends a tx to the upstream RPC.
const url='http://127.0.0.1:18547';
const samples=JSON.parse(await readFile('research/raw/whitelist-samples.json','utf8'));
const wallet=samples[2].wallet as Address;
const upstream=makeClient('https://api.roninchain.com/rpc');
const block=(await upstream.getBlockNumber({cacheTime:0}))/1000n*1000n;
const localChain=defineChain({id:31337,name:'Local Ronin fork',nativeCurrency:{name:'RON',symbol:'RON',decimals:18},rpcUrls:{default:{http:[url]}}});
const local=createPublicClient({chain:localChain,transport:http(url,{retryCount:0,timeout:60000}),cacheTime:0});
const testClient=createTestClient({chain:localChain,mode:'anvil',transport:http(url,{retryCount:0,timeout:15000})});
// Do not accidentally reuse an unrelated local node.
try {await local.getChainId();throw Error('PORT_ALREADY_IN_USE');}catch(e){if((e as Error).message==='PORT_ALREADY_IN_USE')throw e;}
const arch=process.arch==='x64'?'amd64':process.arch;
const req=createRequire(import.meta.resolve('@foundry-rs/anvil/package.json'));
const pkg=req.resolve(`@foundry-rs/anvil-${process.platform}-${arch}/package.json`);
const exe=path.join(path.dirname(pkg),'bin',process.platform==='win32'?'anvil.exe':'anvil');
// A fork loads many storage slots: serialize and throttle upstream reads, independently
// of the production bot. This proxy cannot forward any signing or submission method.
let queue=Promise.resolve();
const allowed=new Set(['eth_chainId','eth_blockNumber','eth_feeHistory','eth_gasPrice','eth_getBlockByNumber','eth_getBlockByHash','eth_getCode','eth_getStorageAt','eth_getBalance','eth_getTransactionCount','eth_getProof','eth_getTransactionByHash','eth_getTransactionReceipt','net_version']);
const proxy=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  let parsed;try{parsed=JSON.parse(body);}catch{res.writeHead(400);res.end();return;}
  if((Array.isArray(parsed)?parsed:[parsed]).some(x=>!allowed.has(x.method))){res.writeHead(403);res.end();return;}
  queue=queue.then(async()=>{
    try {
      for(let retry=0;retry<6;retry++){
        const response=await fetch('https://api.roninchain.com/rpc',{method:'POST',headers:{'content-type':'application/json'},body,signal:AbortSignal.timeout(10000)});
        const text=await response.text();
        if(response.status===429 && retry<5){await sleep(2000);continue;}
        res.writeHead(response.status,{'content-type':'application/json'});res.end(text);break;
      }
    }catch{res.writeHead(502);res.end();}
    await sleep(500);
  });
});
await new Promise<void>((resolve,reject)=>{proxy.once('error',reject);proxy.listen(18548,'127.0.0.1',resolve);});
const proc=spawn(exe,['--host','127.0.0.1','--port','18547','--chain-id','31337','--accounts','0','--fork-url','http://127.0.0.1:18548','--fork-block-number',block.toString()],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let diagnostics='';proc.stderr.on('data',x=>{diagnostics=(diagnostics+x.toString()).slice(-4000);});
const report:any={kind:'local-fork-only',forkBlock:block.toString(),chainId:31337,sampleSourceTx:samples[2].hash,checkedAt:new Date().toISOString()};
try {
  let ready=false;
  for(let i=0;i<60;i++) {
    if(proc.exitCode!==null)throw Error('ANVIL_EXITED');
    try{ready=(await local.getChainId())===31337;}catch{}
    if(ready)break;await sleep(500);
  }
  requireThat(ready,'LOCAL_FORK_NOT_READY');
  const config=readConfig({EXPECTED_WALLET:wallet,MAX_TOTAL_GAS_RON:'1'});
  report.before=await preflight(local as unknown as Client,config);
  const stagingStarted=performance.now();
  const staged=await buildStaged(local as unknown as Client,config);
  report.stagingMs=Math.round(performance.now()-stagingStarted);
  await testClient.setNextBlockTimestamp({timestamp:expectedStage(2).start});
  await testClient.mine({blocks:1});
  const gateStarted=performance.now();
  requireThat(await openingGate([{id:'local',client:local as unknown as Client,latencyMs:0,block:0n,timestamp:0n}],config),'LOCAL_GATE_FAILED');
  assertStagedFresh(staged);
  const prepared=staged;
  report.openingGateMs=Math.round(performance.now()-gateStarted);
  report.prepared={...prepared,tx:{...prepared.tx,data:'[canonical calldata verified]'}};
  await testClient.impersonateAccount({address:wallet});
  requireThat(await local.getChainId()===31337,'REFUSE_NONLOCAL_CHAIN');
  const localSend=local.request as unknown as (request:{method:'eth_sendTransaction';params:unknown[]})=>Promise<Hex>;
  const hash=await localSend({method:'eth_sendTransaction',params:[{from:wallet,to:YAKKAMON.launchpad,data:mintData(wallet),value:'0x0',gas:`0x${prepared.tx.gas.toString(16)}`} ]});
  const receipt=await local.waitForTransactionReceipt({hash});
  const [minted,nftBalance]=await Promise.all([
    local.readContract({address:YAKKAMON.launchpad,abi:launchpadAbi,functionName:'getMintedQtyByUserAtStage',args:[YAKKAMON.nft,2,wallet]}),
    local.readContract({address:YAKKAMON.nft,abi:nftAbi,functionName:'balanceOf',args:[wallet]}),
  ]);
  requireThat(receipt.status==='success' && minted===1n,'LOCAL_MINT_FAILED');
  report.localReceipt={status:receipt.status,gasUsed:receipt.gasUsed,minted,nftBalance};
  try{await prepare(local as unknown as Client,config);throw Error('DUPLICATE_NOT_REJECTED');}catch(e){requireThat((e as Error).message==='WALLET_LIMIT_REACHED','DUPLICATE_CHECK_FAILED');report.duplicateRejected=true;}
  report.passed=true;
}catch(e){report.passed=false;report.error=(e as Error).message.slice(0,1200);report.diagnostics=diagnostics;process.exitCode=1;}
finally {
  proc.kill();
  proxy.closeAllConnections();proxy.close();
  await mkdir('research',{recursive:true});
  await writeFile('research/fork-validation.json',json(report));
}
console.log(json(report));
