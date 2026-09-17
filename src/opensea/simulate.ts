import { formatUnits, isAddress, type Address, type Hex } from 'viem';
import type { Client } from '../ronin.js';
import { requireThat } from '../util.js';
import { openSeaRequest } from './api.js';
import { fetchAllYakkamonListings, type NormalizedOpenSeaListing } from './listings.js';

const OPENSEA_CHAIN = 'ronin';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

interface FulfillmentResponse {
  transactions?: Array<{
    chain?: unknown;
    to?: unknown;
    data?: unknown;
    value?: unknown;
    value_hex?: unknown;
  }>;
}

interface PreparedTransaction {
  index: number;
  chain: string;
  to: Address;
  data: Hex;
  value: bigint;
  valueHex?: string;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'bigint' ? String(value) : undefined;
}

function addressValue(value: unknown): Address | undefined {
  const text = stringValue(value);
  return text && isAddress(text, { strict: false }) ? text as Address : undefined;
}

async function prepareTransactions(listing: NormalizedOpenSeaListing, buyer: Address): Promise<PreparedTransaction[]> {
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
    requireThat(typeof data === 'string' && /^0x[0-9a-fA-F]*$/.test(data), 'OPENSEA_INVALID_FULFILLMENT_TRANSACTION');
    requireThat(/^\d+$/.test(rawValue), 'OPENSEA_INVALID_FULFILLMENT_TRANSACTION');
    return {
      index,
      chain,
      to,
      data: data as Hex,
      value: BigInt(rawValue),
      valueHex: stringValue(tx.value_hex),
    };
  }) : [];

  requireThat(transactions.length > 0, 'OPENSEA_FULFILLMENT_NO_TRANSACTIONS');
  return transactions;
}

export async function simulateYakkamonFulfillment(
  client: Client,
  tokenId: bigint | undefined,
  buyer: Address,
) {
  const cache = await fetchAllYakkamonListings();
  requireThat(cache.listings.length > 0, 'OPENSEA_NO_ACTIVE_LISTINGS');
  const listing = tokenId === undefined
    ? cache.listings[0]!
    : cache.listings.find(item => item.tokenId === tokenId.toString());

  if (!listing) {
    return {
      mode: 'read-only' as const,
      simulated: false as const,
      listed: false as const,
      requestedTokenId: tokenId,
      fetchedAt: cache.fetchedAt,
      currentCheapest: cache.listings.slice(0, 5).map(item => ({ tokenId: item.tokenId, price: item.price })),
      note: 'Requested token is no longer listed; no fulfillment transaction was simulated.',
    };
  }

  const transactions = await prepareTransactions(listing, buyer);
  const gasPrice = await client.getGasPrice();
  const simulations = [];

  for (const tx of transactions) {
    try {
      await client.call({ account: buyer, to: tx.to, data: tx.data, value: tx.value, blockTag: 'latest' });
      const estimatedGas = await client.estimateGas({ account: buyer, to: tx.to, data: tx.data, value: tx.value });
      const estimatedGasCost = estimatedGas * gasPrice;
      simulations.push({
        index: tx.index,
        success: true as const,
        to: tx.to,
        valueRON: formatUnits(tx.value, 18),
        selector: tx.data.slice(0, 10),
        calldataBytes: Math.max(0, (tx.data.length - 2) / 2),
        estimatedGas,
        gasPriceGwei: formatUnits(gasPrice, 9),
        estimatedGasCostRON: formatUnits(estimatedGasCost, 18),
        estimatedTotalRON: formatUnits(tx.value + estimatedGasCost, 18),
      });
    } catch {
      simulations.push({
        index: tx.index,
        success: false as const,
        to: tx.to,
        valueRON: formatUnits(tx.value, 18),
        selector: tx.data.slice(0, 10),
        calldataBytes: Math.max(0, (tx.data.length - 2) / 2),
        reason: 'RPC_SIMULATION_REVERTED_OR_UNAVAILABLE',
      });
    }
  }

  return {
    mode: 'read-only' as const,
    simulated: true as const,
    allSucceeded: simulations.every(result => result.success),
    fetchedAt: cache.fetchedAt,
    collection: cache.collection,
    listing,
    buyer,
    simulations,
    note: 'eth_call + eth_estimateGas only. Nothing was signed or broadcast.',
  };
}
