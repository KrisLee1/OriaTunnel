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
  return { clean, signing };
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
    const result = spawnSync(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'signer', 'sign', '--app-version', version, probe],
      { cwd: root, windowsHide: true, env: { ...clean, ...signing, CI: 'true' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.error || result.status !== 0) throw new Error('Updater signing failed. Check the private key and its password.');
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
