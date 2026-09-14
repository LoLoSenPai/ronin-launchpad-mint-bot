import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEther, parseGwei, type Address } from 'viem';
import { readConfig } from '../src/config.js';
import type { Client } from '../src/ronin.js';
import { YAKKAMON, mintData } from '../src/launchpad/yakkamon.js';
import { assertStagedFresh, createStagedBuilder, type StagedTransaction } from '../src/executor/staged.js';

const wallet = '0x1111111111111111111111111111111111111111' as Address;
const config = readConfig({EXPECTED_WALLET: wallet, MAX_TOTAL_GAS_RON: '1'});
const client = {} as Client;
const fees = {maxFeePerGas: parseGwei('100'), maxPriorityFeePerGas: parseGwei('40')};

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    wallet,
    balance: parseEther('1'),
    nonce: 7,
    simulation: {status: 'not-started' as const},
    hypothetical: {status: 'hypothetical-success' as const, gasUsed: 100_001n},
    fees,
    ...overrides,
  };
}

test('stages a canonical transaction from a successful opening simulation', async () => {
  let quoted: {tx: unknown; gas: bigint} | undefined;
  const events: string[] = [];
  const build = createStagedBuilder({
    preflight: async () => { events.push('preflight'); return fixture(); },
    quoteExtraFees: async (_client, tx, gas) => {
      quoted = {tx, gas};
      return {extraFeeBudget: 17n};
    },
    now: () => { events.push('timestamp'); return 1_789_430_000_000; },
  });
  const staged = await build(client, config);
  assert.equal(staged.tx.gas, 130_002n);
  assert.equal(staged.tx.nonce, 7);
  assert.equal(staged.tx.to, YAKKAMON.launchpad);
  assert.equal(staged.tx.data, mintData(wallet, config.stageIndex));
  assert.deepEqual(
    {maxFeePerGas: staged.tx.maxFeePerGas, maxPriorityFeePerGas: staged.tx.maxPriorityFeePerGas},
    fees,
  );
  assert.equal(quoted?.tx, staged.tx);
  assert.equal(quoted?.gas, staged.tx.gas);
  assert.equal(staged.extraFeeBudget, 17n);
  assert.equal(staged.budget, staged.tx.gas * fees.maxFeePerGas + 17n);
  assert.equal(staged.preparedAt, 1_789_430_000_000);
  assert.deepEqual(events, ['timestamp', 'preflight']);
});

test('requires a successful real or hypothetical simulation and its gas', async () => {
  for (const report of [
    fixture({hypothetical: {status: 'unsupported' as const}}),
    fixture({simulation: {status: 'success' as const}, hypothetical: undefined}),
  ]) {
    const build = createStagedBuilder({
      preflight: async () => report,
      quoteExtraFees: async () => ({extraFeeBudget: 0n}),
      now: Date.now,
    });
    await assert.rejects(() => build(client, config), /STAGED_(PREFLIGHT_NOT_SUCCESSFUL|GAS_REQUIRED)/);
  }
});

test('accepts a real simulation and uses its pending gas estimate', async () => {
  const build = createStagedBuilder({
    preflight: async () => fixture({
      simulation: {status: 'success' as const},
      hypothetical: undefined,
      estimatedGas: 200_000n,
    }),
    quoteExtraFees: async () => ({extraFeeBudget: 0n}),
    now: Date.now,
  });
  assert.equal((await build(client, config)).tx.gas, 260_000n);
});

test('uses current preflight fees and rejects insufficient balance or an unexpected contract', async () => {
  const dependencies = (report: ReturnType<typeof fixture>) => ({
    preflight: async () => report,
    quoteExtraFees: async () => ({extraFeeBudget: 1n}),
    now: Date.now,
  });
  await assert.rejects(
    () => createStagedBuilder(dependencies(fixture({balance: 1n})))(client, config),
    /INSUFFICIENT_RON/,
  );
  await assert.rejects(
    () => createStagedBuilder(dependencies(fixture()))(client, {...config, expectedLaunchpad: wallet}),
    /UNEXPECTED_TARGET/,
  );
});

test('freshness is a local bounded-time check', () => {
  const staged = {preparedAt: Date.now()} as StagedTransaction;
  assert.doesNotThrow(() => assertStagedFresh(staged));
  assert.throws(() => assertStagedFresh({...staged, preparedAt: Date.now() - 15_001}), /STAGED_TRANSACTION_STALE/);
  assert.throws(() => assertStagedFresh({...staged, preparedAt: Date.now() + 60_000}), /STAGED_TRANSACTION_STALE/);
  assert.throws(() => assertStagedFresh(staged, -1), /INVALID_STAGED_MAX_AGE/);
});
