// =============================================================================
// PRIMITIVÃO — apostas-app.jsx
// =============================================================================
// React single-file app servido via GitHub Pages.
//   - dev:  apostas/dev.html  -> carrega este arquivo com Babel standalone
//   - prod: apostas/index.html -> carrega apostas-app.compiled.js (esbuild)
//
// Persiste em Firestore (compartilhado entre todos os dispositivos):
//   - primitivao/apostas : users, fixtures, bets (cupons parlay),
//                          interests, comments, teamPlayers, worldcup,
//                          news, discord_webhook
//   - primitivao/state   : classificação (legado do site antigo)
//
// Sessão (quem está logado neste navegador) fica em localStorage.
//
// =============================================================================
// ÍNDICE — pra navegar rápido, pulando pra L<numero>
// =============================================================================
// 1. CONSTANTS & DATA
//    - DADOS BASE (TEAMS, MARKETS, NEWS, WEEKLY_PC, etc)
//    - CAMPEONATOS (FIFA, MK, RL, etc)
//    - COPA DO MUNDO (i18n de times, fases, scoring)
//
// 2. UTILITÁRIOS (puros, sem JSX)
//    - STORAGE (localStorage helpers)
//    - BACKUP / RESTORE / WIPE (JSON dump do estado — cobre TODOS os campos)
//    - TRANSAÇÕES (commitBetDocUpdate — desempacota out.next; mergeBetDocFields)
//    - NORMALIZAÇÃO (compat com formato legado)
//    - LÓGICA DE TICKETS (resolve resultados, paga payouts)
//    - CLASSIFICAÇÃO (gera tabela a partir de jogos)
//    - ODDS / MERCADOS / JOGOS (calcula odds a partir de cs.rounds)
//    - ÍCONES (TeamMini, Avatar, FrameDeco — moldura decorativa SVG)
//
// 3. APP ROOT
//    - SHARE CUPOM (URL encoding, navigator.share)
//    - TOAST (showToast + ToastHost)
//    - DISCORD WEBHOOK (post + save URL)
//    - NEWS REMOTAS (CRUD)
//    - APP (estado raiz, snapshot Firestore, handlers, buyItem/equipItem,
//      auto-cleanup de cosmético inválido)
//
// 4. NAVIGATION & SHELL
//    - TOP BAR (primary-nav: APOSTAS/CAMPEONATOS/COPA/VITRINE/NEWS/MERCADINHO/DISCORD + avatar)
//    - MobileNav (hamburger: tudo) / Sidebar (MEU ESPAÇO: perfil/tickets/ranking)
//    - CAMPEONATO SELECTOR / "em breve"
//    - ICONES SVG (componente <Icon> — ver ALL_ICON_NAMES / ADMIN CATÁLOGO)
//
// 5. AUTENTICAÇÃO
//    - LOGIN (form + hash de senha SHA-256)
//
// 6. CONQUISTAS & COSMÉTICOS
//    - helpers (champStandingPos, maxBetStreak, wcExactCount, betsOf)
//    - ACH (critérios de conquista — FONTE ÚNICA p/ títulos E distintivos)
//    - TITLE_DEFS (22 títulos — label de texto) + titlesForNick/TitleBadge
//    - ITEMS (molduras + 30 distintivos) + effectiveInventory/itemsDroppedFor
//
// 7. VIEWS DE CONTEÚDO
//    - INÍCIO (feed de notícias + comentários)
//    - COPA DO MUNDO (palpites + grupos + bracket + ranking + picks modal)
//    - APOSTAR / CUPOM (slip + place bet) / GameRow
//    - TICKETS (histórico)
//    - LOJA (LojaView — comprar/equipar cosméticos)
//    - PERFIL (MeuPerfilView: time, troféus, TitulosCard, ColecaoCard)
//    - RANKING (geral por PC)
//    - HALL (HallView: Fama + Vergonha em subtabs) / TrophyCard/TrophyPodium
//    - CLASSIFICAÇÃO (tabela)
//
// 8. ADMIN
//    - AdminView (USUÁRIOS, TIMES, NEWS, JORNALISTA, CATÁLOGO, DISCORD,
//      BACKUP+HISTÓRICO+RESTORE, PERIGO)
//    - JournalistAdminPanel (detecta eventos, monta prompt, publica news)
//    - CatalogoAdminPanel (galeria QA: ícones/títulos/distintivos/molduras)
//
// 9. MOUNT (ReactDOM.render no final)
//
// DICA: pra pular pra uma seção, busca por "// ─── NOME ───" (banners).
//       pra listar componentes: grep "^function ".
// =============================================================================
// REGRAS DO PROJETO (ver CLAUDE.md):
//   - NUNCA usar emojis Unicode na UI — usar <Icon name="..." />
//   - Toda mutação no doc apostas via commitBetDocUpdate (transação).
//     Reducer pode retornar estado direto OU { next: <estado> }.
//   - Critério de conquista? Adiciona em ACH e referencia (título E badge).
//   - Senha sempre hashada com hashPassword (SHA-256)
//   - Bump ?v= no styles.css e apostas-app.compiled.js a cada mudança visível
// =============================================================================

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
// MODERADORES: contas de jogador com poderes de gestão da liga — lançar placar e
// travar apostas — e acesso à aba ADMIN. NÃO têm as operações destrutivas/de
// moeda (apagar tudo, migração, ajustar PC/CC), que seguem só pro 'admin'.
const MOD_NICKS = ['bane', 'vitinho', 'mohamed'];
// Senha do admin guardada como hash SHA-256 (texto = 'primitivaoseguro').
// Pra trocar: gera o hash com `echo -n "novasenha" | sha256sum` e cola aqui.
const ADMIN_PASS_HASH = '969c1c616baed41d32c81907be42da9185cff6193cb6d067c94a32ab933c7ab9';

// Hash SHA-256 de uma string usando Web Crypto. Retorna hex.
async function hashPassword(text) {
  const enc = new TextEncoder().encode(String(text || ''));
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── CAMPEONATOS ────────────────────────────────────────────────────────────
// Por enquanto só FIFA está ativo. MK e RL aceitam só inscrições de interesse.
// Marker visível no console pra confirmar que tá rodando a versão nova.
console.log('%c PRIMITIVÃO v=20260602-polish ', 'background:#d76414;color:#fff;font-weight:800;padding:4px 8px;');

const CHAMPIONSHIPS = [
  { id: 'fifa', name: 'Primitivão — FIFA 2026',                  season: 'Season 1', tag: 'FIFA', status: 'active' },
  { id: 'mk',   name: 'Primitivão — Mortal Kombat 2026',         season: 'Season 1', tag: 'MK',   status: 'active' },
  { id: 'rl',   name: 'Primitivão — Rocket League 2026',         season: 'Season 1', tag: 'RL',   status: 'soon'   },
  { id: 'lol',  name: 'Primitivão — League of Legends 2026',     season: 'Season 1', tag: 'LoL',  status: 'soon'   },
  { id: 'cs',   name: 'Primitivão — Counter-Strike 2026',        season: 'Season 1', tag: 'CS',   status: 'soon'   },
  { id: 'gwyf', name: 'Primitivão — Golf With Your Friends 2026', season: 'Season 1', tag: 'GWYF', status: 'soon'   },
  { id: 'valorant', name: 'Primitivão — Valorant 2026',          season: 'Season 1', tag: 'VALORANT', status: 'soon' },
];

// Tema do tabloide por campeonato: título grande, caractere decorativo e selo.
// (O caractere é só decoração no estilo cartaz; pode editar/apagar no painel.)
const TABLOID_THEMES = {
  fifa:     { wordmark: 'PRIMITIVÃO FC',  accent: '球', stamp: 'GOL!',     icon: 'football',  color: '#2e8b3d' },
  mk:       { wordmark: 'MORTAL KOMBAT',  accent: '闘', stamp: 'FIGHT!',   icon: 'skull',     color: '#b3231a' },
  rl:       { wordmark: 'ROCKET LEAGUE',  accent: '速', stamp: 'GOOOL!',   icon: 'rocket',    color: '#2470c8' },
  lol:      { wordmark: 'LEAGUE LEGENDS', accent: '召', stamp: 'GG!',      icon: 'sword',     color: '#b8902a' },
  cs:       { wordmark: 'COUNTER-STRIKE', accent: '弾', stamp: 'CLUTCH!',  icon: 'crosshair', color: '#d98324' },
  gwyf:     { wordmark: 'GOLF FRIENDS',   accent: '球', stamp: 'HOLE!',    icon: 'flag',      color: '#6f9b1f' },
  valorant: { wordmark: 'VALORANT',       accent: '撃', stamp: 'ACE!',     icon: 'target',    color: '#d6346b' },
  copa:     { wordmark: 'COPA DO MUNDO',  accent: '杯', stamp: 'GOOOL!',   icon: 'globe',     color: '#1f8f8a' },
};
const tabloidTheme = (champId) => TABLOID_THEMES[champId] || TABLOID_THEMES.fifa;

// Opções do picker de campeonato no tabloide = os campeonatos + a COPA DO MUNDO
// (bolão separado, não vive em CHAMPIONSHIPS, mas tem tabloide próprio).
const TABLOID_CHAMP_OPTS = [
  ...CHAMPIONSHIPS,
  { id: 'copa', tag: 'COPA', season: 'Copa do Mundo 2026', name: 'Copa do Mundo', status: 'active' },
];

// ─── COPA DO MUNDO (bolão separado, sem PC) ────────────────────────────────
// Dados completos carregados de apostas/world-cup/*.json (104 jogos + 48 times).
// Pontuação do bolão: 3 pts (placar exato) | 1 pt (só o resultado certo) | 0.

// Tradução de nomes de times pra PT-BR (cobre os 48 times da Copa 2026).
const WC_TEAM_TRANSLATIONS = {
  'Mexico': 'México',
  'South Africa': 'África do Sul',
  'South Korea': 'Coreia do Sul',
  'Czech Republic': 'Tchéquia',
  'Canada': 'Canadá',
  'Bosnia & Herzegovina': 'Bósnia e Herzegovina',
  'Qatar': 'Catar',
  'Switzerland': 'Suíça',
  'USA': 'EUA',
  'United States': 'EUA',
  'United States of America': 'EUA',
  'Iceland': 'Islândia',
  'Norway': 'Noruega',
  'Algeria': 'Argélia',
  'Argentina': 'Argentina',
  'Saudi Arabia': 'Arábia Saudita',
  'Egypt': 'Egito',
  'Uruguay': 'Uruguai',
  'France': 'França',
  'Iran': 'Irã',
  'Cape Verde': 'Cabo Verde',
  'Senegal': 'Senegal',
  'Germany': 'Alemanha',
  'Spain': 'Espanha',
  'Sweden': 'Suécia',
  'Curaçao': 'Curaçao',
  'England': 'Inglaterra',
  'Republic of Ireland': 'Irlanda',
  'Ireland': 'Irlanda',
  'Italy': 'Itália',
  "Côte d'Ivoire": 'Costa do Marfim',
  'Ivory Coast': 'Costa do Marfim',
  "Cote d'Ivoire": 'Costa do Marfim',
  'New Zealand': 'Nova Zelândia',
  'Croatia': 'Croácia',
  'Morocco': 'Marrocos',
  'Brazil': 'Brasil',
  'Australia': 'Austrália',
  'Tunisia': 'Tunísia',
  'Portugal': 'Portugal',
  'Cameroon': 'Camarões',
  'Belgium': 'Bélgica',
  'Greece': 'Grécia',
  'Japan': 'Japão',
  'Netherlands': 'Holanda',
  'Holland': 'Holanda',
  'Ecuador': 'Equador',
  'Colombia': 'Colômbia',
  'Türkiye': 'Turquia',
  'Turkey': 'Turquia',
  'Serbia': 'Sérvia',
  'Paraguay': 'Paraguai',
  'Ghana': 'Gana',
  'Austria': 'Áustria',
  'Jordan': 'Jordânia',
  'Poland': 'Polônia',
  'Uzbekistan': 'Uzbequistão',
  'Panama': 'Panamá',
  'Nigeria': 'Nigéria',
  'Denmark': 'Dinamarca',
  'Scotland': 'Escócia',
  'Wales': 'País de Gales',
};
function translateTeamName(name) {
  if (!name) return name;
  return WC_TEAM_TRANSLATIONS[name] || name;
}

// Tradução de fases/rodadas pra PT-BR.
function translateRound(round) {
  if (!round) return '';
  const m = round.match(/^Matchday\s+(\d+)$/);
  if (m) return `RODADA ${m[1]}`;
  const map = {
    'Round of 32':           'OITAVAS DE 32',
    'Round of 16':           'OITAVAS DE FINAL',
    'Quarter-final':         'QUARTAS DE FINAL',
    'Semi-final':            'SEMIFINAL',
    'Match for third place': 'DISPUTA DE 3º LUGAR',
    'Final':                 'FINAL',
  };
  return map[round] || round.toUpperCase();
}

// Converte "13:00 UTC-6" + "2026-06-11" pra { date, time } em BRT (UTC-3).
function convertWcTime(dateISO, timeStr) {
  const m = String(timeStr || '').match(/^(\d{1,2}):(\d{2})\s*UTC([+-]\d+)$/);
  if (!m) {
    const [y, mo, d] = String(dateISO || '').split('-');
    return { date: d && mo ? `${d}/${mo}` : '', time: timeStr || '' };
  }
  const h = parseInt(m[1], 10), min = parseInt(m[2], 10), off = parseInt(m[3], 10);
  // BRT (UTC-3) = (h - off) - 3, sem fazer drift de dia errado
  let brtH = h - off - 3;
  let dayDelta = 0;
  while (brtH < 0)   { brtH += 24; dayDelta--; }
  while (brtH >= 24) { brtH -= 24; dayDelta++; }
  const dt = new Date(dateISO + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + dayDelta);
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(brtH).padStart(2, '0');
  const mn = String(min).padStart(2, '0');
  return { date: `${dd}/${mm}`, time: `${hh}:${mn}` };
}

// Traduz slot de mata-mata ("2A", "1E", "3A/B/C/D/F") pra label legível.
function translateKnockoutSlot(slot) {
  if (!slot) return '';
  const m1 = String(slot).match(/^(\d+)([A-Z](?:\/[A-Z])*)$/);
  if (!m1) return slot;
  return `${m1[1]}º G ${m1[2]}`;
}

// Normaliza uma linha de match do JSON pra estrutura interna usada na UI.
function normalizeWcMatch(raw, idx, teamsByName) {
  if (!raw) return null;
  const { date: brtDate, time: brtTime } = convertWcTime(raw.date, raw.time);
  const isPlaceholder = (s) => /^(\d+)([A-Z](?:\/[A-Z])*)$/.test(String(s || ''));
  const t1Real = !isPlaceholder(raw.team1);
  const t2Real = !isPlaceholder(raw.team2);
  // sentinels usados pela função renderFlag() abaixo — emoji real seria
  // 🏳️/❓, mas a regra do projeto é "sem emojis na UI" (ver CLAUDE.md).
  const FLAG_DEFAULT = '__flag_default__';
  const FLAG_UNKNOWN = '__flag_unknown__';
  const t1 = t1Real
    ? { name: translateTeamName(raw.team1), flag: (teamsByName[raw.team1] || {}).flag_icon || FLAG_DEFAULT, isSlot: false, rawSlot: null, rawName: raw.team1 }
    : { name: translateKnockoutSlot(raw.team1), flag: FLAG_UNKNOWN, isSlot: true, rawSlot: raw.team1, rawName: null };
  const t2 = t2Real
    ? { name: translateTeamName(raw.team2), flag: (teamsByName[raw.team2] || {}).flag_icon || FLAG_DEFAULT, isSlot: false, rawSlot: null, rawName: raw.team2 }
    : { name: translateKnockoutSlot(raw.team2), flag: FLAG_UNKNOWN, isSlot: true, rawSlot: raw.team2, rawName: null };
  const id = raw.num != null ? `wc-${raw.num}` : `wc-i${idx}`;
  const isKnockout = !raw.group;
  return {
    id,
    round: raw.round || '',
    roundLabel: translateRound(raw.round),
    group: raw.group ? raw.group.replace(/^Group\s*/i, '') : '',
    dateISO: raw.date,
    date: brtDate,
    time: brtTime,
    home: t1.name, away: t2.name,
    rawHome: t1.rawName, rawAway: t2.rawName, // nome em inglês (lookup interno)
    flagHome: t1.flag, flagAway: t2.flag,
    slotHome: t1.isSlot, slotAway: t2.isSlot,
    rawSlotHome: t1.rawSlot, rawSlotAway: t2.rawSlot,
    ground: raw.ground || '',
    isKnockout,
  };
}

// Computa standings de um grupo (A-L) a partir das fixtures + results.
function computeWcGroupStandings(group, fixtures, results) {
  const matches = fixtures.filter(m => m.group === group && !m.isKnockout);
  const rec = {};
  // Inicializa todos os times do grupo
  for (const m of matches) {
    if (!rec[m.home]) rec[m.home] = { name: m.home, flag: m.flagHome, J: 0, V: 0, E: 0, D: 0, GP: 0, GC: 0, P: 0 };
    if (!rec[m.away]) rec[m.away] = { name: m.away, flag: m.flagAway, J: 0, V: 0, E: 0, D: 0, GP: 0, GC: 0, P: 0 };
  }
  // Aplica resultados
  for (const m of matches) {
    const r = results[m.id];
    if (!r) continue;
    const t1 = rec[m.home], t2 = rec[m.away];
    if (!t1 || !t2) continue;
    const gh = parseInt(r.gh, 10), ga = parseInt(r.ga, 10);
    if (Number.isNaN(gh) || Number.isNaN(ga)) continue;
    t1.J++; t2.J++;
    t1.GP += gh; t1.GC += ga;
    t2.GP += ga; t2.GC += gh;
    if (gh > ga) { t1.V++; t1.P += 3; t2.D++; }
    else if (gh < ga) { t2.V++; t2.P += 3; t1.D++; }
    else { t1.E++; t1.P++; t2.E++; t2.P++; }
  }
  return Object.values(rec).sort((a, b) => {
    if (b.P !== a.P) return b.P - a.P;
    const sgA = a.GP - a.GC, sgB = b.GP - b.GC;
    if (sgB !== sgA) return sgB - sgA;
    if (b.GP !== a.GP) return b.GP - a.GP;
    return a.name.localeCompare(b.name);
  });
}

// Resolve slot tipo "1A", "2B" pra time real quando o grupo já está completo.
// Retorna null se for multi-grupo (3A/B/C/D/F) ou se grupo ainda não terminou.
function resolveWcSlot(rawSlot, standingsByGroup) {
  if (!rawSlot) return null;
  const m = String(rawSlot).match(/^(\d+)([A-Z])$/);
  if (!m) return null; // multi-group ou formato inválido
  const pos = parseInt(m[1], 10);
  const group = m[2];
  const st = standingsByGroup[group];
  if (!st || st.length < pos) return null;
  // Precisa que cada time do grupo tenha jogado os 3 jogos
  if (!st.every(t => t.J === 3)) return null;
  const t = st[pos - 1];
  return { name: t.name, flag: t.flag };
}

function scoreWcPick(real, pick) {
  if (!real || !pick) return 0;
  const rgh = parseInt(real.gh, 10), rga = parseInt(real.ga, 10);
  const pgh = parseInt(pick.gh, 10), pga = parseInt(pick.ga, 10);
  if ([rgh, rga, pgh, pga].some(Number.isNaN)) return 0;
  if (rgh === pgh && rga === pga) return 3; // placar exato
  const r = rgh > rga ? 'H' : rgh < rga ? 'A' : 'D';
  const p = pgh > pga ? 'H' : pgh < pga ? 'A' : 'D';
  if (r === p) return 1; // só o resultado
  return 0;
}
const CHAMP_BY_ID = Object.fromEntries(CHAMPIONSHIPS.map(c => [c.id, c]));

// Personagens jogáveis do Mortal Kombat 1 (2023). Cada jogador escolhe 3 por
// turno (regra do MK Edição 01). Lista pra "MEU JOGO". Inclui os DLC:
// Kombat Pack 1 (Omni-Man, Quan Chi, Peacemaker, Ermac, Homelander, Takeda) +
// Khaos Reigns (Noob Saibot, Cyrax, Sektor, Ghostface, T-1000, Conan).
const MK_CHARACTERS = [
  'Ashrah', 'Baraka', 'Conan', 'Cyrax', 'Ermac', 'General Shao', 'Geras',
  'Ghostface', 'Havik', 'Homelander', 'Johnny Cage', 'Kenshi', 'Kitana',
  'Kung Lao', 'Li Mei', 'Liu Kang', 'Mileena', 'Nitara', 'Noob Saibot',
  'Omni-Man', 'Peacemaker', 'Quan Chi', 'Raiden', 'Rain', 'Reptile',
  'Scorpion', 'Sektor', 'Shang Tsung', 'Sindel', 'Smoke', 'Sub-Zero',
  'T-1000', 'Takeda', 'Tanya',
];
const MK_MAX_CHARS = 3;

// Bordas dos 8 primeiros: pódio (1º-3º) com cor própria, do 4º ao 8º uma cor só.
const MK_PODIUM_COLORS = ['#d4af37', '#c0c0c0', '#cd7f32']; // ouro, prata, bronze
const MK_QUALIFIED_COLOR = '#2470c8'; // 4º ao 8º — privilegiados, mesma cor
const MK_TOP8_COLORS = [
  MK_PODIUM_COLORS[0], MK_PODIUM_COLORS[1], MK_PODIUM_COLORS[2],
  MK_QUALIFIED_COLOR, MK_QUALIFIED_COLOR, MK_QUALIFIED_COLOR, MK_QUALIFIED_COLOR, MK_QUALIFIED_COLOR,
];

// Fisher-Yates — embaralha uma cópia (não muta o original). É o "sorteio" de fato:
// a ordem dos inscritos vira aleatória antes de montar o chaveamento.
function shuffleArr(arrIn) {
  const a = (arrIn || []).slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// Sorteio todos-contra-todos IDA e VOLTA (método do círculo). Devolve as rodadas
// [{ phase:'IDA'|'VOLTA', n, games:[{home,away}] }]. Ephemeral (regera no clique).
function generateMkDraw(playersIn) {
  const players = (playersIn || []).slice();
  if (players.length < 2) return [];
  if (players.length % 2 === 1) players.push('__bye__');
  const n = players.length, half = n / 2;
  const arr = players.slice();
  const ida = [];
  for (let r = 0; r < n - 1; r++) {
    const games = [];
    for (let i = 0; i < half; i++) {
      let home = arr[i], away = arr[n - 1 - i];
      if (home === '__bye__' || away === '__bye__') continue;
      if (r % 2 === 1) { const t = home; home = away; away = t; } // alterna mando
      games.push({ home, away });
    }
    ida.push({ phase: 'IDA', n: r + 1, games });
    arr.splice(1, 0, arr.pop()); // rotaciona mantendo o primeiro fixo
  }
  const volta = ida.map((rd, i) => ({ phase: 'VOLTA', n: i + 1, games: rd.games.map(g => ({ home: g.away, away: g.home })) }));
  return [...ida, ...volta];
}

// ─── MODELO DO MK — confronto = 2 PARTIDAS, cada uma PRIMEIRO A 2 ROUNDS.
// Resultado em partidas: 2×0 (vitória) / 1×1 (empate) / 0×2 (derrota).
// sc = { p1h, p1a, p2h, p2a } (rounds de cada lado nas 2 partidas).
function mkMatchOutcome(sc) {
  if (!sc) return null;
  const v = ['p1h', 'p1a', 'p2h', 'p2a'].map(k => parseInt(sc[k], 10));
  if (v.some(x => Number.isNaN(x))) return null;
  const [p1h, p1a, p2h, p2a] = v;
  const confH = (p1h > p1a ? 1 : 0) + (p2h > p2a ? 1 : 0);
  const confA = 2 - confH;
  const roundsH = p1h + p2h, roundsA = p1a + p2a;
  return { p1h, p1a, p2h, p2a, confH, confA, roundsH, roundsA, total: roundsH + roundsA,
    winner: confH > confA ? 'H' : confH < confA ? 'A' : 'D' }; // D = empate (1×1)
}

// Apostas de UM confronto MK estão FECHADAS? Fecha por (a) trava manual `locked`
// OU (b) cronômetro de fechamento `lockAt` (timestamp ms) já vencido. #4: o mod
// pode iniciar uma contagem regressiva visível em vez de travar de uma vez.
function mkGameClosed(scEntry, nowMs) {
  if (!scEntry) return false;
  if (scEntry.locked) return true;
  const at = scEntry.lockAt;
  return !!(at && (nowMs || Date.now()) >= at);
}
// Segundos restantes até o fechamento agendado (>0 só durante a contagem). 0 se
// não há cronômetro ativo ou já fechou.
function mkLockSecondsLeft(scEntry, nowMs) {
  if (!scEntry || scEntry.locked || !scEntry.lockAt) return 0;
  const left = Math.ceil((scEntry.lockAt - (nowMs || Date.now())) / 1000);
  return left > 0 ? left : 0;
}
const MK_LOCK_COUNTDOWN_S = 30; // duração padrão do cronômetro de fechamento

// Classificação — vitória 3, empate (1×1) 1, derrota 0. Desempate: pontos ->
// saldo de rounds -> vitórias -> rounds pró -> nome. matches: [{home, away, sc}].
function computeMkStandings(players, matches) {
  const rec = {};
  (players || []).forEach(p => { rec[p] = { id: p, nick: p, j: 0, v: 0, e: 0, d: 0, rp: 0, rc: 0, p: 0 }; });
  (matches || []).forEach(m => {
    const o = mkMatchOutcome(m.sc);
    if (!o) return;
    const H = rec[m.home], A = rec[m.away];
    if (!H || !A) return;
    H.j++; A.j++;
    H.rp += o.roundsH; H.rc += o.roundsA; A.rp += o.roundsA; A.rc += o.roundsH;
    if (o.winner === 'H') { H.v++; A.d++; H.p += 3; }
    else if (o.winner === 'A') { A.v++; H.d++; A.p += 3; }
    else { H.e++; A.e++; H.p += 1; A.p += 1; }
  });
  return Object.values(rec).sort((a, b) => {
    if (b.p !== a.p) return b.p - a.p;
    const sa = a.rp - a.rc, sb = b.rp - b.rc;
    if (sb !== sa) return sb - sa;
    if (b.v !== a.v) return b.v - a.v;
    if (b.rp !== a.rp) return b.rp - a.rp;
    return a.nick.localeCompare(b.nick);
  });
}

// ─── ODDS DO MK — modelo de 2 níveis (round -> partida -> confronto). Da força
// sai p (prob do mandante vencer 1 round); daí a binomial negativa "primeiro a 2"
// dá a partida, e as 2 partidas independentes dão o confronto.
// Finalização e Flawless são mercados; o ADMIN marca o resultado no lançamento
// (cartão admin-only), com DUAS finalizações por confronto (uma por partida).
// Mercados OFERECIDOS na aba de apostas. 'RESULT' (RESULTADO PARTIDAS) foi
// aposentado (#2): era redundante com 'VENC' (H=2×0, EMPATE=1×1, A=0×2, mesmas
// odds) e confundia o apostador simples. Mantemos VENC (quem vence, label claro)
// e os placares por partida (P1/P2), que NÃO são redundantes. A lógica de
// RESULT (título/label/liquidação) continua existindo logo abaixo só pra
// apostas antigas já feitas continuarem liquidando e aparecendo certo.
const MK_MARKETS = ['VENC', 'P1', 'P2', 'TOTAL', 'FINISH', 'FLAW'];
const MK_MARKET_TITLE = { VENC: 'VENCEDOR', RESULT: 'RESULTADO (PARTIDAS)', P1: 'PLACAR PARTIDA 1', P2: 'PLACAR PARTIDA 2', TOTAL: 'TOTAL DE ROUNDS', FINISH: 'FINALIZAÇÃO', FLAW: 'FLAWLESS VICTORY' };
const MK_RESULT_PICKS = ['20', '11', '02'];          // 2×0 / 1×1 / 0×2
const MK_PARTIDA_PICKS = ['20', '21', '12', '02']; // mandante x visitante (primeiro a 2)
// Odd do MK: pagamento conservador no COMEÇO sem capar o crescimento. Em vez de
// teto, comprime o "lucro" da odd justa: no simétrico o placar (justo 4.00) sai em
// ~2.25, mas jogos desequilibrados ainda sobem (até MK_ODD_TOP). Só afeta o MK.
//   odd = 1 + (1/p - 1) * MK_ODD_K   ->  4.00 vira 1 + 3*0.4167 = 2.25
const MK_ODD_K = 0.4167;   // 4.00 -> 2.25 no simétrico
const MK_ODD_TOP = 15.0;   // teto alto: azarões podem chegar até aqui
const MK_TOTAL_PICKS = ['4', '5', '6'];   // total de rounds das 2 partidas
const MK_FLAWLESS_PROB = 0.40; // pode rolar em qualquer das 2 partidas
// Só Brutality é apostável (a Fatality é obrigatória ao vencer, então não vira
// mercado). Flawless Victory é mercado à parte (FLAW) + toggle no lançamento.
const MK_FINISHERS = [
  { id: 'brutality', name: 'Brutality', p: 0.24 },
];

// prob do mandante VENCER 1 partida (primeiro a 2) dado p (prob de 1 round).
// primeiro a 2 = melhor de 3: P(vence) = p² + 2p²(1-p) = p²(3-2p).
function mkPartidaWinProb(p) { return p * p * (3 - 2 * p); }
// distribuição do placar de UMA partida (primeiro a 2 rounds).
function mkPartidaDist(p) {
  const q = 1 - p;
  return {
    '20': p * p, '21': 2 * p * p * q,
    '12': 2 * p * q * q, '02': q * q,
  };
}
function computeMkPlayerMetrics(players, matches) {
  const out = {};
  computeMkStandings(players, matches).forEach(s => { out[s.nick] = { strength: s.p * 3 + (s.rp - s.rc) }; });
  return out;
}
function mkRoundWinProb(home, away, metrics) {
  const H = (metrics || {})[home] || { strength: 0 }, A = (metrics || {})[away] || { strength: 0 };
  // Clamp mais largo (era 0.25–0.75): jogos bem desequilibrados geram odds altas
  // (azarão pode chegar perto do MK_ODD_TOP). No começo (forças iguais) dá 0.5.
  return Math.max(0.16, Math.min(0.84, sigmoid((H.strength - A.strength) * 0.04)));
}
function computeMkGameOdds(home, away, metrics) {
  const p = mkRoundWinProb(home, away, metrics);
  const q = mkPartidaWinProb(p);                  // mandante vence uma partida
  const p20 = q * q, p11 = 2 * q * (1 - q), p02 = (1 - q) * (1 - q);
  const pd = mkPartidaDist(p);
  const a = pd['20'] + pd['02'], b = pd['21'] + pd['12']; // partida com 2 ou 3 rounds
  const total = { '4': a * a, '5': 2 * a * b, '6': b * b };
  // odd do MK: justa (1/p) com o lucro comprimido por MK_ODD_K; teto MK_ODD_TOP.
  const mko = (pp) => (!(pp > 0) || !isFinite(pp)) ? MK_ODD_TOP
    : Math.max(ODD_MIN, Math.min(MK_ODD_TOP, +(1 + (1 / pp - 1) * MK_ODD_K).toFixed(2)));
  const partida = {}; MK_PARTIDA_PICKS.forEach(pk => { partida[pk] = mko(pd[pk]); });
  const totalO = {}; MK_TOTAL_PICKS.forEach(t => { totalO[t] = mko(total[t]); });
  // finalização pode sair em QUALQUER das 2 partidas -> P = 1 - (1-p)^2.
  const finish = {}; MK_FINISHERS.forEach(f => { finish[f.id] = mko(1 - Math.pow(1 - f.p, 2)); });
  return {
    VENC:   { H: mko(p20), D: mko(p11), A: mko(p02) },
    RESULT: { '20': mko(p20), '11': mko(p11), '02': mko(p02) },
    P1: partida, P2: partida, TOTAL: totalO,
    FINISH: finish,
    FLAW:   { Y: mko(MK_FLAWLESS_PROB), N: mko(1 - MK_FLAWLESS_PROB) },
  };
}
// Ordem de exibição (chaves "inteiras" do JS reordenam — fixar aqui).
function mkMarketPicks(market, odds) {
  if (market === 'RESULT') return MK_RESULT_PICKS;
  if (market === 'P1' || market === 'P2') return MK_PARTIDA_PICKS;
  if (market === 'TOTAL') return MK_TOTAL_PICKS;
  if (market === 'FINISH') return MK_FINISHERS.map(f => f.id);
  return Object.keys(odds[market]);
}
// Resolução. sc = placar do confronto; extra = { finisher1, finisher2, flawless }.
function mkLegResult(market, pick, sc, extra) {
  const o = mkMatchOutcome(sc);
  if (!o) return 'pending'; // confronto não concluído -> tudo pendente
  const e = extra || {};
  switch (market) {
    case 'VENC':   return pick === o.winner ? 'win' : 'lose';
    case 'RESULT': return pick === ('' + o.confH + o.confA) ? 'win' : 'lose';
    case 'P1':     return pick === ('' + o.p1h + o.p1a) ? 'win' : 'lose';
    case 'P2':     return pick === ('' + o.p2h + o.p2a) ? 'win' : 'lose';
    case 'TOTAL':  return pick === String(o.total) ? 'win' : 'lose';
    case 'FLAW':   return (!!e.flawless === (pick === 'Y')) ? 'win' : 'lose';
    case 'FINISH': return (e.finisher1 === pick || e.finisher2 === pick) ? 'win' : 'lose'; // saiu em qualquer partida
    default: return 'pending';
  }
}
function mkPickLabel(market, pick) {
  if (market === 'VENC') return { H: 'MANDANTE', D: 'EMPATE', A: 'VISITANTE' }[pick];
  if (market === 'RESULT' || market === 'P1' || market === 'P2') return pick[0] + '×' + pick[1];
  if (market === 'TOTAL') return pick + ' rounds';
  if (market === 'FLAW') return pick === 'Y' ? 'SIM' : 'NÃO';
  if (market === 'FINISH') { const f = MK_FINISHERS.find(x => x.id === pick); return f ? f.name : pick; }
  return pick;
}
// Dois palpites do MESMO jogo se contradizem? (não dá pra ganhar os dois juntos)
function mkLegsContradict(a, b) {
  const indep = m => m === 'FINISH' || m === 'FLAW';
  // FINISH/FLAW independem do placar: só contradizem outro do mesmo tipo (pick diferente).
  if (indep(a.market) || indep(b.market)) return a.market === b.market && a.pick !== b.pick;
  // ambos baseados em placar: existe algum resultado onde os DOIS ganham?
  for (const p1 of MK_PARTIDA_PICKS) for (const p2 of MK_PARTIDA_PICKS) {
    const sc = { p1h: p1[0], p1a: p1[1], p2h: p2[0], p2a: p2[1] };
    if (mkLegResult(a.market, a.pick, sc) === 'win' && mkLegResult(b.market, b.pick, sc) === 'win') return false;
  }
  return true; // nenhum resultado possível satisfaz os dois -> contradiz
}

const START_PC = 50;
const WEEKLY_PC = 500;

// Bônus libera TODA SEGUNDA 10:00 BRT (= 13:00 UTC). Quem ainda não
// resgatou nesta janela (lastWeekly < última segunda 10h) está elegível.
// Como a regra é baseada em "última segunda passada", trocar o valor da
// constante WEEKLY_PC ou qualquer ajuste já libera todo mundo cuja última
// claim foi antes da última segunda — sem precisar de timestamp manual.
function lastMondayAt10BRT(now) {
  const t = now == null ? Date.now() : now;
  const d = new Date(t);
  const day = d.getUTCDay(); // 0=Dom, 1=Seg, ..., 6=Sáb
  let daysBack;
  if (day === 1) {
    daysBack = d.getUTCHours() >= 13 ? 0 : 7; // antes das 10h BRT, volta 1 semana
  } else {
    daysBack = (day + 6) % 7; // Dom=0→6, Ter=2→1, Qua=3→2, Sáb=6→5
  }
  const m = new Date(d);
  m.setUTCDate(d.getUTCDate() - daysBack);
  m.setUTCHours(13, 0, 0, 0);
  return m.getTime();
}
function nextMondayAt10BRT(now) {
  return lastMondayAt10BRT(now) + 7 * 24 * 60 * 60 * 1000;
}

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
    // Reducers podem retornar o estado DIRETO (ex: { ...remote, bets }) OU
    // envelopado em { next: <estado> } (usado pelo write-back). Desempacota.
    // CRÍTICO: sem isso, { next } seria gravado como lixo dentro do json e o
    // estado real (dentro de next) seria ignorado.
    const next = (out && typeof out === 'object' && out.next && typeof out.next === 'object')
      ? out.next
      : out;
    // Normalização defensiva: garante schema mínimo, sem perder fields de cur.
    const validMap = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    const protectMap = (outVal, curVal, label) => {
      const o = validMap(outVal);
      const c = validMap(curVal);
      // Proteção contra zeragem acidental (stale tab, race, reducer bugado).
      // NUNCA escrevemos {} se remote tinha entradas. Wipe legítimo precisa
      // ir via wipeAllData (que usa BET_DOC().set() direto, fora desse helper).
      if (o && Object.keys(o).length === 0 && c && Object.keys(c).length > 0) {
        console.warn(`commitBetDocUpdate: rejeitou zerar ${label} (cur tem ${Object.keys(c).length} entradas)`);
        return c;
      }
      return o || c || {};
    };
    const safe = {
      // Spread `cur` primeiro pra preservar QUALQUER campo extra dentro do
      // json que esse reducer nao tocou (futura compat com schemas novos).
      ...cur,
      // Mistura tambem o `next` pra pegar quaisquer fields novos que o
      // reducer adicionou alem dos 4 conhecidos abaixo.
      ...(next && typeof next === 'object' ? next : {}),
      // Override final dos 4 fields canonicos com normalizacao defensiva:
      users:       protectMap(next && next.users,       cur.users,       'users'),
      teamPlayers: protectMap(next && next.teamPlayers, cur.teamPlayers, 'teamPlayers'),
      fixtures:    Array.isArray(next && next.fixtures) ? next.fixtures
                       : (Array.isArray(cur.fixtures) ? cur.fixtures : DEFAULT_FIXTURES),
      bets:        Array.isArray(next && next.bets) ? next.bets
                       : (Array.isArray(cur.bets) ? cur.bets : []),
    };
    // Defensivo: limpa lixo `next` que possa ter vazado pro json em writes
    // antigos (antes desta correção). Idempotente.
    if ('next' in safe) delete safe.next;
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
    // Spread `remote` primeiro pra preservar QUALQUER campo dentro do json
    // que esta tab ainda nao conhece (ex: schema novo adicionado depois).
    ...remote,
    // users: merge DEEP por nick — local ganha em conflito de campo, mas
    // campos que so estao no remote (ex: cosmetics nova) sao preservados.
    // Antes era shallow ({ ...remote.users, ...local.users }) que apagava
    // cosmetics/inventory/title novos do remote se local tinha versao antiga.
    users:       mergeUsersDeep(remote.users || {}, local.users || {}),
    teamPlayers: { ...(remote.teamPlayers || {}), ...(local.teamPlayers || {}) },
    // bets: união por id, local ganha em conflito.
    bets:        mergeBetsById(remote.bets || [], local.bets || []),
    // fixtures: take local (não é editado concorrentemente).
    fixtures:    local.fixtures || remote.fixtures || DEFAULT_FIXTURES,
  };
}

// Merge deep de users[nick] field-by-field — local ganha em conflito
// MAS preserva qualquer field que so existe no remote.
// Critico pra evitar perda de cosmetics/inventory/title quando uma tab
// tem state antigo (sem o campo) e outra tab acabou de gravar o campo.
function mergeUsersDeep(remote, local) {
  const out = {};
  const all = new Set([...Object.keys(remote || {}), ...Object.keys(local || {})]);
  for (const nick of all) {
    const r = remote[nick] || null;
    const l = local[nick]  || null;
    if (r && l)       out[nick] = { ...r, ...l }; // local prevalece em conflito, mas r-only fields preservados
    else if (l)       out[nick] = l;
    else if (r)       out[nick] = r;
  }
  return out;
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
    const topLevelComments  = rawApostas.comments;
    const topLevelWorldcup  = rawApostas.worldcup;
    const topLevelNews      = rawApostas.news;
    const topLevelWebhook   = rawApostas.discord_webhook;
    const apostasData = apostas.data ? { ...apostas.data } : null;
    if (apostasData) {
      apostasData.interests = (topLevelInterests && typeof topLevelInterests === 'object')
        ? topLevelInterests
        : (apostasData.interests || {});
      apostasData.comments = (topLevelComments && typeof topLevelComments === 'object')
        ? topLevelComments
        : (apostasData.comments || {});
      // Copa do Mundo (CRITICO — palpites do bolão)
      apostasData.worldcup = (topLevelWorldcup && typeof topLevelWorldcup === 'object')
        ? { results: topLevelWorldcup.results || {}, picks: topLevelWorldcup.picks || {} }
        : (apostasData.worldcup || { results: {}, picks: {} });
      if (Array.isArray(topLevelNews)) apostasData.news = topLevelNews;
      if (typeof topLevelWebhook === 'string') apostasData.discord_webhook = topLevelWebhook;
    }
    const wcPicks = Object.values(apostasData?.worldcup?.picks || {})
                          .reduce((s, perUser) => s + Object.keys(perUser || {}).length, 0);
    const wcResults = Object.keys(apostasData?.worldcup?.results || {}).length;
    const payload = {
      exportedAt: new Date().toISOString(),
      version: 6,
      source: 'browser-admin',
      apostas:       apostasData,
      classificacao: classificacao.data,
      _raw: { apostas, classificacao, topLevelInterests, topLevelComments, topLevelWorldcup, topLevelNews, topLevelWebhook },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const a = document.createElement('a');
    a.href = url;
    a.download = `primitivao-backup-${ts}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    // Stats extras pra confirmar visualmente que NADA foi perdido
    const usersList = Object.values(apostasData?.users || {});
    const withCosmetics = usersList.filter(u => u && u.cosmetics && Object.keys(u.cosmetics).length > 0).length;
    const withInventory = usersList.filter(u => u && Array.isArray(u.inventory) && u.inventory.length > 0).length;
    const withTitle     = usersList.filter(u => u && u.title).length;
    return {
      ok: true,
      users: Object.keys(payload.apostas?.users || {}).length,
      bets:  (payload.apostas?.bets || []).length,
      wcPicks, wcResults,
      news:  Array.isArray(apostasData?.news) ? apostasData.news.length : 0,
      cosmetics: withCosmetics,
      inventory: withInventory,
      titles:    withTitle,
    };
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
      // Separa campos top-level (que ficam siblings do `json` stringificado).
      const { interests, comments, worldcup, news, discord_webhook, ...rest } = apostas;
      // SALVAGUARDA: dados AO VIVO que o backup pode não ter — restaurar um backup
      // ANTIGO não deve apagar o campeonato MK em andamento (sorteio/placar/apostas).
      // Se o backup não traz `mk` mas o doc atual tem, preserva o atual.
      if (rest.mk == null) {
        try {
          const curSnap = await BET_DOC().get();
          if (curSnap.exists && typeof curSnap.data().json === 'string') {
            const cur = JSON.parse(curSnap.data().json);
            if (cur && cur.mk && Array.isArray(cur.mk.draw)) rest.mk = cur.mk;
          }
        } catch (e) { console.warn('restore: preservar mk ao vivo falhou', e); }
      }
      const wcSafe = (worldcup && typeof worldcup === 'object')
        ? { results: worldcup.results || {}, picks: worldcup.picks || {} }
        : { results: {}, picks: {} };
      const setPayload = {
        json: JSON.stringify(rest),
        interests: (interests && typeof interests === 'object') ? interests : {},
        comments:  (comments  && typeof comments  === 'object') ? comments  : {},
        worldcup:  wcSafe,
        updatedAt: Date.now(),
      };
      if (Array.isArray(news)) setPayload.news = news;
      if (typeof discord_webhook === 'string') setPayload.discord_webhook = discord_webhook;
      writes.push(BET_DOC().set(setPayload));
    }
    if (classificacao != null) {
      writes.push(CLASSIF_DOC().set({
        json: JSON.stringify(classificacao),
        updatedAt: Date.now(),
      }));
    }
    await Promise.all(writes);
    const wcPicksRestored = Object.values(apostas?.worldcup?.picks || {})
                                  .reduce((s, perUser) => s + Object.keys(perUser || {}).length, 0);
    const wcResultsRestored = Object.keys(apostas?.worldcup?.results || {}).length;
    return {
      ok: true,
      applied: {
        users:     Object.keys(apostas?.users || {}).length,
        bets:      (apostas?.bets || []).length,
        teams:     Object.keys(apostas?.teamPlayers || {}).length,
        interests: Object.values(apostas?.interests || {})
                          .reduce((s, x) => s + Object.keys(x || {}).length, 0),
        comments:  Object.values(apostas?.comments || {})
                          .reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0),
        wcPicks:   wcPicksRestored,
        wcResults: wcResultsRestored,
        news:      Array.isArray(apostas?.news) ? apostas.news.length : 0,
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
    // PRESERVA configs do admin (news, discord_webhook) — usa merge:true
    // e zera explicitamente só os campos de dados (users, bets, etc).
    // Wipe é pra resetar dados de jogadores/apostas, NÃO pra apagar a
    // configuração do site.
    await Promise.all([
      BET_DOC().set({
        json: JSON.stringify({ users: {}, fixtures: DEFAULT_FIXTURES, bets: [], teamPlayers: {} }),
        interests: {}, // dados de inscrições — zera
        comments:  {}, // comentários em news — zera
        worldcup:  { results: {}, picks: {} }, // bolão Copa — zera
        // news + discord_webhook NÃO são tocados (merge:true preserva)
        updatedAt: Date.now(),
      }, { merge: true }),
      CLASSIF_DOC().set({
        json: JSON.stringify({ currentRound: 0, rounds: defaultRounds() }),
        updatedAt: Date.now(),
      }, { merge: true }),
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
function MiniCrest({ size = 38 }) {
  return (
    <img
      src="primitivao-icon.png"
      alt="Primitivão"
      width={size}
      height={size}
      style={{ display: 'block', objectFit: 'contain', flexShrink: 0 }}
    />
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

// ─── AVATAR ──────────────────────────────────────────────────────────────────
// Renderiza o avatar do jogador (PNG estilo Cartoon Network corpo inteiro).
// Avatar é por TIME (não por user), então só os 8 jogadores vinculados a
// times da FIFA Season 1 têm. Admin e users sem time vinculado mostram
// fallback (círculo com inicial do nick).
//
// Props:
//   - teamId:   id do time (prioridade 1)
//   - nick:     nick do user (usado pra resolver via teamPlayers se teamId não vier)
//   - teamPlayers: map nick→teamId (pra resolver quando só passa nick)
//   - size:     tamanho em px (lado do quadrado pra ícone, ou largura pro full)
//   - fullBody: true mostra PNG inteiro; false mostra só a cabeça (crop top)
//   - className: classe extra
// Molduras decorativas estilo "summoner frame" (inspirado em LoL), mas na
// paleta do site. SVG inline, viewBox 0 0 100 100 — o avatar circular fica
// no centro (~raio 38) e a moldura desenha o anel + ornamentos (chifres,
// asas, gemas) em volta. So aparece no modo icone (avatar circular).
function FrameDeco({ frameId }) {
  const common = {
    viewBox: '0 0 100 100',
    className: 'frame-deco',
    'aria-hidden': 'true',
    preserveAspectRatio: 'xMidYMid meet',
  };
  switch (frameId) {
    // BRONZE — comum: anel duplo + 2 chifres curtos no topo + gema embaixo
    case 'frame-bronze':
      return (
        <svg {...common}>
          <circle cx="50" cy="50" r="43" fill="none" stroke="#6b3e1a" strokeWidth="6" />
          <circle cx="50" cy="50" r="43" fill="none" stroke="#c98a4d" strokeWidth="3" />
          <circle cx="50" cy="50" r="43" fill="none" stroke="#e9c08a" strokeWidth="1" opacity="0.7" />
          {/* chifres topo */}
          <path d="M34 12 Q40 2 46 11 L42 19 Q38 14 34 12 Z" fill="#c98a4d" stroke="#6b3e1a" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M66 12 Q60 2 54 11 L58 19 Q62 14 66 12 Z" fill="#c98a4d" stroke="#6b3e1a" strokeWidth="1.5" strokeLinejoin="round" />
          {/* gema base */}
          <circle cx="50" cy="93" r="6" fill="#e9c08a" stroke="#6b3e1a" strokeWidth="2" />
          <circle cx="50" cy="93" r="2.2" fill="#fff" opacity="0.7" />
        </svg>
      );
    // PRATA — rara: anel triplo + asas laterais + gemas no topo
    case 'frame-silver':
      return (
        <svg {...common}>
          <circle cx="50" cy="50" r="43" fill="none" stroke="#6e6e6e" strokeWidth="6" />
          <circle cx="50" cy="50" r="43" fill="none" stroke="#cfcfcf" strokeWidth="3" />
          <circle cx="50" cy="50" r="43" fill="none" stroke="#ffffff" strokeWidth="1" opacity="0.8" />
          {/* asa esquerda */}
          <path d="M9 50 Q2 40 8 34 Q10 42 16 44 Q8 46 12 52 Q6 54 9 50 Z" fill="#cfcfcf" stroke="#6e6e6e" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M12 58 Q5 54 9 48 Q13 54 18 54 Q12 58 16 62 Q11 62 12 58 Z" fill="#bcbcbc" stroke="#6e6e6e" strokeWidth="1.2" strokeLinejoin="round" />
          {/* asa direita (espelhada) */}
          <path d="M91 50 Q98 40 92 34 Q90 42 84 44 Q92 46 88 52 Q94 54 91 50 Z" fill="#cfcfcf" stroke="#6e6e6e" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M88 58 Q95 54 91 48 Q87 54 82 54 Q88 58 84 62 Q89 62 88 58 Z" fill="#bcbcbc" stroke="#6e6e6e" strokeWidth="1.2" strokeLinejoin="round" />
          {/* gema topo */}
          <circle cx="50" cy="8" r="5.5" fill="#eaf2ff" stroke="#6e6e6e" strokeWidth="2" />
          <circle cx="50" cy="8" r="2" fill="#fff" />
          {/* gemas base laterais */}
          <circle cx="36" cy="90" r="3" fill="#cfcfcf" stroke="#6e6e6e" strokeWidth="1.2" />
          <circle cx="64" cy="90" r="3" fill="#cfcfcf" stroke="#6e6e6e" strokeWidth="1.2" />
        </svg>
      );
    // OURO — lendaria: anel grosso + chifres grandes + picos radiais + gemas + glow
    case 'frame-gold':
      return (
        <svg {...common} className="frame-deco frame-deco-gold">
          {/* picos radiais sutis */}
          <g stroke="#9e8024" strokeWidth="1.5" opacity="0.8">
            <line x1="50" y1="2" x2="50" y2="9" />
            <line x1="18" y1="18" x2="23" y2="23" />
            <line x1="82" y1="18" x2="77" y2="23" />
            <line x1="6" y1="50" x2="13" y2="50" />
            <line x1="94" y1="50" x2="87" y2="50" />
          </g>
          <circle cx="50" cy="50" r="43" fill="none" stroke="#6b5616" strokeWidth="7" />
          <circle cx="50" cy="50" r="43" fill="none" stroke="#d4af37" strokeWidth="4" />
          <circle cx="50" cy="50" r="43" fill="none" stroke="#ffe9a8" strokeWidth="1.4" opacity="0.9" />
          {/* chifres grandes topo */}
          <path d="M30 14 Q34 -2 44 9 Q40 4 38 13 Q42 12 46 16 L40 22 Q34 17 30 14 Z" fill="#d4af37" stroke="#6b5616" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M70 14 Q66 -2 56 9 Q60 4 62 13 Q58 12 54 16 L60 22 Q66 17 70 14 Z" fill="#d4af37" stroke="#6b5616" strokeWidth="1.6" strokeLinejoin="round" />
          {/* asas laterais douradas */}
          <path d="M8 52 Q0 42 7 35 Q9 44 17 45 Q9 48 13 55 Q6 56 8 52 Z" fill="#d4af37" stroke="#6b5616" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M92 52 Q100 42 93 35 Q91 44 83 45 Q91 48 87 55 Q94 56 92 52 Z" fill="#d4af37" stroke="#6b5616" strokeWidth="1.4" strokeLinejoin="round" />
          {/* gema central base (grande) */}
          <path d="M50 86 l7 6 -7 8 -7 -8 Z" fill="#ffcf5a" stroke="#6b5616" strokeWidth="2" strokeLinejoin="round" />
          <circle cx="50" cy="93" r="2.4" fill="#fff" opacity="0.85" />
          {/* gemas menores laterais base */}
          <circle cx="32" cy="86" r="3" fill="#ffe9a8" stroke="#6b5616" strokeWidth="1.4" />
          <circle cx="68" cy="86" r="3" fill="#ffe9a8" stroke="#6b5616" strokeWidth="1.4" />
        </svg>
      );
    // VINHO — anel vinho com espinhos ao redor
    case 'frame-vinho':
      return (
        <svg {...common}>
          <circle cx="50" cy="50" r="43" fill="none" stroke="#3e0f0f" strokeWidth="6" />
          <circle cx="50" cy="50" r="43" fill="none" stroke="#a52a2a" strokeWidth="3" />
          <circle cx="50" cy="50" r="43" fill="none" stroke="#d56a5a" strokeWidth="1" opacity="0.7" />
          {/* espinhos radiais (8) */}
          <g fill="#a52a2a" stroke="#3e0f0f" strokeWidth="1.2" strokeLinejoin="round">
            <path d="M50 1 l4 8 -8 0 Z" />
            <path d="M99 50 l-8 4 0 -8 Z" />
            <path d="M1 50 l8 4 0 -8 Z" />
            <path d="M50 99 l4 -8 -8 0 Z" />
            <path d="M15 15 l8 1 -5 6 Z" />
            <path d="M85 15 l-8 1 5 6 Z" />
            <path d="M15 85 l8 -1 -5 -6 Z" />
            <path d="M85 85 l-8 -1 5 -6 Z" />
          </g>
        </svg>
      );
    // MINT — anel verde com folhas de louro nas laterais
    case 'frame-mint':
      return (
        <svg {...common}>
          <circle cx="50" cy="50" r="43" fill="none" stroke="#1c4a36" strokeWidth="6" />
          <circle cx="50" cy="50" r="43" fill="none" stroke="#2a8f3f" strokeWidth="3" />
          <circle cx="50" cy="50" r="43" fill="none" stroke="#6fe3a0" strokeWidth="1" opacity="0.7" />
          {/* louros laterais */}
          <g fill="#2a8f3f" stroke="#1c4a36" strokeWidth="1" strokeLinejoin="round">
            <path d="M8 38 Q2 46 6 56 Q10 50 14 52 Q9 46 12 40 Q9 42 8 38 Z" />
            <path d="M12 50 Q6 56 9 64 Q13 58 17 59 Q12 54 15 49 Q12 51 12 50 Z" />
            <path d="M92 38 Q98 46 94 56 Q90 50 86 52 Q91 46 88 40 Q91 42 92 38 Z" />
            <path d="M88 50 Q94 56 91 64 Q87 58 83 59 Q88 54 85 49 Q88 51 88 50 Z" />
          </g>
          {/* gema topo */}
          <circle cx="50" cy="8" r="5" fill="#6fe3a0" stroke="#1c4a36" strokeWidth="1.6" />
        </svg>
      );
    // DIAMANTE — anel cristal azul com picos de gelo
    case 'frame-diamante':
      return (
        <svg {...common} className="frame-deco frame-deco-diamante">
          <circle cx="50" cy="50" r="43" fill="none" stroke="#1c4a6b" strokeWidth="6" />
          <circle cx="50" cy="50" r="43" fill="none" stroke="#5ec8e3" strokeWidth="3" />
          <circle cx="50" cy="50" r="43" fill="none" stroke="#d6f5ff" strokeWidth="1.4" opacity="0.9" />
          {/* cristais (losangos) ao redor */}
          <g fill="#9fe6f5" stroke="#1c4a6b" strokeWidth="1.2" strokeLinejoin="round">
            <path d="M50 1 l5 7 -5 7 -5 -7 Z" />
            <path d="M99 50 l-7 5 -7 -5 7 -5 Z" />
            <path d="M1 50 l7 5 7 -5 -7 -5 Z" />
            <path d="M50 99 l5 -7 -5 -7 -5 7 Z" />
          </g>
          {/* brilhos */}
          <circle cx="22" cy="22" r="2" fill="#fff" />
          <circle cx="78" cy="78" r="2" fill="#fff" />
        </svg>
      );
    // FATALITY — anel sangue com chamas (drop do campeão de MK)
    case 'frame-fatality':
      return (
        <svg {...common} className="frame-deco frame-deco-gold">
          <circle cx="50" cy="50" r="43" fill="none" stroke="#1c0606" strokeWidth="7" />
          <circle cx="50" cy="50" r="43" fill="none" stroke="#8a1f1f" strokeWidth="4" />
          <circle cx="50" cy="50" r="43" fill="none" stroke="#e8540f" strokeWidth="1.6" opacity="0.9" />
          {/* chamas no topo */}
          <g fill="#e8540f" stroke="#8a1f1f" strokeWidth="1" strokeLinejoin="round">
            <path d="M38 12 Q40 2 44 9 Q46 4 48 10 Q50 2 52 10 Q54 4 56 9 Q60 2 62 12 Q58 18 50 18 Q42 18 38 12 Z" />
          </g>
          {/* chamas na base */}
          <g fill="#a52a2a" stroke="#1c0606" strokeWidth="1" strokeLinejoin="round">
            <path d="M40 90 Q42 98 46 92 Q48 97 50 91 Q52 97 54 92 Q58 98 60 90 Q56 86 50 86 Q44 86 40 90 Z" />
          </g>
        </svg>
      );
    default:
      return null;
  }
}

// Cor determinística pra avatar de inicial (jogadores sem time/PNG).
// Mesmo nick → sempre a mesma cor, de uma paleta curada que combina com
// o tema (terrosos, vinhos, azuis profundos — nada berrante).
const NICK_PALETTE = [
  '#d76414', '#a8324f', '#7a4dc9', '#2a8f3f', '#3a78c2', '#1c7a6e',
  '#b87333', '#8b5a2b', '#6b4c9a', '#4d6a2e', '#a52a2a', '#c87f33',
  '#5a7d8c', '#9a3a6a', '#3e7a4d', '#7a5c2e',
];
function nickColor(nick) {
  const s = String(nick || '?').toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return NICK_PALETTE[h % NICK_PALETTE.length];
}

function Avatar({ teamId, nick, teamPlayers, cosmetics, size = 32, fullBody = false, className = '', noBadge = false }) {
  // Resolve teamId via teamPlayers se não veio direto.
  // teamPlayers tem formato { teamId: nick } — precisa inverter pra achar o
  // teamId a partir do nick.
  let tid = teamId;
  if (!tid && nick && teamPlayers) {
    const nickLc = String(nick).toLowerCase();
    for (const [tIdCandidate, n] of Object.entries(teamPlayers)) {
      if (n && String(n).toLowerCase() === nickLc) {
        tid = tIdCandidate;
        break;
      }
    }
  }

  // Items equipados (frame, badge) — opcionais. Se cosmetics não vier,
  // não renderiza nada extra (compat com chamadas antigas).
  const cosm = cosmetics || {};
  const frameItem = cosm.frame ? ITEM_BY_ID[cosm.frame] : null;
  const badgeItem = (!noBadge && cosm.badge) ? ITEM_BY_ID[cosm.badge] : null;
  const frameClass = frameItem ? ' has-frame avatar-frame-' + frameItem.id : '';

  const renderBadge = () => {
    if (!badgeItem) return null;
    // Tamanho proporcional ao avatar (mínimo 14px, máximo 32px)
    const bSize = Math.max(14, Math.min(32, Math.round(size * 0.32)));
    return (
      <span className="avatar-badge" style={{ background: badgeItem.color, width: bSize + 8, height: bSize + 8 }} title={badgeItem.name}>
        <Icon name={badgeItem.icon} size={bSize - 2} />
      </span>
    );
  };

  // Helper: envolve um avatar-icon com a moldura SVG decorativa quando há
  // frameItem. No fullBody mantém o tratamento de borda/glow via frameClass.
  const wrapWithFrameDeco = (iconEl) => {
    if (!frameItem) return iconEl;
    return (
      <span className={'avatar-framed ' + className} style={{ width: size, height: size }}>
        {iconEl}
        <FrameDeco frameId={frameItem.id} />
        {renderBadge()}
      </span>
    );
  };

  if (tid) {
    const t = TEAM(tid);
    const src = `avatars/${tid}.png`;
    if (fullBody) {
      return (
        <div className={'avatar avatar-full ' + className + frameClass} style={{ width: size, height: size }}>
          <img src={src} alt={t.name} onError={(e) => { e.target.style.display = 'none'; e.target.parentNode.classList.add('avatar-fallback'); }} />
          <span className="avatar-fallback-letter" style={{ background: t.color }}>{t.short.charAt(0)}</span>
          {renderBadge()}
        </div>
      );
    }
    // Ícone: crop top (mostra só a cabeça). Com moldura decorativa, o avatar
    // circular vai DENTRO de .avatar-framed (sem frameClass de borda) e o SVG
    // da moldura desenha o anel + ornamentos por cima.
    const iconEl = (
      <div className={'avatar avatar-icon ' + (frameItem ? 'avatar-icon-inner' : className)} style={frameItem ? undefined : { width: size, height: size }}>
        <img src={src} alt={t.name} onError={(e) => { e.target.style.display = 'none'; e.target.parentNode.classList.add('avatar-fallback'); }} />
        <span className="avatar-fallback-letter" style={{ background: t.color, fontSize: size * 0.5 }}>{t.short.charAt(0)}</span>
        {!frameItem && renderBadge()}
      </div>
    );
    return wrapWithFrameDeco(iconEl);
  }

  // Fallback (sem time/PNG): ícone de inicial com cor única derivada do nick.
  const letter = (nick || '?').charAt(0).toUpperCase();
  const bg = nickColor(nick);
  const fbEl = (
    <div className={'avatar avatar-icon avatar-fallback-pure ' + (frameItem ? 'avatar-icon-inner' : className)}
         style={frameItem ? { '--nick-bg': bg } : { width: size, height: size, '--nick-bg': bg }}>
      <span className="avatar-fallback-letter" style={{ fontSize: size * 0.5, background: bg }}>{letter}</span>
      {!frameItem && renderBadge()}
    </div>
  );
  return wrapWithFrameDeco(fbEl);
}

// ─── APP ────────────────────────────────────────────────────────────────────
// Modal de preview de cupom compartilhado (chega via ?cupom=...).
// Mostra as legs e oferece "USAR" pra jogar tudo no slip atual.
function SharedSlipModal({ slip, gamesById, onUse, onClose }) {
  if (!slip || slip.length === 0) return null;
  const legs = slip.map(s => ({ ...s, _fix: gamesById ? gamesById[s.fixtureId] : null }));
  const combined = slip.reduce((p, l) => p + l.odds, 0);
  const missing = legs.filter(l => !l._fix).length;
  return (
    <div className="shared-slip-backdrop" onClick={onClose}>
      <div className="shared-slip-modal" onClick={e => e.stopPropagation()}>
        <div className="shared-slip-head">
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.28em', fontWeight: 800, color: 'var(--pv-orange)' }}>CUPOM COMPARTILHADO</div>
            <div style={{ fontFamily: 'Bungee Inline, Impact, sans-serif', fontSize: 20, letterSpacing: '0.04em', marginTop: 4 }}>
              {slip.length} PALPITE{slip.length === 1 ? '' : 'S'} · {combined.toFixed(2)}x
            </div>
          </div>
          <button onClick={onClose} className="shared-slip-close" aria-label="Fechar">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="shared-slip-body">
          {legs.map((l, i) => (
            <div key={i} className="cupom-leg" style={{ opacity: l._fix ? 1 : 0.5 }}>
              <div className="cupom-leg-txt">
                <div className="cupom-leg-mkt">{MARKET_TITLE[l.market] || l.market}</div>
                {l._fix ? legLabel(l) : <em style={{ color: 'rgba(28,22,18,0.55)' }}>jogo não está mais disponível</em>}
              </div>
              <div className="cupom-leg-odd mono">{l.odds.toFixed(2)}</div>
            </div>
          ))}
          {missing > 0 && (
            <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(195,51,51,0.10)', borderLeft: '4px solid #c33', fontSize: 11, lineHeight: 1.4 }}>
              <Icon name="warning" size={12} /> {missing} {missing === 1 ? 'jogo' : 'jogos'} desse cupom já não estão disponíveis — serão ignorados se você usar.
            </div>
          )}
        </div>
        <div className="shared-slip-foot">
          <button className="btn-secondary" onClick={onClose}>FECHAR</button>
          <button className="btn-primary" onClick={() => { onUse(legs.filter(l => l._fix).map(({ _fix, ...rest }) => rest)); onClose(); }}>
            USAR NO MEU CUPOM
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SHARE CUPOM ────────────────────────────────────────────────────────────
// Codifica o slip em string compacta pra mandar via URL.
// Formato: base64(JSON([{f:fixtureId, m:market, p:pick, o:odds}, ...]))
function encodeSlipForUrl(slip) {
  try {
    const compact = (slip || []).map(l => ({
      f: l.fixtureId, m: l.market, p: l.pick, o: Number(l.odds.toFixed(2)),
    }));
    const json = JSON.stringify(compact);
    // btoa não aceita unicode direto — encodeURIComponent + unescape pra UTF8
    return btoa(unescape(encodeURIComponent(json)));
  } catch (e) {
    return '';
  }
}

function decodeSlipFromUrl(encoded) {
  try {
    if (!encoded) return null;
    const json = decodeURIComponent(escape(atob(encoded)));
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter(x => x && typeof x === 'object' && x.f && x.m && x.p != null)
      .map(x => ({
        fixtureId: String(x.f),
        market:    String(x.m),
        pick:      String(x.p),
        odds:      Number(x.o) || 0,
      }));
  } catch (e) {
    return null;
  }
}

function buildShareUrl(slip) {
  const enc = encodeSlipForUrl(slip);
  if (!enc) return '';
  const base = window.location.origin + window.location.pathname;
  return `${base}?cupom=${enc}`;
}

// Tenta navigator.share (mobile) com fallback pra clipboard.
async function shareSlip(slip) {
  const url = buildShareUrl(slip);
  if (!url) return { ok: false, err: 'slip vazio' };
  const title = `Cupom do Primitivão · ${slip.length} palpite${slip.length === 1 ? '' : 's'}`;
  const text = `Olha esse cupom que montei no Primitivão (${slip.length} palpite${slip.length === 1 ? '' : 's'})`;
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return { ok: true, method: 'share' };
    } catch (e) {
      if (e.name === 'AbortError') return { ok: false, aborted: true };
      // fall back to clipboard
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return { ok: true, method: 'clipboard' };
  } catch (e) {
    return { ok: false, err: 'clipboard bloqueado' };
  }
}

// ─── TOAST ──────────────────────────────────────────────────────────────────
// Sistema simples de toasts: dispara via `window.showToast(msg, type)` e
// renderiza pelo <ToastHost /> montado no App. Usa CustomEvent pra evitar
// prop drilling. Tipos: 'success' | 'error' | 'info' (padrão).
function showToast(msg, type) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('primitivao:toast', {
    detail: { msg: String(msg || ''), type: type || 'info', id: Math.random().toString(36).slice(2) },
  }));
}
if (typeof window !== 'undefined') window.showToast = showToast;

function ToastHost() {
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    const onToast = (e) => {
      const t = e.detail;
      setToasts(prev => [...prev, t]);
      setTimeout(() => setToasts(prev => prev.filter(x => x.id !== t.id)), 4200);
    };
    window.addEventListener('primitivao:toast', onToast);
    return () => window.removeEventListener('primitivao:toast', onToast);
  }, []);
  if (toasts.length === 0) return null;
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map(t => {
        const iconName = t.type === 'success' ? 'check'
          : t.type === 'error'   ? 'x'
          : 'sparkle';
        return (
          <div key={t.id} className={'toast toast-' + t.type}>
            <Icon name={iconName} size={16} />
            <span>{t.msg}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── DISCORD WEBHOOK ────────────────────────────────────────────────────────
// Posta uma mensagem no canal do Discord configurado em `discord_webhook`
// (top-level field do doc do Firestore). Retorna { ok, err? }.
//
// O admin configura a URL pelo painel ADMIN → DISCORD. Se a URL não estiver
// setada, o helper retorna ok:false sem fazer fetch.
async function postToDiscord(webhookUrl, content, extras) {
  if (!webhookUrl || !webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
    return { ok: false, err: 'webhook não configurado ou URL inválida' };
  }
  try {
    const body = { content: String(content || '').slice(0, 1900) };
    if (extras && extras.embeds) body.embeds = extras.embeds;
    if (extras && extras.username) body.username = extras.username;
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, err: `HTTP ${res.status} ${txt.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, err: String(e.message || e) };
  }
}

// Atualiza URL do webhook no Firestore (admin only — sem checagem aqui,
// a UI quem garante).
async function saveDiscordWebhook(url) {
  await BET_DOC().set({ discord_webhook: String(url || '') }, { merge: true });
}

// ─── NEWS REMOTAS ───────────────────────────────────────────────────────────
async function saveRemoteNews(newsArray) {
  // grava como top-level field; passa por validação simples
  const clean = (Array.isArray(newsArray) ? newsArray : []).map(n => ({
    id:       String(n.id || ''),
    title:    String(n.title || ''),
    subtitle: String(n.subtitle || ''),
    date:     String(n.date || ''),
    tag:      String(n.tag || ''),
    image:    String(n.image || ''),
    body:     String(n.body || ''),
    at:       Number(n.at) || Date.now(),
  })).filter(n => n.id && n.title);
  await BET_DOC().set({ news: clean }, { merge: true });
}

// Error boundary por VIEW: se uma página quebra com algum dado inesperado,
// mostra o erro num card (mantendo a navegação utilizável) em vez de deixar a
// tela inteira em branco. Resetado automaticamente via key={view} no App.
class ViewBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error('View crashed:', err, info); }
  render() {
    if (this.state.err) {
      return (
        <div className="card" style={{ marginTop: 8 }}>
          <div className="card-head"><div className="title"><Icon name="warning" size={16} /> ALGO QUEBROU AQUI</div></div>
          <div className="card-body">
            <p style={{ marginTop: 0, fontSize: 13, lineHeight: 1.5 }}>
              Essa página teve um erro inesperado. Tenta abrir outra aba do menu ou recarregar (Ctrl+Shift+R). Se persistir, manda esse texto pro admin:
            </p>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, color: 'var(--pv-red, #c33)', fontFamily: 'JetBrains Mono, monospace', margin: 0 }}>
              {String((this.state.err && this.state.err.message) || this.state.err)}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [shared, setShared] = useState({ users: {}, fixtures: DEFAULT_FIXTURES, bets: [], interests: {}, teamPlayers: {}, comments: {}, worldcup: { results: {}, picks: {} } });
  const { users, fixtures, bets, interests, teamPlayers, comments, worldcup } = shared;

  // cs: classificação compartilhada via primitivao/state. State é mantido no App
  // (e não em ClassificacaoView) para que: (a) ApostarView possa derivar jogos +
  // odds das rounds; (b) liquidação automática rode aqui quando placares mudam.
  const [cs, setCs] = useState(null);
  const csLoadedRef   = useRef(false);
  const csApplyingRef = useRef(false);

  const [session, _setSession] = useState(loadSession);
  const setSession = (s) => { saveSession(s); _setSession(s); };

  const [slip, setSlip]     = useState([]); // [{fixtureId='rXgY', market, pick, odds}]
  const [synced, setSynced] = useState(false);
  const [championship, setChampionship] = useState('fifa');
  // Estado OFICIAL do MK — persiste no campo `mk` do doc de apostas (commit
  // transacional já blindado; NÃO toca no doc da FIFA). Lido na subscription do
  // BET_DOC; escrito via os helpers persistMk* abaixo (optimistic local + commit).
  //   mk = { draw, scores, lineups, locked }
  const [mkDraw, setMkDraw] = useState(null);
  const [mkScores, setMkScores] = useState({});
  // MEU JOGO: escalação por confronto montada pelo MANDANTE (os dois lados das 2
  // partidas). Keyed por gKey: mkLineups[gKey] = { p1:{home,away}, p2:{home,away} }.
  const [mkLineups, setMkLineups] = useState({});
  const [mkLocked, setMkLocked] = useState(false); // chaveamento publicado -> inscrições fechadas

  // Muta o campo `mk` no doc de apostas, preservando o resto. Optimistic: o caller
  // já atualizou o estado local; aqui só persiste.
  const persistMk = (mutator) => commitBetDocUpdate(remote => {
    const cur = (remote.mk && typeof remote.mk === 'object') ? remote.mk : {};
    const base = { draw: null, scores: {}, lineups: {}, locked: false, ...cur };
    return { ...remote, mk: mutator(base) };
  }).catch(e => console.warn('persistMk failed', e));

  // ADMIN: sorteia e PUBLICA o chaveamento (fecha inscrições, zera placares).
  const publishMkDraw = (draw) => {
    setMkDraw(draw); setMkScores({}); setMkLocked(true);
    return persistMk(mk => ({ ...mk, draw, scores: {}, locked: true }));
  };
  // ADMIN: lança placar/finalização/flawless de um confronto (patch parcial).
  const setMkScoreField = (key, patch) => {
    setMkScores(prev => ({ ...prev, [key]: { ...(prev[key] || {}), ...patch } }));
    return persistMk(mk => ({ ...mk, scores: { ...mk.scores, [key]: { ...((mk.scores || {})[key] || {}), ...patch } } }));
  };
  // MANDANTE: escala um lado de uma partida do seu confronto (MEU JOGO).
  const setMkLineupSlot = (key, part, side, val) => {
    setMkLineups(prev => ({ ...prev, [key]: { ...(prev[key] || {}), [part]: { ...((prev[key] || {})[part] || {}), [side]: val || undefined } } }));
    return persistMk(mk => ({ ...mk, lineups: { ...mk.lineups, [key]: { ...((mk.lineups || {})[key] || {}), [part]: { ...(((mk.lineups || {})[key] || {})[part] || {}), [side]: val || undefined } } } }));
  };
  // ADMIN/MOD: trava/destrava as apostas de UM confronto (guarda em mk.scores[key].locked;
  // o cálculo de resultado ignora esse campo). Bloqueia novas apostas naquele jogo.
  const toggleMkGameLock = (key) => {
    const cur = !!((mkScores || {})[key] || {}).locked;
    return setMkScoreField(key, { locked: !cur });
  };
  // VIEW principal — controla qual "página" mostrar:
  //   apostas | campeonatos | copa | hall | inicio(NEWS) | loja | perfil | tickets | ranking | admin
  // 'discord' não é view — abre link externo direto.
  // APOSTAS (jogos pra apostar) é a tela inicial. CAMPEONATOS = classificação.
  // Ambas são escopadas pelo `championship` selecionado.
  const [view, setView] = useState('apostas');
  // Cupom compartilhado por URL (?cupom=...) — quando setado, mostra modal
  // de preview com botão "USAR" que joga as legs no slip atual.
  const [sharedSlip, setSharedSlip] = useState(null);
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const encoded = params.get('cupom');
      if (!encoded) return;
      const decoded = decodeSlipFromUrl(encoded);
      if (decoded && decoded.length > 0) {
        setSharedSlip(decoded);
      }
      // Limpa o param da URL pro user não recarregar e abrir de novo.
      params.delete('cupom');
      const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + window.location.hash;
      window.history.replaceState({}, '', newUrl);
    } catch (e) { /* ignora */ }
  }, []);

  // "SEMPRE no campeonato ATIVO": ver um campeonato "em breve" só vale enquanto
  // você está NA aba CAMPEONATOS (pra inscrição/preview). Ao sair pra qualquer
  // outra aba (APOSTAS, etc.), a seleção volta pro primeiro ATIVO — então nada
  // fica preso num "em breve". Só há 1 ativo + a Copa, então o ativo é o default.
  useEffect(() => {
    if (view === 'campeonatos') return;
    // Admin pode prever as apostas do MK na própria aba APOSTAS (sem ser ativo).
    const adm = session && session.nick === ADMIN_NICK;
    if (adm && view === 'apostas' && championship === 'mk') return;
    const act = (CHAMP_BY_ID[championship] || CHAMPIONSHIPS[0]).status === 'active';
    if (!act) {
      const firstActive = (CHAMPIONSHIPS.find(c => c.status === 'active') || CHAMPIONSHIPS[0]).id;
      setChampionship(firstActive);
    }
  }, [view, championship, session]);

  // Dados estáticos da Copa do Mundo 2026 (carregados de JSON).
  const [wcData, setWcData] = useState({ matches: [], teamsByName: {} });
  // Discord webhook URL (admin configura no painel) + lista remota de news.
  // `remoteNews === null` → não tem nada no Firestore, usa o array hardcoded NEWS.
  const [discordWebhook, setDiscordWebhook] = useState('');
  const [remoteNews, setRemoteNews] = useState(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('world-cup/worldcup.json').then(r => r.json()),
      fetch('world-cup/worldcup.teams.json').then(r => r.json()),
    ]).then(([w, t]) => {
      if (cancelled) return;
      const teamsByName = {};
      (Array.isArray(t) ? t : []).forEach(team => { teamsByName[team.name] = team; });
      const matches = (w?.matches || [])
        .map((m, i) => normalizeWcMatch(m, i, teamsByName))
        .filter(Boolean);
      setWcData({ matches, teamsByName });
    }).catch(e => console.warn('Falha ao carregar dados da Copa:', e));
    return () => { cancelled = true; };
  }, []);

  const hasLoadedRef        = useRef(false);
  const isApplyingRemoteRef = useRef(false);

  // ── Firestore: apostas doc ────────────────────────────────────────────────
  useEffect(() => {
    const ref = BET_DOC();
    const unsub = ref.onSnapshot(snap => {
      if (!snap.exists) {
        // PERIGO HISTÓRICO (data-loss): tratar !exists como "seed vazio" já fez
        // o app PARECER resetado e quase apagou o doc. Um snapshot pode chegar
        // com exists=false de forma TRANSIENTE: cache vazio na 1ª conexão,
        // reconexão offline->online, avaliação de regras de segurança. NUNCA
        // sobrescrever (nem renderizar vazio) um doc real por causa disso.
        // 1) Já carregamos dados reais antes? Então é transiente — ignora
        //    completamente. O snapshot do servidor chega logo em seguida.
        if (hasLoadedRef.current) {
          console.warn('Apostas: exists=false IGNORADO (já tínhamos dados — transiente).');
          return;
        }
        // 2) Veio só do cache (sem confirmação do servidor)? Não cria nada;
        //    segura a tela "CONECTANDO" até o servidor responder.
        if (snap.metadata && snap.metadata.fromCache) {
          return;
        }
        // 3) Servidor confirmou que o doc não existe (instalação nova): cria
        //    com merge:true — nunca apaga campos top-level (news, webhook…)
        //    mesmo na remota hipótese de já existir algo.
        ref.set(
          { json: JSON.stringify({ users: {}, fixtures: DEFAULT_FIXTURES, bets: [], teamPlayers: {} }), interests: {}, updatedAt: Date.now() },
          { merge: true }
        ).catch(e => console.warn('Firestore seed failed', e));
        hasLoadedRef.current = true; setSynced(true);
        return;
      }
      try {
        const docData = snap.data();
        const remote = JSON.parse(docData.json);
        // interests/comments agora são campos TOP-LEVEL pra não sofrer race
        // com outras escritas no json. Mantém fallback pra docs antigos.
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
        const topComments = docData.comments;
        const comments = (topComments && typeof topComments === 'object') ? topComments : {};
        const topWc = docData.worldcup;
        const worldcup = (topWc && typeof topWc === 'object')
          ? { results: topWc.results || {}, picks: topWc.picks || {} }
          : { results: {}, picks: {} };
        // Discord webhook URL e lista de news também são top-level
        // (admin atualiza via painel; toda tab recebe via snapshot).
        setDiscordWebhook(typeof docData.discord_webhook === 'string' ? docData.discord_webhook : '');
        setRemoteNews(Array.isArray(docData.news) ? docData.news : null);
        isApplyingRemoteRef.current = true;
        setShared({
          users:        remote.users && typeof remote.users === 'object' ? remote.users : {},
          fixtures:     Array.isArray(remote.fixtures) ? remote.fixtures.map(normFixture) : DEFAULT_FIXTURES,
          bets:         Array.isArray(remote.bets) ? remote.bets.map(normBet) : [],
          interests,
          comments,
          worldcup,
          teamPlayers:  remote.teamPlayers && typeof remote.teamPlayers === 'object' ? remote.teamPlayers : {},
        });
        // Estado oficial do MK (campo `mk` do mesmo doc). Source of truth remoto.
        const mk = (remote.mk && typeof remote.mk === 'object') ? remote.mk : {};
        setMkDraw(Array.isArray(mk.draw) ? mk.draw : null);
        setMkScores(mk.scores && typeof mk.scores === 'object' ? mk.scores : {});
        setMkLineups(mk.lineups && typeof mk.lineups === 'object' ? mk.lineups : {});
        setMkLocked(!!mk.locked);
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
      const { interests: _d1, comments: _d2, worldcup: _d3, ...localNoInterests } = shared;
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
        // Mesmo perigo do doc de apostas: um exists=false transiente NÃO pode
        // zerar a classificação (perderia todos os placares) nem mostrar tabela
        // vazia. Ver comentário detalhado no listener de apostas acima.
        if (csLoadedRef.current) {
          console.warn('Classif: exists=false IGNORADO (já tínhamos dados — transiente).');
          return;
        }
        if (snap.metadata && snap.metadata.fromCache) {
          return;
        }
        const seed = { currentRound: 0, rounds: defaultRounds() };
        ref.set({ json: JSON.stringify(seed), updatedAt: Date.now() }, { merge: true }).catch(e => console.warn(e));
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

  // Liquidação das apostas do MK (champId='mk'): keyed em mkScores. Usa
  // mkLegResult e paga/estorna PC. Espelha a da FIFA, mas SÓ toca tickets do MK
  // (FIFA settle ignora legs 'mk:' porque parseGameId não casa). Idempotente.
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    const snap = mkScores;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      try {
        await commitBetDocUpdate(remote => {
          const remoteBets = remote.bets || [];
          if (!remoteBets.some(b => b && b.champId === 'mk')) return null;
          const newUsers = { ...(remote.users || {}) };
          let dirty = false;
          const newBets = remoteBets.map(b => {
            if (!b || b.champId !== 'mk') return b;
            let changed = false;
            const legs = (b.legs || []).map(l => {
              const gk = (typeof l.fixtureId === 'string' && l.fixtureId.indexOf('mk:') === 0) ? l.fixtureId.slice(3) : null;
              const sc = gk ? (snap[gk] || {}) : {};
              const done = !!mkMatchOutcome(sc);
              if (l.result && !done) { changed = true; return { ...l, result: undefined }; }
              if (!l.result && done) {
                const won = mkLegResult(l.market, l.pick, sc, sc) === 'win';
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
              if (newUsers[b.user]) newUsers[b.user] = { ...newUsers[b.user], pc: newUsers[b.user].pc + newPayout };
            } else if (newStatus === 'lost') { newPayout = 0; }
            else if (newStatus === 'pending') { newPayout = undefined; }
            dirty = true;
            return { ...b, legs, status: newStatus, payout: newPayout };
          });
          if (!dirty) return null;
          return { ...remote, users: newUsers, bets: newBets };
        });
      } catch (e) { if (!cancelled) console.warn('mk auto-settle failed', e); }
    }, 600);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [mkScores]);

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

  // Auto-prune do slip: se admin lançou placar de um jogo que tava no cupom,
  // o jogo sai de `gamesById`. Em vez de só travar no placeBet, removemos
  // proativamente as pernas afetadas e mostramos um aviso curto.
  const [slipPruneMsg, setSlipPruneMsg] = useState('');
  useEffect(() => {
    if (slip.length === 0) return;
    if (!cs?.rounds || cs.rounds.length === 0) return; // ainda não carregou — não mexer
    const valid = slip.filter(s => {
      const p = parseGameId(s.fixtureId);
      if (!p) return false;
      const g = cs.rounds[p.ri]?.[p.gi];
      if (!g) return false;
      return !isGamePlayed(g) && !g.locked;
    });
    if (valid.length !== slip.length) {
      const removed = slip.length - valid.length;
      setSlip(valid);
      setSlipPruneMsg(`${removed} ${removed === 1 ? 'palpite removido do cupom (jogo finalizado ou travado).' : 'palpites removidos do cupom (jogos finalizados ou travados).'}`);
      setTimeout(() => setSlipPruneMsg(''), 6000);
    }
  }, [cs, slip.length]);

  const me = session ? users[session.nick] : null;
  const isAdmin = session && session.nick === ADMIN_NICK;
  // Moderador: lança placar + trava apostas + vê a aba ADMIN (sem destrutivos).
  // O admin de verdade é mod também (superconjunto de poderes).
  const isMod = isAdmin || !!(session && MOD_NICKS.includes(session.nick));

  // Login/signup via transação: cadastro atomico contra remote — evita perder
  // user novo se outro write concorrer.
  //
  // Senhas agora são guardadas como hash SHA-256 (campo `senhaHash`). Contas
  // antigas que ainda têm `senha` em texto puro são migradas no próximo login
  // bem-sucedido (compara texto -> grava hash, apaga `senha`).
  const handleAuth = async (nick, senha) => {
    nick = nick.trim().toLowerCase();
    if (!nick || !senha) return 'Preencha nick e senha';
    const senhaHash = await hashPassword(senha);
    if (nick === ADMIN_NICK) {
      if (senhaHash !== ADMIN_PASS_HASH) return 'Senha de admin incorreta';
      setSession({ nick }); return null;
    }
    try {
      const result = await commitBetDocUpdate(remote => {
        const remoteUsers = remote.users || {};
        const existing = remoteUsers[nick];
        if (existing) {
          // Conta nova (já hash) — compara hash
          if (existing.senhaHash) {
            if (existing.senhaHash !== senhaHash) {
              return { __abort: true, result: { err: 'Senha incorreta' } };
            }
            return { __abort: true, result: { ok: true } };
          }
          // Conta legada (texto puro) — valida + migra pra hash
          if (existing.senha) {
            if (existing.senha !== senha) {
              return { __abort: true, result: { err: 'Senha incorreta' } };
            }
            const migrated = { ...existing, senhaHash };
            delete migrated.senha;
            return { ...remote, users: { ...remoteUsers, [nick]: migrated } };
          }
          // Sem nenhum dos dois? Conta corrompida.
          return { __abort: true, result: { err: 'Conta inválida — fala com o admin' } };
        }
        // Conta nova: grava só o hash
        return {
          ...remote,
          users: { ...remoteUsers, [nick]: { senhaHash, pc: START_PC, cc: 0, joined: Date.now(), lastWeekly: 0 } },
        };
      });
      if (result && result.err) return result.err;
      setSession({ nick });
      return null;
    } catch (e) {
      console.warn('handleAuth failed', e);
      return 'Erro de conexão. Tente novamente.';
    }
  };

  const logout = () => { setSession(null); setView('apostas'); setSlip([]); };

  // Bônus semanal via transação: revalida elegibilidade contra dados REMOTOS
  // pra evitar dois cliques rápidos creditarem em dobro, ou ser sobrescrito.
  // Elegível = user ainda não resgatou nesta semana (janela = última segunda 10h BRT).
  const claimWeekly = async () => {
    if (!session || isAdmin) return;
    const nick = session.nick;
    try {
      await commitBetDocUpdate(remote => {
        const u = (remote.users || {})[nick];
        if (!u) return null;
        const monday = lastMondayAt10BRT();
        if ((u.lastWeekly || 0) >= monday) return null; // já resgatou nesta janela
        const users = {
          ...remote.users,
          [nick]: { ...u, pc: u.pc + WEEKLY_PC, lastWeekly: Date.now() },
        };
        return { ...remote, users };
      });
    } catch (e) { console.warn('claimWeekly failed', e); }
  };
  const weeklyReady = me ? ((me.lastWeekly || 0) < lastMondayAt10BRT()) : false;
  const weeklyIn = me && !weeklyReady
    ? Math.max(0, nextMondayAt10BRT() - Date.now())
    : 0;

  // ── CUPOM (parlay) ────────────────────────────────────────────────────────
  // game = item de `games` (vindo de cs.rounds, com id rXgY e odds calculadas)
  const toggleLeg = (game, market, pick) => {
    if (isAdmin) return;
    if (game?.locked) return; // jogo travado pelo admin não aceita aposta
    const odds = game?.odds?.[market]?.[pick];
    if (!odds || !game.id) return;
    setSlip(prev => {
      const exact = prev.find(s => s.fixtureId === game.id && s.market === market && s.pick === pick);
      if (exact) return prev.filter(s => !(s.fixtureId === game.id && s.market === market && s.pick === pick));
      // Permite múltiplos mercados do MESMO jogo (1X2 + BTTS + NM + +3 gols),
      // mas só 1 pick por mercado — trocar pick do mesmo mercado substitui
      // (não dá pra apostar em 2 resultados contraditórios do mesmo mercado).
      const others = prev.filter(s => !(s.fixtureId === game.id && s.market === market));
      return [...others, { fixtureId: game.id, market, pick, odds }];
    });
  };
  const removeLeg = (fixtureId) => setSlip(prev => prev.filter(s => s.fixtureId !== fixtureId));
  const clearSlip = () => setSlip([]);

  // PlaceBet via transação: debita PC + adiciona ticket atomicamente contra
  // o estado remoto (não permite ficar negativo nem perder o ticket).
  const placeBet = async (amount) => {
    if (!me || slip.length === 0) return;
    // Rede de segurança: se algum palpite ainda referencia jogo indisponível
    // (admin lançou placar ou travou bem na hora), removemos e avisamos sem bloquear.
    const validSlip = slip.filter(l => {
      const g = gamesById[l.fixtureId];
      return g && !g.locked;
    });
    if (validSlip.length !== slip.length) {
      const removed = slip.length - validSlip.length;
      setSlip(validSlip);
      alert(removed === 1
        ? 'Um palpite foi removido porque o jogo acabou de ter o placar lançado. Confere o cupom e tenta de novo.'
        : `${removed} palpites foram removidos (jogos já finalizados). Confere o cupom e tenta de novo.`);
      return;
    }
    if (amount <= 0) return;
    const co = +slip.reduce((p, l) => p + l.odds, 0).toFixed(2);
    const ticket = {
      id: 't' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      user: session.nick, amount, status: 'pending', createdAt: Date.now(),
      champId: apostasChampId, // marca a season/campeonato pra ranking de apostas por edição
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
        // Rejeita se algum jogo do cupom está travado pelo admin (FIFA: cs.rounds;
        // MK: mk.scores[gKey].locked — leg 'mk:<gKey>'). Jogo rolando = travado.
        const someLocked = t.legs.some(l => {
          if (typeof l.fixtureId === 'string' && l.fixtureId.indexOf('mk:') === 0) {
            const gk = l.fixtureId.slice(3);
            return mkGameClosed(((remote.mk && remote.mk.scores) || {})[gk]);
          }
          const p = parseGameId(l.fixtureId);
          if (!p) return false;
          const g = cs?.rounds?.[p.ri]?.[p.gi];
          return !!(g && g.locked);
        });
        if (someLocked) {
          return { __abort: true, result: { err: 'Não dá pra cancelar: algum jogo do cupom está travado (em jogo).' } };
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

  // ── APOSTAS DO MK (valendo PC) ────────────────────────────────────────────
  // Ticket entra no MESMO array `bets` com champId='mk'. Carrega aliases
  // (nick/stake/combined/odd) pro display do MkBettingView funcionar sem reescrever.
  const placeMkBet = async (payload) => {
    const nick = session && session.nick;
    if (!nick || !payload || !Array.isArray(payload.legs) || payload.legs.length === 0) return { err: 'cupom inválido' };
    const stake = Math.floor(Number(payload.stake) || 0);
    if (!(stake > 0)) return { err: 'valor inválido' };
    const combined = +Number(payload.combined).toFixed(2);
    const ticket = {
      id: 'mkb-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      user: nick, amount: stake, status: 'pending', createdAt: Date.now(),
      champId: 'mk', combinedOdds: combined, casada: !!payload.casada,
      roundN: payload.roundN, phase: payload.phase,
      nick, stake, combined, // aliases (display)
      legs: payload.legs.map(l => ({
        fixtureId: 'mk:' + payload.phase + '-' + payload.roundN + '-' + l.gi,
        market: l.market, pick: l.pick, odds: l.odd, odd: l.odd,
        home: l.home, away: l.away, gi: l.gi, roundN: payload.roundN, phase: payload.phase,
      })),
    };
    try {
      const res = await commitBetDocUpdate(remote => {
        const u = (remote.users || {})[nick];
        if (!u) return { __abort: true, result: { err: 'Conta não sincronizada. Faz login de novo.' } };
        if ((u.pc || 0) < stake) return { __abort: true, result: { err: 'Saldo insuficiente (tem ' + (u.pc || 0) + ' PC).' } };
        if ((remote.bets || []).some(b => b.id === ticket.id)) return null;
        return { ...remote, users: { ...remote.users, [nick]: { ...u, pc: u.pc - stake } }, bets: [ticket, ...(remote.bets || [])] };
      });
      if (res && res.err) { showToast(res.err, 'error'); return res; }
      return { ok: true };
    } catch (e) { console.warn('placeMkBet failed', e); showToast('Erro ao apostar. Tenta de novo.', 'error'); return { err: String(e) }; }
  };
  const removeMkBet = async (ticketId) => {
    try {
      const res = await commitBetDocUpdate(remote => {
        const t = (remote.bets || []).find(b => b.id === ticketId && b.champId === 'mk');
        if (!t) return null;
        if (t.user !== session.nick && session.nick !== ADMIN_NICK) return { __abort: true, result: { err: 'Só o dono ou o admin.' } };
        if (t.status !== 'pending' || (t.legs || []).some(l => !!l.result)) return { __abort: true, result: { err: 'Aposta já em resolução.' } };
        // Jogo travado (em jogo) -> não pode cancelar.
        const locked = (t.legs || []).some(l => {
          const gk = (typeof l.fixtureId === 'string' && l.fixtureId.indexOf('mk:') === 0) ? l.fixtureId.slice(3) : null;
          return gk && mkGameClosed(((remote.mk && remote.mk.scores) || {})[gk]);
        });
        if (locked) return { __abort: true, result: { err: 'Não dá pra cancelar: jogo travado (em jogo).' } };
        const u = (remote.users || {})[t.user];
        const users = u ? { ...remote.users, [t.user]: { ...u, pc: (u.pc || 0) + (t.amount || 0) } } : remote.users;
        return { ...remote, users, bets: (remote.bets || []).filter(b => b.id !== ticketId) };
      });
      if (res && res.err) showToast(res.err, 'error');
    } catch (e) { console.warn('removeMkBet failed', e); }
  };

  // ── INSCRIÇÕES (campeonatos "em breve") ───────────────────────────────────
  // Transação atômica direto no Firestore — evita race com outras escritas
  // que poderiam sobrescrever a lista de inscritos. Local state atualiza
  // sozinho via snapshot depois do write.
  const toggleInterest = async (champId) => {
    if (!session || !session.nick) return;
    // MK lançado: chaveamento publicado fecha as inscrições (não entra nem sai).
    if (champId === 'mk' && mkLocked) { showToast('Inscrições do MK já encerraram (chaveamento publicado).', 'error'); return; }
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

  // ── COMENTÁRIOS NAS NOTÍCIAS ──────────────────────────────────────────────
  // Mesmo padrão de interests: campo top-level no doc, atualizado via
  // transação atômica. Estrutura: comments[newsId] = [{ id, nick, text, at }]
  const addComment = async (newsId, text) => {
    if (!session || !session.nick) return;
    const nick = session.nick;
    const clean = String(text || '').trim().slice(0, 500);
    if (!clean) return;
    const newComment = {
      id: 'c' + Date.now() + Math.random().toString(36).slice(2, 6),
      nick, text: clean, at: Date.now(),
    };
    const ref = BET_DOC();
    let newMap = null;
    try {
      await window.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const cur = (snap.exists && snap.data().comments && typeof snap.data().comments === 'object')
          ? snap.data().comments : {};
        const list = Array.isArray(cur[newsId]) ? cur[newsId] : [];
        const next = { ...cur, [newsId]: [...list, newComment] };
        newMap = next;
        tx.set(ref, { comments: next, updatedAt: Date.now() }, { merge: true });
      });
      if (newMap) setShared(s => ({ ...s, comments: newMap }));
    } catch (e) {
      console.warn('addComment failed', e);
      throw e;
    }
  };

  const deleteComment = async (newsId, commentId) => {
    if (!session || !session.nick) return;
    const ref = BET_DOC();
    let newMap = null;
    try {
      await window.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const cur = (snap.exists && snap.data().comments && typeof snap.data().comments === 'object')
          ? snap.data().comments : {};
        const list = Array.isArray(cur[newsId]) ? cur[newsId] : [];
        const target = list.find(c => c.id === commentId);
        if (!target) return; // sumiu
        // Só admin ou autor pode deletar
        if (target.nick !== session.nick && session.nick !== ADMIN_NICK) return;
        const filtered = list.filter(c => c.id !== commentId);
        const next = { ...cur, [newsId]: filtered };
        newMap = next;
        tx.set(ref, { comments: next, updatedAt: Date.now() }, { merge: true });
      });
      if (newMap) setShared(s => ({ ...s, comments: newMap }));
    } catch (e) {
      console.warn('deleteComment failed', e);
      throw e;
    }
  };

  // ── COPA DO MUNDO (bolão) ─────────────────────────────────────────────────
  // Mesmo padrão de top-level field + transação atômica.
  // worldcup: { results: { matchId: {gh,ga,at} }, picks: { nick: { matchId: {gh,ga,at} } } }
  const saveWorldcupPick = async (matchId, gh, ga) => {
    if (!session || !session.nick) return;
    const nick = session.nick;
    const pgh = parseInt(gh, 10), pga = parseInt(ga, 10);
    if (Number.isNaN(pgh) || Number.isNaN(pga)) return;
    if (pgh < 0 || pga < 0) return;
    const ref = BET_DOC();
    let newState = null;
    try {
      await window.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const cur = (snap.exists && snap.data().worldcup && typeof snap.data().worldcup === 'object')
          ? snap.data().worldcup : {};
        // Não permite alterar palpite se o admin já lançou o placar real
        if (cur.results && cur.results[matchId]) return;
        const picks = { ...(cur.picks || {}) };
        const userPicks = { ...(picks[nick] || {}) };
        userPicks[matchId] = { gh: pgh, ga: pga, at: Date.now() };
        picks[nick] = userPicks;
        const next = { results: cur.results || {}, picks };
        newState = next;
        tx.set(ref, { worldcup: next, updatedAt: Date.now() }, { merge: true });
      });
      if (newState) setShared(s => ({ ...s, worldcup: newState }));
    } catch (e) {
      console.warn('saveWorldcupPick failed', e);
      throw e;
    }
  };

  const setWorldcupResult = async (matchId, gh, ga) => {
    if (!isAdmin) return;
    const ref = BET_DOC();
    let newState = null;
    try {
      await window.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const cur = (snap.exists && snap.data().worldcup && typeof snap.data().worldcup === 'object')
          ? snap.data().worldcup : { results: {}, picks: {} };
        const results = { ...(cur.results || {}) };
        if (gh === '' && ga === '') {
          // limpar resultado
          delete results[matchId];
        } else {
          const pgh = parseInt(gh, 10), pga = parseInt(ga, 10);
          if (Number.isNaN(pgh) || Number.isNaN(pga)) return;
          if (pgh < 0 || pga < 0) return;
          results[matchId] = { gh: pgh, ga: pga, at: Date.now() };
        }
        const next = { results, picks: cur.picks || {} };
        newState = next;
        tx.set(ref, { worldcup: next, updatedAt: Date.now() }, { merge: true });
      });
      if (newState) setShared(s => ({ ...s, worldcup: newState }));
    } catch (e) {
      console.warn('setWorldcupResult failed', e);
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

  // Toggle de "travado" num jogo específico (admin only). Quando travado, o
  // jogo some da lista de apostas pros users e pernas no slip são auto-podadas.
  // Operação é local em cs (mesmo write-back de placares cuida da persistência).
  const toggleGameLock = (ri, gi) => {
    setCs(prev => {
      if (!prev || !Array.isArray(prev.rounds)) return prev;
      const rounds = prev.rounds.map((r, rIdx) => rIdx !== ri ? r : r.map((m, mIdx) => {
        if (mIdx !== gi) return m;
        return { ...m, locked: !m.locked };
      }));
      return { ...prev, rounds };
    });
  };

  // Ajuste de PC pelo admin via transação (lê PC remoto, soma delta atomicamente).
  // Seleciona qual titulo o user quer exibir publicamente (na classificacao
  // e no ranking). Passa null pra remover.
  const setSelectedTitle = async (titleId) => {
    if (!session || !session.nick) return;
    const nick = session.nick;
    try {
      await commitBetDocUpdate(remote => {
        const u = (remote.users || {})[nick];
        if (!u) return null;
        // Valida que o titulo eh elegivel pra esse user (anti-burlar)
        if (titleId) {
          const earned = titlesForNick(nick, {
            bets: remote.bets || [],
            users: remote.users || {},
            teamPlayers: remote.teamPlayers || {},
            cs,
            worldcup, // closure do app state (top-level, fora do json do remote)
          });
          if (!earned.some(t => t.id === titleId)) return null;
        }
        const users = { ...remote.users, [nick]: { ...u, title: titleId || null } };
        return { ...remote, users };
      });
    } catch (e) { console.warn('setSelectedTitle failed', e); }
  };

  // Contexto pra calcular CC (saldo derivado de títulos + participação).
  const ccCtx = useMemo(() => ({ bets, users, teamPlayers, cs, worldcup, interests }), [bets, users, teamPlayers, cs, worldcup, interests]);

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

  // Ajuste manual de CAMPEÃO COINS pelo admin = mexe no `ccBonus` (o saldo é
  // derivado: ganho + ccBonus - gasto). Pode ser negativo; o saldo nunca passa de 0.
  const adjustCc = async (nick, delta) => {
    try {
      await commitBetDocUpdate(remote => {
        const u = (remote.users || {})[nick];
        if (!u) return null;
        const users = { ...remote.users, [nick]: { ...u, ccBonus: ((u.ccBonus || 0) + delta) } };
        return { ...remote, users };
      });
    } catch (e) { console.warn('adjustCc failed', e); }
  };

  // MIGRAÇÃO ÚNICA (admin): separa as moedas. Pra cada user devolve em PC o que
  // gastou em itens COMPRÁVEIS, remove esses itens (recompra com CC depois),
  // mantém os drops de conquista, desequipa o que sumiu e garante o campo cc=0.
  // Idempotente: itens comprados saem do inventário, então rodar 2x devolve 0.
  const splitCurrency = async () => {
    try {
      const res = await commitBetDocUpdate(remote => {
        const users = { ...(remote.users || {}) };
        let refunded = 0, removed = 0, affected = 0;
        for (const nick of Object.keys(users)) {
          const u = users[nick]; if (!u) continue;
          const inv = Array.isArray(u.inventory) ? u.inventory : [];
          const keep = [];
          let refund = 0;
          for (const id of inv) {
            const it = ITEM_BY_ID[id];
            if (it && it.price) { refund += it.price; removed++; }
            else keep.push(id);
          }
          const cosmetics = { ...(u.cosmetics || {}) };
          for (const slot of Object.keys(cosmetics)) {
            const ci = cosmetics[slot] && ITEM_BY_ID[cosmetics[slot]];
            if (ci && ci.price) delete cosmetics[slot]; // era item COMPRADO (removido) -> desequipa; drops ficam
          }
          refunded += refund;
          users[nick] = { ...u, pc: (u.pc || 0) + refund, cc: (u.cc != null ? u.cc : 0), inventory: keep, cosmetics };
        }
        return { ...remote, users };
      });
      return res || {};
    } catch (e) { console.warn('splitCurrency failed', e); return { err: String(e && e.message || e) }; }
  };

  // MEU JOGO (MK): salva o elenco de 3 personagens escolhidos por um jogador.
  const setMkChars = async (targetNick, chars) => {
    if (!targetNick) return;
    const clean = (Array.isArray(chars) ? chars : []).filter(c => MK_CHARACTERS.includes(c)).slice(0, MK_MAX_CHARS);
    try {
      await commitBetDocUpdate(remote => {
        const u = (remote.users || {})[targetNick];
        if (!u) return null;
        return { ...remote, users: { ...remote.users, [targetNick]: { ...u, mkChars: clean } } };
      });
    } catch (e) { console.warn('setMkChars failed', e); }
  };

  // LOJA: compra de item (debita CAMPEÃO COINS — cc — e adiciona ao inventory).
  // PC é só pra apostas; a loja roda na moeda nova `cc`.
  const buyItem = async (itemId) => {
    const item = ITEM_BY_ID[itemId];
    if (!item || !item.price) return { err: 'item inválido' };
    if (!session?.nick) return { err: 'precisa logar' };
    const userNick = session.nick;
    // CC ganho é derivado de títulos/participação (precisa de cs/worldcup, que
    // não estão no doc da transação) — calcula no cliente e valida na transação.
    const earnedCc = ccEarnedFor(userNick, ccCtx);
    try {
      const res = await commitBetDocUpdate(remote => {
        const u = (remote.users || {})[userNick];
        if (!u) return { __abort: true, result: { err: 'usuário não encontrado' } };
        const inv = Array.isArray(u.inventory) ? u.inventory : [];
        if (inv.includes(itemId)) return { __abort: true, result: { err: 'você já tem esse item' } };
        const bal = Math.max(0, earnedCc + (u.ccBonus || 0) - (u.ccSpent || 0));
        if (bal < item.price) return { __abort: true, result: { err: 'Campeão Coins insuficientes (tem ' + bal + ' CC).' } };
        const next = {
          ...u,
          ccSpent: (u.ccSpent || 0) + item.price,
          inventory: [...inv, itemId],
        };
        return { ...remote, users: { ...remote.users, [userNick]: next } };
      });
      return res || {};
    } catch (e) {
      console.warn('buyItem failed', e);
      return { err: 'falha de conexão' };
    }
  };

  // LOJA: equipar/desequipar item num slot
  const equipItem = async (slot, itemId) => {
    if (!session?.nick) return;
    const userNick = session.nick;
    try {
      await commitBetDocUpdate(remote => {
        const u = (remote.users || {})[userNick];
        if (!u) return null;
        // Valida: itemId precisa existir e estar no inventário efetivo
        if (itemId) {
          const item = ITEM_BY_ID[itemId];
          if (!item || item.slot !== slot) return null;
          const ctx = { bets: remote.bets || [], teamPlayers: remote.teamPlayers || {}, cs, worldcup };
          const inv = effectiveInventory(userNick, u, ctx);
          if (!inv.includes(itemId)) return null;
        }
        const cosmetics = { ...(u.cosmetics || {}), [slot]: itemId };
        if (!itemId) delete cosmetics[slot];
        return { ...remote, users: { ...remote.users, [userNick]: { ...u, cosmetics } } };
      });
    } catch (e) { console.warn('equipItem failed', e); }
  };

  // Auto-cleanup: se o PRÓPRIO user tem um cosmético equipado que não está
  // mais no inventário efetivo (ex: era drop de campeão e a temporada foi
  // resetada, ou item removido do catálogo), desequipa automaticamente.
  // Só mexe no próprio user. Comprados (no inventory array) nunca somem —
  // só drops que perderam a condição. Sem loop: após desequipar, me muda e
  // o equipado vira null.
  useEffect(() => {
    if (!session?.nick || !me || !me.cosmetics) return;
    const ctx = { bets, teamPlayers: teamPlayers || {}, cs, worldcup };
    const inv = effectiveInventory(session.nick, me, ctx);
    ['frame', 'badge'].forEach(slot => {
      const eq = me.cosmetics[slot];
      if (eq && !inv.includes(eq)) {
        console.warn('auto-cleanup: desequipando cosmetico invalido', slot, eq);
        equipItem(slot, null);
      }
    });
  }, [me, bets, cs, teamPlayers, worldcup, session]);

  // LATCH DE CONQUISTAS (#3): títulos e badges de drop são PERMANENTES. Quando
  // uma conquista passa a valer ao vivo pro user logado, gravamos o id em
  // users[nick].earnedTitles / .earnedDrops (cresce só, nunca remove). Isso
  // conserta o bug do FALIDO/MILIONÁRIO piscando com o PC (e o CC derivado
  // caindo junto), e impede badges de campeão/lanterna sumirem num reset.
  // Só lateia o PRÓPRIO user (cada um lateia o seu ao ficar online). Converge:
  // depois de gravar, `me` muda, recomputa, nada novo -> não reescreve.
  useEffect(() => {
    if (!session?.nick || !me) return;
    const nick = session.nick;
    const ctx = { bets, users, teamPlayers: teamPlayers || {}, cs, worldcup, interests };
    const liveTitleIds = TITLE_DEFS
      .filter(t => { try { return !!t.check({ nick, ...ctx }); } catch (_) { return false; } })
      .map(t => t.id);
    const liveDropIds = itemsDroppedFor(nick, ctx).map(i => i.id);
    const prevTitles = Array.isArray(me.earnedTitles) ? me.earnedTitles : [];
    const prevDrops  = Array.isArray(me.earnedDrops)  ? me.earnedDrops  : [];
    const grewTitles = liveTitleIds.some(id => prevTitles.indexOf(id) < 0);
    const grewDrops  = liveDropIds.some(id => prevDrops.indexOf(id) < 0);
    if (!grewTitles && !grewDrops) return;
    commitBetDocUpdate(remote => {
      const u = (remote.users || {})[nick];
      if (!u) return null;
      const pt = Array.isArray(u.earnedTitles) ? u.earnedTitles : [];
      const pd = Array.isArray(u.earnedDrops)  ? u.earnedDrops  : [];
      const nt = Array.from(new Set([...pt, ...liveTitleIds]));
      const nd = Array.from(new Set([...pd, ...liveDropIds]));
      if (nt.length === pt.length && nd.length === pd.length) return null;
      return { ...remote, users: { ...remote.users, [nick]: { ...u, earnedTitles: nt, earnedDrops: nd } } };
    }).catch(e => console.warn('latchAchievements failed', e));
  }, [me, bets, users, cs, teamPlayers, worldcup, interests, session]);

  if (!synced || cs === null) {
    return (
      <div className="login-stage">
        <div className="login-card loading-card">
          <div className="pv-spinner" aria-hidden="true"><span /><span /><span /></div>
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
  const isActiveChamp = active.status === 'active';
  // APOSTAS é SÓ pra apostar — sempre num campeonato APOSTÁVEL (ativo E não
  // encerrado). O `championship` é compartilhado com CAMPEONATOS (que pode mostrar
  // "em breve" OU um encerrado pra ver a classificação final); se o selecionado
  // não for apostável, a aba APOSTAS cai pro primeiro apostável SEM mexer na
  // seleção do CAMPEONATOS. (Antes caía só por status; agora ignora encerrados
  // também — ex: FIFA terminou, APOSTAS vai pro MK em vez de mostrar página morta.)
  const isBettableChamp = champStatusFor(active, cs) === 'active';
  const firstBettableChampId = (CHAMPIONSHIPS.find(c => champStatusFor(c, cs) === 'active') || CHAMPIONSHIPS[0]).id;
  const apostasChampId = isBettableChamp ? championship : firstBettableChampId;
  const mkInscrito = !!(interests && interests.mk && session && interests.mk[session.nick]);
  // CAMPEONATOS mostra a página "EM BREVE" quando o campeonato selecionado não
  // está ativo. APOSTAS nunca mostra (sempre usa apostasChampId, que é ativo).
  const showPlaceholder = view === 'campeonatos' && !isActiveChamp;

  return (
    <>
      <TopBar
        nick={session.nick}
        pc={isAdmin ? '∞' : me.pc}
        cc={isAdmin ? '∞' : ccBalanceFor(session.nick, me, ccCtx)}
        isAdmin={isAdmin}
        onLogout={logout}
        weeklyReady={weeklyReady}
        weeklyIn={weeklyIn}
        onClaimWeekly={claimWeekly}
        view={view}
        onView={setView}
        teamPlayers={teamPlayers || {}}
        myCosmetics={me?.cosmetics || {}}
      />
      <div className="below-topbar">
        <div className="content-area">
          <div className="page">
            {/* Navegação mobile (some no desktop). Sempre montada pra que as
                telas globais — perfil/tickets/ranking — sejam alcançáveis de
                qualquer view, já que a Sidebar fica escondida no mobile. */}
            <MobileNav view={view} setView={setView} isAdmin={isAdmin} mkInscrito={mkInscrito} isMod={isMod} />
            <ViewBoundary key={view}>
            {view === 'inicio' && (
              <InicioView
                session={session}
                isAdmin={isAdmin}
                comments={comments || {}}
                onAdd={addComment}
                onDelete={deleteComment}
                remoteNews={remoteNews}
              />
            )}
            {view === 'copa' && (
              <CopaDoMundoView
                session={session}
                isAdmin={isAdmin}
                users={users}
                worldcup={worldcup || { results: {}, picks: {} }}
                fixtures={wcData.matches}
                onSavePick={saveWorldcupPick}
                onSetResult={setWorldcupResult}
              />
            )}
            {view === 'hall' && (
              <HallView cs={cs} users={users} teamPlayers={teamPlayers || {}} worldcup={worldcup} wcFixtures={wcData.matches} myNick={session.nick} />
            )}
            {/* APOSTAS — só apostar. SEMPRE num campeonato ATIVO (apostasChampId);
                se o selecionado for "em breve", cai pro ativo sem perder a
                seleção do CAMPEONATOS. Inscrição em "em breve" é na aba
                CAMPEONATOS (e o cancelamento no MEU PERFIL). */}
            {view === 'apostas' && (
              <div className="champ-layout champ-layout--apostas">
                <ChampSidebar value={apostasChampId} onChange={setChampionship} cs={cs} interests={interests || {}} mode="apostas" />
                <div className="champ-main">
                  {(apostasChampId === 'mk') ? (
                    // APOSTAS do MK (valendo PC). MK é ativo — todo mundo aposta aqui.
                    <>
                      <ChampHeader value={apostasChampId} onChange={setChampionship} interests={interests || {}} bare activeOnly />
                  <MkBettingView
                    players={Object.keys(interests?.mk || {})}
                    users={users}
                    teamPlayers={teamPlayers || {}}
                    draw={mkDraw}
                    scores={mkScores}
                    lineups={mkLineups}
                    bets={(bets || []).filter(b => b.champId === 'mk')}
                    onPlaceBet={placeMkBet}
                    onRemoveBet={removeMkBet}
                    onSetGameLock={setMkScoreField}
                    myNick={session.nick}
                    isAdmin={isAdmin} isMod={isMod}
                    balance={me?.pc ?? 0}
                  />
                </>
              ) : (
                <ApostarView
                  games={games} gamesById={gamesById} bets={bets} me={me} session={session} users={users}
                  weeklyReady={weeklyReady} weeklyIn={weeklyIn} onClaim={claimWeekly}
                  slip={slip} onToggleLeg={toggleLeg} onRemoveLeg={removeLeg}
                  onClearSlip={clearSlip} onPlaceBet={placeBet} isAdmin={isAdmin} canLock={isMod}
                  slipPruneMsg={slipPruneMsg}
                  onToggleLock={toggleGameLock}
                  championship={apostasChampId} setChampionship={setChampionship}
                  interests={interests || {}}
                />
                  )}
                </div>
              </div>
            )}

            {/* CAMPEONATOS — classificação do campeonato selecionado. */}
            {view === 'campeonatos' && (
              <div className="champ-layout">
                <ChampSidebar value={championship} onChange={setChampionship} cs={cs} interests={interests || {}} mode="campeonatos" />
                <div className="champ-main">
                  <ChampHeader value={championship} onChange={setChampionship} interests={interests || {}} bare />
                  {active.id === 'mk' ? (
                // MK OFICIAL: classificação visível a todos. Sorteio = só admin.
                // Lançar placar = mod (admin + bane/vitinho/mohamed).
                <MkChampionshipView
                  players={Object.keys(interests?.mk || {})}
                  users={users}
                  teamPlayers={teamPlayers || {}}
                  draw={mkDraw} onPublishDraw={publishMkDraw}
                  scores={mkScores} onScore={setMkScoreField}
                  isAdmin={isAdmin} isMod={isMod} locked={mkLocked}
                />
              ) : showPlaceholder ? (
                <ChampionshipPlaceholder
                  champ={active}
                  session={session}
                  interested={!!(interests?.[active.id]?.[session.nick])}
                  count={Object.keys(interests?.[active.id] || {}).length}
                  list={Object.keys(interests?.[active.id] || {}).sort()}
                  isAdmin={isAdmin}
                  onToggleInterest={() => toggleInterest(active.id)}
                />
                  ) : (
                    <ClassificacaoView cs={cs} setCs={setCs} isAdmin={isMod}
                                       users={users} teamPlayers={teamPlayers || {}} />
                  )}
                </div>
              </div>
            )}

            {/* Globais — independem de campeonato. Cada um é uma view inteira. */}
            {view === 'perfil' && (
              <MeuPerfilView
                nick={session.nick}
                me={me}
                cs={cs}
                bets={bets}
                users={users}
                teamPlayers={teamPlayers || {}}
                worldcup={worldcup}
                isAdmin={isAdmin}
                onSelectTitle={setSelectedTitle}
                onEquip={equipItem}
                interests={interests || {}}
                onCancelInterest={toggleInterest}
              />
            )}
            {view === 'tickets' && (
              <TicketsView bets={bets.filter(b => b.user === session.nick)} gamesById={gamesById} cs={cs} mkScores={mkScores} onCancel={cancelBet} />
            )}
            {view === 'ranking' && (
              <RankingView users={users} bets={bets} me={session.nick} teamPlayers={teamPlayers || {}} cs={cs} />
            )}
            {view === 'meujogo' && (
              <MeuJogoView
                nick={session.nick} isAdmin={isAdmin} users={users} interests={interests || {}} onSave={setMkChars}
                draw={mkDraw} scores={mkScores} lineups={mkLineups} onSlot={setMkLineupSlot}
                teamPlayers={teamPlayers || {}}
              />
            )}
            {view === 'loja' && (
              <LojaView
                nick={session.nick}
                me={me}
                ctx={{ bets, users, teamPlayers: teamPlayers || {}, cs, worldcup, interests }}
                onBuy={buyItem}
                onEquip={equipItem}
              />
            )}
            {view === 'admin' && isMod && (
              <AdminView
                isFullAdmin={isAdmin}
                bets={bets} users={users} adjustPc={adjustPc} adjustCc={adjustCc}
                splitCurrency={splitCurrency} ccCtx={ccCtx}
                teamPlayers={teamPlayers || {}} setTeamPlayer={setTeamPlayer}
                discordWebhook={discordWebhook} remoteNews={remoteNews}
                cs={cs} weeklyReady={weeklyReady}
                worldcup={worldcup} wcFixtures={wcData.matches}
              />
            )}
            </ViewBoundary>
          </div>
        </div>
        <Sidebar
          view={view}
          setView={setView}
          isAdmin={isAdmin}
          mkInscrito={mkInscrito}
          isMod={isMod}
        />
      </div>
      {sharedSlip && (
        <SharedSlipModal
          slip={sharedSlip}
          gamesById={gamesById}
          onClose={() => setSharedSlip(null)}
          onUse={(legs) => {
            setSlip(legs);
            setView('apostas');
            showToast(`${legs.length} palpite${legs.length === 1 ? '' : 's'} adicionado${legs.length === 1 ? '' : 's'} ao seu cupom`, 'success');
          }}
        />
      )}
      <ToastHost />
    </>
  );
}

// ─── TOP BAR / TABS ─────────────────────────────────────────────────────────
function TopBar({ nick, pc, cc, isAdmin, onLogout, weeklyReady, weeklyIn, onClaimWeekly, view, onView, teamPlayers, myCosmetics }) {
  const days = Math.floor(weeklyIn / (24 * 60 * 60 * 1000));
  const hrs  = Math.floor((weeklyIn % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const mins = Math.floor((weeklyIn % (60 * 60 * 1000)) / (60 * 1000));
  const countdown = days > 0 ? `${days}d ${hrs}h` : (hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`);
  const goDiscord = () => window.open('https://discord.gg/CgjuJSYW5u', '_blank', 'noopener,noreferrer');
  return (
    <div className="topbar">
      <div
        className="brand brand-clickable"
        role="button"
        tabIndex={0}
        title="Ir para Apostas"
        aria-label="PRIMITIVÃO — ir para Apostas"
        onClick={() => onView && onView('apostas')}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onView && onView('apostas'); } }}
      >
        <MiniCrest size={36} />
        <div className="brand-text">
          <div className="t1 display">PRIMITIVÃO</div>
          <div className="t2">APOSTAS · 2026</div>
        </div>
      </div>
      <nav className="primary-nav" aria-label="Navegação principal">
        <button className={'pnav ' + (view === 'apostas' ? 'active' : '')} onClick={() => onView && onView('apostas')}>APOSTAS</button>
        <button className={'pnav ' + (view === 'campeonatos' ? 'active' : '')} onClick={() => onView && onView('campeonatos')}>CAMPEONATOS</button>
        <button className={'pnav ' + (view === 'copa' ? 'active' : '')} onClick={() => onView && onView('copa')}>COPA DO MUNDO</button>
        <button className={'pnav ' + (view === 'hall' ? 'active' : '')} onClick={() => onView && onView('hall')}>VITRINE</button>
        <button className={'pnav ' + (view === 'inicio' ? 'active' : '')} onClick={() => onView && onView('inicio')}>NEWS</button>
        <button className={'pnav ' + (view === 'loja' ? 'active' : '')} onClick={() => onView && onView('loja')}>MERCADINHO</button>
        <button className="pnav pnav-ext" onClick={goDiscord} title="Abre em nova aba">
          DISCORD <span className="pnav-ext-icon"><Icon name="arrow-up-right" size={12} /></span>
        </button>
      </nav>
      <div className="wallet">
        {!isAdmin && weeklyReady && (
          <button className="weekly-chip weekly-chip-ready" onClick={onClaimWeekly} title="Reclamar bônus semanal">
            <span className="weekly-chip-icon"><Icon name="gift" size={16} /></span>
            <span className="weekly-chip-stack">
              <span className="weekly-chip-main">+{WEEKLY_PC} PC</span>
              <span className="weekly-chip-sub">RECLAMAR</span>
            </span>
          </button>
        )}
        {!isAdmin && !weeklyReady && (
          <div className="weekly-chip weekly-chip-locked" title="Próximo bônus: segunda 10h BRT">
            <span className="weekly-chip-icon"><Icon name="lock" size={14} /></span>
            <span className="weekly-chip-stack">
              <span className="weekly-chip-main">BÔNUS</span>
              <span className="weekly-chip-sub">{countdown}</span>
            </span>
          </div>
        )}
        {!isAdmin && (
          <div className="pc-pill">
            <div className="pc-coin">P</div>
            <div>
              <div className="pc-amt">{pc}</div>
              <div className="pc-unit">PRIMITIVO COINS</div>
            </div>
          </div>
        )}
        {!isAdmin && (
          <div className="pc-pill cc-pill" title="Campeão Coins — moeda da loja">
            <div className="pc-coin">C</div>
            <div>
              <div className="pc-amt">{cc}</div>
              <div className="pc-unit">CAMPEÃO COINS</div>
            </div>
          </div>
        )}
        <button
          type="button"
          className="nick nick-btn"
          onClick={() => { if (onView) onView('perfil'); }}
          title="Ir pro meu perfil"
        >
          {!isAdmin && <Avatar nick={nick} teamPlayers={teamPlayers} cosmetics={myCosmetics} size={36} />}
          {isAdmin && <span className="nick-tag" style={{ color: 'var(--pv-orange)', borderColor: 'var(--pv-orange)' }}>ADMIN</span>}
          <span className={isAdmin ? 'nick-tag' : 'nick-name'}>@{nick}</span>
        </button>
        <button className="logout-btn" onClick={onLogout}>SAIR</button>
      </div>
    </div>
  );
}

// ─── CAMPEONATO: header unificado (rodada + campeonato + troca) ──────────────
// Substitui a antiga barra de 6 abas. Mostra o contexto (ex: RODADA 07 + stats)
// em cima e a identidade do campeonato (FIFA · SEASON 1) embaixo, com um
// dropdown "TROCAR" pra alternar entre campeonatos (ativo e os EM BREVE).
// `bare` = variante leve (sem caixa escura), usada na classificação e no EM BREVE.
function ChampHeader({ value, onChange, interests, title, tag, stats, bare, activeOnly }) {
  const active = CHAMP_BY_ID[value] || CHAMPIONSHIPS[0];
  // activeOnly: usado na aba APOSTAS — o switcher só lista campeonatos ATIVOS
  // (não dá pra "trocar" pra um EM BREVE no meio das apostas).
  const switcherList = activeOnly ? CHAMPIONSHIPS.filter(c => c.status === 'active') : CHAMPIONSHIPS;
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
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

  const pick = (id) => { onChange(id); setOpen(false); };
  const hasContext = !!(title || stats);

  return (
    <div className={'champ-header' + (bare ? ' champ-header--bare' : '')}>
      {hasContext && (
        <div className="champ-header-context">
          <div className="champ-header-title">
            {title}
            {tag && <span className="champ-header-tag">{tag}</span>}
          </div>
          {stats && <div className="champ-header-stats">{stats}</div>}
        </div>
      )}
      <div className="champ-header-champ">
        <span className="champ-header-id">{active.tag} · {active.season.toUpperCase()}</span>
        <div className="champ-switcher" ref={ref}>
          <button
            className="champ-trocar"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            aria-haspopup="true"
          >
            TROCAR <Icon name="caret-down" size={13} />
          </button>
          {open && (
            <div className="champ-switcher-menu" role="menu">
              {switcherList.map(c => {
                const isSel = c.id === value;
                const isComing = c.status !== 'active';
                const count = Object.keys(interests?.[c.id] || {}).length;
                return (
                  <button
                    key={c.id}
                    className={'champ-switcher-item' + (isSel ? ' active' : '')}
                    onClick={() => pick(c.id)}
                    role="menuitem"
                  >
                    <span className="csi-name">{c.tag} · {c.season.toUpperCase()}</span>
                    <span className="csi-status">
                      {isComing ? 'EM BREVE' : 'ATIVO'}
                      {isComing && count > 0 ? ' · ' + count : ''}
                      {isSel && <Icon name="check" size={13} />}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Grupo do campeonato pro sidebar: 'active' (rolando), 'closed' (temporada
// terminada, tem campeão) ou 'soon' (em breve). FIFA vira 'closed' quando todas
// as rodadas terminam (computeChampStandings); os demais ativos ficam 'active'.
function champStatusFor(c, cs) {
  if (c.status === 'active') {
    return computeChampStandings(c.id, cs).status === 'closed' ? 'closed' : 'active';
  }
  return 'soon';
}

// SIDEBAR de campeonatos (#5/#6): trilho à esquerda com os campeonatos agrupados
// — ATIVOS no topo (destaque), EM BREVE no meio, ENCERRADOS embaixo (cor própria,
// dourada). Cada item usa a cor/ícone do tabloide. `mode='apostas'` esconde os
// "em breve" (não dá pra apostar) e deixa os encerrados só pra referência (sem
// clique). No mobile o sidebar some (CSS) e o ChampHeader vira o switcher.
function ChampSidebar({ value, onChange, cs, interests, mode }) {
  const withStatus = CHAMPIONSHIPS.map(c => ({ c, g: champStatusFor(c, cs) }));
  const apostas = mode === 'apostas';
  const groups = [
    { key: 'active', label: 'ATIVOS' },
    { key: 'soon',   label: 'EM BREVE' },
    { key: 'closed', label: 'ENCERRADOS' },
  ].filter(grp => !(apostas && grp.key === 'soon') && withStatus.some(x => x.g === grp.key));
  return (
    <aside className="champ-sidebar" aria-label="Campeonatos">
      <div className="champ-sidebar-h"><Icon name="trophy" size={13} /> {apostas ? 'ONDE APOSTAR' : 'CAMPEONATOS'}</div>
      {groups.map(grp => (
        <div key={grp.key} className={'champ-grp champ-grp-' + grp.key}>
          <div className="champ-grp-h">{grp.label}</div>
          {withStatus.filter(x => x.g === grp.key).map(({ c, g }) => {
            const th = tabloidTheme(c.id);
            const sel = c.id === value;
            const count = Object.keys((interests && interests[c.id]) || {}).length;
            const disabled = apostas && g !== 'active';
            const sub = g === 'closed' ? 'encerrado' : g === 'soon' ? (count > 0 ? count + ' inscritos' : 'em breve') : c.season;
            return (
              <button
                key={c.id}
                type="button"
                className={'champ-item champ-item-' + g + (sel ? ' sel' : '') + (disabled ? ' dis' : '')}
                style={{ '--champ-color': th.color }}
                onClick={() => { if (!disabled) onChange(c.id); }}
                disabled={disabled}
                aria-current={sel ? 'true' : undefined}
              >
                <span className="champ-item-ic" style={{ background: th.color }}><Icon name={th.icon} size={14} /></span>
                <span className="champ-item-body">
                  <span className="champ-item-name">{c.tag}</span>
                  <span className="champ-item-sub">{sub}</span>
                </span>
                {sel && <span className="champ-item-mark"><Icon name="chevron-right" size={14} /></span>}
              </button>
            );
          })}
        </div>
      ))}
    </aside>
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
              <div style={{ fontSize: 12, letterSpacing: '0.2em', fontWeight: 800, color: 'var(--pv-green, #2a8)', marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name="check" size={14} /> INSCRIÇÃO REGISTRADA
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
            <div style={{ marginTop: 10, color: 'var(--pv-red, #c33)', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="x" size={13} /> {errMsg}
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

// Itens de navegação — fonte única pra Sidebar (desktop) e MobileNav (mobile).
// sectionItems = páginas principais (= primary-nav no desktop). globalItems =
// "meu espaço" (sidebar no desktop). MERCADINHO foi pro topo (sectionItems).
function getTabItems(isAdmin, mkInscrito, isMod) {
  const sectionItems = [
    { id: 'apostas',     label: 'APOSTAS',       icon: 'ticket' },
    { id: 'campeonatos', label: 'CAMPEONATOS',   icon: 'chart' },
    { id: 'copa',        label: 'COPA DO MUNDO', icon: 'globe' },
    { id: 'hall',        label: 'VITRINE',       icon: 'trophy' },
    { id: 'inicio',      label: 'NEWS',          icon: 'newspaper' },
    { id: 'loja',        label: 'MERCADINHO',    icon: 'coin' },
  ];
  const globalItems = [
    { id: 'perfil',   label: 'MEU PERFIL',   icon: 'user' },
    { id: 'tickets',  label: 'MEUS TICKETS', icon: 'ticket' },
    { id: 'ranking',  label: 'RANKING',      icon: 'trophy' },
  ];
  // MEU JOGO (MK) — admin e inscritos no MK (campeonato oficial).
  if (isAdmin || mkInscrito) globalItems.push({ id: 'meujogo', label: 'MEU JOGO', icon: 'fist' });
  if (isMod) globalItems.push({ id: 'admin', label: 'ADMIN', icon: 'shield' });
  return { sectionItems, globalItems };
}

// Navegação MOBILE: hamburger + drawer com TODAS as páginas (seções + globais).
// Some no desktop — lá a primary-nav (topo) + Sidebar (direita) cobrem. No mobile
// a primary-nav fica escondida (CSS), então este é o menu único de navegação.
function MobileNav({ view, setView, isAdmin, mkInscrito, isMod }) {
  const { sectionItems, globalItems } = getTabItems(isAdmin, mkInscrito, isMod);
  const [open, setOpen] = useState(false);

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

  // Label do botão = nome da tela atual.
  const allItems = [...sectionItems, ...globalItems];
  const currentItem = allItems.find(it => it.id === view) || {};
  const currentLabel = currentItem.label || 'MENU';
  const currentIcon = currentItem.icon || 'menu';

  const go = (id) => { setView(id); setOpen(false); };
  const goDiscord = () => {
    window.open('https://discord.gg/CgjuJSYW5u', '_blank', 'noopener,noreferrer');
    setOpen(false);
  };

  return (
    <div className="tabs-mobile">
      <button
        className="tabs-mobile-btn"
        aria-expanded={open}
        aria-label="Menu de navegação"
        onClick={() => setOpen(o => !o)}
      >
        <span className="tabs-hamb"><Icon name={open ? 'x' : 'menu'} size={18} /></span>
        <span className="tabs-current"><Icon name={currentIcon} size={15} /> {currentLabel}</span>
        <span className="tabs-chev"><Icon name={open ? 'caret-up' : 'caret-down'} size={12} /></span>
      </button>
      {open && (
        <div className="tabs-drawer" role="menu">
          <div className="tabs-drawer-section-label">NAVEGAR</div>
          {sectionItems.map(it => (
            <button key={it.id} role="menuitem"
                    className={'tabs-drawer-item ' + (view === it.id ? 'active' : '')}
                    onClick={() => go(it.id)}>
              <span className="tabs-drawer-ico"><Icon name={it.icon} size={17} /></span>
              {it.label}
            </button>
          ))}
          <div className="tabs-drawer-section-label">MEU ESPAÇO</div>
          {globalItems.map(it => (
            <button key={it.id} role="menuitem"
                    className={'tabs-drawer-item ' + (view === it.id ? 'active' : '')}
                    onClick={() => go(it.id)}>
              <span className="tabs-drawer-ico"><Icon name={it.icon} size={17} /></span>
              {it.label}
            </button>
          ))}
          <button role="menuitem" className="tabs-drawer-item" onClick={goDiscord}>
            <span className="tabs-drawer-ico"><Icon name="chat" size={17} /></span>
            DISCORD
          </button>
        </div>
      )}
    </div>
  );
}

// Sidebar VERTICAL à direita no desktop. Renderiza só os itens GLOBAIS.
// Escondida no mobile (hamburger drawer cobre).
function Sidebar({ view, setView, isAdmin, mkInscrito, isMod }) {
  const { globalItems } = getTabItems(isAdmin, mkInscrito, isMod);
  // Cada item da sidebar é uma VIEW própria — clica, navega direto.
  // Highlight visual: view === itemId → barra laranja à esquerda + bg.
  return (
    <aside className="app-sidebar">
      <div className="sidebar-nav">
        <div className="sidebar-label">VESTIÁRIO</div>
        {globalItems.map(it => {
          const active = view === it.id;
          return (
            <button
              key={it.id}
              className={'sidebar-tab ' + (active ? 'active' : '')}
              onClick={() => setView && setView(it.id)}
              aria-current={active ? 'page' : undefined}
            >
              <span className="sidebar-tab-bar" aria-hidden="true" />
              <Icon name={it.icon} size={16} />
              <span className="sidebar-tab-label">{it.label}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

// ─── ICONES SVG PERSONALIZADOS ──────────────────────────────────────────────
function Icon({ name, size = 20, strokeWidth = 1.8, className = '' }) {
  const s = size;
  const sw = strokeWidth;
  const common = {
    width: s,
    height: s,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: sw,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className: 'pico-icon ' + className,
    'aria-hidden': 'true',
  };
  switch (name) {
    case 'star':
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M12 2.5l2.95 5.97 6.59.96-4.77 4.65 1.13 6.57L12 17.55l-5.9 3.1 1.13-6.57L2.46 9.43l6.59-.96L12 2.5z" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...common}>
          <path d="M12 3 4 5.5v6c0 4.9 3.4 9 8 10.5 4.6-1.5 8-5.6 8-10.5v-6L12 3z" />
          <path d="M8.5 12l2.5 2.5L15.5 10" />
        </svg>
      );
    case 'sparkle':
      return (
        <svg {...common}>
          <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z" fill="currentColor" stroke="none" />
          <path d="M19 4.5v2.5M20.25 5.75h-2.5" />
          <path d="M5 17.5v2.5M6.25 18.75h-2.5" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common} strokeWidth={2.4}>
          <path d="M4.5 12.5l4.5 4.5L19.5 6.5" />
        </svg>
      );
    case 'eye':
      return (
        <svg {...common}>
          <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7S2.5 12 2.5 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'eye-off':
      return (
        <svg {...common}>
          <path d="M10.6 6.1A11 11 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.4 3.9M6.9 7A17 17 0 0 0 2.5 12s3.5 6 9.5 6c1.5 0 2.9-.3 4.2-.9" />
          <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
          <path d="M3 3l18 18" />
        </svg>
      );
    case 'target':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'trophy':
      return (
        <svg {...common}>
          <path d="M6.5 4h11v4.5a5.5 5.5 0 0 1-11 0V4z" />
          <path d="M6.5 6H4.5a2 2 0 0 0 0 4h2.2" />
          <path d="M17.5 6h2a2 2 0 0 1 0 4h-2.2" />
          <path d="M12 14v4M8.5 21h7M9.5 18h5" />
        </svg>
      );
    case 'globe':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a14 14 0 0 1 0 18" />
          <path d="M12 3a14 14 0 0 0 0 18" />
        </svg>
      );
    case 'coin':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="6.2" strokeDasharray="1.5 2" opacity="0.55" />
          <text x="12" y="15.4" textAnchor="middle" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="8.5" fontWeight="800" fill="currentColor" stroke="none">PC</text>
        </svg>
      );
    case 'coin-stack':
      // 3 moedas empilhadas com brilho na de cima — "quebrou a banca"
      return (
        <svg {...common}>
          <ellipse cx="12" cy="19" rx="8" ry="2" />
          <path d="M4 19v-3M20 19v-3" />
          <ellipse cx="12" cy="16" rx="8" ry="2" />
          <path d="M4 16v-3M20 16v-3" />
          <ellipse cx="12" cy="13" rx="8" ry="2" />
          <path d="M4 13v-3M20 13v-3" />
          <ellipse cx="12" cy="10" rx="8" ry="2" fill="currentColor" stroke="none" opacity="0.15" />
          <ellipse cx="12" cy="10" rx="8" ry="2" />
          {/* brilho/cifrão na de cima */}
          <path d="M9.5 9.6q1 -0.9 2.5 -0.9 t 2.5 0.9" strokeWidth={sw * 0.8} />
        </svg>
      );
    case 'coin-fire':
      // moeda com chamas em cima — "queimou X PC"
      return (
        <svg {...common}>
          <circle cx="12" cy="16" r="5.5" />
          <circle cx="12" cy="16" r="3.2" strokeDasharray="1.2 1.8" opacity="0.55" />
          {/* chamas saindo de cima */}
          <path d="M9 9c0-2 1.5-3 2-5 0.8 1.5 1.5 2 1.5 3.5 0.5-0.8 1-1 1.5-2 0.5 1.5 1.5 2.5 1.5 4.5 0 1.5-1 2.5-3 2.5s-3.5-1-3.5-2.5z" fill="currentColor" stroke="none" opacity="0.85" />
          <path d="M9 9c0-2 1.5-3 2-5 0.8 1.5 1.5 2 1.5 3.5 0.5-0.8 1-1 1.5-2 0.5 1.5 1.5 2.5 1.5 4.5 0 1.5-1 2.5-3 2.5s-3.5-1-3.5-2.5z" />
        </svg>
      );
    // ─── flechas ──
    case 'arrow-right':
      return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case 'arrow-up-right':
      return <svg {...common}><path d="M7 17L17 7M9 7h8v8" /></svg>;
    case 'arrow-down':
      return <svg {...common}><path d="M12 5v14M6 13l6 6 6-6" /></svg>;
    case 'chevron-left':
      return <svg {...common}><path d="M15 6l-6 6 6 6" /></svg>;
    case 'chevron-right':
      return <svg {...common}><path d="M9 6l6 6-6 6" /></svg>;
    case 'refresh':
      return (
        <svg {...common}>
          <path d="M3 12a9 9 0 0 1 15.5-6.3M21 12a9 9 0 0 1-15.5 6.3" />
          <path d="M16 4v5h5M8 20v-5H3" />
        </svg>
      );
    case 'caret-up':
      return <svg {...common} fill="currentColor" stroke="none"><path d="M12 8l-7 8h14L12 8z" /></svg>;
    case 'caret-down':
      return <svg {...common} fill="currentColor" stroke="none"><path d="M12 16l7-8H5l7 8z" /></svg>;
    // ─── status ──
    case 'x':
      return <svg {...common} strokeWidth={2.2}><path d="M6 6l12 12M18 6L6 18" /></svg>;
    case 'warning':
      return (
        <svg {...common} strokeLinejoin="round">
          <path d="M12 3.2 1.8 21h20.4L12 3.2z" />
          <path d="M12 10v5" strokeWidth={2.2} />
          <circle cx="12" cy="18" r="0.8" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'lock':
      return (
        <svg {...common}>
          <rect x="4.5" y="11" width="15" height="10" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      );
    case 'unlock':
      return (
        <svg {...common}>
          <rect x="4.5" y="11" width="15" height="10" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 7.5-2" />
        </svg>
      );
    // ─── conceitos ──
    case 'flag':
      return (
        <svg {...common}>
          <path d="M5 3v18" strokeWidth={2.2} />
          <path d="M5 4h12l-2.5 4.5L17 13H5" />
        </svg>
      );
    case 'question':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7v.5" />
          <circle cx="12" cy="17.3" r="0.8" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'medal':
      return (
        <svg {...common}>
          <path d="M7 3l3 6M17 3l-3 6M5 3h4l3 6 3-6h4" />
          <circle cx="12" cy="15.5" r="5.5" />
          <text x="12" y="17.8" textAnchor="middle" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="6.5" fontWeight="800" fill="currentColor" stroke="none">2</text>
        </svg>
      );
    case 'gift':
      return (
        <svg {...common}>
          <rect x="3" y="9" width="18" height="12" rx="1" />
          <path d="M3 14h18M12 9v12" />
          <path d="M8 9c-2 0-3-1-3-2.5S6 4 7.5 4 12 9 12 9M16 9c2 0 3-1 3-2.5S18 4 16.5 4 12 9 12 9" />
        </svg>
      );
    case 'menu':
      return <svg {...common} strokeWidth={2.2}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
    case 'skull':
      return (
        <svg {...common}>
          <path d="M5 12a7 7 0 0 1 14 0v3a2 2 0 0 1-2 2v3h-2v-2h-2v2h-2v-2H9v2H7v-3a2 2 0 0 1-2-2v-3z" />
          <circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none" />
          <path d="M11 16h2" />
        </svg>
      );
    case 'fire':
      return (
        <svg {...common}>
          <path d="M12 3s-1 3-3 5-3 4-3 7a6 6 0 0 0 12 0c0-2-1-3-2-4s-2-3-2-5c0 0-1 2-2 2s0-5 0-5z" />
        </svg>
      );
    case 'book':
      return (
        <svg {...common}>
          <path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 0 0 4h12" />
          <path d="M8 7h7M8 11h7" />
        </svg>
      );
    case 'newspaper':
      return (
        <svg {...common}>
          <path d="M3 6h13v14H5a2 2 0 0 1-2-2V6z" />
          <path d="M16 9h4v9a2 2 0 0 1-2 2" />
          <path d="M6 9h7M6 13h7M6 17h4" />
        </svg>
      );
    case 'dice':
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
          <circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="16" cy="16" r="1.3" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'user':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      );
    case 'gamepad':
      return (
        <svg {...common}>
          <path d="M3 13a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5v2a3 3 0 0 1-5.5 1.7L15 16H9l-.5.7A3 3 0 0 1 3 15v-2z" />
          <path d="M7 12v3M5.5 13.5h3" />
          <circle cx="15" cy="12.5" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="17" cy="14.5" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'phone':
      return (
        <svg {...common}>
          <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
          <path d="M11 18.5h2" />
        </svg>
      );
    case 'chart':
      return (
        <svg {...common}>
          <path d="M3 21V4M3 21h18" strokeWidth={2.2} />
          <rect x="6" y="13" width="3" height="6" fill="currentColor" stroke="none" />
          <rect x="11" y="9" width="3" height="10" fill="currentColor" stroke="none" />
          <rect x="16" y="6" width="3" height="13" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'pin':
      return (
        <svg {...common}>
          <path d="M12 21s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12z" />
          <circle cx="12" cy="9" r="2.5" />
        </svg>
      );
    case 'square-filled':
      return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" stroke="none" /></svg>;
    case 'chat':
      return (
        <svg {...common}>
          <path d="M21 12a8 8 0 0 1-12 7l-5 1 1.5-4.5A8 8 0 1 1 21 12z" />
        </svg>
      );
    case 'ticket':
      return (
        <svg {...common}>
          <path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1a2 2 0 0 0 0 4v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1a2 2 0 0 0 0-4V9z" />
          <path d="M9 7v10" strokeDasharray="1.5 2" />
        </svg>
      );
    case 'flask':
      return (
        <svg {...common}>
          <path d="M9 3v6L4.5 18.5A2 2 0 0 0 6.3 21.5h11.4A2 2 0 0 0 19.5 18.5L15 9V3" />
          <path d="M7 3h10M7.2 14h9.6" />
        </svg>
      );
    case 'tag':
      return (
        <svg {...common}>
          <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9z" />
          <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'trash':
      return (
        <svg {...common}>
          <path d="M4 7h16" strokeWidth={2.2} />
          <path d="M9.5 7V4h5v3" />
          <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      );
    case 'toilet': // privada — Hall da Vergonha (lanterna)
      return (
        <svg {...common}>
          <path d="M5 4h14v2H5z" />
          <path d="M6 6v3h12V6" />
          <path d="M4.5 9h15l-1.5 7a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3L4.5 9z" />
          <path d="M8 19l-1.5 3M16 19l1.5 3" />
        </svg>
      );
    case 'toothbrush': // escova de dente — Hall da Vergonha (penultimo)
      return (
        <svg {...common}>
          <rect x="2" y="11" width="11" height="2.5" rx="0.5" />
          <rect x="13" y="9" width="6" height="6" rx="0.5" />
          <path d="M15 9v-2.5M17 9v-2.5M16 9v-2.5" />
        </svg>
      );
    // ── Ícones da VITRINE DE TROFÉUS (cheios, com brilho/sombra, reutilizáveis) ──
    case 'tr-champion': // troféu — campeão da edição (1º)
      return (
        <svg {...common} fill="currentColor" stroke="none">
          {/* alças laterais */}
          <path d="M6.5 4.8C3.2 4.8 3.4 9.6 7 9.9L7 8.6C4.9 8.3 4.9 6.1 6.6 6Z" />
          <path d="M17.5 4.8C20.8 4.8 20.6 9.6 17 9.9L17 8.6C19.1 8.3 19.1 6.1 17.4 6Z" />
          {/* taça */}
          <path d="M6.5 4H17.5V5.2C17.5 9.6 15 11.8 12 11.8C9 11.8 6.5 9.6 6.5 5.2Z" />
          <rect x="6.5" y="4" width="11" height="0.9" fill="#fff" opacity="0.28" />
          {/* haste, colar e base */}
          <path d="M10.8 11.6H13.2L13 14.2H11Z" />
          <rect x="10.1" y="13.9" width="3.8" height="1.2" rx="0.5" />
          <path d="M8.4 18.7L9.1 15H14.9L15.6 18.7Z" />
          <rect x="7.2" y="18.5" width="9.6" height="2" rx="0.5" />
          <rect x="7.2" y="20" width="9.6" height="0.5" fill="#000" opacity="0.16" />
          {/* estrela */}
          <path d="M12 5.6L12.47 6.95L13.9 6.98L12.76 7.85L13.18 9.22L12 8.4L10.82 9.22L11.24 7.85L10.1 6.98L11.53 6.95Z" fill="#fff" opacity="0.6" />
        </svg>
      );
    case 'tr-vice': // medalha de prata — vice (2º)
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M6.8 2.4H9.3L12.4 10.2L10.2 11Z" />
          <path d="M17.2 2.4H14.7L11.6 10.2L13.8 11Z" />
          <circle cx="12" cy="15.2" r="6" />
          <circle cx="12" cy="15.2" r="6" fill="none" stroke="#000" strokeWidth="0.8" opacity="0.16" />
          <circle cx="12" cy="15.2" r="4.6" fill="none" stroke="#fff" strokeWidth="0.9" opacity="0.45" />
          <text x="12" y="15.2" textAnchor="middle" dominantBaseline="central" fontSize="7.4" fontWeight="800" fontFamily="'Space Grotesk', system-ui, sans-serif" fill="#fff" opacity="0.92">2</text>
        </svg>
      );
    case 'tr-terceiro': // medalha de bronze — terceiro (3º)
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M6.8 2.4H9.3L12.4 10.2L10.2 11Z" />
          <path d="M17.2 2.4H14.7L11.6 10.2L13.8 11Z" />
          <circle cx="12" cy="15.2" r="6" />
          <circle cx="12" cy="15.2" r="6" fill="none" stroke="#000" strokeWidth="0.8" opacity="0.18" />
          <circle cx="12" cy="15.2" r="4.6" fill="none" stroke="#fff" strokeWidth="0.9" opacity="0.4" />
          <text x="12" y="15.2" textAnchor="middle" dominantBaseline="central" fontSize="7.4" fontWeight="800" fontFamily="'Space Grotesk', system-ui, sans-serif" fill="#fff" opacity="0.9">3</text>
        </svg>
      );
    case 'tr-participou': // medalha de participação (check)
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M6.8 2.4H9.3L12.4 10.2L10.2 11Z" />
          <path d="M17.2 2.4H14.7L11.6 10.2L13.8 11Z" />
          <circle cx="12" cy="15.2" r="6" />
          <circle cx="12" cy="15.2" r="6" fill="none" stroke="#000" strokeWidth="0.8" opacity="0.16" />
          <circle cx="12" cy="15.2" r="4.6" fill="none" stroke="#fff" strokeWidth="0.9" opacity="0.4" />
          <path d="M15.4 12.7L11 17.5L8.5 14.9L9.6 13.8L11 15.3L14.3 11.6Z" fill="#fff" opacity="0.88" />
        </svg>
      );
    case 'tr-penultimo': // escova de dente — penúltimo (vergonha)
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <rect x="2.6" y="13.7" width="13" height="2.1" rx="1.05" />
          <rect x="4" y="14.1" width="6.5" height="0.6" rx="0.3" fill="#fff" opacity="0.3" />
          <rect x="14.4" y="13.3" width="4.9" height="2.9" rx="0.8" />
          <rect x="15.1" y="11" width="0.9" height="2.5" rx="0.45" />
          <rect x="16.3" y="10.7" width="0.9" height="2.8" rx="0.45" />
          <rect x="17.5" y="10.7" width="0.9" height="2.8" rx="0.45" />
          <rect x="18.6" y="11" width="0.9" height="2.5" rx="0.45" />
        </svg>
      );
    case 'tr-lanterna': // privada — último (vergonha)
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <rect x="7.4" y="2.6" width="9.2" height="4" rx="1" />
          <rect x="11.3" y="3.2" width="1.4" height="0.9" rx="0.4" fill="#fff" opacity="0.4" />
          <ellipse cx="12" cy="9.4" rx="6.2" ry="2.9" />
          <ellipse cx="12" cy="9.6" rx="3.8" ry="1.7" fill="#fff" opacity="0.5" />
          <path d="M6.8 10.4C7.1 13.8 9 16.2 10.6 16.8L10.2 19.4H13.8L13.4 16.8C15 16.2 16.9 13.8 17.2 10.4Z" />
          <rect x="9" y="19" width="6" height="1.7" rx="0.5" />
        </svg>
      );
    case 'tr-betking': // coroa — REI DAS APOSTAS (vencedor do ranking, troféu único)
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M4.3 16L5.6 8.2L9 11.6L12 5.6L15 11.6L18.4 8.2L19.7 16Z" />
          <rect x="4.6" y="15.4" width="14.8" height="3.6" rx="1.1" />
          <rect x="4.6" y="15.4" width="14.8" height="1" fill="#fff" opacity="0.28" />
          <rect x="4.6" y="18.4" width="14.8" height="0.6" fill="#000" opacity="0.16" />
          <circle cx="5.6" cy="8.2" r="1.3" />
          <circle cx="12" cy="5.6" r="1.5" />
          <circle cx="18.4" cy="8.2" r="1.3" />
          <circle cx="12" cy="17.2" r="1.35" fill="#fff" opacity="0.55" />
          <circle cx="8.5" cy="17.2" r="0.85" fill="#fff" opacity="0.35" />
          <circle cx="15.5" cy="17.2" r="0.85" fill="#fff" opacity="0.35" />
        </svg>
      );
    case 'crown': // coroa — campeão / rei
      return (
        <svg {...common}>
          <path d="M4 8l3.5 4 4.5-6 4.5 6L20 8l-1.5 10h-13L4 8z" strokeLinejoin="round" />
          <path d="M5.5 18h13" />
          <circle cx="4" cy="8" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="20" cy="8" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="12" cy="6" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'bolt': // raio — sorte / energia
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M13 2L4 13h6l-1 9 9-12h-6l1-8z" />
        </svg>
      );
    case 'heart': // coração — fã / fidelidade
      return (
        <svg {...common}>
          <path d="M12 20s-7-4.6-9.5-9.2C1 7.7 2.7 4.5 6 4.5c2 0 3.3 1.2 4 2.3.7-1.1 2-2.3 4-2.3 3.3 0 5 3.2 3.5 6.3C19 15.4 12 20 12 20z" strokeLinejoin="round" />
        </svg>
      );
    case 'football': // bola de futebol
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7l3.2 2.4-1.2 3.8h-4l-1.2-3.8L12 7z" fill="currentColor" stroke="none" />
          <path d="M12 7V3.2M15.2 9.4l3.4-1.6M14 13.2l2.3 3M10 13.2l-2.3 3M8.8 9.4L5.4 7.8" />
        </svg>
      );
    case 'sword': // espada — luta / MK
      return (
        <svg {...common}>
          <path d="M14.5 3.5L20 4l.5 5.5-9 9-2-2 5-5z" strokeLinejoin="round" />
          <path d="M6.5 14.5l3 3" />
          <path d="M3 21l3.5-3.5M5 16l3 3-2.5 2.5L3 19z" strokeLinejoin="round" />
        </svg>
      );
    case 'whistle': // apito — VARIMITIVÃO / arbitragem
      return (
        <svg {...common}>
          <path d="M3 11a5 5 0 0 0 5 5h2l3 3v-5h2a4 4 0 0 0 0-8H6a3 3 0 0 0-3 3z" strokeLinejoin="round" />
          <circle cx="8" cy="11.5" r="1.6" fill="currentColor" stroke="none" />
          <path d="M16 5l1.5-2M19 7l2-1.5" />
        </svg>
      );
    case 'snowflake': // floco — gelo / Sub-Zero (MK)
      return (
        <svg {...common}>
          <path d="M12 2v20M2 12h20M5 5l14 14M19 5L5 19" />
          <path d="M12 5l-2 2M12 5l2 2M12 19l-2-2M12 19l2-2M5 12l2-2M5 12l2 2M19 12l-2-2M19 12l-2 2" />
        </svg>
      );
    case 'rocket': // foguete — em alta / subindo
      return (
        <svg {...common}>
          <path d="M12 2c3 2 4.5 5 4.5 9 0 2-1 4-1 4h-7s-1-2-1-4c0-4 1.5-7 4.5-9z" strokeLinejoin="round" />
          <circle cx="12" cy="9" r="1.8" />
          <path d="M8.5 15l-2.5 2 .5 3 2.5-1.5M15.5 15l2.5 2-.5 3-2.5-1.5" strokeLinejoin="round" />
        </svg>
      );
    case 'crosshair': // mira — CS / tiro
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7.5" />
          <path d="M12 1.5v3.5M12 19v3.5M1.5 12h3.5M19 12h3.5" strokeLinecap="round" />
          <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'fist': // punho — luta / soco
      return (
        <svg {...common}>
          <rect x="5" y="9" width="12.5" height="10" rx="3" />
          <path d="M8.5 9V6.4M11.75 9V5.9M15 9V6.4" strokeLinecap="round" />
          <path d="M17.5 11.5h2.4a1.6 1.6 0 0 1 0 3.2h-2.4" strokeLinejoin="round" />
        </svg>
      );
    default:
      return null;
  }
}

// Renderiza a bandeira de um time da Copa. Aceita:
//  - String emoji unicode (ex: '🇧🇷')         — renderiza o emoji
//  - '__flag_default__'  (time sem bandeira)  — renderiza <Icon name="flag">
//  - '__flag_unknown__'  (slot por definir)   — renderiza <Icon name="question">
function TeamFlag({ flag, size = 26 }) {
  if (flag === '__flag_default__') return <Icon name="flag" size={Math.round(size * 0.75)} />;
  if (flag === '__flag_unknown__') return <Icon name="question" size={Math.round(size * 0.75)} />;
  // Font Twemoji garante que Firefox no Windows renderize bandeiras de país
  // (Segoe UI Emoji não tem essa range — mostra "MX" ao invés de 🇲🇽).
  return (
    <span style={{
      fontSize: size,
      lineHeight: 1,
      fontFamily: '"Twemoji Country Flags", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
    }}>{flag}</span>
  );
}

// ─── LOGIN ──────────────────────────────────────────────────────────────────
function Login({ onAuth, isNewNick }) {
  const [nick, setNick] = useState('');
  const [senha, setSenha] = useState('');
  const [senha2, setSenha2] = useState('');
  const [msg, setMsg] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [showPass2, setShowPass2] = useState(false);
  const [busy, setBusy] = useState(false);
  const trimmedNick = nick.trim().toLowerCase();
  const isNew = isNewNick && trimmedNick ? isNewNick(trimmedNick) : false;
  const isAdminNick = trimmedNick === 'admin';
  const showModeBadge = trimmedNick.length > 0;

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
      <form className="login-card login-card-v2" onSubmit={submit}>
        {/* TARJA decorativa superior (estilo manchete) */}
        <div className="login-banner">
          <span className="login-banner-star"><Icon name="star" size={14} /></span>
          PRIMITIVÃO TIMES
          <span className="login-banner-star"><Icon name="star" size={14} /></span>
        </div>

        <img className="login-logo" src="primitivao-icon.png" alt="Primitivão" />

        <h1 className="login-wordmark">PRIMITIVÃO</h1>
        <div className="login-tagline">
          <span>BOLÃO</span> · <span>APOSTAS</span> · <span>ZOEIRA</span>
        </div>

        <div className="login-meta">
          <span className="login-meta-dot" />
          TEMPORADA AO VIVO · FIFA 2026 SEASON 1
        </div>

        {showModeBadge && (
          <div className={'login-mode ' + (isAdminNick ? 'admin' : isNew ? 'create' : 'enter')}>
            <Icon name={isAdminNick ? 'shield' : isNew ? 'sparkle' : 'check'} size={14} />
            <span>{isAdminNick
              ? 'ENTRANDO COMO ADMIN'
              : isNew
                ? 'CONTA NOVA · vamos criar pra você'
                : 'CONTA ENCONTRADA · vai entrar'}</span>
          </div>
        )}

        <div className="field">
          <label>NICK</label>
          <input
            value={nick}
            onChange={e => { setNick(e.target.value); setMsg(''); }}
            placeholder="seu apelido"
            autoFocus autoCapitalize="off" autoCorrect="off"
            spellCheck={false}
          />
        </div>

        <div className="field">
          <label>SENHA</label>
          <div className="pass-wrap">
            <input
              type={showPass ? 'text' : 'password'}
              value={senha}
              onChange={e => setSenha(e.target.value)}
              placeholder="••••••"
            />
            <button
              type="button"
              className="pass-toggle"
              onClick={() => setShowPass(s => !s)}
              tabIndex={-1}
              aria-label={showPass ? 'Esconder senha' : 'Mostrar senha'}
            >
              <Icon name={showPass ? 'eye-off' : 'eye'} size={18} />
            </button>
          </div>
        </div>

        {isNew && (
          <div className="field">
            <label>CONFIRMAR SENHA</label>
            <div className="pass-wrap">
              <input
                type={showPass2 ? 'text' : 'password'}
                value={senha2}
                onChange={e => setSenha2(e.target.value)}
                placeholder="••••••"
              />
              <button
                type="button"
                className="pass-toggle"
                onClick={() => setShowPass2(s => !s)}
                tabIndex={-1}
                aria-label={showPass2 ? 'Esconder senha' : 'Mostrar senha'}
              >
                <Icon name={showPass2 ? 'eye-off' : 'eye'} size={18} />
              </button>
            </div>
          </div>
        )}

        <button type="submit" className="login-btn" disabled={busy || !nick.trim() || !senha}>
          {busy ? 'AGUARDE…' : (isAdminNick ? 'ENTRAR COMO ADMIN' : isNew ? 'CRIAR CONTA' : 'ENTRAR')}
        </button>

        <div className="login-msg">{msg}</div>

        {/* Feature highlights no rodapé */}
        <div className="login-features">
          <div className="login-feature"><span className="lf-ic"><Icon name="target" size={22} /></span><span>5 mercados</span></div>
          <div className="login-feature"><span className="lf-ic"><Icon name="trophy" size={22} /></span><span>7 campeonatos</span></div>
          <div className="login-feature"><span className="lf-ic"><Icon name="globe" size={22} /></span><span>bolão da Copa</span></div>
          <div className="login-feature"><span className="lf-ic"><Icon name="coin" size={22} /></span><span>+500 PC/sem</span></div>
        </div>
      </form>
    </div>
  );
}

// ─── APOSTAR + CUPOM ────────────────────────────────────────────────────────
// games = lista derivada de cs.rounds (já filtrada por jogos não-jogados, com odds).
// ─── INÍCIO ────────────────────────────────────────────────────────────────
// Feed de notícias / vídeos / atualizações do projeto.
// Pra adicionar uma notícia nova, é só inserir um objeto no array NEWS.
const NEWS = [
  {
    id: 'edicao-08-escandalo',
    title: 'ESCÂNDALO EM CAMPO! CELIN MANIPULOU O RESULTADO??',
    subtitle: 'Juca 4 × 0 Celin · aos 88 min Celin "desaba" e leva 3 gols num lance só. Coincidência ou entregada?',
    date: '25/05/2026',
    tag: 'PRIMITIVÃO TIMES · VOL. 08',
    image: 'news/edicao-08-escandalo.jpg',
    body: (
      <>
        <p>
          Edição especial do <strong>Primitivão Times</strong> com tudo o que
          tá rolando na temporada:
        </p>
        <ul className="ic-list">
          <li><Icon name="warning" size={14} /><span><strong>Celin manipulou?</strong> Segurou o jogo a tarde inteira pra não tomar gol — aos 88 min levou 3 e fechou Juca 4 × 0 Celin. <em>"Coincidência ou entregada?"</em></span></li>
          <li><Icon name="skull" size={14} /><span><strong>Mohamed alcança −33 SG</strong> após derrota amarga contra o Magreza. 0 vitórias, 6 derrotas. Vai encerrar com −50?</span></li>
          <li><Icon name="fire" size={14} /><span><strong>Juca on fire!</strong> 4 jogos, 4 goleadas, 100% de zoeira.</span></li>
          <li><Icon name="book" size={14} /><span><strong>Magreza em modo carreira:</strong> nem piedade, nem desculpa.</span></li>
          <li><Icon name="target" size={14} /><span><strong>Comissão do VARIMITIVÃO</strong> de plantão: <em>"errou de novo? não foi erro, foi intenção!"</em></span></li>
          <li><Icon name="newspaper" size={14} /><span><strong>Futmercado bombando</strong> — rumores, trocas e negociações de padaria.</span></li>
          <li><Icon name="trophy" size={14} /><span><strong>Próximo jogo:</strong> BANE × CACO. Dois títulos, um destino.</span></li>
        </ul>
        <p>
          Acompanha tudo na aba <strong>CAMPEONATOS <Icon name="arrow-right" size={11} className="inl-arrow" /> FIFA</strong> — classificação,
          jogos abertos e o Hall da Vergonha em tempo real.
        </p>
      </>
    ),
  },
  {
    id: 'bonus-semanal',
    title: '+500 PC NA CONTA, MEU FILHO!',
    subtitle: 'O xamã liberou o cofre — não esquece de checar antes da rodada.',
    date: '22/05/2026',
    tag: 'PROMO',
    image: 'news/bonus-semanal.jpg',
    body: (
      <>
        <p>
          Todo dia <strong>segunda-feira às 10h da manhã (BRT)</strong> o cofre
          do xamã se abre e libera <strong>500 PC de graça</strong> pra cada
          jogador. É só clicar no chip <strong>+500 PC RECLAMAR</strong> que
          aparece lá no topo da página, ao lado do seu saldo.
        </p>
        <p>
          Não perdeu? Confere também o site toda segunda — quem não reclama
          fica de fora até a próxima.
        </p>
      </>
    ),
  },
  {
    id: 'primitivao-resiste',
    title: 'PRIMITIVÃO RESISTE!',
    subtitle: 'Vândalo digital apaga base de apostadores — sistema renasce maior e melhor.',
    date: '21/05/2026',
    tag: 'ATUALIZAÇÃO',
    image: 'news/primitivao-resiste.jpg',
    body: (
      <>
        <p>
          Na calada da noite, um invasor mal-intencionado conseguiu apagar
          todos os usuários e inscrições do Primitivão. Mas o cofre PC
          resistiu! Em horas, o sistema voltou no ar com defesas reforçadas.
        </p>
        <p><strong>O que mudou:</strong></p>
        <ul className="ic-list">
          <li><Icon name="dice" size={14} /><span>Odds <strong>automáticas</strong> baseadas na classificação</span></li>
          <li><Icon name="target" size={14} /><span>5 mercados: 1X2, Ambos Marcam, Ninguém Marca, +3 Gols (mandante/visitante)</span></li>
          <li><Icon name="coin" size={14} /><span>Bônus semanal de <strong>500 PC</strong> (era 20!) — toda segunda 10h BRT</span></li>
          <li><Icon name="trophy" size={14} /><span>Hall da Fama e Hall da Vergonha por temporada</span></li>
          <li><Icon name="user" size={14} /><span>Aba "Meu Perfil" com seu time, troféus e títulos</span></li>
          <li><Icon name="gamepad" size={14} /><span>Mortal Kombat, Rocket League, LoL, CS, Golf With Your Friends, Copa do Mundo — chegando em breve</span></li>
          <li><Icon name="phone" size={14} /><span>Otimizado pra celular (com menu hamburger)</span></li>
          <li><Icon name="lock" size={14} /><span>Defesas contra race conditions e backup automático diário</span></li>
        </ul>
      </>
    ),
  },
  {
    id: 'fifa-s1',
    title: 'TEMPORADA EM ANDAMENTO: FIFA 2026 SEASON 1',
    subtitle: 'A primeira temporada já está rolando — confira os jogos da rodada atual.',
    date: '18/05/2026',
    tag: 'CAMPEONATO',
    image: null,
    body: (
      <>
        <p>
          A primeira temporada oficial do Primitivão tá no ar. 8 jogadores,
          7 rodadas, 28 jogos. Apostas abertas em cada partida até o admin
          travar (geralmente quando a bola vai rolar).
        </p>
        <p>
          As <strong>odds são calculadas em tempo real</strong> a partir da
          classificação: quanto mais forte um time (pontos + saldo de gol),
          menor a odd dele vencer. Quando uma rodada inteira termina, as
          odds da próxima rodada são recalculadas automaticamente pra todo
          mundo no app.
        </p>
        <p>
          Vá em <strong>CAMPEONATOS <Icon name="arrow-right" size={11} className="inl-arrow" /> FIFA <Icon name="arrow-right" size={11} className="inl-arrow" /> JOGOS</strong> pra apostar.
        </p>
      </>
    ),
  },
];

// ─── COPA DO MUNDO (bolão) ─────────────────────────────────────────────────
// Ordem canônica das fases pra exibir na ordem certa.
const WC_STAGE_ORDER = [
  'Matchday 1','Matchday 2','Matchday 3','Matchday 4','Matchday 5','Matchday 6','Matchday 7','Matchday 8','Matchday 9',
  'Matchday 10','Matchday 11','Matchday 12','Matchday 13','Matchday 14','Matchday 15','Matchday 16','Matchday 17',
  'Round of 32','Round of 16','Quarter-final','Semi-final','Match for third place','Final',
];

function CopaDoMundoView({ session, isAdmin, users, worldcup, fixtures, onSavePick, onSetResult }) {
  const [subTab, setSubTab] = useState('jogos'); // 'jogos' | 'ranking'
  const results = worldcup?.results || {};
  const picks   = worldcup?.picks   || {};
  const myNick  = session?.nick;
  const myPicks = (myNick && picks[myNick]) || {};

  return (
    <div className="copa-view">
      <div className="copa-hero">
        <div className="copa-hero-tag">BOLÃO</div>
        <div className="copa-hero-title">COPA DO MUNDO 2026</div>
        <div className="copa-hero-sub">
          Palpite o placar de cada jogo. 3 pts por placar exato · 1 pt por
          acertar só o vencedor/empate · 0 por errar. <strong>Sem PC envolvido</strong> — só por glória e zoeira.
          {fixtures && fixtures.length > 0 && (
            <> · <strong>{fixtures.length}</strong> jogos cadastrados.</>
          )}
        </div>
      </div>

      <div className="copa-subtabs">
        <button className={'copa-subtab ' + (subTab === 'jogos' ? 'active' : '')} onClick={() => setSubTab('jogos')}>JOGOS</button>
        <button className={'copa-subtab ' + (subTab === 'grupos' ? 'active' : '')} onClick={() => setSubTab('grupos')}><Icon name="chart" size={14} /> GRUPOS</button>
        <button className={'copa-subtab ' + (subTab === 'bracket' ? 'active' : '')} onClick={() => setSubTab('bracket')}><Icon name="trophy" size={14} /> MATA-MATA</button>
        <button className={'copa-subtab ' + (subTab === 'ranking' ? 'active' : '')} onClick={() => setSubTab('ranking')}><Icon name="trophy" size={14} /> RANKING DO BOLÃO</button>
      </div>

      {subTab === 'jogos' && (
        <CopaJogos
          fixtures={fixtures || []}
          results={results}
          myPicks={myPicks}
          allPicks={picks}
          myNick={myNick}
          isAdmin={isAdmin}
          onSavePick={onSavePick}
          onSetResult={onSetResult}
        />
      )}

      {subTab === 'grupos' && (
        <CopaGrupos fixtures={fixtures || []} results={results} />
      )}

      {subTab === 'bracket' && (
        <CopaBracket fixtures={fixtures || []} results={results} />
      )}

      {subTab === 'ranking' && (
        <CopaRanking
          users={users}
          fixtures={fixtures || []}
          results={results}
          picks={picks}
          myNick={myNick}
        />
      )}
    </div>
  );
}

function CopaJogos({ fixtures, results, myPicks, allPicks, myNick, isAdmin, onSavePick, onSetResult }) {
  // States dos filtros (precisam vir antes de qualquer return)
  const [stageFilter, setStageFilter] = useState('all'); // 'all' | 'group' | 'knockout'
  const [teamFilter, setTeamFilter]   = useState('');     // nome PT do time, '' = todos

  // Standings de cada grupo (memoizado)
  const standingsByGroup = useMemo(() => {
    const out = {};
    const groups = Array.from(new Set(fixtures.filter(m => !m.isKnockout && m.group).map(m => m.group)));
    for (const g of groups) out[g] = computeWcGroupStandings(g, fixtures, results);
    return out;
  }, [fixtures, results]);

  // Resolve slots automaticamente (1A, 2B viram nome real do time)
  const resolvedFixtures = useMemo(() => {
    return fixtures.map(m => {
      if (!m.slotHome && !m.slotAway) return m;
      const next = { ...m };
      if (m.slotHome && m.rawSlotHome) {
        const r = resolveWcSlot(m.rawSlotHome, standingsByGroup);
        if (r) { next.home = r.name; next.flagHome = r.flag; next.slotHome = false; next.resolvedHome = true; }
      }
      if (m.slotAway && m.rawSlotAway) {
        const r = resolveWcSlot(m.rawSlotAway, standingsByGroup);
        if (r) { next.away = r.name; next.flagAway = r.flag; next.slotAway = false; next.resolvedAway = true; }
      }
      return next;
    });
  }, [fixtures, standingsByGroup]);

  // Loading se ainda não carregou os dados
  if (!fixtures || fixtures.length === 0) {
    return (
      <div className="card">
        <div className="card-body">
          <div className="empty">
            <div className="e1">CARREGANDO…</div>
            <div className="e2">Buscando jogos da Copa do Mundo 2026.</div>
          </div>
        </div>
      </div>
    );
  }

  // Lista de todos os times pro select (PT-BR, sem duplicatas, ordenado)
  const allTeams = (() => {
    const s = new Set();
    for (const m of resolvedFixtures) {
      if (!m.slotHome) s.add(m.home);
      if (!m.slotAway) s.add(m.away);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  })();

  const filtered = resolvedFixtures.filter(m => {
    if (stageFilter === 'group'    && m.isKnockout) return false;
    if (stageFilter === 'knockout' && !m.isKnockout) return false;
    if (teamFilter && m.home !== teamFilter && m.away !== teamFilter) return false;
    return true;
  });

  // Agrupa por round (na ordem canônica)
  const byRound = filtered.reduce((acc, m) => {
    (acc[m.round] = acc[m.round] || []).push(m); return acc;
  }, {});
  const presentRounds = WC_STAGE_ORDER.filter(r => byRound[r] && byRound[r].length > 0);
  const extraRounds = Object.keys(byRound).filter(r => !WC_STAGE_ORDER.includes(r));
  const roundKeys = [...presentRounds, ...extraRounds];

  const totalAll = resolvedFixtures.length;
  const totalGroup = resolvedFixtures.filter(m => !m.isKnockout).length;
  const totalKO = resolvedFixtures.filter(m => m.isKnockout).length;

  return (
    <div>
      {!myNick && (
        <div className="copa-warn">Você precisa estar logado pra palpitar.</div>
      )}

      <div className="copa-filters">
        <button className={'copa-chip ' + (stageFilter === 'all' ? 'active' : '')} onClick={() => setStageFilter('all')}>
          TODOS · {totalAll}
        </button>
        <button className={'copa-chip ' + (stageFilter === 'group' ? 'active' : '')} onClick={() => setStageFilter('group')}>
          FASE DE GRUPOS · {totalGroup}
        </button>
        <button className={'copa-chip ' + (stageFilter === 'knockout' ? 'active' : '')} onClick={() => setStageFilter('knockout')}>
          MATA-MATA · {totalKO}
        </button>
        <div className="copa-team-select-wrap">
          <select className="copa-team-select" value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
            <option value="">TODOS OS TIMES</option>
            {allTeams.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {teamFilter && (
            <button className="copa-team-clear" onClick={() => setTeamFilter('')} title="Limpar filtro de time"><Icon name="x" size={12} /></button>
          )}
        </div>
      </div>

      {roundKeys.length === 0 && (
        <div className="card"><div className="card-body"><div className="empty">
          <div className="e2">Nenhum jogo bate com esse filtro.</div>
        </div></div></div>
      )}

      {roundKeys.map(rk => {
        const matches = byRound[rk];
        const isKO = matches[0]?.isKnockout;
        const label = translateRound(rk);
        return (
          <div key={rk} className="card copa-round-card">
            <div className="card-head">
              <div className="title">{isKO ? '' : 'FASE DE GRUPOS · '}{label}</div>
              <div className="sub">{matches.length} JOGO{matches.length === 1 ? '' : 'S'}</div>
            </div>
            <div className="card-body">
              {matches.map(m => (
                <CopaMatchCard
                  key={m.id}
                  match={m}
                  result={results[m.id]}
                  myPick={myPicks[m.id]}
                  allPicks={allPicks}
                  isAdmin={isAdmin}
                  canBet={!!myNick}
                  onSavePick={onSavePick}
                  onSetResult={onSetResult}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CopaMatchCard({ match, result, myPick, allPicks, isAdmin, canBet, onSavePick, onSetResult }) {
  const closed = !!result; // admin já lançou o placar real -> congela
  // Se algum time é placeholder (mata-mata não decidido), bloqueia palpite
  const isPlaceholder = match.slotHome || match.slotAway;
  const [gh, setGh] = useState(myPick ? String(myPick.gh) : '');
  const [ga, setGa] = useState(myPick ? String(myPick.ga) : '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg]   = useState('');

  // Admin pra setar resultado
  const [adminGh, setAdminGh] = useState(result ? String(result.gh) : '');
  const [adminGa, setAdminGa] = useState(result ? String(result.ga) : '');
  const [adminBusy, setAdminBusy] = useState(false);

  const handleSave = async () => {
    if (busy || closed || isPlaceholder) return;
    setBusy(true); setMsg('');
    try {
      await onSavePick(match.id, gh, ga);
      setMsg('palpite salvo');
      setTimeout(() => setMsg(''), 2000);
    } catch (e) {
      setMsg('erro — tenta de novo');
    } finally { setBusy(false); }
  };

  const handleSetResult = async () => {
    if (adminBusy) return;
    setAdminBusy(true);
    try { await onSetResult(match.id, adminGh, adminGa); }
    finally { setAdminBusy(false); }
  };
  const handleClearResult = async () => {
    if (adminBusy) return;
    setAdminBusy(true);
    try {
      await onSetResult(match.id, '', '');
      setAdminGh(''); setAdminGa('');
    } finally { setAdminBusy(false); }
  };

  // Conta quantos palpitaram nesse jogo
  const pickCount = Object.values(allPicks || {}).reduce(
    (acc, up) => acc + (up && up[match.id] ? 1 : 0), 0
  );

  let myScore = null;
  if (result && myPick) myScore = scoreWcPick(result, myPick);

  const tagPrefix = match.isKnockout ? match.roundLabel : `GRUPO ${match.group}`;

  return (
    <div className={'wc-match ' + (closed ? 'closed' : '') + (isPlaceholder ? ' placeholder' : '')}>
      <div className="wc-match-head">
        <span className="wc-tag">{tagPrefix} · {match.date} · {match.time}</span>
        <span className="wc-pickcount">{pickCount} palpite{pickCount === 1 ? '' : 's'}</span>
      </div>
      {match.ground && (
        <div className="wc-ground"><Icon name="pin" size={12} /> {match.ground}</div>
      )}
      <div className="wc-match-body">
        <div className="wc-team wc-team-home">
          <span className="wc-flag"><TeamFlag flag={match.flagHome} /></span>
          <span className="wc-name">{match.home}</span>
        </div>
        <div className="wc-inputs">
          <input
            className="wc-score-in"
            type="number" min="0" max="20"
            value={closed ? '' : gh}
            placeholder={closed && result ? String(result.gh) : '–'}
            onChange={e => setGh(e.target.value)}
            disabled={closed || !canBet || busy || isPlaceholder}
            aria-label={`Palpite gols ${match.home}`}
          />
          <span className="wc-x">×</span>
          <input
            className="wc-score-in"
            type="number" min="0" max="20"
            value={closed ? '' : ga}
            placeholder={closed && result ? String(result.ga) : '–'}
            onChange={e => setGa(e.target.value)}
            disabled={closed || !canBet || busy || isPlaceholder}
            aria-label={`Palpite gols ${match.away}`}
          />
        </div>
        <div className="wc-team wc-team-away">
          <span className="wc-name">{match.away}</span>
          <span className="wc-flag"><TeamFlag flag={match.flagAway} /></span>
        </div>
      </div>

      {isPlaceholder && !closed && (
        <div className="wc-placeholder-note">
          Times ainda não definidos — palpites liberam quando classificação resolver o slot.
        </div>
      )}

      {closed && (
        <div className="wc-result-strip">
          <span className="wc-result-label">RESULTADO REAL:</span>
          <span className="wc-result-score">{result.gh} × {result.ga}</span>
          {myPick && (
            <span className={'wc-myscore wc-myscore-' + myScore}>
              SEU PALPITE: {myPick.gh}×{myPick.ga} · {myScore} pt{myScore === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}

      {!closed && canBet && !isPlaceholder && (
        <div className="wc-actions">
          <button className="wc-save" onClick={handleSave} disabled={busy || !gh || !ga}>
            {busy ? 'SALVANDO…' : (myPick ? 'ATUALIZAR PALPITE' : 'SALVAR PALPITE')}
          </button>
          {msg && <span className="wc-msg">{msg === 'palpite salvo' && <Icon name="check" size={11} />} {msg}</span>}
        </div>
      )}

      {isAdmin && !isPlaceholder && (
        <div className="wc-admin">
          <span className="wc-admin-label">ADMIN — PLACAR REAL:</span>
          <input
            className="wc-score-in wc-admin-in"
            type="number" min="0" max="20"
            value={adminGh}
            onChange={e => setAdminGh(e.target.value)}
            placeholder="–"
          />
          <span className="wc-x">×</span>
          <input
            className="wc-score-in wc-admin-in"
            type="number" min="0" max="20"
            value={adminGa}
            onChange={e => setAdminGa(e.target.value)}
            placeholder="–"
          />
          <button className="wc-admin-btn" onClick={handleSetResult} disabled={adminBusy}>
            {result ? 'ATUALIZAR' : 'LANÇAR'}
          </button>
          {result && (
            <button className="wc-admin-btn wc-admin-clear" onClick={handleClearResult} disabled={adminBusy}>
              LIMPAR
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CopaGrupos({ fixtures, results }) {
  if (!fixtures || fixtures.length === 0) {
    return (
      <div className="card"><div className="card-body"><div className="empty">
        <div className="e1">CARREGANDO…</div>
      </div></div></div>
    );
  }
  // Lista todos os grupos presentes em fixtures (A-L)
  const groups = Array.from(new Set(
    fixtures.filter(m => !m.isKnockout && m.group).map(m => m.group)
  )).sort();
  const standingsByGroup = {};
  for (const g of groups) standingsByGroup[g] = computeWcGroupStandings(g, fixtures, results);

  return (
    <div className="copa-grupos">
      <div className="copa-grupos-grid">
        {groups.map(g => {
          const st = standingsByGroup[g];
          const allDone = st.length > 0 && st.every(t => t.J === 3);
          return (
            <div key={g} className="card copa-group-card">
              <div className="card-head">
                <div className="title">GRUPO {g}</div>
                <div className="sub">{allDone ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="check" size={11} /> COMPLETO</span> : `${st.reduce((a,t) => a + t.J, 0) / 2} de 6 jogos`}</div>
              </div>
              <div className="card-body" style={{ overflowX: 'auto' }}>
                <table className="std-table std-wc">
                  <thead>
                    <tr>
                      <th>#</th><th style={{ textAlign: 'left' }}>TIME</th>
                      <th>J</th><th>V</th><th>E</th><th>D</th><th>SG</th><th>P</th>
                    </tr>
                  </thead>
                  <tbody>
                    {st.map((t, i) => {
                      const sg = t.GP - t.GC;
                      // Top 2 classificam direto; 3º pode classificar entre os melhores 8 terceiros
                      const cls = i < 2 ? 'glory' : (i === 2 ? 'third' : 'releg');
                      return (
                        <tr key={t.name} className={cls}>
                          <td className="std-pos">{String(i + 1).padStart(2, '0')}</td>
                          <td>
                            <span style={{ marginRight: 6, display: 'inline-flex', verticalAlign: 'middle' }}><TeamFlag flag={t.flag} size={16} /></span>
                            <span style={{ fontWeight: 800 }}>{t.name}</span>
                          </td>
                          <td>{t.J}</td>
                          <td style={{ fontWeight: 800 }}>{t.V}</td>
                          <td>{t.E}</td>
                          <td style={{ color: 'rgba(28,22,18,0.45)' }}>{t.D}</td>
                          <td>{sg > 0 ? '+' + sg : sg}</td>
                          <td style={{ fontFamily: 'Bagel Fat One, Impact', fontSize: 16 }}>{t.P}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
      <p className="copa-grupos-legenda">
        <span className="legenda-sq" style={{ color: '#d76414' }}><Icon name="square-filled" size={11} /></span> <strong>Top 2</strong> classificam direto pro mata-mata ·
        <span className="legenda-sq" style={{ color: '#e3b94d' }}><Icon name="square-filled" size={11} /></span> <strong>3º</strong> pode passar entre os 8 melhores terceiros ·
        <span className="legenda-sq" style={{ color: 'rgba(28,22,18,0.25)' }}><Icon name="square-filled" size={11} /></span> <strong>4º</strong> eliminado.
      </p>
    </div>
  );
}

function CopaRanking({ users, fixtures, results, picks, myNick }) {
  const [openNick, setOpenNick] = useState(null);
  if (!fixtures || fixtures.length === 0) {
    return (
      <div className="card"><div className="card-body"><div className="empty">
        <div className="e1">CARREGANDO…</div>
      </div></div></div>
    );
  }
  const rows = Object.keys(users).map(nick => {
    const up = picks[nick] || {};
    let pts = 0, exactos = 0, certos = 0, errados = 0, palpitados = 0;
    for (const m of fixtures) {
      const r = results[m.id];
      const p = up[m.id];
      if (p) palpitados++;
      if (r && p) {
        const s = scoreWcPick(r, p);
        pts += s;
        if (s === 3) exactos++;
        else if (s === 1) certos++;
        else errados++;
      }
    }
    return { nick, pts, exactos, certos, errados, palpitados };
  }).sort((a, b) => b.pts - a.pts || b.exactos - a.exactos);

  return (
    <>
      <div className="card">
        <div className="card-head">
          <div className="title"><Icon name="trophy" size={16} /> RANKING DO BOLÃO</div>
          <div className="sub">{rows.length} JOGADORES · {fixtures.length} JOGOS · CLIQUE NO NICK PRA VER PALPITES</div>
        </div>
        <div className="card-body">
          {/* Legenda visível (no toque o tooltip via title= não aparece). */}
          <div className="wc-rank-legend">
            <span><strong>×3</strong> placar exato</span>
            <span><strong>×1</strong> resultado certo</span>
            <span><strong>×0</strong> erro</span>
            <span><strong>palp</strong> palpitados</span>
          </div>
          {rows.length === 0 && <div className="empty"><div className="e2">Ninguém cadastrado ainda.</div></div>}
          {rows.map((r, i) => (
            <button
              key={r.nick}
              className={'wc-rank-row wc-rank-row-btn ' + (r.nick === myNick ? 'me' : '')}
              onClick={() => setOpenNick(r.nick)}
              type="button"
            >
              <div className="wc-rank-pos">{i + 1}</div>
              <div className="wc-rank-nick">@{r.nick}</div>
              <div className="wc-rank-stats">
                <span title="Placares exatos (3 pts)">{r.exactos} <small>×3</small></span>
                <span title="Resultados certos (1 pt)">{r.certos} <small>×1</small></span>
                <span title="Erros (0 pt)">{r.errados} <small>×0</small></span>
                <span title="Total palpitado">{r.palpitados} <small>palp</small></span>
              </div>
              <div className="wc-rank-pts">{r.pts}<small>pts</small></div>
            </button>
          ))}
        </div>
      </div>
      {openNick && (
        <CopaPicksModal
          nick={openNick}
          picks={picks[openNick] || {}}
          fixtures={fixtures}
          results={results}
          onClose={() => setOpenNick(null)}
        />
      )}
    </>
  );
}

// Modal que mostra todos os palpites de um jogador da Copa, agrupados por
// fase (grupo / oitavas / quartas / ...).
function CopaPicksModal({ nick, picks, fixtures, results, onClose }) {
  const grouped = useMemo(() => {
    const byFase = {};
    for (const m of fixtures) {
      const fase = m.group ? `GRUPO ${m.group}` : (m.roundLabel || 'MATA-MATA');
      if (!byFase[fase]) byFase[fase] = [];
      byFase[fase].push(m);
    }
    return byFase;
  }, [fixtures]);

  const myPickCount = Object.keys(picks).length;
  let totalPts = 0;
  fixtures.forEach(m => {
    const r = results[m.id]; const p = picks[m.id];
    if (r && p) totalPts += scoreWcPick(r, p);
  });

  return (
    <div className="shared-slip-backdrop" onClick={onClose}>
      <div className="shared-slip-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="shared-slip-head">
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.28em', fontWeight: 800, color: 'var(--pv-orange)' }}>PALPITES DO BOLÃO</div>
            <div style={{ fontFamily: 'Bungee Inline, Impact, sans-serif', fontSize: 22, letterSpacing: '0.04em', marginTop: 4 }}>
              @{nick}
            </div>
            <div style={{ fontSize: 11, marginTop: 4, opacity: 0.85 }}>
              {myPickCount} palpite{myPickCount === 1 ? '' : 's'} · {totalPts} pt{totalPts === 1 ? '' : 's'}
            </div>
          </div>
          <button onClick={onClose} className="shared-slip-close" aria-label="Fechar">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="shared-slip-body">
          {Object.entries(grouped).map(([fase, ms]) => {
            const pickedInFase = ms.filter(m => picks[m.id]);
            if (pickedInFase.length === 0) return null;
            return (
              <div key={fase} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, letterSpacing: '0.2em', fontWeight: 800, color: 'var(--pv-orange)', marginBottom: 6 }}>{fase}</div>
                {pickedInFase.map(m => {
                  const p = picks[m.id];
                  const r = results[m.id];
                  const pts = r ? scoreWcPick(r, p) : null;
                  const cor = pts === 3 ? '#3a7d2a' : pts === 1 ? '#c98a14' : pts === 0 ? '#c33' : 'rgba(28,22,18,0.5)';
                  return (
                    <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, padding: '7px 0', borderBottom: '1px dashed rgba(28,22,18,0.12)', alignItems: 'center', fontSize: 12 }}>
                      <div>
                        <span style={{ fontWeight: 700 }}>{m.home}</span>
                        {' '}<span style={{ opacity: 0.5 }}>×</span>{' '}
                        <span style={{ fontWeight: 700 }}>{m.away}</span>
                      </div>
                      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 800 }}>
                        {p.gh}–{p.ga}
                        {r && <span style={{ marginLeft: 6, opacity: 0.5 }}>({r.gh}–{r.ga})</span>}
                      </div>
                      <div style={{ color: cor, fontSize: 10, letterSpacing: '0.14em', fontWeight: 800, width: 36, textAlign: 'right' }}>
                        {pts === null ? '—' : pts === 3 ? 'EXATO' : pts === 1 ? 'CERTO' : 'ERROU'}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {myPickCount === 0 && (
            <div className="empty">
              <div className="e2">@{nick} ainda não palpitou em nenhum jogo.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Bracket visual do mata-mata: organiza os jogos knockout em colunas por fase
// (32avos / oitavas / quartas / semis / 3o lugar + final). Cada match card
// mostra times + placar, fica destacado quando ja tem resultado.
function CopaBracket({ fixtures, results }) {
  const knockoutMatches = useMemo(() => fixtures.filter(m => m.isKnockout), [fixtures]);
  if (knockoutMatches.length === 0) {
    return (
      <div className="card"><div className="card-body"><div className="empty">
        <div className="e1">SEM MATA-MATA AINDA</div>
        <div className="e2">A fase de mata-mata aparece aqui quando os jogos forem cadastrados.</div>
      </div></div></div>
    );
  }

  // Ordem das fases (chave bruta do JSON pra label exibido)
  const PHASES = [
    { key: 'Round of 32',           label: '32-AVOS' },
    { key: 'Round of 16',           label: 'OITAVAS' },
    { key: 'Quarter-final',         label: 'QUARTAS' },
    { key: 'Semi-final',            label: 'SEMIFINAL' },
    { key: 'Match for third place', label: '3º LUGAR' },
    { key: 'Final',                 label: 'FINAL' },
  ];

  const byPhase = {};
  PHASES.forEach(p => { byPhase[p.key] = []; });
  knockoutMatches.forEach(m => {
    if (byPhase[m.round]) byPhase[m.round].push(m);
  });
  const phasesWithGames = PHASES.filter(p => byPhase[p.key].length > 0);

  return (
    <div className="card">
      <div className="card-head">
        <div className="title"><Icon name="trophy" size={16} /> BRACKET DO MATA-MATA</div>
        <div className="sub">{knockoutMatches.length} JOGOS · {phasesWithGames.length} FASES</div>
      </div>
      <div className="card-body" style={{ overflowX: 'auto' }}>
        <div className="bracket-grid" style={{ gridTemplateColumns: `repeat(${phasesWithGames.length}, minmax(180px, 1fr))` }}>
          {phasesWithGames.map(p => (
            <div key={p.key} className="bracket-col">
              <div className="bracket-col-head">{p.label}</div>
              {byPhase[p.key].map(m => {
                const r = results[m.id];
                const played = !!r;
                const winnerHome = played && r.gh > r.ga;
                const winnerAway = played && r.ga > r.gh;
                const isPlaceholderHome = String(m.home || '').includes('º G');
                const isPlaceholderAway = String(m.away || '').includes('º G');
                return (
                  <div key={m.id} className={'bracket-match ' + (played ? 'played' : '')}>
                    <div className="bracket-date">{m.date} · {m.time}</div>
                    <div className={'bracket-team ' + (winnerHome ? 'winner' : '') + (isPlaceholderHome ? ' slot' : '')}>
                      <TeamFlag flag={m.flagHome} size={16} />
                      <span className="bracket-team-name">{m.home}</span>
                      <span className="bracket-score">{played ? r.gh : '–'}</span>
                    </div>
                    <div className={'bracket-team ' + (winnerAway ? 'winner' : '') + (isPlaceholderAway ? ' slot' : '')}>
                      <TeamFlag flag={m.flagAway} size={16} />
                      <span className="bracket-team-name">{m.away}</span>
                      <span className="bracket-score">{played ? r.ga : '–'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function InicioView({ session, isAdmin, comments, onAdd, onDelete, remoteNews }) {
  // Se admin já configurou news pelo painel, usa elas. Senão, cai no array
  // hardcoded NEWS (que tem JSX no body). Posts do admin têm `body` como
  // string com quebras de linha — renderizamos via <NewsBodyText>.
  const usingRemote = Array.isArray(remoteNews) && remoteNews.length > 0;
  const newsToShow = usingRemote ? remoteNews : NEWS;
  return (
    <div className="inicio-feed">
      <div className="inicio-hero">
        <div className="inicio-hero-tag">FEED</div>
        <div className="inicio-hero-title">NOTÍCIAS DO PRIMITIVÃO</div>
        <div className="inicio-hero-sub">Atualizações, gols, momentos memoráveis e o estado do campeonato.</div>
      </div>
      {newsToShow.map(n => (
        <article key={n.id} className="news-card">
          <header className="news-card-head">
            <span className="news-tag">{n.tag}</span>
            <span className="news-date">{n.date}</span>
          </header>
          {n.image && (
            <div className="news-image-wrap">
              <img src={n.image} alt={n.title} className="news-image"
                   onError={(e) => { e.target.style.display = 'none'; }} />
            </div>
          )}
          <div className="news-body">
            <h2 className="news-title">{n.title}</h2>
            <p className="news-subtitle">{n.subtitle}</p>
            <div className="news-text">
              {typeof n.body === 'string' ? <NewsBodyText text={n.body} /> : n.body}
            </div>
          </div>
          <Comments
            newsId={n.id}
            list={Array.isArray((comments || {})[n.id]) ? comments[n.id] : []}
            sessionNick={session?.nick}
            isAdmin={isAdmin}
            onAdd={onAdd}
            onDelete={onDelete}
          />
        </article>
      ))}
      <div className="inicio-foot">
        Mais notícias chegando. Atualizações, melhores momentos e novidades dos campeonatos.
      </div>
    </div>
  );
}

// Renderiza corpo de notícia em texto + markdown leve. Suporta:
//   - parágrafos (separados por \n\n)
//   - listas: linhas começando com "- " viram <ul><li>
//   - bold: **texto** vira <strong>
//   - links: [texto](url) vira <a>
//   - auto-link: URLs cruas (http/https) viram <a> automaticamente
// Sem HTML cru — texto sanitizado pra evitar XSS via input do admin.
function renderInline(text) {
  const parts = [];
  let i = 0;
  // Ordem importa: markdown link primeiro, depois bold, depois URL crua.
  // URL crua: pega http(s)://... até espaço/quebra/fechamento de pontuação.
  const re = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s<>"`]+)/g;
  let m, last = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) {
      parts.push(<strong key={i++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('[')) {
      const linkM = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkM) parts.push(<a key={i++} href={linkM[2]} target="_blank" rel="noopener noreferrer">{linkM[1]}</a>);
    } else {
      // URL crua: remove pontuação no fim (.,;:) que normalmente não é parte da URL
      let url = tok;
      const trailingMatch = url.match(/[.,;:!?)]+$/);
      if (trailingMatch) url = url.slice(0, -trailingMatch[0].length);
      const tail = tok.slice(url.length);
      parts.push(<a key={i++} href={url} target="_blank" rel="noopener noreferrer">{url}</a>);
      if (tail) parts.push(tail);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function NewsBodyText({ text }) {
  if (!text) return null;
  const blocks = String(text).split(/\n\s*\n/);
  return blocks.map((block, bi) => {
    const lines = block.split('\n');
    const isList = lines.every(l => l.trim().startsWith('- '));
    if (isList && lines.length > 0) {
      return (
        <ul key={bi}>
          {lines.map((l, i) => (
            <li key={i}>{renderInline(l.replace(/^\s*-\s+/, ''))}</li>
          ))}
        </ul>
      );
    }
    // Lista numerada ("1. ... 2. ...") — ex: a classificação na notícia da rodada.
    const isNumList = lines.length > 0 && lines.every(l => /^\s*\d+\.\s/.test(l));
    if (isNumList) {
      return (
        <ol key={bi} className="news-ol">
          {lines.map((l, i) => (
            <li key={i}>{renderInline(l.replace(/^\s*\d+\.\s+/, ''))}</li>
          ))}
        </ol>
      );
    }
    return (
      <p key={bi}>
        {lines.map((ln, j, arr) => (
          <React.Fragment key={j}>
            {renderInline(ln)}
            {j < arr.length - 1 && <br />}
          </React.Fragment>
        ))}
      </p>
    );
  });
}

function Comments({ newsId, list, sessionNick, isAdmin, onAdd, onDelete }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const count = list.length;
  const sorted = list.slice().sort((a, b) => (b.at || 0) - (a.at || 0)); // mais recente primeiro

  const handleSend = async () => {
    if (busy) return;
    const clean = text.trim();
    if (!clean) return;
    setBusy(true); setErr('');
    try {
      await onAdd(newsId, clean);
      setText('');
    } catch (e) {
      setErr('Não consegui enviar. Tenta de novo.');
    } finally { setBusy(false); }
  };

  const handleDel = async (commentId) => {
    if (!confirm('Apagar esse comentário?')) return;
    try { await onDelete(newsId, commentId); }
    catch (e) { console.warn(e); }
  };

  return (
    <div className="comments-section">
      <button
        type="button"
        className="comments-toggle"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <Icon name="chat" size={14} /> {open ? 'OCULTAR COMENTÁRIOS' : 'VER COMENTÁRIOS'} · {count}
        <span className="comments-chev"><Icon name={open ? 'caret-up' : 'caret-down'} size={12} /></span>
      </button>
      {open && (
        <div className="comments-body">
          {sessionNick && (
            <div className="comment-form">
              <textarea
                className="comment-input"
                placeholder={`Comentar como @${sessionNick}…`}
                value={text}
                onChange={e => setText(e.target.value)}
                maxLength={500}
                rows={2}
                disabled={busy}
              />
              <div className="comment-form-row">
                <span className="comment-counter">{text.length}/500</span>
                <button
                  className="comment-send"
                  disabled={busy || !text.trim()}
                  onClick={handleSend}
                >
                  {busy ? 'ENVIANDO…' : 'ENVIAR'}
                </button>
              </div>
              {err && <div className="comment-err">{err}</div>}
            </div>
          )}
          {sorted.length === 0 && (
            <div className="comments-empty">
              Ninguém comentou ainda. Seja o primeiro <Icon name="target" size={13} />
            </div>
          )}
          {sorted.map(c => {
            const canDel = c.nick === sessionNick || isAdmin;
            const when = formatCommentTime(c.at);
            return (
              <div key={c.id} className="comment">
                <div className="comment-head">
                  <span className="comment-nick">@{c.nick}</span>
                  <span className="comment-when">{when}</span>
                  {canDel && (
                    <button
                      className="comment-del"
                      title="Apagar"
                      onClick={() => handleDel(c.id)}
                    ><Icon name="x" size={11} /></button>
                  )}
                </div>
                <div className="comment-text">{c.text}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatCommentTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1)   return 'agora';
  if (min < 60)  return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24)    return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7)     return `há ${d}d`;
  // mais de 7 dias: data
  const dt = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}`;
}

function ApostarView({ games, gamesById, bets, me, session, users, weeklyReady, weeklyIn, onClaim,
                        slip, onToggleLeg, onRemoveLeg, onClearSlip, onPlaceBet, isAdmin, canLock, slipPruneMsg,
                        onToggleLock, championship, setChampionship, interests }) {
  // Quem trava (admin/mod) vê todos os jogos abertos (inclusive travados, pra
  // poder destravar); jogador comum só vê os destravados. (Jogo travado não é
  // apostável por ninguém — vide GameRow.)
  const open = (games || [])
    .filter(g => canLock || !g.locked)
    .slice()
    .sort((a, b) => a.round - b.round || a.gi - b.gi);

  // Lista de rodadas com jogos em aberto (pra montar os chips de filtro).
  const allRoundsWithGames = Array.from(new Set(open.map(g => g.round))).sort((a, b) => a - b);
  const firstRound = allRoundsWithGames[0]; // "próxima rodada"

  // FILTRO: 'all' | 'mine' | 'rN'
  const [filter, setFilter] = useState('all');

  // No mobile o cupom vira um bottom-sheet que sobe por cima do conteúdo
  // (em vez de morar lá no fim da página). O FAB abre; handle/backdrop fecham.
  const [cupomOpen, setCupomOpen] = useState(false);

  // ROUND EXPANSION: por padrão SÓ a próxima rodada (firstRound) começa
  // expandida. Estado guarda override explícito (true/false) pra cada rodada.
  const [explicitExp, setExplicitExp] = useState({});
  const isExpanded = (rn) => (rn in explicitExp ? explicitExp[rn] : rn === firstRound);
  const toggleRound = (rn) => setExplicitExp(s => ({ ...s, [rn]: !isExpanded(rn) }));

  // Aplica filtro
  const filtered = (() => {
    if (filter === 'all') return open;
    if (filter === 'mine') return open.filter(g => slip.some(s => s.fixtureId === g.id));
    if (filter.startsWith('r')) {
      const r = +filter.slice(1);
      return open.filter(g => g.round === r);
    }
    return open;
  })();

  // Reagrupa filtrado por rodada
  const byRound = filtered.reduce((acc, g) => {
    (acc[g.round] = acc[g.round] || []).push(g);
    return acc;
  }, {});
  const rounds = Object.keys(byRound).map(Number).sort((a, b) => a - b);

  // Stats rápidas (sempre sobre todos os abertos, não filtrados)
  const totalGames = open.length;
  const lockedCount = (games || []).filter(g => g.locked).length;
  const myPicksInSlip = slip.length;
  const myGamesCount = open.filter(g => slip.some(s => s.fixtureId === g.id)).length;

  // Fecha o sheet com ESC (acessibilidade) quando aberto.
  useEffect(() => {
    if (!cupomOpen) return;
    const onEsc = (e) => { if (e.key === 'Escape') setCupomOpen(false); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [cupomOpen]);

  return (
    <div className="grid">
      <div>
        {/* (Banner do bônus migrou pro TopBar — fica visível em qualquer aba.) */}

        {/* Header unificado: RODADA atual + campeonato + troca (substitui as 6 abas) */}
        <ChampHeader
          value={championship}
          onChange={setChampionship}
          interests={interests || {}}
          activeOnly
          title={firstRound ? 'RODADA ' + String(firstRound).padStart(2, '0') : 'SEM JOGOS ABERTOS'}
          tag={firstRound ? 'ATUAL' : null}
          stats={totalGames > 0 ? (
            <>
              <span><strong>{totalGames}</strong> em aberto</span>
              <span>·</span>
              <span><strong>{allRoundsWithGames.length}</strong> rodada{allRoundsWithGames.length === 1 ? '' : 's'}</span>
              {!isAdmin && myPicksInSlip > 0 && (
                <>
                  <span>·</span>
                  <span style={{ color: 'var(--pv-orange)' }}><strong>{myPicksInSlip}</strong> palpite{myPicksInSlip === 1 ? '' : 's'} no cupom</span>
                </>
              )}
              {canLock && lockedCount > 0 && (
                <>
                  <span>·</span>
                  <span style={{ color: '#ff8a8a', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="lock" size={12} /> <strong>{lockedCount}</strong> travado{lockedCount === 1 ? '' : 's'}</span>
                </>
              )}
            </>
          ) : null}
        />

        {/* Chips de filtro */}
        {totalGames > 0 && (
          <div className="filter-chips">
            <button className={'chip ' + (filter === 'all' ? 'active' : '')} onClick={() => setFilter('all')}>
              TODOS · {totalGames}
            </button>
            {!isAdmin && (
              <button
                className={'chip ' + (filter === 'mine' ? 'active' : '')}
                onClick={() => setFilter('mine')}
                disabled={myGamesCount === 0}
              >
                MEUS PALPITES · {myGamesCount}
              </button>
            )}
            {allRoundsWithGames.map(r => (
              <button key={r}
                      className={'chip ' + (filter === 'r' + r ? 'active' : '') + (r === firstRound ? ' chip-next' : '')}
                      onClick={() => setFilter('r' + r)}>
                R{String(r).padStart(2, '0')}
                {r === firstRound && <span className="chip-next-tag">ATUAL</span>}
              </button>
            ))}
          </div>
        )}

        {/* Jogos agrupados por rodada (filtrados) */}
        {totalGames === 0 ? (
          <div className="card">
            <div className="card-body">
              <div className="empty">
                <div className="e1">SEM JOGOS</div>
                <div className="e2">Todos os jogos já foram finalizados ou ainda não há rodadas.</div>
              </div>
            </div>
          </div>
        ) : rounds.length === 0 ? (
          <div className="card">
            <div className="card-body">
              <div className="empty">
                <div className="e1">NADA POR AQUI</div>
                <div className="e2">Nenhum jogo bate com esse filtro.</div>
              </div>
            </div>
          </div>
        ) : (
          rounds.map(rn => {
            const expanded = isExpanded(rn);
            const isNext = rn === firstRound;
            return (
              <div key={rn} className={'card round-card' + (isNext ? ' round-card-next' : '')}>
                <button
                  type="button"
                  onClick={() => toggleRound(rn)}
                  className="round-card-head"
                  aria-expanded={expanded}
                >
                  <div>
                    <div className="title">
                      RODADA {String(rn).padStart(2, '0')}
                      {isNext && <span className="round-next-tag">ATUAL</span>}
                    </div>
                    <div className="sub">
                      {byRound[rn].length} JOGO{byRound[rn].length === 1 ? '' : 'S'}
                      {(() => {
                        const here = byRound[rn].filter(g => slip.some(s => s.fixtureId === g.id)).length;
                        if (here > 0) return ` · ${here} no cupom`;
                        return '';
                      })()}
                    </div>
                  </div>
                  <span className="round-chev"><Icon name={expanded ? 'caret-up' : 'caret-down'} size={12} /></span>
                </button>
                {expanded && (
                  <div className="card-body">
                    {byRound[rn].map(g => (
                      <GameRow key={g.id} game={g} slip={slip} onToggleLeg={onToggleLeg} canBet={!isAdmin}
                               canLock={canLock} onToggleLock={() => onToggleLock(g.ri, g.gi)} />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <aside className={'apostar-aside' + (cupomOpen ? ' cupom-open' : '')} id="cupom-anchor">
        {!isAdmin && (
          <div className="cupom-sticky">
            {/* Handle aparece só no modo bottom-sheet (mobile) — fecha o cupom. */}
            <button type="button" className="cupom-sheet-handle" onClick={() => setCupomOpen(false)}>
              <span className="cupom-sheet-grip" aria-hidden="true" />
              <span className="cupom-sheet-handle-label">FECHAR CUPOM</span>
              <Icon name="caret-down" size={14} />
            </button>
            <Cupom slip={slip} gamesById={gamesById} balance={me ? me.pc : 0} pruneMsg={slipPruneMsg}
                   onRemoveLeg={onRemoveLeg} onClearSlip={onClearSlip} onPlaceBet={onPlaceBet} />
          </div>
        )}
      </aside>

      {/* Backdrop do bottom-sheet (mobile): toca fora pra fechar. */}
      {!isAdmin && cupomOpen && (
        <button className="cupom-sheet-backdrop" type="button" aria-label="Fechar cupom"
                onClick={() => setCupomOpen(false)} />
      )}

      {/* FAB mobile: aparece quando há pernas no slip; abre o bottom-sheet do cupom. */}
      {!isAdmin && slip.length > 0 && !cupomOpen && (
        <button className="cupom-fab" onClick={() => setCupomOpen(true)} type="button">
          <Icon name="ticket" size={18} /> <span className="cupom-fab-num">{slip.length}</span>
          <span className="cupom-fab-label">VER CUPOM</span>
        </button>
      )}
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

function GameRow({ game, slip, onToggleLeg, canBet, canLock, onToggleLock }) {
  const h = TEAM(game.home), a = TEAM(game.away);
  const sel = (market, pick) => slip.some(s => s.fixtureId === game.id && s.market === market && s.pick === pick);
  const isLocked = !!game.locked;
  // Desabilita odds se: não pode apostar (admin), ou jogo travado.
  const dis = !canBet || isLocked;
  const o = game.odds || {};
  const legsHere = slip.filter(s => s.fixtureId === game.id).length;
  const [expanded, setExpanded] = useState(legsHere > 0);

  return (
    <div className={'fixture ' + (expanded ? 'expanded' : 'collapsed')}
         style={isLocked ? { opacity: 0.7, borderColor: '#7a2222' } : undefined}>
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%', background: 'transparent', border: 'none', padding: 0,
          textAlign: 'left', cursor: 'pointer', color: 'inherit', font: 'inherit',
        }}
      >
        <div className="fixture-top">
          <div className="fixture-tag">
            RODADA {String(game.round).padStart(2, '0')}
            {isLocked && (
              <span style={{ marginLeft: 8, color: '#c33', fontFamily: 'Space Grotesk', letterSpacing: '0.18em', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                · <Icon name="lock" size={11} /> TRAVADO
              </span>
            )}
          </div>
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
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <Icon name={expanded ? 'caret-up' : 'caret-down'} size={12} /> {expanded ? 'FECHAR PALPITES' : 'VER PALPITES'}
        </div>
      </button>

      {canLock && onToggleLock && (
        <div style={{ marginTop: 8, textAlign: 'right' }}>
          <button
            type="button"
            onClick={onToggleLock}
            style={{
              background: isLocked ? '#7a2222' : 'transparent',
              color: isLocked ? 'var(--pv-bone)' : 'var(--pv-charcoal)',
              border: '1.5px solid ' + (isLocked ? '#7a2222' : 'var(--pv-charcoal)'),
              padding: '6px 12px', fontWeight: 800, letterSpacing: '0.14em',
              fontSize: 10, cursor: 'pointer',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name={isLocked ? 'unlock' : 'lock'} size={11} /> {isLocked ? 'DESTRAVAR APOSTAS' : 'TRAVAR APOSTAS'}</span>
          </button>
        </div>
      )}

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
function Cupom({ slip, gamesById, balance, onRemoveLeg, onClearSlip, onPlaceBet, pruneMsg }) {
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
        {pruneMsg && (
          <div style={{
            padding: '8px 12px', background: 'rgba(215,100,20,0.15)',
            border: '1.5px solid var(--pv-orange)', marginBottom: 10,
            fontSize: 11, fontWeight: 700, color: 'var(--pv-charcoal)',
            letterSpacing: '0.04em', lineHeight: 1.4,
            display: 'flex', alignItems: 'flex-start', gap: 8,
          }}>
            <Icon name="warning" size={14} /> <span>{pruneMsg}</span>
          </div>
        )}

        {slip.length === 0 && (
          <div className="empty">
            <div className="e1">VAZIO</div>
            <div className="e2">Clica nas odds dos jogos pra montar. Vários palpites = aposta casada (odds somam). Dá pra combinar mais de um mercado do mesmo jogo (ex: 1X2 + ambos marcam).</div>
          </div>
        )}

        {legs.map(l => (
          <div key={l.fixtureId + l.market + l.pick} className="cupom-leg">
            <div className="cupom-leg-txt">
              <div className="cupom-leg-mkt">{MARKET_TITLE[l.market] || l.market}</div>
              {legLabel(l)}
            </div>
            <div className="cupom-leg-odd mono">{l.odds.toFixed(2)}</div>
            <button className="cupom-leg-x" onClick={() => onRemoveLeg(l.fixtureId)}><Icon name="x" size={12} /></button>
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
              <div style={{ fontSize: 10, letterSpacing: '0.12em', color: 'rgba(28,22,18,0.6)', fontWeight: 700, marginTop: 10, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <Icon name="warning" size={12} /> <span>APOSTA CASADA: precisa acertar TODOS os {slip.length} palpites pra ganhar.</span>
              </div>
            )}

            <div className="modal-btns">
              <button className="btn-secondary" onClick={onClearSlip} disabled={busy}>LIMPAR</button>
              <button className="btn-primary" disabled={!valid} onClick={handlePlace}>
                {busy ? 'APOSTANDO…' : `APOSTAR ${amt} PC`}
              </button>
            </div>
            <button
              type="button"
              className="cupom-share"
              onClick={async () => {
                const r = await shareSlip(slip);
                if (r.ok) {
                  showToast(r.method === 'share' ? 'Cupom compartilhado!' : 'Link copiado!', 'success');
                } else if (!r.aborted) {
                  showToast('Falha ao compartilhar: ' + (r.err || 'erro'), 'error');
                }
              }}
            >
              <Icon name="arrow-up-right" size={13} /> COMPARTILHAR CUPOM
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── MEUS TICKETS ───────────────────────────────────────────────────────────
function TicketsView({ bets, gamesById, cs, mkScores, onCancel }) {
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
          // Cancelar bloqueado se: já tem perna liquidada OU algum jogo do
          // cupom foi travado pelo admin (impede saída esperta antes da
          // bola rolar).
          const hasSettled = t.legs.some(l => !!l.result);
          const hasLocked  = t.legs.some(l => {
            if (typeof l.fixtureId === 'string' && l.fixtureId.indexOf('mk:') === 0) {
              return mkGameClosed((mkScores || {})[l.fixtureId.slice(3)]);
            }
            const g = resolveGame(l.fixtureId);
            return !!(g && g.locked);
          });
          const blocked = hasSettled || hasLocked;
          const multi = t.legs.length > 1;
          return (
            <div key={t.id} className={cls} style={{ gridTemplateColumns: '1fr auto' }}>
              <div>
                <div className="pick">
                  <small>{multi ? `CASADA · ${t.legs.length} PALPITES` : 'SIMPLES'} · @ {Number(t.combinedOdds).toFixed(2)}</small>
                  {t.legs.map((l, i) => {
                    const isMk = typeof l.fixtureId === 'string' && l.fixtureId.indexOf('mk:') === 0;
                    const f = isMk ? null : resolveGame(l.fixtureId);
                    const lg = { ...l, _fix: f };
                    const iconName = l.result === 'win' ? 'check' : l.result === 'lose' ? 'x' : null;
                    const iconColor = l.result === 'win' ? '#3a7d2a' : l.result === 'lose' ? '#c33' : 'rgba(28,22,18,0.5)';
                    const label = isMk
                      ? 'MK · @' + l.home + '×@' + l.away + ': ' + (MK_MARKET_TITLE[l.market] || l.market) + ' ' + mkPickLabel(l.market, l.pick)
                      : (f ? legLabel(lg) : '(jogo removido)');
                    return <div key={i} style={{ fontWeight: 700, fontSize: 13, marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
                      {iconName ? <span style={{ color: iconColor, display: 'inline-flex' }}><Icon name={iconName} size={12} /></span> : <span style={{ color: iconColor }}>•</span>}
                      <span>{label} <span style={{ color: 'var(--pv-orange)' }}>@{l.odds.toFixed(2)}</span></span>
                    </div>;
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
                {t.status === 'pending' && hasLocked && !hasSettled && (
                  <div style={{
                    marginTop: 8, fontSize: 9, letterSpacing: '0.16em', fontWeight: 800,
                    color: '#c33', lineHeight: 1.3, maxWidth: 110,
                    display: 'inline-flex', alignItems: 'flex-start', gap: 4,
                  }}>
                    <Icon name="lock" size={10} /> <span>JOGO TRAVADO<br />NÃO DÁ PRA CANCELAR</span>
                  </div>
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

// Retorna [{ champId, kind: 'champion'|'vice'|'terceiro'|'participou'|'penultimo'|'lanterna' }] pro nick dado.
function trophiesForNick(nick, cs, teamPlayers) {
  const playerTeam = reverseTeamMap(teamPlayers);
  const myTeam = playerTeam[nick];
  if (!myTeam) return [];
  const trophies = [];
  for (const c of CHAMPIONSHIPS) {
    const { status, standings } = computeChampStandings(c.id, cs);
    if (status !== 'closed' || !standings || standings.length < 2) continue;
    if (!standings.some(s => s.id === myTeam)) continue; // não jogou esta edição
    const last = standings.length - 1;
    if (standings[0].id === myTeam)        trophies.push({ champId: c.id, kind: 'champion' });
    else if (standings[1].id === myTeam)   trophies.push({ champId: c.id, kind: 'vice' });
    // 3º lugar (bronze) só conta se o pódio não encostar na lanterna/penúltimo (5+ times)
    else if (last > 3 && standings[2].id === myTeam) trophies.push({ champId: c.id, kind: 'terceiro' });
    else if (standings[last].id === myTeam)   trophies.push({ champId: c.id, kind: 'lanterna' });
    else if (standings[last - 1].id === myTeam) trophies.push({ champId: c.id, kind: 'penultimo' });
    else trophies.push({ champId: c.id, kind: 'participou' }); // jogou e ficou no meio
  }
  return trophies;
}

// REI DAS APOSTAS — um por SEASON de cada jogo (campeonato). Pra cada campeonato
// FECHADO, o rei é quem teve mais LUCRO (payout - aposta) nas apostas DAQUELE
// campeonato. Apostas antigas sem `champId` contam como FIFA (único com apostas
// até agora). Retorna [{ champId }] das seasons em que o nick foi o rei.
function betKingChamps(nick, cs, bets) {
  const out = [];
  for (const c of CHAMPIONSHIPS) {
    if (computeChampStandings(c.id, cs).status !== 'closed') continue;
    const profit = {};
    (bets || []).forEach(b => {
      if ((b.champId || 'fifa') !== c.id) return;
      if (b.status !== 'won' && b.status !== 'lost') return; // só apostas resolvidas
      const net = (b.status === 'won' ? (b.payout || 0) : 0) - (b.amount || 0);
      if (b.user === 'admin') return;
      profit[b.user] = (profit[b.user] || 0) + net;
    });
    const ranked = Object.entries(profit).sort((a, b) => b[1] - a[1]);
    if (ranked.length && ranked[0][0] === nick) out.push({ champId: c.id });
  }
  return out;
}

// Ranking de apostas de UMA season (champId): por LUCRO (retorno das ganhas menos
// a aposta das resolvidas). Pendentes contam só no nº de apostas. Apostas sem
// champId contam como FIFA. Cada season é independente — o "reset" é automático.
function seasonBettingRanking(champId, bets) {
  const stat = {};
  (bets || []).forEach(b => {
    if ((b.champId || 'fifa') !== champId) return;
    if (b.user === 'admin') return;
    const s = stat[b.user] || (stat[b.user] = { nick: b.user, apostas: 0, vit: 0, der: 0, pend: 0, stakeResolvido: 0, retorno: 0 });
    s.apostas++;
    if (b.status === 'won') { s.vit++; s.retorno += (b.payout || 0); s.stakeResolvido += (b.amount || 0); }
    else if (b.status === 'lost') { s.der++; s.stakeResolvido += (b.amount || 0); }
    else { s.pend++; }
  });
  return Object.values(stat)
    .map(s => ({ ...s, lucro: s.retorno - s.stakeResolvido }))
    .sort((a, b) => b.lucro - a.lucro || b.vit - a.vit || a.apostas - b.apostas);
}

// ─── HELPERS DE CONQUISTA (compartilhados por títulos e distintivos) ────────

// Posição do nick na classificação FECHADA da FIFA. null se não fechou ou
// nick sem time. { pos, total, isLast, isPenult }.
function champStandingPos(nick, cs, teamPlayers) {
  if (!cs) return null;
  const rounds = cs.rounds || [];
  const allDone = rounds.length > 0 && rounds.every(r => Array.isArray(r) && r.length > 0 && r.every(g => g.gh !== '' && g.ga !== ''));
  if (!allDone) return null;
  let tid = null;
  for (const [t, n] of Object.entries(teamPlayers || {})) {
    if (n && String(n).toLowerCase() === String(nick).toLowerCase()) { tid = t; break; }
  }
  if (!tid) return null;
  const st = computeStandings(rounds).slice().sort((a, b) => b.p - a.p || (b.gp - b.gc) - (a.gp - a.gc) || b.gp - a.gp);
  const idx = st.findIndex(s => s.id === tid);
  if (idx < 0) return null;
  return { pos: idx + 1, total: st.length, isLast: idx === st.length - 1, isPenult: idx === st.length - 2 };
}

// Maior sequência consecutiva de bets com `status` (won/lost) do nick.
function maxBetStreak(bets, nick, status) {
  const mine = (bets || [])
    .filter(b => b.user === nick && (b.status === 'won' || b.status === 'lost'))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  let max = 0, cur = 0;
  for (const b of mine) {
    if (b.status === status) { cur++; if (cur > max) max = cur; }
    else cur = 0;
  }
  return max;
}

// Quantos placares EXATOS (3 pts) o nick acertou no bolão da Copa.
function wcExactCount(nick, worldcup) {
  const picks = (worldcup && worldcup.picks && worldcup.picks[nick]) || {};
  const results = (worldcup && worldcup.results) || {};
  let n = 0;
  for (const fid of Object.keys(picks)) {
    if (results[fid] && scoreWcPick(results[fid], picks[fid]) === 3) n++;
  }
  return n;
}

const betsOf = (bets, nick) => (Array.isArray(bets) ? bets : []).filter(b => b.user === nick);

// Soma de TUDO que o nick já colocou em cupons (qualquer status). Mede volume.
const totalWagered = (bets, nick) => betsOf(bets, nick).reduce((s, b) => s + (Number(b.amount) || 0), 0);

// Status da primeira aposta JÁ RESOLVIDA (won/lost) do nick, por createdAt. null se nenhuma.
function firstSettledStatus(bets, nick) {
  const m = betsOf(bets, nick)
    .filter(b => b.status === 'won' || b.status === 'lost')
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return m.length > 0 ? m[0].status : null;
}

// ─── CRITÉRIOS DE CONQUISTA (fonte única) ───────────────────────────────────
// Cada predicado recebe ctx { nick, bets, users, teamPlayers, cs, worldcup }.
// Títulos E distintivos referenciam DAQUI — assim o critério vive num só
// lugar. Mudar "100k" pra outro valor = mudar 1 linha (não 2+).
const ACH = {
  betaTester:  ({ nick, teamPlayers }) => Object.values(teamPlayers || {}).map(s => String(s).toLowerCase()).includes(String(nick).toLowerCase()),
  highRoller:  ({ nick, bets }) => betsOf(bets, nick).some(b => Number(b.amount) >= 100000),
  brokeBank:   ({ nick, bets }) => betsOf(bets, nick).some(b => Number(b.amount) >= 100000 && b.status === 'won'),
  burned100k:  ({ nick, bets }) => betsOf(bets, nick).some(b => Number(b.amount) >= 100000 && b.status === 'lost'),
  champion:    ({ nick, cs, teamPlayers }) => { const p = champStandingPos(nick, cs, teamPlayers); return !!p && p.pos === 1; },
  vice:        ({ nick, cs, teamPlayers }) => { const p = champStandingPos(nick, cs, teamPlayers); return !!p && p.pos === 2; },
  lanterna:    ({ nick, cs, teamPlayers }) => { const p = champStandingPos(nick, cs, teamPlayers); return !!p && p.isLast; },
  penultimo:   ({ nick, cs, teamPlayers }) => { const p = champStandingPos(nick, cs, teamPlayers); return !!p && p.isPenult; },
  millionaire: ({ nick, users }) => ((users || {})[nick]?.pc || 0) >= 100000,
  broke:       ({ nick, users, bets }) => ((users || {})[nick]?.pc || 0) <= 0 && betsOf(bets, nick).length >= 3,
  grinder50:   ({ nick, bets }) => betsOf(bets, nick).length >= 50,
  addict100:   ({ nick, bets }) => betsOf(bets, nick).length >= 100,
  prophet:     ({ nick, bets }) => betsOf(bets, nick).some(b => b.status === 'won' && Number(b.combinedOdds) >= 20),
  parlayKing:  ({ nick, bets }) => betsOf(bets, nick).some(b => b.status === 'won' && Array.isArray(b.legs) && b.legs.length >= 5),
  hotHand:     ({ nick, bets }) => maxBetStreak(bets, nick, 'won') >= 5,
  coldFoot:    ({ nick, bets }) => maxBetStreak(bets, nick, 'lost') >= 5,
  copaPlayer:  ({ nick, worldcup }) => Object.keys((worldcup && worldcup.picks && worldcup.picks[nick]) || {}).length >= 1,
  copaSeer:    ({ nick, worldcup }) => wcExactCount(nick, worldcup) >= 1,
  copaOracle:  ({ nick, worldcup }) => wcExactCount(nick, worldcup) >= 5,
  underdog:    ({ nick, bets }) => betsOf(bets, nick).some(b => b.status === 'won' && Array.isArray(b.legs) && b.legs.length === 1 && Number(b.combinedOdds) >= 5),
  luckyStart:  ({ nick, bets }) => firstSettledStatus(bets, nick) === 'won',
  whale:       ({ nick, bets }) => totalWagered(bets, nick) >= 1000000,
  allIn:       ({ nick, bets }) => betsOf(bets, nick).some(b => Array.isArray(b.legs) && b.legs.length >= 8),
  collector:   (ctx) => effectiveInventory(ctx.nick, (ctx.users || {})[ctx.nick], ctx).length >= 5,
  ironStreak:  ({ nick, bets }) => maxBetStreak(bets, nick, 'won') >= 10,
  cursed:      ({ nick, bets }) => maxBetStreak(bets, nick, 'lost') >= 10,
};

// ─── TÍTULOS DO USUÁRIO ─────────────────────────────────────────────────────
// Título = LABEL DE TEXTO ao lado do nick (o user escolhe 1 pra exibir).
// Cada um tem check(ctx) com ctx = { nick, bets, users, teamPlayers, cs, worldcup }.
const TITLE_DEFS = [
  // ── Participação / campeonato ──
  { id: 'beta_tester', name: 'BETA TESTER', icon: 'flask', color: '#7a4dc9',
    desc: 'Jogou a primeira temporada do Primitivão (FIFA 2026 Season 1).', check: ACH.betaTester },
  { id: 'campeao', name: 'CAMPEÃO', icon: 'trophy', color: '#d4af37',
    desc: 'Terminou uma temporada da FIFA em PRIMEIRO lugar. Leva o troféu pra casa.', check: ACH.champion },
  { id: 'vice', name: 'VICE-CAMPEÃO', icon: 'medal', color: '#9a9a9a',
    desc: 'Terminou em SEGUNDO. A medalha de prata — tão perto, tão longe.', check: ACH.vice },
  { id: 'penultimo', name: 'PENÚLTIMO', icon: 'toothbrush', color: '#6b4423',
    desc: 'Terminou em PENÚLTIMO. Escapou da lanterna por um fio — mas o gostinho é quase o mesmo.', check: ACH.penultimo },
  { id: 'lanterna', name: 'LANTERNA', icon: 'toilet', color: '#7a2222',
    desc: 'Terminou a temporada em ÚLTIMO. Vexame carimbado.', check: ACH.lanterna },
  // ── Apostas: valor ──
  { id: 'high_roller', name: 'HIGH ROLLER', icon: 'coin', color: '#c9a227',
    desc: 'Apostou 100.000 PC ou mais num único cupom. Coragem (ou loucura).', check: ACH.highRoller },
  { id: 'high_roller_win', name: 'QUEBROU A BANCA', icon: 'coin-stack', color: '#2a8f3f',
    desc: 'Apostou 100k+ PC E venceu. A casa chorou.', check: ACH.brokeBank },
  { id: 'high_roller_loss', name: 'QUEIMOU 100K', icon: 'coin-fire', color: '#c33',
    desc: 'Apostou 100k+ PC E perdeu. Adeus, dinheirinho.', check: ACH.burned100k },
  { id: 'milionario', name: 'MILIONÁRIO', icon: 'coin', color: '#d4af37',
    desc: 'Acumulou 100.000 PC ou mais no saldo. Banca gorda.', check: ACH.millionaire },
  { id: 'falido', name: 'FALIDO', icon: 'coin-fire', color: '#7a2222',
    desc: 'Zerou o saldo. Já apostou de tudo, hoje só resta o bônus de segunda.', check: ACH.broke },
  // ── Apostas: volume / skill ──
  { id: 'apostador_plantao', name: 'APOSTADOR DE PLANTÃO', icon: 'ticket', color: '#d76414',
    desc: 'Fez 50 apostas ou mais. Não perde uma rodada.', check: ACH.grinder50 },
  { id: 'viciado', name: 'VICIADO EM PC', icon: 'dice', color: '#a8324f',
    desc: 'Fez 100 apostas ou mais. Procura ajuda (depois da próxima).', check: ACH.addict100 },
  { id: 'profeta', name: 'PROFETA DAS ODDS', icon: 'target', color: '#3a78c2',
    desc: 'Venceu uma aposta com odd combinada de 20x ou mais. Vidência pura.', check: ACH.prophet },
  { id: 'casadinha', name: 'REI DA CASADINHA', icon: 'chart', color: '#2a8f3f',
    desc: 'Venceu uma aposta casada com 5 palpites ou mais. Tudo ou nada.', check: ACH.parlayKing },
  { id: 'mao_quente', name: 'MÃO QUENTE', icon: 'fire', color: '#d76414',
    desc: 'Venceu 5 apostas seguidas. Tá pegando fogo, bicho.', check: ACH.hotHand },
  { id: 'invencivel', name: 'INVENCÍVEL', icon: 'bolt', color: '#c9a227',
    desc: 'Venceu 10 apostas SEGUIDAS. Intocável — ninguém segura.', check: ACH.ironStreak },
  { id: 'pe_frio', name: 'PÉ FRIO', icon: 'skull', color: '#5a5a5a',
    desc: 'Perdeu 5 apostas seguidas. O VARIMITIVÃO tá de olho.', check: ACH.coldFoot },
  { id: 'amaldicoado', name: 'AMALDIÇOADO', icon: 'skull', color: '#3e0f0f',
    desc: 'Perdeu 10 apostas SEGUIDAS. O VARIMITIVÃO lavou as mãos.', check: ACH.cursed },
  { id: 'azarao', name: 'AZARÃO', icon: 'arrow-up-right', color: '#2a8f3f',
    desc: 'Venceu uma aposta simples com odd 5x ou mais. Ninguém dava nada por ele.', check: ACH.underdog },
  { id: 'sorte_novato', name: 'SORTE DE NOVATO', icon: 'sparkle', color: '#c9a227',
    desc: 'Venceu a PRIMEIRA aposta da vida no Primitivão. Começou voando.', check: ACH.luckyStart },
  { id: 'tubarao', name: 'TUBARÃO', icon: 'coin-stack', color: '#2a6f8f',
    desc: 'Movimentou 1.000.000 PC somando todos os cupons. Peixe grande do mercado.', check: ACH.whale },
  { id: 'tudo_ou_nada', name: 'TUDO OU NADA', icon: 'bolt', color: '#a8324f',
    desc: 'Montou uma casada com 8 palpites ou mais. Coragem (ou teimosia) de sobra.', check: ACH.allIn },
  { id: 'colecionador', name: 'COLECIONADOR', icon: 'gift', color: '#7a4dc9',
    desc: 'Desbloqueou 5 itens cosméticos ou mais. Vaidoso assumido.', check: ACH.collector },
  // ── Copa do Mundo ──
  { id: 'vidente_copa', name: 'VIDENTE DA COPA', icon: 'globe', color: '#1c7a6e',
    desc: 'Acertou um placar EXATO no bolão da Copa do Mundo (3 pts).', check: ACH.copaSeer },
  { id: 'oraculo_copa', name: 'ORÁCULO DA COPA', icon: 'eye', color: '#1c7a6e',
    desc: 'Acertou 5 placares EXATOS no bolão da Copa. Não é palpite, é dom.', check: ACH.copaOracle },
];
// ─── ITEMS COSMÉTICOS (LOJA) ────────────────────────────────────────────────
// MVP: 2 slots (frame + badge). Cada item tem 1 dos modos:
//   - price (number)  → comprável com PC na loja
//   - drop  (fn(ctx)) → desbloqueia automaticamente quando condição é true
// Os 2 modos são mutuamente exclusivos: ou compra ou ganha por conquista.
const ITEMS = [
  // ── MOLDURAS ──
  {
    id: 'frame-bronze',
    slot: 'frame',
    name: 'Moldura Bronze',
    desc: 'Pra começar com estilo.',
    icon: 'shield',
    color: '#b87333',
    rarity: 'comum',
    price: 200,
  },
  {
    id: 'frame-silver',
    slot: 'frame',
    name: 'Moldura Prata',
    desc: 'Discreta, elegante, com pegada.',
    icon: 'shield',
    color: '#a8a8a8',
    rarity: 'rara',
    price: 700,
  },
  {
    id: 'frame-gold',
    slot: 'frame',
    name: 'Moldura Ouro',
    desc: 'Reservada pra quem termina a temporada em 1º lugar.',
    icon: 'trophy',
    color: '#d4af37',
    rarity: 'lendaria',
    drop: ACH.champion,
  },
  { id: 'frame-vinho',    slot: 'frame', name: 'Moldura Vinho',    desc: 'Anel de espinhos pra quem joga sujo (com estilo).',   icon: 'shield', color: '#a52a2a', rarity: 'rara',     price: 500 },
  { id: 'frame-mint',     slot: 'frame', name: 'Moldura Louro',    desc: 'Folhas de louro — clássico de vencedor.',             icon: 'shield', color: '#2a8f3f', rarity: 'rara',     price: 600 },
  { id: 'frame-diamante', slot: 'frame', name: 'Moldura Diamante', desc: 'Cristal puro. Pra quem tem PC sobrando pra ostentar.', icon: 'sparkle', color: '#5ec8e3', rarity: 'lendaria', price: 2500 },
  { id: 'frame-fatality', slot: 'frame', name: 'Moldura Fatality', desc: 'Anel de sangue e chamas. Só pro campeão do Mortal Kombat.', icon: 'sword', color: '#8a1f1f', rarity: 'lendaria', drop: () => false },
  // ── DISTINTIVOS COMPRÁVEIS (cosmético puro — só PC) ──
  { id: 'badge-bola',    slot: 'badge', name: 'Bola de Ouro',   desc: 'A clássica. Pra quem respira futebol.',        icon: 'football', color: '#d76414', rarity: 'comum', price: 150 },
  { id: 'badge-dado',    slot: 'badge', name: 'Dado da Sorte',  desc: 'Que a sorte (e as odds) estejam com você.',    icon: 'dice',     color: '#a8324f', rarity: 'comum', price: 200 },
  { id: 'badge-coracao', slot: 'badge', name: 'Coração Fiel',   desc: 'Pro torcedor raiz que nunca abandona.',        icon: 'heart',    color: '#c0392b', rarity: 'comum', price: 200 },
  { id: 'badge-caveira', slot: 'badge', name: 'Caveira',        desc: 'Pros que apostam sem medo da morte (do saldo).', icon: 'skull',  color: '#3e3e3e', rarity: 'comum', price: 250 },
  { id: 'badge-fogo',    slot: 'badge', name: 'Chama',          desc: 'Tá pegando fogo? Carrega no peito.',            icon: 'fire',     color: '#e8540f', rarity: 'comum', price: 250 },
  { id: 'badge-raio',    slot: 'badge', name: 'Raio',           desc: 'Energia pura. Rápido no gatilho do cupom.',     icon: 'bolt',     color: '#e3b94d', rarity: 'rara',  price: 350 },
  { id: 'badge-estrela', slot: 'badge', name: 'Estrela',        desc: 'Brilha mais que o resto. Ou acha que brilha.',  icon: 'star',     color: '#d4af37', rarity: 'rara',  price: 400 },
  { id: 'badge-foguete', slot: 'badge', name: 'Foguete',        desc: 'Pra quem tá em ascensão na tabela.',            icon: 'rocket',   color: '#3a78c2', rarity: 'rara',  price: 500 },
  { id: 'badge-controle', slot: 'badge', name: 'Joystick',      desc: 'Gamer raiz. Vive de controle na mão.',          icon: 'gamepad',  color: '#6b4c9a', rarity: 'comum', price: 300 },
  { id: 'badge-espada',   slot: 'badge', name: 'Espadachim',    desc: 'Pros que vão pra cima sem medo.',               icon: 'sword',    color: '#7a2222', rarity: 'rara',  price: 450 },
  { id: 'badge-floco',    slot: 'badge', name: 'Sangue Frio',   desc: 'Aposta alto sem suar. Gelo na veia.',           icon: 'snowflake', color: '#5ec8e3', rarity: 'rara',  price: 450 },
  { id: 'badge-apito',    slot: 'badge', name: 'Apito do VAR',  desc: 'Comissão do VARIMITIVÃO de plantão. 666 PC, claro.', icon: 'whistle', color: '#1c1612', rarity: 'rara',  price: 666 },
  { id: 'badge-coroa',    slot: 'badge', name: 'Coroa de Ouro', desc: 'Ostentação pura. Vale uma grana, mas vale a pose.', icon: 'crown',   color: '#d4af37', rarity: 'lendaria', price: 1200 },

  // ── DISTINTIVOS DE CONQUISTA (drop automático) ──
  {
    id: 'badge-beta', slot: 'badge', name: 'Beta Tester', icon: 'flask', color: '#7a4dc9', rarity: 'comum',
    desc: 'Estava aqui na primeira temporada (FIFA Season 1).',
    drop: ACH.betaTester,
  },
  {
    id: 'badge-high-roller', slot: 'badge', name: 'High Roller', icon: 'coin', color: '#c9a227', rarity: 'rara',
    desc: 'Apostou 100.000 PC ou mais num cupom.',
    drop: ACH.highRoller,
  },
  {
    id: 'badge-quebrou', slot: 'badge', name: 'Quebrou a Banca', icon: 'coin-stack', color: '#2a8f3f', rarity: 'lendaria',
    desc: 'Apostou 100k+ E venceu. Lenda viva.',
    drop: ACH.brokeBank,
  },
  {
    id: 'badge-campeao', slot: 'badge', name: 'Troféu do Campeão', icon: 'trophy', color: '#d4af37', rarity: 'lendaria',
    desc: 'Foi CAMPEÃO de uma temporada da FIFA. O troféu de ouro, pra ostentar.',
    drop: ACH.champion,
  },
  {
    id: 'badge-penultimo', slot: 'badge', name: 'Escova Solitária', icon: 'toothbrush', color: '#6b4423', rarity: 'lendaria',
    desc: 'Foi PENÚLTIMO. A privada foi pro vizinho, sobrou a escova da vergonha.',
    drop: ACH.penultimo,
  },
  {
    id: 'badge-lanterna', slot: 'badge', name: 'Selo da Vergonha', icon: 'toilet', color: '#7a2222', rarity: 'lendaria',
    desc: 'Terminou em ÚLTIMO. Carrega a privada com (des)orgulho.',
    drop: ACH.lanterna,
  },
  {
    id: 'badge-copa', slot: 'badge', name: 'Bolão da Copa', icon: 'globe', color: '#1c7a6e', rarity: 'comum',
    desc: 'Palpitou em pelo menos um jogo da Copa do Mundo.',
    drop: ACH.copaPlayer,
  },
  {
    id: 'badge-vidente', slot: 'badge', name: 'Vidente da Copa', icon: 'target', color: '#3a78c2', rarity: 'rara',
    desc: 'Acertou um placar EXATO no bolão da Copa.',
    drop: ACH.copaSeer,
  },
  {
    id: 'badge-fatality', slot: 'badge', name: 'Fatality Master', icon: 'sword', color: '#8a1f1f', rarity: 'lendaria',
    desc: 'Campeão do torneio de Mortal Kombat. (Edição 01 chegando.)',
    // Drop ainda não dispara — sistema de MK não tem dados. Fica "vindo aí".
    drop: () => false,
  },
  {
    id: 'badge-vice', slot: 'badge', name: 'Vice-Campeão', icon: 'medal', color: '#9a9a9a', rarity: 'rara',
    desc: 'Terminou em 2º na FIFA. O eterno quase.',
    drop: ACH.vice,
  },
  {
    id: 'badge-milionario', slot: 'badge', name: 'Milionário', icon: 'coin', color: '#d4af37', rarity: 'rara',
    desc: 'Acumulou 100.000 PC ou mais. Banca gorda.',
    drop: ACH.millionaire,
  },
  {
    id: 'badge-mao-quente', slot: 'badge', name: 'Mão Quente', icon: 'fire', color: '#d76414', rarity: 'rara',
    desc: 'Venceu 5 apostas seguidas. Tá pegando fogo.',
    drop: ACH.hotHand,
  },
  {
    id: 'badge-profeta', slot: 'badge', name: 'Profeta', icon: 'target', color: '#3a78c2', rarity: 'rara',
    desc: 'Venceu uma aposta com odd 20x ou mais. Vidência pura.',
    drop: ACH.prophet,
  },
  {
    id: 'badge-azarao', slot: 'badge', name: 'Azarão', icon: 'arrow-up-right', color: '#2a8f3f', rarity: 'rara',
    desc: 'Venceu uma simples com odd 5x ou mais. Zebra confirmada.',
    drop: ACH.underdog,
  },
  {
    id: 'badge-novato', slot: 'badge', name: 'Sorte de Novato', icon: 'sparkle', color: '#c9a227', rarity: 'comum',
    desc: 'Venceu a primeira aposta da vida no Primitivão.',
    drop: ACH.luckyStart,
  },
  {
    id: 'badge-tubarao', slot: 'badge', name: 'Tubarão', icon: 'coin-stack', color: '#2a6f8f', rarity: 'lendaria',
    desc: 'Movimentou 1.000.000 PC somando todos os cupons.',
    drop: ACH.whale,
  },
  {
    id: 'badge-tudo-ou-nada', slot: 'badge', name: 'Tudo ou Nada', icon: 'bolt', color: '#a8324f', rarity: 'rara',
    desc: 'Montou uma casada com 8 palpites ou mais.',
    drop: ACH.allIn,
  },
  {
    id: 'badge-oraculo', slot: 'badge', name: 'Oráculo da Copa', icon: 'eye', color: '#1c7a6e', rarity: 'lendaria',
    desc: 'Acertou 5 placares EXATOS no bolão da Copa.',
    drop: ACH.copaOracle,
  },
];

const ITEM_BY_ID = Object.fromEntries(ITEMS.map(i => [i.id, i]));
const ITEM_SLOTS = [
  { id: 'frame',  label: 'MOLDURA',    short: 'frame' },
  { id: 'badge',  label: 'DISTINTIVO', short: 'badge' },
];

// Retorna items dropados automaticamente pra esse nick (excluindo os com price).
function itemsDroppedFor(nick, ctx) {
  return ITEMS.filter(i => i.drop && (() => {
    try { return !!i.drop({ nick, ...ctx }); } catch (_) { return false; }
  })());
}

// Inventário efetivo = comprados (inventory) ∪ drops LATCHED (earnedDrops) ∪
// drops ao vivo. CONQUISTAS SÃO PERMANENTES: uma vez que um drop foi
// conquistado e gravado em earnedDrops, ele nunca some — mesmo que a condição
// ao vivo deixe de valer (ex: temporada resetada). Assim badges de campeão/
// vice/lanterna não piscam. O latch (efeito no App) é quem grava earnedDrops.
function effectiveInventory(nick, userRecord, ctx) {
  const bought = Array.isArray(userRecord?.inventory) ? userRecord.inventory : [];
  const earned = Array.isArray(userRecord?.earnedDrops) ? userRecord.earnedDrops : [];
  const drops  = itemsDroppedFor(nick, ctx).map(i => i.id);
  return Array.from(new Set([...bought, ...earned, ...drops]));
}

// Títulos do nick = LATCHED (earnedTitles, permanentes) ∪ os que valem ao vivo.
// Uma vez conquistado, o título nunca some (FALIDO/MILIONÁRIO não piscam mais
// com o PC) — e como o CC é derivado da CONTAGEM de títulos, o CC para de cair
// por flicker. O latch (efeito no App) grava earnedTitles quando um novo passa.
function titlesForNick(nick, ctx) {
  const u = (((ctx && ctx.users) || {})[nick]) || {};
  const persisted = new Set(Array.isArray(u.earnedTitles) ? u.earnedTitles : []);
  return TITLE_DEFS.filter(t => {
    if (persisted.has(t.id)) return true;
    try { return !!t.check({ nick, ...ctx }); }
    catch (_) { return false; }
  });
}
function getTitleDef(id) {
  return TITLE_DEFS.find(t => t.id === id) || null;
}

// ── CAMPEÃO COINS (CC) — moeda da loja, RARA e de mérito ────────────────────
// Saldo DERIVADO (não some ao gastar): saldo = ganho + bônus_admin - gasto.
// GANHO vem de mérito: cada TÍTULO conquistado + cada CAMPEONATO em que o cara
// participou (inscrição). Valores propositalmente altos vs preços da loja —
// CC é pra ser raro. Ajuste as 2 constantes abaixo pra calibrar a economia.
const CC_PER_TITLE = 100;          // por título conquistado
const CC_PER_PARTICIPATION = 25;   // por campeonato em que participou (inscrito)
function ccEarnedFor(nick, ctx) {
  if (!nick) return 0;
  let earned = 0;
  try { earned += titlesForNick(nick, ctx || {}).length * CC_PER_TITLE; } catch (_) {}
  const interests = (ctx && ctx.interests) || {};
  for (const cid of Object.keys(interests)) {
    const m = interests[cid];
    if (m && m[nick]) earned += CC_PER_PARTICIPATION;
  }
  return earned;
}
// Saldo gastável de CC. `ccBonus` = ajuste manual do admin; `ccSpent` = total
// gasto na loja (transacional no buyItem). Nunca negativo.
function ccBalanceFor(nick, user, ctx) {
  return Math.max(0, ccEarnedFor(nick, ctx) + ((user && user.ccBonus) || 0) - ((user && user.ccSpent) || 0));
}

// Badge compacto pra renderizar em standings/ranking ao lado de nomes.
function TitleBadge({ titleId, size }) {
  const t = getTitleDef(titleId);
  if (!t) return null;
  const big = size === 'lg';
  return (
    <span title={t.desc} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: big ? '3px 8px' : '2px 6px',
      background: t.color + '22',
      border: `1px solid ${t.color}`,
      fontSize: big ? 10 : 9,
      fontWeight: 800,
      letterSpacing: '0.08em',
      color: t.color,
      marginLeft: 6,
      verticalAlign: 'middle',
      whiteSpace: 'nowrap',
      lineHeight: 1.2,
    }}>
      <Icon name={t.icon} size={big ? 13 : 11} /> {t.name}
    </span>
  );
}

// Coleção do jogador no perfil: molduras + distintivos que ele JÁ TEM
// (comprados ou dropados), com botão pra equipar/tirar direto daqui.
function ColecaoCard({ nick, me, previewTeamId, ctx, onEquip }) {
  const [busy, setBusy] = useState({});
  const inv = useMemo(() => effectiveInventory(nick, me, ctx), [nick, me, ctx]);
  const owned = inv.map(id => ITEM_BY_ID[id]).filter(Boolean);
  const frames = owned.filter(i => i.slot === 'frame');
  const badges = owned.filter(i => i.slot === 'badge');
  const equipped = me?.cosmetics || {};

  const handleEquip = async (item, equip) => {
    if (busy[item.id] || !onEquip) return;
    setBusy(b => ({ ...b, [item.id]: true }));
    try {
      await onEquip(item.slot, equip ? item.id : null);
      showToast(equip ? `Equipou ${item.name}` : `Tirou ${item.name}`, 'success');
    } finally {
      setBusy(b => { const n = { ...b }; delete n[item.id]; return n; });
    }
  };

  const renderItem = (item) => {
    const isEquipped = equipped[item.slot] === item.id;
    return (
      <div key={item.id} className={'colecao-item rarity-' + item.rarity + (isEquipped ? ' equipped' : '')}>
        <Avatar teamId={previewTeamId} nick={nick} cosmetics={{ [item.slot]: item.id }} size={item.slot === 'frame' ? 56 : 48} />
        <div className="colecao-item-name" style={{ color: item.color }}>{item.name}</div>
        <button
          className={'colecao-equip ' + (isEquipped ? 'on' : '')}
          disabled={!!busy[item.id]}
          onClick={() => handleEquip(item, !isEquipped)}
        >
          {busy[item.id] ? '…' : (isEquipped ? <><Icon name="check" size={11} /> EQUIPADO</> : 'EQUIPAR')}
        </button>
      </div>
    );
  };

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head">
        <div className="title"><Icon name="star" size={16} /> MINHA COLEÇÃO</div>
        <div className="sub">{owned.length} ITEM{owned.length === 1 ? '' : 'S'} DESBLOQUEADO{owned.length === 1 ? '' : 'S'}</div>
      </div>
      <div className="card-body">
        {owned.length === 0 ? (
          <div className="empty">
            <div className="e1">COLEÇÃO VAZIA</div>
            <div className="e2">Compre molduras e distintivos no MERCADINHO, ou desbloqueie por conquista. Eles aparecem aqui pra equipar.</div>
          </div>
        ) : (
          <>
            {frames.length > 0 && (
              <>
                <div className="small-label" style={{ marginTop: 0 }}>MOLDURAS ({frames.length})</div>
                <div className="colecao-grid">{frames.map(renderItem)}</div>
              </>
            )}
            {badges.length > 0 && (
              <>
                <div className="small-label" style={{ marginTop: 14 }}>DISTINTIVOS ({badges.length})</div>
                <div className="colecao-grid">{badges.map(renderItem)}</div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// "Portrait" fake do lutador: monograma (iniciais) + cor própria por personagem
// (hue estável via hash do nome) — dá o ar de "character select" sem precisar de
// imagem real de cada boneco.
function mkMono(name) {
  const w = String(name).split(/[\s-]+/).filter(Boolean);
  return (w.length > 1 ? (w[0][0] + w[1][0]) : String(name).slice(0, 2)).toUpperCase();
}
function mkHue(name) {
  let h = 0;
  for (let i = 0; i < String(name).length; i++) h = (h * 31 + String(name).charCodeAt(i)) % 360;
  return h;
}
// Lado do confronto (mandante OU visitante) com os 3 bonecos como portraits
// clicáveis. `cur` = escolhido nessa partida; `taken` = travado (usado na outra).
function MkFighterPick({ nick, chars, cur, taken, onPick, teamPlayers }) {
  return (
    <div className="mk-fc-side">
      <div className="mk-fc-nick"><Avatar nick={nick} teamPlayers={teamPlayers} size={18} noBadge /> @{nick}</div>
      {chars.length === 0 ? (
        <div className="mk-fc-noelenco">sem elenco</div>
      ) : (
        <div className="mk-fc-chips">
          {chars.map(c => {
            const on = c === cur;
            const locked = c === taken && c !== cur;
            return (
              <button key={c} type="button" className={'mk-fc-chip' + (on ? ' on' : '') + (locked ? ' locked' : '')}
                disabled={locked} onClick={() => onPick(on ? '' : c)} title={locked ? c + ' (em uso na outra partida)' : c}>
                <span className="mk-fc-mono" style={{ '--hue': mkHue(c) }}>{mkMono(c)}</span>
                <span className="mk-fc-cname">{c}</span>
                {on && <span className="mk-fc-badge pick"><Icon name="check" size={9} /></span>}
                {locked && <span className="mk-fc-badge lock"><Icon name="lock" size={8} /></span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
// Lado read-only (visitante): mostra só o boneco escalado pelo mandante.
function MkFighterShow({ nick, char, teamPlayers }) {
  return (
    <div className="mk-fc-side ro">
      <div className="mk-fc-nick"><Avatar nick={nick} teamPlayers={teamPlayers} size={18} noBadge /> @{nick}</div>
      {char ? (
        <div className="mk-fc-chosen">
          <span className="mk-fc-mono" style={{ '--hue': mkHue(char) }}>{mkMono(char)}</span>
          <span className="mk-fc-cname">{char}</span>
        </div>
      ) : <div className="mk-fc-noelenco">a definir</div>}
    </div>
  );
}

// ─── MEU JOGO (MK) — elenco do turno + escalação dos confrontos ────────────
// O MANDANTE escala as 2 partidas dos jogos onde é mando (boneco dos DOIS lados,
// vindo do elenco de 3 de cada um). O VISITANTE só vê como o mandante dispôs.
function MeuJogoView({ nick, isAdmin, users, interests, onSave, draw, scores, lineups, onSlot, teamPlayers }) {
  const inscritos = Object.keys((interests && interests.mk) || {}).sort();
  const [target, setTarget] = useState(isAdmin ? (inscritos[0] || '') : nick);
  const [sel, setSel] = useState(((users || {})[isAdmin ? (inscritos[0] || '') : nick] || {}).mkChars || []);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setSel(((users || {})[target] || {}).mkChars || []); }, [target, users]);

  const isInscrito = !!(((interests && interests.mk) || {})[target]);
  const charsFor = (n) => ((users || {})[n] || {}).mkChars || [];
  const toggle = (c) => setSel(prev => prev.includes(c) ? prev.filter(x => x !== c) : (prev.length >= MK_MAX_CHARS ? prev : [...prev, c]));
  const save = async () => {
    if (busy || !target) return;
    setBusy(true);
    try { await onSave(target, sel); showToast('Elenco salvo pra @' + target + '!', 'success'); }
    catch (e) { showToast('Falha ao salvar.', 'error'); }
    finally { setBusy(false); }
  };

  // Só a RODADA ATUAL: a 1ª ainda não concluída cuja anterior já fechou (tudo
  // fechado -> última). Mesma regra da aba APOSTAS.
  const gKey = (r, gi) => r.phase + '-' + r.n + '-' + gi;
  const roundConcluded = (ri) => !!(draw && draw[ri]) && draw[ri].games.every((g, gi) => !!mkMatchOutcome((scores || {})[gKey(draw[ri], gi)] || {}));
  let curRoundIdx = -1;
  if (draw && draw.length) {
    curRoundIdx = draw.findIndex((r, ri) => !roundConcluded(ri) && (ri === 0 || roundConcluded(ri - 1)));
    if (curRoundIdx < 0) curRoundIdx = draw.length - 1;
  }
  const curRound = curRoundIdx >= 0 ? draw[curRoundIdx] : null;
  const myGames = [];
  if (curRound && target) {
    curRound.games.forEach((g, gi) => {
      if (g.home === target || g.away === target) {
        myGames.push({ key: gKey(curRound, gi), phase: curRound.phase, n: curRound.n, g, mandante: g.home === target });
      }
    });
  }
  // Atualiza um slot da escalação (mandante). lineups[key] = { p1:{home,away}, p2:{home,away} }
  const setSlot = (key, part, side, val) => onSlot(key, part, side, val);

  return (
    <div className="card mk-card" style={{ marginBottom: 14 }}>
      <div className="card-head">
        <div className="title"><Icon name="fist" size={16} /> MEU JOGO · MORTAL KOMBAT</div>
        <div className="sub">ELENCO DO TURNO + ESCALAÇÃO DOS SEUS CONFRONTOS</div>
      </div>
      <div className="card-body">
        {isAdmin && (
          <label className="tp-fld" style={{ maxWidth: 260, marginBottom: 12 }}>
            <span className="tp-fld-label">Testar como (jogador inscrito no MK)</span>
            <select value={target} onChange={e => setTarget(e.target.value)} className="tp-input tp-select">
              {inscritos.length === 0 && <option value="">— ninguém inscrito —</option>}
              {inscritos.map(n => <option key={n} value={n}>@{n}</option>)}
            </select>
          </label>
        )}
        {!isInscrito ? (
          <div className="empty">
            <div className="e1">SEM INSCRIÇÃO NO MK</div>
            <div className="e2">{isAdmin ? 'Esse jogador não está inscrito no MK.' : 'Você não está inscrito no Mortal Kombat. Inscreva-se na aba CAMPEONATOS.'}</div>
          </div>
        ) : (
          <>
            {/* ELENCO DO TURNO (3 fixos) */}
            <div className="mk-jogo-sec">
              <div className="mk-jogo-sec-h"><Icon name="user" size={13} /> MEU ELENCO DO TURNO <span className="mk-jogo-sec-c">{sel.length}/{MK_MAX_CHARS}</span></div>
              <p className="mk-jogo-hint">Seus <strong>{MK_MAX_CHARS} personagens fixos</strong> do turno. Dá pra trocar antes da VOLTA e do MATA-MATA. O mandante escala esses bonecos nas partidas.</p>
              <div className="mk-roster">
                {MK_CHARACTERS.map(c => {
                  const on = sel.includes(c);
                  return (
                    <button key={c} type="button" className={'mk-char' + (on ? ' on' : '')} onClick={() => toggle(c)} title={c}>
                      {on && <span className="mk-char-slot">{sel.indexOf(c) + 1}</span>}
                      <span className="mk-char-ic"><Icon name={on ? 'fist' : 'user'} size={18} /></span>
                      <span className="mk-char-name">{c}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mk-foot">
                <div className="mk-selected">{sel.length}/{MK_MAX_CHARS} escolhidos{sel.length ? ': ' + sel.join(' · ') : ''}</div>
                <button className="tp-btn-go" onClick={save} disabled={busy || sel.length === 0}>{busy ? 'SALVANDO…' : 'SALVAR ELENCO'}</button>
              </div>
            </div>

            {/* MEU JOGO DA RODADA ATUAL (escalação do confronto) */}
            <div className="mk-jogo-sec">
              <div className="mk-jogo-sec-h"><Icon name="skull" size={13} /> MEU JOGO DA RODADA {curRound && <span className="mk-jogo-sec-c">{String(curRound.n).padStart(2, '0')} · {curRound.phase}</span>}</div>
              {!draw ? (
                <div className="mk-jogo-empty"><Icon name="dice" size={20} /> As rodadas ainda não foram sorteadas. {isAdmin ? 'Sorteie em CAMPEONATOS.' : 'Aguarde o sorteio.'}</div>
              ) : myGames.length === 0 ? (
                <div className="mk-jogo-empty">@{target} não joga na rodada atual (folga).</div>
              ) : (
                <div className="mk-jogo-list">
                  {myGames.map(mg => {
                    const opp = mg.mandante ? mg.g.away : mg.g.home;
                    const lu = lineups[mg.key] || {};
                    const homeChars = charsFor(mg.g.home);
                    const awayChars = charsFor(mg.g.away);
                    const arranged = ['p1', 'p2'].some(p => (lu[p] || {}).home || (lu[p] || {}).away);
                    return (
                      <div key={mg.key} className={'mk-jogo-card' + (mg.mandante ? ' is-mandante' : '')}>
                        <div className="mk-jogo-card-h">
                          <span className="mk-jogo-rod">RODADA {String(mg.n).padStart(2, '0')} · {mg.phase}</span>
                          <span className={'mk-jogo-role ' + (mg.mandante ? 'mandante' : 'visitante')}>{mg.mandante ? 'VOCÊ É MANDANTE' : 'VOCÊ É VISITANTE'}</span>
                        </div>
                        <div className="mk-jogo-vs">
                          <span className="mk-jogo-vs-side"><Avatar nick={target} teamPlayers={teamPlayers} size={22} noBadge /> @{target}</span>
                          <span className="mk-jogo-vs-x">×</span>
                          <span className="mk-jogo-vs-side opp">@{opp} <Avatar nick={opp} teamPlayers={teamPlayers} size={22} noBadge /></span>
                        </div>

                        {mg.mandante ? (
                          <div className="mk-jogo-arr">
                            <div className="mk-jogo-arr-hint"><Icon name="fist" size={11} /> Monta o CARD DE LUTA — escolhe o boneco dos dois lados em cada partida.</div>
                            {homeChars.length === 0 && (
                              <div className="mk-jogo-warn">Escolhe teu elenco acima pra poder escalar.</div>
                            )}
                            <div className="mk-fc">
                              {['p1', 'p2'].map((p, pi) => {
                                // mesmo jogador não repete boneco nas 2 partidas: trava o
                                // que já foi usado na outra partida do mesmo lado.
                                const oP = p === 'p1' ? 'p2' : 'p1';
                                const takenH = (lu[oP] || {}).home, takenA = (lu[oP] || {}).away;
                                const curH = (lu[p] || {}).home, curA = (lu[p] || {}).away;
                                return (
                                  <div key={p} className="mk-fc-part">
                                    <div className="mk-fc-part-h"><span className="mk-fc-num">{pi + 1}</span> PARTIDA {pi + 1}</div>
                                    <div className="mk-fc-row">
                                      <MkFighterPick nick={mg.g.home} chars={homeChars} cur={curH} taken={takenH} teamPlayers={teamPlayers} onPick={c => setSlot(mg.key, p, 'home', c)} />
                                      <div className="mk-fc-vs"><Icon name="skull" size={13} /><span>VS</span></div>
                                      <MkFighterPick nick={mg.g.away} chars={awayChars} cur={curA} taken={takenA} teamPlayers={teamPlayers} onPick={c => setSlot(mg.key, p, 'away', c)} />
                                    </div>
                                  </div>
                                );
                              })}
                              {(() => {
                                const filled = ['p1', 'p2'].reduce((nn, p) => nn + ((lu[p] || {}).home ? 1 : 0) + ((lu[p] || {}).away ? 1 : 0), 0);
                                return filled === 4
                                  ? <div className="mk-fc-ready"><Icon name="skull" size={13} /> ESCALAÇÃO PRONTA — FIGHT!</div>
                                  : <div className="mk-fc-todo">Escala os 2 lados das 2 partidas · <strong>{filled}/4</strong></div>;
                              })()}
                            </div>
                          </div>
                        ) : (
                          <div className="mk-jogo-arr ro">
                            <div className="mk-jogo-arr-hint"><Icon name="eye" size={11} /> @{mg.g.home} (mandante) monta o card — você só vê.</div>
                            <div className="mk-fc ro">
                              {arranged ? ['p1', 'p2'].map((p, pi) => {
                                const h = (lu[p] || {}).home, a = (lu[p] || {}).away;
                                return (
                                  <div key={p} className="mk-fc-part">
                                    <div className="mk-fc-part-h"><span className="mk-fc-num">{pi + 1}</span> PARTIDA {pi + 1}</div>
                                    <div className="mk-fc-row">
                                      <MkFighterShow nick={mg.g.home} char={h} teamPlayers={teamPlayers} />
                                      <div className="mk-fc-vs"><Icon name="skull" size={13} /><span>VS</span></div>
                                      <MkFighterShow nick={mg.g.away} char={a} teamPlayers={teamPlayers} />
                                    </div>
                                  </div>
                                );
                              }) : (
                                <div className="mk-fc-wait"><Icon name="refresh" size={13} /> Aguardando @{mg.g.home} montar o card de luta.</div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// CAMPEONATOS -> MK pro ADMIN: classificação (8 primeiros com borda colorida)
// + sorteio das rodadas (ida/volta). Só admin enxerga por enquanto — inscrições
// ainda estão abertas, então o sorteio é provisório (regera no clique, não grava).
// Abertura do MK: palco de jazz escuro + refletor, cortinas de veludo vermelho
// abrindo e revelando o wordmark "MORTAL KOMBAT". Toca uma vez (1ª entrada na
// aba); clicar pula. Respeita prefers-reduced-motion. onDone desmonta/marca visto.
function MkCurtainOpening({ onDone }) {
  const [phase, setPhase] = useState('closed'); // closed -> opening -> done
  const doneRef = useRef(false);
  const finish = () => { if (doneRef.current) return; doneRef.current = true; onDone(); };
  useEffect(() => {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { finish(); return; }
    const t1 = setTimeout(() => setPhase('opening'), 420);  // batida antes de abrir
    const t2 = setTimeout(() => setPhase('done'), 3300);    // começa o fade-out
    const t3 = setTimeout(finish, 4000);                    // desmonta
    return () => { [t1, t2, t3].forEach(clearTimeout); };
  }, []);
  return (
    <div className={'mk-curtain mk-curtain-' + phase} onClick={finish} role="presentation">
      <div className="mk-stage">
        <div className="mk-spotlight" />
        <div className="mk-stage-floor" />
        <div className="mk-stage-title">
          <div className="mk-stage-eyebrow">PRIMITIVÃO APRESENTA</div>
          <div className="mk-stage-wordmark">MORTAL KOMBAT</div>
          <div className="mk-stage-sub">SEASON 1 <span className="mk-stage-dot">·</span> FIGHT!</div>
        </div>
      </div>
      <div className="mk-curtain-panel mk-curtain-left" />
      <div className="mk-curtain-panel mk-curtain-right" />
      <div className="mk-valance" />
      <div className="mk-curtain-skip">clique pra pular</div>
    </div>
  );
}

const MK_CURTAIN_KEY = 'mk_curtain_seen';

function MkChampionshipView({ players, users, teamPlayers, draw, onPublishDraw, scores, onScore, isAdmin, isMod, locked }) {
  // draw/scores vêm do App (persistidos no doc de apostas, campo `mk`).
  const [viewRound, setViewRound] = useState(0);
  const [curtain, setCurtain] = useState(() => {
    try { return !localStorage.getItem(MK_CURTAIN_KEY); } catch (e) { return false; }
  });
  const closeCurtain = () => { try { localStorage.setItem(MK_CURTAIN_KEY, '1'); } catch (e) {} setCurtain(false); };
  const replayCurtain = () => { try { localStorage.removeItem(MK_CURTAIN_KEY); } catch (e) {} setCurtain(true); };
  const insc = (players || []).slice().sort();

  // ADMIN sorteia e PUBLICA o chaveamento. Se já existe, confirma (zera placares).
  const doDraw = () => {
    if (draw && !window.confirm('Refazer o chaveamento? Isso ZERA todos os placares lançados e as apostas seguem valendo no novo confronto. Confirma?')) return;
    onPublishDraw(generateMkDraw(shuffleArr(insc)));
    setViewRound(0);
  };
  const gKey = (r, gi) => r.phase + '-' + r.n + '-' + gi;
  const setScore = (key, side, val) => {
    const v = val.replace(/[^0-2]/g, '').slice(0, 1); // 1 dígito, 0..2 (primeiro a 2)
    onScore(key, { [side]: v });
  };
  const setFinisher = (key, which, val) => onScore(key, { [which]: val || undefined });
  const toggleFlawless = (key) => onScore(key, { flawless: !(scores[key] || {}).flawless });

  // Resultados lançados -> confrontos -> classificação (recalcula ao vivo).
  const matches = draw ? draw.flatMap(r => r.games.map((g, gi) => ({ home: g.home, away: g.away, sc: scores[gKey(r, gi)] || {} }))) : [];
  const playedCount = matches.filter(m => mkMatchOutcome(m.sc)).length;
  const standings = computeMkStandings(insc, matches);
  const charsFor = (nick) => ((users || {})[nick] || {}).mkChars || [];
  const curRound = draw ? draw[viewRound] : null;

  return (
    <div className="mk-champ">
      {curtain && <MkCurtainOpening onDone={closeCurtain} />}
      <div className="grid mk-grid">
      <div className="card mk-card">
        <div className="card-head">
          <div className="title"><Icon name="skull" size={16} /> CLASSIFICAÇÃO · MORTAL KOMBAT</div>
          <div className="sub">{insc.length} INSCRITOS · TOP 8 VAI PRO MATA-MATA</div>
        </div>
        <div className="card-body">
          {isMod ? (
            <div className="mk-admin-row">
              <div className="mk-admin-note"><Icon name="shield" size={12} /> {isAdmin ? 'ADMIN — sorteie o chaveamento e lance os placares.' : 'MODERADOR — lance os placares dos confrontos.'} {locked ? 'Inscrições fechadas.' : (isAdmin ? 'Sortear FECHA as inscrições.' : '')}</div>
              <div className="mk-admin-actions">
                <button type="button" className="mk-replay" onClick={replayCurtain}><Icon name="refresh" size={12} /> REVER ABERTURA</button>
              </div>
            </div>
          ) : (
            <div className="mk-admin-note" style={{ width: '100%', marginBottom: 12 }}><Icon name="skull" size={12} /> Classificação oficial — atualiza sozinha conforme os placares saem.</div>
          )}
          {insc.length === 0 ? (
            <div className="empty"><div className="e1">SEM INSCRITOS</div><div className="e2">Ninguém inscrito no MK ainda.</div></div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="std-table mk-std-table">
                <thead>
                  <tr><th>#</th><th style={{ textAlign: 'left' }}>JOGADOR</th><th>J</th><th>V</th><th>E</th><th>D</th><th>SR</th><th>P</th></tr>
                </thead>
                <tbody>
                  {standings.map((s, i) => {
                    const sr = s.rp - s.rc;
                    const top8 = i < 8;
                    const col = top8 ? MK_TOP8_COLORS[i] : undefined;
                    const chars = charsFor(s.nick);
                    return (
                      <tr key={s.nick} className={top8 ? 'mk-top8' : 'mk-out'}>
                        <td className="std-pos mk-pos-cell" style={top8 ? { borderLeftColor: col, color: col } : undefined}>{String(i + 1).padStart(2, '0')}</td>
                        <td>
                          <div className="tnm" style={{ flexWrap: 'wrap' }}>
                            <Avatar nick={s.nick} teamPlayers={teamPlayers} size={24} />
                            <span>@{s.nick}</span>
                            {chars.length > 0 && <span className="mk-row-chars">{chars.join(' · ')}</span>}
                          </div>
                        </td>
                        <td>{s.j}</td><td style={{ fontWeight: 800 }}>{s.v}</td><td>{s.e}</td>
                        <td style={{ color: 'rgba(28,22,18,0.45)' }}>{s.d}</td>
                        <td>{sr > 0 ? '+' + sr : sr}</td>
                        <td style={{ fontFamily: 'Bagel Fat One, Impact', fontSize: 16 }}>{s.p}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="mk-legend">
            <strong>SR</strong> = saldo de rounds. Confronto = <strong>2 partidas</strong> (cada uma primeiro a 2 rounds). Resultado: 2×0 vence, <strong>1×1 empata</strong>, 0×2 perde. Vitória 3, empate 1.
            <br /><strong>Todo mundo passa de fase</strong> — o que muda é por onde entra no mata-mata: <strong>1º e 2º</strong> são cabeças de chave (entram uma fase à frente), do <strong>3º ao 8º</strong> entram privilegiados e do <strong>9º pra baixo</strong> sem vantagem. <span style={{ opacity: 0.8 }}>(Pódio 1º–3º com cor própria; 4º–8º na mesma cor.)</span>
          </div>
        </div>
      </div>

      <aside>
      <div className="card mk-card mk-rodada-card">
        <div className="card-head">
          <div className="title">{draw && curRound ? 'RODADA ' + String(curRound.n).padStart(2, '0') : 'RODADAS'}</div>
          <div className="sub">{draw && curRound ? (curRound.phase === 'IDA' ? 'IDA' : 'VOLTA') : (isAdmin ? 'SORTEAR' : 'AGUARDANDO')}</div>
        </div>
        <div className="card-body">
          {!draw || !curRound ? (
            <div className="mk-sorteio-empty">
              <div className="mk-sorteio-ic"><Icon name="dice" size={30} /></div>
              {isAdmin ? (<>
                <p>Sorteia o chaveamento <strong>todos contra todos</strong> (ida e volta). Isso <strong>fecha as inscrições</strong> e fixa os confrontos pra todo mundo. A classificação recalcula conforme os placares saem.</p>
                <button className="tp-btn-go" onClick={doDraw} disabled={insc.length < 2}>
                  <Icon name="dice" size={15} /> SORTEAR E PUBLICAR
                </button>
                <div className="mk-sorteio-foot">{insc.length} inscritos.</div>
              </>) : (
                <p>O chaveamento ainda não foi sorteado. Assim que o admin publicar, os seus confrontos aparecem aqui.</p>
              )}
            </div>
          ) : (
            <>
              <div className="mk-rnav">
                <button className="mk-rnav-btn" onClick={() => setViewRound(v => Math.max(0, v - 1))} disabled={viewRound === 0} aria-label="Rodada anterior">
                  <Icon name="chevron-left" size={18} />
                </button>
                <div className="mk-rnav-mid">
                  <div className="mk-rnav-phase">{curRound.phase === 'IDA' ? 'TURNO · IDA' : 'RETURNO · VOLTA'}</div>
                  <div className="mk-rnav-count">{viewRound + 1} <span>/ {draw.length}</span></div>
                </div>
                <button className="mk-rnav-btn" onClick={() => setViewRound(v => Math.min(draw.length - 1, v + 1))} disabled={viewRound === draw.length - 1} aria-label="Próxima rodada">
                  <Icon name="chevron-right" size={18} />
                </button>
              </div>
              <div className="mk-fixtures">
                {curRound.games.map((g, gi) => {
                  const k = gKey(curRound, gi);
                  const sc = scores[k] || {};
                  const done = !!mkMatchOutcome(sc);
                  const hc = charsFor(g.home), ac = charsFor(g.away);
                  return (
                    <div key={gi} className={'mk-fx' + (done ? ' done' : '')}>
                      <div className="mk-fx-top">
                        <span>JOGO {String(gi + 1).padStart(2, '0')}</span>
                        {done && <span className="mk-fx-done"><Icon name="check" size={11} /> LANÇADO</span>}
                      </div>
                      <div className="mk-fx-body">
                        <div className="mk-fx-side home">
                          <Avatar nick={g.home} teamPlayers={teamPlayers} size={28} noBadge />
                          <div className="mk-fx-id">
                            <div className="mk-fx-nick">@{g.home}</div>
                            <div className="mk-fx-role mandante">MANDANTE</div>
                          </div>
                        </div>
                        <div className="mk-fx-score mk-fx-score2">
                          <div className="mk-fx-partida">
                            <span className="mk-fx-pl">P1</span>
                            <input className="cscore-in" value={sc.p1h || ''} placeholder="–" inputMode="numeric" maxLength={1} disabled={!isMod} onChange={e => setScore(k, 'p1h', e.target.value)} />
                            <span className="mk-fx-x">×</span>
                            <input className="cscore-in" value={sc.p1a || ''} placeholder="–" inputMode="numeric" maxLength={1} disabled={!isMod} onChange={e => setScore(k, 'p1a', e.target.value)} />
                          </div>
                          <div className="mk-fx-partida">
                            <span className="mk-fx-pl">P2</span>
                            <input className="cscore-in" value={sc.p2h || ''} placeholder="–" inputMode="numeric" maxLength={1} disabled={!isMod} onChange={e => setScore(k, 'p2h', e.target.value)} />
                            <span className="mk-fx-x">×</span>
                            <input className="cscore-in" value={sc.p2a || ''} placeholder="–" inputMode="numeric" maxLength={1} disabled={!isMod} onChange={e => setScore(k, 'p2a', e.target.value)} />
                          </div>
                        </div>
                        <div className="mk-fx-side away">
                          <Avatar nick={g.away} teamPlayers={teamPlayers} size={28} noBadge />
                          <div className="mk-fx-id">
                            <div className="mk-fx-nick">@{g.away}</div>
                            <div className="mk-fx-role visitante">VISITANTE</div>
                          </div>
                        </div>
                      </div>
                      {isMod && (
                        <div className="mk-fx-finish">
                          <span className="mk-fx-finish-l"><Icon name="skull" size={10} /> FINALIZAÇÕES <span className="mk-fx-finish-adm">só admin</span></span>
                          <span className="mk-fx-finish-pl">P1</span>
                          <select className="mk-fx-finish-sel" value={sc.finisher1 || ''} onChange={e => setFinisher(k, 'finisher1', e.target.value)}>
                            <option value="">Nenhuma</option>
                            {MK_FINISHERS.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                          </select>
                          <span className="mk-fx-finish-pl">P2</span>
                          <select className="mk-fx-finish-sel" value={sc.finisher2 || ''} onChange={e => setFinisher(k, 'finisher2', e.target.value)}>
                            <option value="">Nenhuma</option>
                            {MK_FINISHERS.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                          </select>
                          <button type="button" className={'mk-brut-tog' + (sc.flawless ? ' on' : '')} onClick={() => toggleFlawless(k)} title="Teve flawless victory?">
                            <Icon name="star" size={10} /> FLAWLESS
                          </button>
                        </div>
                      )}
                      {(hc.length > 0 || ac.length > 0) && (
                        <div className="mk-fx-chars">
                          <span className="mk-fx-ch home">
                            <Icon name="fist" size={9} />
                            <span className={'mk-fx-ch-n' + (hc.length ? '' : ' empty')}>{hc.length ? hc.join(' · ') : 'a escolher'}</span>
                          </span>
                          <span className="mk-fx-ch away">
                            <span className={'mk-fx-ch-n' + (ac.length ? '' : ' empty')}>{ac.length ? ac.join(' · ') : 'a escolher'}</span>
                            <Icon name="fist" size={9} />
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mk-sorteio-bar">
                <span>{matches.length} jogos · {playedCount} lançados</span>
                {isAdmin && <button className="mk-resort" onClick={doDraw}><Icon name="refresh" size={12} /> SORTEAR DE NOVO</button>}
              </div>
            </>
          )}
        </div>
      </div>
      </aside>
      </div>
    </div>
  );
}

// APOSTAS do MK (aba APOSTAS, admin por enquanto). Lê o sorteio/resultados
// compartilhados (App). Cupom = palpites da MESMA rodada (2+ = casada). Só dá
// pra apostar na rodada ABERTA (a anterior tem que ter fechado).
function mkLegLabel(l) { return mkPickLabel(l.market, l.pick); }
function MkBettingView({ players, users, teamPlayers, draw, scores, lineups, bets, onPlaceBet, onRemoveBet, onSetGameLock, myNick, isAdmin, isMod, balance }) {
  const insc = (players || []).slice().sort();
  const gKey = (r, gi) => r.phase + '-' + r.n + '-' + gi;
  const skey = (phase, n, gi) => phase + '-' + n + '-' + gi;
  const roundConcluded = (ri) => !!(draw && draw[ri]) && draw[ri].games.every((g, gi) => !!mkMatchOutcome((scores || {})[gKey(draw[ri], gi)] || {}));
  // Rodada ABERTA pra aposta: 1ª ainda não fechada cuja anterior já fechou.
  const bettableIdx = draw ? draw.findIndex((r, ri) => !roundConcluded(ri) && (ri === 0 || roundConcluded(ri - 1))) : -1;
  const [betRound, setBetRound] = useState(0);
  const [cupom, setCupom] = useState([]);
  const [stake, setStake] = useState(10);
  // #8: dois modos de apostador. SIMPLES (padrão) mostra só o VENCEDOR (quem
  // ganha o confronto) — menos informação pro apostador casual. AVANÇADO abre
  // todos os mercados (placares por partida, total de rounds, finalização,
  // flawless). A escolha fica salva no localStorage.
  const [betMode, setBetMode] = useState(() => {
    try { return localStorage.getItem('mk_bet_mode') === 'avancado' ? 'avancado' : 'simples'; } catch (_) { return 'simples'; }
  });
  const chooseBetMode = (m) => {
    setBetMode(m);
    try { localStorage.setItem('mk_bet_mode', m); } catch (_) {}
    // Ao entrar no SIMPLES, tira do cupom os palpites de mercados avançados que
    // somem da tela — senão ficariam "fantasmas" (visíveis só no cupom).
    if (m === 'simples') setCupom(prev => prev.filter(l => l.market === 'VENC'));
  };
  const visibleMarkets = betMode === 'avancado' ? MK_MARKETS : MK_MARKETS.filter(m => m === 'VENC');
  useEffect(() => { if (bettableIdx >= 0) { setBetRound(bettableIdx); setCupom([]); } }, [bettableIdx]);
  // Relógio que tica de 1 em 1s pro cronômetro de fechamento (#4): faz a contagem
  // regressiva andar e fecha o jogo sozinho quando lockAt vence. Só tica se há
  // algum cronômetro ativo — senão fica parado pra não re-renderizar à toa.
  const [now, setNow] = useState(() => Date.now());
  const anyCountdown = Object.values(scores || {}).some(s => s && s.lockAt && !s.locked && s.lockAt > now);
  useEffect(() => {
    if (!anyCountdown) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyCountdown]);
  const fmtSecs = (s) => Math.floor(Math.max(0, s) / 60) + ':' + String(Math.max(0, s) % 60).padStart(2, '0');

  const oddsMatches = draw ? draw.flatMap((r, ri) => roundConcluded(ri)
    ? r.games.map((g, gi) => ({ home: g.home, away: g.away, sc: (scores || {})[gKey(r, gi)] || {} }))
    : []) : [];
  const metrics = computeMkPlayerMetrics(insc, oddsMatches);
  const rd = draw ? draw[Math.min(betRound, draw.length - 1)] : null;
  const isOpen = !!rd && betRound === bettableIdx;

  const legKey = (gi, market) => (rd ? rd.phase + '-' + rd.n + '-' + gi + '-' + market : '');
  const pickInCupom = (gi, market, pick) => cupom.some(l => l.key === legKey(gi, market) && l.pick === pick);
  const toggleLeg = (gi, g, market, pick, odd) => {
    if (!isOpen) return;
    if (myNick && (g.home === myNick || g.away === myNick)) { showToast('Você não pode apostar no próprio jogo.', 'error'); return; }
    if (mkGameClosed((scores || {})[gKey(rd, gi)], now)) { showToast('As apostas desse jogo estão travadas.', 'error'); return; }
    const key = legKey(gi, market);
    const ex = cupom.find(l => l.key === key);
    if (ex && ex.pick === pick) { setCupom(prev => prev.filter(l => l.key !== key)); return; } // desmarca
    const newLeg = { key, roundN: rd.n, phase: rd.phase, gi, home: g.home, away: g.away, market, pick, odd };
    // não dá pra casar palpites que se contradizem NO MESMO jogo (ex: vitória do
    // mandante + placar onde o visitante ganha).
    const conflict = cupom.find(l => l.key !== key && l.phase === rd.phase && l.roundN === rd.n && l.gi === gi && mkLegsContradict(l, newLeg));
    if (conflict) {
      showToast('Contradiz "' + MK_MARKET_TITLE[conflict.market] + ': ' + mkPickLabel(conflict.market, conflict.pick) + '" do mesmo jogo.', 'error');
      return;
    }
    setCupom(prev => [...prev.filter(l => l.key !== key), newLeg]);
  };
  const combined = cupom.reduce((p, l) => p + l.odd, 0); // SOMA, igual à FIFA
  const isCasada = cupom.length >= 2;
  const place = async () => {
    if (!isOpen || !cupom.length || !(stake > 0)) return;
    const res = await onPlaceBet({
      nick: myNick, roundN: rd.n, phase: rd.phase,
      legs: cupom.map(({ key, ...l }) => l), stake, combined: +combined.toFixed(2), casada: isCasada,
    });
    if (res && res.err) return; // erro já avisado por toast
    setCupom([]);
    showToast((isCasada ? 'Casada' : 'Aposta') + ' feita! ' + stake + ' PC', 'success');
  };
  const betStatus = (bet) => {
    let pending = false;
    for (const l of (bet.legs || [])) {
      const sc = (scores || {})[skey(l.phase, l.roundN, l.gi)] || {};
      const r = mkLegResult(l.market, l.pick, sc, { finisher1: sc.finisher1, finisher2: sc.finisher2, flawless: sc.flawless });
      if (r === 'lose') return 'lost';
      if (r !== 'win') pending = true;
    }
    return pending ? 'pending' : 'won';
  };

  return (
    <div className="card mk-card mk-betting">
      <div className="card-head">
        <div className="title"><Icon name="coin" size={16} /> APOSTAS · MORTAL KOMBAT</div>
        <div className="sub">ODDS AUTOMÁTICAS</div>
      </div>
      <div className="card-body">
        {!draw || !rd ? (
          <div className="empty"><div className="e1">SEM SORTEIO AINDA</div><div className="e2">O admin sorteia as rodadas em CAMPEONATOS → MK. Aí as odds aparecem aqui.</div></div>
        ) : (
          <>
            <div className="mk-admin-note" style={{ marginBottom: 12 }}><Icon name="coin" size={11} /> Valendo <strong>PC</strong> · só na rodada <strong>aberta</strong> · você não aposta no próprio jogo.</div>
            <div className="mk-bet-layout">
              <div className="mk-bet-main">
                <div className="mk-rnav mk-bet-nav">
                  <button className="mk-rnav-btn" onClick={() => setBetRound(v => Math.max(0, v - 1))} disabled={betRound === 0} aria-label="Rodada anterior"><Icon name="chevron-left" size={18} /></button>
                  <div className="mk-rnav-mid">
                    <div className="mk-rnav-phase">RODADA {rd.n} · {rd.phase} {isOpen ? '· ABERTA' : ''}</div>
                    <div className="mk-rnav-count">{betRound + 1} <span>/ {draw.length}</span></div>
                  </div>
                  <button className="mk-rnav-btn" onClick={() => setBetRound(v => Math.min(draw.length - 1, v + 1))} disabled={betRound === draw.length - 1} aria-label="Próxima rodada"><Icon name="chevron-right" size={18} /></button>
                </div>
                {/* #8: modo do apostador — SIMPLES (só quem vence) x AVANÇADO (tudo) */}
                <div className="mk-bet-mode" role="tablist" aria-label="Modo de aposta">
                  <div className="mk-bet-mode-tabs">
                    <button type="button" role="tab" aria-selected={betMode === 'simples'}
                      className={'mk-bet-mode-btn' + (betMode === 'simples' ? ' on' : '')}
                      onClick={() => chooseBetMode('simples')}>
                      <Icon name="target" size={11} /> SIMPLES
                    </button>
                    <button type="button" role="tab" aria-selected={betMode === 'avancado'}
                      className={'mk-bet-mode-btn' + (betMode === 'avancado' ? ' on' : '')}
                      onClick={() => chooseBetMode('avancado')}>
                      <Icon name="chart" size={11} /> AVANÇADO
                    </button>
                  </div>
                  <span className="mk-bet-mode-hint">
                    {betMode === 'simples'
                      ? 'Só quem vence o confronto. Casada = junta vencedores.'
                      : 'Tudo: placares, total de rounds, finalização e flawless.'}
                  </span>
                </div>
                {!isOpen && (
                  <div className="mk-bet-closed">
                    {roundConcluded(betRound) ? 'Essa rodada já fechou' : 'Essa rodada ainda não abriu'} — só dá pra apostar na rodada {bettableIdx >= 0 ? draw[bettableIdx].n : '—'} (aberta). Aqui é só ver as odds.
                  </div>
                )}
                <div className="mk-bet-games">
                  {rd.games.map((g, gi) => {
                    const odds = computeMkGameOdds(g.home, g.away, metrics);
                    const ownGame = !!myNick && (g.home === myNick || g.away === myNick);
                    const scEntry = (scores || {})[gKey(rd, gi)] || null;
                    const gameLocked = mkGameClosed(scEntry, now);
                    const secsLeft = mkLockSecondsLeft(scEntry, now);
                    const counting = secsLeft > 0;
                    const locked = !isOpen || ownGame || gameLocked;
                    const scoreMkt = (m) => m === 'RESULT' || m === 'P1' || m === 'P2';
                    return (
                      <div key={gi} className={'mk-bet-game' + (ownGame ? ' own' : '') + (gameLocked ? ' locked' : '') + (counting && !gameLocked ? ' closing' : '')}>
                        <div className="mk-bet-match">
                          <span className="mk-bm-side"><span className="mk-bm-nick mand">@{g.home}</span><span className="mk-bm-role mand">MANDANTE</span></span>
                          <span className="mk-bm-vs">×</span>
                          <span className="mk-bm-side right"><span className="mk-bm-nick">@{g.away}</span><span className="mk-bm-role">VISITANTE</span></span>
                        </div>
                        {(() => {
                          // CARD DE LUTA (#1): mostra pra TODO MUNDO os 2 jogos e os
                          // bonecos escolhidos, pra dar contexto antes de apostar.
                          const lu = (lineups || {})[gKey(rd, gi)] || null;
                          const arranged = !!lu && ['p1', 'p2'].every(p => (lu[p] || {}).home && (lu[p] || {}).away);
                          if (!arranged) {
                            return <div className="mk-bet-fc empty"><Icon name="refresh" size={10} /> @{g.home} ainda não montou o card de luta</div>;
                          }
                          return (
                            <div className="mk-bet-fc">
                              {['p1', 'p2'].map((p, pi) => {
                                const h = (lu[p] || {}).home, a = (lu[p] || {}).away;
                                return (
                                  <div key={p} className="mk-bet-fc-part">
                                    <span className="mk-bet-fc-num">J{pi + 1}</span>
                                    <span className="mk-bet-fc-fig">
                                      <span className="mk-fc-mono sm" style={{ '--hue': mkHue(h) }}>{mkMono(h)}</span>
                                      <span className="mk-bet-fc-cn">{h}</span>
                                    </span>
                                    <span className="mk-bet-fc-vs"><Icon name="skull" size={10} /></span>
                                    <span className="mk-bet-fc-fig right">
                                      <span className="mk-fc-mono sm" style={{ '--hue': mkHue(a) }}>{mkMono(a)}</span>
                                      <span className="mk-bet-fc-cn">{a}</span>
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                        {ownGame && <div className="mk-bet-own"><Icon name="lock" size={10} /> VOCÊ JOGA ESSE — não pode apostar</div>}
                        {gameLocked && !ownGame && <div className="mk-bet-own lock"><Icon name="lock" size={10} /> APOSTAS TRAVADAS</div>}
                        {/* #4: aviso de cronômetro pro APOSTADOR — última chamada antes de fechar */}
                        {counting && !gameLocked && !ownGame && (
                          <div className="mk-bet-countdown" role="timer" aria-live="polite">
                            <Icon name="warning" size={12} />
                            <span className="mk-cd-label">FECHA EM</span>
                            <span className="mk-cd-time">{fmtSecs(secsLeft)}</span>
                            <span className="mk-cd-hint">última chamada!</span>
                          </div>
                        )}
                        {/* #4: controles do MOD — fechar com contagem, travar já, ou destravar */}
                        {isMod && onSetGameLock && (
                          <div className="mk-bet-locktoggle">
                            {gameLocked ? (
                              <button type="button" className="mk-bet-lockbtn on" onClick={() => onSetGameLock(gKey(rd, gi), { locked: false, lockAt: null })}>
                                <Icon name="unlock" size={11} /> DESTRAVAR APOSTAS
                              </button>
                            ) : counting ? (
                              <>
                                <button type="button" className="mk-bet-lockbtn ghost" onClick={() => onSetGameLock(gKey(rd, gi), { lockAt: null })}>
                                  <Icon name="x" size={11} /> CANCELAR ({fmtSecs(secsLeft)})
                                </button>
                                <button type="button" className="mk-bet-lockbtn danger" onClick={() => onSetGameLock(gKey(rd, gi), { locked: true, lockAt: null })}>
                                  <Icon name="lock" size={11} /> TRAVAR JÁ
                                </button>
                              </>
                            ) : (
                              <>
                                <button type="button" className="mk-bet-lockbtn" onClick={() => onSetGameLock(gKey(rd, gi), { lockAt: Date.now() + MK_LOCK_COUNTDOWN_S * 1000, locked: false })}>
                                  <Icon name="warning" size={11} /> FECHAR EM {MK_LOCK_COUNTDOWN_S}s
                                </button>
                                <button type="button" className="mk-bet-lockbtn danger" onClick={() => onSetGameLock(gKey(rd, gi), { locked: true, lockAt: null })}>
                                  <Icon name="lock" size={11} /> TRAVAR JÁ
                                </button>
                              </>
                            )}
                          </div>
                        )}
                        {visibleMarkets.map(mkt => (
                          <div key={mkt} className="mk-bet-mkt">
                            <div className="mk-bet-mkt-h">{MK_MARKET_TITLE[mkt]}</div>
                            <div className="mk-bet-picks">
                              {mkMarketPicks(mkt, odds).map(pick => {
                                const on = pickInCupom(gi, mkt, pick);
                                return (
                                  <button key={pick} type="button" className={'mk-odd' + (on ? ' on' : '') + (locked ? ' off' : '')}
                                    onClick={() => toggleLeg(gi, g, mkt, pick, odds[mkt][pick])} disabled={locked}>
                                    <span className="mk-odd-l">
                                      {scoreMkt(mkt)
                                        ? <span className="mk-odd-pl"><span className="mk-sc-h">{pick[0]}</span><span className="mk-sc-x">×</span><span className="mk-sc-a">{pick[1]}</span></span>
                                        : mkPickLabel(mkt, pick)}
                                    </span>
                                    <span className="mk-odd-v">{odds[mkt][pick].toFixed(2)}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>

              <aside className="mk-cupom-wrap">
                <div className="card cupom">
                  <div className="card-head">
                    <div className="title">CUPOM {isCasada ? '· CASADA' : ''}</div>
                    <div className="sub">{cupom.length} {cupom.length === 1 ? 'PALPITE' : 'PALPITES'}</div>
                  </div>
                  <div className="card-body">
                    {cupom.length === 0 ? (
                      <div className="empty">
                        <div className="e1">VAZIO</div>
                        <div className="e2">Clica nas odds pra montar. 2+ palpites da rodada = casada.</div>
                      </div>
                    ) : (<>
                      {cupom.map(l => (
                        <div key={l.key} className="cupom-leg">
                          <div className="cupom-leg-txt">
                            <div className="cupom-leg-mkt">{MK_MARKET_TITLE[l.market]}</div>
                            <div className="cupom-leg-pick">@{l.home}×@{l.away} - <strong>{mkLegLabel(l)}</strong></div>
                          </div>
                          <div className="cupom-leg-odd mono">{l.odd.toFixed(2)}</div>
                          <button className="cupom-leg-x" onClick={() => setCupom(p => p.filter(x => x.key !== l.key))}><Icon name="x" size={12} /></button>
                        </div>
                      ))}
                      <div className="modal-row" style={{ marginTop: 10 }}>
                        <span className="lab">ODDS TOTAL</span>
                        <span className="mono" style={{ color: 'var(--pv-orange)', fontWeight: 800 }}>{combined.toFixed(2)}x</span>
                      </div>
                      <div className="modal-row"><span className="lab">SALDO</span><span className="mono">{Number.isFinite(balance) ? balance + ' PC' : '∞'}</span></div>

                      <div style={{ marginTop: 10 }} className="small-label">QUANTO APOSTAR (PC)</div>
                      <input type="number" min="1" value={stake} className="stake-input"
                        onChange={e => setStake(Math.max(0, Math.min(Number.isFinite(balance) ? balance : 1e9, +e.target.value || 0)))} />
                      <div className="quick">
                        <button onClick={() => setStake(5)}>5</button>
                        <button onClick={() => setStake(10)}>10</button>
                        <button onClick={() => setStake(25)}>25</button>
                        <button onClick={() => setStake(Number.isFinite(balance) ? balance : 1000)}>MAX</button>
                      </div>

                      <div className="payout-box">
                        <div className="nm">RETORNO POTENCIAL</div>
                        <div className="v">{Math.round(stake * combined)} <span style={{ fontSize: 12, letterSpacing: '0.3em', fontFamily: 'Space Grotesk' }}>PC</span></div>
                        <div style={{ fontSize: 10, letterSpacing: '0.22em', fontWeight: 800, color: 'var(--pv-orange)', marginTop: 4 }}>LUCRO LÍQUIDO: +{Math.round(stake * combined) - stake} PC</div>
                      </div>

                      {isCasada && (
                        <div style={{ fontSize: 10, letterSpacing: '0.12em', color: 'rgba(28,22,18,0.6)', fontWeight: 700, marginTop: 10, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                          <Icon name="warning" size={12} /> <span>APOSTA CASADA: precisa acertar TODOS os {cupom.length} palpites pra ganhar.</span>
                        </div>
                      )}
                      {!isOpen && <div className="mk-cupom-warn">Vá pra rodada aberta pra apostar.</div>}

                      <div className="modal-btns">
                        <button className="btn-secondary" onClick={() => setCupom([])}>LIMPAR</button>
                        <button className="btn-primary" disabled={!isOpen || !cupom.length || !(stake > 0)} onClick={place}>APOSTAR {stake} PC</button>
                      </div>
                      <button type="button" className="cupom-share" onClick={() => {
                        const txt = 'Cupom MK: ' + cupom.map(l => MK_MARKET_TITLE[l.market] + ' ' + mkLegLabel(l) + ' @' + l.odd.toFixed(2)).join(' + ') + ' = ' + combined.toFixed(2) + 'x';
                        try { navigator.clipboard.writeText(txt); showToast('Cupom copiado!', 'success'); } catch (e) { showToast('Falha ao copiar.', 'error'); }
                      }}>
                        <Icon name="arrow-up-right" size={13} /> COMPARTILHAR CUPOM
                      </button>
                    </>)}
                  </div>
                </div>
              </aside>
            </div>
            <div className="mk-bets-hint"><Icon name="ticket" size={12} /> Suas apostas ficam em <strong>MEUS TICKETS</strong>.</div>
          </>
        )}
      </div>
    </div>
  );
}

function MeuPerfilView({ nick, me, cs, bets, users, teamPlayers, worldcup, isAdmin, onSelectTitle, onEquip, interests, onCancelInterest }) {
  const [inscBusy, setInscBusy] = useState(null);
  const champLabel = (cid) => cid === 'copa'
    ? 'COPA DO MUNDO'
    : (CHAMP_BY_ID[cid] ? `${CHAMP_BY_ID[cid].tag} · ${CHAMP_BY_ID[cid].season}` : cid.toUpperCase());
  const champTag = (cid) => cid === 'copa' ? 'COPA' : (CHAMP_BY_ID[cid]?.tag || cid.toUpperCase());
  const myInscriptions = Object.keys(interests || {}).filter(cid => interests[cid] && interests[cid][nick]);
  const cancelInscription = async (cid) => {
    if (inscBusy) return;
    if (!window.confirm('Cancelar sua inscrição em ' + champLabel(cid) + '?')) return;
    setInscBusy(cid);
    try {
      await onCancelInterest(cid);
      showToast('Inscrição cancelada.', 'success');
    } catch (e) {
      showToast('Não consegui cancelar agora. Tenta de novo.', 'error');
    } finally {
      setInscBusy(null);
    }
  };
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
  // Admin não tem time -> vitrine vazia. DEMO: como se tivesse jogado todas as
  // S1 + algumas S2 e S3, com tipos variados (só pra ver a vitrine cheia).
  const previewTrophies = (isAdmin && myTrophies.length === 0) ? (() => {
    const kinds = ['champion', 'vice', 'terceiro', 'participou', 'penultimo', 'lanterna'];
    const out = CHAMPIONSHIPS.map((c, i) => ({ champId: c.id, kind: kinds[i % kinds.length] }));
    [
      { tag: 'FIFA', season: 'Season 2', kind: 'champion' },
      { tag: 'MK', season: 'Season 2', kind: 'vice' },
      { tag: 'RL', season: 'Season 2', kind: 'terceiro' },
      { tag: 'FIFA', season: 'Season 3', kind: 'champion' },
      { tag: 'MK', season: 'Season 3', kind: 'lanterna' },
    ].forEach((e, i) => out.push({ champId: '_demo' + i, kind: e.kind, _tag: e.tag, _season: e.season }));
    return out;
  })() : [];
  const showTrophies = myTrophies.length ? myTrophies : previewTrophies;
  // REI DAS APOSTAS — um por SEASON de cada jogo (campeonato fechado): rei = quem
  // mais lucrou nas apostas daquela edição. Troféu SEPARADO dos de edição; lista
  // as seasons conquistadas. Admin vê na prévia.
  const betKingSeasons = (isAdmin && myTrophies.length === 0)
    ? [{ tag: 'FIFA', season: 'Season 1' }, { tag: 'MK', season: 'Season 1' }, { tag: 'FIFA', season: 'Season 2' }]
    : betKingChamps(nick, cs, bets).map(b => { const c = CHAMP_BY_ID[b.champId]; return { tag: c?.tag, season: c?.season }; });
  const showBetKing = betKingSeasons.length > 0;

  return (
    <div>
      {/* HEADER COM AVATAR GRANDE */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {myTeamId && <Avatar teamId={myTeamId} cosmetics={me?.cosmetics} size={120} className="profile-avatar" />}
          <div>
            <div className="title" style={{ fontSize: 24 }}>@{nick}</div>
            <div className="sub">{isAdmin ? 'ADMIN' : `${me?.pc ?? 0} PC · ${ccBalanceFor(nick, me, { bets, users, teamPlayers, cs, worldcup, interests })} CC`}{myTeam ? ` · ${myTeam.name}` : ''}</div>
          </div>
        </div>
      </div>

      {/* MINHAS INSCRIÇÕES — cancela inscrição em campeonatos "em breve" daqui */}
      {myInscriptions.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-head">
            <div className="title">MINHAS INSCRIÇÕES</div>
            <div className="sub">{myInscriptions.length} {myInscriptions.length === 1 ? 'CAMPEONATO' : 'CAMPEONATOS'}</div>
          </div>
          <div className="card-body">
            <div className="insc-list">
              {myInscriptions.map(cid => (
                <div key={cid} className="insc-row">
                  <div className="insc-info">
                    <span className="insc-tag">{champTag(cid)}</span>
                    <span className="insc-name">{champLabel(cid)}</span>
                  </div>
                  <button
                    type="button"
                    className="insc-cancel"
                    onClick={() => cancelInscription(cid)}
                    disabled={inscBusy === cid}
                  >
                    {inscBusy === cid ? 'CANCELANDO…' : (<><Icon name="x" size={13} /> CANCELAR</>)}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TÍTULOS */}
      <TitulosCard
        nick={nick}
        ctx={{ bets, users, teamPlayers, cs, worldcup }}
        selectedTitle={me?.title || null}
        onSelectTitle={onSelectTitle}
      />

      {/* MINHA COLEÇÃO — molduras e distintivos desbloqueados, equipar daqui */}
      {!isAdmin && (
        <ColecaoCard
          nick={nick}
          me={me}
          previewTeamId={myTeamId}
          ctx={{ bets, teamPlayers, cs, worldcup }}
          onEquip={onEquip}
        />
      )}

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
              <div className="e2">Peça pro admin te vincular a um time em ADMIN <Icon name="arrow-right" size={11} className="inl-arrow" /> TIMES.</div>
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
          <div className="title"><Icon name="trophy" size={16} /> MEUS TROFÉUS</div>
          <div className="sub">{myTrophies.length ? myTrophies.length : (previewTrophies.length ? 'PRÉVIA' : 0)}</div>
        </div>
        <div className="card-body">
          {previewTrophies.length > 0 && (
            <div className="mk-admin-note" style={{ marginBottom: 12 }}><Icon name="lock" size={11} /> Prévia (admin): todos os troféus pra você conferir o visual. Cada jogador vê só os que conquistou.</div>
          )}
          {/* REI DAS APOSTAS — um por SEASON, sempre separado dos de edição */}
          {showBetKing && (
            <div className="tr-betking">
              <div className="tr-betking-art"><Icon name="tr-betking" size={42} /></div>
              <div className="tr-betking-txt">
                <div className="tr-betking-label">REI DAS APOSTAS{betKingSeasons.length > 1 ? ` · ${betKingSeasons.length}` : ''}</div>
                <div className="tr-betking-eds">
                  {betKingSeasons.map((s, i) => <span key={i} className="tr-betking-ed">{s.tag} · {s.season}</span>)}
                </div>
              </div>
            </div>
          )}
          {showTrophies.length === 0 ? (
            !showBetKing && (
              <div className="empty">
                <div className="e1">VITRINE VAZIA</div>
                <div className="e2">Você ainda não conquistou nenhum campeonato encerrado.</div>
              </div>
            )
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {['champion', 'vice', 'terceiro', 'participou', 'penultimo', 'lanterna'].map(kind => {
                const group = showTrophies.filter(t => t.kind === kind);
                if (!group.length) return null;
                const editions = group.map(t => {
                  const cc = CHAMP_BY_ID[t.champId];
                  return { tag: t._tag || cc?.tag, season: t._season || cc?.season };
                });
                return <TrophyGroup key={kind} kind={kind} editions={editions} />;
              })}
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

// Retorna { titleId: [nicks que possuem] } pra todos os titulos do catalogo.
function computeTitleOwners(ctx) {
  const result = {};
  TITLE_DEFS.forEach(t => { result[t.id] = []; });
  const users = (ctx && ctx.users) || {};
  Object.keys(users).forEach(nick => {
    const earned = titlesForNick(nick, ctx || {});
    earned.forEach(t => { result[t.id].push(nick); });
  });
  return result;
}

// ─── LOJA (items cosméticos) ────────────────────────────────────────────────
function LojaView({ nick, me, ctx, onBuy, onEquip }) {
  const [busy, setBusy] = useState({}); // { itemId: 'buy' | 'equip' }
  const inv = useMemo(() => effectiveInventory(nick, me, ctx), [nick, me, ctx]);
  const equipped = me?.cosmetics || {};
  const cc = ccBalanceFor(nick, me, ctx);

  const handleBuy = async (item) => {
    if (busy[item.id]) return;
    setBusy(b => ({ ...b, [item.id]: 'buy' }));
    try {
      const r = await onBuy(item.id);
      if (r && r.err) {
        showToast(r.err, 'error');
      } else {
        showToast(`Comprou ${item.name}!`, 'success');
      }
    } finally {
      setBusy(b => { const next = { ...b }; delete next[item.id]; return next; });
    }
  };

  const handleEquip = async (item, equip) => {
    if (busy[item.id]) return;
    setBusy(b => ({ ...b, [item.id]: 'equip' }));
    try {
      await onEquip(item.slot, equip ? item.id : null);
      showToast(equip ? `Equipou ${item.name}` : `Desequipou ${item.name}`, 'success');
    } finally {
      setBusy(b => { const next = { ...b }; delete next[item.id]; return next; });
    }
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <div className="title"><Icon name="coin" size={16} /> MERCADINHO</div>
          <div className="sub">SEU SALDO: {cc} CAMPEÃO COINS</div>
        </div>
        <div className="card-body">
          <p style={{ marginTop: 0, lineHeight: 1.5, fontSize: 13 }}>
            A loja roda em <strong>Campeão Coins (CC)</strong> — o PC agora é só pra apostas.
            <strong> CC é raro: você ganha conquistando títulos (+{CC_PER_TITLE} cada) e
            participando de campeonatos (+{CC_PER_PARTICIPATION} cada).</strong> Compra molduras
            com CC e equipa distintivos desbloqueados por conquista. Items equipados aparecem no
            seu avatar em todo o site (TopBar, Ranking, Perfil, Vitrine).
          </p>
        </div>
      </div>

      {ITEM_SLOTS.map(slot => {
        const items = ITEMS.filter(i => i.slot === slot.id);
        return (
          <div key={slot.id} className="card" style={{ marginBottom: 14 }}>
            <div className="card-head">
              <div className="title">{slot.label}</div>
              <div className="sub">{items.length} ITEMS</div>
            </div>
            <div className="card-body">
              <div className="loja-grid">
                {items.map(item => {
                  const owned = inv.includes(item.id);
                  const isEquipped = equipped[slot.id] === item.id;
                  const isDrop = !!item.drop;
                  const canAfford = !item.price || cc >= item.price;
                  const action = busy[item.id];
                  return (
                    <div key={item.id} className={'loja-item rarity-' + item.rarity + (owned ? ' owned' : ' locked')}>
                      <div className="loja-item-head">
                        <span className="loja-item-ic" style={{ color: item.color }}>
                          {owned ? <Icon name={item.icon} size={28} /> : <Icon name="lock" size={24} />}
                        </span>
                        <div className="loja-item-meta">
                          <div className="loja-item-name" style={{ color: owned ? item.color : 'rgba(28,22,18,0.5)' }}>
                            {item.name}
                          </div>
                          <div className="loja-item-rarity">{item.rarity}</div>
                        </div>
                      </div>
                      <div className="loja-item-desc">{item.desc}</div>
                      <div className="loja-item-foot">
                        {!owned && isDrop && (
                          <div className="loja-item-tag locked">DESBLOQUEIA POR CONQUISTA</div>
                        )}
                        {!owned && !isDrop && (
                          <button
                            className="loja-btn buy"
                            disabled={!canAfford || !!action}
                            onClick={() => handleBuy(item)}
                          >
                            {action === 'buy' ? 'COMPRANDO…' : (canAfford ? `COMPRAR · ${item.price} CC` : `SEM CC (precisa ${item.price})`)}
                          </button>
                        )}
                        {owned && !isEquipped && (
                          <button
                            className="loja-btn equip"
                            disabled={!!action}
                            onClick={() => handleEquip(item, true)}
                          >
                            {action === 'equip' ? 'EQUIPANDO…' : 'EQUIPAR'}
                          </button>
                        )}
                        {owned && isEquipped && (
                          <button
                            className="loja-btn unequip"
                            disabled={!!action}
                            onClick={() => handleEquip(item, false)}
                          >
                            {action === 'equip' ? 'TIRANDO…' : <><Icon name="check" size={12} /> EQUIPADO · TIRAR</>}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TitulosCard({ nick, ctx, selectedTitle, onSelectTitle }) {
  const earnedIds = useMemo(() => new Set(titlesForNick(nick, ctx || {}).map(t => t.id)), [nick, ctx]);
  const owners = useMemo(() => computeTitleOwners(ctx || {}), [ctx]);
  const earned = TITLE_DEFS.filter(t => earnedIds.has(t.id));
  const locked = TITLE_DEFS.filter(t => !earnedIds.has(t.id));
  const [showLocked, setShowLocked] = useState(false);

  const handleClick = (id, isLocked) => {
    if (isLocked || !onSelectTitle) return;
    onSelectTitle(selectedTitle === id ? null : id);
  };

  // Chip compacto: ícone + nome. Hover mostra tooltip (desc + quem tem).
  const renderChip = (t, isLocked) => {
    const isSelected = !isLocked && selectedTitle === t.id;
    const titleOwners = owners[t.id] || [];
    return (
      <div key={t.id} className="titulo-chip-wrap">
        <button
          className={'titulo-chip' + (isSelected ? ' selected' : '') + (isLocked ? ' locked' : '')}
          onClick={() => handleClick(t.id, isLocked)}
          style={!isLocked ? { '--tc': t.color } : undefined}
          aria-pressed={isSelected}
        >
          <span className="titulo-chip-ic">
            {isLocked ? <Icon name="lock" size={15} /> : <Icon name={t.icon} size={17} />}
          </span>
          <span className="titulo-chip-name">{t.name}</span>
          {isSelected && <span className="titulo-chip-check"><Icon name="check" size={12} /></span>}
        </button>
        <div className="titulo-tooltip">
          <div className="titulo-tooltip-head">{t.name}</div>
          <div className="titulo-tooltip-desc">{t.desc}</div>
          <div className="titulo-tooltip-owners">
            {titleOwners.length === 0
              ? 'Ninguém conquistou ainda.'
              : `Têm: ${titleOwners.map(n => '@' + n + (n === nick ? ' (você)' : '')).join(', ')}`}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head">
        <div className="title"><Icon name="tag" size={16} /> TÍTULOS</div>
        <div className="sub">{earned.length}/{TITLE_DEFS.length} CONQUISTADOS</div>
      </div>
      <div className="card-body">
        <p style={{ marginTop: 0, marginBottom: 10, fontSize: 11, color: 'rgba(28,22,18,0.6)', lineHeight: 1.4 }}>
          Clica num título conquistado pra exibir no seu nome. Toca (ou passa o mouse) pra ver o que é e quem tem.
        </p>

        {earned.length > 0 ? (
          <>
            <div className="small-label" style={{ marginTop: 0, marginBottom: 6 }}>SEUS TÍTULOS</div>
            <div className="titulos-chips">{earned.map(t => renderChip(t, false))}</div>
          </>
        ) : (
          <div className="titulos-vazio">Você ainda não conquistou nenhum título. Olha os bloqueados pra ver como desbloquear.</div>
        )}

        {locked.length > 0 && (
          <>
            <button className="titulos-toggle" onClick={() => setShowLocked(s => !s)}>
              <Icon name={showLocked ? 'caret-up' : 'caret-down'} size={12} />
              {showLocked ? 'ESCONDER' : 'VER'} {locked.length} BLOQUEADO{locked.length === 1 ? '' : 'S'}
            </button>
            {showLocked && <div className="titulos-chips" style={{ marginTop: 8 }}>{locked.map(t => renderChip(t, true))}</div>}
          </>
        )}
      </div>
    </div>
  );
}

// Um card por TIPO de troféu (campeão/vice/...), com a lista de edições embaixo.
function TrophyGroup({ kind, editions }) {
  const meta = {
    champion:   { icon: 'tr-champion',   label: 'CAMPEÃO',    color: '#d4af37', bg: '#fbf3d3' },
    vice:       { icon: 'tr-vice',       label: 'VICE',       color: '#9aa3ad', bg: '#eef0f2' },
    terceiro:   { icon: 'tr-terceiro',   label: 'TERCEIRO',   color: '#cd7f32', bg: '#f7e9da' },
    participou: { icon: 'tr-participou', label: 'PARTICIPOU', color: '#5e7186', bg: '#eef1f4' },
    penultimo:  { icon: 'tr-penultimo',  label: 'PENÚLTIMO',  color: '#6b4423', bg: '#f0e7df' },
    lanterna:   { icon: 'tr-lanterna',   label: 'ÚLTIMO',     color: '#7a2222', bg: '#fce4e4' },
  }[kind] || { icon: null, label: '', color: '#000', bg: '#eee' };
  const shame = kind === 'lanterna' || kind === 'penultimo';
  return (
    <div className={'tr-card tr-' + kind} style={{
      flex: '0 0 calc(50% - 6px)', maxWidth: 240,
      background: meta.bg, border: `2px solid ${meta.color}`,
      padding: 12, textAlign: 'center',
    }}>
      <div className={'tr-art' + (shame ? ' shame' : '')} style={{ lineHeight: 1, color: meta.color, display: 'flex', justifyContent: 'center' }}>
        {meta.icon && <Icon name={meta.icon} size={44} />}
      </div>
      <div style={{ marginTop: 5, fontSize: 11, letterSpacing: '0.2em', fontWeight: 800, color: meta.color }}>
        {meta.label}{editions.length > 1 ? ` ·${editions.length}` : ''}
      </div>
      <div className="tr-eds">
        {editions.map((e, i) => <div key={i} className="tr-ed">{e.tag} · {e.season}</div>)}
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
// RANKING DE APOSTAS — POR SEASON. Cada campeonato (FIFA S1, MK S1...) tem o seu
// ranking, por LUCRO nas apostas daquela season. Seasons encerradas viram histórico.
function RankingView({ users, bets, me, teamPlayers, cs }) {
  const withBets = new Set((bets || []).map(b => b.champId || 'fifa'));
  const champList = CHAMPIONSHIPS
    .filter(c => c.status === 'active' || withBets.has(c.id))
    .sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1));
  const [sel, setSel] = useState(champList[0] ? champList[0].id : 'fifa');
  const champ = CHAMP_BY_ID[sel] || CHAMPIONSHIPS[0];
  const encerrada = computeChampStandings(sel, cs).status === 'closed';
  const ranking = seasonBettingRanking(sel, bets);

  return (
    <div className="card">
      <div className="card-head">
        <div className="title"><Icon name="tr-betking" size={16} /> RANKING DE APOSTAS</div>
        <div className="sub">{champ.tag} · {champ.season} · {encerrada ? 'ENCERRADA' : 'AO VIVO'}</div>
      </div>
      <div className="card-body">
        {champList.length > 1 && (
          <div className="rank-seasons">
            {champList.map(c => {
              const fim = computeChampStandings(c.id, cs).status === 'closed';
              return (
                <button key={c.id} type="button" className={'rank-season' + (c.id === sel ? ' on' : '') + (fim ? ' fechada' : '')} onClick={() => setSel(c.id)}>
                  <span className="rank-season-tag">{c.tag}</span>
                  <span className="rank-season-sub">{c.season.replace('Season ', 'S')}{fim ? ' · fim' : ''}</span>
                </button>
              );
            })}
          </div>
        )}
        {ranking.length === 0 ? (
          <div className="empty"><div className="e1">SEM APOSTAS</div><div className="e2">Ninguém apostou em {champ.tag} · {champ.season} ainda.</div></div>
        ) : (
          <div className="rank-list">
            {ranking.map((r, i) => {
              const u = users[r.nick] || {};
              const rei = i === 0 && (r.lucro > 0 || r.vit > 0);
              return (
                <div key={r.nick} className={'lb-row rank-row' + (r.nick === me ? ' me' : '') + (rei ? ' rei' : '')} style={{ gridTemplateColumns: '34px 42px 1fr auto', gap: 10 }}>
                  <div className="lb-pos">{rei ? <Icon name="tr-betking" size={20} /> : i + 1}</div>
                  <Avatar nick={r.nick} teamPlayers={teamPlayers} cosmetics={u.cosmetics || {}} size={42} />
                  <div style={{ minWidth: 0 }}>
                    <div className="lb-nick">@{r.nick}{u.title && <TitleBadge titleId={u.title} />}{rei && <span className="rank-rei-tag">REI</span>}</div>
                    <div className="rank-row-stats">{r.apostas} apostas · <span style={{ color: 'var(--pv-green)' }}>{r.vit}V</span> · <span style={{ color: 'var(--pv-red)' }}>{r.der}D</span>{r.pend ? ' · ' + r.pend + ' aberta' + (r.pend > 1 ? 's' : '') : ''}</div>
                  </div>
                  <div className="rank-lucro" style={{ color: r.lucro > 0 ? 'var(--pv-green)' : r.lucro < 0 ? 'var(--pv-red)' : 'rgba(28,22,18,0.45)' }}>
                    {r.lucro > 0 ? '+' : ''}{r.lucro}<small>PC</small>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="rank-foot"><Icon name="tr-betking" size={11} /> Ranking por <strong>lucro</strong> nas apostas desta season (retorno − aposta das resolvidas). Cada temporada tem o seu — o 1º é o <strong>REI DAS APOSTAS</strong>.</div>
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
  if (champId !== 'fifa') return { status: 'soon', standings: [] };
  const rounds = cs?.rounds || [];
  if (rounds.length === 0) return { status: 'soon', standings: [] };
  const anyPlayed = rounds.some(r => Array.isArray(r) && r.some(isGamePlayed));
  const allDone = rounds.every(r => Array.isArray(r) && r.length > 0 && r.every(isGamePlayed));
  // Ordena: pontos > saldo de gol > gols pró.
  const standings = computeStandings(rounds).slice()
    .sort((a, b) => b.p - a.p || (b.gp - b.gc) - (a.gp - a.gc) || b.gp - a.gp);
  return {
    status: allDone ? 'closed' : (anyPlayed ? 'ongoing' : 'soon'),
    standings,
  };
}

// Monta os 3 lugares da vitrine (top 3 pra fama, bottom 3 pra vergonha)
// com stats ricos pra ficha.
function buildShowcase(view, standings, users, teamPlayers) {
  if (!standings || standings.length < 3) return [];
  const cosmeticsFor = (teamId) => {
    const nick = (teamPlayers || {})[teamId];
    return nick && users ? (users[nick]?.cosmetics || null) : null;
  };
  const nickFor = (teamId) => (teamPlayers || {})[teamId] || null;
  const mk = (s, pos, label) => ({
    pos, label,
    name: s.name, teamId: s.id, nick: nickFor(s.id), cosmetics: cosmeticsFor(s.id),
    pts: s.p, v: s.v, e: s.e, d: s.d, gp: s.gp, gc: s.gc, sg: s.gp - s.gc, j: s.j,
    invicto: s.d === 0 && s.j > 0,
    semVitoria: s.v === 0 && s.j > 0,
    aproveitamento: s.j > 0 ? Math.round((s.p / (s.j * 3)) * 100) : 0,
  });
  if (view === 'fame') {
    return [mk(standings[0], 1, 'CAMPEÃO'), mk(standings[1], 2, 'VICE')];
  }
  const n = standings.length;
  return [mk(standings[n - 1], n, 'LANTERNA'), mk(standings[n - 2], n - 1, 'PENÚLTIMO')];
}

// Ranking do bolão da Copa (por pontos de palpite). Retorna status + ranking.
function computeCopaStandings(worldcup, wcFixtures) {
  const picks = (worldcup && worldcup.picks) || {};
  const results = (worldcup && worldcup.results) || {};
  const nicks = Object.keys(picks);
  const resultCount = Object.keys(results).length;
  if (nicks.length < 2 || resultCount === 0) return { status: 'soon', ranking: [] };
  const ranking = nicks.map(nick => {
    const up = picks[nick] || {};
    let pts = 0, exatos = 0, certos = 0, errados = 0, palpitados = 0;
    for (const fid of Object.keys(up)) {
      palpitados++;
      const r = results[fid];
      if (r) {
        const s = scoreWcPick(r, up[fid]);
        pts += s;
        if (s === 3) exatos++; else if (s === 1) certos++; else errados++;
      }
    }
    return { nick, pts, exatos, certos, errados, palpitados };
  }).sort((a, b) => b.pts - a.pts || b.exatos - a.exatos);
  const allDone = Array.isArray(wcFixtures) && wcFixtures.length > 0 && wcFixtures.every(f => results[f.id]);
  return { status: allDone ? 'closed' : 'ongoing', ranking };
}

// Monta os 2 lugares da vitrine da Copa (top/bottom 2 por pontos de palpite).
function buildCopaShowcase(view, ranking, users, teamPlayers) {
  if (!ranking || ranking.length < 2) return [];
  const teamIdFor = (nick) => {
    for (const [tid, n] of Object.entries(teamPlayers || {})) {
      if (n && String(n).toLowerCase() === String(nick).toLowerCase()) return tid;
    }
    return null;
  };
  const mk = (r, pos, label) => ({
    pos, label, name: '@' + r.nick, nick: null,
    teamId: teamIdFor(r.nick), copaNick: r.nick,
    cosmetics: (users && users[r.nick]?.cosmetics) || null,
    statsOverride: [
      { val: r.pts, label: 'PTS' },
      { val: r.exatos, label: 'EXATOS' },
      { val: r.palpitados, label: 'PALP.' },
    ],
    wldText: `${r.exatos} exatos · ${r.certos} certos · ${r.errados} erros`,
    tagOverride: view === 'fame'
      ? (r.exatos >= 3 ? 'VIDENTE' : null)
      : (r.pts === 0 ? 'CHUTOU TUDO ERRADO' : null),
  });
  if (view === 'fame') return [mk(ranking[0], 1, 'CAMPEÃO DO BOLÃO'), mk(ranking[1], 2, 'VICE DO BOLÃO')];
  const n = ranking.length;
  return [mk(ranking[n - 1], n, 'PIOR PALPITEIRO'), mk(ranking[n - 2], n - 1, 'PENÚLTIMO')];
}

// Card individual da vitrine (1 colocado). rank 0=ouro/pior, 1, 2.
function ShowcaseItem({ item, theme, rank, season, status }) {
  const isFame = theme === 'fame';
  // Cores por posição: fama ouro/prata/bronze, vergonha tons de vinho.
  const palettes = isFame
    ? [{ a: '#d4af37', d: '#6b5616', ic: 'trophy' }, { a: '#c0c0c0', d: '#666', ic: 'medal' }]
    : [{ a: '#a52a2a', d: '#3e0f0f', ic: 'toilet' }, { a: '#9a3a2a', d: '#3e0f0f', ic: 'toothbrush' }];
  const p = palettes[rank] || palettes[0];
  const top = rank === 0;
  const badge = status === 'closed'
    ? `${item.label} ${season}`
    : (top ? (item.copaNick ? 'LÍDER DO BOLÃO' : 'LÍDER ATUAL') : `${item.pos}º · PARCIAL`);
  // stats: override (Copa) ou futebol (FIFA)
  const stats = item.statsOverride || [
    { val: item.pts, label: 'PTS' },
    { val: (item.sg >= 0 ? '+' : '') + item.sg, label: 'SG' },
    { val: item.aproveitamento + '%', label: 'APROV.' },
  ];
  // tag: override explícito (Copa, pode ser null) ou cálculo (FIFA)
  const tag = ('tagOverride' in item)
    ? item.tagOverride
    : (isFame
        ? (item.invicto ? 'INVICTO' : (item.aproveitamento >= 70 ? 'DOMINANTE' : null))
        : (item.semVitoria ? '0 VITÓRIAS' : (item.pts === 0 ? '0 PONTOS' : null)));
  // avatar: usa nick (Copa) ou teamId (FIFA)
  const avatarProps = item.copaNick
    ? { nick: item.copaNick }
    : { teamId: item.teamId };

  return (
    <div className={'showcase-item ' + (top ? 'showcase-top ' : '') + (isFame ? 'fame' : 'shame')}
         style={{ '--acc': p.a, '--accd': p.d }}>
      <div className="showcase-cap">
        <div className="showcase-rankicon"><Icon name={p.ic} size={top ? 40 : 32} /></div>
        <div className="showcase-badge">{badge}</div>
        <div className="showcase-avatar">
          <Avatar {...avatarProps} cosmetics={item.cosmetics} size={top ? 96 : 78} fullBody={true} noBadge />
        </div>
      </div>
      <div className="showcase-ficha">
        <div className="showcase-name">{item.name}</div>
        {item.nick && <div className="showcase-nick">@{item.nick}</div>}
        <div className="showcase-stats">
          {stats.map((s, i) => (
            <div key={i}><strong>{s.val}</strong><span>{s.label}</span></div>
          ))}
        </div>
        <div className="showcase-wld">
          {item.wldText
            ? item.wldText
            : <>{item.v}<small>V</small> · {item.e}<small>E</small> · {item.d}<small>D</small><span className="showcase-goals"> · {item.gp}/{item.gc} gols</span></>}
        </div>
        {tag && <div className="showcase-tag">{tag}</div>}
      </div>
    </div>
  );
}

// Vitrine de um campeonato (Fama OU Vergonha) — pódio de 3 + estados.
function TrophyShowcase({ champ, items, theme, status, sideRanking, myNick, sideTitle, sideIcon }) {
  const isFame = theme === 'fame';
  if (status === 'soon') {
    return (
      <div className={'showcase-cab ' + (isFame ? 'fame' : 'shame')}>
        <div className="showcase-cab-head">
          <Icon name={isFame ? 'trophy' : 'toilet'} size={16} /> {champ.name.toUpperCase()}
          <span className="showcase-cab-season">{champ.season}</span>
        </div>
        <div className="showcase-empty">
          <Icon name="lock" size={28} />
          <div className="e1">VITRINE LACRADA</div>
          <div className="e2">Campeonato ainda em inscrições. Os troféus aparecem quando a bola rolar.</div>
        </div>
      </div>
    );
  }
  const hasSide = Array.isArray(sideRanking) && sideRanking.length > 0;
  return (
    <div className={'showcase-cab ' + (isFame ? 'fame' : 'shame')}>
      <div className="showcase-cab-head">
        <Icon name={isFame ? 'trophy' : 'toilet'} size={16} /> {champ.name.toUpperCase()}
        <span className="showcase-cab-season">{champ.season}</span>
        {status === 'ongoing' && <span className="showcase-cab-live">EM ANDAMENTO · PÓDIO PROVISÓRIO</span>}
      </div>
      <div className={'showcase-body' + (hasSide ? ' with-side' : '')}>
        <div className="showcase-podium">
          {items.map((it, i) => (
            <ShowcaseItem key={it.teamId || i} item={it} theme={theme} rank={i} season={champ.season} status={status} />
          ))}
        </div>
        {hasSide && (
          <div className="showcase-side">
            <div className="showcase-side-head"><Icon name={sideIcon || 'coin'} size={13} /> {sideTitle || 'RANKING DOS APOSTADORES'}</div>
            <div className="showcase-side-list">
              {sideRanking.map((r, i) => (
                <div key={r.nick} className={'showcase-side-row' + (r.nick === myNick ? ' me' : '')}>
                  <span className="showcase-side-pos">{i + 1}</span>
                  <Avatar nick={r.nick} teamPlayers={r._tp} cosmetics={r.cosmetics} size={26} noBadge />
                  <span className="showcase-side-nick">@{r.nick}</span>
                  <span className="showcase-side-pc">{r.pc.toLocaleString('pt-BR')}<small>PC</small></span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Champ "virtual" da Copa pra reusar o TrophyShowcase.
const COPA_CHAMP = { id: 'copa', name: 'Copa do Mundo · Bolão', season: '2026' };

function HallDaFamaView({ cs, users, teamPlayers, worldcup, wcFixtures, myNick }) {
  const copa = computeCopaStandings(worldcup, wcFixtures);
  // Ranking dos apostadores (por saldo PC) — exibido ao lado do pódio da FIFA.
  const apostadores = Object.entries(users || {})
    .filter(([nick]) => nick !== ADMIN_NICK)
    .map(([nick, u]) => ({ nick, pc: u.pc || 0, cosmetics: u.cosmetics || null, _tp: teamPlayers }))
    .sort((a, b) => b.pc - a.pc)
    .slice(0, 8);
  return (
    <div>
      {CHAMPIONSHIPS.map(c => {
        const { status, standings } = computeChampStandings(c.id, cs);
        const items = status !== 'soon' ? buildShowcase('fame', standings, users, teamPlayers) : [];
        return <TrophyShowcase key={c.id} champ={c} items={items} theme="fame" status={status}
          sideRanking={c.id === 'fifa' ? apostadores : null} myNick={myNick} />;
      })}
      <TrophyShowcase
        champ={COPA_CHAMP}
        items={copa.status !== 'soon' ? buildCopaShowcase('fame', copa.ranking, users, teamPlayers) : []}
        theme="fame" status={copa.status}
      />
    </div>
  );
}

function HallDaVergonhaView({ cs, users, teamPlayers, worldcup, wcFixtures, myNick }) {
  const copa = computeCopaStandings(worldcup, wcFixtures);
  // Os mais quebrados (menor saldo PC) — exibido ao lado do pódio da FIFA.
  const quebrados = Object.entries(users || {})
    .filter(([nick]) => nick !== ADMIN_NICK)
    .map(([nick, u]) => ({ nick, pc: u.pc || 0, cosmetics: u.cosmetics || null, _tp: teamPlayers }))
    .sort((a, b) => a.pc - b.pc)
    .slice(0, 8);
  return (
    <div>
      {CHAMPIONSHIPS.map(c => {
        const { status, standings } = computeChampStandings(c.id, cs);
        const items = status !== 'soon' ? buildShowcase('shame', standings, users, teamPlayers) : [];
        return <TrophyShowcase key={c.id} champ={c} items={items} theme="shame" status={status}
          sideRanking={c.id === 'fifa' ? quebrados : null} sideTitle="OS MAIS QUEBRADOS" sideIcon="coin-fire" myNick={myNick} />;
      })}
      <TrophyShowcase
        champ={COPA_CHAMP}
        items={copa.status !== 'soon' ? buildCopaShowcase('shame', copa.ranking, users, teamPlayers) : []}
        theme="shame" status={copa.status}
      />
    </div>
  );
}

// HallView — vitrine de troféus (Fama + Vergonha) com subTabs.
function HallView({ cs, users, teamPlayers, worldcup, wcFixtures, myNick }) {
  const [subTab, setSubTab] = useState('fama'); // 'fama' | 'vergonha'
  const season = (CHAMPIONSHIPS.find(c => c.id === 'fifa') || {}).season || '';
  return (
    <div>
      <div className={'hall-hero ' + subTab}>
        <div className="hall-hero-ornament" aria-hidden="true">
          <Icon name="star" size={12} /><span /><Icon name="trophy" size={16} /><span /><Icon name="star" size={12} />
        </div>
        <div className="hall-hero-tag">
          {subTab === 'fama'
            ? `PRIMITIVÃO · MORADA DOS DEUSES · ${season}`
            : `PRIMITIVÃO · ABISMO DOS CONDENADOS · ${season}`}
        </div>
        <div className="hall-hero-title">{subTab === 'fama' ? 'OLIMPO PRIMITIVÃO' : 'TÁRTARO'}</div>
        <div className="hall-hero-sub">
          {subTab === 'fama'
            ? 'Os deuses de cada temporada. Imortalizados em ouro e prata no alto do Olimpo.'
            : 'O abismo onde os condenados penam. Privada, escova e o fundo do poço pra eternidade.'}
        </div>
      </div>
      <div className="hall-subtabs">
        <button className={'hall-subtab fame ' + (subTab === 'fama' ? 'active' : '')} onClick={() => setSubTab('fama')}>
          <Icon name="trophy" size={14} /> OLIMPO
        </button>
        <button className={'hall-subtab shame ' + (subTab === 'vergonha' ? 'active' : '')} onClick={() => setSubTab('vergonha')}>
          <Icon name="toilet" size={14} /> TÁRTARO
        </button>
      </div>
      {subTab === 'fama'     && <HallDaFamaView cs={cs} users={users} teamPlayers={teamPlayers} worldcup={worldcup} wcFixtures={wcFixtures} myNick={myNick} />}
      {subTab === 'vergonha' && <HallDaVergonhaView cs={cs} users={users} teamPlayers={teamPlayers} worldcup={worldcup} wcFixtures={wcFixtures} myNick={myNick} />}
    </div>
  );
}

// ─── CLASSIFICAÇÃO (aba) ────────────────────────────────────────────────────
// Controlled component: cs e setCs vêm do App (que mantém o subscribe ao
// primitivao/state, faz write-back e liquidação automática das apostas).
function ClassificacaoView({ cs, setCs, isAdmin, users, teamPlayers }) {
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
                // descobre o título exibido pelo jogador desse time, se houver
                const playerNick = (teamPlayers || {})[s.id];
                const playerTitle = playerNick ? (users || {})[playerNick]?.title : null;
                return (
                  <tr key={s.id} className={cls}>
                    <td className="std-pos">{String(i + 1).padStart(2, '0')}</td>
                    <td>
                      <div className="tnm" style={{ flexWrap: 'wrap' }}>
                        <TeamMini team={s.id} size={22} />
                        <span>{s.name}</span>
                        {playerTitle && <TitleBadge titleId={playerTitle} />}
                      </div>
                    </td>
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
// ─── ADMIN: JORNALISTA (persona automática de noticias) ───────────────────
// Detecta eventos no estado atual, monta prompts prontos pra colar em
// Claude/ChatGPT/Midjourney externo, e parseia a resposta de volta pra
// virar uma news publicada.

// Converte date "DD/MM" + time "HH:MM" pra Date. Assume ano corrente.
function parseGameTimestamp(game, year) {
  if (!game || !game.date || !game.time) return null;
  const [dd, mm] = String(game.date).split('/');
  const [hh, mn] = String(game.time).split(':');
  if (!dd || !mm || !hh) return null;
  const y = year || new Date().getFullYear();
  return new Date(y, parseInt(mm, 10) - 1, parseInt(dd, 10), parseInt(hh, 10), parseInt(mn || '0', 10));
}

// Calcula sequencias de vitorias/derrotas (em jogos consecutivos do time)
function computeStreaks(rounds) {
  const teamHistory = {};
  TEAMS.forEach(t => { teamHistory[t.id] = []; });
  (rounds || []).forEach(round => {
    round.forEach(m => {
      const gh = parseInt(m.gh, 10);
      const ga = parseInt(m.ga, 10);
      if (Number.isNaN(gh) || Number.isNaN(ga)) return;
      const wH = gh > ga ? 'W' : gh < ga ? 'L' : 'D';
      const wA = wH === 'W' ? 'L' : wH === 'L' ? 'W' : 'D';
      if (teamHistory[m.home]) teamHistory[m.home].push(wH);
      if (teamHistory[m.away]) teamHistory[m.away].push(wA);
    });
  });
  const streaks = [];
  Object.entries(teamHistory).forEach(([teamId, hist]) => {
    if (hist.length === 0) return;
    // Pega o final da sequencia (jogos mais recentes)
    const last = hist[hist.length - 1];
    if (last === 'D') return;
    let count = 0;
    for (let i = hist.length - 1; i >= 0; i--) {
      if (hist[i] === last) count++; else break;
    }
    streaks.push({ team: teamId, kind: last === 'W' ? 'win' : 'loss', count });
  });
  return streaks;
}

// Detecta todos os eventos noticiaveis no estado atual.
// Retorna array tipado pra o prompt builder formatar.
function detectJournalistEvents({ cs, bets, users, weeklyReady }) {
  const events = [];
  const rounds = (cs && cs.rounds) || [];
  const now = new Date();

  // 1. Proximos jogos (proximas 24h)
  rounds.forEach((round, ri) => {
    if (!Array.isArray(round)) return;
    round.forEach((m, gi) => {
      if (m.gh !== '' && m.ga !== '') return;
      const ts = parseGameTimestamp(m);
      if (!ts) return;
      const hoursAway = (ts - now) / 3600000;
      if (hoursAway > 0 && hoursAway <= 48) {
        events.push({
          type: 'upcoming_match',
          id: `up-r${ri}g${gi}`,
          round: ri + 1,
          home: TEAM(m.home).name,
          away: TEAM(m.away).name,
          date: m.date, time: m.time, day: m.day,
          hoursAway: Math.round(hoursAway),
          isToday: ts.toDateString() === now.toDateString(),
        });
      }
    });
  });

  // 2. Resultados da ultima rodada completa
  let lastCompleteIdx = -1;
  for (let i = rounds.length - 1; i >= 0; i--) {
    const r = rounds[i];
    if (Array.isArray(r) && r.length > 0 && r.every(g => g.gh !== '' && g.ga !== '')) {
      lastCompleteIdx = i; break;
    }
  }
  if (lastCompleteIdx >= 0) {
    const round = rounds[lastCompleteIdx];
    events.push({
      type: 'round_complete',
      id: `rc-${lastCompleteIdx}`,
      roundNum: lastCompleteIdx + 1,
      games: round.map(m => ({
        home: TEAM(m.home).name, away: TEAM(m.away).name,
        gh: parseInt(m.gh, 10), ga: parseInt(m.ga, 10),
      })),
    });
    // 3. Goleadas dentro dessa rodada
    round.forEach((m, gi) => {
      const gh = parseInt(m.gh, 10);
      const ga = parseInt(m.ga, 10);
      const diff = Math.abs(gh - ga);
      if (diff >= 4) {
        events.push({
          type: 'rout',
          id: `rout-r${lastCompleteIdx}g${gi}`,
          winner: gh > ga ? TEAM(m.home).name : TEAM(m.away).name,
          loser:  gh > ga ? TEAM(m.away).name : TEAM(m.home).name,
          gh, ga, diff,
        });
      }
    });
  }

  // 4. Apostas gordas vencidas (>= 500 PC)
  const bigWins = (bets || [])
    .filter(b => b.status === 'won' && (b.payout || 0) >= 500)
    .sort((a, b) => (b.settledAt || 0) - (a.settledAt || 0))
    .slice(0, 3);
  bigWins.forEach(b => {
    events.push({
      type: 'big_win',
      id: `bw-${b.id}`,
      user: b.user,
      stake: b.amount,
      payout: b.payout,
      legCount: (b.legs || []).length || 1,
      odds: b.combinedOdds || 0,
    });
  });

  // 5. Sequencias
  const streaks = computeStreaks(rounds);
  streaks.filter(s => s.count >= 3).forEach(s => {
    const teamObj = TEAMS.find(t => t.id === s.team);
    events.push({
      type: 'streak',
      id: `streak-${s.team}-${s.kind}`,
      team: teamObj ? teamObj.name : s.team,
      kind: s.kind, // 'win' | 'loss'
      count: s.count,
    });
  });

  // 6. Fim de temporada
  const allDone = rounds.length > 0 && rounds.every(r => Array.isArray(r) && r.length > 0 && r.every(g => g.gh !== '' && g.ga !== ''));
  if (allDone) {
    const st = computeStandings(rounds).sort((a, b) => b.p - a.p || (b.gp - b.gc) - (a.gp - a.gc));
    if (st.length >= 2) {
      events.push({
        type: 'season_end',
        id: 'season-end',
        champion: st[0].name,
        vice:     st[1].name,
        lanterna: st[st.length - 1].name,
        penultimo: st[st.length - 2].name,
        topScorerTeam: st[0].name,
        topScorerGoals: st[0].gp,
      });
    }
  }

  // 7. Bonus semanal disponivel
  if (weeklyReady) {
    events.push({
      type: 'weekly_bonus',
      id: 'weekly-bonus',
      amount: WEEKLY_PC,
    });
  }

  return events;
}

// Formata um evento como linha legivel pro prompt
function formatEventForPrompt(e) {
  switch (e.type) {
    case 'upcoming_match':
      return `JOGO PROXIMO: ${e.home} × ${e.away} — Rodada ${e.round}, ${e.day} ${e.date} às ${e.time}` + (e.isToday ? ' (HOJE)' : ` (em ${e.hoursAway}h)`);
    case 'round_complete':
      return `RODADA ${e.roundNum} FECHADA: ` + e.games.map(g => `${g.home} ${g.gh}×${g.ga} ${g.away}`).join(' · ');
    case 'rout':
      return `GOLEADA: ${e.winner} ${Math.max(e.gh, e.ga)}×${Math.min(e.gh, e.ga)} ${e.loser} (diferença de ${e.diff} gols)`;
    case 'big_win':
      return `APOSTA GORDA: @${e.user} acertou ${e.legCount} palpite${e.legCount > 1 ? 's' : ''} e levou ${e.payout} PC (apostou ${e.stake} PC, odds ${e.odds.toFixed(2)}x)`;
    case 'streak':
      return `SEQUÊNCIA: ${e.team} ${e.kind === 'win' ? 'venceu' : 'perdeu'} ${e.count} jogos seguidos`;
    case 'season_end':
      return `FIM DE TEMPORADA: Campeão ${e.champion} · Vice ${e.vice} · Penúltimo ${e.penultimo} · Lanterna ${e.lanterna} (artilheiro do líder: ${e.topScorerGoals} gols)`;
    case 'weekly_bonus':
      return `BÔNUS SEMANAL LIBERADO: ${e.amount} PC pra todo mundo reclamar (botão no topo da página)`;
    case 'manual':
      // Evento reportado pelo admin (polemica, manipulacao, fofoca, etc).
      // Marcado explicitamente pro Jornalista entender que é narrativa social,
      // nao dado de tabela.
      return `EVENTO REPORTADO PELO REDATOR-CHEFE${e.severity ? ' [' + e.severity.toUpperCase() + ']' : ''}: ${e.text}`;
    default:
      return JSON.stringify(e);
  }
}

const JOURNALIST_VOICE = `Você é o JORNALISTA OFICIAL do Primitivão Times, um pequeno bolão de amigos.

Estilo: manchete sensacionalista de jornal popular brasileiro. Irônico, dramático, com trocadilhos e zoeira. Pegue inspiração em manchetes do tipo:
- "Mohamed alcança −33 SG e sonha com −50"
- "Juca on fire! 4 jogos, 4 goleadas, 100% de zoeira"
- "Comissão do VARIMITIVÃO de plantão: 'errou de novo? não foi erro, foi intenção!'"
- "Magreza humilha Caco em modo carreira"

REGRAS DURAS:
- Use os nomes EXATOS dos jogadores: Bane, Mohamed, Potato, Magreza, Celin, Juca, Caco, Vitinho. Não invente outros.
- Não use emojis (regra do site).
- Não invente fatos — só use os EVENTOS DETECTADOS abaixo. Pode interpretar com humor, mas sem mentir dado numérico.
- Tom: zoeira de amigo, sem ofender de verdade. Pode chamar de "lanterna", "afundado", "humilhado", mas nada pesado.
- Português Brasil informal, frases curtas, verbos no presente sempre que possível.`;

function buildJournalistPrompt(selectedEvents) {
  const today = new Date().toLocaleDateString('pt-BR');
  const tags = ['RODADA', 'GOLEADA', 'RECORDE', 'PRÉVIA', 'ATUALIZAÇÃO', 'EDIÇÃO', 'PROMO'];
  return `${JOURNALIST_VOICE}

EVENTOS DETECTADOS (gere UMA única matéria cobrindo tudo, ou destaque o mais marcante):
${selectedEvents.map((e, i) => `${i + 1}. ${formatEventForPrompt(e)}`).join('\n')}

Devolva EXATAMENTE neste formato (JSON puro entre \`\`\`json e \`\`\`, depois o IMAGE_PROMPT em linha separada):

\`\`\`json
{
  "title": "manchete impactante em CAPS, max 60 chars",
  "subtitle": "linha de apoio explicando o lance, max 120 chars",
  "tag": "uma de: ${tags.join(' | ')}",
  "date": "${today}",
  "body": "Texto da matéria em 3 a 5 parágrafos. Use \\n\\n entre parágrafos. Sem markdown, sem emoji."
}
\`\`\`

IMAGE_PROMPT: "Descrição em INGLÊS pra gerar imagem horizontal 16:9 em DALL-E/Midjourney/Claude. Estilo: vintage Brazilian newspaper headline, sepia tones with orange #d76414 accents, dramatic composition, no real faces (use silhouettes or generic figures), include relevant visual elements from the events above. Format: 'vintage newspaper headline, [descrição do evento principal], orange and cream color palette, dramatic lighting, photorealistic but stylized'"`;
}

// Parseia a resposta do LLM externo. Aceita JSON entre fences ou direto.
function parseJournalistResponse(text) {
  const result = { title: '', subtitle: '', tag: 'NOVA', date: '', body: '', imagePrompt: '' };
  if (!text) return result;

  // Pega JSON (com ou sem fences)
  const fence = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  const inline = text.match(/\{[\s\S]*?"title"[\s\S]*?\}/);
  const jsonStr = (fence && fence[1]) || (inline && inline[0]) || '';
  if (jsonStr) {
    try {
      const j = JSON.parse(jsonStr);
      if (j.title)    result.title    = String(j.title).trim();
      if (j.subtitle) result.subtitle = String(j.subtitle).trim();
      if (j.tag)      result.tag      = String(j.tag).trim().toUpperCase();
      if (j.date)     result.date     = String(j.date).trim();
      if (j.body)     result.body     = String(j.body).trim();
    } catch (e) { /* segue com o que pegou */ }
  }

  // Pega IMAGE_PROMPT (linha solta)
  const ip = text.match(/IMAGE_PROMPT:\s*["']?([^\n"'][^\n]*?)["']?\s*$/m);
  if (ip) result.imagePrompt = ip[1].trim().replace(/^["']|["']$/g, '');

  if (!result.date) result.date = new Date().toLocaleDateString('pt-BR');
  return result;
}

// Eventos manuais ficam em localStorage por enquanto (admin só, do mesmo
// browser). Se quiser sincronizar entre dispositivos, mover pra Firestore.
const MANUAL_EVENTS_KEY = 'primitivao_manual_events';
const SEVERITIES = ['fofoca', 'polemica', 'escândalo'];

function loadManualEvents() {
  try { return JSON.parse(localStorage.getItem(MANUAL_EVENTS_KEY) || '[]'); }
  catch (e) { return []; }
}
function saveManualEvents(arr) {
  try { localStorage.setItem(MANUAL_EVENTS_KEY, JSON.stringify(arr)); }
  catch (e) { /* ignora */ }
}

// Volume do tabloide auto-incrementa a cada edição: guardamos o ÚLTIMO volume
// exportado (no browser do admin). Ao abrir/recarregar, o painel mostra
// último+1. Ao exportar, grava o volume daquela edição.
const TABLOID_VOL_KEY = 'primitivao_tabloid_vol';
function loadLastTabloidVol() {
  try { const v = parseInt(localStorage.getItem(TABLOID_VOL_KEY), 10); return Number.isFinite(v) ? v : null; }
  catch (e) { return null; }
}
function saveLastTabloidVol(n) {
  try { localStorage.setItem(TABLOID_VOL_KEY, String(n)); } catch (e) { /* ignora */ }
}

// ─── TABLOIDE (modelo pré-definido "PRIMITIVÃO TIMES") ──────────────────────
// Inputs reutilizáveis (top-level pra não remontar e perder foco a cada tecla).
function TpField({ label, value, onChange, placeholder }) {
  return (
    <label className="tp-fld">
      <span className="tp-fld-label">{label}</span>
      <input type="text" value={value || ''} placeholder={placeholder || ''} onChange={e => onChange(e.target.value)} className="tp-input" />
    </label>
  );
}
function TpTeamSelect({ value, onChange }) {
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value)} className="tp-input tp-select">
      <option value="">— sem time —</option>
      {TEAMS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  );
}

// Stats de um time pra ficha do tabloide.
function statsFromStanding(s) {
  if (!s) return [];
  const sg = (s.gp || 0) - (s.gc || 0);
  const apr = s.j > 0 ? Math.round((s.p / (s.j * 3)) * 100) : 0;
  return [
    { k: 'PTS', v: String(s.p ?? 0) },
    { k: 'V-E-D', v: `${s.v || 0}-${s.e || 0}-${s.d || 0}` },
    { k: 'GP', v: String(s.gp || 0) },
    { k: 'GC', v: String(s.gc || 0) },
    { k: 'SG', v: (sg >= 0 ? '+' : '') + sg },
    { k: 'APROV', v: apr + '%' },
  ];
}

// Confrontos + odds AUTOMÁTICOS — pega exatamente o que está aberto pra aposta
// (mesma fonte da aba APOSTAS): a RODADA ATUAL aberta (menor índice com jogos
// não jogados) com as odds 1X2 calculadas iguaizinhas às do cupom. Se a
// temporada acabou (nada aberto), cai pra última rodada com jogos.
function currentRoundMatchups(cs) {
  const rounds = cs?.rounds || [];
  if (!rounds.length) return [];
  const metrics = computeTeamMetrics(rounds);
  const toMatch = (g) => {
    const o = (computeGameOdds(g.home, g.away, metrics) || {})['1X2'] || {};
    return {
      homeId: g.home, awayId: g.away,
      oddHome: o.H != null ? o.H.toFixed(2) : '',
      oddDraw: o.D != null ? o.D.toFixed(2) : '',
      oddAway: o.A != null ? o.A.toFixed(2) : '',
    };
  };
  // 1) Rodada atual ABERTA = a que está em aposta agora (igual ao APOSTAS).
  const open = bettableGames(rounds);
  if (open.length) {
    const minRi = Math.min.apply(null, open.map(g => g.ri));
    return open.filter(g => g.ri === minRi).map(toMatch);
  }
  // 2) Temporada encerrada: usa a última rodada com jogos (recap).
  for (let i = rounds.length - 1; i >= 0; i--) {
    if (Array.isArray(rounds[i]) && rounds[i].length) return rounds[i].map(toMatch);
  }
  return [];
}

// ── ENGINE DE ZOEIRA (triggers) ──────────────────────────────────────────────
// Analisa a classificação + apostas e devolve as "histórias" que dispararam
// (cada uma já com nick, time/avatar, ícone e texto). O tabloide de POLÊMICA
// sorteia um subconjunto delas. Só dispara o que TEM dado (hoje, FIFA).
function tabloidStories(ctx) {
  const { standings = [], cs = null, teamPlayers = {} } = ctx || {};
  const nickOf = (teamId) => (teamPlayers || {})[teamId] || '';
  const out = [];
  const push = (id, teamId, nick, kicker, text, icon, tone) =>
    out.push({ id, teamId: teamId || '', nick: nick || '', kicker, text, icon, tone: tone || 'spice' });
  const played = standings.filter(s => s.j > 0);

  if (played.length) {
    const leader = standings[0];
    const last = standings[standings.length - 1];
    const inv = played.filter(s => s.d === 0).sort((a, b) => b.j - a.j)[0];
    const zer = played.filter(s => s.v === 0).sort((a, b) => b.j - a.j)[0];
    const goleador = played.slice().sort((a, b) => b.gp - a.gp)[0];
    const peneira = played.slice().sort((a, b) => b.gc - a.gc)[0];
    const piorSaldo = played.slice().sort((a, b) => (a.gp - a.gc) - (b.gp - b.gc))[0];
    const sg = (s) => (s.gp - s.gc >= 0 ? '+' : '') + (s.gp - s.gc);

    if (inv && zer && inv.id !== zer.id)
      push('combo', inv.id, nickOf(inv.id), 'OS DOIS LADOS DA FORÇA',
        `Enquanto ${inv.name} não perde faz ${inv.j} jogos, ${zer.name} não ganha NEM NA SORTE. Poesia pura do Primitivão.`, 'fire', 'spice');
    if (inv)
      push('invicto', inv.id, nickOf(inv.id), 'INVICTO',
        `${inv.name} ainda não sabe o que é perder: ${inv.v}V ${inv.e}E em ${inv.j} jogos. Tá voando.`, 'shield', 'good');
    if (zer)
      push('zerado', zer.id, nickOf(zer.id), 'PROCURA-SE UMA VITÓRIA',
        `${zer.name} já jogou ${zer.j} e não venceu nenhuma. Manda um abraço pro guerreiro.`, 'toilet', 'bad');
    const second = standings[1];
    if (leader && second && leader.p > 0 && (leader.p - second.p) <= 2)
      push('disputa', leader.id, nickOf(leader.id), 'PEGOU FOGO NA PONTA',
        `${leader.name} e ${second.name} separados por ${leader.p - second.p} ponto(s). A liderança tá em jogo.`, 'fire', 'spice');
    else if (leader && leader.p > 0)
      push('lider', leader.id, nickOf(leader.id), 'NA PONTA',
        `${leader.name} dispara com ${leader.p} pts. O resto que corra atrás.`, 'crown', 'good');
    if (last && leader && last.id !== leader.id)
      push('lanterna', last.id, nickOf(last.id), 'LANTERNA OFICIAL',
        `${last.name} amassado no fundo da tabela. Saldo ${sg(last)}. Vexame moldurado.`, 'toilet', 'bad');
    if (goleador && goleador.gp > 0)
      push('goleador', goleador.id, nickOf(goleador.id), 'ARTILHARIA',
        `${goleador.name} é a usina de gols: ${goleador.gp} marcados. Goleiro nenhum segura.`, 'football', 'good');
    if (peneira && peneira.gc > 0)
      push('peneira', peneira.id, nickOf(peneira.id), 'A PENEIRA',
        `${peneira.name} tomou ${peneira.gc} gols. A zaga é feita de papel-toalha.`, 'warning', 'bad');
    if (piorSaldo && (piorSaldo.gp - piorSaldo.gc) < 0)
      push('saldo', piorSaldo.id, nickOf(piorSaldo.id), 'NO VERMELHO',
        `${piorSaldo.name} com saldo ${sg(piorSaldo)}. Tá devendo gol pro campeonato.`, 'chart', 'bad');
  }

  // Eventos dos JOGOS (resultado marcante + confronto da semana) — de cs.rounds.
  const rounds = (cs && cs.rounds) || [];
  if (rounds.length) {
    // Maior goleada já registrada na temporada.
    let big = null;
    rounds.forEach(r => (r || []).forEach(g => {
      const gh = parseInt(g.gh, 10), ga = parseInt(g.ga, 10);
      if (Number.isNaN(gh) || Number.isNaN(ga)) return;
      const margin = Math.abs(gh - ga);
      if (margin >= 3 && (!big || margin > big.margin)) {
        big = { margin, winId: gh > ga ? g.home : g.away, loseId: gh > ga ? g.away : g.home, hi: Math.max(gh, ga), lo: Math.min(gh, ga) };
      }
    }));
    if (big)
      push('goleada', big.winId, nickOf(big.winId), 'MASSACRE',
        `${TEAM(big.winId).name} ${big.hi}x${big.lo} ${TEAM(big.loseId).name}. Foi covardia, chama o SAMU.`, 'skull', 'spice');
    // Confronto da semana (primeiro jogo aberto da rodada atual).
    const open = bettableGames(rounds);
    if (open.length) {
      const minRi = Math.min.apply(null, open.map(g => g.ri));
      const next = open.filter(g => g.ri === minRi)[0];
      if (next)
        push('proximo', next.home, nickOf(next.home), 'JOGO DA SEMANA',
          `Olho nesse: ${TEAM(next.home).name} × ${TEAM(next.away).name}. Vai pegar fogo.`, 'fire', 'spice');
    }
    // Resultados da ÚLTIMA rodada jogada — espalha a zoeira entre vários membros
    // (cada jogo envolve 2 jogadores), não só os extremos da tabela.
    let lastRi = -1;
    for (let i = rounds.length - 1; i >= 0; i--) {
      if ((rounds[i] || []).some(g => !Number.isNaN(parseInt(g.gh, 10)) && !Number.isNaN(parseInt(g.ga, 10)))) { lastRi = i; break; }
    }
    if (lastRi >= 0) {
      (rounds[lastRi] || []).forEach((g, gi) => {
        const gh = parseInt(g.gh, 10), ga = parseInt(g.ga, 10);
        if (Number.isNaN(gh) || Number.isNaN(ga)) return;
        if (gh === ga) {
          push('res' + lastRi + '-' + gi, g.home, nickOf(g.home), 'FICOU NO EMPATE',
            `${TEAM(g.home).name} ${gh}x${ga} ${TEAM(g.away).name}. Ninguém quis ganhar.`, 'football', 'spice');
        } else {
          const winId = gh > ga ? g.home : g.away, loseId = gh > ga ? g.away : g.home;
          const W = TEAM(winId).name, L = TEAM(loseId).name, hi = Math.max(gh, ga), lo = Math.min(gh, ga);
          const KICK = ['TOMOU FEIO', 'DANÇOU', 'AMASSADO', 'APANHOU'];
          const PHRASE = [
            `${L} levou ${hi}x${lo} do ${W}. Senta e chora.`,
            `${W} passou o rodo: ${hi}x${lo} no ${L}.`,
            `${L} apanhou ${hi}x${lo} do ${W}. Doeu até na alma.`,
            `${hi}x${lo}: ${W} fez do ${L} gato e sapato.`,
          ];
          push('res' + lastRi + '-' + gi, loseId, nickOf(loseId), KICK[gi % KICK.length], PHRASE[gi % PHRASE.length], 'football', 'bad');
        }
      });
    }
  }
  return out;
}

// Sorteia n histórias ESPALHANDO entre as pessoas: agrupa por jogador
// (teamId||nick) e pega em round-robin (1 de cada por vez), pra a zoeira não
// ficar concentrada num só membro. Dentro de cada grupo e na ordem dos grupos,
// embaralha (aleatório a cada geração).
function pickStories(stories, n) {
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  const groups = new Map();
  let k = 0;
  for (const s of stories) {
    const key = s.teamId || s.nick || ('_' + (k++));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const buckets = shuffle(Array.from(groups.values()).map(g => shuffle(g)));
  const out = [];
  let round = 0;
  while (out.length < n && buckets.some(b => b.length > round)) {
    for (const b of buckets) {
      if (out.length >= n) break;
      if (b.length > round) out.push(b[round]);
    }
    round++;
  }
  return out;
}

// Triggers de zoeira do BOLÃO DA COPA (dados diferentes: palpites, não jogos).
function copaStories(ranking, teamPlayers) {
  const out = [];
  if (!ranking || ranking.length < 2) return out;
  const rev = {};
  for (const [tid, n] of Object.entries(teamPlayers || {})) rev[String(n).toLowerCase()] = tid;
  const tf = (n) => rev[String(n).toLowerCase()] || '';
  const push = (id, nick, kicker, text, icon, tone) => out.push({ id, teamId: tf(nick), nick, kicker, text, icon, tone });
  const byPts = ranking.slice().sort((a, b) => b.pts - a.pts);
  const best = byPts[0], worst = byPts[byPts.length - 1];
  const maisExatos = ranking.slice().sort((a, b) => b.exatos - a.exatos)[0];
  const maisErrados = ranking.slice().sort((a, b) => b.errados - a.errados)[0];
  if (best) push('copa-lider', best.nick, 'PROFETA DO BOLÃO', `${best.nick} lidera com ${best.pts} pts. Tá lendo o futuro nos búzios.`, 'globe', 'good');
  if (worst && best && worst.nick !== best.nick) push('copa-furado', worst.nick, 'BOLA MURCHA', `${worst.nick} no fundo do bolão: ${worst.pts} pts. Chuta de olho fechado.`, 'toilet', 'bad');
  if (maisExatos && maisExatos.exatos > 0) push('copa-exatos', maisExatos.nick, 'CRAVOU O PLACAR', `${maisExatos.nick} cravou ${maisExatos.exatos} placar(es) exato(s). Vidente oficial.`, 'target', 'good');
  if (maisErrados && maisErrados.errados > 0) push('copa-errou', maisErrados.nick, 'ERROU FEIO', `${maisErrados.nick} furou ${maisErrados.errados} palpites. Acerta um, pelo amor.`, 'warning', 'bad');
  return out;
}

// Monta os dados do tabloide. `type`: 'rodada' | 'eventos' | 'polemica'.
// `champId`: campeonato (define wordmark/tema). Tudo editável no painel.
function buildTabloidData(ctx, champId, type) {
  const { cs, bets = [], users = {}, teamPlayers = {}, worldcup = null, wcFixtures = [] } = ctx || {};
  const id = champId || (CHAMPIONSHIPS.find(c => c.status === 'active') || CHAMPIONSHIPS[0]).id;
  const champMeta = TABLOID_CHAMP_OPTS.find(c => c.id === id) || CHAMPIONSHIPS[0];
  const theme = tabloidTheme(id);
  const t = type || 'rodada';
  const { standings } = computeChampStandings(id, cs);

  const base = {
    championship: id,
    type: t,
    volume: '09',
    masthead: 'PRIMITIVÃO TIMES',
    editionLabel: 'EDIÇÃO',
    cornerTag: champMeta.tag + ' · ' + champMeta.season.toUpperCase(),
    wordmark: theme.wordmark,
    accent: theme.accent,
    stamp: '',
    heroImage: '',
    headline: '',
    champion: { teamId: '', crown: true, title: '', stats: [], note: '' },
    sideBlocks: [],
    midStrip: { title: '', players: [] },
    matchups: [],
    boxes: [],
    stories: [],
    ticker: ['TORCIDA EM CHAMAS', 'RUMORES, TROCAS E OFERTAS', 'TODOS NO DISCORD', 'PRÓXIMA EDIÇÃO: DOMINGO'],
  };

  // ── COPA DO MUNDO (bolão de palpites — dados diferentes) ──
  if (id === 'copa') {
    const { ranking } = computeCopaStandings(worldcup, wcFixtures);
    const rev = {};
    for (const [tid, n] of Object.entries(teamPlayers || {})) rev[String(n).toLowerCase()] = tid;
    const tf = (n) => rev[String(n).toLowerCase()] || '';
    const lead = ranking[0] || null;
    const worst = ranking.length ? ranking[ranking.length - 1] : null;
    if (t === 'polemica') {
      return { ...base, stamp: 'OLHA O BARRACO!', headline: 'A FOFOCA DO BOLÃO', stories: pickStories(copaStories(ranking, teamPlayers), 6) };
    }
    if (t === 'eventos') {
      return {
        ...base, stamp: theme.stamp, headline: 'BOLÃO DA COPA DO MUNDO',
        boxes: [
          { title: 'COMO FUNCIONA', body: 'Placar exato = 3 pts · acertou o vencedor = 1 pt · errou = 0. Palpite jogo a jogo.' },
          { title: 'PRÊMIO', body: 'Glória eterna no Olimpo Primitivão + o crachá de Profeta do Bolão.' },
          { title: 'QUEM TÁ DENTRO', body: ranking.length ? ranking.length + ' palpiteiros na disputa.' : 'Bora palpitar, tá aberto!' },
        ],
      };
    }
    // rodada (recap do bolão)
    return {
      ...base,
      headline: 'COMO TÁ O BOLÃO',
      champion: lead
        ? { nick: lead.nick, teamId: tf(lead.nick), crown: true, title: `@${lead.nick.toUpperCase()} LIDERA O BOLÃO!`, stats: [{ k: 'PTS', v: String(lead.pts) }, { k: 'EXATOS', v: String(lead.exatos) }, { k: 'CERTOS', v: String(lead.certos) }, { k: 'PALPITES', v: String(lead.palpitados) }], note: '' }
        : base.champion,
      sideBlocks: (worst && lead && worst.nick !== lead.nick)
        ? [{ nick: worst.nick, teamId: tf(worst.nick), kicker: '@' + worst.nick, title: 'BOLA MURCHA', text: `${worst.pts} pts. Chuta de olho fechado.`, tone: 'bad', stats: [] }]
        : [],
      midStrip: { title: 'O PELOTÃO DO BOLÃO', players: ranking.slice(1, 5).map(r => ({ nick: r.nick, teamId: tf(r.nick), label: r.pts + ' PTS' })) },
      matchups: [],
    };
  }

  if (t === 'polemica') {
    return {
      ...base,
      stamp: 'OLHA O BARRACO!',
      headline: 'A FOFOCA DA SEMANA',
      stories: pickStories(tabloidStories({ standings, cs, teamPlayers }), 6),
    };
  }

  if (t === 'eventos') {
    const themeName = (champMeta.name.split('—').pop() || champMeta.tag).trim().toUpperCase();
    return {
      ...base,
      stamp: theme.stamp,
      headline: champMeta.status === 'active' ? 'EDIÇÃO ESPECIAL' : themeName + ' VEM AÍ!',
      boxes: [
        { title: 'PRÊMIO', body: 'Badge exclusivo pro campeão. Primeiro e único da edição.' },
        { title: 'REGRAS', body: 'Pontos corridos · ida e volta · todos contra todos · maior pontuação vence.' },
        { title: 'QUEM TÁ DENTRO', body: 'A lista tá crescendo. Não fica de fora.' },
      ],
      matchups: currentRoundMatchups(cs),
    };
  }

  // 'rodada' (default) — recap da classificação
  const champ = standings[0] || null;
  const vice = standings[1] || null;
  const nn = standings.length;
  const lanterna = nn ? standings[nn - 1] : null;
  return {
    ...base,
    headline: 'A RODADA PEGOU FOGO!',
    champion: champ
      ? { teamId: champ.id, crown: true, title: `${champ.name.toUpperCase()} NA LIDERANÇA!`, stats: statsFromStanding(champ), note: '' }
      : base.champion,
    sideBlocks: [
      vice ? { teamId: vice.id, kicker: vice.name.toUpperCase(), title: 'VICE NA BRIGA!', text: `${vice.p} pontos e segue colado.`, tone: 'good', stats: [] } : { teamId: '', kicker: '', title: '', text: '', tone: 'good', stats: [] },
      lanterna ? { teamId: lanterna.id, kicker: lanterna.name.toUpperCase() + ' FC', title: 'AFUNDA NA LANTERNA!', text: 'Último colocado, sem dó.', tone: 'bad', stats: statsFromStanding(lanterna) } : { teamId: '', kicker: '', title: '', text: '', tone: 'bad', stats: [] },
    ],
    midStrip: { title: 'A BRIGA NO MEIO DA TABELA', players: standings.slice(2, 6).map(s => ({ teamId: s.id, label: `${s.p} PTS` })) },
    matchups: currentRoundMatchups(cs),
  };
}

// O pôster renderizado (estilo jornal sépia "PRIMITIVÃO TIMES"). É o que
// vira imagem na exportação. Renderiza diferente por TIPO:
//   rodada   = recap (campeão + classificação + confrontos)
//   eventos  = central cheio (arte + caixas PRÊMIO/REGRAS + confrontos)
//   polemica = grid de zoeira (cards com avatar + alfinetada)
// Emblema/"arte" padrão da edição quando não há imagem subida: o ícone do
// campeonato dentro de um brasão (cor do campeonato) + caractere decorativo de
// fundo. Faz o tabloide nunca ficar com buraco vazio.
function TpEmblem({ icon, accent, size }) {
  return (
    <div className="tp-emblem" style={size ? { minHeight: size, height: size, width: size } : undefined}>
      {accent && <span className="tp-emblem-accent">{accent}</span>}
      <span className="tp-emblem-ring" style={size ? { width: size * 0.74, height: size * 0.74 } : undefined}>
        <Icon name={icon || 'star'} size={size ? Math.round(size * 0.42) : 150} />
      </span>
    </div>
  );
}

function TabloidPoster({ data, teamPlayers }) {
  const d = data || {};
  const t = d.type || 'rodada';
  const champ = d.champion || {};
  const champTheme = tabloidTheme(d.championship) || {};
  const champIcon = champTheme.icon || 'star';
  const champColor = champTheme.color || '#b3401a';
  const teamName = (id) => (id ? TEAM(id).name : '');
  const matchups = (d.matchups || []).filter(m => m && (m.homeId || m.awayId));
  return (
    <div className={'tp tp-type-' + t} style={{ '--tp-accent': champColor }}>
      <div className="tp-topband" />
      <div className="tp-watermark" aria-hidden="true"><Icon name={champIcon} size={660} /></div>
      <div className="tp-masthead">
        <span className="tp-vol">VOL. {d.volume || '—'}</span>
        <span className="tp-mast-ico"><Icon name={champIcon} size={17} /></span>
        <span className="tp-masthead-name">{d.masthead || 'PRIMITIVÃO TIMES'}</span>
        <span className="tp-edition">{d.editionLabel}</span>
        <span className="tp-corner">{d.cornerTag}</span>
      </div>

      <div className="tp-wordmark-row">
        <div className="tp-wordmark">{d.wordmark || 'PRIMITIVÃO'}</div>
        {d.accent && <div className="tp-accent">{d.accent}</div>}
      </div>
      {d.headline && (
        <div className="tp-headline">
          <span className="tp-headline-txt">{d.headline}</span>
          {d.stamp
            ? <span className="tp-stamp">{d.stamp}</span>
            : <span className="tp-flame"><Icon name={champIcon} size={40} /></span>}
        </div>
      )}

      {/* ── TIPO: RODADA (recap) ── */}
      {t === 'rodada' && (
        <div className="tp-body">
          <div className="tp-hero">
            <div className="tp-hero-figure">
              {champ.crown && !d.heroImage && <span className="tp-crown"><Icon name="crown" size={54} /></span>}
              {d.heroImage
                ? <img className="tp-hero-img" src={d.heroImage} alt="" crossOrigin="anonymous" />
                : ((champ.teamId || champ.nick)
                    ? <Avatar teamId={champ.teamId} nick={champ.nick} teamPlayers={teamPlayers} fullBody size={300} className="tp-hero-av" />
                    : <TpEmblem icon={champIcon} accent={d.accent} size={300} />)}
            </div>
            <div className="tp-hero-text">
              <div className="tp-hero-title">{champ.title}</div>
              {(champ.stats || []).length > 0 && (
                <div className="tp-stats">
                  {champ.stats.map((st, i) => (
                    <div key={i} className="tp-stat"><span className="tp-stat-v">{st.v}</span><span className="tp-stat-k">{st.k}</span></div>
                  ))}
                </div>
              )}
              {champ.note && <div className="tp-hero-note">{champ.note}</div>}
            </div>
          </div>
          <div className="tp-side">
            {(d.sideBlocks || []).filter(b => b && (b.teamId || b.nick || b.title || b.text)).map((b, i) => (
              <div key={i} className={'tp-block ' + (b.tone === 'bad' ? 'tp-block-bad' : 'tp-block-good')}>
                {(b.teamId || b.nick) && <Avatar teamId={b.teamId} nick={b.nick} teamPlayers={teamPlayers} fullBody size={130} className="tp-block-av" />}
                <div className="tp-block-text">
                  {b.kicker && <div className="tp-block-kicker">{b.kicker}</div>}
                  {b.title && <div className="tp-block-title">{b.title}</div>}
                  {b.text && <div className="tp-block-body">{b.text}</div>}
                  {(b.stats && b.stats.length > 0) && (
                    <div className="tp-stats tp-stats-sm">
                      {b.stats.map((st, j) => (
                        <div key={j} className="tp-stat"><span className="tp-stat-v">{st.v}</span><span className="tp-stat-k">{st.k}</span></div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {t === 'rodada' && d.midStrip && (d.midStrip.players || []).filter(p => p && (p.teamId || p.nick)).length > 0 && (
        <div className="tp-strip">
          {d.midStrip.title && <div className="tp-strip-title"><span className="tp-star"><Icon name={champIcon} size={16} /></span>{d.midStrip.title}</div>}
          <div className="tp-strip-players">
            {d.midStrip.players.filter(p => p && (p.teamId || p.nick)).map((p, i) => (
              <div key={i} className="tp-strip-player">
                <Avatar teamId={p.teamId} nick={p.nick} teamPlayers={teamPlayers} size={66} />
                <span className="tp-strip-name">{p.nick ? '@' + p.nick : teamName(p.teamId)}</span>
                {p.label && <span className="tp-strip-label">{p.label}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TIPO: EVENTOS (arte central + caixas) ── */}
      {t === 'eventos' && (
        <div className="tp-event">
          <div className="tp-event-hero">
            {d.heroImage
              ? <img className="tp-hero-img" src={d.heroImage} alt="" crossOrigin="anonymous" />
              : <TpEmblem icon={champIcon} accent={d.accent} />}
          </div>
          <div className="tp-boxes">
            {(d.boxes || []).filter(b => b && (b.title || b.body)).map((b, i) => (
              <div key={i} className="tp-box">
                {b.title && <div className="tp-box-title"><Icon name={champIcon} size={14} /> {b.title}</div>}
                {b.body && <div className="tp-box-body">{b.body}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TIPO: POLÊMICA (grid de zoeira) ── */}
      {t === 'polemica' && ((d.stories || []).length > 0 ? (
        <div className="tp-stories">
          {(d.stories || []).map((s, i) => (
            <div key={i} className={'tp-story tp-story-' + (s.tone || 'spice')}>
              <div className="tp-story-figure">
                <Avatar teamId={s.teamId} nick={s.nick} teamPlayers={teamPlayers} size={94} />
                <span className="tp-story-ico"><Icon name={s.icon || 'fire'} size={20} /></span>
              </div>
              <div className="tp-story-text">
                {s.kicker && <div className="tp-story-kicker">{s.kicker}</div>}
                <div className="tp-story-body">{s.text}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="tp-empty-note">
          <TpEmblem icon={champIcon} accent={d.accent} size={220} />
          <div className="tp-empty-note-txt">SEM BARRACO ESSA SEMANA… <strong>AINDA.</strong><br />Quando os jogos rolarem, a zoeira vem sozinha.</div>
        </div>
      ))}

      {(t === 'rodada' || t === 'eventos') && matchups.length > 0 && (
        <div className="tp-matches">
          {matchups.map((m, i) => (
            <div key={i} className="tp-match">
              <div className="tp-match-side">
                {m.homeId && <Avatar teamId={m.homeId} size={52} />}
                <span className="tp-match-name">{teamName(m.homeId)}</span>
                <span className="tp-match-odd">{m.oddHome}</span>
              </div>
              <div className="tp-match-mid">
                <span className="tp-match-x">×</span>
                {m.oddDraw && <span className="tp-match-draw">{m.oddDraw}</span>}
              </div>
              <div className="tp-match-side tp-match-away">
                {m.awayId && <Avatar teamId={m.awayId} size={52} />}
                <span className="tp-match-name">{teamName(m.awayId)}</span>
                <span className="tp-match-odd">{m.oddAway}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {(d.ticker || []).filter(Boolean).length > 0 && (
        <div className="tp-ticker">
          {d.ticker.filter(Boolean).map((tk, i) => (
            <span key={i} className="tp-ticker-item"><Icon name="flag" size={13} /> {tk}</span>
          ))}
        </div>
      )}
    </div>
  );
}

const TABLOID_TYPES = [
  { id: 'rodada',   label: 'FINAL DE RODADA', icon: 'trophy',    hint: 'Recap: campeão, classificação e os confrontos.' },
  { id: 'eventos',  label: 'EVENTOS',         icon: 'newspaper', hint: 'Central, cheio: arte + prêmio/regras + confrontos.' },
  { id: 'polemica', label: 'POLÊMICA & ZOEIRA', icon: 'fire',    hint: 'Zoeira pura: alfinetadas automáticas com nome e avatar.' },
];

// O painel: pickers (campeonato + tipo) + formulário + prévia + exportar PNG.
function TabloidBuilderPanel({ cs, bets, users, teamPlayers, worldcup, wcFixtures }) {
  const firstActive = (CHAMPIONSHIPS.find(c => c.status === 'active') || CHAMPIONSHIPS[0]).id;
  // Monta os dados do (campeonato, tipo) já com o VOLUME avançado.
  const makeData = (cid, tp) => {
    const d = buildTabloidData({ cs, bets, users, teamPlayers, worldcup, wcFixtures }, cid, tp);
    const last = loadLastTabloidVol();
    if (last != null) d.volume = String(last + 1).padStart(2, '0');
    return d;
  };
  const [champId, setChampId] = useState(firstActive);
  const [type, setType] = useState('rodada');
  const [data, setData] = useState(() => makeData(firstActive, 'rodada'));
  const [exporting, setExporting] = useState(false);
  const posterRef = useRef(null);
  const stageRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [stageH, setStageH] = useState(0);

  // O pôster tem largura fixa (1040px) pra exportar sempre igual; aqui a gente
  // mede a coluna e escala a PRÉVIA pra caber, sem mexer no tamanho real.
  useEffect(() => {
    const fit = () => {
      const stage = stageRef.current, poster = posterRef.current;
      if (!stage || !poster) return;
      const avail = stage.clientWidth;
      const natW = poster.offsetWidth || 1040;
      const s = Math.min(1, avail / natW);
      setScale(s);
      setStageH(poster.offsetHeight * s);
    };
    fit();
    window.addEventListener('resize', fit);
    const t = setTimeout(fit, 120); // re-mede depois das imagens carregarem
    return () => { window.removeEventListener('resize', fit); clearTimeout(t); };
  }, [data]);

  const patch = (p) => setData(prev => ({ ...prev, ...p }));
  const patchChamp = (p) => setData(prev => ({ ...prev, champion: { ...prev.champion, ...p } }));
  const patchBlock = (i, p) => setData(prev => ({ ...prev, sideBlocks: prev.sideBlocks.map((b, j) => j === i ? { ...b, ...p } : b) }));
  const patchMatch = (i, p) => setData(prev => ({ ...prev, matchups: prev.matchups.map((m, j) => j === i ? { ...m, ...p } : m) }));
  const patchStrip = (p) => setData(prev => ({ ...prev, midStrip: { ...prev.midStrip, ...p } }));
  const patchStripPlayer = (i, p) => setData(prev => ({ ...prev, midStrip: { ...prev.midStrip, players: prev.midStrip.players.map((pl, j) => j === i ? { ...pl, ...p } : pl) } }));
  const patchTicker = (i, v) => setData(prev => ({ ...prev, ticker: prev.ticker.map((t, j) => j === i ? v : t) }));
  const patchChampStat = (i, v) => setData(prev => ({ ...prev, champion: { ...prev.champion, stats: prev.champion.stats.map((s, j) => j === i ? { ...s, v } : s) } }));
  const patchBox = (i, p) => setData(prev => ({ ...prev, boxes: prev.boxes.map((b, j) => j === i ? { ...b, ...p } : b) }));
  const patchStory = (i, p) => setData(prev => ({ ...prev, stories: prev.stories.map((s, j) => j === i ? { ...s, ...p } : s) }));

  const selectChamp = (id) => { setChampId(id); setData(makeData(id, type)); };
  const selectType = (tp) => { setType(tp); setData(makeData(champId, tp)); };

  const rerollStories = () => {
    let all;
    if (champId === 'copa') {
      const { ranking } = computeCopaStandings(worldcup, wcFixtures);
      all = copaStories(ranking, teamPlayers);
    } else {
      const { standings } = computeChampStandings(champId, cs);
      all = tabloidStories({ standings, cs, teamPlayers });
    }
    if (!all.length) { showToast('Sem dados ainda pra gerar zoeira (faltam jogos/palpites).', 'error'); return; }
    setData(prev => ({ ...prev, stories: pickStories(all, 6) }));
    showToast('Zoeira re-sorteada!', 'success');
  };

  const reload = () => {
    if (!confirm('Recarregar tudo da classificação? Você perde as edições manuais desta edição.')) return;
    setData(makeData(champId, type));
    showToast('Tabloide recarregado.', 'success');
  };

  // Imagem de destaque (arte da IA): lê como data URL — robusto na exportação
  // (não depende de CORS) e fica embutido no PNG.
  const onHeroFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { showToast('Imagem muito grande (máx 4MB).', 'error'); return; }
    const reader = new FileReader();
    reader.onload = () => patch({ heroImage: reader.result });
    reader.onerror = () => showToast('Não consegui ler a imagem.', 'error');
    reader.readAsDataURL(file);
  };

  const refreshMatchups = () => {
    const m = currentRoundMatchups(cs);
    setData(prev => ({ ...prev, matchups: m }));
    showToast(m.length ? `${m.length} confronto(s) e odds atualizados da rodada atual.` : 'Nenhum confronto aberto encontrado.', m.length ? 'success' : 'error');
  };

  const matchups = data.matchups || [];
  const players = (data.midStrip && data.midStrip.players) || [];

  const exportPng = async () => {
    const node = posterRef.current;
    if (!node) return;
    const lib = window.htmlToImage;
    if (!lib || !lib.toPng) {
      showToast('Exportador não carregou. Tire um print da prévia (ela é fiel).', 'error');
      return;
    }
    setExporting(true);
    const baseOpts = { pixelRatio: 2, width: node.offsetWidth, height: node.offsetHeight, backgroundColor: '#d9c5a2', style: { transform: 'none', margin: '0' } };
    // Watchdog: o html-to-image pode travar embutindo as Google Fonts. 1ª tentativa
    // completa (15s); se travar, 2ª tentativa SEM fontes (mais robusta — fonte cai
    // no fallback do sistema, mas exporta). Botão nunca fica preso pra sempre.
    const race = (opts, ms) => Promise.race([
      lib.toPng(node, opts),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
    ]);
    try {
      let dataUrl;
      try {
        dataUrl = await race(baseOpts, 15000);
      } catch (e1) {
        console.warn('export: 1a tentativa travou, tentando sem fontes', e1);
        dataUrl = await race({ ...baseOpts, skipFonts: true }, 15000);
      }
      const a = document.createElement('a');
      a.download = `primitivao-times-vol-${(data.volume || 'x')}.png`;
      a.href = dataUrl;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      // Auto-incremento: grava o volume desta edição. A próxima vez que abrir
      // (ou recarregar) já vem como o próximo número.
      const vNum = parseInt(data.volume, 10);
      if (Number.isFinite(vNum)) saveLastTabloidVol(vNum);
      const nextVol = String((Number.isFinite(vNum) ? vNum : 0) + 1).padStart(2, '0');
      showToast(`Tabloide VOL.${data.volume} exportado! Próxima edição = VOL.${nextVol}.`, 'success');
    } catch (e) {
      console.warn('export tabloide falhou', e);
      showToast('Falha ao exportar. Tire um print da prévia.', 'error');
    } finally { setExporting(false); }
  };

  return (
    <div className="tp-builder">
      <p style={{ marginTop: 0, lineHeight: 1.5, fontSize: 13 }}>
        Escolhe o <strong>campeonato</strong> e o <strong>tipo</strong> de edição. Os campos já
        vêm preenchidos da classificação — ajusta o texto e <strong>exporta em PNG</strong>.
      </p>

      <div className="tp-pickers">
        <label className="tp-fld" style={{ maxWidth: 240 }}>
          <span className="tp-fld-label">Campeonato</span>
          <select value={champId} onChange={e => selectChamp(e.target.value)} className="tp-input tp-select">
            {TABLOID_CHAMP_OPTS.map(c => (
              <option key={c.id} value={c.id}>{c.tag}{c.status !== 'active' ? ' (em breve)' : ''}</option>
            ))}
          </select>
        </label>
        <div className="tp-type-pick">
          <span className="tp-fld-label">Tipo de tabloide</span>
          <div className="tp-type-btns">
            {TABLOID_TYPES.map(tt => (
              <button key={tt.id} type="button" title={tt.hint}
                      className={'tp-type-btn ' + (type === tt.id ? 'active' : '')}
                      onClick={() => selectType(tt.id)}>
                <Icon name={tt.icon} size={15} /> {tt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0 4px' }}>
        <button type="button" onClick={reload} className="tp-btn-ghost"><Icon name="refresh" size={14} /> RECARREGAR</button>
        {type === 'polemica' && <button type="button" onClick={rerollStories} className="tp-btn-ghost"><Icon name="dice" size={14} /> RE-SORTEAR ZOEIRA</button>}
        <button type="button" onClick={exportPng} disabled={exporting} className="tp-btn-go">{exporting ? 'EXPORTANDO…' : 'EXPORTAR PNG'}</button>
      </div>

      <div className="tp-builder-grid">
        {/* ─── FORM ─── */}
        <div className="tp-form">
          <div className="tp-form-sec">CABEÇALHO</div>
          <div className="tp-form-row">
            <TpField label="Volume" value={data.volume} onChange={v => patch({ volume: v })} />
            <TpField label="Edição" value={data.editionLabel} onChange={v => patch({ editionLabel: v })} />
          </div>
          <TpField label="Cabeçalho (canto)" value={data.cornerTag} onChange={v => patch({ cornerTag: v })} />
          <TpField label="MANCHETE" value={data.headline} onChange={v => patch({ headline: v })} />

          <div className="tp-form-sec">ARTE & TÍTULO</div>
          <TpField label="Título grande (wordmark)" value={data.wordmark} onChange={v => patch({ wordmark: v })} placeholder="PRIMITIVÃO / MORTAL KOMBAT" />
          <div className="tp-form-row">
            <TpField label="Selo/carimbo (vermelho)" value={data.stamp} onChange={v => patch({ stamp: v })} placeholder="FIGHT! / EXTRA" />
            <TpField label="Caractere decorativo" value={data.accent} onChange={v => patch({ accent: v })} placeholder="闘" />
          </div>
          <label className="tp-fld">
            <span className="tp-fld-label">Imagem de destaque (arte da IA, opcional)</span>
            <input type="file" accept="image/*" onChange={onHeroFile} className="tp-input tp-file" />
          </label>
          {data.heroImage && (
            <button type="button" className="tp-btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => patch({ heroImage: '' })}>
              <Icon name="x" size={13} /> REMOVER IMAGEM
            </button>
          )}
          <div style={{ fontSize: 10, color: 'rgba(28,22,18,0.55)', lineHeight: 1.4 }}>
            A arte ilustrada (lutador, dragão etc.) é imagem — gera na IA e joga aqui. O resto do tabloide (título, caixas, odds) o modelo monta sozinho por cima.
          </div>

          {type === 'rodada' && (<>
          <div className="tp-form-sec">CAMPEÃO (destaque)</div>
          <label className="tp-fld"><span className="tp-fld-label">Time</span><TpTeamSelect value={data.champion.teamId} onChange={v => patchChamp({ teamId: v })} /></label>
          <TpField label="Título" value={data.champion.title} onChange={v => patchChamp({ title: v })} />
          <TpField label="Frase de apoio" value={data.champion.note} onChange={v => patchChamp({ note: v })} placeholder="ex: NÃO TEM MAIS JEITO: TÍTULO É DELE!" />
          <label className="tp-chk"><input type="checkbox" checked={!!data.champion.crown} onChange={e => patchChamp({ crown: e.target.checked })} /> Mostrar coroa</label>
          {(data.champion.stats || []).length > 0 && (
            <div className="tp-stat-edit">
              {data.champion.stats.map((s, i) => (
                <label key={i} className="tp-stat-edit-row"><span>{s.k}</span><input type="text" value={s.v} onChange={e => patchChampStat(i, e.target.value)} className="tp-input" /></label>
              ))}
            </div>
          )}

          {data.sideBlocks.map((b, i) => (
            <div key={i}>
              <div className="tp-form-sec">{i === 0 ? 'BLOCO 1 (boa notícia)' : 'BLOCO 2 (vexame)'}</div>
              <label className="tp-fld"><span className="tp-fld-label">Time</span><TpTeamSelect value={b.teamId} onChange={v => patchBlock(i, { teamId: v })} /></label>
              <div className="tp-form-row">
                <TpField label="Etiqueta" value={b.kicker} onChange={v => patchBlock(i, { kicker: v })} />
                <TpField label="Título" value={b.title} onChange={v => patchBlock(i, { title: v })} />
              </div>
              <TpField label="Texto" value={b.text} onChange={v => patchBlock(i, { text: v })} />
            </div>
          ))}

          <div className="tp-form-sec">FAIXA DO MEIO</div>
          <TpField label="Título da faixa" value={data.midStrip.title} onChange={v => patchStrip({ title: v })} />
          {players.map((p, i) => (
            <div key={i} className="tp-form-row">
              <label className="tp-fld" style={{ flex: 2 }}><span className="tp-fld-label">{`Jogador ${i + 1}`}</span><TpTeamSelect value={p.teamId} onChange={v => patchStripPlayer(i, { teamId: v })} /></label>
              <TpField label="Etiqueta" value={p.label} onChange={v => patchStripPlayer(i, { label: v })} />
            </div>
          ))}

          </>)}

          {type === 'eventos' && (<>
            <div className="tp-form-sec">CAIXAS (prêmio / regras / inscritos)</div>
            {(data.boxes || []).map((b, i) => (
              <div key={i}>
                <TpField label={`Caixa ${i + 1} — título`} value={b.title} onChange={v => patchBox(i, { title: v })} />
                <TpField label="Texto" value={b.body} onChange={v => patchBox(i, { body: v })} />
              </div>
            ))}
          </>)}

          {type === 'polemica' && (<>
            <div className="tp-form-sec">ZOEIRA (automática — re-sorteia ou edita)</div>
            {(data.stories || []).map((s, i) => (
              <div key={i} className="tp-story-edit">
                <div className="tp-form-row">
                  <label className="tp-fld" style={{ flex: 2 }}><span className="tp-fld-label">Quem</span><TpTeamSelect value={s.teamId} onChange={v => patchStory(i, { teamId: v })} /></label>
                  <TpField label="Etiqueta" value={s.kicker} onChange={v => patchStory(i, { kicker: v })} />
                </div>
                <TpField label="Alfinetada" value={s.text} onChange={v => patchStory(i, { text: v })} />
              </div>
            ))}
            {(data.stories || []).length === 0 && (
              <div style={{ fontSize: 11, color: 'rgba(28,22,18,0.55)', lineHeight: 1.4 }}>
                Sem zoeira ainda (falta dado de classificação). Clica em RE-SORTEAR ZOEIRA quando tiver jogos jogados.
              </div>
            )}
          </>)}

          {(type === 'rodada' || type === 'eventos') && (<>
          <div className="tp-form-sec">CONFRONTOS (com odds)</div>
          <button type="button" className="tp-btn-ghost" style={{ alignSelf: 'flex-start', marginBottom: 6 }} onClick={refreshMatchups}>
            <Icon name="refresh" size={13} /> PUXAR CONFRONTOS DA RODADA
          </button>
          {matchups.map((m, i) => (
            <div key={i} className="tp-match-edit">
              <TpTeamSelect value={m.homeId} onChange={v => patchMatch(i, { homeId: v })} />
              <input type="text" value={m.oddHome} onChange={e => patchMatch(i, { oddHome: e.target.value })} className="tp-input tp-odd" placeholder="1.45" />
              <input type="text" value={m.oddDraw} onChange={e => patchMatch(i, { oddDraw: e.target.value })} className="tp-input tp-odd" placeholder="X" />
              <input type="text" value={m.oddAway} onChange={e => patchMatch(i, { oddAway: e.target.value })} className="tp-input tp-odd" placeholder="2.10" />
              <TpTeamSelect value={m.awayId} onChange={v => patchMatch(i, { awayId: v })} />
            </div>
          ))}
          </>)}

          <div className="tp-form-sec">RODAPÉ (ticker)</div>
          {(data.ticker || []).map((t, i) => (
            <TpField key={i} label={`Item ${i + 1}`} value={t} onChange={v => patchTicker(i, v)} />
          ))}
        </div>

        {/* ─── PRÉVIA ─── */}
        <div className="tp-preview-wrap">
          <div className="small-label" style={{ marginBottom: 8 }}>PRÉVIA (é o que vira PNG)</div>
          <div className="tp-stage" ref={stageRef} style={{ height: stageH || undefined }}>
            <div className="tp-scaler" style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
              <div ref={posterRef}>
                <TabloidPoster data={data} teamPlayers={teamPlayers} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function JournalistAdminPanel({ cs, bets, users, teamPlayers, worldcup, wcFixtures }) {
  return (
    <div className="card">
      <div className="card-head">
        <div className="title">JORNALISTA</div>
        <div className="sub">MODELO TABLOIDE</div>
      </div>
      <div className="card-body">
        <TabloidBuilderPanel cs={cs} bets={bets} users={users} teamPlayers={teamPlayers} worldcup={worldcup} wcFixtures={wcFixtures} />
      </div>
    </div>
  );
}

// ─── ADMIN: DISCORD PANEL ──────────────────────────────────────────────────
function DiscordAdminPanel({ webhook }) {
  const [url, setUrl] = useState(webhook || '');
  const [savedMsg, setSavedMsg] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [customMsg, setCustomMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setUrl(webhook || ''); }, [webhook]);

  const save = async () => {
    setBusy(true); setSavedMsg('');
    try {
      await saveDiscordWebhook(url.trim());
      setSavedMsg('URL salva.');
    } catch (e) {
      setSavedMsg('Erro: ' + (e.message || e));
    } finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true); setTestMsg('');
    const r = await postToDiscord(url.trim(), 'Teste de webhook do Primitivão — se você está vendo isso, funcionou.', { username: 'Primitivão Bot' });
    setTestMsg(r.ok ? 'Teste enviado.' : 'Falhou: ' + r.err);
    setBusy(false);
  };

  const postCustom = async () => {
    if (!customMsg.trim()) return;
    setBusy(true); setTestMsg('');
    const r = await postToDiscord(url.trim(), customMsg, { username: 'Primitivão' });
    setTestMsg(r.ok ? 'Postado.' : 'Falhou: ' + r.err);
    if (r.ok) setCustomMsg('');
    setBusy(false);
  };

  return (
    <div className="card">
      <div className="card-head">
        <div className="title">DISCORD</div>
        <div className="sub">WEBHOOK + POSTS RÁPIDOS</div>
      </div>
      <div className="card-body">
        <p style={{ marginTop: 0, lineHeight: 1.5 }}>
          Cole aqui a URL do <strong>webhook do canal do Discord</strong>.
          Crie em <em>Editar Canal → Integrações → Webhooks → Novo Webhook → Copiar URL</em>.
          Qualquer mensagem postada usa o nome "Primitivão".
        </p>
        <label className="small-label">URL DO WEBHOOK</label>
        <input
          type="text"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://discord.com/api/webhooks/..."
          style={{ width: '100%', padding: 10, fontSize: 12, border: '2px solid var(--pv-charcoal)', background: 'var(--pv-bone-2)', fontFamily: 'monospace', marginTop: 6, boxSizing: 'border-box' }}
        />
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={save} disabled={busy} style={{ background: 'var(--pv-orange)', color: 'var(--pv-bone)', border: 'none', padding: '8px 16px', fontWeight: 800, fontSize: 12, letterSpacing: '0.14em', cursor: busy ? 'wait' : 'pointer' }}>
            SALVAR URL
          </button>
          <button onClick={test} disabled={busy || !url.trim()} style={{ background: 'transparent', color: 'var(--pv-charcoal)', border: '2px solid var(--pv-charcoal)', padding: '8px 16px', fontWeight: 800, fontSize: 12, letterSpacing: '0.14em', cursor: busy ? 'wait' : 'pointer' }}>
            TESTAR
          </button>
        </div>
        {savedMsg && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--pv-green)', fontWeight: 700 }}>{savedMsg}</div>}
        {testMsg && <div style={{ marginTop: 6, fontSize: 12, color: testMsg.startsWith('Falhou') ? 'var(--pv-red)' : 'var(--pv-green)', fontWeight: 700 }}>{testMsg}</div>}

        <div style={{ marginTop: 22, paddingTop: 14, borderTop: '2px dashed rgba(28,22,18,0.18)' }}>
          <div className="small-label">POSTAR MENSAGEM CUSTOMIZADA</div>
          <textarea
            value={customMsg}
            onChange={e => setCustomMsg(e.target.value)}
            placeholder="ex: BÔNUS SEMANAL LIBERADO! Vai lá pegar 500 PC."
            rows={3}
            maxLength={1900}
            style={{ width: '100%', padding: 10, fontSize: 13, border: '2px solid var(--pv-charcoal)', background: 'var(--pv-bone)', fontFamily: 'inherit', marginTop: 6, boxSizing: 'border-box', resize: 'vertical' }}
          />
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: 'rgba(28,22,18,0.5)', fontWeight: 700, letterSpacing: '0.12em' }}>{customMsg.length}/1900</span>
            <button onClick={postCustom} disabled={busy || !customMsg.trim() || !url.trim()} style={{ marginLeft: 'auto', background: 'var(--pv-charcoal)', color: 'var(--pv-bone)', border: 'none', padding: '8px 16px', fontWeight: 800, fontSize: 12, letterSpacing: '0.14em', cursor: busy ? 'wait' : 'pointer' }}>
              POSTAR
            </button>
          </div>
        </div>

        <div style={{ marginTop: 22, padding: 10, background: 'rgba(215,100,20,0.08)', borderLeft: '4px solid var(--pv-orange)', fontSize: 11, lineHeight: 1.5 }}>
          <strong>Posts automáticos planejados</strong> (em breve): bônus semanal liberado,
          fim de campeonato com Hall da Fama/Vergonha, recorde de aposta vencida.
          Por enquanto: usa o post customizado pra avisos do canal.
        </div>
      </div>
    </div>
  );
}

// ─── ADMIN: NEWS PANEL ──────────────────────────────────────────────────────
// Edita o array de notícias do INÍCIO. Salva em Firestore top-level `news`.
// Quando `remoteNews === null` (vazio no Firestore), exporta o array hardcoded
// `NEWS` como ponto de partida (admin não perde o conteúdo original).
function NewsAdminPanel({ remoteNews }) {
  // Estrutura de cada news: { id, title, subtitle, date, tag, image, body, at }
  // `body` aqui é texto/markdown simples (renderizado com lineBreaks). Se quiser
  // HTML rico, edita pelo arquivo direto.
  const seed = remoteNews && remoteNews.length > 0
    ? remoteNews
    : NEWS.map(n => ({
        id: n.id,
        title: n.title || '',
        subtitle: n.subtitle || '',
        date: n.date || '',
        tag: n.tag || '',
        image: n.image || '',
        body: '', // body original era JSX, não dá pra serializar — começa vazio
        at: Date.now(),
      }));
  const [list, setList] = useState(seed);
  const [editing, setEditing] = useState(null); // id da news em edição
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (remoteNews && remoteNews.length > 0) setList(remoteNews);
  }, [remoteNews]);

  const save = async () => {
    setBusy(true); setMsg('');
    try {
      await saveRemoteNews(list);
      setMsg('Salvo. Veja em INÍCIO.');
    } catch (e) {
      setMsg('Erro: ' + (e.message || e));
    } finally { setBusy(false); }
  };

  const updateNews = (id, patch) => setList(list.map(n => n.id === id ? { ...n, ...patch } : n));
  const removeNews = (id) => setList(list.filter(n => n.id !== id));
  const addNews = () => {
    const id = 'n-' + Date.now();
    setList([{
      id, title: 'NOVA NOTÍCIA', subtitle: '', date: new Date().toLocaleDateString('pt-BR'),
      tag: 'ATUALIZAÇÃO', image: '', body: '', at: Date.now(),
    }, ...list]);
    setEditing(id);
  };

  return (
    <div className="card">
      <div className="card-head">
        <div className="title">NEWS DO INÍCIO</div>
        <div className="sub">{list.length} POST{list.length === 1 ? '' : 'S'}</div>
      </div>
      <div className="card-body">
        <p style={{ marginTop: 0, lineHeight: 1.5, fontSize: 13 }}>
          Edita as notícias que aparecem na aba INÍCIO. Texto do corpo aceita
          quebras de linha simples (sem HTML). Imagem é o caminho relativo
          (ex: <code>news/minha-news.jpg</code>) — coloca o arquivo na pasta
          <code>apostas/news/</code> antes.
        </p>
        {(!remoteNews || remoteNews.length === 0) && (
          <div style={{ padding: 10, background: 'rgba(215,100,20,0.10)', borderLeft: '4px solid var(--pv-orange)', fontSize: 12, lineHeight: 1.5, marginBottom: 14 }}>
            <strong>Atenção:</strong> as 3 notícias originais têm corpo em JSX
            no código e foram clonadas aqui SEM o corpo. Se você clicar SALVAR
            TUDO agora, elas vão aparecer no INÍCIO com texto vazio. Edite o
            corpo de cada uma antes de salvar.
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button onClick={addNews} style={{ background: 'var(--pv-orange)', color: 'var(--pv-bone)', border: 'none', padding: '8px 16px', fontWeight: 800, fontSize: 12, letterSpacing: '0.14em', cursor: 'pointer' }}>
            + NOVA
          </button>
          <button onClick={save} disabled={busy} style={{ background: 'var(--pv-charcoal)', color: 'var(--pv-bone)', border: 'none', padding: '8px 16px', fontWeight: 800, fontSize: 12, letterSpacing: '0.14em', cursor: busy ? 'wait' : 'pointer' }}>
            {busy ? 'SALVANDO…' : 'SALVAR TUDO'}
          </button>
          {msg && <span style={{ alignSelf: 'center', fontSize: 12, color: msg.startsWith('Erro') ? 'var(--pv-red)' : 'var(--pv-green)', fontWeight: 700 }}>{msg}</span>}
        </div>

        {list.map(n => {
          const open = editing === n.id;
          return (
            <div key={n.id} style={{ border: '2px solid var(--pv-charcoal)', marginBottom: 10, background: 'var(--pv-bone)' }}>
              <div style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', background: open ? 'rgba(215,100,20,0.08)' : 'transparent' }} onClick={() => setEditing(open ? null : n.id)}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 13 }}>{n.title || '(sem título)'}</div>
                  <div style={{ fontSize: 10, color: 'rgba(28,22,18,0.55)', letterSpacing: '0.12em', fontWeight: 700, marginTop: 2 }}>
                    {n.date} · {n.tag}
                  </div>
                </div>
                <Icon name={open ? 'caret-up' : 'caret-down'} size={13} />
                <button onClick={(e) => { e.stopPropagation(); if (confirm('Remover notícia "' + n.title + '"?')) removeNews(n.id); }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--pv-red)', padding: 4, display: 'inline-flex' }}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
              {open && (
                <div style={{ padding: 12, borderTop: '1.5px dashed rgba(28,22,18,0.18)' }}>
                  <NewsField label="TÍTULO" value={n.title} onChange={v => updateNews(n.id, { title: v })} />
                  <NewsField label="SUBTÍTULO" value={n.subtitle} onChange={v => updateNews(n.id, { subtitle: v })} />
                  <NewsField label="DATA (ex: 21/05/2026)" value={n.date} onChange={v => updateNews(n.id, { date: v })} />
                  <NewsField label="TAG (ex: ATUALIZAÇÃO, PROMO, EDIÇÃO)" value={n.tag} onChange={v => updateNews(n.id, { tag: v })} />
                  <NewsField label="CAMINHO DA IMAGEM (opcional)" value={n.image} onChange={v => updateNews(n.id, { image: v })} placeholder="news/exemplo.jpg" />
                  <NewsField label="CORPO (quebras de linha são preservadas)" value={n.body} onChange={v => updateNews(n.id, { body: v })} multiline />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NewsField({ label, value, onChange, placeholder, multiline }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label className="small-label">{label}</label>
      {multiline ? (
        <textarea
          value={value || ''} onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={6}
          style={{ width: '100%', padding: 10, fontSize: 13, border: '1.5px solid rgba(28,22,18,0.4)', background: 'var(--pv-bone-2)', fontFamily: 'inherit', marginTop: 4, boxSizing: 'border-box', resize: 'vertical' }}
        />
      ) : (
        <input
          type="text" value={value || ''} onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ width: '100%', padding: 8, fontSize: 13, border: '1.5px solid rgba(28,22,18,0.4)', background: 'var(--pv-bone-2)', fontFamily: 'inherit', marginTop: 4, boxSizing: 'border-box' }}
        />
      )}
    </div>
  );
}

// Lista de todos os ícones desenhados no componente <Icon> (pra galeria).
const ALL_ICON_NAMES = [
  'star', 'shield', 'sparkle', 'check', 'eye', 'eye-off', 'target', 'trophy',
  'globe', 'coin', 'coin-stack', 'coin-fire', 'arrow-right', 'arrow-up-right',
  'arrow-down', 'refresh', 'caret-up', 'caret-down', 'x', 'warning', 'lock',
  'unlock', 'flag', 'question', 'medal', 'gift', 'menu', 'skull', 'fire',
  'book', 'newspaper', 'dice', 'user', 'gamepad', 'phone', 'chart', 'pin',
  'square-filled', 'chat', 'ticket', 'flask', 'tag', 'trash', 'toilet',
  'toothbrush', 'crown', 'bolt', 'heart', 'football', 'sword', 'whistle',
  'snowflake', 'rocket',
];

// ─── ADMIN: CATÁLOGO (galeria de tudo — QA visual) ──────────────────────────
// Mostra TODOS os ícones, títulos, distintivos e molduras renderizados.
// Admin não tem time/inventário, então sem isso ele nunca veria o catálogo.
// Aqui tudo aparece desbloqueado, só pra conferência.
function CatalogoAdminPanel({ cs, teamPlayers }) {
  const badges = ITEMS.filter(i => i.slot === 'badge');
  const frames = ITEMS.filter(i => i.slot === 'frame');
  // Avatar exemplo pro preview de moldura/badge — usa um time real qualquer.
  const sampleTeam = (TEAMS[0] && TEAMS[0].id) || 'bane';

  const origemTxt = (item) => item.price != null ? `${item.price} PC` : 'conquista';

  return (
    <div>
      {/* ÍCONES */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <div className="title">ÍCONES</div>
          <div className="sub">{ALL_ICON_NAMES.length} DISPONÍVEIS</div>
        </div>
        <div className="card-body">
          <div className="catalogo-icons">
            {ALL_ICON_NAMES.map(n => (
              <div key={n} className="catalogo-icon-cell" title={n}>
                <Icon name={n} size={24} />
                <span>{n}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* TÍTULOS */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <div className="title">TÍTULOS</div>
          <div className="sub">{TITLE_DEFS.length} NO CATÁLOGO</div>
        </div>
        <div className="card-body">
          <div className="catalogo-grid">
            {TITLE_DEFS.map(t => (
              <div key={t.id} className="catalogo-card" style={{ borderLeftColor: t.color }}>
                <div className="catalogo-card-head">
                  <span style={{ color: t.color, display: 'inline-flex' }}><Icon name={t.icon} size={22} /></span>
                  <span className="catalogo-card-name" style={{ color: t.color }}>{t.name}</span>
                </div>
                <div className="catalogo-card-desc">{t.desc}</div>
                <div className="catalogo-card-id">id: {t.id}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* DISTINTIVOS */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <div className="title">DISTINTIVOS</div>
          <div className="sub">{badges.length} NO CATÁLOGO</div>
        </div>
        <div className="card-body">
          <div className="catalogo-grid">
            {badges.map(b => (
              <div key={b.id} className={'catalogo-card rarity-' + b.rarity} style={{ borderLeftColor: b.color }}>
                <div className="catalogo-card-head">
                  <Avatar teamId={sampleTeam} cosmetics={{ badge: b.id }} size={48} />
                  <div>
                    <div className="catalogo-card-name" style={{ color: b.color }}>{b.name}</div>
                    <div className="catalogo-card-meta">{b.rarity} · {origemTxt(b)}</div>
                  </div>
                </div>
                <div className="catalogo-card-desc">{b.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* MOLDURAS */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <div className="title">MOLDURAS</div>
          <div className="sub">{frames.length} NO CATÁLOGO</div>
        </div>
        <div className="card-body">
          <div className="catalogo-grid">
            {frames.map(f => (
              <div key={f.id} className={'catalogo-card rarity-' + f.rarity} style={{ borderLeftColor: f.color }}>
                <div className="catalogo-card-head">
                  <Avatar teamId={sampleTeam} cosmetics={{ frame: f.id }} size={56} />
                  <div>
                    <div className="catalogo-card-name" style={{ color: f.color }}>{f.name}</div>
                    <div className="catalogo-card-meta">{f.rarity} · {origemTxt(f)}</div>
                  </div>
                </div>
                <div className="catalogo-card-desc">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminView({ isFullAdmin, bets, users, adjustPc, adjustCc, splitCurrency, ccCtx, teamPlayers, setTeamPlayer, discordWebhook, remoteNews, cs, weeklyReady, worldcup, wcFixtures }) {
  const [splitting, setSplitting] = useState(false);
  const handleSplit = async () => {
    if (splitting) return;
    if (!window.confirm('SEPARAR MOEDAS agora?\n\nDevolve em PC o que cada um gastou na loja, remove os itens comprados (recompra com CC depois), mantém os drops de conquista e cria o saldo CC (zerado). Roda uma vez (idempotente).')) return;
    setSplitting(true);
    try {
      const r = await splitCurrency();
      if (r && r.err) showToast('Erro na migração: ' + r.err, 'error');
      else showToast('Moedas separadas! PC devolvido a quem comprou; loja agora roda em Campeão Coins.', 'success');
    } finally { setSplitting(false); }
  };
  // Tabs do admin: USUÁRIOS / TIMES / NEWS / JORNALISTA / DISCORD / BACKUP / PERIGO.
  // PERIGO ficou em aba separada pra não ser clicado por engano.
  const [tab, setTab] = useState(isFullAdmin ? 'usuarios' : 'jornalista');
  const playerTeam = reverseTeamMap(teamPlayers);

  return (
    <>
      {!isFullAdmin && (
        <div className="mk-admin-note" style={{ marginBottom: 12 }}><Icon name="shield" size={12} /> Você é MODERADOR — lança placar e trava aposta. Operações de moeda e perigo ficam só com o admin.</div>
      )}
      <div className="tabs" style={{ marginBottom: 14 }}>
        {isFullAdmin && <button className={'tab ' + (tab === 'usuarios' ? 'active' : '')} onClick={() => setTab('usuarios')}>USUÁRIOS</button>}
        <button className={'tab ' + (tab === 'times' ? 'active' : '')} onClick={() => setTab('times')}>TIMES</button>
        <button className={'tab ' + (tab === 'news' ? 'active' : '')} onClick={() => setTab('news')}>NEWS</button>
        <button className={'tab ' + (tab === 'jornalista' ? 'active' : '')} onClick={() => setTab('jornalista')}>JORNALISTA</button>
        {isFullAdmin && <button className={'tab ' + (tab === 'catalogo' ? 'active' : '')} onClick={() => setTab('catalogo')}>CATÁLOGO</button>}
        {isFullAdmin && <button className={'tab ' + (tab === 'discord' ? 'active' : '')} onClick={() => setTab('discord')}>DISCORD</button>}
        <button className={'tab ' + (tab === 'backup' ? 'active' : '')} onClick={() => setTab('backup')}>BACKUP</button>
        {isFullAdmin && <button className={'tab ' + (tab === 'perigo' ? 'active' : '')} onClick={() => setTab('perigo')} style={{ color: tab === 'perigo' ? '#c33' : 'rgba(195,51,51,0.6)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="warning" size={12} /> PERIGO</button>}
      </div>

      {tab === 'news' && <NewsAdminPanel remoteNews={remoteNews} />}
      {tab === 'jornalista' && <JournalistAdminPanel cs={cs} bets={bets} users={users} teamPlayers={teamPlayers} worldcup={worldcup} wcFixtures={wcFixtures} />}
      {tab === 'catalogo' && isFullAdmin && <CatalogoAdminPanel cs={cs} teamPlayers={teamPlayers} />}
      {tab === 'discord' && isFullAdmin && <DiscordAdminPanel webhook={discordWebhook} />}

      {tab === 'usuarios' && isFullAdmin && (
        <div className="card">
          <div className="card-head"><div className="title">USUÁRIOS</div><div className="sub">{Object.keys(users).length} CADASTRADOS</div></div>
          <div className="card-body">
            <div style={{ marginBottom: 14, padding: 12, border: '2px solid var(--pv-orange)', background: 'rgba(215,100,20,0.08)' }}>
              <div style={{ fontWeight: 800, fontSize: 12, letterSpacing: '0.06em' }}>SEPARAR MOEDAS — PC (apostas) × CAMPEÃO COINS (loja)</div>
              <div style={{ fontSize: 11, color: 'rgba(28,22,18,0.7)', lineHeight: 1.4, margin: '6px 0 10px' }}>
                Roda UMA vez: devolve em PC o que cada um gastou na loja, remove os itens comprados (pra recomprar com CC), mantém os drops de conquista e cria o saldo CC (zerado). Idempotente — rodar de novo não duplica.
              </div>
              <button onClick={handleSplit} disabled={splitting} style={{ background: 'var(--pv-charcoal)', color: 'var(--pv-bone)', border: 'none', padding: '8px 16px', fontWeight: 800, fontSize: 12, letterSpacing: '0.12em', cursor: splitting ? 'wait' : 'pointer' }}>
                {splitting ? 'RODANDO…' : 'RODAR MIGRAÇÃO'}
              </button>
            </div>
            {Object.entries(users).map(([nick, u]) => {
              const tid = playerTeam[nick];
              const team = tid ? TEAM(tid) : null;
              const pm = { width: 30, height: 30, fontWeight: 800, cursor: 'pointer', border: '1.5px solid var(--pv-charcoal)', background: 'transparent', lineHeight: 1 };
              const pmPlus = { ...pm, background: 'var(--pv-orange)', color: 'var(--pv-bone)' };
              return (
                <div key={nick} className="lb-row" style={{ gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
                  <div>
                    <div className="lb-nick">@{nick}</div>
                    {team && (
                      <div style={{ fontSize: 10, letterSpacing: '0.18em', fontWeight: 800, color: 'var(--pv-orange)', marginTop: 2 }}>
                        TIME: {team.name.toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', color: 'rgba(28,22,18,0.55)' }}>PC</span>
                      <button onClick={() => adjustPc(nick, -50)} style={pm}>-</button>
                      <div className="lb-pc mono" style={{ minWidth: 52, textAlign: 'center' }}>{u.pc || 0}</div>
                      <button onClick={() => adjustPc(nick, 50)} style={pmPlus}>+</button>
                    </div>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', color: 'var(--pv-orange)' }}>CC</span>
                      <button onClick={() => adjustCc(nick, -50)} style={pm}>-</button>
                      <div className="lb-pc mono" style={{ minWidth: 52, textAlign: 'center' }}>{ccBalanceFor(nick, u, ccCtx)}</div>
                      <button onClick={() => adjustCc(nick, 50)} style={pmPlus}>+</button>
                    </div>
                  </div>
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
          {/* RESTAURAR/HISTÓRICO sobrescrevem TODO o estado (destrutivo) -> só admin
              de verdade. Mod baixa backup (read-only), mas não restaura. */}
          {isFullAdmin ? <><HistoricBackupsPanel /><RestorePanel /></> : (
            <div className="mk-admin-note" style={{ marginTop: 14 }}><Icon name="lock" size={11} /> Restaurar backup é só do admin (sobrescreve tudo). Você pode baixar o backup acima.</div>
          )}
        </>
      )}

      {tab === 'perigo' && isFullAdmin && (
        <DangerZone />
      )}
    </>
  );
}

function BackupPanel() {
  const [status, setStatus] = useState(null); // null | 'running' | {ok, users?, bets?, error?}
  // Stats ao vivo do que tem pra backupar — busca direto do Firestore
  // (sem download) ao montar o componente.
  const [preview, setPreview] = useState(null); // { users, bets, wcPicks, wcResults, comments, news, interests }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await BET_DOC().get();
        if (cancelled || !snap.exists) return;
        const data = snap.data() || {};
        const parsed = (typeof data.json === 'string') ? (() => {
          try { return JSON.parse(data.json); } catch (_) { return {}; }
        })() : {};
        const wc = data.worldcup || parsed.worldcup || {};
        const usersList = Object.values(parsed.users || {});
        setPreview({
          users:     Object.keys(parsed.users || {}).length,
          bets:      (parsed.bets || []).length,
          teams:     Object.keys(parsed.teamPlayers || {}).length,
          interests: Object.values(data.interests || parsed.interests || {})
                            .reduce((s, x) => s + Object.keys(x || {}).length, 0),
          comments:  Object.values(data.comments || {})
                            .reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0),
          wcPicks:   Object.values(wc.picks || {})
                            .reduce((s, perUser) => s + Object.keys(perUser || {}).length, 0),
          wcPickers: Object.keys(wc.picks || {}).length,
          wcResults: Object.keys(wc.results || {}).length,
          news:      Array.isArray(data.news) ? data.news.length : 0,
          // Stats por user pra confirmar que nada se perdeu
          withTitle:     usersList.filter(u => u && u.title).length,
          withCosmetics: usersList.filter(u => u && u.cosmetics && Object.keys(u.cosmetics).length > 0).length,
          withInventory: usersList.filter(u => u && Array.isArray(u.inventory) && u.inventory.length > 0).length,
          totalPc:       usersList.reduce((s, u) => s + (u?.pc || 0), 0),
          discordSet:    !!data.discord_webhook,
        });
      } catch (e) { /* fail silent — botão continua funcionando */ }
    })();
    return () => { cancelled = true; };
  }, [status]); // refresh após download bem-sucedido

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
          Gera um arquivo <code>.json</code> com <strong>todos os dados do site</strong>:
          usuários, apostas (cupons), classificação, vínculos de time, inscrições,
          comentários, news, palpites e resultados do bolão da Copa do Mundo, e
          URL do webhook do Discord. Guarde em local seguro (Drive, email pra você mesmo).
        </p>

        {preview && (
          <div style={{
            marginBottom: 14, padding: 12,
            background: 'rgba(0,0,0,0.04)', border: '1.5px solid rgba(28,22,18,0.2)',
            fontSize: 12, lineHeight: 1.7,
          }}>
            <div style={{ fontSize: 10, letterSpacing: '0.22em', fontWeight: 800, marginBottom: 6, color: 'var(--pv-orange)' }}>O QUE VAI NO BACKUP AGORA</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6 }}>
              <div>· <strong>{preview.users}</strong> usuários ({preview.totalPc.toLocaleString('pt-BR')} PC total)</div>
              <div>· <strong>{preview.bets}</strong> apostas (tickets)</div>
              <div>· <strong>{preview.teams}</strong> times vinculados</div>
              <div>· <strong>{preview.interests}</strong> inscrições</div>
              <div>· <strong>{preview.comments}</strong> comentários</div>
              <div>· <strong>{preview.wcPicks}</strong> palpites da Copa ({preview.wcPickers} jogadores)</div>
              <div>· <strong>{preview.wcResults}</strong> resultados da Copa</div>
              <div>· <strong>{preview.news}</strong> news publicadas</div>
              <div>· <strong>{preview.withTitle}</strong> jogadores c/ título exibido</div>
              <div>· <strong>{preview.withCosmetics}</strong> jogadores c/ cosmético equipado</div>
              <div>· <strong>{preview.withInventory}</strong> jogadores c/ inventário (items comprados)</div>
              <div>· Discord webhook: <strong>{preview.discordSet ? 'configurado' : 'não'}</strong></div>
            </div>
          </div>
        )}

        <button onClick={onClick} disabled={status === 'running'}
          style={{ background: 'var(--pv-orange)', color: 'var(--pv-bone)', padding: '10px 20px', fontWeight: 800, border: 'none', letterSpacing: '0.16em', fontSize: 12, cursor: status === 'running' ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {status === 'running' ? 'GERANDO…' : <><Icon name="arrow-down" size={14} /> BAIXAR BACKUP JSON</>}
        </button>
        {status && status !== 'running' && status.ok && (
          <p style={{ marginTop: 14, color: 'var(--pv-green, #2a8)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="check" size={14} /> Backup baixado: {status.users} usuários, {status.bets} apostas, {status.wcPicks || 0} palpites da Copa ({status.wcResults || 0} resultados), {status.news || 0} news, {status.titles || 0} c/ título, {status.cosmetics || 0} c/ cosmético equipado, {status.inventory || 0} c/ inventário.
          </p>
        )}
        {status && status !== 'running' && !status.ok && (
          <p style={{ marginTop: 14, color: 'var(--pv-red, #c33)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="x" size={14} /> Erro: {status.error}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── BACKUPS HISTÓRICOS ─────────────────────────────────────────────────────
// Lista os snapshots diários do GitHub Action (pasta `backups/` no repo)
// e permite baixar qualquer um direto pelo painel admin.
function HistoricBackupsPanel() {
  const [files, setFiles] = useState(null); // null | { error } | array
  const [busy, setBusy] = useState({}); // {nome: true} enquanto baixa
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('https://api.github.com/repos/BanePlayss/primitivao/contents/backups?ref=main');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (cancelled) return;
        const jsons = (Array.isArray(data) ? data : [])
          .filter(f => f.name && f.name.endsWith('.json'))
          .map(f => ({
            name: f.name,
            size: f.size || 0,
            downloadUrl: f.download_url,
            // Tenta extrair data do nome (YYYY-MM-DD ou primitivao-backup-YYYY-MM-DDTHH-MM-SS)
            sortKey: (f.name.match(/\d{4}-\d{2}-\d{2}/) || [''])[0],
          }))
          .sort((a, b) => b.sortKey.localeCompare(a.sortKey));
        setFiles(jsons);
      } catch (e) {
        if (!cancelled) setFiles({ error: e.message || String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const downloadOne = async (file) => {
    setBusy(b => ({ ...b, [file.name]: true })); setMsg('');
    try {
      const res = await fetch(file.downloadUrl);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = file.name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMsg(`Baixou ${file.name}.`);
    } catch (e) {
      setMsg('Erro: ' + (e.message || e));
    } finally {
      setBusy(b => { const next = { ...b }; delete next[file.name]; return next; });
    }
  };

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card-head">
        <div className="title">BACKUPS HISTÓRICOS</div>
        <div className="sub">SNAPSHOTS DIÁRIOS DO GITHUB ACTION</div>
      </div>
      <div className="card-body">
        <p style={{ marginTop: 0, lineHeight: 1.5, fontSize: 13 }}>
          Backups gerados automaticamente todo dia às 07:00 UTC (04:00 BRT) pelo
          GitHub Action. Cada um é um snapshot completo do estado naquele momento
          (incluindo palpites da Copa). Clica em DOWNLOAD pra baixar e usar no
          RESTAURAR BACKUP abaixo.
        </p>

        {files === null && (
          <div style={{ fontSize: 12, color: 'rgba(28,22,18,0.55)' }}>Carregando lista do GitHub…</div>
        )}
        {files && files.error && (
          <div style={{ padding: 10, background: 'rgba(195,51,51,0.10)', borderLeft: '4px solid #c33', fontSize: 12, color: '#7a2222', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="warning" size={13} /> Falha ao listar backups do GitHub: {files.error}
          </div>
        )}
        {Array.isArray(files) && files.length === 0 && (
          <div className="empty"><div className="e2">Nenhum backup ainda.</div></div>
        )}
        {Array.isArray(files) && files.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 360, overflowY: 'auto' }}>
            {files.map(f => (
              <div key={f.name} style={{
                display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'center',
                padding: '8px 10px',
                borderBottom: '1px dashed rgba(28,22,18,0.15)',
                fontSize: 12,
              }}>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>{f.name}</div>
                <div style={{ fontSize: 10, color: 'rgba(28,22,18,0.55)', letterSpacing: '0.12em', fontWeight: 700 }}>
                  {(f.size / 1024).toFixed(0)}KB
                </div>
                <button
                  onClick={() => downloadOne(f)}
                  disabled={!!busy[f.name]}
                  style={{
                    background: 'transparent', color: 'var(--pv-charcoal)',
                    border: '1.5px solid var(--pv-charcoal)',
                    padding: '5px 10px', fontWeight: 800, fontSize: 10, letterSpacing: '0.14em',
                    cursor: busy[f.name] ? 'wait' : 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <Icon name="arrow-down" size={11} /> {busy[f.name] ? 'BAIXANDO…' : 'DOWNLOAD'}
                </button>
              </div>
            ))}
          </div>
        )}
        {msg && <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: msg.startsWith('Erro') ? 'var(--pv-red)' : 'var(--pv-green)' }}>{msg}</div>}
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
        comments:  Object.values(apostas?.comments || {})
                          .reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0),
        wcPicks:   Object.values(apostas?.worldcup?.picks || {})
                          .reduce((s, perUser) => s + Object.keys(perUser || {}).length, 0),
        wcPickers: Object.keys(apostas?.worldcup?.picks || {}).length,
        wcResults: Object.keys(apostas?.worldcup?.results || {}).length,
        news:      Array.isArray(apostas?.news) ? apostas.news.length : 0,
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
        <div className="title"><Icon name="refresh" size={16} /> RESTAURAR BACKUP</div>
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
          <div style={{ marginTop: 12, padding: 10, background: '#fce4e4', border: '1.5px solid #c33', color: '#7a2222', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="x" size={13} /> {preview.error}
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
              · <strong>{preview.comments || 0}</strong> comentários em news<br />
              · <strong>Copa do Mundo:</strong> {preview.wcPicks || 0} palpites de {preview.wcPickers || 0} jogadores · {preview.wcResults || 0} resultados<br />
              · <strong>{preview.news || 0}</strong> news publicadas<br />
              · <strong>{preview.rounds}</strong> rodadas de classificação<br />
              · Exportado em: <code>{preview.exportedAt}</code> (v{preview.version})
            </div>
            {preview.version < 4 && (
              <div style={{ marginTop: 10, padding: 8, background: 'rgba(215,100,20,0.10)', borderLeft: '4px solid var(--pv-orange)', fontSize: 11, lineHeight: 1.4, color: 'var(--pv-charcoal)' }}>
                <Icon name="warning" size={11} /> Backup antigo (v{preview.version}). Pode não conter os palpites da Copa do Mundo, comentários ou news (campos top-level adicionados a partir da v4).
              </div>
            )}

            <button
              onClick={onRestore}
              disabled={status === 'running'}
              style={{
                marginTop: 14,
                background: 'var(--pv-charcoal)', color: 'var(--pv-bone)',
                padding: '10px 20px', fontWeight: 800, border: 'none',
                letterSpacing: '0.16em', fontSize: 12,
                cursor: status === 'running' ? 'wait' : 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              {status === 'running' ? 'RESTAURANDO…' : <><Icon name="refresh" size={13} /> RESTAURAR (sobrescreve atual)</>}
            </button>
          </div>
        )}

        {status && status !== 'running' && status.ok && (
          <p style={{ marginTop: 14, color: 'var(--pv-green, #2a8)', fontWeight: 700, display: 'flex', alignItems: 'flex-start', gap: 6, lineHeight: 1.5 }}>
            <Icon name="check" size={14} />
            <span>
              Backup restaurado. {status.applied.users} usuários, {status.applied.bets} apostas,{' '}
              {status.applied.teams} vínculos de time, {status.applied.rounds} rodadas,{' '}
              {status.applied.interests} inscrições, {status.applied.comments || 0} comentários,{' '}
              {status.applied.wcPicks || 0} palpites da Copa ({status.applied.wcResults || 0} resultados),{' '}
              {status.applied.news || 0} news.
            </span>
          </p>
        )}
        {status && status !== 'running' && !status.ok && (
          <p style={{ marginTop: 14, color: 'var(--pv-red, #c33)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="x" size={14} /> {status.error}
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
        <div className="title" style={{ color: '#ff8a8a', display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="warning" size={16} /> ZONA DE PERIGO</div>
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
              display: 'inline-flex', alignItems: 'center', gap: 8,
            }}
          >
            {status === 'running' ? 'EXECUTANDO…' : <><Icon name="trash" size={13} /> DELETAR TUDO AGORA</>}
          </button>
        </div>
        {status && status !== 'running' && status.ok && (
          <p style={{ marginTop: 14, color: 'var(--pv-green, #2a8)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="check" size={14} /> Tudo resetado. Backup baixado: {status.backedUp.users} usuários, {status.backedUp.bets} apostas salvos no arquivo.
          </p>
        )}
        {status && status !== 'running' && !status.ok && (
          <p style={{ marginTop: 14, color: 'var(--pv-red, #c33)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="x" size={14} /> {status.error}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── MOUNT ──────────────────────────────────────────────────────────────────
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
