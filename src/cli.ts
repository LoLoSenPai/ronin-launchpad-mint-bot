import { formatEther, isHash, type Hex } from 'viem';
import { readConfig } from './config.js';
import { healthCheck } from './ronin.js';
import { readLaunch, readWalletStage, verifyContracts } from './launchpad/read.js';
import { YAKKAMON } from './launchpad/yakkamon.js';
import { preflight } from './executor/prepare.js';
import { observe } from './observer/observe-wave.js';
import { decodeObserved } from './observer/decode-mint.js';
import { inspectMetadata } from './metadata/inspect.js';
import { BotError, json, requireThat } from './util.js';

async function main() {
  const args=process.argv.slice(2),command=args[0]||'help';
  if(command==='help') {
    console.log('pnpm bot status\npnpm bot metadata [TOKEN_ID ...]\npnpm bot observe [--once] [--from-block NUMBER]\npnpm bot decode 0xTRANSACTION_HASH\npnpm bot preflight\npnpm bot run --dry-run\npnpm bot run\n\nRead-only: status, metadata, observe, decode, preflight, run --dry-run.\nMainnet: run requires ENABLE_MAINNET_MINT=true and explicit budget in .env.');return;
  }
  requireThat(['status','metadata','observe','decode','preflight','run'].includes(command),'UNKNOWN_COMMAND');
  const config=readConfig();
  if(command==='run') {const {run}=await import('./executor/run.js');await run(config,args.includes('--dry-run'));return;}
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
    const rawIds=args.slice(1);
    requireThat(rawIds.length<=50,'TOO_MANY_TOKEN_IDS');
    requireThat(rawIds.every(id=>/^\d+$/.test(id) && BigInt(id)>0n),'INVALID_TOKEN_ID');
    const tokenIds=rawIds.length?rawIds.map(BigInt):undefined;
    console.log(json(await inspectMetadata(client,tokenIds)));
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
  // Never dump process.env, a private key, raw signed bytes, or viem/RPC error messages.
  console.error(json({error:e instanceof BotError?e.code:'UNEXPECTED_ERROR',action:'Voir README.md. Aucun detail RPC sensible n’est affiche.'}));
  process.exitCode=1;
});
