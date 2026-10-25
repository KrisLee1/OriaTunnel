import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { releaseVersion, platforms, matrix, root } from './config.mjs';
import { validateAssets } from './publish.mjs';
import { sha256 } from './collect.mjs';
const commit = 'a'.repeat(40);
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oria-release-test-'));
  for (const [platform, spec] of Object.entries(platforms)) {
    const updater = spec.os === 'macos' ? `OriaTunnel_0.1.0_${spec.arch}.app.tar.gz` : `OriaTunnel_0.1.0_${spec.arch}-setup.exe`;
    const names = [updater, `${updater}.sig`];
    if (spec.os === 'macos') names.push(`OriaTunnel_0.1.0_${spec.arch === 'aarch64' ? 'aarch64' : 'x64'}.dmg`, `OriaTunnel_0.1.0_${spec.arch === 'aarch64' ? 'aarch64' : 'x64'}.zip`);
    for (const name of names) fs.writeFileSync(path.join(directory, name), `public-test-content-${name}`);
    const receipt = { platform, version: '0.1.0', target: spec.target, commit, updater, signature: fs.readFileSync(path.join(directory, `${updater}.sig`), 'utf8'), assets: names.map(name => ({ name, size: fs.statSync(path.join(directory, name)).size, sha256: sha256(path.join(directory, name)) })) };
    fs.writeFileSync(path.join(directory, `receipt-${platform}.json`), JSON.stringify(receipt));
  }
  return directory;
}
const options = { version: '0.1.0', commit, verify: false };
test('one manifest covers every architecture with immutable tag-specific URLs', () => {
  const directory = fixture();
  try {
    const { manifest, files } = validateAssets(directory, options);
    assert.deepEqual(Object.keys(manifest.platforms), Object.keys(platforms));
    assert.equal(files.length, 16);
    for (const entry of Object.values(manifest.platforms)) assert.ok(entry.url.startsWith('https://github.com/KrisLee1/OriaTunnel/releases/download/v0.1.0/'));
  } finally { fs.rmSync(directory, { recursive: true }); }
});
test('missing architectures, tampering, source mismatches and extra files prevent release', () => {
  for (const mutate of [
    directory => fs.unlinkSync(path.join(directory, 'receipt-darwin-aarch64.json')),
    directory => fs.appendFileSync(path.join(directory, 'OriaTunnel_0.1.0_x64-setup.exe'), 'tampered'),
    directory => fs.writeFileSync(path.join(directory, 'unexpected.txt'), 'extra'),
    directory => { const name = path.join(directory, 'receipt-windows-x86_64-nsis.json'); const receipt = JSON.parse(fs.readFileSync(name)); receipt.commit = 'b'.repeat(40); fs.writeFileSync(name, JSON.stringify(receipt)); },
    directory => { const name = path.join(directory, 'receipt-windows-x86_64-nsis.json'); const receipt = JSON.parse(fs.readFileSync(name)); receipt.updater = '../outside.exe'; fs.writeFileSync(name, JSON.stringify(receipt)); },
    directory => { const name = path.join(directory, 'receipt-windows-x86_64-nsis.json'); const receipt = JSON.parse(fs.readFileSync(name)); receipt.updater = 'OriaTunnel_0.1.0_arm64-setup.exe'; fs.writeFileSync(name, JSON.stringify(receipt)); },
  ]) {
    const directory = fixture();
    try { mutate(directory); assert.throws(() => validateAssets(directory, options)); }
    finally { fs.rmSync(directory, { recursive: true }); }
  }
});
test('release metadata rejects an unrelated tag and includes all four target triples', () => {
  const current = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
  assert.equal(releaseVersion(`v${current}`), current);
  assert.throws(() => releaseVersion(`v${current}-rc.1`), /Tag must/);
  assert.equal(matrix().length, 4);
});
