import { createHash } from 'node:crypto';
import { nftAbi } from '../launchpad/abi.js';
import { YAKKAMON } from '../launchpad/yakkamon.js';
import type { Client } from '../ronin.js';

const DEFAULT_TOKEN_IDS = [1n, 2n] as const;
const FETCH_TIMEOUT_MS = 5_000;

function resolveMetadataUrl(uri: string): string | undefined {
  if (/^https?:\/\//i.test(uri)) return uri;
  if (uri.startsWith('ipfs://')) {
    const path = uri.slice('ipfs://'.length).replace(/^ipfs\//, '');
    return `https://ipfs.io/ipfs/${path}`;
  }
  if (uri.startsWith('ar://')) return `https://arweave.net/${uri.slice('ar://'.length)}`;
  return undefined;
}

function summarizeJson(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const object = value as Record<string, unknown>;
  const preferred = ['name', 'description', 'image', 'animation_url', 'external_url', 'rarity', 'attributes'];
  const summary: Record<string, unknown> = {};
  for (const key of preferred) if (key in object) summary[key] = object[key];
  summary.keys = Object.keys(object);
  return summary;
}

async function fetchMetadata(uri: string) {
  const url = resolveMetadataUrl(uri);
  if (!url) return { status: 'unsupported-uri' as const, uri };

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'application/json,text/plain;q=0.9,*/*;q=0.8' },
    });
    const raw = await response.text();
    const sha256 = createHash('sha256').update(raw).digest('hex');
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { parsed = undefined; }

    return {
      status: response.ok ? 'ok' as const : 'http-error' as const,
      httpStatus: response.status,
      contentType: response.headers.get('content-type'),
      bytes: Buffer.byteLength(raw),
      sha256,
      resolvedUrl: url,
      metadata: parsed === undefined ? undefined : summarizeJson(parsed),
      textPreview: parsed === undefined ? raw.slice(0, 500) : undefined,
    };
  } catch {
    return { status: 'fetch-failed' as const, resolvedUrl: url };
  }
}

export async function inspectMetadata(client: Client, tokenIds: bigint[] = [...DEFAULT_TOKEN_IDS]) {
  const baseURI = await client.readContract({
    address: YAKKAMON.nft,
    abi: nftAbi,
    functionName: 'baseURI',
    blockTag: 'latest',
  });

  const tokens = await Promise.all(tokenIds.map(async tokenId => {
    try {
      const tokenURI = await client.readContract({
        address: YAKKAMON.nft,
        abi: nftAbi,
        functionName: 'tokenURI',
        args: [tokenId],
        blockTag: 'latest',
      });
      return { tokenId, tokenURI, fetch: await fetchMetadata(tokenURI) };
    } catch {
      return { tokenId, error: 'TOKEN_URI_READ_FAILED' as const };
    }
  }));

  return {
    mode: 'read-only' as const,
    nft: YAKKAMON.nft,
    baseURI,
    baseURIFetch: baseURI ? await fetchMetadata(baseURI) : undefined,
    tokens,
  };
}
