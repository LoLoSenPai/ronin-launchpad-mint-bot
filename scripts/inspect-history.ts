import { readFile,writeFile } from 'node:fs/promises';
import { decodeFunctionData,type Hex } from 'viem';
import { launchpadAbi } from '../src/launchpad/abi.js';
import { YAKKAMON,sameAddress,decodeMint } from '../src/launchpad/yakkamon.js';
import { json } from '../src/util.js';
let data=JSON.parse((await readFile('research/raw/launchpad-transactions.json','utf8')).replace(/^\uFEFF/,''));
const samples:Record<string,{wallet:string;hash:string;block:number}>={};
for(let page=0;page<4;page++) {
  for(const tx of data.items) {
    try {
      const call=decodeFunctionData({abi:launchpadAbi,data:tx.raw_input as Hex});
      if(call.functionName==='addAllowUsers' && sameAddress(call.args[0],YAKKAMON.nft)) {
        const [nft,index,users]=call.args;
        samples[index]??={wallet:users[0]!,hash:tx.hash,block:tx.block_number};
        console.log(json({method:call.functionName,nft,index,count:users.length,hash:tx.hash}));
      }
      if(call.functionName==='execute') {
        try{const mint=decodeMint(tx.raw_input);console.log(json({hash:tx.hash,status:tx.status,mint}));}catch{}
      }
    }catch{}
  }
  if(samples[2] && samples[1])break;
  if(!data.next_page_params)break;
  const params=new URLSearchParams({filter:'to',...data.next_page_params});
  const r=await fetch(`https://explorer.roninchain.com/api/v2/addresses/${YAKKAMON.launchpad}/transactions?${params}`);
  data=await r.json();
}
await writeFile('research/raw/whitelist-samples.json',json(samples));
console.log(json({sampleStages:Object.keys(samples)}));
