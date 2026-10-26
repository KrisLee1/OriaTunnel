import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { releaseVersion, platforms, matrix, root } from './config.mjs';
import { assertDraftSource, selectRelease, validateAssets, readReleaseNotes } from './publish.mjs';
import { sha256 } from './collect.mjs';
const commit = 'a'.repeat(40);
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oria-release-test-'));
  for (const [platform, spec] of Object.entries(platforms)) {
    const updater = spec.os === 'macos' ? `OriaTunnel_0.1.0_${spec.arch}.app.tar.gz` : `OriaTunnel_0.1.0_${spec.arch}-setup.exe`;
    const names = [updater, `${updater}.sig`];
    if (spec.os === 'macos') names.push(`OriaTunnel_0.1.0_${spec.arch === 'aarch64' ? 'aarch64' : 'x64'}.dmg`, `OriaTunnel_0.1.0_${spec.arch === 'aarch64' ? 'aarch64' : 'x64'}.zip`);
    for (const name of names) fs.writeFileSync(path.join(directory, name), `public-test-content-${name}`);
    const receipt = { platform, version: '0.1.0', target: spec.target, commit, licenseSha256: sha256(path.join(root, 'LICENSE')), updater, signature: fs.readFileSync(path.join(directory, `${updater}.sig`), 'utf8'), assets: names.map(name => ({ name, size: fs.statSync(path.join(directory, name)).size, sha256: sha256(path.join(directory, name)) })) };
    fs.writeFileSync(path.join(directory, `receipt-${platform}.json`), JSON.stringify(receipt));
  }
  return directory;
}
const options = { version: '0.1.0', commit, verify: false };
test('curated release notes preserve the supplied text and reject empty or unsafe versions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oria-release-notes-'));
  try {
    assert.equal(readReleaseNotes('0.1.1', directory), undefined);
    const content = '## 更新日志\n\n- 新增 D 转发打开代理浏览器和直接访问远程服务的入口；\n';
    fs.writeFileSync(path.join(directory, 'v0.1.1.md'), content);
    assert.equal(readReleaseNotes('0.1.1', directory), content.trim());
    fs.writeFileSync(path.join(directory, 'v0.1.1.md'), ' \n');
    assert.throws(() => readReleaseNotes('0.1.1', directory), /empty/);
    assert.throws(() => readReleaseNotes('../outside', directory), /Invalid/);
  } finally { fs.rmSync(directory, { recursive: true }); }
});
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
    directory => { const name = path.join(directory, 'receipt-windows-x86_64-nsis.json'); const receipt = JSON.parse(fs.readFileSync(name)); receipt.licenseSha256 = '0'.repeat(64); fs.writeFileSync(name, JSON.stringify(receipt)); },
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
test('draft replacement requires the exact old source and a forward-only descendant', async () => {
  const previous = 'b'.repeat(40);
  const release = { draft: true, prerelease: false, target_commitish: previous, body: `<!-- oria-release-commit:${previous} -->` };
  let comparisons = 0;
  const github = { rest: { repos: { compareCommitsWithBasehead: async ({ basehead }) => {
    comparisons++;
    assert.equal(basehead, `${previous}...${commit}`);
    return { data: { status: 'ahead', merge_base_commit: { sha: previous } } };
  } } } };
  await assert.rejects(assertDraftSource(github, release, commit));
  await assert.rejects(assertDraftSource(github, release, commit, 'c'.repeat(40)));
  await assert.rejects(assertDraftSource(github, { ...release, draft: false }, commit, previous));
  await assert.rejects(assertDraftSource(github, { ...release, prerelease: true }, commit, previous));
  await assert.rejects(assertDraftSource(github, { ...release, body: '' }, commit, previous));
  assert.equal(comparisons, 0);
  await assertDraftSource(github, release, previous);
  await assertDraftSource(github, release, commit, previous);
  assert.equal(comparisons, 1);
  for (const data of [{ status: 'behind', merge_base_commit: { sha: commit } }, { status: 'diverged', merge_base_commit: { sha: 'c'.repeat(40) } }, { status: 'ahead', merge_base_commit: { sha: 'c'.repeat(40) } }]) {
    const differentHistory = { rest: { repos: { compareCommitsWithBasehead: async () => ({ data }) } } };
    await assert.rejects(assertDraftSource(differentHistory, release, commit, previous));
  }
});
test('placeholder drafts require a unique version name and source marker before final tagging', () => {
  const draft = { id: 1, tag_name: 'untagged-d2e4021fb24f66bc2dbb', name: 'OriaTunnel 0.1.0', draft: true, prerelease: false, body: `<!-- oria-release-commit:${commit} -->` };
  assert.equal(selectRelease([draft], 'v0.1.0'), draft);
  assert.equal(selectRelease([draft], 'v0.2.0'), undefined);
  for (const patch of [{ draft: false }, { prerelease: true }, { body: '' }, { tag_name: 'v0.2.0' }]) assert.equal(selectRelease([{ ...draft, ...patch }], 'v0.1.0'), undefined);
  assert.throws(() => selectRelease([draft, { ...draft, id: 2 }], 'v0.1.0'));
  const tagged = { ...draft, id: 3, tag_name: 'v0.1.0' };
  assert.equal(selectRelease([draft, tagged], 'v0.1.0'), tagged);
  assert.throws(() => selectRelease([tagged, { ...tagged, id: 4 }], 'v0.1.0'));
});
