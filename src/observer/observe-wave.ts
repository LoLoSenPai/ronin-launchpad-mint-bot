import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { getAbiItem } from 'viem';
import type { Client } from '../ronin.js';
import { launchpadAbi } from '../launchpad/abi.js';
import { YAKKAMON, sameAddress } from '../launchpad/yakkamon.js';
import { decodeObserved } from './decode-mint.js';
import { json, log, sleep, requireThat } from '../util.js';

export async function observe(client:Client,options:{once?:boolean;fromBlock?:bigint}={}) {
  await mkdir('runtime',{recursive:true});
  let stopped=false;
  const stop=()=>{stopped=true;};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  const cursorFile='runtime/observer-cursor.json';
  let cursor:bigint|undefined=options.fromBlock;
  if(cursor===undefined) {
    try{cursor=BigInt(JSON.parse(await readFile(cursorFile,'utf8')).nextBlock);}catch{}
  }
  try {
    while(!stopped) {
      try {
        const head=await client.getBlockNumber({cacheTime:0});
        const safe=head-2n;
        let next:bigint=cursor ?? (safe>10n?safe-10n:0n);
        requireThat(next>=0n,'INVALID_FROM_BLOCK');
        let count=0;
        while(next<=safe && !stopped) {
          const end:bigint=next+199n<safe?next+199n:safe;
          const logs=await client.getLogs({address:YAKKAMON.launchpad,event:getAbiItem({abi:launchpadAbi,name:'MintSuccess'}),fromBlock:next,toBlock:end,strict:true});
          const hashes=new Set(logs.filter(l=>sameAddress(l.args.param.nftContract,YAKKAMON.nft)).map(l=>l.transactionHash));
          for(const hash of hashes) {
            if(!hash)continue;
            const decoded=await decodeObserved(client,hash);
            if(decoded.status==='success') {
              await appendFile('runtime/observed-mints.jsonl',JSON.stringify(decoded,(_,v)=>typeof v==='bigint'?v.toString():v)+'\n');
              log('mint-observed',decoded);count++;
            }
          }
          next=end+1n;cursor=next;
          // Re-read a short overlap on restart; duplicates are identified by tx hash in the report.
          await writeFile(cursorFile,json({nextBlock:(next>3n?next-3n:0n).toString(),updatedAt:new Date().toISOString()}));
        }
        if(options.once){log('observer-scan-complete',{throughBlock:safe,mints:count});return;}
      }catch(e){if(options.once)throw e;log('observer-rpc-retry');}
      await sleep(2000);
    }
  }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
