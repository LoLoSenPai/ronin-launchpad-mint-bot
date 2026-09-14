import { writeFile, mkdir } from 'node:fs/promises';
import { createPublicClient, http, type Abi, type Address, keccak256, toBytes } from 'viem';
import { ronin } from 'viem/chains';
import { launchpadAbi } from '../src/launchpad/abi.js';

const client = createPublicClient({ chain: ronin, transport: http('https://api.roninchain.com/rpc') });
const output = (x: unknown) => JSON.stringify(x, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
await mkdir('research/raw', { recursive: true });
const abi = launchpadAbi as Abi;
const launchpad: Address = '0xa8e9fdf57bbd991c3f494273198606632769db99';
const block = await client.getBlock();
console.log(output({ block: block.number, timestamp: block.timestamp, utc: new Date(Number(block.timestamp)*1000).toISOString() }));
for (const address of ['0x6d1bc5247ca99D917d91EC52Dbbb5EF6c2435107', '0x52800Ae331591f7F5Aa27410cAc7F4cD6441eC2e'] as Address[]) {
  const response = await fetch(`https://explorer.roninchain.com/api/v2/smart-contracts/${address}`);
  const data = await response.json() as any;
  await writeFile(`research/raw/${address}.json`, output(data));
  await writeFile(`research/raw/${address}.sol`, data.source_code);
  const results = await Promise.allSettled([
    client.readContract({ address: launchpad, abi, functionName: 'getLaunchpadData', args: [address] }),
    client.readContract({ address: launchpad, abi, functionName: 'getAllStages', args: [address] }),
    client.readContract({ address, abi: data.abi, functionName: 'hasRole', args: [keccak256(toBytes('MINT_ROLE')), launchpad] }),
  ]);
  const report = { address, launchpad, name: data.name, constructor: data.decoded_constructor_args, results: results.map(r => r.status === 'fulfilled' ? r.value : String(r.reason).slice(0,350)) };
  await writeFile(`research/raw/${address}-config.json`, output(report));
  console.log(output(report));
}
console.log(output({ logics: await client.readContract({ address: launchpad, abi, functionName:'getStageLogicsOf', args: [[0,1,2]] }) }));
