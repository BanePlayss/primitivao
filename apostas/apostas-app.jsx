// Apostas — single file React app.
// Persiste em Firestore (compartilhado entre todos os dispositivos).
// - primitivao/apostas : users, fixtures, bets (cupons parlay)
// - primitivao/state   : classificação (mesmo doc do site antigo — dados mantidos)
// Sessão (quem está logado neste navegador) fica em localStorage.

const { useState, useEffect, useMemo, useRef } = React;

// ─── DADOS BASE ─────────────────────────────────────────────────────────────
const TEAMS = [
  { id: 'bane',    name: 'Bane',    short: 'BAN', color: '#1c1612' },
  { id: 'mohamed', name: 'Mohamed', short: 'MOH', color: '#c75418' },
  { id: 'potato',  name: 'Potato',  short: 'PTT', color: '#8b3a14' },
  { id: 'magreza', name: 'Magreza', short: 'MGR', color: '#2a201a' },
  { id: 'celin',   name: 'Celin',   short: 'CEL', color: '#e8800f' },
  { id: 'juca',    name: 'Juca',    short: 'JUC', color: '#d63c0a' },
  { id: 'caco',    name: 'Caco',    short: 'CAC', color: '#4a3020' },
  { id: 'vitinho', name: 'Vitinho', short: 'VIT', color: '#6e4824' },
];
const TEAM = (id) => TEAMS.find(t => t.id === id) || TEAMS[0];

const ADMIN_NICK = 'admin';
const ADMIN_PASS = 'primitivaoseguro';

// ─── CAMPEONATOS ────────────────────────────────────────────────────────────
// Por enquanto só FIFA está ativo. MK e RL aceitam só inscrições de interesse.
const CHAMPIONSHIPS = [
  { id: 'fifa', name: 'Primitivão — FIFA 2026',                  season: 'Season 1', tag: 'FIFA', status: 'active' },
  { id: 'mk',   name: 'Primitivão — Mortal Kombat 2026',         season: 'Season 1', tag: 'MK',   status: 'soon'   },
  { id: 'rl',   name: 'Primitivão — Rocket League 2026',         season: 'Season 1', tag: 'RL',   status: 'soon'   },
  { id: 'lol',  name: 'Primitivão — League of Legends 2026',     season: 'Season 1', tag: 'LoL',  status: 'soon'   },
  { id: 'cs',   name: 'Primitivão — Counter-Strike 2026',        season: 'Season 1', tag: 'CS',   status: 'soon'   },
  { id: 'gwyf', name: 'Primitivão — Golf With Your Friends 2026', season: 'Season 1', tag: 'GWYF', status: 'soon'   },
];
const CHAMP_BY_ID = Object.fromEntries(CHAMPIONSHIPS.map(c => [c.id, c]));

const START_PC = 50;
const WEEKLY_PC = 500;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Próximo "release geral" do bônus: quando a hora atual passa desse marco,
// TODOS os usuários cujo `lastWeekly` é anterior a ele ficam elegíveis
// imediatamente — mesmo quem já resgatou esta semana. Depois disso, o
// ciclo normal de 7 dias volta a valer pra cada um. Pra liberar de novo no
// futuro, é só atualizar este timestamp.
// 21/05/2026 10:00 BRT (= 13:00 UTC).
const WEEKLY_RELEASE_AT = Date.UTC(2026, 4, 21, 13, 0, 0);

const DEF_BY = 1.8; // ambos marcam: SIM
const DEF_BN = 2.0; // ambos marcam: NÃO

// fixtures default: rodada 1 — 4 jogos
const DEFAULT_FIXTURES = [
  { id: 'r1g1', round: 1, home: 'bane',    away: 'mohamed', day: 'SEG', date: '04/05', time: '21:00', oddsH: 2.0, oddsD: 3.0, oddsA: 2.2, oddsBY: DEF_BY, oddsBN: DEF_BN, result: null, locked: false },
  { id: 'r1g2', round: 1, home: 'potato',  away: 'magreza', day: 'TER', date: '05/05', time: '21:00', oddsH: 2.3, oddsD: 3.0, oddsA: 2.0, oddsBY: DEF_BY, oddsBN: DEF_BN, result: null, locked: false },
  { id: 'r1g3', round: 1, home: 'celin',   away: 'juca',    day: 'QUA', date: '06/05', time: '21:00', oddsH: 2.1, oddsD: 3.0, oddsA: 2.1, oddsBY: DEF_BY, oddsBN: DEF_BN, result: null, locked: false },
  { id: 'r1g4', round: 1, home: 'caco',    away: 'vitinho', day: 'QUI', date: '07/05', time: '21:00', oddsH: 2.5, oddsD: 3.0, oddsA: 1.9, oddsBY: DEF_BY, oddsBN: DEF_BN, result: null, locked: false },
];

// ─── STORAGE ────────────────────────────────────────────────────────────────
const SESSION_KEY = 'pv-bet-session';
function loadSession() {
  try { const v = localStorage.getItem(SESSION_KEY); return v ? JSON.parse(v) : null; }
  catch (e) { return null; }
}
function saveSession(val) {
  try {
    if (val) localStorage.setItem(SESSION_KEY, JSON.stringify(val));
    else localStorage.removeItem(SESSION_KEY);
  } catch(e) {}
}
const BET_DOC      = () => window.db.doc('primitivao/apostas');
const CLASSIF_DOC  = () => window.db.doc('primitivao/state');

// ─── BACKUP ─────────────────────────────────────────────────────────────────
// Dispara download de um JSON com TODOS os dados do site (apostas + classificação).
// Usado pelo botão na aba ADMIN; o GitHub Action diário usa o mesmo formato.
function parseDocJsonSafe(snap) {
  if (!snap || !snap.exists) return { exists: false, data: null };
  const raw = snap.data();
  if (!raw || typeof raw.json !== 'string') {
    return { exists: true, data: null, raw, parseError: 'campo `json` ausente ou nao string' };
  }
  try {
    return { exists: true, data: JSON.parse(raw.json), updatedAt: raw.updatedAt };
  } catch (e) {
    return { exists: true, data: null, raw, parseError: String(e && e.message || e) };
  }
}

// ─── TRANSAÇÕES (utilitários) ───────────────────────────────────────────────
// Helper central pra todas as mutações de primitivao/apostas: roda o reducer
// passado dentro de uma firestore transaction.
//
// Reducer recebe o estado remoto parseado (json field) e pode retornar:
//   - null/undefined            → no-op, devolve null
//   - { __abort:true, result }  → no-op (com resultado pro caller)
//   - <next state>              → escreve next como novo json
//
// SAFETY NET: o `next` é normalizado pra ter `users/fixtures/bets/teamPlayers`,
// usando `cur` como fallback se algum campo vier ausente/inválido. Isso
// previne corrupção do json caso um reducer com bug devolva objeto malformado.
async function commitBetDocUpdate(reducer) {
  const ref = BET_DOC();
  return await window.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    let cur = {};
    let topInterests = null;
    if (snap.exists) {
      const data = snap.data();
      if (typeof data.json === 'string') {
        try { cur = JSON.parse(data.json); } catch (_) { cur = {}; }
      }
      if (data.interests && typeof data.interests === 'object') {
        topInterests = data.interests;
      }
    }
    const out = reducer(cur);
    if (out == null) return null;
    if (out && typeof out === 'object' && out.__abort === true) {
      return out.result !== undefined ? out.result : null;
    }
    // Normalização defensiva: garante schema mínimo, sem perder fields de cur.
    const safe = {
      users:       (out && typeof out.users === 'object' && out.users)
                       ? out.users
                       : (cur.users && typeof cur.users === 'object' ? cur.users : {}),
      fixtures:    Array.isArray(out && out.fixtures) ? out.fixtures
                       : (Array.isArray(cur.fixtures) ? cur.fixtures : DEFAULT_FIXTURES),
      bets:        Array.isArray(out && out.bets) ? out.bets
                       : (Array.isArray(cur.bets) ? cur.bets : []),
      teamPlayers: (out && typeof out.teamPlayers === 'object' && out.teamPlayers)
                       ? out.teamPlayers
                       : (cur.teamPlayers && typeof cur.teamPlayers === 'object' ? cur.teamPlayers : {}),
    };
    const writeData = {
      json: JSON.stringify(safe),
      updatedAt: Date.now(),
    };
    // Auto-migração: se o doc tá em formato antigo (interests dentro do json,
    // sem campo top-level), promovemos AGORA pro top-level junto com a escrita.
    // Evita que escritas regulares (placeBet, signup, etc.) percam as inscrições
    // que estavam dentro do json antes da migração explícita rodar.
    if (topInterests === null && cur.interests && typeof cur.interests === 'object') {
      writeData.interests = cur.interests;
    }
    tx.set(ref, writeData, { merge: true });
    return { ok: true };
  });
}

// Merge usado no write-back: protege contra outras tabs sobrescreverem campos
// que ESTA tab não modificou. Cada campo tem estratégia própria.
function mergeBetDocFields(remote, local) {
  return {
    // users / teamPlayers: shallow merge, local ganha em conflito de chave.
    users:       { ...(remote.users || {}),       ...(local.users || {}) },
    teamPlayers: { ...(remote.teamPlayers || {}), ...(local.teamPlayers || {}) },
    // bets: união por id, local ganha em conflito.
    bets:        mergeBetsById(remote.bets || [], local.bets || []),
    // fixtures: take local (não é editado concorrentemente).
    fixtures:    local.fixtures || remote.fixtures || DEFAULT_FIXTURES,
  };
}
function mergeBetsById(remote, local) {
  const byId = new Map();
  for (const b of remote) if (b && b.id) byId.set(b.id, b);
  for (const b of local)  if (b && b.id) byId.set(b.id, b);
  return Array.from(byId.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

async function downloadFullBackup() {
  try {
    const [betSnap, classifSnap] = await Promise.all([
      BET_DOC().get(),
      CLASSIF_DOC().get(),
    ]);
    const apostas       = parseDocJsonSafe(betSnap);
    const classificacao = parseDocJsonSafe(classifSnap);
    // interests agora vive em campo top-level do doc (sibling de `json`),
    // pra não competir com outras escritas. Fallback ao formato antigo
    // (interests dentro de json) pra retrocompat.
    const rawApostas = betSnap.exists ? betSnap.data() : {};
    const topLevelInterests = rawApostas.interests;
    const apostasData = apostas.data ? { ...apostas.data } : null;
    if (apostasData) {
      apostasData.interests = (topLevelInterests && typeof topLevelInterests === 'object')
        ? topLevelInterests
        : (apostasData.interests || {});
    }
    const payload = {
      exportedAt: new Date().toISOString(),
      version: 3,
      source: 'browser-admin',
      apostas:       apostasData,
      classificacao: classificacao.data,
      // metadados crus pra nunca perder dado mesmo se o parse falhar.
      _raw: { apostas, classificacao, topLevelInterests },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const a = document.createElement('a');
    a.href = url;
    a.download = `primitivao-backup-${ts}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { ok: true, users: Object.keys(payload.apostas?.users || {}).length, bets: (payload.apostas?.bets || []).length };
  } catch (e) {
    console.error('Backup failed', e);
    return { ok: false, error: String(e && e.message || e) };
  }
}

// ─── RESTORE ────────────────────────────────────────────────────────────────
// Lê o conteúdo `apostas` e `classificacao` de um payload de backup (gerado
// pelo downloadFullBackup) e SOBRESCREVE os dois docs do Firestore. Antes de
// aplicar, dispara um backup de segurança automático do estado atual.
// Devolve { ok, error?, applied: { users, bets, teams, interests, rounds } }.
async function restoreFromBackup(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'JSON inválido (não é objeto).' };
  }
  // Aceita o formato v2 (com _raw) ou v1 (só apostas/classificacao).
  const apostas       = payload.apostas;
  const classificacao = payload.classificacao;
  if (apostas == null && classificacao == null) {
    return { ok: false, error: 'JSON não tem campo `apostas` nem `classificacao`.' };
  }

  // Backup de segurança PRIMEIRO. Se falhar, aborta sem escrever.
  const safety = await downloadFullBackup();
  if (!safety.ok) {
    return { ok: false, error: 'Backup de segurança falhou — restore abortado: ' + safety.error };
  }

  try {
    const writes = [];
    if (apostas != null) {
      // Separa interests do resto: gravamos como campo top-level pra não
      // competir com outras escritas (race condition).
      const { interests, ...rest } = apostas;
      writes.push(BET_DOC().set({
        json: JSON.stringify(rest),
        interests: (interests && typeof interests === 'object') ? interests : {},
        updatedAt: Date.now(),
      }));
    }
    if (classificacao != null) {
      writes.push(CLASSIF_DOC().set({
        json: JSON.stringify(classificacao),
        updatedAt: Date.now(),
      }));
    }
    await Promise.all(writes);
    return {
      ok: true,
      applied: {
        users:     Object.keys(apostas?.users || {}).length,
        bets:      (apostas?.bets || []).length,
        teams:     Object.keys(apostas?.teamPlayers || {}).length,
        interests: Object.values(apostas?.interests || {})
                          .reduce((s, x) => s + Object.keys(x || {}).length, 0),
        rounds:    (classificacao?.rounds || []).length,
      },
    };
  } catch (e) {
    return { ok: false, error: 'Backup de seguranca baixado, mas o restore falhou: ' + String(e && e.message || e) };
  }
}

// ─── WIPE (PERIGO) ──────────────────────────────────────────────────────────
// Reseta os dois docs do Firestore pro estado inicial (mesmo que o app gera
// quando o doc não existe). FORÇA backup baixado antes — se o backup falhar,
// aborta sem tocar em nada.
async function wipeAllData() {
  const backup = await downloadFullBackup();
  if (!backup.ok) {
    return { ok: false, error: 'Backup falhou; reset abortado por segurança. Detalhe: ' + backup.error };
  }
  try {
    await Promise.all([
      BET_DOC().set({
        json: JSON.stringify({ users: {}, fixtures: DEFAULT_FIXTURES, bets: [], teamPlayers: {} }),
        interests: {}, // campo top-level — separado do json
        updatedAt: Date.now(),
      }),
      CLASSIF_DOC().set({
        json: JSON.stringify({ currentRound: 0, rounds: defaultRounds() }),
        updatedAt: Date.now(),
      }),
    ]);
    return { ok: true, backedUp: backup };
  } catch (e) {
    console.error('Wipe failed', e);
    return { ok: false, error: 'Backup baixou mas o reset falhou: ' + String(e && e.message || e) };
  }
}

// ─── NORMALIZAÇÃO (compat com dados antigos) ────────────────────────────────
function normFixture(f) {
  return { ...f, oddsBY: f.oddsBY != null ? f.oddsBY : DEF_BY, oddsBN: f.oddsBN != null ? f.oddsBN : DEF_BN };
}
function normBet(b) {
  if (Array.isArray(b.legs)) return b;
  // formato antigo (aposta simples) → vira cupom de 1 perna
  return {
    id: b.id, user: b.user, amount: b.amount, status: b.status || 'pending',
    createdAt: b.createdAt || Date.now(), combinedOdds: b.odds,
    payout: b.payout,
    legs: [{
      fixtureId: b.fixtureId, market: '1X2', pick: b.pick, odds: b.odds,
      result: b.status === 'won' ? 'win' : b.status === 'lost' ? 'lose' : undefined,
    }],
  };
}

// ─── LÓGICA DE TICKETS ──────────────────────────────────────────────────────
function ticketStatusFromLegs(legs) {
  if (legs.some(l => l.result === 'lose')) return 'lost';
  if (legs.length && legs.every(l => l.result === 'win')) return 'won';
  return 'pending';
}
function legLabel(leg) {
  const fx = leg._fix;
  if (!fx) return '—';
  const h = TEAM(fx.home), a = TEAM(fx.away);
  const sn = leg.pick === 'Y' ? 'SIM' : 'NÃO';
  switch (leg.market) {
    case 'BTTS': return `${h.short}×${a.short} · AMBOS MARCAM: ${sn}`;
    case 'NM':   return `${h.short}×${a.short} · NINGUÉM MARCA: ${sn}`;
    case 'O3H':  return `${h.short}×${a.short} · +3 GOLS DO ${h.short}: ${sn}`;
    case 'O3A':  return `${h.short}×${a.short} · +3 GOLS DO ${a.short}: ${sn}`;
    case '1X2':
    default: {
      const who = leg.pick === 'H' ? h.name : leg.pick === 'A' ? a.name : 'EMPATE';
      return `${h.short}×${a.short} · ${who}`;
    }
  }
}

// ─── CLASSIFICAÇÃO: geração de tabela ────────────────────────────────────────
const TOTAL_ROUNDS = 7;
const DAYS = ['SEG','TER','QUA','QUI','SEX','SÁB','DOM'];
function generateSchedule(teamIds) {
  const ids = teamIds.slice();
  const n = ids.length;
  const rounds = [];
  const fixed = ids[0];
  let rotating = ids.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const arr = [fixed, ...rotating];
    const games = [];
    for (let i = 0; i < n / 2; i++) {
      const home = arr[i];
      const away = arr[n - 1 - i];
      games.push(r % 2 === 0 ? { home, away } : { home: away, away: home });
    }
    rounds.push(games);
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)];
  }
  return rounds;
}
function defaultRounds() {
  const sched = generateSchedule(TEAMS.map(t => t.id));
  const startDate = new Date(2026, 4, 4);
  return sched.map((games, ri) => {
    const base = new Date(startDate);
    base.setDate(base.getDate() + ri * 7);
    return games.map((g, gi) => {
      const d = new Date(base);
      d.setDate(d.getDate() + gi);
      const day = DAYS[d.getDay() === 0 ? 6 : d.getDay() - 1];
      const date = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
      return { home: g.home, away: g.away, day, date, time: gi % 2 === 0 ? '21:00' : '21:30', gh: '', ga: '' };
    });
  });
}
function computeStandings(rounds) {
  const rec = {};
  TEAMS.forEach(t => rec[t.id] = { ...t, j:0, v:0, e:0, d:0, gp:0, gc:0, p:0 });
  (rounds || []).forEach(round => {
    round.forEach(m => {
      const gh = parseInt(m.gh, 10);
      const ga = parseInt(m.ga, 10);
      if (Number.isNaN(gh) || Number.isNaN(ga)) return;
      const H = rec[m.home], A = rec[m.away];
      if (!H || !A) return;
      H.j++; A.j++;
      H.gp += gh; H.gc += ga;
      A.gp += ga; A.gc += gh;
      if (gh > ga) { H.v++; A.d++; H.p += 3; }
      else if (gh < ga) { A.v++; H.d++; A.p += 3; }
      else { H.e++; A.e++; H.p += 1; A.p += 1; }
    });
  });
  return Object.values(rec).sort((a,b) => {
    if (b.p !== a.p) return b.p - a.p;
    const sgA = a.gp - a.gc, sgB = b.gp - b.gc;
    if (sgB !== sgA) return sgB - sgA;
    if (b.v !== a.v) return b.v - a.v;
    if (b.gp !== a.gp) return b.gp - a.gp;
    return a.name.localeCompare(b.name);
  });
}

// ─── ODDS, MERCADOS, JOGOS (a partir de cs.rounds) ─────────────────────────
// Mercados disponíveis:
//   '1X2'  picks: H, D, A
//   'BTTS' picks: Y, N           (ambos marcam)
//   'NM'   picks: Y, N           (ninguém marca: 0x0)
//   'O3H'  picks: Y, N           (mandante marca 3+)
//   'O3A'  picks: Y, N           (visitante marca 3+)

const MARKETS = ['1X2', 'BTTS', 'NM', 'O3H', 'O3A'];
const MARKET_TITLE = {
  '1X2': 'RESULTADO',
  'BTTS': 'AMBOS MARCAM',
  'NM': 'NINGUÉM MARCA',
  'O3H': '+3 GOLS DO MANDANTE',
  'O3A': '+3 GOLS DO VISITANTE',
};

function isGamePlayed(g) {
  if (!g) return false;
  const gh = parseInt(g.gh, 10), ga = parseInt(g.ga, 10);
  return !Number.isNaN(gh) && !Number.isNaN(ga);
}
function makeGameId(ri, gi) { return 'r' + ri + 'g' + gi; }
function parseGameId(id) {
  const m = /^r(\d+)g(\d+)$/.exec(id || '');
  return m ? { ri: +m[1], gi: +m[2] } : null;
}
function gameById(rounds, id) {
  const p = parseGameId(id); if (!p) return null;
  return rounds?.[p.ri]?.[p.gi] || null;
}
function bettableGames(rounds) {
  const out = [];
  (rounds || []).forEach((round, ri) => (round || []).forEach((g, gi) => {
    if (!isGamePlayed(g)) out.push({ id: makeGameId(ri, gi), round: ri + 1, ri, gi, ...g });
  }));
  return out;
}
// Rodadas usadas pra recalcular odds: só rodadas com TODOS os jogos finalizados.
// (Escolha do dono: "recalcula só quando a rodada termina".)
function oddsBaselineRounds(rounds) {
  return (rounds || []).filter(round => (round || []).every(isGamePlayed));
}

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function poissonPmf(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}
const DEFAULT_LAMBDA = 1.3; // gols esperados por time quando não há histórico

function computeTeamMetrics(rounds) {
  const base = oddsBaselineRounds(rounds);
  const standings = computeStandings(base);
  const out = {};
  for (const t of standings) {
    out[t.id] = {
      ...t,
      sg: t.gp - t.gc,
      strength: t.p * 3 + (t.gp - t.gc),
      lambdaAttack:  t.j > 0 ? t.gp / t.j : DEFAULT_LAMBDA,
      lambdaDefense: t.j > 0 ? t.gc / t.j : DEFAULT_LAMBDA,
    };
  }
  return out;
}

// Teto baixo (10x) pra evitar odds exorbitantes em mercados raros
// (Ninguém Marca, +3 gols). Piso 1.10 pra nada parecer "garantido".
const ODD_MIN = 1.10;
const ODD_MAX = 10.00;
function toOdd(p) {
  if (!(p > 0) || !isFinite(p)) return ODD_MAX;
  return Math.max(ODD_MIN, Math.min(ODD_MAX, +(1 / p).toFixed(2)));
}

function computeGameOdds(homeId, awayId, metrics) {
  const H = metrics[homeId] || { strength: 0, lambdaAttack: DEFAULT_LAMBDA, lambdaDefense: DEFAULT_LAMBDA };
  const A = metrics[awayId] || { strength: 0, lambdaAttack: DEFAULT_LAMBDA, lambdaDefense: DEFAULT_LAMBDA };

  // 1X2: reserva pra empate + logística no resto
  const diff = H.strength - A.strength;
  const pDraw = 0.30 * Math.exp(-Math.abs(diff) / 40);
  const rest  = 1 - pDraw;
  const sigH  = sigmoid(diff * 0.0256);
  const pH = rest * sigH;
  const pA = rest * (1 - sigH);

  // Gols esperados deste jogo (média do ataque do time com defesa do adversário)
  const lambH = (H.lambdaAttack + A.lambdaDefense) / 2;
  const lambA = (A.lambdaAttack + H.lambdaDefense) / 2;

  const pHScores = 1 - Math.exp(-lambH);
  const pAScores = 1 - Math.exp(-lambA);
  const pBY = pHScores * pAScores;
  const pBN = 1 - pBY;
  const pNMY = (1 - pHScores) * (1 - pAScores);
  const pNMN = 1 - pNMY;
  const p3H = 1 - (poissonPmf(lambH, 0) + poissonPmf(lambH, 1) + poissonPmf(lambH, 2));
  const p3A = 1 - (poissonPmf(lambA, 0) + poissonPmf(lambA, 1) + poissonPmf(lambA, 2));

  return {
    '1X2':  { H: toOdd(pH),    D: toOdd(pDraw), A: toOdd(pA) },
    'BTTS': { Y: toOdd(pBY),   N: toOdd(pBN) },
    'NM':   { Y: toOdd(pNMY),  N: toOdd(pNMN) },
    'O3H':  { Y: toOdd(p3H),   N: toOdd(1 - p3H) },
    'O3A':  { Y: toOdd(p3A),   N: toOdd(1 - p3A) },
  };
}

// Dado mercado/pick e placar, retorna true se a perna ganhou.
function marketSettle(market, pick, gh, ga) {
  switch (market) {
    case '1X2': {
      const winner = gh > ga ? 'H' : ga > gh ? 'A' : 'D';
      return pick === winner;
    }
    case 'BTTS': return ((gh > 0 && ga > 0) ? 'Y' : 'N') === pick;
    case 'NM':   return ((gh === 0 && ga === 0) ? 'Y' : 'N') === pick;
    case 'O3H':  return ((gh >= 3) ? 'Y' : 'N') === pick;
    case 'O3A':  return ((ga >= 3) ? 'Y' : 'N') === pick;
    default: return false;
  }
}

// ─── ÍCONES ─────────────────────────────────────────────────────────────────
function MiniCrest({ size = 38, color = '#d76414' }) {
  return (
    <svg viewBox="0 0 100 120" width={size} height={size * 1.2} style={{ display: 'block' }}>
      <path d="M10 12 L 90 12 L 90 62 C 90 90 82 104 50 118 C 18 104 10 90 10 62 Z"
            fill={color} stroke="#1c1612" strokeWidth="4" />
      <ellipse cx="50" cy="60" rx="16" ry="22" fill="#f4ead7" />
      <path d="M42 58 L 46 58 L 44 62 Z M58 58 L 54 58 L 56 62 Z" fill="#1c1612" />
      <path d="M42 70 L 58 70 L 50 78 Z" fill="#1c1612" />
    </svg>
  );
}
function TeamMini({ team, size = 36 }) {
  const t = typeof team === 'string' ? TEAM(team) : team;
  return (
    <svg viewBox="0 0 100 120" width={size} height={size * 1.2} style={{ display: 'block', flexShrink: 0 }}>
      <path d="M10 12 L 90 12 L 90 62 C 90 90 82 104 50 118 C 18 104 10 90 10 62 Z"
            fill={t.color} stroke="#1c1612" strokeWidth="5" />
      <text x="50" y="76" textAnchor="middle" fontFamily="Bagel Fat One, Impact" fontSize="38" fill="#f4ead7">
        {t.short.charAt(0)}
      </text>
    </svg>
  );
}

// ─── APP ────────────────────────────────────────────────────────────────────
function App() {
  const [shared, setShared] = useState({ users: {}, fixtures: DEFAULT_FIXTURES, bets: [], interests: {}, teamPlayers: {} });
  const { users, fixtures, bets, interests, teamPlayers } = shared;

  // cs: classificação compartilhada via primitivao/state. State é mantido no App
  // (e não em ClassificacaoView) para que: (a) ApostarView possa derivar jogos +
  // odds das rounds; (b) liquidação automática rode aqui quando placares mudam.
  const [cs, setCs] = useState(null);
  const csLoadedRef   = useRef(false);
  const csApplyingRef = useRef(false);

  const [session, _setSession] = useState(loadSession);
  const setSession = (s) => { saveSession(s); _setSession(s); };

  const [tab, setTab]       = useState('apostar');
  const [slip, setSlip]     = useState([]); // [{fixtureId='rXgY', market, pick, odds}]
  const [synced, setSynced] = useState(false);
  const [championship, setChampionship] = useState('fifa');

  const hasLoadedRef        = useRef(false);
  const isApplyingRemoteRef = useRef(false);

  // ── Firestore: apostas doc ────────────────────────────────────────────────
  useEffect(() => {
    const ref = BET_DOC();
    const unsub = ref.onSnapshot(snap => {
      if (!snap.exists) {
        ref.set({ json: JSON.stringify({ users: {}, fixtures: DEFAULT_FIXTURES, bets: [], teamPlayers: {} }), interests: {}, updatedAt: Date.now() })
           .catch(e => console.warn('Firestore seed failed', e));
        hasLoadedRef.current = true; setSynced(true);
        return;
      }
      try {
        const docData = snap.data();
        const remote = JSON.parse(docData.json);
        // interests agora é campo TOP-LEVEL pra não sofrer race com outras
        // escritas no json. Mantém fallback pra docs antigos.
        const topInterests = docData.interests;
        let interests;
        let needsMigration = false;
        if (topInterests && typeof topInterests === 'object') {
          interests = topInterests;
        } else if (remote.interests && typeof remote.interests === 'object') {
          interests = remote.interests;
          needsMigration = true;
        } else {
          interests = {};
        }
        isApplyingRemoteRef.current = true;
        setShared({
          users:        remote.users && typeof remote.users === 'object' ? remote.users : {},
          fixtures:     Array.isArray(remote.fixtures) ? remote.fixtures.map(normFixture) : DEFAULT_FIXTURES,
          bets:         Array.isArray(remote.bets) ? remote.bets.map(normBet) : [],
          interests,
          teamPlayers:  remote.teamPlayers && typeof remote.teamPlayers === 'object' ? remote.teamPlayers : {},
        });
        hasLoadedRef.current = true; setSynced(true);
        // Migração one-shot: promove interests do json pra campo top-level.
        if (needsMigration) {
          const { interests: _drop, ...rest } = remote;
          ref.set({
            json: JSON.stringify(rest),
            interests,
            updatedAt: Date.now(),
          }, { merge: true }).catch(err => console.warn('Migracao interests falhou', err));
        }
      } catch (e) { console.warn('Firestore parse failed', e); }
    }, err => console.warn('Firestore subscription failed', err));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!hasLoadedRef.current) return;
    if (isApplyingRemoteRef.current) { isApplyingRemoteRef.current = false; return; }
    const t = setTimeout(() => {
      // Write-back transacional: lê remote, faz MERGE com local (campo a
      // campo, vide mergeBetDocFields), grava resultado. Protege contra
      // outras tabs sobrescreverem campos que esta tab não modificou.
      const { interests: _drop, ...localNoInterests } = shared;
      commitBetDocUpdate(remote => ({
        next: mergeBetDocFields(remote, localNoInterests),
      })).catch(e => console.warn('Firestore write failed', e));
    }, 250);
    return () => clearTimeout(t);
  }, [shared]);

  // ── Firestore: state doc (classificação) ──────────────────────────────────
  useEffect(() => {
    const ref = CLASSIF_DOC();
    const unsub = ref.onSnapshot(snap => {
      if (!snap.exists) {
        const seed = { currentRound: 0, rounds: defaultRounds() };
        ref.set({ json: JSON.stringify(seed), updatedAt: Date.now() }).catch(e => console.warn(e));
        csApplyingRef.current = true; setCs(seed); csLoadedRef.current = true;
        return;
      }
      try {
        const d = JSON.parse(snap.data().json);
        const obj = d && typeof d === 'object' ? d : {};
        let rounds = Array.isArray(obj.rounds) ? obj.rounds : [];
        if (rounds.length !== TOTAL_ROUNDS) {
          const defs = defaultRounds();
          rounds = rounds.length < TOTAL_ROUNDS
            ? [...rounds, ...defs.slice(rounds.length)]
            : rounds.slice(0, TOTAL_ROUNDS);
        }
        const currentRound = Number.isInteger(obj.currentRound) ? obj.currentRound : 0;
        csApplyingRef.current = true;
        setCs({ currentRound, rounds });
        csLoadedRef.current = true;
      } catch (e) { console.warn('Classif parse failed', e); }
    }, err => console.warn('Classif subscription failed', err));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!csLoadedRef.current || cs == null) return;
    if (csApplyingRef.current) { csApplyingRef.current = false; return; }
    const t = setTimeout(async () => {
      try {
        await window.db.runTransaction(async (tx) => {
          const snap = await tx.get(CLASSIF_DOC());
          let cur = null;
          if (snap.exists && typeof snap.data().json === 'string') {
            try { cur = JSON.parse(snap.data().json); } catch (_) { cur = null; }
          }
          // Safety net: força shape valido. Se cs local vier malformado,
          // cai pra remoto; se remoto vier malformado, usa defaults.
          const safeRounds = Array.isArray(cs.rounds) && cs.rounds.length === TOTAL_ROUNDS
            ? cs.rounds
            : (cur && Array.isArray(cur.rounds) && cur.rounds.length === TOTAL_ROUNDS
                ? cur.rounds
                : defaultRounds());
          const safe = {
            currentRound: Number.isInteger(cs.currentRound) ? cs.currentRound
                         : (cur && Number.isInteger(cur.currentRound) ? cur.currentRound : 0),
            rounds: safeRounds,
          };
          tx.set(CLASSIF_DOC(), { json: JSON.stringify(safe), updatedAt: Date.now() });
        });
      } catch (e) {
        console.warn('Firestore write failed (classif)', e);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [cs]);

  // ── Liquidação automática: roda transacionalmente quando cs muda.
  //    Debounce de 600ms — admin digitando placar dispara cs várias vezes
  //    por segundo; sem debounce, cada keystroke virava uma transação no
  //    Firestore, criando contenção com placeBet/cancelBet etc. e podendo
  //    bloquear ações do usuário durante o input do placar.
  useEffect(() => {
    if (!cs || !hasLoadedRef.current) return;
    let cancelled = false;
    const csSnapshot = cs; // captura imutável
    const timer = setTimeout(async () => {
      if (cancelled) return;
      try {
        await commitBetDocUpdate(remote => {
          const remoteBets = remote.bets || [];
          if (remoteBets.length === 0) return null;
          const newUsers = { ...(remote.users || {}) };
          let dirty = false;
          const newBets = remoteBets.map(b => {
            let changed = false;
            const legs = b.legs.map(l => {
              const p = parseGameId(l.fixtureId);
              if (!p) return l;
              const g = csSnapshot.rounds?.[p.ri]?.[p.gi];
              if (!g) return l;
              const gh = parseInt(g.gh, 10), ga = parseInt(g.ga, 10);
              const played = !Number.isNaN(gh) && !Number.isNaN(ga);
              if (l.result && !played) { changed = true; return { ...l, result: undefined }; }
              if (!l.result && played) {
                const won = marketSettle(l.market, l.pick, gh, ga);
                changed = true;
                return { ...l, result: won ? 'win' : 'lose' };
              }
              return l;
            });
            if (!changed) return b;
            const newStatus = ticketStatusFromLegs(legs);
            const oldStatus = b.status;
            const oldPayout = b.payout || 0;
            let newPayout = b.payout;
            if (oldStatus === 'won' && newStatus !== 'won' && oldPayout > 0 && newUsers[b.user]) {
              newUsers[b.user] = { ...newUsers[b.user], pc: Math.max(0, newUsers[b.user].pc - oldPayout) };
            }
            if (newStatus === 'won' && oldStatus !== 'won') {
              newPayout = Math.round(b.amount * b.combinedOdds);
              if (newUsers[b.user]) {
                newUsers[b.user] = { ...newUsers[b.user], pc: newUsers[b.user].pc + newPayout };
              }
            } else if (newStatus === 'lost') {
              newPayout = 0;
            } else if (newStatus === 'pending') {
              newPayout = undefined;
            }
            dirty = true;
            return { ...b, legs, status: newStatus, payout: newPayout };
          });
          if (!dirty) return null;
          return { ...remote, users: newUsers, bets: newBets };
        });
      } catch (e) {
        if (!cancelled) console.warn('auto-settle failed', e);
      }
    }, 600);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [cs]);

  // Derivados de cs.rounds: métricas dos times + jogos disponíveis com odds.
  const rounds   = cs?.rounds || [];
  const metrics  = useMemo(() => computeTeamMetrics(rounds), [rounds]);
  const games    = useMemo(
    () => bettableGames(rounds).map(g => ({ ...g, odds: computeGameOdds(g.home, g.away, metrics) })),
    [rounds, metrics]
  );
  const gamesById = useMemo(() => {
    const m = {}; for (const g of games) m[g.id] = g; return m;
  }, [games]);

  const me = session ? users[session.nick] : null;
  const isAdmin = session && session.nick === ADMIN_NICK;

  // Login/signup via transação: cadastro atomico contra remote — evita perder
  // user novo se outro write concorrer.
  const handleAuth = async (nick, senha) => {
    nick = nick.trim().toLowerCase();
    if (!nick || !senha) return 'Preencha nick e senha';
    if (nick === ADMIN_NICK) {
      if (senha !== ADMIN_PASS) return 'Senha de admin incorreta';
      setSession({ nick }); return null;
    }
    try {
      const result = await commitBetDocUpdate(remote => {
        const remoteUsers = remote.users || {};
        const existing = remoteUsers[nick];
        if (existing) {
          if (existing.senha !== senha) return { __abort: true, result: { err: 'Senha incorreta' } };
          return { __abort: true, result: { ok: true } }; // login válido, sem write
        }
        return { ...remote, users: { ...remoteUsers, [nick]: { senha, pc: START_PC, joined: Date.now(), lastWeekly: 0 } } };
      });
      if (result && result.err) return result.err;
      setSession({ nick });
      return null;
    } catch (e) {
      console.warn('handleAuth failed', e);
      return 'Erro de conexão. Tente novamente.';
    }
  };

  const logout = () => { setSession(null); setTab('apostar'); setSlip([]); };

  // Bônus semanal via transação: revalida elegibilidade contra dados REMOTOS
  // pra evitar dois cliques rápidos creditarem em dobro, ou ser sobrescrito.
  const claimWeekly = async () => {
    if (!session || isAdmin) return;
    const nick = session.nick;
    try {
      await commitBetDocUpdate(remote => {
        const u = (remote.users || {})[nick];
        if (!u) return null;
        const now = Date.now();
        const cycleOK    = (now - u.lastWeekly) >= WEEK_MS;
        const releasedOK = now >= WEEKLY_RELEASE_AT && u.lastWeekly < WEEKLY_RELEASE_AT;
        if (!cycleOK && !releasedOK) return null;
        const users = {
          ...remote.users,
          [nick]: { ...u, pc: u.pc + WEEKLY_PC, lastWeekly: now },
        };
        return { ...remote, users };
      });
    } catch (e) { console.warn('claimWeekly failed', e); }
  };
  // Disponível se: (a) já se passaram 7 dias do último resgate, ou
  // (b) o release geral já chegou e o usuário só resgatou antes dele.
  const weeklyReady = me
    ? (Date.now() - me.lastWeekly >= WEEK_MS) ||
      (Date.now() >= WEEKLY_RELEASE_AT && me.lastWeekly < WEEKLY_RELEASE_AT)
    : false;
  // Contagem regressiva: mostra o que chegar antes — fim do ciclo de 7 dias
  // ou a hora do release geral (se ainda no futuro e usuário não resgatou).
  const weeklyIn = (() => {
    if (!me || weeklyReady) return 0;
    const tCycle   = WEEK_MS - (Date.now() - me.lastWeekly);
    const tRelease = (WEEKLY_RELEASE_AT > Date.now() && me.lastWeekly < WEEKLY_RELEASE_AT)
      ? WEEKLY_RELEASE_AT - Date.now()
      : Infinity;
    return Math.max(0, Math.min(tCycle, tRelease));
  })();

  // ── CUPOM (parlay) ────────────────────────────────────────────────────────
  // game = item de `games` (vindo de cs.rounds, com id rXgY e odds calculadas)
  const toggleLeg = (game, market, pick) => {
    if (isAdmin) return;
    const odds = game?.odds?.[market]?.[pick];
    if (!odds || !game.id) return;
    setSlip(prev => {
      const exact = prev.find(s => s.fixtureId === game.id && s.market === market && s.pick === pick);
      if (exact) return prev.filter(s => !(s.fixtureId === game.id && s.market === market && s.pick === pick));
      // só 1 perna por jogo (evita combinar mercados correlacionados do mesmo jogo)
      const others = prev.filter(s => s.fixtureId !== game.id);
      return [...others, { fixtureId: game.id, market, pick, odds }];
    });
  };
  const removeLeg = (fixtureId) => setSlip(prev => prev.filter(s => s.fixtureId !== fixtureId));
  const clearSlip = () => setSlip([]);

  // PlaceBet via transação: debita PC + adiciona ticket atomicamente contra
  // o estado remoto (não permite ficar negativo nem perder o ticket).
  const placeBet = async (amount) => {
    if (!me || slip.length === 0) return;
    for (const l of slip) {
      const g = gameById[l.fixtureId];
      if (!g) { alert('Um dos jogos do cupom não está mais disponível.'); return; }
    }
    if (amount <= 0) return;
    const co = +slip.reduce((p, l) => p + l.odds, 0).toFixed(2);
    const ticket = {
      id: 't' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      user: session.nick, amount, status: 'pending', createdAt: Date.now(),
      combinedOdds: co,
      legs: slip.map(l => ({ fixtureId: l.fixtureId, market: l.market, pick: l.pick, odds: l.odds })),
    };
    try {
      const result = await commitBetDocUpdate(remote => {
        const u = (remote.users || {})[session.nick];
        if (!u) {
          return { __abort: true, result: { err: 'Sua conta não está sincronizada. Faz logout e entra de novo.' } };
        }
        if (u.pc < amount) {
          return { __abort: true, result: { err: 'Saldo insuficiente (tem ' + u.pc + ' PC, aposta de ' + amount + ' PC).' } };
        }
        // Idempotência: se por algum motivo o ticket já foi gravado, não duplica.
        if ((remote.bets || []).some(b => b.id === ticket.id)) return null;
        const users = { ...remote.users, [session.nick]: { ...u, pc: u.pc - amount } };
        const bets = [ticket, ...(remote.bets || [])];
        return { ...remote, users, bets };
      });
      if (result && result.err) { alert(result.err); return; }
      setSlip([]);
    } catch (e) {
      console.warn('placeBet failed', e);
      alert('Erro ao colocar aposta: ' + (e && e.message || e) + '. Tenta de novo em alguns segundos.');
    }
  };

  // CancelBet via transação: remove ticket + devolve PC atomicamente.
  // (Deleção precisa ser transacional senão o merge restaura o bet do remote.)
  const cancelBet = async (ticketId) => {
    try {
      const result = await commitBetDocUpdate(remote => {
        const t = (remote.bets || []).find(b => b.id === ticketId);
        if (!t || t.status !== 'pending') return null;
        if (t.user !== session.nick && session.nick !== ADMIN_NICK) return null;
        if (t.legs.some(l => !!l.result)) {
          return { __abort: true, result: { err: 'Esse cupom já tem jogos finalizados.' } };
        }
        const bets = (remote.bets || []).filter(b => b.id !== ticketId);
        const users = { ...remote.users };
        if (users[t.user]) {
          users[t.user] = { ...users[t.user], pc: users[t.user].pc + t.amount };
        }
        return { ...remote, bets, users };
      });
      if (result && result.err) alert(result.err);
    } catch (e) {
      console.warn('cancelBet failed', e);
    }
  };

  // ── INSCRIÇÕES (campeonatos "em breve") ───────────────────────────────────
  // Transação atômica direto no Firestore — evita race com outras escritas
  // que poderiam sobrescrever a lista de inscritos. Local state atualiza
  // sozinho via snapshot depois do write.
  const toggleInterest = async (champId) => {
    if (!session || !session.nick) return;
    const nick = session.nick;
    const ref = BET_DOC();
    let newMap = null;
    try {
      await window.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        // Lê interests da fonte top-level OU do json antigo (compat). Sem isso,
        // se o doc ainda não foi migrado e a 1a inscrição rolar aqui, perdemos
        // tudo que estava dentro do json.
        let cur = {};
        if (snap.exists) {
          const data = snap.data();
          if (data.interests && typeof data.interests === 'object') {
            cur = data.interests;
          } else if (typeof data.json === 'string') {
            try {
              const parsed = JSON.parse(data.json);
              if (parsed && parsed.interests && typeof parsed.interests === 'object') {
                cur = parsed.interests;
              }
            } catch (_) {}
          }
        }
        const map = { ...cur };
        const champ = { ...(map[champId] || {}) };
        if (champ[nick]) delete champ[nick];
        else champ[nick] = { at: Date.now() };
        map[champId] = champ;
        newMap = map;
        tx.set(ref, { interests: map, updatedAt: Date.now() }, { merge: true });
      });
      // Optimistic update local: a UI atualiza imediatamente sem esperar o
      // subscription do Firestore. Vai bater com o snapshot quando chegar.
      if (newMap) {
        setShared(s => ({ ...s, interests: newMap }));
      }
    } catch (e) {
      console.warn('toggleInterest failed', e);
      throw e;
    }
  };

  // Vincula um nick a um teamId via transação (cada nick = um time).
  const setTeamPlayer = async (teamId, nick) => {
    const cleaned = (nick || '').trim().toLowerCase();
    try {
      await commitBetDocUpdate(remote => {
        const map = { ...(remote.teamPlayers || {}) };
        if (cleaned) {
          for (const [tid, n] of Object.entries(map)) {
            if (n === cleaned && tid !== teamId) delete map[tid];
          }
          map[teamId] = cleaned;
        } else {
          delete map[teamId];
        }
        return { ...remote, teamPlayers: map };
      });
    } catch (e) { console.warn('setTeamPlayer failed', e); }
  };

  // Ajuste de PC pelo admin via transação (lê PC remoto, soma delta atomicamente).
  const adjustPc = async (nick, delta) => {
    try {
      await commitBetDocUpdate(remote => {
        const u = (remote.users || {})[nick];
        if (!u) return null;
        const users = { ...remote.users, [nick]: { ...u, pc: Math.max(0, u.pc + delta) } };
        return { ...remote, users };
      });
    } catch (e) { console.warn('adjustPc failed', e); }
  };

  if (!synced || cs === null) {
    return (
      <div className="login-stage">
        <div className="login-card">
          <div className="lh1">CONECTANDO</div>
          <div className="lh2">SINCRONIZANDO COM O SERVIDOR</div>
        </div>
      </div>
    );
  }

  if (!session || !me && !isAdmin) {
    return <Login onAuth={handleAuth} isNewNick={(n) => {
      const nick = (n || '').trim().toLowerCase();
      return !!nick && nick !== ADMIN_NICK && !users[nick];
    }} />;
  }

  const active = CHAMP_BY_ID[championship] || CHAMPIONSHIPS[0];

  return (
    <>
      <TopBar nick={session.nick} pc={isAdmin ? '∞' : me.pc} isAdmin={isAdmin} onLogout={logout} />
      <div className="page">
        <ChampionshipSelector
          value={championship}
          onChange={setChampionship}
          interests={interests || {}}
        />

        {active.status === 'active' ? (
          <>
            <Tabs tab={tab} setTab={setTab} isAdmin={isAdmin} />

            {tab === 'apostar' && (
              <ApostarView
                games={games} gamesById={gamesById} bets={bets} me={me} session={session} users={users}
                weeklyReady={weeklyReady} weeklyIn={weeklyIn} onClaim={claimWeekly}
                slip={slip} onToggleLeg={toggleLeg} onRemoveLeg={removeLeg}
                onClearSlip={clearSlip} onPlaceBet={placeBet} isAdmin={isAdmin}
              />
            )}
            {tab === 'tickets' && (
              <TicketsView bets={bets.filter(b => b.user === session.nick)} gamesById={gamesById} cs={cs} onCancel={cancelBet} />
            )}
            {tab === 'perfil' && (
              <MeuPerfilView
                nick={session.nick}
                me={me}
                cs={cs}
                bets={bets}
                teamPlayers={teamPlayers || {}}
                isAdmin={isAdmin}
              />
            )}
            {tab === 'ranking' && (
              <RankingView users={users} bets={bets} me={session.nick} />
            )}
            {tab === 'fama' && (
              <HallDaFamaView cs={cs} teamPlayers={teamPlayers || {}} />
            )}
            {tab === 'vergonha' && (
              <HallDaVergonhaView cs={cs} teamPlayers={teamPlayers || {}} />
            )}
            {tab === 'classificacao' && (
              <ClassificacaoView cs={cs} setCs={setCs} isAdmin={isAdmin} />
            )}
            {tab === 'admin' && isAdmin && (
              <AdminView
                bets={bets} users={users} adjustPc={adjustPc}
                teamPlayers={teamPlayers || {}} setTeamPlayer={setTeamPlayer}
              />
            )}
          </>
        ) : (
          <ChampionshipPlaceholder
            champ={active}
            session={session}
            interested={!!(interests?.[active.id]?.[session.nick])}
            count={Object.keys(interests?.[active.id] || {}).length}
            list={Object.keys(interests?.[active.id] || {}).sort()}
            isAdmin={isAdmin}
            onToggleInterest={() => toggleInterest(active.id)}
          />
        )}
      </div>
    </>
  );
}

// ─── TOP BAR / TABS ─────────────────────────────────────────────────────────
function TopBar({ nick, pc, isAdmin, onLogout }) {
  return (
    <div className="topbar">
      <div className="brand">
        <MiniCrest size={36} />
        <div className="brand-text">
          <div className="t1 display">PRIMITIVÃO</div>
          <div className="t2">APOSTAS · 2026</div>
        </div>
      </div>
      <div className="wallet">
        {!isAdmin && (
          <div className="pc-pill">
            <div className="pc-coin">P</div>
            <div>
              <div className="pc-amt">{pc}</div>
              <div className="pc-unit">PRIMITIVO COINS</div>
            </div>
          </div>
        )}
        <div className="nick">
          {isAdmin && <span className="nick-tag" style={{ color: 'var(--pv-orange)', borderColor: 'var(--pv-orange)' }}>ADMIN</span>}
          <span className="nick-tag">@{nick}</span>
        </div>
        <button className="logout-btn" onClick={onLogout}>SAIR</button>
      </div>
    </div>
  );
}

// ─── CAMPEONATO: seletor + página "em breve" ────────────────────────────────
function ChampionshipSelector({ value, onChange, interests }) {
  return (
    <div style={{
      display: 'flex', gap: 8, marginBottom: 14, overflowX: 'auto',
      paddingBottom: 4,
    }}>
      {CHAMPIONSHIPS.map(c => {
        const isActive = c.id === value;
        const count = Object.keys(interests?.[c.id] || {}).length;
        const isComing = c.status === 'soon';
        return (
          <button
            key={c.id}
            onClick={() => onChange(c.id)}
            style={{
              flexShrink: 0,
              padding: '10px 16px',
              border: '2px solid ' + (isActive ? 'var(--pv-orange)' : 'var(--pv-charcoal)'),
              background: isActive ? 'var(--pv-orange)' : 'transparent',
              color: isActive ? 'var(--pv-bone)' : 'var(--pv-charcoal)',
              fontWeight: 800,
              fontSize: 11,
              letterSpacing: '0.14em',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 2,
              lineHeight: 1.2,
            }}
          >
            <span style={{ fontSize: 10, opacity: 0.7 }}>
              {c.tag} {isComing ? '· EM BREVE' : '· ATIVO'}
              {isComing && count > 0 && ` · ${count}`}
            </span>
            <span>{c.season.toUpperCase()}</span>
          </button>
        );
      })}
    </div>
  );
}

function ChampionshipPlaceholder({ champ, session, interested, count, list, isAdmin, onToggleInterest }) {
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    setErrMsg('');
    try {
      await onToggleInterest();
    } catch (e) {
      setErrMsg('Não consegui registrar. Tenta de novo em alguns segundos.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <div className="card-head">
        <div className="title">{champ.name.toUpperCase()}</div>
        <div className="sub">{champ.season} · EM BREVE</div>
      </div>
      <div className="card-body" style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{
          fontFamily: 'Bagel Fat One, Impact', fontSize: 48,
          color: 'var(--pv-orange)', letterSpacing: '0.04em', lineHeight: 1,
        }}>
          EM BREVE
        </div>
        <p style={{ marginTop: 14, fontSize: 14, lineHeight: 1.6, maxWidth: 520, marginLeft: 'auto', marginRight: 'auto' }}>
          Esse campeonato ainda não começou. Se você tem interesse em participar,
          deixa sua inscrição abaixo — quanto mais gente, mais cedo a temporada sai
          do papel.
        </p>

        <div style={{ marginTop: 24 }}>
          {interested ? (
            <>
              <div style={{ fontSize: 12, letterSpacing: '0.2em', fontWeight: 800, color: 'var(--pv-green, #2a8)', marginBottom: 8 }}>
                ✓ INSCRIÇÃO REGISTRADA
              </div>
              <button onClick={handleClick} disabled={busy} style={{
                background: 'transparent', border: '1.5px solid var(--pv-charcoal)',
                color: 'var(--pv-charcoal)', padding: '8px 18px', fontWeight: 800,
                letterSpacing: '0.16em', fontSize: 11,
                cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
              }}>
                {busy ? 'AGUARDE…' : 'CANCELAR INSCRIÇÃO'}
              </button>
            </>
          ) : (
            <button onClick={handleClick} disabled={busy} style={{
              background: 'var(--pv-orange)', color: 'var(--pv-bone)',
              padding: '12px 28px', fontWeight: 800, border: 'none',
              letterSpacing: '0.18em', fontSize: 13,
              cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
            }}>
              {busy ? 'AGUARDE…' : 'QUERO PARTICIPAR'}
            </button>
          )}
          {errMsg && (
            <div style={{ marginTop: 10, color: 'var(--pv-red, #c33)', fontSize: 12, fontWeight: 700 }}>
              ✗ {errMsg}
            </div>
          )}
        </div>

        <div style={{ marginTop: 28, fontSize: 12, letterSpacing: '0.18em', fontWeight: 800, color: 'rgba(28,22,18,0.6)' }}>
          {count} {count === 1 ? 'INSCRITO' : 'INSCRITOS'}
        </div>
        {isAdmin && list && list.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 12, color: 'rgba(28,22,18,0.7)' }}>
            {list.map(n => '@' + n).join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}

function Tabs({ tab, setTab, isAdmin }) {
  const items = [
    { id: 'classificacao', label: 'CLASSIFICAÇÃO' },
    { id: 'apostar', label: 'JOGOS' },
    { id: 'ranking', label: 'RANKING' },
    { id: 'tickets', label: 'MEUS TICKETS' },
    { id: 'perfil', label: 'MEU PERFIL' },
    { id: 'fama', label: 'HALL DA FAMA' },
    { id: 'vergonha', label: 'HALL DA VERGONHA' },
  ];
  if (isAdmin) items.push({ id: 'admin', label: 'ADMIN' });
  const current = items.find(it => it.id === tab) || items[0];
  const [open, setOpen] = useState(false);

  // Fecha o drawer ao clicar fora.
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (e.target.closest && !e.target.closest('.tabs-mobile')) setOpen(false);
    };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('touchstart', onClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('touchstart', onClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const pick = (id) => { setTab(id); setOpen(false); };

  return (
    <>
      {/* Desktop: linha horizontal de pílulas */}
      <div className="tabs">
        {items.map(it => (
          <button key={it.id} className={'tab ' + (tab === it.id ? 'active' : '')} onClick={() => pick(it.id)}>
            {it.label}
          </button>
        ))}
      </div>

      {/* Mobile: hamburguer + drawer vertical */}
      <div className="tabs-mobile">
        <button
          className="tabs-mobile-btn"
          aria-expanded={open}
          aria-label="Menu de navegação"
          onClick={() => setOpen(o => !o)}
        >
          <span className="tabs-hamb">{open ? '✕' : '☰'}</span>
          <span className="tabs-current">{current.label}</span>
          <span className="tabs-chev">{open ? '▴' : '▾'}</span>
        </button>
        {open && (
          <div className="tabs-drawer" role="menu">
            {items.map(it => (
              <button
                key={it.id}
                role="menuitem"
                className={'tabs-drawer-item ' + (tab === it.id ? 'active' : '')}
                onClick={() => pick(it.id)}
              >
                {it.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ─── LOGIN ──────────────────────────────────────────────────────────────────
function Login({ onAuth, isNewNick }) {
  const [nick, setNick] = useState('');
  const [senha, setSenha] = useState('');
  const [senha2, setSenha2] = useState('');
  const [msg, setMsg] = useState('');
  const isNew = isNewNick ? isNewNick(nick) : false;
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e && e.preventDefault();
    if (busy) return;
    if (isNew && senha !== senha2) {
      setMsg('As senhas não conferem');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const err = await onAuth(nick, senha);
      if (err) setMsg(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-stage">
      <form className="login-card" onSubmit={submit}>
        <svg className="logo-svg" viewBox="0 0 200 240">
          <path d="M20 24 L 180 24 L 180 124 C 180 180 164 208 100 236 C 36 208 20 180 20 124 Z"
                fill="#d76414" stroke="#1c1612" strokeWidth="8" />
          <rect x="20" y="44" width="160" height="30" fill="#1c1612" />
          <text x="100" y="66" textAnchor="middle" fontFamily="Bungee Inline, Impact" fontSize="20" letterSpacing="2" fill="#f4ead7">PRIMITIVÃO</text>
          <ellipse cx="100" cy="140" rx="36" ry="50" fill="#1c1612" />
          <path d="M84 130 L 96 130 L 90 144 Z" fill="#f4ead7" />
          <path d="M104 130 L 116 130 L 110 144 Z" fill="#f4ead7" />
          <path d="M82 168 L 90 178 L 98 168 L 106 178 L 114 168 L 118 174 L 118 188 L 82 188 Z" fill="#f4ead7" />
        </svg>
        <div className="lh1">CASA DE APOSTAS</div>
        <div className="lh2">PRIMITIVO COINS · PC</div>
        <div className="field">
          <label>NICK</label>
          <input value={nick} onChange={e => { setNick(e.target.value); setMsg(''); }} placeholder="seu apelido" autoFocus autoCapitalize="off" autoCorrect="off" />
        </div>
        <div className="field">
          <label>SENHA</label>
          <input type="password" value={senha} onChange={e => setSenha(e.target.value)} placeholder="••••••" />
        </div>
        {isNew && (
          <div className="field">
            <label>CONFIRMAR SENHA</label>
            <input type="password" value={senha2} onChange={e => setSenha2(e.target.value)} placeholder="••••••" />
          </div>
        )}
        <button type="submit" className="login-btn" disabled={busy}>
          {busy ? 'AGUARDE…' : (isNew ? 'CRIAR CONTA' : 'ENTRAR')}
        </button>
        <div className="login-msg">{msg}</div>
      </form>
    </div>
  );
}

// ─── APOSTAR + CUPOM ────────────────────────────────────────────────────────
// games = lista derivada de cs.rounds (já filtrada por jogos não-jogados, com odds).
function ApostarView({ games, gamesById, bets, me, session, users, weeklyReady, weeklyIn, onClaim,
                        slip, onToggleLeg, onRemoveLeg, onClearSlip, onPlaceBet, isAdmin }) {
  const open = (games || []).slice().sort((a, b) => a.round - b.round || a.gi - b.gi);
  const ranking = Object.entries(users).map(([nick, u]) => ({ nick, pc: u.pc }))
    .sort((a, b) => b.pc - a.pc).slice(0, 5);
  const days = Math.floor(weeklyIn / (24 * 60 * 60 * 1000));
  const hrs  = Math.floor((weeklyIn % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

  return (
    <div className="grid">
      <div>
        {!isAdmin && (
          <div className={'bonus ' + (weeklyReady ? 'ready' : '')}>
            <div>
              <div className="small-label" style={{ color: weeklyReady ? 'var(--pv-charcoal)' : 'var(--pv-orange)' }}>BÔNUS SEMANAL</div>
              <div className="display" style={{ fontSize: 22, marginTop: 4 }}>
                {weeklyReady ? `+${WEEKLY_PC} PC DISPONÍVEIS` : `Disponível em ${days}d ${hrs}h`}
              </div>
            </div>
            <button onClick={onClaim} disabled={!weeklyReady}>{weeklyReady ? 'RECLAMAR' : 'BLOQUEADO'}</button>
          </div>
        )}

        <div className="card">
          <div className="card-head">
            <div className="title">JOGOS ABERTOS</div>
            <div className="sub">{open.length} DISPONÍVEIS · ODDS AUTO</div>
          </div>
          <div className="card-body">
            {open.length === 0 && <div className="empty"><div className="e1">SEM JOGOS</div><div className="e2">Todos os jogos já foram finalizados ou ainda não há rodadas.</div></div>}
            {open.map(g => (
              <GameRow key={g.id} game={g} slip={slip} onToggleLeg={onToggleLeg} canBet={!isAdmin} />
            ))}
          </div>
        </div>
      </div>

      <aside>
        {!isAdmin && (
          <Cupom slip={slip} gamesById={gamesById} balance={me ? me.pc : 0}
                 onRemoveLeg={onRemoveLeg} onClearSlip={onClearSlip} onPlaceBet={onPlaceBet} />
        )}

        <div className="card" style={{ marginTop: slip.length || !isAdmin ? 18 : 0 }}>
          <div className="card-head">
            <div className="title">TOP 5</div>
            <div className="sub">RANKING</div>
          </div>
          <div className="card-body">
            {ranking.length === 0 && <div className="empty"><div className="e2">Ainda não tem apostadores.</div></div>}
            {ranking.map((r, i) => (
              <div key={r.nick} className={'lb-row ' + (r.nick === session.nick ? 'me ' : '') + (i === 0 ? 'top1' : '')}>
                <div className="lb-pos">{i + 1}</div>
                <div className="lb-nick">@{r.nick}</div>
                <div className="lb-pc mono">{r.pc}</div>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

function OddBtn({ lab, val, selected, disabled, onClick }) {
  return (
    <button className={'odd-btn ' + (selected ? 'sel' : '')} disabled={disabled} onClick={onClick}>
      <div className="lab">{lab}</div>
      <div className="val">{Number(val).toFixed(2)}</div>
    </button>
  );
}

function GameRow({ game, slip, onToggleLeg, canBet }) {
  const h = TEAM(game.home), a = TEAM(game.away);
  const sel = (market, pick) => slip.some(s => s.fixtureId === game.id && s.market === market && s.pick === pick);
  const dis = !canBet;
  const o = game.odds || {};
  // Quantas pernas desse jogo já estão no cupom (mostra indicador no header
  // mesmo com a aposta colapsada).
  const legsHere = slip.filter(s => s.fixtureId === game.id).length;
  // Default expandido se já tem perna aqui; caso contrário começa colapsado.
  const [expanded, setExpanded] = useState(legsHere > 0);

  return (
    <div className={'fixture ' + (expanded ? 'expanded' : 'collapsed')}>
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%', background: 'transparent', border: 'none', padding: 0,
          textAlign: 'left', cursor: 'pointer', color: 'inherit', font: 'inherit',
        }}
      >
        <div className="fixture-top">
          <div className="fixture-tag">RODADA {String(game.round).padStart(2, '0')}</div>
          <div>
            {game.day} · {game.date} · {game.time}
            {legsHere > 0 && (
              <span style={{ marginLeft: 8, color: 'var(--pv-orange)', fontWeight: 800 }}>
                · {legsHere} NO CUPOM
              </span>
            )}
          </div>
        </div>
        <div className="fixture-match">
          <div className="fixture-team">
            <TeamMini team={h} size={42} />
            <div className="team-info"><div className="nm">{h.name}</div><div className="sh">{h.short} · MANDANTE</div></div>
          </div>
          <div className="vs"><span style={{ color: 'var(--pv-orange)' }}>×</span></div>
          <div className="fixture-team away">
            <TeamMini team={a} size={42} />
            <div className="team-info"><div className="nm">{a.name}</div><div className="sh">VISITANTE · {a.short}</div></div>
          </div>
        </div>
        <div style={{
          textAlign: 'center', marginTop: 6, fontSize: 10, letterSpacing: '0.22em',
          fontWeight: 800, color: 'var(--pv-orange)',
        }}>
          {expanded ? '▲ FECHAR PALPITES' : '▼ VER PALPITES'}
        </div>
      </button>

      {expanded && (
        <>
          <div className="mkt-label">RESULTADO</div>
          <div className="odds-row">
            <OddBtn lab={`${h.short} VENCE`} val={o['1X2']?.H} selected={sel('1X2','H')} disabled={dis} onClick={() => onToggleLeg(game, '1X2', 'H')} />
            <OddBtn lab="EMPATE"             val={o['1X2']?.D} selected={sel('1X2','D')} disabled={dis} onClick={() => onToggleLeg(game, '1X2', 'D')} />
            <OddBtn lab={`${a.short} VENCE`} val={o['1X2']?.A} selected={sel('1X2','A')} disabled={dis} onClick={() => onToggleLeg(game, '1X2', 'A')} />
          </div>

          <div className="mkt-label">AMBOS MARCAM</div>
          <div className="odds-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <OddBtn lab="SIM" val={o['BTTS']?.Y} selected={sel('BTTS','Y')} disabled={dis} onClick={() => onToggleLeg(game, 'BTTS', 'Y')} />
            <OddBtn lab="NÃO" val={o['BTTS']?.N} selected={sel('BTTS','N')} disabled={dis} onClick={() => onToggleLeg(game, 'BTTS', 'N')} />
          </div>

          <div className="mkt-label">NINGUÉM MARCA (0×0)</div>
          <div className="odds-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <OddBtn lab="SIM" val={o['NM']?.Y} selected={sel('NM','Y')} disabled={dis} onClick={() => onToggleLeg(game, 'NM', 'Y')} />
            <OddBtn lab="NÃO" val={o['NM']?.N} selected={sel('NM','N')} disabled={dis} onClick={() => onToggleLeg(game, 'NM', 'N')} />
          </div>

          <div className="mkt-label">+3 GOLS · {h.short}</div>
          <div className="odds-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <OddBtn lab="SIM" val={o['O3H']?.Y} selected={sel('O3H','Y')} disabled={dis} onClick={() => onToggleLeg(game, 'O3H', 'Y')} />
            <OddBtn lab="NÃO" val={o['O3H']?.N} selected={sel('O3H','N')} disabled={dis} onClick={() => onToggleLeg(game, 'O3H', 'N')} />
          </div>

          <div className="mkt-label">+3 GOLS · {a.short}</div>
          <div className="odds-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <OddBtn lab="SIM" val={o['O3A']?.Y} selected={sel('O3A','Y')} disabled={dis} onClick={() => onToggleLeg(game, 'O3A', 'Y')} />
            <OddBtn lab="NÃO" val={o['O3A']?.N} selected={sel('O3A','N')} disabled={dis} onClick={() => onToggleLeg(game, 'O3A', 'N')} />
          </div>
        </>
      )}
    </div>
  );
}

// ─── CUPOM (bet slip) ───────────────────────────────────────────────────────
function Cupom({ slip, gamesById, balance, onRemoveLeg, onClearSlip, onPlaceBet }) {
  const [amt, setAmt] = useState(10);
  const [busy, setBusy] = useState(false);
  const legs = slip.map(s => ({ ...s, _fix: gamesById ? gamesById[s.fixtureId] : null }));
  // SOMA (não multiplica) — ver placeBet.
  const combined = slip.reduce((p, l) => p + l.odds, 0);
  const payout = Math.round(amt * combined);
  const valid = !busy && slip.length > 0 && amt > 0 && amt <= balance;
  const multi = slip.length > 1;
  const handlePlace = async () => {
    if (busy) return;
    setBusy(true);
    try { await onPlaceBet(amt); }
    finally { setBusy(false); }
  };

  return (
    <div className="card cupom">
      <div className="card-head">
        <div className="title">CUPOM {multi ? '· CASADA' : ''}</div>
        <div className="sub">{slip.length} {slip.length === 1 ? 'PALPITE' : 'PALPITES'}</div>
      </div>
      <div className="card-body">
        {slip.length === 0 && (
          <div className="empty">
            <div className="e1">VAZIO</div>
            <div className="e2">Clica nas odds dos jogos pra montar. Vários palpites = aposta casada (odds multiplicam).</div>
          </div>
        )}

        {legs.map(l => (
          <div key={l.fixtureId + l.market + l.pick} className="cupom-leg">
            <div className="cupom-leg-txt">
              <div className="cupom-leg-mkt">{MARKET_TITLE[l.market] || l.market}</div>
              {legLabel(l)}
            </div>
            <div className="cupom-leg-odd mono">{l.odds.toFixed(2)}</div>
            <button className="cupom-leg-x" onClick={() => onRemoveLeg(l.fixtureId)}>✕</button>
          </div>
        ))}

        {slip.length > 0 && (
          <>
            <div className="modal-row" style={{ marginTop: 10 }}>
              <span className="lab">ODDS TOTAL</span>
              <span className="mono" style={{ color: 'var(--pv-orange)', fontWeight: 800 }}>{combined.toFixed(2)}x</span>
            </div>
            <div className="modal-row"><span className="lab">SALDO</span><span className="mono">{balance} PC</span></div>

            <div style={{ marginTop: 10 }} className="small-label">QUANTO APOSTAR (PC)</div>
            <input type="number" min="1" max={balance} value={amt}
                   onChange={e => setAmt(Math.max(0, Math.min(balance, +e.target.value || 0)))}
                   className="stake-input" />
            <div className="quick">
              <button onClick={() => setAmt(5)}>5</button>
              <button onClick={() => setAmt(10)}>10</button>
              <button onClick={() => setAmt(25)}>25</button>
              <button onClick={() => setAmt(balance)}>MAX</button>
            </div>

            <div className="payout-box">
              <div className="nm">RETORNO POTENCIAL</div>
              <div className="v">{payout} <span style={{ fontSize: 12, letterSpacing: '0.3em', fontFamily: 'Space Grotesk' }}>PC</span></div>
              <div style={{ fontSize: 10, letterSpacing: '0.22em', fontWeight: 800, color: 'var(--pv-orange)', marginTop: 4 }}>
                LUCRO LÍQUIDO: +{payout - amt} PC
              </div>
            </div>

            {multi && (
              <div style={{ fontSize: 10, letterSpacing: '0.12em', color: 'rgba(28,22,18,0.6)', fontWeight: 700, marginTop: 10 }}>
                ⚠ APOSTA CASADA: precisa acertar TODOS os {slip.length} palpites pra ganhar.
              </div>
            )}

            <div className="modal-btns">
              <button className="btn-secondary" onClick={onClearSlip} disabled={busy}>LIMPAR</button>
              <button className="btn-primary" disabled={!valid} onClick={handlePlace}>
                {busy ? 'APOSTANDO…' : `APOSTAR ${amt} PC`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── MEUS TICKETS ───────────────────────────────────────────────────────────
function TicketsView({ bets, gamesById, cs, onCancel }) {
  if (bets.length === 0) {
    return <div className="card"><div className="card-body"><div className="empty">
      <div className="e1">SEM TICKETS</div><div className="e2">Você ainda não apostou em nada.</div></div></div></div>;
  }
  const rounds = cs?.rounds || [];
  // Resolve o jogo de uma perna: pode estar em gamesById (ainda pendente)
  // ou já ter sido jogado (busca em cs.rounds). IDs antigos retornam null.
  const resolveGame = (fixtureId) => {
    if (gamesById && gamesById[fixtureId]) return gamesById[fixtureId];
    const p = parseGameId(fixtureId);
    if (!p) return null;
    const g = rounds[p.ri]?.[p.gi];
    return g ? { ...g, id: fixtureId } : null;
  };
  const sorted = [...bets].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div className="card">
      <div className="card-head"><div className="title">MEUS TICKETS</div><div className="sub">{bets.length} TOTAL</div></div>
      <div className="card-body">
        {sorted.map(t => {
          const cls = t.status === 'won' ? 'ticket won' : t.status === 'lost' ? 'ticket lost' : 'ticket';
          // Cancelar permitido só se NENHUMA perna já tem resultado.
          const blocked = t.legs.some(l => !!l.result);
          const multi = t.legs.length > 1;
          return (
            <div key={t.id} className={cls} style={{ gridTemplateColumns: '1fr auto' }}>
              <div>
                <div className="pick">
                  <small>{multi ? `CASADA · ${t.legs.length} PALPITES` : 'SIMPLES'} · @ {Number(t.combinedOdds).toFixed(2)}</small>
                  {t.legs.map((l, i) => {
                    const f = resolveGame(l.fixtureId);
                    const lg = { ...l, _fix: f };
                    const ic = l.result === 'win' ? '✓ ' : l.result === 'lose' ? '✕ ' : '• ';
                    const label = f ? legLabel(lg) : '(jogo removido)';
                    return <div key={i} style={{ fontWeight: 700, fontSize: 13, marginTop: 2 }}>{ic}{label} <span style={{ color: 'var(--pv-orange)' }}>@{l.odds.toFixed(2)}</span></div>;
                  })}
                </div>
                <div className={'status ' + t.status}>
                  {t.status === 'pending' ? 'EM ABERTO' : t.status === 'won' ? `VENCEU · +${t.payout} PC` : 'PERDEU'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="stake">{t.amount} <span style={{ fontSize: 10, fontFamily: 'Space Grotesk', letterSpacing: '0.2em' }}>PC</span></div>
                {t.status === 'pending' && !blocked && (
                  <button onClick={() => onCancel(t.id)} style={{
                    marginTop: 8, padding: '6px 10px', fontSize: 10, fontWeight: 800, letterSpacing: '0.18em',
                    background: 'transparent', border: '1.5px solid var(--pv-charcoal)',
                  }}>CANCELAR</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── RANKING ────────────────────────────────────────────────────────────────
// ─── PERFIL DO USUÁRIO ──────────────────────────────────────────────────────
// Lê teamPlayers pra descobrir qual time o nick representa. Mostra jogos do
// time, troféus de campeonatos terminados, resumo de apostas.
function reverseTeamMap(teamPlayers) {
  const out = {};
  for (const [tid, n] of Object.entries(teamPlayers || {})) {
    if (n) out[n] = tid;
  }
  return out;
}

// Retorna [{ champId, kind: 'champion'|'vice'|'lanterna'|'penultimo' }] pro nick dado.
function trophiesForNick(nick, cs, teamPlayers) {
  const playerTeam = reverseTeamMap(teamPlayers);
  const myTeam = playerTeam[nick];
  if (!myTeam) return [];
  const trophies = [];
  for (const c of CHAMPIONSHIPS) {
    const { status, standings } = computeChampStandings(c.id, cs);
    if (status !== 'closed' || !standings || standings.length < 2) continue;
    const last = standings.length - 1;
    if (standings[0].id === myTeam)        trophies.push({ champId: c.id, kind: 'champion' });
    else if (standings[1].id === myTeam)   trophies.push({ champId: c.id, kind: 'vice' });
    else if (standings[last].id === myTeam)   trophies.push({ champId: c.id, kind: 'lanterna' });
    else if (standings[last - 1].id === myTeam) trophies.push({ champId: c.id, kind: 'penultimo' });
  }
  return trophies;
}

function MeuPerfilView({ nick, me, cs, bets, teamPlayers, isAdmin }) {
  const playerTeam = reverseTeamMap(teamPlayers);
  const myTeamId = playerTeam[nick];
  const myTeam = myTeamId ? TEAM(myTeamId) : null;
  const rounds = cs?.rounds || [];

  // Jogos do meu time (todos, jogados ou não), com round/index.
  const myMatches = [];
  if (myTeamId) {
    rounds.forEach((round, ri) => round.forEach((g, gi) => {
      if (g.home === myTeamId || g.away === myTeamId) {
        myMatches.push({ ...g, ri, gi, round: ri + 1 });
      }
    }));
  }
  const played = myMatches.filter(g => isGamePlayed(g));
  const upcoming = myMatches.filter(g => !isGamePlayed(g));

  // Stats do meu time (V/E/D/Pts/SG) — usa computeStandings das rodadas jogadas.
  const stand = myTeamId
    ? computeStandings(rounds).find(s => s.id === myTeamId)
    : null;

  // Apostas
  const myBets = bets.filter(b => b.user === nick);
  const wonBets  = myBets.filter(b => b.status === 'won');
  const lostBets = myBets.filter(b => b.status === 'lost');
  const totalStake = myBets.reduce((s, b) => s + b.amount, 0);
  const totalReturn = wonBets.reduce((s, b) => s + (b.payout || 0), 0);

  const myTrophies = trophiesForNick(nick, cs, teamPlayers);

  return (
    <div>
      {/* HEADER */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <div>
            <div className="title">@{nick}</div>
            <div className="sub">{isAdmin ? 'ADMIN' : `${me?.pc ?? 0} PC`}</div>
          </div>
        </div>
      </div>

      {/* TIME */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <div className="title">MEU TIME</div>
          <div className="sub">{myTeam ? `${myTeam.name.toUpperCase()} · ${myTeam.short}` : 'NÃO VINCULADO'}</div>
        </div>
        <div className="card-body">
          {!myTeam ? (
            <div className="empty">
              <div className="e1">SEM TIME VINCULADO</div>
              <div className="e2">Peça pro admin te vincular a um time em ADMIN → TIMES.</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
                <TeamMini team={myTeam} size={72} />
                <div>
                  <div style={{ fontFamily: 'Bagel Fat One, Impact', fontSize: 32, lineHeight: 1 }}>
                    {myTeam.name}
                  </div>
                  {stand && (
                    <div style={{ marginTop: 6, fontSize: 12, letterSpacing: '0.14em', fontWeight: 700, color: 'rgba(28,22,18,0.7)' }}>
                      {stand.p} PTS · {stand.v}V {stand.e}E {stand.d}D · SG {(stand.gp - stand.gc) >= 0 ? '+' : ''}{stand.gp - stand.gc}
                    </div>
                  )}
                </div>
              </div>

              <div className="mkt-label" style={{ marginTop: 12 }}>JOGOS DISPUTADOS ({played.length})</div>
              {played.length === 0 && <div style={{ fontSize: 12, color: 'rgba(28,22,18,0.5)', padding: '6px 2px' }}>Nenhum jogo ainda.</div>}
              {played.map(g => <MatchRow key={`p-${g.ri}-${g.gi}`} g={g} myTeamId={myTeamId} />)}

              <div className="mkt-label" style={{ marginTop: 16 }}>PRÓXIMOS JOGOS ({upcoming.length})</div>
              {upcoming.length === 0 && <div style={{ fontSize: 12, color: 'rgba(28,22,18,0.5)', padding: '6px 2px' }}>Nenhum jogo agendado.</div>}
              {upcoming.map(g => <MatchRow key={`u-${g.ri}-${g.gi}`} g={g} myTeamId={myTeamId} />)}
            </>
          )}
        </div>
      </div>

      {/* TROFÉUS */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <div className="title">🏆 MEUS TROFÉUS</div>
          <div className="sub">{myTrophies.length}</div>
        </div>
        <div className="card-body">
          {myTrophies.length === 0 ? (
            <div className="empty">
              <div className="e1">VITRINE VAZIA</div>
              <div className="e2">Você ainda não conquistou nenhum campeonato encerrado.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {myTrophies.map(t => <TrophyItem key={t.champId + t.kind} trophy={t} />)}
            </div>
          )}
        </div>
      </div>

      {/* APOSTAS RESUMO */}
      <div className="card">
        <div className="card-head">
          <div className="title">MINHAS APOSTAS</div>
          <div className="sub">{myBets.length} TICKETS</div>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            <Stat label="APOSTADO" value={`${totalStake} PC`} />
            <Stat label="RETORNO" value={`${totalReturn} PC`} accent />
            <Stat label="VITÓRIAS" value={wonBets.length} />
            <Stat label="DERROTAS" value={lostBets.length} />
          </div>
        </div>
      </div>
    </div>
  );
}

function MatchRow({ g, myTeamId }) {
  const h = TEAM(g.home), a = TEAM(g.away);
  const played = isGamePlayed(g);
  const ghN = parseInt(g.gh, 10), gaN = parseInt(g.ga, 10);
  let outcome = null;
  if (played) {
    if (g.home === myTeamId) {
      outcome = ghN > gaN ? 'V' : ghN < gaN ? 'D' : 'E';
    } else {
      outcome = gaN > ghN ? 'V' : gaN < ghN ? 'D' : 'E';
    }
  }
  const outcomeColor = outcome === 'V' ? 'var(--pv-green, #2a8)'
                     : outcome === 'D' ? 'var(--pv-red, #c33)'
                     : 'rgba(28,22,18,0.5)';
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '48px 1fr auto auto', gap: 12,
      alignItems: 'center', padding: '8px 4px', borderBottom: '1px solid rgba(28,22,18,0.08)',
    }}>
      <div style={{ fontSize: 10, letterSpacing: '0.18em', fontWeight: 800, color: 'rgba(28,22,18,0.55)' }}>
        R{String(g.round).padStart(2, '0')}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: g.home === myTeamId ? 800 : 600 }}>{h.short}</span>
        <span style={{ color: 'rgba(28,22,18,0.4)' }}>×</span>
        <span style={{ fontWeight: g.away === myTeamId ? 800 : 600 }}>{a.short}</span>
      </div>
      <div style={{ fontFamily: 'mono', fontSize: 13, color: played ? 'var(--pv-orange)' : 'rgba(28,22,18,0.4)' }}>
        {played ? `${ghN}×${gaN}` : `${g.day} ${g.date}`}
      </div>
      <div style={{ width: 24, textAlign: 'center', fontWeight: 800, color: outcomeColor }}>
        {outcome || '·'}
      </div>
    </div>
  );
}

function TrophyItem({ trophy }) {
  const c = CHAMP_BY_ID[trophy.champId];
  const meta = {
    champion:  { icon: '🏆', label: 'CAMPEÃO',   color: '#c9a227', bg: '#fbf3d3' },
    vice:      { icon: '🥈', label: 'VICE',       color: '#7a7a7a', bg: '#ececec' },
    lanterna:  { icon: '🚽', label: 'LANTERNA',   color: '#7a2222', bg: '#fce4e4' },
    penultimo: { icon: '🪥', label: 'PENÚLTIMO',  color: '#3e0f0f', bg: '#f0e2e2' },
  }[trophy.kind] || { icon: '·', label: '', color: '#000', bg: '#eee' };
  return (
    <div style={{
      flex: '0 0 calc(50% - 6px)', maxWidth: 220,
      background: meta.bg, border: `2px solid ${meta.color}`,
      padding: 12, textAlign: 'center',
    }}>
      <div style={{ fontSize: 42, lineHeight: 1 }}>{meta.icon}</div>
      <div style={{ marginTop: 4, fontSize: 10, letterSpacing: '0.22em', fontWeight: 800, color: meta.color }}>
        {meta.label}
      </div>
      <div style={{ marginTop: 6, fontSize: 11, fontWeight: 700, color: 'rgba(28,22,18,0.75)' }}>
        {c?.tag} · {c?.season}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div style={{ padding: 10, background: 'rgba(0,0,0,0.03)' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.22em', fontWeight: 800, color: 'rgba(28,22,18,0.55)' }}>{label}</div>
      <div style={{
        marginTop: 4, fontFamily: 'Bagel Fat One, Impact', fontSize: 22,
        color: accent ? 'var(--pv-orange)' : 'inherit', lineHeight: 1.1,
      }}>
        {value}
      </div>
    </div>
  );
}

// ─── RANKING (apostadores por PC) ───────────────────────────────────────────
function RankingView({ users, bets, me }) {
  const rows = Object.entries(users).map(([nick, u]) => {
    const my = bets.filter(b => b.user === nick);
    return {
      nick, pc: u.pc, apostas: my.length,
      vit: my.filter(b => b.status === 'won').length,
      der: my.filter(b => b.status === 'lost').length,
    };
  }).sort((a, b) => b.pc - a.pc);
  return (
    <div className="card">
      <div className="card-head"><div className="title">RANKING GERAL</div><div className="sub">{rows.length} JOGADORES · POR PC</div></div>
      <div className="card-body">
        {rows.length === 0 && <div className="empty"><div className="e2">Ninguém cadastrado ainda.</div></div>}
        {rows.map((r, i) => (
          <div key={r.nick} className={'lb-row ' + (r.nick === me ? 'me' : '')} style={{ gridTemplateColumns: '36px 1fr auto auto auto', gap: 16 }}>
            <div className="lb-pos">{i + 1}</div>
            <div>
              <div className="lb-nick">@{r.nick}</div>
              <div style={{ fontSize: 10, letterSpacing: '0.22em', color: 'rgba(28,22,18,0.5)', fontWeight: 800, marginTop: 2 }}>{r.apostas} APOSTAS</div>
            </div>
            <div title="vitórias" style={{ color: 'var(--pv-green)', fontWeight: 800, fontFamily: 'Bagel Fat One', fontSize: 16 }}>{r.vit}<small style={{ fontFamily: 'Space Grotesk', fontSize: 9, letterSpacing: '0.2em', marginLeft: 3 }}>V</small></div>
            <div title="derrotas" style={{ color: 'var(--pv-red)', fontWeight: 800, fontFamily: 'Bagel Fat One', fontSize: 16 }}>{r.der}<small style={{ fontFamily: 'Space Grotesk', fontSize: 9, letterSpacing: '0.2em', marginLeft: 3 }}>D</small></div>
            <div className="lb-pc mono">{r.pc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── TROFÉUS POR CAMPEONATO (Hall da Fama / Hall da Vergonha) ──────────────
// Diferente do RANKING (apostadores), aqui o foco é o CAMPEONATO em si:
// quem foi campeão e vice (HoF), quem foi último e penúltimo (HoV).
// Só aparece quando o campeonato termina (todas as rodadas com placar).

function computeChampStandings(champId, cs) {
  // Hoje só FIFA tem dados estruturados em cs.rounds. MK/RL: 'soon'.
  if (champId !== 'fifa') return { status: 'soon' };
  const rounds = cs?.rounds || [];
  if (rounds.length === 0) return { status: 'soon' };
  const allDone = rounds.every(r => Array.isArray(r) && r.length > 0 && r.every(isGamePlayed));
  const standings = computeStandings(rounds);
  return {
    status: allDone ? 'closed' : 'ongoing',
    standings,
  };
}

function TrophyCard({ champ, slot1, slot2, theme }) {
  // theme: 'fame' (ouro/prata) | 'shame' (vinho)
  const isFame = theme === 'fame';
  const accent  = isFame ? '#c9a227' : '#7a2222';
  const accent2 = isFame ? '#9b7a1c' : '#3e0f0f';
  return (
    <div className="card" style={{ marginBottom: 14, borderTop: `3px solid ${accent}` }}>
      <div className="card-head" style={{ background: accent2, color: '#fff' }}>
        <div>
          <div className="title" style={{ color: '#fff' }}>{isFame ? '🏆' : '🚽'} {champ.name.toUpperCase()}</div>
          <div className="sub" style={{ color: 'rgba(255,255,255,0.7)' }}>{champ.season}</div>
        </div>
      </div>
      <div className="card-body">
        {slot1 ? (
          <div className="trophy-podiums">
            <TrophyPodium slot={slot1} accent={accent}  size="big"   theme={theme} />
            {slot2 && <TrophyPodium slot={slot2} accent={accent2} size="small" theme={theme} />}
          </div>
        ) : (
          <div className="empty">
            <div className="e1">{champ.status === 'soon' ? 'AINDA NÃO COMEÇOU' : 'EM ANDAMENTO'}</div>
            <div className="e2">
              {champ.status === 'soon'
                ? 'Campeonato em fase de inscrições.'
                : 'A temporada precisa terminar pra premiação aparecer aqui.'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TrophyPodium({ slot, accent, size, theme }) {
  const big = size === 'big';
  // Ícones: 1º lugar (big) ganha "troféu"; 2º (small) ganha "medalha".
  const isFame = theme === 'fame';
  const icon = big
    ? (isFame ? '🏆' : '🚽') // troféu (ou troféu-vergonha)
    : (isFame ? '🥈' : '🪥'); // medalha (ou escova-vergonha)
  return (
    <div style={{
      padding: big ? '18px 14px' : '14px 12px',
      background: 'rgba(0,0,0,0.04)',
      borderTop: `4px solid ${accent}`,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: big ? 64 : 44, lineHeight: 1 }}>{icon}</div>
      <div style={{
        marginTop: 6, fontSize: big ? 11 : 10, letterSpacing: '0.22em',
        fontWeight: 800, color: accent,
      }}>
        {slot.label}
      </div>
      <div style={{
        marginTop: 4, fontFamily: 'Bagel Fat One, Impact',
        fontSize: big ? 24 : 18, lineHeight: 1.1,
      }}>
        {slot.name}
      </div>
      {slot.detail && (
        <div style={{
          marginTop: 4, fontSize: big ? 10 : 9, letterSpacing: '0.14em',
          color: 'rgba(28,22,18,0.55)', fontWeight: 700,
        }}>
          {slot.detail}
        </div>
      )}
    </div>
  );
}

function buildSlots(view, standings) {
  // view: 'fame' (campeão+vice) | 'shame' (último+penúltimo)
  if (!standings || standings.length < 2) return [null, null];
  const formatDetail = (s) => `${s.p} pts · ${s.v}v ${s.e}e ${s.d}d · SG ${(s.gp - s.gc) >= 0 ? '+' : ''}${s.gp - s.gc}`;
  if (view === 'fame') {
    const first = standings[0], second = standings[1];
    return [
      { label: 'CAMPEÃO', name: first.name, detail: formatDetail(first) },
      { label: 'VICE',    name: second.name, detail: formatDetail(second) },
    ];
  } else {
    const last = standings[standings.length - 1];
    const penult = standings[standings.length - 2];
    return [
      { label: 'LANTERNA',  name: last.name,   detail: formatDetail(last)   },
      { label: 'PENÚLTIMO', name: penult.name, detail: formatDetail(penult) },
    ];
  }
}

function HallDaFamaView({ cs }) {
  return (
    <div>
      {CHAMPIONSHIPS.map(c => {
        const { status, standings } = computeChampStandings(c.id, cs);
        const [slot1, slot2] = status === 'closed' ? buildSlots('fame', standings) : [null, null];
        return (
          <TrophyCard
            key={c.id}
            champ={{ ...c, status }}
            slot1={slot1}
            slot2={slot2}
            theme="fame"
          />
        );
      })}
    </div>
  );
}

function HallDaVergonhaView({ cs }) {
  return (
    <div>
      {CHAMPIONSHIPS.map(c => {
        const { status, standings } = computeChampStandings(c.id, cs);
        const [slot1, slot2] = status === 'closed' ? buildSlots('shame', standings) : [null, null];
        return (
          <TrophyCard
            key={c.id}
            champ={{ ...c, status }}
            slot1={slot1}
            slot2={slot2}
            theme="shame"
          />
        );
      })}
    </div>
  );
}

// ─── CLASSIFICAÇÃO (aba) ────────────────────────────────────────────────────
// Controlled component: cs e setCs vêm do App (que mantém o subscribe ao
// primitivao/state, faz write-back e liquidação automática das apostas).
function ClassificacaoView({ cs, setCs, isAdmin }) {
  const [viewRound, setViewRound] = useState(0); // LOCAL: rodada que ESTE usuário está vendo
  const initViewRef = useRef(false);

  // Na primeira vez que cs carrega, inicializa viewRound com a "rodada oficial".
  // Depois disso, navegação é puramente local — não afeta outros usuários.
  useEffect(() => {
    if (!cs || initViewRef.current) return;
    initViewRef.current = true;
    const cr = Number.isInteger(cs.currentRound) ? cs.currentRound : 0;
    setViewRound(Math.max(0, Math.min(TOTAL_ROUNDS - 1, cr)));
  }, [cs]);

  if (!cs) {
    return <div className="card"><div className="card-body"><div className="empty"><div className="e1">CARREGANDO…</div></div></div></div>;
  }

  const standings = computeStandings(cs.rounds);
  const round = cs.rounds[viewRound] || [];

  const patchMatch = (gi, patch) => {
    setCs(prev => {
      const rounds = prev.rounds.map((r, ri) => ri !== viewRound ? r : r.map((m, mi) => mi === gi ? { ...m, ...patch } : m));
      return { ...prev, rounds };
    });
  };

  return (
    <div className="grid">
      <div className="card">
        <div className="card-head">
          <div className="title">CLASSIFICAÇÃO</div>
          <div className="sub">PRIMITIVÃO · IDA</div>
        </div>
        <div className="card-body" style={{ overflowX: 'auto' }}>
          <table className="std-table">
            <thead>
              <tr><th>#</th><th style={{ textAlign: 'left' }}>TIME</th><th>J</th><th>V</th><th>E</th><th>D</th><th>SG</th><th>P</th></tr>
            </thead>
            <tbody>
              {standings.map((s, i) => {
                const sg = s.gp - s.gc;
                const cls = i < 2 ? 'glory' : i >= standings.length - 2 ? 'releg' : '';
                return (
                  <tr key={s.id} className={cls}>
                    <td className="std-pos">{String(i + 1).padStart(2, '0')}</td>
                    <td><div className="tnm"><TeamMini team={s.id} size={22} />{s.name}</div></td>
                    <td>{s.j}</td><td style={{ fontWeight: 800 }}>{s.v}</td><td>{s.e}</td>
                    <td style={{ color: 'rgba(28,22,18,0.45)' }}>{s.d}</td>
                    <td>{sg > 0 ? '+' + sg : sg}</td>
                    <td style={{ fontFamily: 'Bagel Fat One, Impact', fontSize: 16 }}>{s.p}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <aside>
        <div className="card">
          <div className="card-head">
            <div className="title">RODADA {String(viewRound + 1).padStart(2, '0')}</div>
            <div className="sub">{isAdmin ? 'EDITÁVEL' : 'SOMENTE LEITURA'}</div>
          </div>
          <div className="card-body">
            <div className="round-tabs">
              {Array.from({ length: TOTAL_ROUNDS }).map((_, i) => (
                <button key={i} className={'rt ' + (i === viewRound ? 'active' : '')}
                        onClick={() => setViewRound(i)}>
                  {String(i + 1).padStart(2, '0')}
                </button>
              ))}
            </div>

            {round.map((m, gi) => {
              const h = TEAM(m.home), a = TEAM(m.away);
              const ghN = parseInt(m.gh, 10), gaN = parseInt(m.ga, 10);
              const played = !Number.isNaN(ghN) && !Number.isNaN(gaN);
              return (
                <div key={gi} className="cmatch">
                  <div className="cmatch-top">
                    <span>JOGO {String(gi + 1).padStart(2, '0')}</span>
                    <span>{m.day} · {m.date} · {m.time}</span>
                  </div>
                  <div className="cmatch-body">
                    <div style={{ textAlign: 'center' }}>
                      <TeamMini team={h} size={34} />
                      {isAdmin ? (
                        <select className="cteam-sel" value={m.home} onChange={e => patchMatch(gi, { home: e.target.value })}>
                          {TEAMS.map(t => <option key={t.id} value={t.id}>{t.short}</option>)}
                        </select>
                      ) : <div style={{ fontWeight: 800, fontSize: 12, marginTop: 4 }}>{h.short}</div>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                      {isAdmin ? (
                        <>
                          <input className="cscore-in" value={m.gh} placeholder="–"
                                 onChange={e => patchMatch(gi, { gh: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
                          <span className="display">×</span>
                          <input className="cscore-in" value={m.ga} placeholder="–"
                                 onChange={e => patchMatch(gi, { ga: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
                        </>
                      ) : (
                        <div className="display" style={{ fontSize: 22, color: played ? 'var(--pv-orange)' : 'rgba(28,22,18,0.3)' }}>
                          {played ? `${ghN} × ${gaN}` : '– × –'}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <TeamMini team={a} size={34} />
                      {isAdmin ? (
                        <select className="cteam-sel" value={m.away} onChange={e => patchMatch(gi, { away: e.target.value })}>
                          {TEAMS.map(t => <option key={t.id} value={t.id}>{t.short}</option>)}
                        </select>
                      ) : <div style={{ fontWeight: 800, fontSize: 12, marginTop: 4 }}>{a.short}</div>}
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="cmatch-foot">
                      <input className="cfld" value={m.day} maxLength={3} placeholder="DIA"
                             onChange={e => patchMatch(gi, { day: e.target.value.toUpperCase().slice(0, 3) })} />
                      <input className="cfld" value={m.date} maxLength={5} placeholder="DATA"
                             onChange={e => patchMatch(gi, { date: e.target.value })} />
                      <input className="cfld" value={m.time} maxLength={5} placeholder="HORA"
                             onChange={e => patchMatch(gi, { time: e.target.value })} />
                      <button className="cclear" onClick={() => patchMatch(gi, { gh: '', ga: '' })}>LIMPAR</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </aside>
    </div>
  );
}

// ─── ADMIN ──────────────────────────────────────────────────────────────────
function AdminView({ bets, users, adjustPc, teamPlayers, setTeamPlayer }) {
  // Tabs do admin: USUÁRIOS / TIMES / BACKUP / PERIGO. PERIGO ficou em aba
  // separada pra não ser clicado por engano achando que era backup.
  const [tab, setTab] = useState('usuarios');
  const playerTeam = reverseTeamMap(teamPlayers);

  return (
    <>
      <div className="tabs" style={{ marginBottom: 14 }}>
        <button className={'tab ' + (tab === 'usuarios' ? 'active' : '')} onClick={() => setTab('usuarios')}>USUÁRIOS</button>
        <button className={'tab ' + (tab === 'times' ? 'active' : '')} onClick={() => setTab('times')}>TIMES</button>
        <button className={'tab ' + (tab === 'backup' ? 'active' : '')} onClick={() => setTab('backup')}>BACKUP</button>
        <button className={'tab ' + (tab === 'perigo' ? 'active' : '')} onClick={() => setTab('perigo')} style={{ color: tab === 'perigo' ? '#c33' : 'rgba(195,51,51,0.6)' }}>⚠ PERIGO</button>
      </div>

      {tab === 'usuarios' && (
        <div className="card">
          <div className="card-head"><div className="title">USUÁRIOS</div><div className="sub">{Object.keys(users).length} CADASTRADOS</div></div>
          <div className="card-body">
            {Object.entries(users).map(([nick, u]) => {
              const tid = playerTeam[nick];
              const team = tid ? TEAM(tid) : null;
              return (
                <div key={nick} className="lb-row" style={{ gridTemplateColumns: '1fr auto auto auto', gap: 10 }}>
                  <div>
                    <div className="lb-nick">@{nick}</div>
                    {team && (
                      <div style={{ fontSize: 10, letterSpacing: '0.18em', fontWeight: 800, color: 'var(--pv-orange)', marginTop: 2 }}>
                        TIME: {team.name.toUpperCase()}
                      </div>
                    )}
                  </div>
                  <button onClick={() => adjustPc(nick, -10)} style={{ background: 'transparent', border: '1.5px solid var(--pv-charcoal)', padding: '4px 8px', fontWeight: 800 }}>-10</button>
                  <div className="lb-pc mono">{u.pc}</div>
                  <button onClick={() => adjustPc(nick, 10)} style={{ background: 'var(--pv-orange)', border: '1.5px solid var(--pv-charcoal)', padding: '4px 8px', fontWeight: 800, color: 'var(--pv-bone)' }}>+10</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'times' && (
        <div className="card">
          <div className="card-head">
            <div className="title">TIMES DO CAMPEONATO</div>
            <div className="sub">VINCULE CADA TIME A UM USUÁRIO</div>
          </div>
          <div className="card-body">
            <p style={{ marginTop: 0, fontSize: 12, lineHeight: 1.5, color: 'rgba(28,22,18,0.7)' }}>
              Aqui você define quem é cada time. O usuário vinculado vai ver "MEU TIME" no perfil
              dele, com jogos passados, próximos e troféus dos campeonatos que esse time vencer.
            </p>
            {TEAMS.map(t => (
              <div key={t.id} className="lb-row" style={{ gridTemplateColumns: 'auto 1fr auto', gap: 12, alignItems: 'center' }}>
                <TeamMini team={t} size={36} />
                <div>
                  <div style={{ fontWeight: 800 }}>{t.name}</div>
                  <div style={{ fontSize: 10, letterSpacing: '0.18em', color: 'rgba(28,22,18,0.5)', fontWeight: 800 }}>{t.short}</div>
                </div>
                <select
                  value={teamPlayers[t.id] || ''}
                  onChange={e => setTeamPlayer(t.id, e.target.value)}
                  style={{ padding: '6px 10px', fontWeight: 700, minWidth: 140 }}
                >
                  <option value="">— sem vínculo —</option>
                  {Object.keys(users).sort().map(nick => (
                    <option key={nick} value={nick}>@{nick}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'backup' && (
        <>
          <BackupPanel />
          <RestorePanel />
        </>
      )}

      {tab === 'perigo' && (
        <DangerZone />
      )}
    </>
  );
}

function BackupPanel() {
  const [status, setStatus] = useState(null); // null | 'running' | {ok, users?, bets?, error?}
  const onClick = async () => {
    setStatus('running');
    const result = await downloadFullBackup();
    setStatus(result);
  };
  return (
    <div className="card">
      <div className="card-head">
        <div className="title">BACKUP DE DADOS</div>
        <div className="sub">EXPORTA TUDO EM JSON</div>
      </div>
      <div className="card-body">
        <p style={{ marginTop: 0, lineHeight: 1.5 }}>
          Gera um arquivo <code>.json</code> com <strong>todos os dados do site</strong>: usuários,
          apostas, jogos e classificação. Guarde em local seguro (Drive, e-mail pra você mesmo, etc).
          Um backup automático também é gerado todo dia pelo GitHub Action e fica em <code>backups/</code> no repo.
        </p>
        <button onClick={onClick} disabled={status === 'running'}
          style={{ background: 'var(--pv-orange)', color: 'var(--pv-bone)', padding: '10px 20px', fontWeight: 800, border: 'none', letterSpacing: '0.16em', fontSize: 12, cursor: status === 'running' ? 'wait' : 'pointer' }}>
          {status === 'running' ? 'GERANDO…' : '↓ BAIXAR BACKUP JSON'}
        </button>
        {status && status !== 'running' && status.ok && (
          <p style={{ marginTop: 14, color: 'var(--pv-green, #2a8)' }}>
            ✓ Backup baixado. {status.users} usuários, {status.bets} apostas.
          </p>
        )}
        {status && status !== 'running' && !status.ok && (
          <p style={{ marginTop: 14, color: 'var(--pv-red, #c33)' }}>
            ✗ Erro: {status.error}
          </p>
        )}
      </div>
    </div>
  );
}

// Lê o arquivo de backup que o usuário escolheu e devolve o JSON parseado.
function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Erro lendo arquivo'));
    r.onload = (ev) => {
      try { resolve(JSON.parse(ev.target.result)); }
      catch (e) { reject(new Error('JSON inválido: ' + e.message)); }
    };
    r.readAsText(file);
  });
}

function RestorePanel() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null); // {users, bets, ...} | {error}
  const [status, setStatus] = useState(null);   // null | 'running' | {ok, applied?, error?}

  const onFileChange = async (e) => {
    setStatus(null);
    const f = e.target.files && e.target.files[0];
    if (!f) { setFile(null); setPreview(null); return; }
    setFile(f);
    try {
      const data = await readJsonFile(f);
      const apostas = data.apostas;
      const classificacao = data.classificacao;
      if (apostas == null && classificacao == null) {
        setPreview({ error: 'JSON não tem campo `apostas` nem `classificacao`.' });
        return;
      }
      setPreview({
        users:     Object.keys(apostas?.users || {}).length,
        bets:      (apostas?.bets || []).length,
        teams:     Object.keys(apostas?.teamPlayers || {}).length,
        interests: Object.values(apostas?.interests || {})
                          .reduce((s, x) => s + Object.keys(x || {}).length, 0),
        rounds:    (classificacao?.rounds || []).length,
        exportedAt: data.exportedAt || '(sem data)',
        version:   data.version || 1,
      });
    } catch (e) {
      setPreview({ error: String(e.message || e) });
    }
  };

  const onRestore = async () => {
    if (!file || !preview || preview.error) return;
    const ok = window.confirm(
      'Vai SOBRESCREVER o estado atual com o conteúdo do backup.\n\n' +
      'Um backup de segurança do estado ATUAL vai ser baixado antes (caso queira voltar).\n\n' +
      'Confirma?'
    );
    if (!ok) return;
    setStatus('running');
    try {
      const payload = await readJsonFile(file);
      const result = await restoreFromBackup(payload);
      setStatus(result);
    } catch (e) {
      setStatus({ ok: false, error: String(e.message || e) });
    }
  };

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-head">
        <div className="title">↻ RESTAURAR BACKUP</div>
        <div className="sub">UPLOAD DE JSON</div>
      </div>
      <div className="card-body">
        <p style={{ marginTop: 0, lineHeight: 1.5 }}>
          Carrega um arquivo <code>.json</code> gerado pelo backup e
          <strong> sobrescreve</strong> o estado atual do site (usuários, apostas, times
          vinculados, inscrições e classificação). Um <strong>backup de segurança</strong> do
          estado atual é baixado automaticamente antes — se algo der errado, é só restaurar
          ele de volta.
        </p>

        <input
          type="file"
          accept=".json,application/json"
          onChange={onFileChange}
          disabled={status === 'running'}
          style={{ marginTop: 8 }}
        />

        {preview && preview.error && (
          <div style={{ marginTop: 12, padding: 10, background: '#fce4e4', border: '1.5px solid #c33', color: '#7a2222', fontSize: 12, fontWeight: 700 }}>
            ✗ {preview.error}
          </div>
        )}

        {preview && !preview.error && (
          <div style={{ marginTop: 14, padding: 14, background: 'rgba(0,0,0,0.04)', border: '2px solid var(--pv-charcoal)' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.22em', fontWeight: 800, marginBottom: 8 }}>PRÉ-VIEW DO BACKUP</div>
            <div style={{ fontSize: 12, lineHeight: 1.8 }}>
              · <strong>{preview.users}</strong> usuários<br />
              · <strong>{preview.bets}</strong> apostas (tickets)<br />
              · <strong>{preview.teams}</strong> times vinculados a usuários<br />
              · <strong>{preview.interests}</strong> inscrições em campeonatos<br />
              · <strong>{preview.rounds}</strong> rodadas de classificação<br />
              · Exportado em: <code>{preview.exportedAt}</code> (v{preview.version})
            </div>

            <button
              onClick={onRestore}
              disabled={status === 'running'}
              style={{
                marginTop: 14,
                background: 'var(--pv-charcoal)', color: 'var(--pv-bone)',
                padding: '10px 20px', fontWeight: 800, border: 'none',
                letterSpacing: '0.16em', fontSize: 12,
                cursor: status === 'running' ? 'wait' : 'pointer',
              }}
            >
              {status === 'running' ? 'RESTAURANDO…' : '↻ RESTAURAR (sobrescreve atual)'}
            </button>
          </div>
        )}

        {status && status !== 'running' && status.ok && (
          <p style={{ marginTop: 14, color: 'var(--pv-green, #2a8)', fontWeight: 700 }}>
            ✓ Backup restaurado. {status.applied.users} usuários, {status.applied.bets} apostas,{' '}
            {status.applied.teams} vínculos de time, {status.applied.rounds} rodadas, {status.applied.interests} inscrições.
          </p>
        )}
        {status && status !== 'running' && !status.ok && (
          <p style={{ marginTop: 14, color: 'var(--pv-red, #c33)', fontWeight: 700 }}>
            ✗ {status.error}
          </p>
        )}
      </div>
    </div>
  );
}

// Frase exata que o admin precisa digitar pra liberar o botão de reset.
const WIPE_CONFIRM_PHRASE = 'DELETAR TUDO';

function DangerZone() {
  const [confirmText, setConfirmText] = useState('');
  const [status, setStatus] = useState(null); // null | 'running' | {ok, error?}
  const canFire = confirmText.trim() === WIPE_CONFIRM_PHRASE && status !== 'running';

  const onClick = async () => {
    if (!canFire) return;
    setStatus('running');
    const result = await wipeAllData();
    setStatus(result);
    if (result.ok) setConfirmText('');
  };

  return (
    <div className="card" style={{ marginTop: 20, border: '2px solid #c33' }}>
      <div className="card-head" style={{ background: '#3a0e0e' }}>
        <div className="title" style={{ color: '#ff8a8a' }}>⚠ ZONA DE PERIGO</div>
        <div className="sub" style={{ color: '#ffb3b3' }}>OPERAÇÃO IRREVERSÍVEL</div>
      </div>
      <div className="card-body">
        <p style={{ marginTop: 0, lineHeight: 1.5 }}>
          <strong>Apaga todos os dados do site:</strong> usuários, apostas,
          resultados de jogos e classificação. Os jogos voltam pro estado
          inicial (rodada 1, 4 partidas seed). <strong>Não dá pra desfazer.</strong>
        </p>
        <p style={{ lineHeight: 1.5 }}>
          Antes de deletar, o sistema vai <strong>baixar automaticamente um
          backup completo</strong> pro seu computador. Se o backup falhar, o
          reset é abortado.
        </p>
        <p style={{ lineHeight: 1.5 }}>
          Pra confirmar, digite <code style={{ background: '#222', padding: '2px 6px', color: '#ff8a8a' }}>{WIPE_CONFIRM_PHRASE}</code> no campo abaixo:
        </p>
        <input
          type="text"
          value={confirmText}
          onChange={e => setConfirmText(e.target.value)}
          placeholder={WIPE_CONFIRM_PHRASE}
          disabled={status === 'running'}
          style={{ width: '100%', maxWidth: 280, padding: '8px 12px', fontSize: 14, fontFamily: 'monospace', border: '1.5px solid #c33', background: '#1a0606', color: '#ff8a8a', marginBottom: 12, letterSpacing: '0.1em' }}
        />
        <div>
          <button
            onClick={onClick}
            disabled={!canFire}
            style={{
              background: canFire ? '#c33' : '#5a2a2a',
              color: canFire ? '#fff' : '#999',
              padding: '10px 20px',
              fontWeight: 800,
              border: 'none',
              letterSpacing: '0.16em',
              fontSize: 12,
              cursor: canFire ? 'pointer' : 'not-allowed',
            }}
          >
            {status === 'running' ? 'EXECUTANDO…' : '🗑 DELETAR TUDO AGORA'}
          </button>
        </div>
        {status && status !== 'running' && status.ok && (
          <p style={{ marginTop: 14, color: 'var(--pv-green, #2a8)' }}>
            ✓ Tudo resetado. Backup baixado: {status.backedUp.users} usuários, {status.backedUp.bets} apostas salvos no arquivo.
          </p>
        )}
        {status && status !== 'running' && !status.ok && (
          <p style={{ marginTop: 14, color: 'var(--pv-red, #c33)' }}>
            ✗ {status.error}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── MOUNT ──────────────────────────────────────────────────────────────────
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
