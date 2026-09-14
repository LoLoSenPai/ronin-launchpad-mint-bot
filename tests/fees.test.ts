import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGwei } from 'viem';
import { calculateFees,gasBudget } from '../src/executor/fees.js';
import { readConfig } from '../src/config.js';
const caps={maxPriorityFee:parseGwei('200'),maxFee:parseGwei('500')};
const history={baseFeePerGas:[parseGwei('20'),parseGwei('21')],reward:[[parseGwei('1'),parseGwei('3')]]};
test('uses actual base fees and enforces documented priority floor',()=>{
  const fee=calculateFees(history,'normal',caps);
  assert.equal(fee.maxPriorityFeePerGas,parseGwei('20'));
  assert.equal(fee.maxFeePerGas,parseGwei('62'));
});
test('race uses high-percentile rewards and bigint arithmetic',()=>{
  const fee=calculateFees({...history,reward:[[parseGwei('30'),parseGwei('75')]]},'race',caps);
  assert.equal(fee.maxPriorityFeePerGas,parseGwei('150'));
  assert.equal(fee.maxFeePerGas,parseGwei('192'));
});
test('fee caps cannot silently make tx unmarketable',()=>{
  assert.throws(()=>calculateFees(history,'race',{maxPriorityFee:parseGwei('40'),maxFee:parseGwei('50')}),/FEE_CAP_TOO_LOW/);
});
test('aggressive uses 1.2 buffer, clamps to cap without dropping under floor',()=>{
  assert.equal(calculateFees(history,'aggressive',caps).maxPriorityFeePerGas,parseGwei('24'));
  const f=calculateFees({...history,reward:[[1n,parseGwei('200')]]},'race',caps);
  assert.equal(f.maxPriorityFeePerGas,caps.maxPriorityFee);assert.equal(f.capped,true);
});
test('rejects absent/malformed history and negative rewards',()=>{
  assert.throws(()=>calculateFees({baseFeePerGas:[1n]},'race',caps));
  assert.throws(()=>calculateFees({baseFeePerGas:[1n,2n]},'race',caps));
  assert.throws(()=>calculateFees({baseFeePerGas:[1n,2n],reward:[[-1n,2n]]},'race',caps));
});
test('total budget includes extra fees and exact boundary',()=>{
  assert.equal(gasBudget(200000n,10n,7n,2000007n),2000007n);
  assert.throws(()=>gasBudget(200000n,10n,8n,2000007n),/TOTAL_GAS_CAP_EXCEEDED/);
  assert.throws(()=>gasBudget(0n,10n,0n,1n));
});
test('race can bid above quiet-block history and rise further with competition',()=>{
  const raceCaps={maxPriorityFee:parseGwei('250000'),maxFee:parseGwei('300000'),raceMinPriorityFee:parseGwei('10000')};
  assert.equal(calculateFees(history,'race',raceCaps).maxPriorityFeePerGas,parseGwei('10000'));
  const busy={...history,reward:[[parseGwei('20000'),parseGwei('30000')]]};
  assert.equal(calculateFees(busy,'race',raceCaps).maxPriorityFeePerGas,parseGwei('60000'));
  assert.equal(calculateFees(history,'normal',raceCaps).maxPriorityFeePerGas,parseGwei('20'));
});
test('race floor cannot exceed maximum priority cap',()=>{
  assert.throws(()=>readConfig({RACE_MIN_PRIORITY_FEE_GWEI:'10000',MAX_PRIORITY_FEE_GWEI:'200'}),/INVALID_RACE_PRIORITY_FLOOR/);
  assert.throws(()=>calculateFees(history,'race',{...caps,raceMinPriorityFee:parseGwei('10000')}),/INVALID_RACE_PRIORITY_FLOOR/);
});
