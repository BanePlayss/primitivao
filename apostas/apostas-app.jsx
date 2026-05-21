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

const START_PC = 50;
const WEEKLY_PC = 500;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Toda vez que o valor do bônus mudar e quisermos liberar pra todos
// novamente, atualizamos este timestamp pro "agora". Usuários cujo
// `lastWeekly` é anterior a este marco ficam imediatamente elegíveis,
// mesmo sem ter passado a semana.
const WEEKLY_RELEASE_AT = Date.UTC(2026, 4, 21, 0, 0, 0); // 2026-05-21 00:00 UTC

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

async function downloadFullBackup() {
  try {
    const [betSnap, classifSnap] = await Promise.all([
      BET_DOC().get(),
      CLASSIF_DOC().get(),
    ]);
    const apostas       = parseDocJsonSafe(betSnap);
    const classificacao = parseDocJsonSafe(classifSnap);
    const payload = {
      exportedAt: new Date().toISOString(),
      version: 2,
      source: 'browser-admin',
      apostas:       apostas.data,
      classificacao: classificacao.data,
      // metadados crus pra nunca perder dado mesmo se o parse falhar.
      _raw: { apostas, classificacao },
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
        json: JSON.stringify({ users: {}, fixtures: DEFAULT_FIXTURES, bets: [] }),
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
  const [shared, setShared] = useState({ users: {}, fixtures: DEFAULT_FIXTURES, bets: [] });
  const { users, fixtures, bets } = shared;
  const setUsers    = (u) => setShared(s => ({ ...s, users:    typeof u === 'function' ? u(s.users)    : u }));

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

  const hasLoadedRef        = useRef(false);
  const isApplyingRemoteRef = useRef(false);

  // ── Firestore: apostas doc ────────────────────────────────────────────────
  useEffect(() => {
    const ref = BET_DOC();
    const unsub = ref.onSnapshot(snap => {
      if (!snap.exists) {
        ref.set({ json: JSON.stringify({ users: {}, fixtures: DEFAULT_FIXTURES, bets: [] }), updatedAt: Date.now() })
           .catch(e => console.warn('Firestore seed failed', e));
        hasLoadedRef.current = true; setSynced(true);
        return;
      }
      try {
        const remote = JSON.parse(snap.data().json);
        isApplyingRemoteRef.current = true;
        setShared({
          users:    remote.users && typeof remote.users === 'object' ? remote.users : {},
          fixtures: Array.isArray(remote.fixtures) ? remote.fixtures.map(normFixture) : DEFAULT_FIXTURES,
          bets:     Array.isArray(remote.bets) ? remote.bets.map(normBet) : [],
        });
        hasLoadedRef.current = true; setSynced(true);
      } catch (e) { console.warn('Firestore parse failed', e); }
    }, err => console.warn('Firestore subscription failed', err));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!hasLoadedRef.current) return;
    if (isApplyingRemoteRef.current) { isApplyingRemoteRef.current = false; return; }
    const t = setTimeout(() => {
      BET_DOC().set({ json: JSON.stringify(shared), updatedAt: Date.now() })
               .catch(e => console.warn('Firestore write failed', e));
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
    const t = setTimeout(() => {
      CLASSIF_DOC().set({ json: JSON.stringify(cs), updatedAt: Date.now() })
                   .catch(e => console.warn(e));
    }, 300);
    return () => clearTimeout(t);
  }, [cs]);

  // ── Liquidação automática: roda sempre que cs muda. Resolve ou reverte
  //    pernas de apostas baseado nos placares das rounds. Suporta undo:
  //    se admin apagar um placar, perna volta a pending e payout é estornado.
  useEffect(() => {
    if (!cs || !hasLoadedRef.current || !shared.bets || shared.bets.length === 0) return;
    let dirty = false;
    const newUsers = { ...shared.users };
    const newBets = shared.bets.map(b => {
      let changed = false;
      const legs = b.legs.map(l => {
        const p = parseGameId(l.fixtureId);
        if (!p) return l; // ID antigo ou inválido; deixa pendente
        const g = cs.rounds?.[p.ri]?.[p.gi];
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
      // estorna se deixou de ser vencedor
      if (oldStatus === 'won' && newStatus !== 'won' && oldPayout > 0 && newUsers[b.user]) {
        newUsers[b.user] = { ...newUsers[b.user], pc: Math.max(0, newUsers[b.user].pc - oldPayout) };
      }
      // paga se virou vencedor
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
    if (dirty) setShared(s => ({ ...s, users: newUsers, bets: newBets }));
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

  const handleAuth = (nick, senha) => {
    nick = nick.trim().toLowerCase();
    if (!nick || !senha) return 'Preencha nick e senha';
    if (nick === ADMIN_NICK) {
      if (senha !== ADMIN_PASS) return 'Senha de admin incorreta';
      setSession({ nick }); return null;
    }
    const existing = users[nick];
    if (existing) {
      if (existing.senha !== senha) return 'Senha incorreta';
      setSession({ nick }); return null;
    }
    setUsers(u => ({ ...u, [nick]: { senha, pc: START_PC, joined: Date.now(), lastWeekly: 0 } }));
    setSession({ nick });
    return null;
  };

  const logout = () => { setSession(null); setTab('apostar'); setSlip([]); };

  const claimWeekly = () => {
    if (!me || isAdmin) return;
    const now = Date.now();
    const fresh = (now - me.lastWeekly) >= WEEK_MS || me.lastWeekly < WEEKLY_RELEASE_AT;
    if (!fresh) return;
    setUsers(u => ({ ...u, [session.nick]: { ...u[session.nick], pc: u[session.nick].pc + WEEKLY_PC, lastWeekly: now } }));
  };
  const weeklyReady = me
    ? (Date.now() - me.lastWeekly >= WEEK_MS || me.lastWeekly < WEEKLY_RELEASE_AT)
    : false;
  const weeklyIn = me && !weeklyReady ? Math.max(0, WEEK_MS - (Date.now() - me.lastWeekly)) : 0;

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

  const placeBet = (amount) => {
    if (!me || slip.length === 0) return;
    // valida: todo jogo do cupom ainda precisa estar pendente em cs.rounds
    for (const l of slip) {
      const g = gameById[l.fixtureId];
      if (!g) { alert('Um dos jogos do cupom não está mais disponível.'); return; }
    }
    if (amount <= 0 || amount > me.pc) return;
    // Aposta casada SOMA as odds em vez de multiplicar (decisão do dono:
    // produto explode pagamento; soma deixa o crescimento linear).
    const co = +slip.reduce((p, l) => p + l.odds, 0).toFixed(2);
    const ticket = {
      id: 't' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      user: session.nick, amount, status: 'pending', createdAt: Date.now(),
      combinedOdds: co,
      legs: slip.map(l => ({ fixtureId: l.fixtureId, market: l.market, pick: l.pick, odds: l.odds })),
    };
    setShared(s => ({
      ...s,
      bets: [ticket, ...s.bets],
      users: { ...s.users, [session.nick]: { ...s.users[session.nick], pc: s.users[session.nick].pc - amount } },
    }));
    setSlip([]);
  };

  const cancelBet = (ticketId) => {
    setShared(s => {
      const t = s.bets.find(b => b.id === ticketId);
      if (!t || t.status !== 'pending') return s;
      if (t.user !== session.nick && session.nick !== ADMIN_NICK) return s;
      // bloqueio: se alguma perna já foi liquidada, não dá pra cancelar
      const settled = t.legs.some(l => !!l.result);
      if (settled) { alert('Esse cupom já tem jogos finalizados.'); return s; }
      return {
        ...s,
        bets: s.bets.filter(b => b.id !== ticketId),
        users: { ...s.users, [t.user]: { ...s.users[t.user], pc: s.users[t.user].pc + t.amount } },
      };
    });
  };

  const adjustPc = (nick, delta) => {
    setUsers(u => u[nick] ? ({ ...u, [nick]: { ...u[nick], pc: Math.max(0, u[nick].pc + delta) } }) : u);
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

  return (
    <>
      <TopBar nick={session.nick} pc={isAdmin ? '∞' : me.pc} isAdmin={isAdmin} onLogout={logout} />
      <div className="page">
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
        {tab === 'ranking' && (
          <RankingView users={users} bets={bets} me={session.nick} />
        )}
        {tab === 'classificacao' && (
          <ClassificacaoView cs={cs} setCs={setCs} isAdmin={isAdmin} />
        )}
        {tab === 'admin' && isAdmin && (
          <AdminView bets={bets} users={users} adjustPc={adjustPc} />
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

function Tabs({ tab, setTab, isAdmin }) {
  const items = [
    { id: 'apostar', label: 'JOGOS' },
    { id: 'tickets', label: 'MEUS TICKETS' },
    { id: 'ranking', label: 'RANKING' },
    { id: 'classificacao', label: 'CLASSIFICAÇÃO' },
  ];
  if (isAdmin) items.push({ id: 'admin', label: 'ADMIN' });
  return (
    <div className="tabs">
      {items.map(it => (
        <button key={it.id} className={'tab ' + (tab === it.id ? 'active' : '')} onClick={() => setTab(it.id)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

// ─── LOGIN ──────────────────────────────────────────────────────────────────
function Login({ onAuth, isNewNick }) {
  const [nick, setNick] = useState('');
  const [senha, setSenha] = useState('');
  const [senha2, setSenha2] = useState('');
  const [msg, setMsg] = useState('');
  const isNew = isNewNick ? isNewNick(nick) : false;
  const submit = (e) => {
    e && e.preventDefault();
    if (isNew && senha !== senha2) {
      setMsg('As senhas não conferem');
      return;
    }
    const err = onAuth(nick, senha);
    if (err) setMsg(err);
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
        <button type="submit" className="login-btn">{isNew ? 'CRIAR CONTA' : 'ENTRAR'}</button>
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
  const legs = slip.map(s => ({ ...s, _fix: gamesById ? gamesById[s.fixtureId] : null }));
  // SOMA (não multiplica) — ver placeBet.
  const combined = slip.reduce((p, l) => p + l.odds, 0);
  const payout = Math.round(amt * combined);
  const valid = slip.length > 0 && amt > 0 && amt <= balance;
  const multi = slip.length > 1;

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
              <button className="btn-secondary" onClick={onClearSlip}>LIMPAR</button>
              <button className="btn-primary" disabled={!valid} onClick={() => onPlaceBet(amt)}>
                APOSTAR {amt} PC
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
      <div className="card-head"><div className="title">RANKING GERAL</div><div className="sub">{rows.length} JOGADORES</div></div>
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
function AdminView({ bets, users, adjustPc }) {
  // Tabs do admin: USUÁRIOS (default) + BACKUP. Antiga aba JOGOS removida —
  // jogos agora vêm de cs.rounds (CLASSIFICAÇÃO) e odds são automáticas.
  const [tab, setTab] = useState('usuarios');
  return (
    <>
      <div className="tabs" style={{ marginBottom: 14 }}>
        <button className={'tab ' + (tab === 'usuarios' ? 'active' : '')} onClick={() => setTab('usuarios')}>USUÁRIOS</button>
        <button className={'tab ' + (tab === 'backup' ? 'active' : '')} onClick={() => setTab('backup')}>BACKUP</button>
      </div>

      {tab === 'usuarios' && (
        <div className="card">
          <div className="card-head"><div className="title">USUÁRIOS</div><div className="sub">{Object.keys(users).length} CADASTRADOS</div></div>
          <div className="card-body">
            {Object.entries(users).map(([nick, u]) => (
              <div key={nick} className="lb-row" style={{ gridTemplateColumns: '1fr auto auto auto', gap: 10 }}>
                <div className="lb-nick">@{nick}</div>
                <button onClick={() => adjustPc(nick, -10)} style={{ background: 'transparent', border: '1.5px solid var(--pv-charcoal)', padding: '4px 8px', fontWeight: 800 }}>-10</button>
                <div className="lb-pc mono">{u.pc}</div>
                <button onClick={() => adjustPc(nick, 10)} style={{ background: 'var(--pv-orange)', border: '1.5px solid var(--pv-charcoal)', padding: '4px 8px', fontWeight: 800, color: 'var(--pv-bone)' }}>+10</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'backup' && (
        <>
          <BackupPanel />
          <DangerZone />
        </>
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
