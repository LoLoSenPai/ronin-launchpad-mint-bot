import type { Client } from '../ronin.js';
import { BotError, log, requireThat, sleep } from '../util.js';
import { fetchMetadata, inspectMetadata, type FetchResult } from './inspect.js';

export const DEFAULT_REVEAL_SENTINELS = [1n, 50n, 1500n, 5000n, 9000n] as const;
const DEFAULT_POLL_MS = 500;
const HEARTBEAT_MS = 30_000;

interface Sentinel {
  tokenId: bigint;
  tokenURI: string;
  baselineHash: string;
  baselineStatus: string;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function normalized(value: unknown): string | undefined {
  const text = stringValue(value);
  return text?.trim().toLowerCase();
}

function revealReason(sentinel: Sentinel, current: FetchResult): string | undefined {
  if (current.status !== 'ok') return undefined;
  const rarity = stringValue(current.metadata?.rarity);
  if (rarity) return `rarity:${rarity}`;

  const status = normalized(current.metadata?.status);
  if (status && status !== 'hidden' && status !== 'bad egg') return `status:${status}`;

  // If Status disappears while the payload changes, treat it as a reveal candidate.
  // A simple Hidden payload edit does not trigger this path.
  if (!status && current.sha256 && current.sha256 !== sentinel.baselineHash) return 'metadata-structure-changed';
  return undefined;
}

export async function watchReveal(
  client: Client,
  options: { tokenIds?: bigint[]; pollMs?: number; once?: boolean } = {},
) {
  const tokenIds = options.tokenIds?.length ? options.tokenIds : [...DEFAULT_REVEAL_SENTINELS];
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  requireThat(tokenIds.length > 0 && tokenIds.length <= 10, 'INVALID_REVEAL_SENTINEL_COUNT');
  requireThat(pollMs >= 250 && pollMs <= 10_000, 'INVALID_REVEAL_POLL_MS');

  const initial = await inspectMetadata(client, tokenIds, { compact: true });
  const sentinels: Sentinel[] = initial.tokens.map(token => {
    requireThat(token.tokenURI && token.fetch?.status === 'ok' && token.fetch.sha256, 'REVEAL_SENTINEL_FETCH_FAILED');
    const status = normalized(token.fetch.metadata?.status);
    const rarity = stringValue(token.fetch.metadata?.rarity);
    if (rarity || (status && status !== 'hidden' && status !== 'bad egg')) throw new BotError('REVEAL_ALREADY_VISIBLE');
    requireThat(status === 'hidden', 'REVEAL_SENTINEL_NOT_HIDDEN');
    return {
      tokenId: token.tokenId,
      tokenURI: token.tokenURI,
      baselineHash: token.fetch.sha256,
      baselineStatus: status,
    };
  });

  const baseline = sentinels.map(sentinel => ({
    tokenId: sentinel.tokenId,
    tokenURI: sentinel.tokenURI,
    sha256: sentinel.baselineHash,
    status: sentinel.baselineStatus,
  }));

  if (options.once) return {
    mode: 'read-only' as const,
    watching: false,
    pollMs,
    baseline,
  };

  log('reveal-watch-started', { pollMs, tokenIds });
  let round = 0;
  let lastHeartbeat = Date.now();

  while (true) {
    const started = performance.now();
    const results = await Promise.all(sentinels.map(async sentinel => ({
      sentinel,
      current: await fetchMetadata(sentinel.tokenURI, true),
    })));
    round += 1;

    const signals = results.flatMap(({ sentinel, current }) => {
      const reason = revealReason(sentinel, current);
      if (!reason) return [];
      return [{
        tokenId: sentinel.tokenId,
        reason,
        status: current.metadata?.status,
        rarity: current.metadata?.rarity,
        sha256: current.sha256,
        latencyMs: current.latencyMs,
        cfCacheStatus: current.headers?.cfCacheStatus,
      }];
    });

    if (signals.length) {
      const detectedAt = new Date().toISOString();
      log('reveal-detected', { detectedAt, round, signals });
      return {
        mode: 'read-only' as const,
        watching: false,
        detected: true,
        detectedAt,
        round,
        signals,
      };
    }

    const now = Date.now();
    if (now - lastHeartbeat >= HEARTBEAT_MS) {
      const latencies = results.map(result => result.current.latencyMs).filter((value): value is number => value !== undefined);
      log('reveal-watch-heartbeat', {
        round,
        ok: results.filter(result => result.current.status === 'ok').length,
        failed: results.filter(result => result.current.status !== 'ok').length,
        minLatencyMs: latencies.length ? Math.min(...latencies) : undefined,
        maxLatencyMs: latencies.length ? Math.max(...latencies) : undefined,
      });
      lastHeartbeat = now;
    }

    const elapsed = performance.now() - started;
    await sleep(Math.max(0, pollMs - elapsed));
  }
}
