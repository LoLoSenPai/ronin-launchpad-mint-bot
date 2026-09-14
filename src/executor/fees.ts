import { parseAbi, parseGwei, serializeTransaction, size } from 'viem';
import type { Config, FeeMode } from '../config.js';
import type { Client } from '../ronin.js';
import { max, min, ceilDiv, requireThat } from '../util.js';

export interface FeeHistory { baseFeePerGas: readonly bigint[]; reward?: readonly (readonly bigint[])[]; }
export function calculateFees(history:FeeHistory,mode:FeeMode,caps:Pick<Config,'maxPriorityFee'|'maxFee'> & Partial<Pick<Config,'raceMinPriorityFee'>>) {
  requireThat(history.baseFeePerGas.length>=2 && history.baseFeePerGas.every(x=>x>=0n),'INVALID_FEE_HISTORY');
  requireThat(history.reward?.length && history.reward.every(row=>row.length>=2 && row.every(x=>x>=0n)),'MISSING_FEE_REWARDS');
  const column=mode==='race'?1:0;
  const tips=history.reward.map(row=>row[column]!);
  const mean=ceilDiv(tips.reduce((a,b)=>a+b,0n),BigInt(tips.length));
  const floor=max(parseGwei('20'),mean);
  const multiplier=mode==='normal'?100n:mode==='aggressive'?120n:200n;
  const raceFloor=mode==='race'?(caps.raceMinPriorityFee??parseGwei('20')):0n;
  requireThat(raceFloor>=0n && raceFloor<=caps.maxPriorityFee,'INVALID_RACE_PRIORITY_FLOOR');
  const desired=max(ceilDiv(floor*multiplier,100n),raceFloor);
  const base=max(parseGwei('1'),...history.baseFeePerGas);
  const priority=min(desired,caps.maxPriorityFee);
  const fee=min(base*2n+priority,caps.maxFee);
  requireThat(priority>=parseGwei('20') && fee>=base+priority,'FEE_CAP_TOO_LOW');
  return {maxFeePerGas:fee,maxPriorityFeePerGas:priority,baseFee:base,capped:priority<desired || fee<base*2n+priority};
}
export async function quoteFees(client:Client,config:Config) {
  const history=await client.getFeeHistory({blockCount:20,blockTag:'latest',rewardPercentiles:[60,90]});
  return calculateFees(history,config.feeMode,config);
}
const oracle='0x420000000000000000000000000000000000000F';
const oracleAbi=parseAbi([
  'function getL1FeeUpperBound(uint256 unsignedTxSize) view returns (uint256)',
  'function getOperatorFee(uint256 gasUsed) view returns (uint256)',
]);
export async function quoteExtraFees(client:Client,tx:Parameters<typeof serializeTransaction>[0],gas:bigint) {
  const unsigned=serializeTransaction(tx);
  const [l1,operator]=await Promise.all([
    client.readContract({address:oracle,abi:oracleAbi,functionName:'getL1FeeUpperBound',args:[BigInt(size(unsigned))],blockTag:'pending'}),
    client.readContract({address:oracle,abi:oracleAbi,functionName:'getOperatorFee',args:[gas],blockTag:'pending'}),
  ]);
  // OP Stack does not encode an absolute L1 fee cap in a type-2 transaction.
  // This is a conservative admission budget at the current oracle state, not a protocol guarantee.
  return {l1FeeUpperBound:l1,operatorFee:operator,extraFeeBudget:(l1+operator)*4n};
}
export function gasBudget(gas:bigint,fee:bigint,extras:bigint,cap:bigint) {
  requireThat(gas>0n && fee>0n && extras>=0n && cap>0n,'INVALID_GAS_BUDGET');
  const total=gas*fee+extras;
  requireThat(total<=cap,'TOTAL_GAS_CAP_EXCEEDED');
  return total;
}
