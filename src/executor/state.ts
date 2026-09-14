import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { BotError, json, requireThat } from '../util.js';
import type { Hex } from 'viem';
export interface Attempt {
  version:1; wallet:string; stageIndex:number; nonce:number; hash:Hex; raw:Hex;
  createdAt:string; status:'signed'|'broadcast'|'confirmed'|'reverted';
  receiptBlock?:string;
}
export const statePath=(wallet:string,stageIndex:number)=>path.resolve('runtime',`${wallet.toLowerCase()}-stage-${stageIndex}.json`);
export async function readAttempt(file:string):Promise<Attempt|undefined> {
  try {const a=JSON.parse(await readFile(file,'utf8')) as Attempt; requireThat(a.version===1,'INVALID_SAVED_STATE'); return a;}
  catch(e) {if((e as NodeJS.ErrnoException).code==='ENOENT') return undefined; throw e;}
}
export async function saveAttempt(file:string,attempt:Attempt) {
  await mkdir(path.dirname(file),{recursive:true});
  const temp=`${file}.${process.pid}.tmp`;
  const handle=await open(temp,'w',0o600);
  try{await handle.writeFile(json(attempt));await handle.sync();}finally{await handle.close();}
  await rename(temp,file);
}
export async function lockWallet(wallet:string) {
  await mkdir('runtime',{recursive:true});
  const file=path.resolve('runtime',`${wallet.toLowerCase()}.lock`);
  // Atomic exclusive creation; no automatic deletion of stale locks (avoids concurrent-process races).
  let handle;
  try {handle=await open(file,'wx',0o600);} catch {throw new BotError('WALLET_LOCKED_CHECK_RUNTIME_LOCK');}
  await handle.writeFile(json({pid:process.pid,createdAt:new Date().toISOString()}));
  await handle.close();
  return async()=>{await unlink(file);};
}
