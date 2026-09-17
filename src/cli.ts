import { formatEther, isHash, type Hex } from 'viem';
import { readConfig } from './config.js';
import { healthCheck } from './ronin.js';
import { readLaunch, readWalletStage, verifyContracts } from './launchpad/read.js';
import { YAKKAMON } from './launchpad/yakkamon.js';
import { preflight } from './executor/prepare.js';
import { observe } from './observer/observe-wave.js';
import { decodeObserved } from './observer/decode-mint.js';
import { inspectMetadata, SAMPLE_TOKEN_IDS } from './metadata/inspect.js';
import { watchReveal } from './metadata/watch.js';
import { fetchAllYakkamonListings, openSeaStatus, previewYakkamonFulfillment } from './opensea/listings.js';
import { BotError, json, requireThat } from './util.js';

async function openSeaCommand(config: ReturnType<typeof readConfig>, args: string[]) {
  const subcommand=args[1]||'status';
  requireThat(['status','listings','fulfillment'].includes(subcommand),'UNKNOWN_OPENSEA_COMMAND');
  if(subcommand==='status') {
    requireThat(args.length===2 || args.length===1,'UNKNOWN_OPENSEA_OPTION');
    console.log(json(await openSeaStatus()));
    return;
  }
  if(subcommand==='listings') {
    let top=20;
    for(let i=2;i<args.length;i++) {
      const arg=args[i]!;
      requireThat(arg==='--top','UNKNOWN_OPENSEA_OPTION');
      const value=args[++i];
      requireThat(value && /^\d+$/.test(value),'INVALID_OPENSEA_TOP');
      top=Number(value);
    }
    requireThat(Number.isInteger(top) && top>=1 && top<=100,'INVALID_OPENSEA_TOP');
    const cache=await fetchAllYakkamonListings();
    const currencies:Record<string,number>={};
    for(const listing of cache.listings) currencies[listing.price.currency]=(currencies[listing.price.currency]??0)+1;
    console.log(json({
      mode:'read-only',
      fetchedAt:cache.fetchedAt,
      collection:cache.collection,
      rawListings:cache.rawCount,
      activeUniqueTokens:cache.activeUniqueTokens,
      currencies,
      cacheFile:'runtime/opensea-listings.json',
      cheapest:cache.listings.slice(0,top),
    }));
    return;
  }
  requireThat(args.length===3,'INVALID_OPENSEA_FULFILLMENT_TARGET');
  const target=args[2]!;
  requireThat(target==='--cheapest' || (/^\d+$/.test(target) && BigInt(target)>0n),'INVALID_OPENSEA_FULFILLMENT_TARGET');
  requireThat(config.wallet,'EXPECTED_WALLET_REQUIRED');
  console.log(json(await previewYakkamonFulfillment(target==='--cheapest'?undefined:BigInt(target),config.wallet)));
}

async function main() {
  const args=process.argv.slice(2),command=args[0]||'help';
  if(command==='help') {
    console.log('pnpm bot status\npnpm bot metadata [TOKEN_ID ...]\npnpm bot metadata --sample\npnpm bot reveal-watch [TOKEN_ID ...] [--poll-ms N] [--once]\npnpm bot opensea status\npnpm bot opensea listings [--top N]\npnpm bot opensea fulfillment TOKEN_ID\npnpm bot opensea fulfillment --cheapest\npnpm bot observe [--once] [--from-block NUMBER]\npnpm bot decode 0xTRANSACTION_HASH\npnpm bot preflight\npnpm bot run --dry-run\npnpm bot run\n\nRead-only: status, metadata, reveal-watch, opensea *, observe, decode, preflight, run --dry-run.\nMainnet: run requires ENABLE_MAINNET_MINT=true and explicit budget in .env. OpenSea fulfillment is preview-only and never signs/broadcasts.');return;
  }
  requireThat(['status','metadata','reveal-watch','opensea','observe','decode','preflight','run'].includes(command),'UNKNOWN_COMMAND');
  const config=readConfig();
  if(command==='run') {const {run}=await import('./executor/run.js');await run(config,args.includes('--dry-run'));return;}
  if(command==='opensea') {await openSeaCommand(config,args);return;}
  const health=await healthCheck(config.rpcUrls);
  console.log(json({rpcHealth:health.health}));
  const endpoint=health.endpoints[0];requireThat(endpoint,'NO_HEALTHY_RPC_CHECK_CLOCK_AND_ENDPOINTS');
  const client=endpoint.client;
  if(command==='status') {
    await verifyContracts(client);
    const launch=await readLaunch(client);
    const walletStages=config.wallet?await Promise.all(YAKKAMON.stages.map(async s=>{
      const w=await readWalletStage(client,config.wallet!,s.index);
      return {stage:s.name,index:s.index,eligible:w.eligible,minted:w.mintedByWallet,price:w.price,limit:w.limit,balanceRON:formatEther(w.balance)};
    })):undefined;
    console.log(json({mode:'read-only',contractsVerified:true,nft:YAKKAMON.nft,launchpad:YAKKAMON.launchpad,implementation:YAKKAMON.implementation,
      launch,wallet:config.wallet??'EXPECTED_WALLET_NOT_SET',walletStages,executionEnabled:config.enableMainnet,budgetRON:config.maxTotalGas?formatEther(config.maxTotalGas):'NOT_SET'}));
  } else if(command==='metadata') {
    const metadataArgs=args.slice(1);
    const sample=metadataArgs.includes('--sample');
    const flags=metadataArgs.filter(arg=>arg.startsWith('--'));
    requireThat(flags.every(flag=>flag==='--sample'),'UNKNOWN_METADATA_OPTION');
    requireThat(flags.length<=1,'DUPLICATE_METADATA_OPTION');
    const rawIds=metadataArgs.filter(arg=>!arg.startsWith('--'));
    requireThat(!(sample && rawIds.length),'METADATA_SAMPLE_WITH_IDS');
    requireThat(rawIds.length<=50,'TOO_MANY_TOKEN_IDS');
    requireThat(rawIds.every(id=>/^\d+$/.test(id) && BigInt(id)>0n),'INVALID_TOKEN_ID');
    const tokenIds=sample?[...SAMPLE_TOKEN_IDS]:rawIds.length?rawIds.map(BigInt):undefined;
    console.log(json(await inspectMetadata(client,tokenIds,{compact:sample})));
  } else if(command==='reveal-watch') {
    let once=false,pollMs: number|undefined;
    const rawIds:string[]=[];
    for(let i=1;i<args.length;i++) {
      const arg=args[i]!;
      if(arg==='--once') { requireThat(!once,'DUPLICATE_REVEAL_OPTION'); once=true; continue; }
      if(arg==='--poll-ms') {
        requireThat(pollMs===undefined,'DUPLICATE_REVEAL_OPTION');
        const value=args[++i];
        requireThat(value && /^\d+$/.test(value),'INVALID_REVEAL_POLL_MS');
        pollMs=Number(value);
        continue;
      }
      requireThat(!arg.startsWith('--'),'UNKNOWN_REVEAL_OPTION');
      rawIds.push(arg);
    }
    requireThat(rawIds.length<=10,'INVALID_REVEAL_SENTINEL_COUNT');
    requireThat(rawIds.every(id=>/^\d+$/.test(id) && BigInt(id)>0n),'INVALID_TOKEN_ID');
    console.log(json(await watchReveal(client,{tokenIds:rawIds.length?rawIds.map(BigInt):undefined,pollMs,once})));
  } else if(command==='preflight') console.log(json(await preflight(client,config)));
  else if(command==='observe') {
    await verifyContracts(client);
    const position=args.indexOf('--from-block');
    requireThat(position===-1 || /^\d+$/.test(args[position+1]??''),'INVALID_FROM_BLOCK');
    await observe(client,{once:args.includes('--once'),fromBlock:position===-1?undefined:BigInt(args[position+1]!)});
  } else {
    requireThat(args[1] && isHash(args[1]),'INVALID_TRANSACTION_HASH');
    console.log(json(await decodeObserved(client,args[1] as Hex)));
  }
}
main().catch(e=>{
  // Never dump process.env, a private key, raw signed bytes, API keys, or RPC error messages.
  console.error(json({error:e instanceof BotError?e.code:'UNEXPECTED_ERROR',action:'Voir README.md. Aucun detail RPC/API sensible n’est affiche.'}));
  process.exitCode=1;
});
