// Apostas — single file React app.
// Persiste em Firestore (compartilhado entre todos os dispositivos).
// Sessão (quem está logado neste navegador) fica em localStorage.

const { useState, useEffect, useMemo, useRef } = React;

// ─── DADOS BASE ─────────────────────────────────────────────────────────────
const TEAMS = [
  { id: 'bane',    name: 'Bane',    short: 'BAN', color: '#1c1612', mascot: 'mascara' },
  { id: 'mohamed', name: 'Mohamed', short: 'MOH', color: '#c75418', mascot: 'tigre' },
  { id: 'potato',  name: 'Potato',  short: 'PTT', color: '#8b3a14', mascot: 'pedra' },
  { id: 'magreza', name: 'Magreza', short: 'MGR', color: '#2a201a', mascot: 'cruz' },
  { id: 'celin',   name: 'Celin',   short: 'CEL', color: '#e8800f', mascot: 'mao' },
  { id: 'juca',    name: 'Juca',    short: 'JUC', color: '#d63c0a', mascot: 'chama' },
  { id: 'caco',    name: 'Caco',    short: 'CAC', color: '#4a3020', mascot: 'mamute' },
  { id: 'vitinho', name: 'Vitinho', short: 'VIT', color: '#6e4824', mascot: 'osso' },
];
const TEAM = (id) => TEAMS.find(t => t.id === id) || TEAMS[0];

const ADMIN_NICK = 'admin';
const ADMIN_PASS = 'primitivao';

const START_PC = 50;
const WEEKLY_PC = 20;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// fixtures default: rodada 1 — 4 jogos
const DEFAULT_FIXTURES = [
  { id: 'r1g1', round: 1, home: 'bane',    away: 'mohamed', day: 'SEG', date: '04/05', time: '21:00', oddsH: 2.0, oddsD: 3.0, oddsA: 2.2, result: null, locked: false },
  { id: 'r1g2', round: 1, home: 'potato',  away: 'magreza', day: 'TER', date: '05/05', time: '21:00', oddsH: 2.3, oddsD: 3.0, oddsA: 2.0, result: null, locked: false },
  { id: 'r1g3', round: 1, home: 'celin',   away: 'juca',    day: 'QUA', date: '06/05', time: '21:00', oddsH: 2.1, oddsD: 3.0, oddsA: 2.1, result: null, locked: false },
  { id: 'r1g4', round: 1, home: 'caco',    away: 'vitinho', day: 'QUI', date: '07/05', time: '21:00', oddsH: 2.5, oddsD: 3.0, oddsA: 1.9, result: null, locked: false },
];

// ─── STORAGE ────────────────────────────────────────────────────────────────
// Apenas a sessão (login local) fica em localStorage. Tudo o resto vai para Firestore.
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

// Firestore: documento único `primitivao/apostas` com payload JSON.
// Centralizar num doc evita ter que criar regras de segurança por coleção.
const STATE_DOC = () => window.db.doc('primitivao/apostas');

// ─── ÍCONE MINI (logo) ──────────────────────────────────────────────────────
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

// crest pequeno por time (versão simples)
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
  // Estado compartilhado via Firestore
  const [shared, setShared] = useState({ users: {}, fixtures: DEFAULT_FIXTURES, bets: [] });
  const { users, fixtures, bets } = shared;
  const setUsers    = (u) => setShared(s => ({ ...s, users:    typeof u === 'function' ? u(s.users)    : u }));
  const setFixtures = (f) => setShared(s => ({ ...s, fixtures: typeof f === 'function' ? f(s.fixtures) : f }));
  const setBets     = (b) => setShared(s => ({ ...s, bets:     typeof b === 'function' ? b(s.bets)     : b }));

  // Sessão local (por dispositivo)
  const [session, _setSession] = useState(loadSession);
  const setSession = (s) => { saveSession(s); _setSession(s); };

  const [tab, setTab]           = useState('apostar');
  const [bettingOn, setBettingOn] = useState(null); // {fixture, pick}
  const [synced, setSynced]     = useState(false);

  // refs para evitar loop snapshot ↔ write
  const hasLoadedRef       = useRef(false);
  const isApplyingRemoteRef = useRef(false);

  // ── Firestore: subscribe one-shot ─────────────────────────────────────────
  useEffect(() => {
    const ref = STATE_DOC();
    const unsub = ref.onSnapshot(snap => {
      if (!snap.exists) {
        // Seed inicial do documento — primeira vez que alguém abre.
        ref.set({
          json: JSON.stringify({ users: {}, fixtures: DEFAULT_FIXTURES, bets: [] }),
          updatedAt: Date.now(),
        }).catch(e => console.warn('Firestore seed failed', e));
        hasLoadedRef.current = true;
        setSynced(true);
        return;
      }
      try {
        const remote = JSON.parse(snap.data().json);
        isApplyingRemoteRef.current = true;
        setShared({
          users:    remote.users    && typeof remote.users    === 'object' ? remote.users    : {},
          fixtures: Array.isArray(remote.fixtures)                        ? remote.fixtures : DEFAULT_FIXTURES,
          bets:     Array.isArray(remote.bets)                            ? remote.bets     : [],
        });
        hasLoadedRef.current = true;
        setSynced(true);
      } catch (e) { console.warn('Firestore parse failed', e); }
    }, err => console.warn('Firestore subscription failed', err));
    return () => unsub();
  }, []);

  // ── Firestore: write on local change (debounced) ──────────────────────────
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    if (isApplyingRemoteRef.current) { isApplyingRemoteRef.current = false; return; }
    const t = setTimeout(() => {
      STATE_DOC().set({
        json: JSON.stringify(shared),
        updatedAt: Date.now(),
      }).catch(e => console.warn('Firestore write failed', e));
    }, 250);
    return () => clearTimeout(t);
  }, [shared]);

  const me = session ? users[session.nick] : null;
  const isAdmin = session?.nick === ADMIN_NICK;

  // login / register
  const handleAuth = (nick, senha) => {
    nick = nick.trim().toLowerCase();
    if (!nick || !senha) return 'Preencha nick e senha';
    if (nick === ADMIN_NICK) {
      if (senha !== ADMIN_PASS) return 'Senha de admin incorreta';
      setSession({ nick });
      return null;
    }
    const existing = users[nick];
    if (existing) {
      if (existing.senha !== senha) return 'Senha incorreta';
      setSession({ nick });
      return null;
    }
    // novo cadastro
    const now = Date.now();
    setUsers(u => ({ ...u, [nick]: { senha, pc: START_PC, joined: now, lastWeekly: 0 } }));
    setSession({ nick });
    return null;
  };

  const logout = () => { setSession(null); setTab('apostar'); };

  // claim bônus semanal
  const claimWeekly = () => {
    if (!me || isAdmin) return;
    const now = Date.now();
    if (now - me.lastWeekly < WEEK_MS) return;
    setUsers(u => ({ ...u, [session.nick]: { ...u[session.nick], pc: u[session.nick].pc + WEEKLY_PC, lastWeekly: now } }));
  };
  const weeklyReady = me ? (Date.now() - me.lastWeekly >= WEEK_MS) : false;
  const weeklyIn = me && !weeklyReady ? Math.max(0, WEEK_MS - (Date.now() - me.lastWeekly)) : 0;

  // place bet
  const placeBet = (fixtureId, pick, amount) => {
    if (!me) return;
    const fix = fixtures.find(f => f.id === fixtureId);
    if (!fix || fix.locked || fix.result) return;
    if (amount <= 0 || amount > me.pc) return;
    // checa se já apostou nesse jogo
    const dup = bets.find(b => b.user === session.nick && b.fixtureId === fixtureId && b.status === 'pending');
    if (dup) return alert('Você já tem um ticket aberto pra esse jogo. Cancele antes de apostar de novo.');
    const odds = pick === 'H' ? fix.oddsH : pick === 'D' ? fix.oddsD : fix.oddsA;
    const ticket = {
      id: 't' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      user: session.nick, fixtureId, pick, amount, odds, status: 'pending', createdAt: Date.now(),
    };
    setBets(b => [ticket, ...b]);
    setUsers(u => ({ ...u, [session.nick]: { ...u[session.nick], pc: u[session.nick].pc - amount } }));
    setBettingOn(null);
  };

  const cancelBet = (ticketId) => {
    const t = bets.find(b => b.id === ticketId);
    if (!t || t.status !== 'pending') return;
    if (t.user !== session.nick && !isAdmin) return;
    const fix = fixtures.find(f => f.id === t.fixtureId);
    if (fix?.locked || fix?.result) return alert('Jogo já travado/finalizado.');
    setBets(b => b.filter(x => x.id !== ticketId));
    setUsers(u => ({ ...u, [t.user]: { ...u[t.user], pc: u[t.user].pc + t.amount } }));
  };

  // admin: set result, recompute payouts
  const setResult = (fixtureId, gh, ga) => {
    const ghN = parseInt(gh, 10), gaN = parseInt(ga, 10);
    if (Number.isNaN(ghN) || Number.isNaN(gaN)) return;
    const winner = ghN > gaN ? 'H' : gaN > ghN ? 'A' : 'D';
    setFixtures(fs => fs.map(f => f.id === fixtureId ? { ...f, result: { gh: ghN, ga: gaN }, locked: true } : f));
    // pagar tickets
    setUsers(u => {
      const nu = { ...u };
      const affected = bets.filter(b => b.fixtureId === fixtureId && b.status === 'pending');
      for (const t of affected) {
        if (!nu[t.user]) continue;
        if (t.pick === winner) {
          const payout = Math.round(t.amount * t.odds);
          nu[t.user] = { ...nu[t.user], pc: nu[t.user].pc + payout };
        }
      }
      return nu;
    });
    setBets(bs => bs.map(b => {
      if (b.fixtureId !== fixtureId || b.status !== 'pending') return b;
      return { ...b, status: b.pick === winner ? 'won' : 'lost', payout: b.pick === winner ? Math.round(b.amount * b.odds) : 0 };
    }));
  };

  const clearResult = (fixtureId) => {
    // reverte: devolve payouts ganhos, deixa tickets pending de novo
    setUsers(u => {
      const nu = { ...u };
      const affected = bets.filter(b => b.fixtureId === fixtureId && b.status === 'won');
      for (const t of affected) {
        if (!nu[t.user]) continue;
        nu[t.user] = { ...nu[t.user], pc: nu[t.user].pc - (t.payout || 0) };
      }
      return nu;
    });
    setBets(bs => bs.map(b => b.fixtureId === fixtureId ? { ...b, status: 'pending', payout: undefined } : b));
    setFixtures(fs => fs.map(f => f.id === fixtureId ? { ...f, result: null, locked: false } : f));
  };

  const updateFixture = (id, patch) => setFixtures(fs => fs.map(f => f.id === id ? { ...f, ...patch } : f));
  const addFixture = () => {
    const round = Math.max(1, ...fixtures.map(f => f.round)) + 1;
    setFixtures(fs => [...fs, {
      id: 'g' + Date.now(), round, home: 'bane', away: 'mohamed', day: 'SEG', date: '01/01', time: '21:00',
      oddsH: 2.0, oddsD: 3.0, oddsA: 2.2, result: null, locked: false,
    }]);
  };
  const delFixture = (id) => {
    if (!confirm('Apagar jogo? Tickets ainda pending serão estornados.')) return;
    const affected = bets.filter(b => b.fixtureId === id && b.status === 'pending');
    setUsers(u => {
      const nu = { ...u };
      for (const t of affected) if (nu[t.user]) nu[t.user] = { ...nu[t.user], pc: nu[t.user].pc + t.amount };
      return nu;
    });
    setBets(bs => bs.filter(b => b.fixtureId !== id));
    setFixtures(fs => fs.filter(f => f.id !== id));
  };

  // adjust user PC (admin)
  const adjustPc = (nick, delta) => {
    if (!users[nick]) return;
    setUsers(u => ({ ...u, [nick]: { ...u[nick], pc: Math.max(0, u[nick].pc + delta) } }));
  };

  // Evita renderizar antes do Firestore carregar — senão o handleAuth pode
  // achar que um nick existente é novo e sobrescrever os dados do usuário.
  if (!synced) {
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
    return <Login onAuth={handleAuth} />;
  }

  return (
    <>
      <TopBar nick={session.nick} pc={isAdmin ? '∞' : me.pc} isAdmin={isAdmin} onLogout={logout} />
      <div className="page">
        <Tabs tab={tab} setTab={setTab} isAdmin={isAdmin} />

        {tab === 'apostar' && (
          <ApostarView
            fixtures={fixtures} bets={bets} me={me} session={session}
            weeklyReady={weeklyReady} weeklyIn={weeklyIn} onClaim={claimWeekly}
            onBet={(f, p) => setBettingOn({ fixture: f, pick: p })}
            users={users}
          />
        )}
        {tab === 'tickets' && (
          <TicketsView bets={bets.filter(b => b.user === session.nick)} fixtures={fixtures} onCancel={cancelBet} />
        )}
        {tab === 'ranking' && (
          <RankingView users={users} bets={bets} me={session.nick} />
        )}
        {tab === 'admin' && isAdmin && (
          <AdminView fixtures={fixtures} bets={bets} users={users}
            updateFixture={updateFixture} addFixture={addFixture} delFixture={delFixture}
            setResult={setResult} clearResult={clearResult}
            adjustPc={adjustPc} cancelBet={cancelBet} />
        )}
      </div>

      {bettingOn && (
        <BetModal
          fixture={bettingOn.fixture} pick={bettingOn.pick}
          balance={me ? me.pc : 0}
          onClose={() => setBettingOn(null)}
          onConfirm={(amt) => placeBet(bettingOn.fixture.id, bettingOn.pick, amt)}
        />
      )}
    </>
  );
}

// ─── COMPONENTS ─────────────────────────────────────────────────────────────
function TopBar({ nick, pc, isAdmin, onLogout }) {
  return (
    <div className="topbar">
      <div className="brand">
        <MiniCrest size={36} />
        <div className="brand-text">
          <div className="t1 display">APOSTAS</div>
          <div className="t2">PRIMITIVÃO · 2026</div>
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
function Login({ onAuth }) {
  const [nick, setNick] = useState('');
  const [senha, setSenha] = useState('');
  const [msg, setMsg] = useState('');

  const submit = (e) => {
    e?.preventDefault();
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
          <input value={nick} onChange={e => setNick(e.target.value)} placeholder="seu apelido" autoFocus autoCapitalize="off" autoCorrect="off" />
        </div>
        <div className="field">
          <label>SENHA</label>
          <input type="password" value={senha} onChange={e => setSenha(e.target.value)} placeholder="••••••" />
        </div>

        <button type="submit" className="login-btn">ENTRAR / CRIAR CONTA</button>
        <div className="login-msg">{msg}</div>
        <div className="login-hint">
          Nick novo → cria conta automaticamente com <b>50 PC</b>.<br />
          +20 PC toda semana. Admin = <code>admin / primitivao</code>.
        </div>
      </form>
    </div>
  );
}

// ─── APOSTAR ────────────────────────────────────────────────────────────────
function ApostarView({ fixtures, bets, me, session, weeklyReady, weeklyIn, onClaim, onBet, users }) {
  const isAdmin = session.nick === ADMIN_NICK;
  const open = fixtures.filter(f => !f.result && !f.locked).sort((a, b) => a.round - b.round);
  const closed = fixtures.filter(f => f.result || f.locked).sort((a, b) => b.round - a.round);

  // ranking top 5
  const ranking = Object.entries(users).map(([nick, u]) => ({ nick, pc: u.pc }))
    .sort((a, b) => b.pc - a.pc).slice(0, 5);

  const myActiveBets = bets.filter(b => b.user === session.nick && b.status === 'pending');

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
                {weeklyReady ? '+20 PC DISPONÍVEIS' : `Disponível em ${days}d ${hrs}h`}
              </div>
            </div>
            <button onClick={onClaim} disabled={!weeklyReady}>{weeklyReady ? 'RECLAMAR' : 'BLOQUEADO'}</button>
          </div>
        )}

        <div className="card">
          <div className="card-head">
            <div className="title">JOGOS ABERTOS</div>
            <div className="sub">{open.length} DISPONÍVEIS</div>
          </div>
          <div className="card-body">
            {open.length === 0 && <div className="empty"><div className="e1">SEM JOGOS</div><div className="e2">O admin ainda não abriu a rodada.</div></div>}
            {open.map(f => (
              <FixtureRow key={f.id} fixture={f} bets={myActiveBets} onBet={onBet} canBet={!isAdmin} />
            ))}
          </div>
        </div>

        {closed.length > 0 && (
          <div className="card" style={{ marginTop: 18 }}>
            <div className="card-head">
              <div className="title">RESULTADOS</div>
              <div className="sub">{closed.length} ENCERRADOS</div>
            </div>
            <div className="card-body">
              {closed.map(f => (
                <FixtureRow key={f.id} fixture={f} bets={myActiveBets} onBet={onBet} canBet={false} />
              ))}
            </div>
          </div>
        )}
      </div>

      <aside>
        <div className="card">
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

        {myActiveBets.length > 0 && (
          <div className="card" style={{ marginTop: 18 }}>
            <div className="card-head">
              <div className="title">EM JOGO</div>
              <div className="sub">{myActiveBets.length} TICKETS</div>
            </div>
            <div className="card-body">
              {myActiveBets.slice(0, 5).map(t => {
                const f = fixtures.find(x => x.id === t.fixtureId);
                if (!f) return null;
                const team = t.pick === 'H' ? TEAM(f.home).name : t.pick === 'A' ? TEAM(f.away).name : 'EMPATE';
                return (
                  <div key={t.id} className="ticket">
                    <div className="pick">
                      <small>R{f.round} · {TEAM(f.home).short} × {TEAM(f.away).short}</small>
                      {team} <span style={{ color: 'var(--pv-orange)', fontWeight: 800 }}>@ {t.odds.toFixed(2)}</span>
                    </div>
                    <div className="stake">{t.amount}<span style={{ fontSize: 10, letterSpacing: '0.2em', marginLeft: 4, fontFamily: 'Space Grotesk' }}>PC</span></div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function FixtureRow({ fixture, bets, onBet, canBet }) {
  const f = fixture;
  const h = TEAM(f.home), a = TEAM(f.away);
  const myBet = bets?.find(b => b.fixtureId === f.id);
  const finished = !!f.result;
  const winner = finished ? (f.result.gh > f.result.ga ? 'H' : f.result.ga > f.result.gh ? 'A' : 'D') : null;
  return (
    <div className={'fixture ' + (finished ? 'finished ' : '') + (f.locked && !finished ? 'locked' : '')}>
      <div className="fixture-top">
        <div className="fixture-tag">RODADA {String(f.round).padStart(2, '0')}</div>
        <div>{f.day} · {f.date} · {f.time}</div>
      </div>
      <div className="fixture-match">
        <div className="fixture-team">
          <TeamMini team={h} size={42} />
          <div className="team-info"><div className="nm">{h.name}</div><div className="sh">{h.short} · MANDANTE</div></div>
        </div>
        <div className="vs">
          {finished
            ? <div className="score-show">{f.result.gh} <span style={{ color: 'var(--pv-charcoal)' }}>×</span> {f.result.ga}</div>
            : <span style={{ color: 'var(--pv-orange)' }}>×</span>}
        </div>
        <div className="fixture-team away">
          <TeamMini team={a} size={42} />
          <div className="team-info"><div className="nm">{a.name}</div><div className="sh">VISITANTE · {a.short}</div></div>
        </div>
      </div>
      <div className="odds-row">
        <button className={'odd-btn ' + (winner === 'H' ? 'winner' : '')} disabled={!canBet || !!myBet || f.locked}
                onClick={() => onBet(f, 'H')}>
          <div className="lab">{h.short} VENCE</div>
          <div className="val">{f.oddsH.toFixed(2)}</div>
        </button>
        <button className={'odd-btn ' + (winner === 'D' ? 'winner' : '')} disabled={!canBet || !!myBet || f.locked}
                onClick={() => onBet(f, 'D')}>
          <div className="lab">EMPATE</div>
          <div className="val">{f.oddsD.toFixed(2)}</div>
        </button>
        <button className={'odd-btn ' + (winner === 'A' ? 'winner' : '')} disabled={!canBet || !!myBet || f.locked}
                onClick={() => onBet(f, 'A')}>
          <div className="lab">{a.short} VENCE</div>
          <div className="val">{f.oddsA.toFixed(2)}</div>
        </button>
      </div>
      {myBet && !finished && (
        <div style={{ marginTop: 4, fontSize: 11, letterSpacing: '0.18em', fontWeight: 800, color: 'var(--pv-orange)' }}>
          ★ VOCÊ APOSTOU {myBet.amount} PC EM {myBet.pick === 'H' ? h.short : myBet.pick === 'A' ? a.short : 'EMPATE'} @ {myBet.odds.toFixed(2)}
        </div>
      )}
    </div>
  );
}

// ─── MEUS TICKETS ───────────────────────────────────────────────────────────
function TicketsView({ bets, fixtures, onCancel }) {
  if (bets.length === 0) {
    return <div className="card"><div className="card-body"><div className="empty">
      <div className="e1">SEM TICKETS</div><div className="e2">Você ainda não apostou em nada.</div></div></div></div>;
  }
  const sorted = [...bets].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div className="card">
      <div className="card-head"><div className="title">MEUS TICKETS</div><div className="sub">{bets.length} TOTAL</div></div>
      <div className="card-body">
        {sorted.map(t => {
          const f = fixtures.find(x => x.id === t.fixtureId);
          if (!f) return null;
          const team = t.pick === 'H' ? TEAM(f.home) : TEAM(f.away);
          const label = t.pick === 'D' ? 'EMPATE' : team.name;
          const cls = t.status === 'won' ? 'ticket won' : t.status === 'lost' ? 'ticket lost' : 'ticket';
          return (
            <div key={t.id} className={cls}>
              <div>
                <div className="pick">
                  <small>RODADA {String(f.round).padStart(2,'0')} · {TEAM(f.home).short} × {TEAM(f.away).short}</small>
                  {label}
                  <span style={{ color: 'var(--pv-orange)', fontWeight: 800, marginLeft: 8 }}>@ {t.odds.toFixed(2)}</span>
                </div>
                <div className={'status ' + t.status}>
                  {t.status === 'pending' ? 'EM ABERTO' : t.status === 'won' ? `VENCEU · +${t.payout} PC` : 'PERDEU'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="stake">{t.amount} <span style={{ fontSize: 10, fontFamily: 'Space Grotesk', letterSpacing: '0.2em' }}>PC</span></div>
                {t.status === 'pending' && !f.locked && (
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
      nick, pc: u.pc,
      apostas: my.length,
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
          <div key={r.nick} className={'lb-row ' + (r.nick === me ? 'me' : '')} style={{ gridTemplateColumns: '36px 1fr auto auto auto auto', gap: 16 }}>
            <div className="lb-pos">{i + 1}</div>
            <div>
              <div className="lb-nick">@{r.nick}</div>
              <div style={{ fontSize: 10, letterSpacing: '0.22em', color: 'rgba(28,22,18,0.5)', fontWeight: 800, marginTop: 2 }}>
                {r.apostas} APOSTAS
              </div>
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

// ─── MODAL DE APOSTA ────────────────────────────────────────────────────────
function BetModal({ fixture, pick, balance, onClose, onConfirm }) {
  const [amt, setAmt] = useState(10);
  const h = TEAM(fixture.home), a = TEAM(fixture.away);
  const odds = pick === 'H' ? fixture.oddsH : pick === 'D' ? fixture.oddsD : fixture.oddsA;
  const teamName = pick === 'H' ? h.name : pick === 'A' ? a.name : 'EMPATE';
  const payout = Math.round(amt * odds);
  const valid = amt > 0 && amt <= balance;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>CONFIRMAR APOSTA</h3>
        <div className="modal-sub">RODADA {String(fixture.round).padStart(2,'0')} · {fixture.day} {fixture.date}</div>

        <div className="modal-row"><span className="lab">JOGO</span><span>{h.short} × {a.short}</span></div>
        <div className="modal-row"><span className="lab">PALPITE</span><span style={{ color: 'var(--pv-orange)', fontWeight: 800 }}>{teamName}</span></div>
        <div className="modal-row"><span className="lab">ODDS</span><span className="mono">{odds.toFixed(2)}x</span></div>
        <div className="modal-row"><span className="lab">SALDO</span><span className="mono">{balance} PC</span></div>

        <div style={{ marginTop: 14 }} className="small-label">QUANTO APOSTAR (PC)</div>
        <input type="number" min="1" max={balance} value={amt}
               onChange={e => setAmt(Math.max(0, Math.min(balance, +e.target.value || 0)))}
               className="stake-input" autoFocus />
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

        <div className="modal-btns">
          <button className="btn-secondary" onClick={onClose}>CANCELAR</button>
          <button className="btn-primary" disabled={!valid} onClick={() => onConfirm(amt)}>
            APOSTAR {amt} PC
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ADMIN ──────────────────────────────────────────────────────────────────
function AdminView({ fixtures, bets, users, updateFixture, addFixture, delFixture, setResult, clearResult, adjustPc, cancelBet }) {
  const [tab, setTab] = useState('jogos');
  return (
    <>
      <div className="tabs" style={{ marginBottom: 14 }}>
        <button className={'tab ' + (tab === 'jogos' ? 'active' : '')} onClick={() => setTab('jogos')}>JOGOS</button>
        <button className={'tab ' + (tab === 'usuarios' ? 'active' : '')} onClick={() => setTab('usuarios')}>USUÁRIOS</button>
      </div>

      {tab === 'jogos' && (
        <div className="card">
          <div className="card-head">
            <div className="title">GERENCIAR JOGOS</div>
            <button onClick={addFixture} style={{ background: 'var(--pv-orange)', color: 'var(--pv-charcoal)', padding: '6px 14px', fontWeight: 800, border: 'none', letterSpacing: '0.16em', fontSize: 11 }}>+ NOVO JOGO</button>
          </div>
          <div className="card-body">
            <div className="admin-grid">
              {fixtures.map(f => (
                <AdminFixture key={f.id} f={f} bets={bets}
                  onUpdate={p => updateFixture(f.id, p)}
                  onDel={() => delFixture(f.id)}
                  onResult={(gh, ga) => setResult(f.id, gh, ga)}
                  onClear={() => clearResult(f.id)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'usuarios' && (
        <div className="card">
          <div className="card-head"><div className="title">USUÁRIOS</div><div className="sub">{Object.keys(users).length} CADASTRADOS</div></div>
          <div className="card-body">
            {Object.entries(users).map(([nick, u]) => (
              <div key={nick} className="lb-row" style={{ gridTemplateColumns: '1fr auto auto auto auto', gap: 10 }}>
                <div className="lb-nick">@{nick}</div>
                <button onClick={() => adjustPc(nick, -10)} style={{ background: 'transparent', border: '1.5px solid var(--pv-charcoal)', padding: '4px 8px', fontWeight: 800 }}>-10</button>
                <div className="lb-pc mono">{u.pc}</div>
                <button onClick={() => adjustPc(nick, 10)} style={{ background: 'var(--pv-orange)', border: '1.5px solid var(--pv-charcoal)', padding: '4px 8px', fontWeight: 800, color: 'var(--pv-bone)' }}>+10</button>
                <button onClick={() => { if (confirm('Apagar usuário ' + nick + '?')) { /* delete via window */ }}} style={{ background: 'transparent', color: 'var(--pv-red)', border: '1.5px solid var(--pv-red)', padding: '4px 8px', fontWeight: 800, fontSize: 11 }}>X</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function AdminFixture({ f, bets, onUpdate, onDel, onResult, onClear }) {
  const h = TEAM(f.home), a = TEAM(f.away);
  const [gh, setGh] = useState(f.result?.gh ?? '');
  const [ga, setGa] = useState(f.result?.ga ?? '');
  const ticketsCount = bets.filter(b => b.fixtureId === f.id).length;
  return (
    <div className="admin-game">
      <h4 className="display">R{f.round} · {h.short} × {a.short}{f.locked ? ' · TRAVADO' : ''}{f.result ? ' · ENCERRADO' : ''}</h4>
      <div className="admin-fields">
        <select value={f.home} onChange={e => onUpdate({ home: e.target.value })} disabled={f.locked}>
          {TEAMS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={f.away} onChange={e => onUpdate({ away: e.target.value })} disabled={f.locked}>
          {TEAMS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <input value={f.day} onChange={e => onUpdate({ day: e.target.value.toUpperCase().slice(0,3) })} maxLength={3} placeholder="DIA" />
        <input value={f.date} onChange={e => onUpdate({ date: e.target.value })} maxLength={8} placeholder="DATA" />
        <input value={f.time} onChange={e => onUpdate({ time: e.target.value })} maxLength={5} placeholder="HORA" />
        <input type="number" value={f.round} onChange={e => onUpdate({ round: +e.target.value || 1 })} placeholder="RODADA" min={1} />
      </div>
      <div className="admin-fields" style={{ marginTop: 4 }}>
        <div>
          <div className="small-label">ODD MANDANTE</div>
          <input type="number" step="0.1" min="1" value={f.oddsH} onChange={e => onUpdate({ oddsH: +e.target.value || 1 })} />
        </div>
        <div>
          <div className="small-label">ODD EMPATE</div>
          <input type="number" step="0.1" min="1" value={f.oddsD} onChange={e => onUpdate({ oddsD: +e.target.value || 1 })} />
        </div>
      </div>
      <div className="admin-fields">
        <div>
          <div className="small-label">ODD VISITANTE</div>
          <input type="number" step="0.1" min="1" value={f.oddsA} onChange={e => onUpdate({ oddsA: +e.target.value || 1 })} />
        </div>
        <div>
          <div className="small-label">{ticketsCount} TICKETS</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '8px', background: 'var(--pv-bone-2)' }}>
        <span className="small-label">PLACAR:</span>
        <input className="admin-result-input" value={gh} onChange={e => setGh(e.target.value.replace(/\D/g,'').slice(0,2))} placeholder="–" />
        <span className="display" style={{ fontSize: 16 }}>×</span>
        <input className="admin-result-input" value={ga} onChange={e => setGa(e.target.value.replace(/\D/g,'').slice(0,2))} placeholder="–" />
        {!f.result && (
          <button onClick={() => onResult(gh, ga)} style={{ marginLeft: 'auto', background: 'var(--pv-orange)', color: 'var(--pv-bone)', border: 'none', padding: '6px 10px', fontWeight: 800, letterSpacing: '0.16em', fontSize: 10 }}>LANÇAR</button>
        )}
        {f.result && (
          <button onClick={onClear} style={{ marginLeft: 'auto', background: 'transparent', border: '1.5px solid var(--pv-charcoal)', padding: '6px 10px', fontWeight: 800, letterSpacing: '0.16em', fontSize: 10 }}>DESFAZER</button>
        )}
      </div>

      <div className="admin-actions">
        <button onClick={() => onUpdate({ locked: !f.locked })}>{f.locked ? 'DESTRAVAR' : 'TRAVAR'}</button>
        <button onClick={onDel} style={{ color: 'var(--pv-red)', borderColor: 'var(--pv-red)' }}>APAGAR JOGO</button>
      </div>
    </div>
  );
}

// ─── MOUNT ──────────────────────────────────────────────────────────────────
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
