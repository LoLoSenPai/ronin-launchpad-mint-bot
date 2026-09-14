import { setTimeout } from 'node:timers/promises';
export const sleep = (ms: number) => setTimeout(ms);
export const json = (x: unknown) => JSON.stringify(x, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
export function log(event: string, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...details }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
}
export class BotError extends Error {
  constructor(public code: string, message: string = code) { super(message); }
}
// Never emit a library error/stack: HTTP errors can include RPC credentials or a signed tx.
export function errorCode(e: unknown): string { return e instanceof BotError ? e.code : 'UNEXPECTED_ERROR'; }
export function requireThat(condition: unknown, code: string): asserts condition {
  if (!condition) throw new BotError(code);
}
export const max = (...v: bigint[]) => v.reduce((a,b) => a > b ? a : b);
export const min = (...v: bigint[]) => v.reduce((a,b) => a < b ? a : b);
export const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
