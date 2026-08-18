// SERVIDOR LOCAL DO PRIMITIVAO
// Sobe o Firestore (emulador) na sua maquina, abre um tunel HTTPS publico e
// publica o endereco num gist que o site le. Enquanto isto roda, o site do
// GitHub Pages fala com ESTA maquina.
//
//   node scripts/servidor-local.mjs        (ou: npm run servidor)
//
// Ctrl+C encerra com cuidado: o emulador EXPORTA os dados antes de sair.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const GIST_ID   = process.env.PV_GIST_ID || '352e8949a15d0969adfaf92e5cc05d06';
const DATA_DIR  = 'emulator-data';
const PORT      = 8080;
const CLOUDFLARED = [
  'C:/Program Files (x86)/cloudflared/cloudflared.exe',
  'C:/Program Files/cloudflared/cloudflared.exe',
  'cloudflared',
].find(p => p === 'cloudflared' || existsSync(p)) || 'cloudflared';
const JAVA_BIN  = 'C:/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot/bin';

const log = (m) => console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${m}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const env = { ...process.env, PATH: `${process.env.PATH};${JAVA_BIN}` };
const filhos = [];

async function esperaPorta(url, tentativas = 60, rotulo = '') {
  let ultimo = '';
  for (let i = 0; i < tentativas; i++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(9000) }); if (r.status) return true; }
    catch (e) { ultimo = e.message; }
    if (rotulo && i && i % 15 === 0) log(`  ...esperando ${rotulo} (${i}s) — ${ultimo}`);
    await sleep(1000);
  }
  if (ultimo) log(`  ultimo erro em ${rotulo || url}: ${ultimo}`);
  return false;
}

// ─── 1. EMULADOR (com persistencia) ───────────────────────────────────────
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
  log(`${DATA_DIR}/ criado — primeira vez. Depois de subir, rode: npm run emu:seed`);
}
log('subindo o Firestore...');
const emu = spawn('cmd', ['/c', 'firebase', 'emulators:start', '--only', 'firestore',
  '--project', 'primitivao', '--import', DATA_DIR, '--export-on-exit', DATA_DIR],
  { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
filhos.push(emu);
emu.stdout.on('data', d => { const s = String(d); if (/error|Error/.test(s)) process.stdout.write(s); });
emu.stderr.on('data', d => process.stderr.write(String(d)));

if (!await esperaPorta(`http://127.0.0.1:${PORT}/`)) {
  console.error('o emulador nao subiu. Java instalado? firebase-tools instalado?');
  process.exit(1);
}
log(`Firestore de pe em 127.0.0.1:${PORT}`);

// ─── 2. TUNEL HTTPS ───────────────────────────────────────────────────────
log('abrindo o tunel...');
const tun = spawn(CLOUDFLARED, ['tunnel', '--url', `http://127.0.0.1:${PORT}`, '--no-autoupdate'],
  { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
filhos.push(tun);

let host = null;
const achaUrl = (buf) => {
  const m = String(buf).match(/https:\/\/([a-z0-9-]+\.trycloudflare\.com)/);
  if (m && !host) { host = m[1]; }
};
tun.stdout.on('data', achaUrl);
tun.stderr.on('data', achaUrl);

for (let i = 0; i < 40 && !host; i++) await sleep(1000);
if (!host) { console.error('o tunel nao devolveu URL'); await encerra(1); }
log(`tunel: https://${host}`);

// o tunel leva alguns segundos pra propagar; bate num doc de verdade
log('esperando o Cloudflare rotear (leva ~30s)...');
await sleep(12000);
if (!await esperaPorta(`https://${host}/`, 90, 'o tunel')) {
  console.error('o tunel subiu mas nao responde em ' + host);
  await encerra(1);
}
log('tunel respondendo');

// ─── 3. PUBLICA O ENDERECO ────────────────────────────────────────────────
const payload = { host, ssl: true, atualizadoEm: new Date().toISOString() };
writeFileSync('server.json', JSON.stringify(payload, null, 2));
try {
  execFileSync('gh', ['gist', 'edit', GIST_ID, '-a', 'server.json'], { stdio: 'pipe' });
  log('endereco publicado no gist — o site ja aponta pra ca');
} catch (e) {
  console.error('nao consegui publicar no gist:', String(e.message).slice(0, 200));
  console.error('o site NAO vai achar este servidor ate isso funcionar.');
}

console.log(`
────────────────────────────────────────────────
  SERVIDOR DO PRIMITIVAO NO AR
  banco:  127.0.0.1:${PORT}   (dados em ${DATA_DIR}/)
  tunel:  https://${host}
  site:   https://baneplayss.github.io/primitivao/apostas/

  Deixe esta janela ABERTA. Ctrl+C encerra salvando os dados.
────────────────────────────────────────────────
`);

// ─── encerramento limpo (o emulador exporta ao sair) ──────────────────────
async function encerra(code = 0) {
  log('encerrando (salvando os dados)...');
  for (const c of filhos) { try { c.kill('SIGINT'); } catch {} }
  await sleep(8000);
  process.exit(code);   // nunca retorna — o fluxo para aqui de verdade
}
process.on('SIGINT', () => encerra(0));
process.on('SIGTERM', () => encerra(0));
setInterval(() => {}, 1 << 30); // segura o processo
