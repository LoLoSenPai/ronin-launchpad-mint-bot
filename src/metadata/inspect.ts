import { createHash } from 'node:crypto';
import { nftAbi } from '../launchpad/abi.js';
import { YAKKAMON } from '../launchpad/yakkamon.js';
import type { Client } from '../ronin.js';

const DEFAULT_TOKEN_IDS = [1n, 2n] as const;
export const SAMPLE_TOKEN_IDS = [
  1n, 2n, 10n, 50n, 100n, 250n, 500n, 750n, 1000n, 1500n,
  2000n, 2500n, 3000n, 4000n, 5000n, 6000n, 7000n, 8000n, 9000n, 9999n,
] as const;
const FETCH_TIMEOUT_MS = 5_000;
const FETCH_CONCURRENCY = 5;

interface ResponseHeaders {
  cacheControl: string | null;
  cdnCacheControl: string | null;
  etag: string | null;
  age: string | null;
  lastModified: string | null;
  date: string | null;
  cfCacheStatus: string | null;
  cfRay: string | null;
  server: string | null;
  vary: string | null;
  via: string | null;
  xCache: string | null;
  xVercelCache: string | null;
}

interface MetadataSummary {
  name?: unknown;
  description?: unknown;
  image?: unknown;
  animation_url?: unknown;
  external_url?: unknown;
  rarity?: unknown;
  status?: unknown;
  attributes?: unknown;
  keys: string[];
}

export interface FetchResult {
  status: 'ok' | 'http-error' | 'unsupported-uri' | 'fetch-failed';
  uri?: string;
  httpStatus?: number;
  contentType?: string | null;
  bytes?: number;
  sha256?: string;
  resolvedUrl?: string;
  latencyMs?: number;
  headers?: ResponseHeaders;
  metadata?: MetadataSummary;
  textPreview?: string;
}

interface TokenInspection {
  tokenId: bigint;
  tokenURI?: string;
  fetch?: FetchResult;
  error?: 'TOKEN_URI_READ_FAILED';
}

function resolveMetadataUrl(uri: string): string | undefined {
  if (/^https?:\/\//i.test(uri)) return uri;
  if (uri.startsWith('ipfs://')) {
    const path = uri.slice('ipfs://'.length).replace(/^ipfs\//, '');
    return `https://ipfs.io/ipfs/${path}`;
  }
  if (uri.startsWith('ar://')) return `https://arweave.net/${uri.slice('ar://'.length)}`;
  return undefined;
}

function responseHeaders(headers: Headers): ResponseHeaders {
  return {
    cacheControl: headers.get('cache-control'),
    cdnCacheControl: headers.get('cdn-cache-control'),
    etag: headers.get('etag'),
    age: headers.get('age'),
    lastModified: headers.get('last-modified'),
    date: headers.get('date'),
    cfCacheStatus: headers.get('cf-cache-status'),
    cfRay: headers.get('cf-ray'),
    server: headers.get('server'),
    vary: headers.get('vary'),
    via: headers.get('via'),
    xCache: headers.get('x-cache'),
    xVercelCache: headers.get('x-vercel-cache'),
  };
}

function traitValue(object: Record<string, unknown>, traitType: string): unknown {
  if (!Array.isArray(object.attributes)) return undefined;
  const trait = object.attributes.find(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return (value as Record<string, unknown>).trait_type === traitType;
  });
  if (!trait || typeof trait !== 'object' || Array.isArray(trait)) return undefined;
  return (trait as Record<string, unknown>).value;
}

function summarizeJson(value: unknown, compact: boolean): MetadataSummary | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const object = value as Record<string, unknown>;
  const status = traitValue(object, 'Status');
  const rarityTrait = traitValue(object, 'Rarity');
  const summary: MetadataSummary = { keys: Object.keys(object) };
  const preferred = compact
    ? ['name', 'image', 'rarity']
    : ['name', 'description', 'image', 'animation_url', 'external_url', 'rarity', 'attributes'];
  for (const key of preferred) if (key in object) summary[key as keyof MetadataSummary] = object[key] as never;
  if (status !== undefined) summary.status = status;
  if (summary.rarity === undefined && rarityTrait !== undefined) summary.rarity = rarityTrait;
  return summary;
}

export async function fetchMetadata(uri: string, compact = true): Promise<FetchResult> {
  const url = resolveMetadataUrl(uri);
  if (!url) return { status: 'unsupported-uri', uri };

  const start = performance.now();
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
      headers: {
        accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
      },
    });
    const raw = await response.text();
    const sha256 = createHash('sha256').update(raw).digest('hex');
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { parsed = undefined; }

    return {
      status: response.ok ? 'ok' : 'http-error',
      httpStatus: response.status,
      contentType: response.headers.get('content-type'),
      bytes: Buffer.byteLength(raw),
      sha256,
      resolvedUrl: url,
      latencyMs: Math.round(performance.now() - start),
      headers: responseHeaders(response.headers),
      metadata: parsed === undefined ? undefined : summarizeJson(parsed, compact),
      textPreview: parsed === undefined ? raw.slice(0, 500) : undefined,
    };
  } catch {
    return { status: 'fetch-failed', resolvedUrl: url, latencyMs: Math.round(performance.now() - start) };
  }
}

async function inspectToken(client: Client, tokenId: bigint, compact: boolean): Promise<TokenInspection> {
  try {
    const tokenURI = await client.readContract({
      address: YAKKAMON.nft,
      abi: nftAbi,
      functionName: 'tokenURI',
      args: [tokenId],
      blockTag: 'latest',
    });
    return { tokenId, tokenURI, fetch: await fetchMetadata(tokenURI, compact) };
  } catch {
    return { tokenId, error: 'TOKEN_URI_READ_FAILED' };
  }
}

async function inspectTokens(client: Client, tokenIds: bigint[], compact: boolean) {
  const result: TokenInspection[] = [];
  for (let offset = 0; offset < tokenIds.length; offset += FETCH_CONCURRENCY) {
    const batch = tokenIds.slice(offset, offset + FETCH_CONCURRENCY);
    result.push(...await Promise.all(batch.map(tokenId => inspectToken(client, tokenId, compact))));
  }
  return result;
}

function countBy(values: Array<string | undefined>) {
  const counts: Record<string, number> = {};
  for (const value of values) if (value) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function uniqueHeaderValues(tokens: TokenInspection[], key: keyof ResponseHeaders) {
  return [...new Set(tokens.map(token => token.fetch?.headers?.[key]).filter((value): value is string => value !== null && value !== undefined))];
}

function summarizeInspection(tokens: TokenInspection[]) {
  const successful = tokens.filter(token => token.fetch?.status === 'ok');
  const statuses = successful.map(token => typeof token.fetch?.metadata?.status === 'string' ? token.fetch.metadata.status : undefined);
  const rarities = successful.map(token => typeof token.fetch?.metadata?.rarity === 'string' ? token.fetch.metadata.rarity : undefined);
  const hidden = statuses.filter(status => status?.toLowerCase() === 'hidden').length;
  const badEgg = statuses.filter(status => status?.toLowerCase() === 'bad egg').length;

  return {
    requested: tokens.length,
    fetched200: successful.length,
    hidden,
    badEgg,
    otherOrUnclassified: successful.length - hidden - badEgg,
    failedOrNon200: tokens.length - successful.length,
    statusCounts: countBy(statuses),
    rarityCounts: countBy(rarities),
    cacheProfile: {
      cacheControl: uniqueHeaderValues(tokens, 'cacheControl'),
      cdnCacheControl: uniqueHeaderValues(tokens, 'cdnCacheControl'),
      etag: uniqueHeaderValues(tokens, 'etag'),
      age: uniqueHeaderValues(tokens, 'age'),
      lastModified: uniqueHeaderValues(tokens, 'lastModified'),
      cfCacheStatus: uniqueHeaderValues(tokens, 'cfCacheStatus'),
      server: uniqueHeaderValues(tokens, 'server'),
      vary: uniqueHeaderValues(tokens, 'vary'),
      via: uniqueHeaderValues(tokens, 'via'),
      xCache: uniqueHeaderValues(tokens, 'xCache'),
      xVercelCache: uniqueHeaderValues(tokens, 'xVercelCache'),
    },
  };
}

export async function inspectMetadata(
  client: Client,
  tokenIds: bigint[] = [...DEFAULT_TOKEN_IDS],
  options: { compact?: boolean } = {},
) {
  const compact = options.compact ?? false;
  const baseURI = await client.readContract({
    address: YAKKAMON.nft,
    abi: nftAbi,
    functionName: 'baseURI',
    blockTag: 'latest',
  });
  const tokens = await inspectTokens(client, tokenIds, compact);

  return {
    mode: 'read-only' as const,
    nft: YAKKAMON.nft,
    baseURI,
    baseURIFetch: baseURI ? await fetchMetadata(baseURI, true) : undefined,
    summary: summarizeInspection(tokens),
    tokens,
  };
}
