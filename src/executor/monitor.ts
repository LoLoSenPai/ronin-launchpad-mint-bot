import { decodeEventLog, type Hex } from 'viem';
import type { Endpoint } from '../ronin.js';
import { YAKKAMON, sameAddress } from '../launchpad/yakkamon.js';
import { nftAbi } from '../launchpad/abi.js';
import { BotError, log, requireThat, sleep } from '../util.js';
import { broadcastSameRaw } from './broadcast.js';
import { saveAttempt, type Attempt } from './state.js';

const POLL_MS=250;
const REBROADCAST_MS=12_000;
const isZeroBlockHash=(hash:string)=>/^0x0+$/.test(hash);
type Receipt=Awaited<ReturnType<Endpoint['client']['getTransactionReceipt']>>;
type Outcome={kind:'confirmed'|'reverted';receipt:Receipt}|{kind:'error';error:BotError};
interface ProviderState {
  endpoint:Endpoint;
  inFlight?:Promise<void>;
  receipt:'none'|'preconfirmation'|'mined';
}

export async function monitor(attempt:Attempt,endpoints:Endpoint[],file:string,aborted:()=>boolean,timeoutMs=300_000) {
  const started=Date.now(),deadline=started+timeoutMs;
  let lastBroadcast=started,closed=false,outcomeSettled=false;
  let resolveOutcome!:(outcome:Outcome)=>void;
  const outcomePromise=new Promise<Outcome>(resolve=>{resolveOutcome=resolve;});
  const providers:ProviderState[]=endpoints.map(endpoint=>({endpoint,receipt:'none'}));

  const publish=(outcome:Outcome)=>{
    if(closed || outcomeSettled)return;
    outcomeSettled=true;
    resolveOutcome(outcome);
  };

  const poll=async(state:ProviderState)=>{
    const e=state.endpoint;
    try {
      const receipt=await e.client.getTransactionReceipt({hash:attempt.hash});
      if(closed)return;
      const blockHash=receipt.blockHash as Hex|null;
      // Some RPCs expose a receipt-shaped preconfirmation before assigning a canonical block.
      if(receipt.blockNumber===null || blockHash===null || isZeroBlockHash(blockHash)) {
        if(state.receipt!=='preconfirmation')log('receipt-preconfirmation',{hash:attempt.hash,status:receipt.status,block:receipt.blockNumber,blockHash,rpc:e.id});
        state.receipt='preconfirmation';
        return;
      }
      if(state.receipt!=='mined')log('receipt-seen',{hash:attempt.hash,status:receipt.status,block:receipt.blockNumber,rpc:e.id});
      state.receipt='mined';

      // Keep one request in flight per provider: canonical block and head reads are sequential.
      const head=await e.client.getBlock({blockTag:'latest'});
      if(closed)return;
      if(head.number===null || head.number<receipt.blockNumber+2n)return;
      const block=await e.client.getBlock({blockNumber:receipt.blockNumber});
      if(closed)return;
      if(block.hash!==blockHash) {
        state.receipt='none';
        log('receipt-reorganized',{hash:attempt.hash,block:receipt.blockNumber,rpc:e.id});
        return;
      }
      if(receipt.status==='reverted') {
        publish({kind:'reverted',receipt});
        return;
      }
      const minted=receipt.logs.some(l=>{
        if(!sameAddress(l.address,YAKKAMON.nft))return false;
        try {
          const decoded=decodeEventLog({abi:nftAbi,data:l.data,topics:l.topics,eventName:'Transfer'});
          return sameAddress(decoded.args.from,'0x0000000000000000000000000000000000000000') && sameAddress(decoded.args.to,attempt.wallet);
        }catch{return false;}
      });
      requireThat(minted,'SUCCESS_RECEIPT_WITHOUT_EXPECTED_NFT');
      publish({kind:'confirmed',receipt});
    }catch(error){
      if(error instanceof BotError)publish({kind:'error',error});
      else state.receipt='none';
    }
  };

  const launch=(state:ProviderState,work:()=>Promise<void>)=>{
    const task=work().catch(error=>{if(error instanceof BotError)publish({kind:'error',error});});
    let tracked:Promise<void>;
    tracked=task.finally(()=>{if(state.inFlight===tracked)state.inFlight=undefined;});
    state.inFlight=tracked;
  };

  try {
    while(!aborted() && Date.now()<deadline) {
      const now=Date.now();
      // A receipt is only "seen" while at least one provider still observes it. A missing or
      // non-canonical receipt restores identical-byte rebroadcasts after the normal interval.
      if(!providers.some(state=>state.receipt!=='none') && now-lastBroadcast>=REBROADCAST_MS) {
        let launched=false;
        for(const state of providers) {
          if(state.inFlight)continue;
          launched=true;
          launch(state,async()=>{
            const result=await broadcastSameRaw(attempt.raw,[{id:state.endpoint.id,send:(raw:Hex)=>state.endpoint.client.sendRawTransaction({serializedTransaction:raw})}]);
            if(!closed)log('rebroadcast-same-transaction',result);
          });
        }
        if(launched)lastBroadcast=now;
      }
      for(const state of providers)if(!state.inFlight)launch(state,()=>poll(state));

      const remaining=Math.max(0,Math.min(POLL_MS,deadline-Date.now()));
      const outcome=await Promise.race([outcomePromise,sleep(remaining).then(()=>undefined)]);
      if(!outcome)continue;
      closed=true;
      if(outcome.kind==='error')throw outcome.error;
      const receipt=outcome.receipt;
      attempt.status=outcome.kind==='reverted'?'reverted':'confirmed';
      attempt.receiptBlock=receipt.blockNumber.toString();
      await saveAttempt(file,attempt);
      if(outcome.kind==='reverted')throw new BotError('MINT_REVERTED_NO_AUTOMATIC_RETRY');
      log('mint-confirmed',{hash:attempt.hash,block:receipt.blockNumber,gasUsed:receipt.gasUsed,effectiveGasPrice:receipt.effectiveGasPrice,confirmations:3,l1Finality:'not-yet-checked'});
      return;
    }
  }finally{closed=true;}
  throw new BotError(aborted()?'INTERRUPTED_STATE_SAVED':'MONITOR_TIMEOUT_STATE_SAVED');
}
