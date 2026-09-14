import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'dotenv';
test('shareable environment template never contains wallet credentials',async()=>{
  const env=parse(await readFile('.env.example','utf8'));
  // Assert booleans so a failed test never prints the credential as an assertion value.
  assert.ok(!env.RONIN_PRIVATE_KEY,'Remove the private key from .env.example');
  assert.ok(!env.EXPECTED_WALLET,'Keep the example wallet blank');
});
