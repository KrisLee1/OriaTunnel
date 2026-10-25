import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { platforms, releaseVersion, root } from './config.mjs';
import { run, buildVerifier, signArtifact, signingEnvironment } from '../check-update-secrets.mjs';
export const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function collect(platform, output) {
  const spec = platforms[platform];
  if (!spec) throw new Error('Unsupported release platform.');
  const version = releaseVersion(process.env.RELEASE_TAG);
  const bundle = path.join(root, 'src-tauri/target', spec.target, 'release/bundle');
  const { clean } = signingEnvironment();
  const verifier = buildVerifier(clean);
  fs.mkdirSync(output, { recursive: true });
  const copied = [];
  const copy = source => {
    if (!fs.statSync(source).isFile()) throw new Error('Release asset must be a regular file.');
    const destination = path.join(output, path.basename(source));
    if (fs.existsSync(destination)) throw new Error('Duplicate release asset.');
    fs.copyFileSync(source, destination); copied.push(destination); return destination;
  };
  let updater;
  if (spec.os === 'macos') {
    const app = path.join(bundle, 'macos/OriaTunnel.app');
    run('codesign', ['--verify', '--deep', '--strict', app], { env: clean });
    run('xcrun', ['stapler', 'validate', app], { env: clean });
    run('spctl', ['--assess', '--type', 'execute', app], { env: clean });
    const arch = spec.arch === 'aarch64' ? 'aarch64' : 'x64';
    const dmg = path.join(bundle, 'dmg', `OriaTunnel_${version}_${arch}.dmg`);
    copy(dmg); copy(dmg.replace(/\.dmg$/, '.zip'));
    updater = path.join(output, `OriaTunnel_${version}_${spec.arch}.app.tar.gz`);
    run('tar', ['-czf', updater, '-C', path.dirname(app), path.basename(app)], { env: clean });
    copied.push(updater);
  } else {
    updater = copy(path.join(bundle, 'nsis', `OriaTunnel_${version}_${spec.arch}-setup.exe`));
    // Inspect the app PE, since NSIS bootstraps are x86 even for ARM64 installs.
    const executable = fs.readFileSync(path.join(root, 'src-tauri/target', spec.target, 'release/oria-tunnel.exe'));
    const pe = executable.readUInt32LE(0x3c);
    const machine = executable.readUInt16LE(pe + 4);
    if (executable.toString('ascii', pe, pe + 4) !== 'PE\0\0' || machine !== (spec.arch === 'arm64' ? 0xaa64 : 0x8664)) throw new Error('Application PE architecture does not match its release platform.');
    if (executable.readUInt16LE(pe + 24 + 68) !== 2) throw new Error('Windows release must use the GUI subsystem.');
  }
  signArtifact(updater, version);
  run(verifier, ['--config', path.join(root, 'src-tauri/tauri.conf.json'), '--artifact', updater, '--signature', `${updater}.sig`, '--version', version, '--require-filename'], { env: clean });
  copied.push(`${updater}.sig`);
  const receipt = {
    platform, version, target: spec.target, commit: process.env.RELEASE_COMMIT || process.env.GITHUB_SHA,
    updater: path.basename(updater), signature: fs.readFileSync(`${updater}.sig`, 'utf8').trim(),
    assets: copied.map(file => ({ name: path.basename(file), size: fs.statSync(file).size, sha256: sha256(file) })),
  };
  fs.writeFileSync(path.join(output, `receipt-${platform}.json`), JSON.stringify(receipt, null, 2) + '\n');
  console.log(`Collected and verified ${platform} v${version}.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { collect(process.env.RELEASE_PLATFORM, path.resolve(process.env.RELEASE_OUTPUT || 'outputs/release-assets')); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
