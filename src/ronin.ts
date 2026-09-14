import { createPublicClient, http, type Address, type Hex } from 'viem';
import { ronin } from 'viem/chains';
import { BotError, requireThat } from './util.js';

export function makeClient(url:string) {
  // The official gateway rejects larger batches; three reads per HTTP request were verified live.
  return createPublicClient({chain:ronin,transport:http(url,{timeout:4000,retryCount:0,batch:{batchSize:3,wait:0}}),cacheTime:0});
}
export type Client = ReturnType<typeof makeClient>;
export interface Endpoint { id:string; client:Client; latencyMs:number; block:bigint; timestamp:bigint; }
export interface RpcHealth { id:string; ok:boolean; latencyMs:number; block?:bigint; timestamp?:bigint; reason?:string; }
export async function healthCheck(urls:string[]) {
  const endpoints:Endpoint[]=[];
  const health:RpcHealth[] = await Promise.all(urls.map(async (url,i) => {
    const client=makeClient(url),start=performance.now(),id=`rpc-${i+1}`;
    try {
      const [chain,block] = await Promise.all([client.getChainId(),client.getBlock({blockTag:'latest'})]);
      requireThat(chain===2020,'WRONG_CHAIN');
      const age=Date.now()/1000-Number(block.timestamp);
      requireThat(age>=-5 && age<=30,'STALE_RPC_OR_CLOCK');
      requireThat(block.number !== null,'MISSING_BLOCK');
      const latencyMs=Math.round(performance.now()-start);
      endpoints.push({id,client,latencyMs,block:block.number,timestamp:block.timestamp});
      return {id,ok:true,latencyMs,block:block.number,timestamp:block.timestamp};
    } catch(e) { return {id,ok:false,latencyMs:Math.round(performance.now()-start),reason:e instanceof BotError?e.code:'RPC_UNAVAILABLE'}; }
  }));
  const newest=endpoints.reduce((a,e)=>e.block>a?e.block:a,0n);
  const fresh=endpoints.filter(e=>newest-e.block<=3n).sort((a,b)=>a.latencyMs-b.latencyMs);
  for(const h of health) if (h.ok && h.block!==undefined && newest-h.block>3n) { h.ok=false; h.reason='RPC_BEHIND_PEERS'; }
  return {endpoints:fresh,health};
}
export async function pendingNonce(client:Client,wallet:Address) {
  const [latest,pending]=await Promise.all([
    client.getTransactionCount({address:wallet,blockTag:'latest'}),
    client.getTransactionCount({address:wallet,blockTag:'pending'}),
  ]);
  requireThat(latest===pending,'WALLET_HAS_PENDING_TRANSACTION');
  return pending;
}
// This raw entry point only exposes read methods. Signing/broadcast live in executor/.
export function rpcRead<T>(client:Client,method:string,params:unknown[]):Promise<T> {
  requireThat(['eth_simulateV1','eth_getTransactionReceipt'].includes(method),'READ_METHOD_NOT_ALLOWED');
  return client.request({method,params} as never) as Promise<T>;
}
export const IMPLEMENTATION_SLOT='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as Hex;
