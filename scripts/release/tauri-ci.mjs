// Build via the official Tauri Action, retaining the project's notarized DMG
// packaging. Updater secrets are removed before Cargo or platform tools run.
import path from 'node:path';
import { root } from './config.mjs';
import { run, signingEnvironment } from '../check-update-secrets.mjs';
const args = process.argv.slice(2);
const { clean } = signingEnvironment();
try {
  if (process.platform === 'darwin' && args[0] === 'build') {
    const target = args[args.indexOf('--target') + 1];
    if (!['aarch64-apple-darwin', 'x86_64-apple-darwin'].includes(target)) throw new Error('An explicit macOS release target is required.');
    run('bash', [path.join(root, 'scripts/package-mac.sh'), '--signed', '--target', target], { env: clean });
  } else {
    run(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), ...args], { env: clean });
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
