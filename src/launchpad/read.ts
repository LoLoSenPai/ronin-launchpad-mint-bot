import { keccak256, toBytes, type Address } from 'viem';
import pins from './pins.json' with {type:'json'};
import { launchpadAbi, nftAbi } from './abi.js';
import { YAKKAMON, expectedStage, sameAddress } from './yakkamon.js';
import { IMPLEMENTATION_SLOT, type Client } from '../ronin.js';
import { requireThat, min } from '../util.js';

export async function verifyContracts(client:Client) {
  const [slot,logics,...codes]=await Promise.all([
    client.getStorageAt({address:YAKKAMON.launchpad,slot:IMPLEMENTATION_SLOT,blockTag:'pending'}),
    client.readContract({address:YAKKAMON.launchpad,abi:launchpadAbi,functionName:'getStageLogicsOf',args:[[2]],blockTag:'pending'}),
    ...Object.values(pins).map(p=>client.getCode({address:p.address as Address,blockTag:'pending'})),
  ]);
  requireThat(slot && sameAddress(`0x${slot.slice(-40)}`,YAKKAMON.implementation),'LAUNCHPAD_IMPLEMENTATION_CHANGED');
  requireThat(logics[0] && sameAddress(logics[0],YAKKAMON.allowlistLogic),'STAGE_LOGIC_CHANGED');
  Object.values(pins).forEach((p,i)=>requireThat(codes[i] && keccak256(codes[i]!)===p.codeHash,'CONTRACT_CODE_CHANGED'));
  const mintRole=await client.readContract({address:YAKKAMON.nft,abi:nftAbi,functionName:'hasRole',args:[keccak256(toBytes('MINT_ROLE')),YAKKAMON.launchpad],blockTag:'pending'});
  requireThat(mintRole,'LAUNCHPAD_MINT_ROLE_MISSING');
}

export async function readLaunch(client:Client) {
  const call={address:YAKKAMON.launchpad,abi:launchpadAbi,blockTag:'pending' as const};
  const [stages,data,totalMinted,paused,nftPaused]=await Promise.all([
    client.readContract({...call,functionName:'getAllStages',args:[YAKKAMON.nft]}),
    client.readContract({...call,functionName:'getLaunchpadData',args:[YAKKAMON.nft]}),
    client.readContract({...call,functionName:'getTotalMintedOfNFTContract',args:[YAKKAMON.nft]}),
    client.readContract({...call,functionName:'pausedOf',args:[YAKKAMON.nft]}),
    client.readContract({address:YAKKAMON.nft,abi:nftAbi,functionName:'paused',blockTag:'pending'}),
  ]);
  const allStages=stages[2].map((s,i)=>({index:Number(stages[0][1][i]),type:2,...s}));
  allStages.push({index:255,type:1,...stages[1]});
  return {stages:allStages,creator:data[0],standard:data[1],launchSupply:data[2],allowCumulativeLimit:data[3],totalMinted,paused,nftPaused};
}

export async function readWalletStage(client:Client,wallet:Address,index:number) {
  const expected=expectedStage(index);
  const call={address:YAKKAMON.launchpad,abi:launchpadAbi,blockTag:'pending' as const};
  const [launch,eligible,tier,mintedByWallet,mintedInStage,balance,code]=await Promise.all([
    readLaunch(client),
    client.readContract({...call,functionName:'checkIsEligible',args:[YAKKAMON.nft,index,wallet]}),
    client.readContract({...call,functionName:'getTierOfUser',args:[YAKKAMON.nft,index,wallet]}),
    client.readContract({...call,functionName:'getMintedQtyByUserAtStage',args:[YAKKAMON.nft,index,wallet]}),
    client.readContract({...call,functionName:'getMintedQtyAtStage',args:[YAKKAMON.nft,index]}),
    client.getBalance({address:wallet,blockTag:'pending'}),
    client.getCode({address:wallet,blockTag:'pending'}),
  ]);
  const stage=launch.stages.find(s=>s.index===index);
  requireThat(stage && stage.type===2,'STAGE_NOT_FOUND');
  const price=tier[0]?tier[1].price:stage.paymentInfo.price;
  const limit=tier[0]?tier[1].limit:stage.config.maxMintablePerWallet;
  const remaining=min(BigInt(stage.config.maxSupply)-mintedInStage,launch.launchSupply-launch.totalMinted);
  return {launch,stage,expected,eligible,price,limit,mintedByWallet,mintedInStage,remaining,balance,hasCode:!!code && code!=='0x'};
}
export function validateStage(state:Awaited<ReturnType<typeof readWalletStage>>) {
  const {launch,stage,expected}=state;
  requireThat(!launch.paused && !launch.nftPaused,'MINT_PAUSED');
  requireThat(!state.hasCode,'SMART_WALLET_NOT_SUPPORTED');
  requireThat(launch.standard===2 && launch.launchSupply===10000n && !launch.allowCumulativeLimit,'LAUNCH_CONFIGURATION_CHANGED');
  requireThat(stage.config.startTime===expected.start && stage.config.endTime===expected.end,'STAGE_TIMING_CHANGED');
  requireThat(stage.config.maxSupply===expected.supply && stage.config.maxMintablePerWallet===1,'STAGE_LIMIT_CHANGED');
  requireThat(sameAddress(stage.paymentInfo.currency,YAKKAMON.currency),'PAYMENT_CURRENCY_CHANGED');
  requireThat(stage.paymentInfo.price===0n && state.price===0n,'MINT_IS_NOT_FREE');
  requireThat(state.eligible,'WALLET_NOT_ELIGIBLE');
  requireThat(state.limit>=1 && state.mintedByWallet===0n,'WALLET_LIMIT_REACHED');
  requireThat(state.remaining>0n,'SOLD_OUT');
}
