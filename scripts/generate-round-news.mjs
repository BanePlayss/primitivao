// Gera a NOTÍCIA da rodada AUTOMATICAMENTE a partir dos dados (classificação +
// resultados) e publica no site (campo `news` do doc primitivao/apostas) e,
// opcionalmente, no Discord. Pensado pra rodar sozinho (GitHub Action
// `round-news.yml`) ou na mão. Sem service account: usa o Web SDK (o doc é de
// leitura pública e a escrita de `news` com merge passa nas regras).
//
// Uso:
//   node scripts/generate-round-news.mjs            -> última rodada COMPLETA, publica no site
//   node scripts/generate-round-news.mjs 3          -> rodada 3 (pra backfill 01..06; --force implícito)
//   node scripts/generate-round-news.mjs --dry      -> só imprime, não escreve nada
//   node scripts/generate-round-news.mjs --discord  -> também posta no Discord
//   node scripts/generate-round-news.mjs --force    -> regera mesmo se a notícia já existir

import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyB4Tu-OIAfBUfzdtY-wF9tSoBwP_36hdRg',
  authDomain: 'primitivao.firebaseapp.com',
  projectId: 'primitivao',
  storageBucket: 'primitivao.firebasestorage.app',
  messagingSenderId: '279022752580',
  appId: '1:279022752580:web:e5f467d6e2e83bc6cc7d11',
};

const SITE = 'https://baneplayss.github.io/primitivao/apostas/';
const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const roundArg = args.find(a => /^\d+$/.test(a));
const DRY = flags.has('--dry');
const DISCORD = flags.has('--discord');
const FORCE = flags.has('--force') || !!roundArg;

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const [stateSnap, betSnap] = await Promise.all([
  getDoc(doc(db, 'primitivao', 'state')),
  getDoc(doc(db, 'primitivao', 'apostas')),
]);
if (!stateSnap.exists()) { console.error('Doc primitivao/state não existe.'); process.exit(1); }
const cs = JSON.parse(stateSnap.data().json || '{}');
const rounds = Array.isArray(cs.rounds) ? cs.rounds : [];
const apostas = betSnap.exists() ? betSnap.data() : {};
const existingNews = Array.isArray(apostas.news) ? apostas.news : [];

const name = (id) => (id ? id[0].toUpperCase() + id.slice(1) : '?');
const isPlayed = (g) => g && g.gh !== '' && g.ga !== '' && !Number.isNaN(parseInt(g.gh, 10)) && !Number.isNaN(parseInt(g.ga, 10));
const sgOf = (s) => (s.gp - s.gc >= 0 ? '+' : '') + (s.gp - s.gc);

// Classificação acumulada até a rodada `upTo` (1-based; inclusive).
function standings(upTo) {
  const t = {};
  const e = (id) => t[id] || (t[id] = { id, p: 0, v: 0, emp: 0, d: 0, gp: 0, gc: 0, j: 0 });
  const lim = upTo != null ? upTo : rounds.length;
  for (let ri = 0; ri < lim; ri++) {
    for (const g of (rounds[ri] || [])) {
      if (!isPlayed(g)) continue;
      const gh = +g.gh, ga = +g.ga, H = e(g.home), A = e(g.away);
      H.j++; A.j++; H.gp += gh; H.gc += ga; A.gp += ga; A.gc += gh;
      if (gh > ga) { H.v++; A.d++; H.p += 3; }
      else if (ga > gh) { A.v++; H.d++; A.p += 3; }
      else { H.emp++; A.emp++; H.p++; A.p++; }
    }
  }
  return Object.values(t).sort((a, b) => b.p - a.p || (b.gp - b.gc) - (a.gp - a.gc) || b.gp - a.gp);
}

function lastCompleteRound() {
  for (let i = rounds.length - 1; i >= 0; i--) { const r = rounds[i] || []; if (r.length && r.every(isPlayed)) return i + 1; }
  for (let i = rounds.length - 1; i >= 0; i--) { if ((rounds[i] || []).some(isPlayed)) return i + 1; }
  return 0;
}

const R = roundArg ? parseInt(roundArg, 10) : lastCompleteRound();
if (!R || R < 1 || R > rounds.length) { console.error('Rodada inválida: ' + R); process.exit(1); }

const roundGames = (rounds[R - 1] || []).filter(isPlayed);
if (roundGames.length === 0) { console.error('Rodada ' + R + ' não tem resultados lançados.'); process.exit(1); }

const newsId = 'auto-rodada-' + R;
if (!FORCE && existingNews.some(n => n.id === newsId)) {
  console.log('Notícia da rodada ' + R + ' já existe. (use --force pra regerar). Nada a fazer.');
  process.exit(0);
}

const RR = String(R).padStart(2, '0');
const tbl = standings(R);
const leader = tbl[0], lanterna = tbl[tbl.length - 1];
const allClosed = (rounds[R - 1] || []).length > 0 && (rounds[R - 1] || []).every(isPlayed);

// Maior goleada da rodada.
const byMargin = roundGames.slice().sort((a, b) => Math.abs(+b.gh - +b.ga) - Math.abs(+a.gh - +a.ga));
const gl = byMargin[0];
const glWin = (+gl.gh > +gl.ga) ? gl.home : gl.away;
const glLose = (+gl.gh > +gl.ga) ? gl.away : gl.home;
const glHi = Math.max(+gl.gh, +gl.ga), glLo = Math.min(+gl.gh, +gl.ga);

const resultLines = roundGames.map(g => {
  const draw = +g.gh === +g.ga;
  const win = draw ? null : (+g.gh > +g.ga ? name(g.home) : name(g.away));
  return `- **${name(g.home)} ${g.gh} x ${g.ga} ${name(g.away)}**` + (draw ? ' — ficou no empate, ninguém quis ganhar.' : ` — ${win} levou.`);
});

const secondClause = leader.id === glWin
  ? ` E AINDA ${glHi}x${glLo} NO ${name(glLose).toUpperCase()}`
  : `, ${name(glWin).toUpperCase()} ATROPELA`;
const title = `RODADA ${RR}: ${name(leader.id).toUpperCase()} NA PONTA${secondClause}`;
const subtitle = `Resultados, classificação e a zoeira da rodada ${RR}. ${name(glLose)} levou ${glHi}x${glLo} e a tabela mexeu.`;

const body = [
  `**A RODADA ${RR} ${allClosed ? 'FECHOU' : 'ROLOU'} E DEU PANO PRA MANGA!**`,
  '',
  '**RESULTADOS**',
  ...resultLines,
  '',
  '**O QUE A TABELA DIZ**',
  `- **NA PONTA:** ${name(leader.id)} lidera com **${leader.p} pts** (${leader.v}V ${leader.emp}E ${leader.d}D, saldo ${sgOf(leader)}). O resto que corra atrás.`,
  `- **NA LANTERNA:** ${name(lanterna.id)} no fundo do poço com ${lanterna.p} pts (saldo ${sgOf(lanterna)}). Vexame moldurado.`,
  `- **MASSACRE DA RODADA:** ${name(glWin)} ${glHi}x${glLo} ${name(glLose)}. Foi covardia, chama o SAMU.`,
  '',
  `**CLASSIFICAÇÃO (após a rodada ${RR})**`,
  ...tbl.map((s, i) => `${i + 1}. **${name(s.id)}** — ${s.p} pts (${s.v}-${s.emp}-${s.d}, saldo ${sgOf(s)})`),
  '',
  `Próxima rodada já vem aí. Monta teu cupom: ${SITE}`,
].join('\n');

const item = {
  id: newsId, title, subtitle, tag: `RODADA ${RR}`,
  date: new Date().toLocaleDateString('pt-BR'), image: '', body, at: Date.now(),
};

console.log('================ NOTÍCIA GERADA (rodada ' + R + ') ================');
console.log(title);
console.log(subtitle);
console.log('------------------------------------------------------------');
console.log(body);
console.log('============================================================');

if (DRY) { console.log('\n[--dry] Nada foi escrito.'); process.exit(0); }

const updatedNews = [item, ...existingNews.filter(n => n.id !== newsId)];
await setDoc(doc(db, 'primitivao', 'apostas'), { news: updatedNews }, { merge: true });
console.log('\n✓ Publicada no site (campo news).');

if (DISCORD) {
  const webhook = apostas.discord_webhook;
  if (webhook && String(webhook).startsWith('https://discord.com/api/webhooks/')) {
    const dMsg = [
      `**${title}**`, subtitle, '', ...resultLines, '',
      `${name(leader.id)} lidera com ${leader.p} pts. Tabela e zoeira completa no site:`, SITE,
    ].join('\n').slice(0, 1900);
    try {
      const res = await fetch(webhook, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: dMsg, username: 'Primitivão Times' }),
      });
      console.log(res.ok ? '✓ Postada no Discord.' : ('✗ Discord HTTP ' + res.status + ': ' + (await res.text()).slice(0, 200)));
    } catch (e) { console.warn('✗ Falha no Discord:', e.message); }
  } else {
    console.log('(sem webhook do Discord configurado — pulei o post)');
  }
}
process.exit(0);
