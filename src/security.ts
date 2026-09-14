import { parseGwei, type Address, type Hex } from 'viem';
import type { Config } from './config.js';
import { YAKKAMON, mintData, decodeMint, sameAddress } from './launchpad/yakkamon.js';
import { gasBudget } from './executor/fees.js';
import { requireThat } from './util.js';
export interface MintTransaction {
  type:'eip1559'; chainId:number; to:Address; data:Hex; value:bigint; nonce:number;
  gas:bigint; maxFeePerGas:bigint; maxPriorityFeePerGas:bigint;
}
export function validateTransaction(tx:MintTransaction,config:Config,extraFeeBudget:bigint) {
  requireThat(config.wallet,'EXPECTED_WALLET_REQUIRED');
  requireThat(config.maxTotalGas,'MAX_TOTAL_GAS_RON_REQUIRED');
  requireThat(tx.type==='eip1559' && tx.chainId===2020,'WRONG_CHAIN_OR_TYPE');
  requireThat(sameAddress(tx.to,YAKKAMON.launchpad) && sameAddress(tx.to,config.expectedLaunchpad),'UNEXPECTED_TARGET');
  requireThat(sameAddress(config.expectedNft,YAKKAMON.nft),'UNEXPECTED_NFT');
  const decoded=decodeMint(tx.data);
  requireThat(decoded.stageType===2 && decoded.stageIndex===config.stageIndex,'UNEXPECTED_STAGE');
  requireThat(sameAddress(decoded.nftContract,config.expectedNft),'UNEXPECTED_NFT');
  requireThat(sameAddress(decoded.recipient,config.wallet),'UNEXPECTED_RECIPIENT');
  requireThat(decoded.mintQuantity===1n && !decoded.isMintAllPossible && decoded.extraData==='0x','UNEXPECTED_MINT_ARGUMENTS');
  // Canonical byte equality rejects trailing data, alternate ABI offsets, extra calls and nested selectors.
  requireThat(tx.data.toLowerCase()===mintData(config.wallet,config.stageIndex).toLowerCase(),'NON_CANONICAL_CALLDATA');
  requireThat(tx.value===0n,'UNEXPECTED_VALUE');
  requireThat(Number.isSafeInteger(tx.nonce) && tx.nonce>=0,'INVALID_NONCE');
  requireThat(tx.gas>0n && tx.gas<=2_000_000n,'INVALID_GAS_LIMIT');
  requireThat(tx.maxPriorityFeePerGas>=parseGwei('20') && tx.maxPriorityFeePerGas<=config.maxPriorityFee,'PRIORITY_FEE_OUT_OF_BOUNDS');
  requireThat(tx.maxFeePerGas>=tx.maxPriorityFeePerGas && tx.maxFeePerGas<=config.maxFee,'FEE_OUT_OF_BOUNDS');
  return gasBudget(tx.gas,tx.maxFeePerGas,extraFeeBudget,config.maxTotalGas);
}
