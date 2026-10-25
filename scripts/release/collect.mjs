import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { platforms, releaseVersion, root } from './config.mjs';
import { run, buildVerifier, signArtifact, signingEnvironment } from '../check-update-secrets.mjs';
export const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function verifyLicense(file, stripBom = false) {
  let content = fs.readFileSync(file);
  if (stripBom && content.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) content = content.subarray(3);
  if (!content.equals(fs.readFileSync(path.join(root, 'LICENSE')))) throw new Error('Packaged license does not match the repository LICENSE.');
}
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
    verifyLicense(path.join(app, 'Contents/Resources/licenses/OriaTunnel_GPL-3.0.txt'));
    run('codesign', ['--verify', '--deep', '--strict', app], { env: clean });
    run('bash', [path.join(root, 'scripts/release/stapler.sh'), 'validate', app], { env: clean });
    run('spctl', ['--assess', '--type', 'execute', app], { env: clean });
    const arch = spec.arch === 'aarch64' ? 'aarch64' : 'x64';
    const dmg = path.join(bundle, 'dmg', `OriaTunnel_${version}_${arch}.dmg`);
    copy(dmg); copy(dmg.replace(/\.dmg$/, '.zip'));
    updater = path.join(output, `OriaTunnel_${version}_${spec.arch}.app.tar.gz`);
    // The updater strips one leading directory from every entry. AppleDouble
    // sidecar entries must not appear as unrelated roots in this archive.
    run('tar', ['-czf', updater, '-C', path.dirname(app), path.basename(app)], { env: { ...clean, COPYFILE_DISABLE: '1' } });
    const unpacked = fs.mkdtempSync(path.join(os.tmpdir(), 'oria-update-package-'));
    try {
      run('tar', ['-xzf', updater, '-C', unpacked], { env: clean });
      const restored = path.join(unpacked, path.basename(app));
      verifyLicense(path.join(restored, 'Contents/Resources/licenses/OriaTunnel_GPL-3.0.txt'));
      if (fs.readdirSync(unpacked).some(name => name !== path.basename(app))) throw new Error('Updater TAR contains unexpected root entries.');
      run('codesign', ['--verify', '--deep', '--strict', restored], { env: clean });
      run('bash', [path.join(root, 'scripts/release/stapler.sh'), 'validate', restored], { env: clean });
    } finally { fs.rmSync(unpacked, { recursive: true, force: true }); }
    copied.push(updater);
  } else {
    updater = copy(path.join(bundle, 'nsis', `OriaTunnel_${version}_${spec.arch}-setup.exe`));
    const nsis = path.join(path.dirname(bundle), 'nsis', spec.arch);
    verifyLicense(path.join(nsis, 'license_file'), true);
    const script = fs.readFileSync(path.join(nsis, 'installer.nsi'), 'utf8');
    const resource = script.split(/\r?\n/).find(line => line.trimStart().startsWith('File /a ') &&  /"\/oname=licenses[\\/]OriaTunnel_GPL-3\.0\.txt"/.test(line));
    const source = resource?.match(/ "([^"]+)"\s*$/)?.[1];
    if (!source) throw new Error('NSIS installer is missing the installed application license resource.');
    verifyLicense(source);
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
    licenseSha256: sha256(path.join(root, 'LICENSE')),
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
