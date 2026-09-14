import { config as dotenv } from 'dotenv';
import { getAddress, isAddress, parseEther, parseGwei, type Address } from 'viem';
import { requireThat } from './util.js';
import { YAKKAMON } from './launchpad/yakkamon.js';

export type FeeMode = 'normal' | 'aggressive' | 'race';
export interface Config {
  wallet?: Address;
  rpcUrls: string[];
  expectedLaunchpad: Address;
  expectedNft: Address;
  feeMode: FeeMode;
  maxPriorityFee: bigint;
  maxFee: bigint;
  raceMinPriorityFee: bigint;
  maxTotalGas?: bigint;
  enableMainnet: boolean;
  stageIndex: number;
  pollMs: number;
}
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (env === process.env) dotenv({ quiet: true });
  const address = (name: string, fallback?: Address): Address | undefined => {
    const value = env[name]?.trim().replace(/^ronin:/i, '0x') || fallback;
    if (!value) return undefined;
    requireThat(isAddress(value, {strict:false}), `INVALID_${name}`);
    return getAddress(value.toLowerCase());
  };
  const decimal = (name:string, fallback?: string) => {
    const value = env[name]?.trim() || fallback;
    requireThat(value && /^\d+(\.\d{1,9})?$/.test(value), `INVALID_${name}`);
    return value;
  };
  const rpcUrls = [...new Set((env.RONIN_RPC_URLS || 'https://api.roninchain.com/rpc').split(',').map(s=>s.trim()).filter(Boolean))];
  requireThat(rpcUrls.length > 0 && rpcUrls.length <= 5, 'INVALID_RPC_COUNT');
  for (const url of rpcUrls) {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error('INVALID_RPC_URL'); }
    requireThat(parsed.protocol === 'https:', 'RPC_MUST_BE_HTTPS');
  }
  const feeMode = env.FEE_MODE || 'race';
  requireThat(['normal','aggressive','race'].includes(feeMode), 'INVALID_FEE_MODE');
  const stageIndex = Number(env.STAGE_INDEX || '2');
  requireThat(Number.isInteger(stageIndex) && stageIndex >= 1 && stageIndex <= 5, 'ONLY_VERIFIED_ALLOWLIST_STAGES_SUPPORTED');
  const maxPriorityFee = parseGwei(decimal('MAX_PRIORITY_FEE_GWEI','200'));
  const maxFee = parseGwei(decimal('MAX_FEE_GWEI','500'));
  requireThat(maxPriorityFee >= parseGwei('20') && maxFee >= maxPriorityFee, 'INVALID_FEE_CAPS');
  const raceMinPriorityFee=parseGwei(decimal('RACE_MIN_PRIORITY_FEE_GWEI','20'));
  requireThat(raceMinPriorityFee>=parseGwei('20') && raceMinPriorityFee<=maxPriorityFee,'INVALID_RACE_PRIORITY_FLOOR');
  const maxTotalGas = env.MAX_TOTAL_GAS_RON?.trim() ? parseEther(decimal('MAX_TOTAL_GAS_RON')) : undefined;
  requireThat(maxTotalGas === undefined || maxTotalGas > 0n, 'INVALID_TOTAL_GAS_CAP');
  return {
    wallet: address('EXPECTED_WALLET'), rpcUrls,
    expectedLaunchpad: address('EXPECTED_LAUNCHPAD',YAKKAMON.launchpad)!,
    expectedNft: address('EXPECTED_NFT_CONTRACT',YAKKAMON.nft)!,
    feeMode:feeMode as FeeMode,maxPriorityFee,maxFee,maxTotalGas,raceMinPriorityFee,
    enableMainnet:env.ENABLE_MAINNET_MINT === 'true',stageIndex,pollMs:500,
  };
}
