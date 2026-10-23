// Derived only from the user-supplied Icon Composer exports, using Tauri's renderer.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const icons = path.join(root, 'src-tauri/icons');
const cli = path.join(root, 'node_modules/@tauri-apps/cli/tauri.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'oria-tunnel-icons-'));
const desktopFiles = ['32x32.png', '64x64.png', '128x128.png', '128x128@2x.png',
  'icon.png', 'icon.ico', 'icon.icns', 'StoreLogo.png', 'Square30x30Logo.png',
  'Square44x44Logo.png', 'Square71x71Logo.png', 'Square89x89Logo.png',
  'Square107x107Logo.png', 'Square142x142Logo.png', 'Square150x150Logo.png',
  'Square284x284Logo.png', 'Square310x310Logo.png'];
function render(input, output, extra = []) {
  execFileSync(process.execPath, [cli, 'icon', input, '--output', output, ...extra],
    { cwd: root, stdio: 'pipe' });
}
try {
  const installer = path.join(temp, 'installer');
  render(path.join(icons, 'OriaTunnelInstaller.svg'), installer);
  for (const extension of ['png', 'ico', 'icns']) {
    fs.copyFileSync(path.join(installer, `icon.${extension}`), path.join(icons, `installer-icon.${extension}`));
  }
  for (const [variant, appearance] of [['light', 'Default'], ['dark', 'Dark'], ['mono', 'ClearDark']]) {
    const master = path.join(icons, `OriaTunnelIconExports/OriaTunnelIcon-iOS-${appearance}-1024@1x.png`);
    const output = path.join(temp, variant);
    render(master, output);
    if (variant === 'light') {
      for (const name of desktopFiles) fs.copyFileSync(path.join(output, name), path.join(icons, name));
    }
    fs.copyFileSync(path.join(output, 'icon.png'), path.join(icons, `windows-taskbar-${variant}.png`));
    fs.copyFileSync(path.join(output, 'icon.ico'), path.join(icons, `windows-taskbar-${variant}.ico`));
    // Match OriaAide's 864px content on a 1024px transparent Dock canvas.
    const padded = path.join(temp, `${variant}.svg`);
    fs.writeFileSync(padded, `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="1024"><image x="80" y="80" width="864" height="864" xlink:href="data:image/png;base64,${fs.readFileSync(master).toString('base64')}"/></svg>`);
    const runtime = path.join(temp, `runtime-${variant}`);
    render(padded, runtime, ['--png', '1024']);
    fs.copyFileSync(path.join(runtime, '1024x1024.png'), path.join(icons, `runtime-icon-${variant}.png`));
  }
  // The approved transparent vector is the tray master; crop excess canvas
  // while retaining 20 source units of clear space around the outer nodes.
  const traySource = fs.readFileSync(path.join(icons, 'tray-source.svg'), 'utf8')
    .replace('viewBox="0 0 1024 1024"', 'viewBox="164 164 696 696"');
  for (const [kind, size] of [['windows', 32], ['macos', 36]]) {
    const svg = kind === 'macos' ? traySource.replace(/fill="url\(#[^)]+\)"/g, 'fill="#000000"') : traySource;
    const input = path.join(temp, `${kind}-tray.svg`);
    const output = path.join(temp, `${kind}-tray`);
    fs.writeFileSync(input, svg);
    render(input, output, ['--png', String(size)]);
    fs.copyFileSync(path.join(output, `${size}x${size}.png`), path.join(icons, `${kind}-tray-icon.png`));
  }
  console.log('Generated installer, application, taskbar, Dock and tray icons from their dedicated masters.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
