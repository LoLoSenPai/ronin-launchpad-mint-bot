import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { BotError, requireThat } from '../util.js';

const API_BASE = 'https://api.opensea.io/api/v2';
const RUNTIME_DIR = 'runtime';
const KEY_FILE = `${RUNTIME_DIR}/opensea-api-key.json`;
const REQUEST_TIMEOUT_MS = 8_000;
const EXPIRY_SAFETY_MS = 5 * 60_000;

interface CachedKey {
  apiKey: string;
  expiresAt?: string;
  createdAt: string;
}

export interface OpenSeaKeyInfo {
  source: 'env' | 'runtime' | 'instant';
  expiresAt?: string;
}

function validFutureExpiry(value: string | undefined) {
  if (!value) return true;
  const time = Date.parse(value);
  return Number.isFinite(time) && time - Date.now() > EXPIRY_SAFETY_MS;
}

async function readCachedKey(): Promise<CachedKey | undefined> {
  try {
    const parsed = JSON.parse(await readFile(KEY_FILE, 'utf8')) as Partial<CachedKey>;
    if (typeof parsed.apiKey !== 'string' || !parsed.apiKey.trim()) return undefined;
    if (!validFutureExpiry(parsed.expiresAt)) return undefined;
    return { apiKey: parsed.apiKey, expiresAt: parsed.expiresAt, createdAt: parsed.createdAt ?? '' };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    return undefined;
  }
}

async function requestInstantKey(): Promise<CachedKey> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/auth/keys`, {
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
  } catch {
    throw new BotError('OPENSEA_KEY_REQUEST_FAILED');
  }
  requireThat(response.ok, `OPENSEA_KEY_HTTP_${response.status}`);
  const body = await response.json() as Record<string, unknown>;
  const apiKey = body.api_key ?? body.apiKey;
  const expiresAt = body.expires_at ?? body.expiresAt;
  requireThat(typeof apiKey === 'string' && apiKey.length > 10, 'OPENSEA_INVALID_KEY_RESPONSE');
  requireThat(expiresAt === undefined || typeof expiresAt === 'string', 'OPENSEA_INVALID_KEY_EXPIRY');
  const cached: CachedKey = { apiKey, expiresAt, createdAt: new Date().toISOString() };
  await mkdir(RUNTIME_DIR, { recursive: true });
  await writeFile(KEY_FILE, JSON.stringify(cached, null, 2), { mode: 0o600 });
  return cached;
}

async function keyState(forceRefresh = false): Promise<{ key: string; info: OpenSeaKeyInfo }> {
  const envKey = process.env.OPENSEA_API_KEY?.trim();
  if (envKey && !forceRefresh) return { key: envKey, info: { source: 'env' } };
  if (!forceRefresh) {
    const cached = await readCachedKey();
    if (cached) return { key: cached.apiKey, info: { source: 'runtime', expiresAt: cached.expiresAt } };
  }
  if (forceRefresh) await rm(KEY_FILE, { force: true });
  const created = await requestInstantKey();
  return { key: created.apiKey, info: { source: 'instant', expiresAt: created.expiresAt } };
}

export async function openSeaKeyInfo(): Promise<OpenSeaKeyInfo> {
  return (await keyState()).info;
}

export async function openSeaRequest<T>(
  path: string,
  init: RequestInit = {},
  retryAuth = true,
): Promise<T> {
  const auth = await keyState();
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        accept: 'application/json',
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        'x-api-key': auth.key,
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new BotError('OPENSEA_REQUEST_FAILED');
  }

  if ((response.status === 401 || response.status === 403) && retryAuth && auth.info.source !== 'env') {
    await keyState(true);
    return openSeaRequest<T>(path, init, false);
  }
  requireThat(response.ok, response.status === 404 ? 'OPENSEA_NOT_FOUND' : `OPENSEA_HTTP_${response.status}`);
  try {
    return await response.json() as T;
  } catch {
    throw new BotError('OPENSEA_INVALID_JSON');
  }
}
