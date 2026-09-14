import { readFile,writeFile } from 'node:fs/promises';
import { readConfig } from '../src/config.js';
import { makeClient } from '../src/ronin.js';
import { preflight, simulateNow,simulateAtOpening } from '../src/executor/prepare.js';
import { expectedStage } from '../src/launchpad/yakkamon.js';
import { json,errorCode } from '../src/util.js';

// A public allowlisted sample from AllowUsersAdded. NOT the user's wallet, never used for signing.
const samples=JSON.parse(await readFile('research/raw/whitelist-samples.json','utf8'));
const config=readConfig({EXPECTED_WALLET:samples['2'].wallet,RONIN_RPC_URLS:'https://api.roninchain.com/rpc'});
const client=makeClient(config.rpcUrls[0]!);
const report:any={kind:'public-sample-read-only',sampleSourceTx:samples['2'].hash,wallet:config.wallet,checkedAt:new Date().toISOString()};
try{report.preflight=await preflight(client,config);}catch(e){report.error=errorCode(e);report.simulation=await simulateNow(client,config);report.hypothetical=await simulateAtOpening(client,config,expectedStage(2).start);}
await writeFile('research/raw/read-only-validation.json',json(report));
console.log(json(report));
