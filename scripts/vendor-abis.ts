import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createPublicClient, http, keccak256, type Address } from 'viem';
import { ronin } from 'viem/chains';
const sources = {
  launchpadAbi: '0x36e83fa9741a794d888fEdceA4d5De522D003368',
  allowlistAbi: '0x4a9Db5f7aDE442B368bb6F4aBAbf1a2214B8BC59',
  nftAbi: '0x6d1bc5247ca99D917d91EC52Dbbb5EF6c2435107',
};
await mkdir('src/launchpad', {recursive:true});
let output = '// ABIs from verified Ronin Explorer sources. See research/DISCOVERY.md.\n';
for (const [name,address] of Object.entries(sources)) {
  const data = JSON.parse(await readFile(`research/raw/${address}.json`, 'utf8'));
  output += `\nexport const ${name} = ${JSON.stringify(data.abi, null, 2)} as const;\n`;
}
await writeFile('src/launchpad/abi.ts', output);
const client = createPublicClient({chain:ronin,transport:http('https://api.roninchain.com/rpc')});
const pinned:any = {};
for (const [name,address] of Object.entries({...sources,proxy:'0xa8e9fdf57bbd991c3f494273198606632769db99'})) {
  const code = await client.getCode({address:address as Address});
  if (!code) throw Error('Missing bytecode');
  pinned[name] = {address,codeHash:keccak256(code)};
}
await writeFile('src/launchpad/pins.json',JSON.stringify(pinned,null,2)+'\n');
console.log(JSON.stringify(pinned,null,2));
