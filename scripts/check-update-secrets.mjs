import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const verifierManifest = path.join(root, 'tools/update-verifier/Cargo.toml');
export function signingEnvironment(environment = process.env) {
  const clean = { ...environment };
  const signing = {};
  for (const name of ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PATH', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD']) {
    if (environment[name] !== undefined) signing[name] = environment[name];
    delete clean[name];
  }
  for (const name of ['TAURI_PRIVATE_KEY', 'TAURI_PRIVATE_KEY_PATH', 'TAURI_KEY_PASSWORD']) delete clean[name];
  return { clean, signing };
}
export function normalizeSigningKey(value) {
  const text = value.replace(/^\uFEFF/, '').trim();
  const encoded = text.startsWith('untrusted comment:') ? Buffer.from(text + '\n').toString('base64') : text.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || !Buffer.from(encoded, 'base64').toString('utf8').split('\n')[0].includes('secret key')) {
    throw new Error('Invalid TAURI_SIGNING_PRIVATE_KEY format. Paste the complete private .key file contents, not its path or the .pub file.');
  }
  return encoded;
}
export function signingFailure(result) {
  // Only emit fixed messages: raw CLI diagnostics can include secret input.
  const diagnostic = `${result.stderr || ''}\n${result.stdout || ''}`.toLowerCase();
  if (diagnostic.includes('password') || diagnostic.includes('decrypt')) return 'Updater private key could not be decrypted. Add or correct TAURI_SIGNING_PRIVATE_KEY_PASSWORD; use an empty value only for a key created without a password.';
  if (diagnostic.includes('base64') || diagnostic.includes('private key') || diagnostic.includes('secret key')) return 'Updater private key could not be decoded. Check the complete contents of TAURI_SIGNING_PRIVATE_KEY.';
  if (diagnostic.includes('app-version') && diagnostic.includes('unexpected')) return 'The installed Tauri CLI does not support version-bound signatures. Install the frozen lockfile dependencies.';
  return 'Updater signer failed. Check the signing key format and password; raw diagnostics were withheld.';
}
export function signArtifact(artifact, version, environment = process.env) {
  const { clean, signing } = signingEnvironment(environment);
  if (signing.TAURI_SIGNING_PRIVATE_KEY?.trim()) signing.TAURI_SIGNING_PRIVATE_KEY = normalizeSigningKey(signing.TAURI_SIGNING_PRIVATE_KEY);
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'signer', 'sign', '--app-version', version, artifact],
    { cwd: root, windowsHide: true, env: { ...clean, ...signing, CI: 'true' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) throw new Error(signingFailure(result));
}
export function run(program, args, options = {}) {
  const result = spawnSync(program, args, { cwd: root, windowsHide: true, stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) throw new Error(`Command failed: ${path.basename(program)} (${result.status ?? 'startup'})`);
  return result;
}
export function buildVerifier(environment) {
  run('cargo', ['build', '--locked', '--release', '--manifest-path', verifierManifest], { env: environment });
  return path.join(root, 'tools/update-verifier/target/release', process.platform === 'win32' ? 'oria-update-verifier.exe' : 'oria-update-verifier');
}
export function checkSecrets({ config = path.join(root, 'src-tauri/tauri.conf.json'), verifier, environment = process.env } = {}) {
  const { clean, signing } = signingEnvironment(environment);
  if (!signing.TAURI_SIGNING_PRIVATE_KEY?.trim() && !signing.TAURI_SIGNING_PRIVATE_KEY_PATH?.trim()) {
    throw new Error('Configure TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH before signing.');
  }
  const version = JSON.parse(fs.readFileSync(config, 'utf8')).version;
  verifier ||= buildVerifier(clean);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'oria-signing-check-'));
  try {
    const probe = path.join(temporary, 'signing-probe.txt');
    fs.writeFileSync(probe, `OriaTunnel signing preflight ${randomBytes(32).toString('hex')}\n`);
    // Signing keys are passed only through the signer's environment. Suppress
    // its captured diagnostics so malformed secret values can never reach logs.
    signArtifact(probe, version, { ...clean, ...signing });
    run(verifier, ['--config', config, '--artifact', probe, '--signature', `${probe}.sig`, '--version', version, '--require-filename'], { env: clean });
    console.log('Updater signing secret matches the configured public key; version-bound signature verified.');
    return verifier;
  } finally {
    const resolved = fs.realpathSync(temporary);
    const parent = fs.realpathSync(os.tmpdir());
    if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('oria-signing-check-')) throw new Error('Unexpected signing-check directory');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { checkSecrets(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
