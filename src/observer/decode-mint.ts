import { decodeEventLog, type Hex } from 'viem';
import type { Client } from '../ronin.js';
import { launchpadAbi } from '../launchpad/abi.js';
import { decodeMint, sameAddress, YAKKAMON } from '../launchpad/yakkamon.js';
export async function decodeObserved(client:Client,hash:Hex) {
  const [tx,receipt]=await Promise.all([client.getTransaction({hash}),client.getTransactionReceipt({hash})]);
  let calldata:ReturnType<typeof decodeMint>|undefined;
  try {calldata=decodeMint(tx.input);}catch{}
  const mints=receipt.logs.flatMap(l=>{
    if(!sameAddress(l.address,YAKKAMON.launchpad))return [];
    try {
      const decoded=decodeEventLog({abi:launchpadAbi,data:l.data,topics:l.topics,eventName:'MintSuccess'});
      if(!sameAddress(decoded.args.param.nftContract,YAKKAMON.nft))return [];
      return [decoded.args];
    }catch{return [];}
  });
  return {block:receipt.blockNumber,blockHash:receipt.blockHash,hash,sender:tx.from,target:tx.to,selector:tx.input.slice(0,10),calldata,
    mints,value:tx.value,gasUsed:receipt.gasUsed,maxFeePerGas:tx.maxFeePerGas,maxPriorityFeePerGas:tx.maxPriorityFeePerGas,effectiveGasPrice:receipt.effectiveGasPrice,status:receipt.status,
    l1Fee:(receipt as unknown as {l1Fee?:bigint}).l1Fee,
  };
}
