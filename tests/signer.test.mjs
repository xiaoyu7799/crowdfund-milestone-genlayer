import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sealKey, openKey } from '../site/src/signer.js';
const key = '0x' + '12'.repeat(32), password = 'a long test password';
test('encrypted portable backup survives serialization and restores the same key', async () => {
  const backup = await sealKey(key, password);
  const serialized = JSON.stringify(backup);
  assert.ok(!serialized.includes(key));
  assert.equal(await openKey(JSON.parse(serialized), password), key);
  await assert.rejects(openKey(backup, 'wrong password value'));
  const tampered = structuredClone(backup); tampered.data[0] ^= 1;
  await assert.rejects(openKey(tampered, password));
});
test('reject malformed key, weak password, and malformed backup', async () => {
  await assert.rejects(sealKey('0x123', password));
  await assert.rejects(sealKey(key, 'short'));
  await assert.rejects(openKey({version: 2}, password));
});
