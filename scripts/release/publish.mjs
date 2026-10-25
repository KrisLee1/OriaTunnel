import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { platforms, releaseVersion, root } from './config.mjs';
import { sha256 } from './collect.mjs';
import { buildVerifier, run, signingEnvironment } from '../check-update-secrets.mjs';
const owner = 'KrisLee1';
const repo = 'OriaTunnel';
const safeName = name => typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name);
export function validateAssets(directory, { version, commit, verifier, verify = true }) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Release source must be a full commit SHA.');
  const files = [];
  const manifest = { version, notes: '', pub_date: new Date().toISOString(), platforms: {} };
  const names = new Set();
  for (const [platform, spec] of Object.entries(platforms)) {
    const receipt = JSON.parse(fs.readFileSync(path.join(directory, `receipt-${platform}.json`), 'utf8'));
    if (receipt.platform !== platform || receipt.target !== spec.target || receipt.version !== version || receipt.commit !== commit) throw new Error(`Mismatched receipt: ${platform}.`);
    const updaterName = spec.os === 'macos' ? `OriaTunnel_${version}_${spec.arch}.app.tar.gz` : `OriaTunnel_${version}_${spec.arch}-setup.exe`;
    if (receipt.updater !== updaterName) throw new Error('Invalid updater artifact name or architecture.');
    if (!Array.isArray(receipt.assets) || receipt.assets.length !== (spec.os === 'macos' ? 4 : 2)) throw new Error('Missing platform release assets.');
    for (const asset of receipt.assets) {
      if (!safeName(asset.name) || names.has(asset.name)) throw new Error('Unsafe or duplicate release asset.');
      const file = path.join(directory, asset.name);
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.size !== asset.size || sha256(file) !== asset.sha256) throw new Error(`Asset integrity check failed: ${asset.name}.`);
      names.add(asset.name); files.push(file);
    }
    if (!names.has(receipt.updater) || !names.has(`${receipt.updater}.sig`)) throw new Error('Updater artifact or detached signature is missing.');
    const signature = fs.readFileSync(path.join(directory, `${receipt.updater}.sig`), 'utf8').trim();
    if (signature !== receipt.signature || !signature) throw new Error('Updater signature differs from its receipt.');
    if (verify) run(verifier, ['--config', path.join(root, 'src-tauri/tauri.conf.json'), '--artifact', path.join(directory, receipt.updater), '--signature', path.join(directory, `${receipt.updater}.sig`), '--version', version, '--require-filename']);
    manifest.platforms[platform] = { signature, url: `https://github.com/${owner}/${repo}/releases/download/v${version}/${encodeURIComponent(receipt.updater)}` };
    files.push(path.join(directory, `receipt-${platform}.json`));
  }
  const expected = new Set(files.map(file => path.basename(file)));
  const extra = fs.readdirSync(directory).filter(name => !expected.has(name));
  if (extra.length) throw new Error('Unexpected files in the release asset directory.');
  return { files, manifest };
}
function compareVersion(a, b) {
  const left = a.split('.').map(Number); const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}
async function ensureNewer(github, version) {
  const releases = await github.paginate(github.rest.repos.listReleases, { owner, repo, per_page: 100 });
  for (const release of releases) {
    if (!release.draft && !release.prerelease && /^v\d+\.\d+\.\d+$/.test(release.tag_name) && compareVersion(version, release.tag_name.slice(1)) <= 0) throw new Error('A stable release with this or a newer version already exists. Published assets are immutable.');
  }
}
async function releaseForTag(github, tag) {
  const releases = await github.paginate(github.rest.repos.listReleases, { owner, repo, per_page: 100 });
  return releases.find(release => release.tag_name === tag);
}
async function assertTagSource(github, tag, commit) {
  try {
    let { data: ref } = await github.rest.git.getRef({ owner, repo, ref: `tags/${tag}` });
    let object = ref.object;
    for (let depth = 0; object.type === 'tag' && depth < 5; depth++) object = (await github.rest.git.getTag({ owner, repo, tag_sha: object.sha })).data.object;
    if (object.type !== 'commit' || object.sha !== commit) throw new Error('The version tag points to a different source commit.');
  } catch (error) { if (error.status !== 404) throw error; }
}
export async function createDraft({ github, context, core }) {
  if (context.repo.owner !== owner || context.repo.repo !== repo) throw new Error('Unexpected release repository.');
  const version = releaseVersion(process.env.RELEASE_TAG);
  const commit = process.env.RELEASE_COMMIT;
  const directory = path.resolve(process.env.RELEASE_DIRECTORY || 'outputs/release-download');
  const verifier = buildVerifier(signingEnvironment().clean);
  const { files, manifest } = validateAssets(directory, { version, commit, verifier });
  await ensureNewer(github, version);
  await assertTagSource(github, `v${version}`, commit);
  let release = await releaseForTag(github, `v${version}`);
  if (release && (!release.draft || release.target_commitish !== commit)) throw new Error('Only a draft for this exact commit can be updated.');
  const notes = await github.rest.repos.generateReleaseNotes({ owner, repo, tag_name: `v${version}`, target_commitish: commit });
  manifest.notes = notes.data.body;
  const body = `${notes.data.body}\n\n<!-- oria-release-commit:${commit} -->\n\nWindows: download the matching NSIS installer. macOS: download the matching DMG or DMG ZIP.\nThe app downloads its architecture-specific signed updater automatically.\n`;
  if (!release) release = (await github.rest.repos.createRelease({ owner, repo, tag_name: `v${version}`, target_commitish: commit, name: `OriaTunnel ${version}`, body, draft: true, prerelease: false, make_latest: 'false' })).data;
  else release = (await github.rest.repos.updateRelease({ owner, repo, release_id: release.id, body })).data;
  const oldAssets = await github.paginate(github.rest.repos.listReleaseAssets, { owner, repo, release_id: release.id, per_page: 100 });
  // Draft-only retries replace their assets; published releases never reach here.
  for (const asset of oldAssets) await github.rest.repos.deleteReleaseAsset({ owner, repo, asset_id: asset.id });
  for (const file of files) await github.rest.repos.uploadReleaseAsset({ owner, repo, release_id: release.id, name: path.basename(file), data: fs.readFileSync(file), headers: { 'content-type': 'application/octet-stream' } });
  await github.rest.repos.uploadReleaseAsset({ owner, repo, release_id: release.id, name: 'latest.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), headers: { 'content-type': 'application/json' } });
  const uploaded = await github.paginate(github.rest.repos.listReleaseAssets, { owner, repo, release_id: release.id, per_page: 100 });
  if (uploaded.length !== files.length + 1 || !uploaded.some(asset => asset.name === 'latest.json')) throw new Error('Draft asset upload is incomplete.');
  core.setOutput('release_url', release.html_url);
  await core.summary.addHeading(`Draft ready: v${version}`).addLink('Review the release', release.html_url).addRaw('\nAll four architectures and detached signatures were verified. Publishing is a separate workflow.').write();
}
export async function publishDraft({ github, context, core }) {
  if (context.repo.owner !== owner || context.repo.repo !== repo) throw new Error('Unexpected release repository.');
  const tag = process.env.RELEASE_TAG;
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag || '')) throw new Error('Provide a stable vX.Y.Z release tag.');
  const version = tag.slice(1);
  await ensureNewer(github, version);
  const release = await releaseForTag(github, tag);
  if (!release?.draft || release.prerelease) throw new Error('A complete stable draft is required.');
  const commit = release.body?.match(/<!-- oria-release-commit:([0-9a-f]{40}) -->/)?.[1];
  if (!commit || release.target_commitish !== commit) throw new Error('Draft source commit is missing or mismatched.');
  await assertTagSource(github, tag, commit);
  const assets = await github.paginate(github.rest.repos.listReleaseAssets, { owner, repo, release_id: release.id, per_page: 100 });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oria-release-verify-'));
  try {
    for (const asset of assets) {
      if (!safeName(asset.name) || asset.size > 512 * 1024 * 1024) throw new Error('Unsafe release asset.');
      const download = await github.rest.repos.getReleaseAsset({ owner, repo, asset_id: asset.id, headers: { accept: 'application/octet-stream' } });
      fs.writeFileSync(path.join(directory, asset.name), Buffer.from(download.data));
    }
    const manifestPath = path.join(directory, 'latest.json');
    const actual = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    fs.unlinkSync(manifestPath);
    const verifier = buildVerifier(signingEnvironment().clean);
    const { manifest: expected } = validateAssets(directory, { version, commit, verifier });
    if (actual.version !== expected.version || JSON.stringify(actual.platforms) !== JSON.stringify(expected.platforms) || !Number.isFinite(Date.parse(actual.pub_date))) throw new Error('Draft latest.json does not match its verified assets.');
    const published = (await github.rest.repos.updateRelease({ owner, repo, release_id: release.id, draft: false, prerelease: false, make_latest: 'true' })).data;
    core.setOutput('release_url', published.html_url);
    await core.summary.addHeading(`Published ${tag}`).addLink('Release', published.html_url).addLink('Updater endpoint', `https://github.com/${owner}/${repo}/releases/latest/download/latest.json`).write();
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
