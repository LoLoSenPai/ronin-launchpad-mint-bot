import { readFile,writeFile } from 'node:fs/promises';
import { parse } from 'dotenv';
const example=await readFile('.env.example','utf8');
let current:string;
try{current=await readFile('.env','utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;current=example;}
const values=parse(current),defaults=parse(example);
// Preserve user values and never change or print the private key.
for(const key of ['EXPECTED_LAUNCHPAD','EXPECTED_NFT_CONTRACT','STAGE_INDEX']) {
  if(values[key]?.trim())continue;
  const line=`${key}=${defaults[key]}`;
  const pattern=new RegExp(`^${key}=.*$`,'m');
  current=pattern.test(current)?current.replace(pattern,line):`${current.trimEnd()}\n${line}\n`;
}
await writeFile('.env',current,{mode:0o600});
console.log('.env prepared; existing user values preserved.');
