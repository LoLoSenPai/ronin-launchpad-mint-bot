import { BaseError, ContractFunctionRevertedError, decodeErrorResult, toHex, type Hex } from 'viem';
import type { Config } from '../config.js';
import { type Client, pendingNonce, rpcRead } from '../ronin.js';
import { readWalletStage, validateStage, verifyContracts } from '../launchpad/read.js';
import { YAKKAMON, mintData, sameAddress } from '../launchpad/yakkamon.js';
import { allowlistAbi, launchpadAbi, nftAbi } from '../launchpad/abi.js';
import { quoteFees, quoteExtraFees } from './fees.js';
import { validateTransaction, type MintTransaction } from '../security.js';
import { BotError, requireThat, ceilDiv } from '../util.js';

export function revertName(error:unknown):string|undefined {
  if (error instanceof BaseError) {
    const reverted=error.walk(e=>e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError;
    if (reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName) return reverted.data.errorName;
  }
  // eth_call uses raw RPC errors; inspect only the structured revert data, never stringify errors.
  let current:any=error;
  for(let i=0;i<8 && current;i++,current=current.cause) {
    const data=typeof current.data==='string'?current.data:current.data?.data;
    if (typeof data==='string' && /^0x[0-9a-fA-F]+$/.test(data)) {
      try{return decodeErrorResult({abi:[...allowlistAbi,...launchpadAbi,...nftAbi],data:data as Hex}).errorName;}catch{}
    }
  }
  return undefined;
}
export async function simulateNow(client:Client,config:Config) {
  requireThat(config.wallet,'EXPECTED_WALLET_REQUIRED');
  try {
    await client.call({account:config.wallet,to:YAKKAMON.launchpad,data:mintData(config.wallet,config.stageIndex),value:0n,blockTag:'pending'});
    return {status:'success' as const};
  } catch(e) {
    const name=revertName(e);
    if (name==='ErrStageNotStarted') return {status:'not-started' as const};
    throw new BotError(name ? `SIMULATION_${name}` : 'SIMULATION_FAILED');
  }
}
export async function simulateAtOpening(client:Client,config:Config,start:bigint) {
  requireThat(config.wallet,'EXPECTED_WALLET_REQUIRED');
  // READ ONLY: change the timestamp of a hypothetical block, never contract storage or eligibility.
  try {
    const result=await rpcRead<Array<{calls:Array<{status:Hex;gasUsed:Hex;returnData?:Hex;error?:unknown}>}>>(client,'eth_simulateV1',[
      {blockStateCalls:[{blockOverrides:{time:toHex(start)},calls:[{from:config.wallet,to:YAKKAMON.launchpad,data:mintData(config.wallet,config.stageIndex),value:'0x0',gas:'0x1e8480'}]}],validation:false,traceTransfers:false},'latest',
    ]);
    const call=result[0]?.calls[0];
    if (call?.status==='0x1') return {status:'hypothetical-success' as const,gasUsed:BigInt(call.gasUsed)};
    return {status:'hypothetical-failed' as const};
  } catch {return {status:'unsupported' as const};}
}
export async function preflight(client:Client,config:Config) {
  requireThat(config.wallet,'EXPECTED_WALLET_REQUIRED');
  requireThat(sameAddress(config.expectedLaunchpad,YAKKAMON.launchpad) && sameAddress(config.expectedNft,YAKKAMON.nft),'CONFIG_CONTRACT_MISMATCH');
  await verifyContracts(client);
  const [state,nonce,fees,block]=await Promise.all([
    readWalletStage(client,config.wallet,config.stageIndex),pendingNonce(client,config.wallet),quoteFees(client,config),client.getBlock({blockTag:'latest'}),
  ]);
  validateStage(state);
  requireThat(block.timestamp<state.expected.end,'STAGE_ENDED');
  const simulation=await simulateNow(client,config);
  const hypothetical=simulation.status==='not-started' ? await simulateAtOpening(client,config,state.expected.start) : undefined;
  let estimatedGas:bigint|undefined;
  if(simulation.status==='success') estimatedGas=await client.estimateGas({account:config.wallet,to:YAKKAMON.launchpad,data:mintData(config.wallet,config.stageIndex),value:0n,blockTag:'pending'});
  const gasForBudget=estimatedGas ?? (hypothetical?.status==='hypothetical-success'?hypothetical.gasUsed:undefined);
  let budget:bigint|undefined,extraFees:Awaited<ReturnType<typeof quoteExtraFees>>|undefined;
  if(gasForBudget) {
    const tx:MintTransaction={type:'eip1559',chainId:2020,to:YAKKAMON.launchpad,data:mintData(config.wallet,config.stageIndex),value:0n,nonce,gas:ceilDiv(gasForBudget*130n,100n),maxFeePerGas:fees.maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas};
    extraFees=await quoteExtraFees(client,tx,tx.gas);
    if(config.maxTotalGas) budget=validateTransaction(tx,config,extraFees.extraFeeBudget);
  }
  if(budget!==undefined) requireThat(state.balance>=budget,'INSUFFICIENT_RON');
  return {wallet:config.wallet,stage:state.expected,eligible:state.eligible,price:state.price,limit:state.limit,remaining:state.remaining,balance:state.balance,nonce,block:block.number,blockTime:block.timestamp,simulation,hypothetical,estimatedGas,fees,extraFees,budget,
    readyForExecution:!!config.maxTotalGas && simulation.status==='success',
    pendingChecks:[...(!config.maxTotalGas?['MAX_TOTAL_GAS_RON_REQUIRED']:[]),...(simulation.status!=='success'?['REAL_SIMULATION_AT_OPENING']:[])],
  };
}
export async function prepare(client:Client,config:Config):Promise<{tx:MintTransaction;extraFeeBudget:bigint;budget:bigint}> {
  requireThat(config.wallet && config.maxTotalGas,'EXECUTION_CONFIG_INCOMPLETE');
  const [,state,simulation,nonce,fees,estimatedGas]=await Promise.all([
    verifyContracts(client),readWalletStage(client,config.wallet,config.stageIndex),simulateNow(client,config).catch(error=>({error})),
    pendingNonce(client,config.wallet),quoteFees(client,config),
    client.estimateGas({account:config.wallet,to:YAKKAMON.launchpad,data:mintData(config.wallet,config.stageIndex),value:0n,blockTag:'pending'}).catch(error=>({error})),
  ]);
  validateStage(state);
  if('error' in simulation)throw simulation.error;
  requireThat(simulation.status==='success','STAGE_NOT_STARTED');
  if(typeof estimatedGas!=='bigint')throw estimatedGas.error;
  const tx:MintTransaction={type:'eip1559',chainId:2020,to:YAKKAMON.launchpad,data:mintData(config.wallet,config.stageIndex),value:0n,nonce,gas:ceilDiv(estimatedGas*130n,100n),maxFeePerGas:fees.maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas};
  const {extraFeeBudget}=await quoteExtraFees(client,tx,tx.gas);
  const budget=validateTransaction(tx,config,extraFeeBudget);
  requireThat(state.balance>=budget,'INSUFFICIENT_RON');
  return {tx,extraFeeBudget,budget};
}
