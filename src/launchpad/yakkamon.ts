import { decodeFunctionData, encodeFunctionData, getAddress, type Address, type Hex } from 'viem';
import { launchpadAbi, allowlistAbi } from './abi.js';
import { requireThat } from '../util.js';

export const YAKKAMON = {
  chainId:2020,
  nft:'0x6d1bc5247ca99D917d91EC52Dbbb5EF6c2435107' as Address,
  launchpad:'0xa8e9fdf57bbd991c3f494273198606632769db99' as Address,
  implementation:'0x36e83fa9741a794d888fEdceA4d5De522D003368' as Address,
  allowlistLogic:'0x4a9Db5f7aDE442B368bb6F4aBAbf1a2214B8BC59' as Address,
  currency:'0xe514d9DEB7966c8BE0ca922de8a064264eA6bcd4' as Address,
  stageType:2,
  stages:[
    {index:1,name:'Top Trainers',start:1789344000n,end:1789430400n,supply:1000},
    {index:2,name:'OG Trainers',start:1789430400n,end:1789516800n,supply:3000},
    {index:3,name:'Ronin Wave',start:1789545600n,end:1789632000n,supply:2000},
    {index:4,name:'Yakkamon Hunters',start:1789632000n,end:1789689600n,supply:5000},
    {index:5,name:'Public Trainers',start:1789689600n,end:1789776000n,supply:10000},
  ],
} as const;
export function expectedStage(index:number) {
  const stage = YAKKAMON.stages.find(s=>s.index===index);
  requireThat(stage, 'UNSUPPORTED_STAGE');
  return stage;
}
export function mintData(wallet: Address, stageIndex=2): Hex {
  expectedStage(stageIndex);
  const inner = encodeFunctionData({abi:allowlistAbi,functionName:'mintAllowList',args:[{
    nftContract:YAKKAMON.nft,recipient:wallet,mintQuantity:1n,isMintAllPossible:false,stageIndex,extraData:'0x',
  }]});
  return encodeFunctionData({abi:launchpadAbi,functionName:'execute',args:[2,inner]});
}
export function decodeMint(data:Hex) {
  const outer=decodeFunctionData({abi:launchpadAbi,data});
  requireThat(outer.functionName==='execute','DISALLOWED_OUTER_SELECTOR');
  const [stageType,innerData] = outer.args;
  const inner=decodeFunctionData({abi:allowlistAbi,data:innerData});
  requireThat(inner.functionName==='mintAllowList','DISALLOWED_INNER_SELECTOR');
  return {outerSelector:data.slice(0,10),innerSelector:innerData.slice(0,10),stageType,...inner.args[0]};
}
export const sameAddress = (a:string,b:string) => getAddress(a.toLowerCase()) === getAddress(b.toLowerCase());
