import type { Address } from 'viem';
import type { Config } from '../config.js';
import type { Client } from '../ronin.js';
import { validateTransaction, type MintTransaction } from '../security.js';
import { YAKKAMON, mintData } from '../launchpad/yakkamon.js';
import { ceilDiv, requireThat } from '../util.js';
import { preflight } from './prepare.js';
import { quoteExtraFees } from './fees.js';

export interface StagedTransaction {
  tx: MintTransaction;
  extraFeeBudget: bigint;
  budget: bigint;
  preparedAt: number;
}

interface StagedPreflight {
  wallet: Address;
  balance: bigint;
  nonce: number;
  simulation: {status: 'success' | 'not-started'};
  hypothetical?:
    | {status: 'hypothetical-success'; gasUsed: bigint}
    | {status: 'hypothetical-failed'}
    | {status: 'unsupported'};
  estimatedGas?: bigint;
  fees: {maxFeePerGas: bigint; maxPriorityFeePerGas: bigint};
}

interface StagedDependencies {
  preflight(client: Client, config: Config): Promise<StagedPreflight>;
  quoteExtraFees(client: Client, tx: MintTransaction, gas: bigint): Promise<{extraFeeBudget: bigint}>;
  now(): number;
}

/** Factory kept injectable so the staging policy can be tested without duplicating preflight's RPC fixture. */
export function createStagedBuilder(dependencies: StagedDependencies) {
  return async function buildStaged(client: Client, config: Config): Promise<StagedTransaction> {
    requireThat(config.wallet && config.maxTotalGas, 'EXECUTION_CONFIG_INCOMPLETE');
    const preparedAt = dependencies.now();
    const report = await dependencies.preflight(client, config);
    const hypotheticalGas = report.hypothetical?.status === 'hypothetical-success'
      ? report.hypothetical.gasUsed
      : undefined;
    requireThat(report.simulation.status === 'success' || hypotheticalGas !== undefined, 'STAGED_PREFLIGHT_NOT_SUCCESSFUL');
    const gas = report.estimatedGas ?? hypotheticalGas;
    requireThat(gas && gas > 0n, 'STAGED_GAS_REQUIRED');

    const tx: MintTransaction = {
      type: 'eip1559',
      chainId: 2020,
      to: YAKKAMON.launchpad,
      data: mintData(config.wallet, config.stageIndex),
      value: 0n,
      nonce: report.nonce,
      gas: ceilDiv(gas * 130n, 100n),
      maxFeePerGas: report.fees.maxFeePerGas,
      maxPriorityFeePerGas: report.fees.maxPriorityFeePerGas,
    };
    const {extraFeeBudget} = await dependencies.quoteExtraFees(client, tx, tx.gas);
    const budget = validateTransaction(tx, config, extraFeeBudget);
    requireThat(report.balance >= budget, 'INSUFFICIENT_RON');
    return {tx, extraFeeBudget, budget, preparedAt};
  };
}

export const buildStaged = createStagedBuilder({preflight, quoteExtraFees, now: Date.now});

export function assertStagedFresh(staged: StagedTransaction, maxAgeMs = 15_000): void {
  requireThat(Number.isFinite(maxAgeMs) && maxAgeMs >= 0, 'INVALID_STAGED_MAX_AGE');
  requireThat(Number.isFinite(staged.preparedAt), 'INVALID_STAGED_PREPARED_AT');
  const age = Date.now() - staged.preparedAt;
  requireThat(age >= 0 && age <= maxAgeMs, 'STAGED_TRANSACTION_STALE');
}
