import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSigningKey, signingEnvironment, signingFailure } from './check-update-secrets.mjs';

test('accepts pasted private-key text and wrapped base64 without printing it', () => {
  const raw = 'untrusted comment: rsign encrypted secret key\nTEST-ONLY-INVALID-KEY\n';
  const base64 = Buffer.from(raw).toString('base64');
  assert.equal(normalizeSigningKey(`\uFEFF ${base64}\r\n`), base64);
  assert.equal(normalizeSigningKey(base64.match(/.{1,30}/g).join('\n')), base64);
  assert.equal(normalizeSigningKey(raw), base64);
  for (const value of ['C:\\private.key', '/tmp/private.key', Buffer.from('untrusted comment: minisign public key\nPUBLIC').toString('base64')]) {
    assert.throws(() => normalizeSigningKey(value), /complete private .key/);
  }
});
test('build commands never receive modern or legacy signing secrets', () => {
  const { clean, signing } = signingEnvironment({ PATH: 'tools', TAURI_SIGNING_PRIVATE_KEY: 'sensitive', TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'password', TAURI_PRIVATE_KEY: 'legacy' });
  assert.deepEqual(clean, { PATH: 'tools' });
  assert.equal(signing.TAURI_SIGNING_PRIVATE_KEY, 'sensitive');
});
test('signer failures expose fixed diagnostic categories without secret fragments', () => {
  const secret = 'NEVER-PRINT-THIS';
  for (const diagnostic of [`incorrect updater private key password: ${secret}`, `failed to decode base64 secret key ${secret}`, `unexpected argument '--app-version' ${secret}`, secret]) {
    const message = signingFailure({ stderr: diagnostic, status: 1 });
    assert.ok(!message.includes(secret));
  }
  assert.match(signingFailure({ stderr: 'incorrect updater private key password' }), /PASSWORD/);
});
