import { keccak256, type Hex } from 'viem';
import { requireThat } from '../util.js';
export interface Broadcaster {id:string;send:(raw:Hex)=>Promise<Hex>;}
export function classifyBroadcastError(error:unknown) {
  // Classify privately; never return the RPC's message, which may contain credentials/calldata.
  const message=error instanceof Error?error.message:'';
  if(/already known|known transaction/i.test(message)) return 'already-known' as const;
  if(/nonce too low/i.test(message)) return 'nonce-too-low' as const;
  if(/underpriced|fee too low/i.test(message)) return 'underpriced' as const;
  return 'unknown-delivery' as const;
}
export async function broadcastSameRaw(raw:Hex,endpoints:Broadcaster[]) {
  requireThat(endpoints.length>0,'NO_BROADCAST_ENDPOINTS');
  const hash=keccak256(raw);
  const results=await Promise.all(endpoints.map(async e=>{
    try {
      const returned=await e.send(raw);
      return {id:e.id,status:returned.toLowerCase()===hash.toLowerCase()?'accepted' as const:'hash-mismatch' as const};
    }catch(error){return {id:e.id,status:classifyBroadcastError(error)};}
  }));
  // Even all-timeout/all-nonce-too-low is ambiguous: keep monitoring this hash, never advance nonce.
  return {hash,results};
}
