import { writeFile, mkdir } from 'node:fs/promises';
await mkdir('research/raw', { recursive: true });
for (const address of process.argv.slice(2)) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address!)) throw Error('Invalid address');
  const r = await fetch(`https://explorer.roninchain.com/api/v2/smart-contracts/${address}`);
  if (!r.ok) throw Error(`HTTP ${r.status}`);
  const data = await r.json() as any;
  await writeFile(`research/raw/${address}.json`, JSON.stringify(data, null, 2));
  if (data.source_code) await writeFile(`research/raw/${address}.sol`, data.source_code);
  for (const [i,source] of (data.additional_sources ?? []).entries()) {
    await writeFile(`research/raw/${address}-${i}-${source.file_path.split('/').at(-1)}`, source.source_code);
  }
  console.log(JSON.stringify({ address, name: data.name, implementations:data.implementations, sources:(data.additional_sources ?? []).map((s:any)=>s.file_path), functions:data.abi?.filter((a:any)=>a.type==='function').map((a:any)=>({name:a.name,inputs:a.inputs,outputs:a.outputs})).filter((a:any)=>/mint|execute|stage/i.test(a.name)) }, null, 2));
}
