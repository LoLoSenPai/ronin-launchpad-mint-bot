import { parseTransaction, recoverTransactionAddress, keccak256, type Hex } from 'viem';
import type { Config } from '../config.js';
import { healthCheck } from '../ronin.js';
import { expectedStage, sameAddress } from '../launchpad/yakkamon.js';
import { preflight, prepare } from './prepare.js';
import { quoteExtraFees } from './fees.js';
import { broadcastSameRaw } from './broadcast.js';
import { lockWallet, readAttempt, saveAttempt, statePath } from './state.js';
import { monitor } from './monitor.js';
import { validateTransaction, type MintTransaction } from '../security.js';
import { buildStaged, assertStagedFresh } from './staged.js';
import { openingGate } from './opening.js';
import { BotError, log, requireThat, sleep, errorCode } from '../util.js';

export async function run(config:Config,dryRun=false) {
  if(!dryRun)requireThat(config.enableMainnet,'MAINNET_DISABLED_SET_ENABLE_MAINNET_MINT');
  const health=await healthCheck(config.rpcUrls);
  log('rpc-health',{endpoints:health.health});
  requireThat(health.endpoints[0],'NO_HEALTHY_RPC');
  if(dryRun){
    log('dry-run',{report:await preflight(health.endpoints[0].client,config)});
    const started=performance.now();
    const staged=await Promise.any(health.endpoints.map(e=>buildStaged(e.client,config)));
    log('staging-rehearsal',{durationMs:Math.round(performance.now()-started),gas:staged.tx.gas,budget:staged.budget,nonce:staged.tx.nonce});
    return;
  }
  // No private key access before explicit local enablement and configured public identity/budget.
  requireThat(config.wallet && config.maxTotalGas,'EXECUTION_CONFIG_INCOMPLETE');
  const release=await lockWallet(config.wallet);
  let stopped=false;
  const stop=()=>{stopped=true;};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try {
    const file=statePath(config.wallet,config.stageIndex);
    const saved=await readAttempt(file);
    if(saved) {
      requireThat(sameAddress(saved.wallet,config.wallet) && saved.stageIndex===config.stageIndex,'SAVED_STATE_IDENTITY_MISMATCH');
      requireThat(keccak256(saved.raw)===saved.hash,'SAVED_STATE_HASH_MISMATCH');
      requireThat(saved.raw.startsWith('0x02'),'SAVED_STATE_TYPE_MISMATCH');
      requireThat(sameAddress(await recoverTransactionAddress({serializedTransaction:saved.raw as `0x02${string}`}),config.wallet),'SAVED_STATE_SIGNER_MISMATCH');
      const parsed=parseTransaction(saved.raw) as MintTransaction;
      requireThat(parsed.nonce===saved.nonce,'SAVED_STATE_NONCE_MISMATCH');
      const extra=await quoteExtraFees(health.endpoints[0].client,parsed,parsed.gas);
      validateTransaction(parsed,config,extra.extraFeeBudget);
      requireThat(saved.status!=='reverted','PREVIOUS_ATTEMPT_REVERTED_REVIEW_REQUIRED');
      // Even a previously confirmed state is rechecked against the canonical chain; never start a new attempt.
      log('resuming-existing-transaction',{hash:saved.hash,nonce:saved.nonce,status:saved.status});
      await monitor(saved,health.endpoints,file,()=>stopped);
      return;
    }
    const key=process.env.RONIN_PRIVATE_KEY?.trim();
    requireThat(key && /^(0x)?[0-9a-fA-F]{64}$/.test(key),'PRIVATE_KEY_REQUIRED_IN_LOCAL_ENV');
    const {privateKeyToAccount}=await import('viem/accounts');
    const account=privateKeyToAccount((key.startsWith('0x')?key:`0x${key}`) as Hex);
    requireThat(sameAddress(account.address,config.wallet),'PRIVATE_KEY_WALLET_MISMATCH');
    const stage=expectedStage(config.stageIndex);
    log('armed',{wallet:config.wallet,stage:stage.name,start:new Date(Number(stage.start)*1000).toISOString(),maxTotalGas:config.maxTotalGas});
    let endpoints=health.endpoints,lastPreflight=0,lastHealth=0,lastWaitLog=0;
    let staged:Awaited<ReturnType<typeof buildStaged>>|undefined,lastStaging=0;
    while(!stopped) {
      const until=Number(stage.start)*1000-Date.now();
      requireThat(Date.now()<Number(stage.end)*1000,'STAGE_ENDED');
      if(!endpoints.length || (Date.now()-lastHealth>30_000 && until>15_000)) {
        const next=await healthCheck(config.rpcUrls);
        endpoints=next.endpoints;lastHealth=Date.now();
        if(!endpoints[0]){log('waiting-for-rpc');await sleep(3000);continue;}
      }
      const endpoint=endpoints[0];requireThat(endpoint,'NO_HEALTHY_RPC');
      const interval=until>600_000?300_000:60_000;
      if(Date.now()-lastPreflight>interval && until>30_000) {
        try {log('preflight',{report:await preflight(endpoint.client,config)});lastPreflight=Date.now();}
        catch(e){if(e instanceof BotError)throw e;log('preflight-rpc-retry');await sleep(3000);continue;}
      }
      if(until<=30_000 && until>8000 && Date.now()-lastStaging>5000) {
        lastStaging=Date.now();
        const started=performance.now();
        let stagingTimer:ReturnType<typeof setTimeout>|undefined;
        try {
          staged=await Promise.race([
            Promise.any(endpoints.map(e=>buildStaged(e.client,config))),
            new Promise<never>((_,reject)=>{stagingTimer=setTimeout(()=>reject(new BotError('STAGING_DEADLINE')),Math.max(1,Number(stage.start)*1000-Date.now()-2000));}),
          ]);
          log('transaction-prepared',{durationMs:Math.round(performance.now()-started),gas:staged.tx.gas,budget:staged.budget,nonce:staged.tx.nonce});
        }catch {log('staging-unavailable-fallback-at-opening');}
        finally {if(stagingTimer)clearTimeout(stagingTimer);}
        continue;
      }
      if(until>2000) {
        if(Date.now()-lastWaitLog>60_000){log('waiting-for-stage',{seconds:Math.ceil(until/1000)});lastWaitLog=Date.now();}
        await sleep(Math.min(until-2000,until<=30_000?500:Math.max(500,Math.min(until-30_000,30_000))));continue;
      }
      // Local clock only wakes the process; contract simulation against pending state authorizes timing.
      try {
        const gateStarted=performance.now();
        const validEndpoint=await openingGate(endpoints,config);
        if(!validEndpoint){await sleep(250);continue;}
        const gateMs=Math.round(performance.now()-gateStarted);
        let prepared;
        try {requireThat(staged,'NO_STAGED_TRANSACTION');assertStagedFresh(staged);prepared=staged;}
        catch {log('staged-expired-full-prepare');prepared=await prepare(validEndpoint.client,config);}
        if(stopped)break;
        validateTransaction(prepared.tx,config,prepared.extraFeeBudget);
        const signingStarted=performance.now();
        const raw=await account.signTransaction(prepared.tx);
        const attempt={version:1 as const,wallet:config.wallet,stageIndex:config.stageIndex,nonce:prepared.tx.nonce,hash:keccak256(raw),raw,createdAt:new Date().toISOString(),status:'signed' as const};
        // Crash-safe checkpoint BEFORE the first submission.
        await saveAttempt(file,attempt);
        log('opening-timing',{gateMs,signAndPersistMs:Math.round(performance.now()-signingStarted),millisecondsAfterStart:Date.now()-Number(stage.start)*1000});
        const delivery=broadcastSameRaw(raw,endpoints.map(e=>({id:e.id,send:(serializedTransaction:Hex)=>e.client.sendRawTransaction({serializedTransaction})}))).then(result=>log('broadcast',result));
        await saveAttempt(file,{...attempt,status:'broadcast'});
        await Promise.all([delivery,monitor({...attempt,status:'broadcast'},endpoints,file,()=>stopped)]);
        return;
      }catch(e) {
        // Once persisted, every ambiguous exception must resume monitoring instead of signing another nonce.
        const pending=await readAttempt(file);
        if(pending)throw e;
        if(e instanceof BotError && e.code!=='SIMULATION_FAILED')throw e;
        log('opening-rpc-retry',{reason:errorCode(e)});
        endpoints.push(endpoints.shift()!);
        await sleep(500);
      }
    }
    throw new BotError('INTERRUPTED');
  }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);await release();}
}
