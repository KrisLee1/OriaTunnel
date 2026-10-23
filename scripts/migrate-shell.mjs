// One-time, reproducible migration from the user-designated sibling project.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const source = path.resolve('../OriaAide/src');
const overrides = new Set(['lib/bridge', 'types', 'stores/floating-aide-store']);
const roots = ['components/window/window-header','components/window/window-control',
 'components/theme/aide-theme-provider','components/theme/theme-bootstrap','components/theme/theme-select',
 'components/theme/theme-mode-toggle','components/theme/theme-import-setting','components/settings/window-appearance-setting',
 'components/settings/window-control-setting','components/language/language-select','lib/keyboard-focus','i18n',
 'components/ui/input','components/ui/dialog','components/ui/tooltip','components/ui/scroll-area',
 'components/ui/external-link','components/ui/info-tooltip'];
const copied = new Map();
function copy(id) {
 if (overrides.has(id) || copied.has(id)) return;
 const ext = ['.tsx','.ts','.json'].find(ext => fs.existsSync(path.join(source,id+ext)));
 if (!ext) throw new Error(`Missing migration dependency ${id}`);
 const raw = fs.readFileSync(path.join(source,id+ext),'utf8');
 copied.set(id,{ file: id+ext, sha256:crypto.createHash('sha256').update(raw).digest('hex') });
 let content=raw.replaceAll('oria-aide-','oria-tunnel-').replaceAll('aide://theme','tunnel://theme').replaceAll('aide:theme','tunnel:theme').replaceAll('"i18nextLng"','"oria-tunnel-language"');
 if(id==='components/window/window-control') {
  content=content.replace('import { useFloatingAideStore } from "@/stores/floating-aide-store"','');
  content=content.replace(/export function closeWindow\(\) \{[\s\S]*?\n\}/, 'export function closeWindow() {\n  return isDesktopRuntime() ? getCurrentWindow().close() : Promise.resolve()\n}');
 }
 fs.mkdirSync(path.dirname('src/'+id+ext),{recursive:true}); fs.writeFileSync('src/'+id+ext,content);
 for(const match of raw.matchAll(/from\s+["']@\/([^"']+)["']/g)) copy(match[1].replace(/\.json$/,''));
}
roots.forEach(copy);
const css=fs.readFileSync(path.join(source,'styles/globals.css'),'utf8').split('\n');
let selected=[css.slice(0,133).join('\n'),css.slice(1020,1063).join('\n'),css.slice(1320-1,1405).join('\n')].join('\n').replace('\n.aide-presence {\n','\n');
const cssSelectors = ['.window-muted-surface','.settings-section-panel','[data-slot="tabs-list"][data-variant="default"] > .window-tab-trigger[data-active]','.aide-theme-palette','.aide-theme-palette i',...Array.from({length:5},(_,i)=>`.aide-theme-palette i:nth-child(${i+1})`),'@layer base'];
const rawCss = css.join('\n');
for (const selector of cssSelectors) {
 const start = rawCss.indexOf(selector+' {');
 if(start < 0) throw new Error(`Missing source CSS: ${selector}`);
 const open=rawCss.indexOf('{',start); let depth=1,end=open+1;
 for(;end<rawCss.length && depth;end++){if(rawCss[end]==='{') depth++; if(rawCss[end]==='}')depth--;}
 selected += '\n'+rawCss.slice(start,end)+'\n';
}
fs.mkdirSync('src/styles',{recursive:true});fs.writeFileSync('src/styles/globals.css',selected);
fs.writeFileSync('docs/shell-migration.json',JSON.stringify({source:'D:/Projects/OriaAide',files:[...copied.values()],cssRanges:['1-133','1021-1063','1320-1405'],cssSelectors,adaptations:['Application storage/event namespace','Window close removes Aide avatar dependency','Bridge/types supplied by OriaTunnel','Interactive center slot added after migration']},null,2));
console.log(`Migrated ${copied.size} source files`);
