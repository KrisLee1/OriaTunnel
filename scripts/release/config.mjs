import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
export const root = fileURLToPath(new URL('../../', import.meta.url));
export const platforms = {
  'darwin-aarch64': { target: 'aarch64-apple-darwin', runner: 'macos-15', arch: 'aarch64', os: 'macos' },
  'darwin-x86_64': { target: 'x86_64-apple-darwin', runner: 'macos-15-intel', arch: 'x86_64', os: 'macos' },
  'windows-x86_64-nsis': { target: 'x86_64-pc-windows-msvc', runner: 'windows-2025', arch: 'x64', os: 'windows' },
  'windows-aarch64-nsis': { target: 'aarch64-pc-windows-msvc', runner: 'windows-11-arm', arch: 'arm64', os: 'windows' },
};
export function releaseVersion(tag) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  const tauri = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json')));
  const cargo = fs.readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8').match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  const lockedCargo = fs.readFileSync(path.join(root, 'src-tauri/Cargo.lock'), 'utf8').match(/name = "oria-tunnel"\r?\nversion = "([^"]+)"/)?.[1];
  const version = pkg.version;
  if (!/^\d+\.\d+\.\d+$/.test(version) || [tauri.version, cargo, lockedCargo].some(value => value !== version)) throw new Error('Stable version must agree in package.json, Cargo.toml, Cargo.lock and tauri.conf.json.');
  if (tag && tag !== `v${version}`) throw new Error(`Tag must be v${version}.`);
  if (!tauri.plugins?.updater?.requireSignedVersion) throw new Error('Version-bound updater signatures are required.');
  if (!tauri.plugins.updater.endpoints.includes('https://github.com/KrisLee1/OriaTunnel/releases/latest/download/latest.json')) throw new Error('Unexpected stable updater endpoint.');
  return version;
}
export function matrix() { return Object.entries(platforms).map(([platform, value]) => ({ platform, ...value })); }
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const version = releaseVersion(process.env.RELEASE_TAG);
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const lines = `version=${version}\ntag=v${version}\ncommit=${commit}\nmatrix=${JSON.stringify({ include: matrix() })}\n`;
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, lines);
    else console.log(lines.trim());
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
