import { mkdir, writeFile } from 'node:fs/promises';
import { formatUnits, isAddress, type Address } from 'viem';
import { YAKKAMON } from '../launchpad/yakkamon.js';
import { BotError, requireThat, sleep } from '../util.js';
import { openSeaKeyInfo, openSeaRequest } from './api.js';

const RUNTIME_DIR = 'runtime';
const LISTINGS_CACHE = `${RUNTIME_DIR}/opensea-listings.json`;
const OPENSEA_CHAIN = 'ronin';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const PAGE_LIMIT = 200;
const MAX_PAGES = 30;

interface WirePrice {
  current?: {
    currency?: unknown;
    decimals?: unknown;
    value?: unknown;
  };
}

interface WireOfferItem {
  itemType?: unknown;
  token?: unknown;
  identifierOrCriteria?: unknown;
}

interface WireListing {
  order_hash?: unknown;
  chain?: unknown;
  type?: unknown;
  price?: WirePrice;
  protocol_data?: {
    parameters?: {
      offerer?: unknown;
      offer?: WireOfferItem[];
      startTime?: unknown;
      endTime?: unknown;
    };
    signature?: unknown;
  };
  protocol_address?: unknown;
  remaining_quantity?: unknown;
  status?: unknown;
}

interface ListingsResponse {
  listings?: WireListing[];
  next?: unknown;
}

interface ContractResponse {
  collection?: unknown;
  name?: unknown;
}

interface NftCollectionResponse {
  slug?: unknown;
  name?: unknown;
  collection?: unknown;
}

export interface NormalizedOpenSeaListing {
  tokenId: string;
  contract: Address;
  orderHash: string;
  protocolAddress: Address;
  chain: string;
  seller?: Address;
  price: {
    raw: string;
    decimals: number;
    currency: string;
    display: string;
  };
  status?: string;
  type?: string;
  startTime?: string;
  endTime?: string;
  remainingQuantity?: string;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'bigint' ? String(value) : undefined;
}

function addressValue(value: unknown): Address | undefined {
  const text = stringValue(value);
  return text && isAddress(text, { strict: false }) ? text as Address : undefined;
}

function normalizeListing(raw: WireListing): NormalizedOpenSeaListing | undefined {
  const orderHash = stringValue(raw.order_hash);
  const protocolAddress = addressValue(raw.protocol_address);
  const chain = stringValue(raw.chain);
  const item = raw.protocol_data?.parameters?.offer?.[0];
  const contract = addressValue(item?.token);
  const tokenId = stringValue(item?.identifierOrCriteria);
  const priceRaw = stringValue(raw.price?.current?.value);
  const decimalsRaw = raw.price?.current?.decimals;
  const decimals = typeof decimalsRaw === 'number' ? decimalsRaw : Number(stringValue(decimalsRaw));
  const currency = stringValue(raw.price?.current?.currency);

  if (!orderHash || !protocolAddress || !chain || !contract || !tokenId || !priceRaw || !/^\d+$/.test(priceRaw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36 || !currency) return undefined;
  if (chain.toLowerCase() !== OPENSEA_CHAIN) return undefined;
  if (contract.toLowerCase() !== YAKKAMON.nft.toLowerCase()) return undefined;

  const seller = addressValue(raw.protocol_data?.parameters?.offerer);
  const status = stringValue(raw.status);
  const remainingQuantity = stringValue(raw.remaining_quantity);
  if (status && status.toUpperCase() !== 'ACTIVE') return undefined;
  if (remainingQuantity !== undefined && BigInt(remainingQuantity) <= 0n) return undefined;

  return {
    tokenId,
    contract,
    orderHash,
    protocolAddress,
    chain,
    seller,
    price: {
      raw: priceRaw,
      decimals,
      currency,
      display: formatUnits(BigInt(priceRaw), decimals),
    },
    status,
    type: stringValue(raw.type),
    startTime: stringValue(raw.protocol_data?.parameters?.startTime),
    endTime: stringValue(raw.protocol_data?.parameters?.endTime),
    remainingQuantity,
  };
}

function collectionSlugFromNftResponse(response: NftCollectionResponse): string | undefined {
  const direct = stringValue(response.slug);
  if (direct) return direct;
  const collection = response.collection;
  const asString = stringValue(collection);
  if (asString) return asString;
  if (collection && typeof collection === 'object' && !Array.isArray(collection)) {
    return stringValue((collection as Record<string, unknown>).slug);
  }
  return undefined;
}

export async function discoverYakkamonOpenSeaCollection() {
  const contract = await openSeaRequest<ContractResponse>(
    `/chain/${OPENSEA_CHAIN}/contract/${YAKKAMON.nft}`,
  );
  const contractSlug = stringValue(contract.collection);
  if (contractSlug) return { slug: contractSlug, name: stringValue(contract.name) };

  const response = await openSeaRequest<NftCollectionResponse>(
    `/chain/${OPENSEA_CHAIN}/contract/${YAKKAMON.nft}/nfts/1/collection`,
  );
  const slug = collectionSlugFromNftResponse(response);
  requireThat(slug, 'OPENSEA_COLLECTION_SLUG_MISSING');
  const nestedName = response.collection && typeof response.collection === 'object' && !Array.isArray(response.collection)
    ? stringValue((response.collection as Record<string, unknown>).name)
    : undefined;
  return { slug, name: stringValue(response.name) ?? nestedName };
}

export async function fetchAllYakkamonListings() {
  const collection = await discoverYakkamonOpenSeaCollection();
  const listings: NormalizedOpenSeaListing[] = [];
  let next: string | undefined;
  let rawCount = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (next) params.set('next', next);
    const response = await openSeaRequest<ListingsResponse>(
      `/listings/collection/${encodeURIComponent(collection.slug)}/all?${params.toString()}`,
    );
    const rawListings = Array.isArray(response.listings) ? response.listings : [];
    rawCount += rawListings.length;
    for (const raw of rawListings) {
      const parsed = normalizeListing(raw);
      if (parsed) listings.push(parsed);
    }
    next = stringValue(response.next);
    if (!next) break;
    if (page === MAX_PAGES - 1) throw new BotError('OPENSEA_LISTINGS_PAGINATION_LIMIT');
    await sleep(80);
  }

  const bestByToken = new Map<string, NormalizedOpenSeaListing>();
  for (const listing of listings) {
    const current = bestByToken.get(listing.tokenId);
    if (!current) { bestByToken.set(listing.tokenId, listing); continue; }
    if (listing.price.currency === current.price.currency && listing.price.decimals === current.price.decimals && BigInt(listing.price.raw) < BigInt(current.price.raw)) {
      bestByToken.set(listing.tokenId, listing);
    }
  }
  const deduped = [...bestByToken.values()].sort((a, b) => {
    if (a.price.currency !== b.price.currency || a.price.decimals !== b.price.decimals) return a.price.currency.localeCompare(b.price.currency);
    const av = BigInt(a.price.raw), bv = BigInt(b.price.raw);
    return av < bv ? -1 : av > bv ? 1 : Number(BigInt(a.tokenId) - BigInt(b.tokenId));
  });

  const cache = {
    fetchedAt: new Date().toISOString(),
    source: 'opensea',
    chain: OPENSEA_CHAIN,
    collection,
    nft: YAKKAMON.nft,
    rawCount,
    activeUniqueTokens: deduped.length,
    listings: deduped,
  };
  await mkdir(RUNTIME_DIR, { recursive: true });
  await writeFile(LISTINGS_CACHE, JSON.stringify(cache, null, 2), { mode: 0o600 });
  return cache;
}

export async function getBestYakkamonListing(tokenId: bigint) {
  const collection = await discoverYakkamonOpenSeaCollection();
  let raw: WireListing;
  try {
    raw = await openSeaRequest<WireListing>(
      `/listings/collection/${encodeURIComponent(collection.slug)}/nfts/${tokenId}/best`,
    );
  } catch (error) {
    if (error instanceof BotError && error.code === 'OPENSEA_NOT_FOUND') throw new BotError('OPENSEA_TOKEN_NOT_LISTED');
    throw error;
  }
  const listing = normalizeListing(raw);
  requireThat(listing && listing.tokenId === tokenId.toString(), 'OPENSEA_INVALID_LISTING_RESPONSE');
  return { collection, listing };
}

interface FulfillmentResponse {
  transactions?: Array<{
    chain?: unknown;
    to?: unknown;
    data?: unknown;
    value?: unknown;
    value_hex?: unknown;
  }>;
}

export async function previewYakkamonFulfillment(tokenId: bigint, buyer: Address) {
  const { collection, listing } = await getBestYakkamonListing(tokenId);
  const response = await openSeaRequest<FulfillmentResponse>('/listings/cross_chain_fulfillment_data', {
    method: 'POST',
    body: JSON.stringify({
      listings: [{
        hash: listing.orderHash,
        chain: listing.chain,
        protocol_address: listing.protocolAddress,
      }],
      fulfiller: { address: buyer },
      payment: { chain: OPENSEA_CHAIN, token_address: ZERO_ADDRESS },
      recipient: buyer,
    }),
  });
  const transactions = Array.isArray(response.transactions) ? response.transactions.map((tx, index) => {
    const to = addressValue(tx.to);
    const chain = stringValue(tx.chain);
    const data = stringValue(tx.data);
    const rawValue = stringValue(tx.value) ?? '0';
    requireThat(to, 'OPENSEA_INVALID_FULFILLMENT_TRANSACTION');
    requireThat(chain?.toLowerCase() === OPENSEA_CHAIN, 'OPENSEA_FULFILLMENT_WRONG_CHAIN');
    requireThat(typeof data === 'string' && data.startsWith('0x'), 'OPENSEA_INVALID_FULFILLMENT_TRANSACTION');
    requireThat(/^\d+$/.test(rawValue), 'OPENSEA_INVALID_FULFILLMENT_TRANSACTION');
    const valueHex = stringValue(tx.value_hex);
    return {
      index,
      chain,
      to,
      valueRaw: rawValue,
      valueRON: formatUnits(BigInt(rawValue), 18),
      valueHex,
      calldataBytes: Math.max(0, (data.length - 2) / 2),
      dataPrefix: data.slice(0, 18),
    };
  }) : [];
  requireThat(transactions.length > 0, 'OPENSEA_FULFILLMENT_NO_TRANSACTIONS');
  const totalValue = transactions.reduce((sum, tx) => sum + BigInt(tx.valueRaw), 0n);
  return {
    mode: 'read-only' as const,
    collection,
    listing,
    buyer,
    listingPriceRON: listing.price.currency === 'RON' && listing.price.decimals === 18 ? listing.price.display : undefined,
    totalTransactionValueRON: formatUnits(totalValue, 18),
    transactions,
    note: 'Preview only: no transaction was signed or broadcast.',
  };
}

export async function openSeaStatus() {
  const key = await openSeaKeyInfo();
  const collection = await discoverYakkamonOpenSeaCollection();
  return {
    mode: 'read-only' as const,
    apiKey: { source: key.source, expiresAt: key.expiresAt ?? 'unknown-or-env-managed' },
    chain: OPENSEA_CHAIN,
    nft: YAKKAMON.nft,
    collection,
  };
}
