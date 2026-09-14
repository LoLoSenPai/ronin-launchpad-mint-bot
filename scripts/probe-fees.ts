import { createPublicClient,http,parseAbi } from 'viem';
import { ronin } from 'viem/chains';
const client=createPublicClient({chain:ronin,transport:http('https://api.roninchain.com/rpc')});
const address='0x420000000000000000000000000000000000000F';
const abi=parseAbi(['function getL1FeeUpperBound(uint256) view returns(uint256)','function getOperatorFee(uint256) view returns(uint256)','function isFjord() view returns(bool)','function isIsthmus() view returns(bool)','function isJovian() view returns(bool)','function operatorFeeScalar() view returns(uint32)','function operatorFeeConstant() view returns(uint64)']);
for (const functionName of ['getL1FeeUpperBound','getOperatorFee','isFjord','isIsthmus','isJovian','operatorFeeScalar','operatorFeeConstant'] as const) {
  try {console.log(functionName,String(await client.readContract({address,abi,functionName,args: functionName==='getL1FeeUpperBound'?[600n]:functionName==='getOperatorFee'?[500000n]:undefined} as any)));} catch {console.log(functionName,'UNSUPPORTED');}
}
