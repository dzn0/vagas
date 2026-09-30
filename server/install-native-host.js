// Registra o host de native messaging para o usuário atual (HKCU, sem admin).
// Uso: node install-native-host.js [id-da-extensão]   |   node install-native-host.js --uninstall
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(here);
const HOST_NAME = 'com.vagas.banco';
const REGISTRY_KEYS = [
  `HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${HOST_NAME}`,
  `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
  `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`,
];
const manifestPath = path.join(here, `${HOST_NAME}.json`);
const launcherPath = path.join(here, 'native-host.cmd');

if (process.argv.includes('--uninstall')) {
  for (const key of REGISTRY_KEYS) {
    try { execFileSync('reg', ['delete', key, '/f'], { stdio: 'ignore' }); } catch {}
  }
  for (const f of [manifestPath, launcherPath]) fs.rmSync(f, { force: true });
  console.log('Início automático removido.');
  process.exit(0);
}

// Extensões descompactadas ganham um ID derivado do caminho da pasta; procuramos nos perfis do navegador.
function findExtensionIds() {
  const local = process.env.LOCALAPPDATA;
  const userDataDirs = [
    path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'),
    path.join(local, 'Google', 'Chrome', 'User Data'),
    path.join(local, 'Microsoft', 'Edge', 'User Data'),
  ];
  const ids = new Set();
  for (const dir of userDataDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const profile of fs.readdirSync(dir)) {
      const prefs = path.join(dir, profile, 'Secure Preferences');
      if (!fs.existsSync(prefs)) continue;
      try {
        const settings = JSON.parse(fs.readFileSync(prefs, 'utf8')).extensions?.settings ?? {};
        for (const [id, ext] of Object.entries(settings)) {
          if (ext.path && path.resolve(ext.path).toLowerCase() === projectDir.toLowerCase()) ids.add(id);
        }
      } catch {}
    }
  }
  return [...ids];
}

const argId = process.argv.slice(2).find((a) => /^[a-p]{32}$/.test(a));
const ids = argId ? [argId] : findExtensionIds();
if (!ids.length) {
  console.error('Não achei a extensão carregada a partir de', projectDir);
  console.error('Carregue-a em brave://extensions e rode de novo, ou passe o ID: node install-native-host.js <id>');
  process.exit(1);
}

fs.writeFileSync(launcherPath, `@echo off\r\n"${process.execPath}" "%~dp0native-host.js" %*\r\n`);
fs.writeFileSync(manifestPath, JSON.stringify({
  name: HOST_NAME,
  description: 'Inicia o banco de vagas local',
  path: launcherPath,
  type: 'stdio',
  allowed_origins: ids.map((id) => `chrome-extension://${id}/`),
}, null, 2));

for (const key of REGISTRY_KEYS) {
  execFileSync('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], { stdio: 'ignore' });
}
console.log(`Início automático instalado para a(s) extensão(ões): ${ids.join(', ')}`);
console.log('Recarregue a extensão e abra o painel: o banco sobe sozinho.');
