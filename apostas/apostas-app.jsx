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
//    - DADOS BASE (TEAMS, MARKETS, NEWS, START_PC, ROUND_BONUS_PC, etc)
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
//    - ACH (critérios de conquista — FONTE ÚNICA dos predicados)
//    - ACHIEVEMENTS (registro unificado: cat/rarity/points/rewards) + TITLE_DEFS
//      alias + titlesForNick/achievementScore/computeHunterRanking/TitleBadge
//    - ITEMS (molduras + distintivos) + effectiveInventory/itemsDroppedFor
//      (drops derivam de ACHIEVEMENTS[].rewards)
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

const { useState, useEffect, useLayoutEffect, useMemo, useRef } = React;

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

// Chaves DEFAULT da FIFA (só pro seed de um doc novo via defaultRounds). Os
// nicks REAIS dos jogadores vivem no teamPlayers (teamId->nick) e a migração
// (ADMIN -> MIGRAR FIFA) deriva a identidade dos VALORES desse mapa, NÃO daqui
// (na vida real teamId != nick: potato->ivansf, caco->spider, vitinho->ricle).
const NICKS_FOR_FIFA = ['bane', 'mohamed', 'potato', 'magreza', 'celin', 'juca', 'caco', 'vitinho'];

// Resolve uma chave de fixture FIFA pro @nick do usuário. Tolerante aos DOIS
// formatos: teamId (ANTES da migração) -> nick via teamPlayers; nick (DEPOIS) ->
// identidade. Chave desconhecida cai no próprio valor (nunca quebra/crasha).
function fifaUserOf(key, teamPlayers) {
  return (teamPlayers && teamPlayers[key]) || key;
}

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
console.log('%c PRIMITIVÃO v=20260712-mkfut3 ', 'background:#d76414;color:#fff;font-weight:800;padding:4px 8px;');

const CHAMPIONSHIPS = [
  { id: 'fifa', name: 'Primitivão — FIFA 2026',                  season: 'Season 1', tag: 'FIFA', status: 'active' },
  { id: 'mk',   name: 'Primitivão — Mortal Kombat 2026',         season: 'Season 1', tag: 'MK',   status: 'active' },
  { id: 'rl',   name: 'Primitivão — Rocket League 2026',         season: 'Season 1', tag: 'RL',   status: 'soon'   },
  { id: 'lol',  name: 'Primitivão — League of Legends 2026',     season: 'Season 1', tag: 'LoL',  status: 'soon'   },
  { id: 'cs',   name: 'Primitivão — Counter-Strike 2026',        season: 'Season 1', tag: 'CS',   status: 'soon'   },
  { id: 'gwyf', name: 'Primitivão — Golf With Your Friends 2026', season: 'Season 1', tag: 'GWYF', status: 'soon'   },
  { id: 'valorant', name: 'Primitivão — Valorant 2026',          season: 'Season 1', tag: 'VALORANT', status: 'soon' },
  { id: 'tft',  name: 'Primitivão — Teamfight Tactics 2026',     season: 'Season 1', tag: 'TFT',  status: 'soon'   },
  { id: 'pokemon', name: 'Primitivão — Pokémon 2026',            season: 'Season 1', tag: 'POKÉMON', status: 'soon' },
  { id: 'magic', name: 'Primitivão — Magic: The Gathering 2026', season: 'Season 1', tag: 'MAGIC', status: 'soon'  },
  { id: 'crab', name: 'Primitivão — Crab Game 2026',             season: 'Season 1', tag: 'CRAB GAME', status: 'soon' },
  // FIFA Season 2: nova temporada do MESMO jogo — só inscrição por enquanto.
  // id próprio (fifa2) pra não colidir com a Season 1 ativa; vira 'active' o dia
  // que ganhar fixtures/chaveamento próprios.
  { id: 'fifa2', name: 'Primitivão — FIFA 2026',                 season: 'Season 2', tag: 'FIFA', status: 'soon'   },
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
  tft:      { wordmark: 'TEAMFIGHT',      accent: '戦', stamp: 'GG!',      icon: 'chess',     color: '#6c5ce7' },
  pokemon:  { wordmark: 'POKÉMON',        accent: '捕', stamp: 'GOTCHA!',  icon: 'pokeball',  color: '#d63b2f' },
  magic:    { wordmark: 'MAGIC',          accent: '魔', stamp: 'TAP!',     icon: 'cards',     color: '#7a3fb0' },
  crab:     { wordmark: 'CRAB GAME',      accent: '蟹', stamp: 'SNAP!',    icon: 'crab',      color: '#e2552e' },
  fifa2:    { wordmark: 'PRIMITIVÃO FC',  accent: '球', stamp: 'GOL!',     icon: 'football',  color: '#2e8b3d' },
  copa:     { wordmark: 'COPA DO MUNDO',  accent: '杯', stamp: 'GOOOL!',   icon: 'globe',     color: '#1f8f8a' },
};
const tabloidTheme = (champId) => TABLOID_THEMES[champId] || TABLOID_THEMES.fifa;

// Nome curto do campeonato com a temporada colada no fim: "FIFA S1", "MK S1",
// "LoL S1". Usado como identidade compacta nos seletores/listas de campeonato.
// (O campo `season` segue "Season N" e continua por extenso fora daqui.)
function champShort(c) {
  if (!c) return '';
  return (c.tag || '') + ' ' + String(c.season || '').replace(/^Season\s+/i, 'S');
}

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

// Timestamp UTC do pontapé inicial ("2026-06-11" + "13:00 UTC-6" -> ms epoch).
// null se o horário não parsear (sem trava — mesmo comportamento de hoje).
function wcKickoffTs(dateISO, timeStr) {
  const t = String(timeStr || '').match(/^(\d{1,2}):(\d{2})\s*UTC([+-]\d+)$/);
  const d = String(dateISO || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!t || !d) return null;
  const h = parseInt(t[1], 10), min = parseInt(t[2], 10), off = parseInt(t[3], 10);
  // hora local - offset = hora UTC; Date.UTC normaliza estouro de dia sozinho
  return Date.UTC(parseInt(d[1], 10), parseInt(d[2], 10) - 1, parseInt(d[3], 10), h - off, min);
}

// Traduz slot de mata-mata ("2A", "1E", "3A/B/C/D/F") pra label legível.
function translateKnockoutSlot(slot) {
  if (!slot) return '';
  // "W74"/"L101" = vencedor/perdedor do jogo N (oitavas em diante)
  const mWL = String(slot).match(/^([WL])(\d+)$/);
  if (mWL) return (mWL[1] === 'W' ? 'VENCEDOR JOGO ' : 'PERDEDOR JOGO ') + mWL[2];
  const m1 = String(slot).match(/^(\d+)([A-Z](?:\/[A-Z])*)$/);
  if (!m1) return slot;
  return `${m1[1]}º G ${m1[2]}`;
}

// Normaliza uma linha de match do JSON pra estrutura interna usada na UI.
function normalizeWcMatch(raw, idx, teamsByName) {
  if (!raw) return null;
  const { date: brtDate, time: brtTime } = convertWcTime(raw.date, raw.time);
  // Slot não decidido: "2A"/"3A/B/C" (terceiros) ou "W74"/"L101" (mata-mata).
  const isPlaceholder = (s) => /^(\d+)([A-Z](?:\/[A-Z])*)$/.test(String(s || '')) || /^[WL]\d+$/.test(String(s || ''));
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
  // ATENÇÃO (load-bearing): os 72 jogos da fase de grupos NÃO têm "num" no
  // worldcup.json, então o id deles é POSICIONAL (wc-i0…wc-i71) e já existem
  // palpites salvos no Firestore com essas chaves. NUNCA reordenar/inserir/
  // remover jogos no meio do array — isso reaponta palpites pro jogo errado.
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
    kickoffTs: wcKickoffTs(raw.date, raw.time),
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

// Aloca os 8 melhores TERCEIROS colocados (formato 2026: 12 grupos) nos slots
// "3A/B/C/D/F" da Round of 32. Cada slot aceita o 3º de um conjunto de grupos;
// resolve por matching bipartido (cada 3º classificado -> um slot permitido).
// Retorna { "3A/B/C/D/F": {name,flag}, ... } ou {} se a fase de grupos não
// terminou / formato inesperado. FIFA usa uma tabela fixa; aqui qualquer
// alocação VÁLIDA e completa serve pro bolão (ninguém fica sem adversário).
// Os 8 melhores TERCEIROS colocados (formato 2026: 12 grupos). Só quando a fase
// de grupos termina. Retorna { complete, qualGroups:[...], byGroup:{g:{name,flag}} }.
function wcThirdsInfo(standingsByGroup) {
  const groups = Object.keys(standingsByGroup);
  const complete = groups.length > 0 && groups.every(g => (standingsByGroup[g] || []).length >= 3 && standingsByGroup[g].every(t => t.J === 3));
  if (!complete) return { complete: false, qualGroups: [], byGroup: {} };
  const thirds = groups.map(g => ({ group: g, t: standingsByGroup[g][2] })).filter(x => x.t);
  thirds.sort((a, b) => {
    const A = a.t, B = b.t;
    if (B.P !== A.P) return B.P - A.P;
    const sgA = A.GP - A.GC, sgB = B.GP - B.GC; if (sgB !== sgA) return sgB - sgA;
    if (B.GP !== A.GP) return B.GP - A.GP;
    return A.name.localeCompare(B.name);
  });
  const top = thirds.slice(0, 8);
  const byGroup = {};
  top.forEach(x => { byGroup[x.group] = { name: x.t.name, flag: x.t.flag }; });
  return { complete: true, qualGroups: top.map(x => x.group), byGroup };
}
function wcThirdSlots(fixtures) {
  return Array.from(new Set(
    fixtures.flatMap(m => [m.rawSlotHome, m.rawSlotAway]).filter(s => /^3[A-Z](\/[A-Z])+$/.test(String(s || '')))
  )).map(s => ({ slot: s, allowed: s.slice(1).split('/') }));
}
// Aloca os 8 melhores terceiros nos slots "3A/B/C/D/F" da Round of 32. A FIFA usa
// uma tabela fixa de 495 combinações; aqui o MOD pode fixar cada vaga em
// `overrides` (slot -> letra do grupo) e o resto é completado por matching.
function computeWcThirdAssignment(standingsByGroup, fixtures, overrides) {
  const info = wcThirdsInfo(standingsByGroup);
  if (!info.complete) return {};
  const qualGroups = info.qualGroups;
  const slotSets = wcThirdSlots(fixtures);
  if (slotSets.length !== qualGroups.length) return {};
  // 1) aplica os overrides do mod (válidos: grupo classificado e permitido no slot)
  const assign = {}, used = {}, usedGroup = {};
  const ov = overrides || {};
  for (const ss of slotSets) {
    const g = ov[ss.slot];
    if (g && qualGroups.includes(g) && ss.allowed.includes(g) && !usedGroup[g]) {
      assign[ss.slot] = g; used[ss.slot] = true; usedGroup[g] = true;
    }
  }
  // 2) completa o resto por matching bipartido
  const remGroups = qualGroups.filter(g => !usedGroup[g]);
  const remSlots = slotSets.filter(ss => !used[ss.slot]);
  const bt = (i) => {
    if (i === remGroups.length) return true;
    const g = remGroups[i];
    for (const ss of remSlots) {
      if (!used[ss.slot] && ss.allowed.includes(g)) {
        used[ss.slot] = true; assign[ss.slot] = g;
        if (bt(i + 1)) return true;
        used[ss.slot] = false; delete assign[ss.slot];
      }
    }
    return false;
  };
  bt(0); // se não fechar 100% (override impossível), preenche o que der
  const out = {};
  for (const slot in assign) {
    const t = standingsByGroup[assign[slot]][2];
    out[slot] = { name: t.name, flag: t.flag };
  }
  return out;
}

// Bônus de PÊNALTIS (só no mata-mata empatado): +3 cravando o placar dos
// pênaltis, +1 acertando só quem passou, 0 errando. NÃO tira os pontos do
// placar do tempo normal. Vale só se o admin já lançou os pênaltis E o usuário
// palpitou os pênaltis (que só aparece quando ele palpita empate num mata-mata).
function scoreWcPens(real, pick, isKnockout) {
  if (!isKnockout || !real || !pick) return 0;
  const rgh = parseInt(real.gh, 10), rga = parseInt(real.ga, 10);
  if (Number.isNaN(rgh) || Number.isNaN(rga) || rgh !== rga) return 0; // só empate vai pra pênaltis
  const pdh = parseInt(pick.gh, 10), pda = parseInt(pick.ga, 10);
  if (pdh !== pda) return 0; // só pontua pênaltis quem palpitou empate
  const rh = parseInt(real.penH, 10), ra = parseInt(real.penA, 10);
  const ph = parseInt(pick.penH, 10), pa = parseInt(pick.penA, 10);
  if ([rh, ra, ph, pa].some(Number.isNaN)) return 0;
  if (rh === ph && ra === pa) return 3; // placar exato dos pênaltis
  if (ph !== pa && rh !== ra && (ph > pa) === (rh > ra)) return 1; // só quem passou
  return 0;
}
function scoreWcPick(real, pick, isKnockout) {
  if (!real || !pick) return 0;
  const rgh = parseInt(real.gh, 10), rga = parseInt(real.ga, 10);
  const pgh = parseInt(pick.gh, 10), pga = parseInt(pick.ga, 10);
  if ([rgh, rga, pgh, pga].some(Number.isNaN)) return 0;
  let pts = 0;
  if (rgh === pgh && rga === pga) pts = 3; // placar exato
  else {
    const r = rgh > rga ? 'H' : rgh < rga ? 'A' : 'D';
    const p = pgh > pga ? 'H' : pgh < pga ? 'A' : 'D';
    if (r === p) pts = 1; // só o resultado
  }
  return pts + scoreWcPens(real, pick, isKnockout); // + bônus pênaltis
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
  'Omni-Man', 'Peacemaker', 'Quan Chi', 'Raiden', 'Rain', 'Reiko', 'Reptile',
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

// ─── JOGADOR RETIRADO DO MK (anulado) ───────────────────────────────────────
// Jogador que saiu do campeonato no meio: some da tabela, dos inscritos, dos
// jogos e do mercado COMO SE NUNCA TIVESSE ENTRADO. Os jogos dele NO DRAW não
// são apagados — o índice do jogo na rodada é a CHAVE do placar (`phase-n-gi`),
// então reindexar corromperia placares/locks já gravados (a escrita é por índice
// na transação remota). Em vez disso são tratados como ANULADOS: contam como
// "já resolvidos" (não bloqueiam o avanço da rodada, não ficam pendentes, não
// aparecem pra apostar) e NÃO pontuam pra ninguém. Reversível: basta tirar o
// nick desta lista que tudo volta. (CLAUDE.md — emergência: xaolin saiu do MK.)
const MK_WITHDRAWN = ['xaolin'];
const mkIsWithdrawn = (nick) => MK_WITHDRAWN.indexOf(nick) !== -1;
// jogo anulado = envolve um jogador retirado (aceita {home,away} de draw ou match).
const mkGameVoid = (g) => !!g && (mkIsWithdrawn(g.home) || mkIsWithdrawn(g.away));
// inscritos VÁLIDOS do MK (sem os retirados) a partir do top-level `interests`.
const mkInscritos = (interests) => Object.keys((interests && interests.mk) || {}).filter(n => !mkIsWithdrawn(n));

// ─── JOGADOR EM W.O. NO MK (desistência no meio) ────────────────────────────
// DIFERENTE de MK_WITHDRAWN: o desistente NÃO some do campeonato — os jogos que
// ele JÁ jogou seguem valendo. Só as partidas AINDA EM ABERTO viram W.O.: o
// ADVERSÁRIO leva os 3 pontos (SEM contar rounds) e o jogo deixa de ficar
// pendente/apostável. O placar do W.O. é um overlay in-memory (`sc.wo`) aplicado
// na leitura (mkApplyWo) — NUNCA é gravado no Firestore (persistMk grava por
// chave a partir do remoto), então basta tirar o nick da lista pra reverter.
// Confronto entre DOIS desistentes (ainda em aberto): vence por W.O. quem
// desistiu DEPOIS (índice maior em MK_WO) — o primeiro a sair já tinha dado o
// W.O. daquele jogo pro segundo, que na época ainda estava ativo. O jogo entre
// eles que JÁ foi jogado continua valendo. ORDEM = ordem de desistência.
// (bamgu e vitinho desistiram, nessa ordem — 2026-07-11.)
const MK_WO = ['bamgu', 'vitinho'];
const mkIsWo = (nick) => MK_WO.indexOf(nick) !== -1;
// jogo envolve um desistente? (aceita {home,away} de draw, match ou perna).
const mkGameHasWo = (g) => !!g && (mkIsWo(g.home) || mkIsWo(g.away));

// W.O. de PARTIDA específica: o jogador NÃO desistiu do campeonato — só ENTREGOU
// aquele jogo. Diferente de MK_WO: quem entregou continua na tabela, pontua nos
// outros jogos e SEGUE elegível pros seeds do mata-mata. Mapa gKey -> nick do
// VENCEDOR (só vale se a partida ainda estiver EM ABERTO; jogo já jogado, ignora).
// (celin entregou 3 jogos e magreza 1 — 2026-07-11.)
const MK_WO_GAMES = {
  'VOLTA-11-6': 'ivansf',      // ivansf x celin — celin entregou
  'VOLTA-12-6': 'caco',        // caco x celin — celin entregou
  'VOLTA-13-5': 'jucamelero',  // celin x jucamelero — celin entregou
  'VOLTA-12-0': 'oldspriggan', // oldspriggan x magreza — magreza entregou
};

// Sorteio todos-contra-todos IDA e VOLTA (método do círculo). Devolve as rodadas
// [{ phase:'IDA'|'VOLTA', n, games:[{home,away}] }]. Ephemeral (regera no clique).
function generateMkDraw(playersIn) {
  const players = (playersIn || []).slice().filter(n => !mkIsWithdrawn(n));
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
  // W.O. (desistência): adversário vence sem contar rounds. sc.wo = 'H' | 'A'
  // (lado vencedor). Vira um resultado VÁLIDO como qualquer outro — 3 pts pro
  // vencedor, 0 rounds pros dois — então classificação/rodada-concluída/não-
  // apostável funcionam iguais em todo lugar. Marcado com `wo:true` pra quem
  // quiser tratar diferente (stats por round ignoram, liquidação congela).
  if (sc.wo === 'H' || sc.wo === 'A') {
    const confH = sc.wo === 'H' ? 2 : 0, confA = 2 - confH;
    return { p1h: 0, p1a: 0, p2h: 0, p2a: 0, confH, confA, roundsH: 0, roundsA: 0,
      total: 0, winner: sc.wo, wo: true };
  }
  const v = ['p1h', 'p1a', 'p2h', 'p2a'].map(k => parseInt(sc[k], 10));
  if (v.some(x => Number.isNaN(x))) return null;
  const [p1h, p1a, p2h, p2a] = v;
  // Partida MD3 válida: um lado fecha 2, o outro faz 0 ou 1 (2×0, 2×1, 0×2, 1×2).
  // Placar impossível (1×1, 2×2, 0×0...) = jogo segue pendente, igual incompleto.
  const okPartida = (h, a) => (h === 2 && a <= 1) || (a === 2 && h <= 1);
  if (!okPartida(p1h, p1a) || !okPartida(p2h, p2a)) return null;
  const confH = (p1h > p1a ? 1 : 0) + (p2h > p2a ? 1 : 0);
  const confA = 2 - confH;
  const roundsH = p1h + p2h, roundsA = p1a + p2a;
  return { p1h, p1a, p2h, p2a, confH, confA, roundsH, roundsA, total: roundsH + roundsA,
    winner: confH > confA ? 'H' : confH < confA ? 'A' : 'D' }; // D = empate (1×1)
}

// Overlay de W.O.: devolve uma cópia de `scores` onde CADA jogo AINDA EM ABERTO
// de um desistente (MK_WO) recebe `wo` = lado do adversário (vencedor). Jogos já
// jogados (resultado real) e jogos anulados (adversário retirado) são preservados
// intactos. Aplicado só na LEITURA (nunca gravado) — some sozinho ao tirar o nick
// de MK_WO. Idempotente (sc já com resultado real não é tocado). Sem desistentes
// no chaveamento, devolve o próprio `scores` (sem alocar).
function mkApplyWo(draw, scores) {
  const base = scores || {};
  const hasGameWo = Object.keys(MK_WO_GAMES).length > 0;
  if (!draw || !draw.length || (!MK_WO.length && !hasGameWo)) return base;
  const gk = (r, gi) => r.phase + '-' + r.n + '-' + gi;
  let out = null;
  (draw || []).forEach(r => (r.games || []).forEach((g, gi) => {
    if (mkGameVoid(g)) return;                         // anulado (retirado) tem prioridade
    const key = gk(r, gi);
    const sc = base[key] || {};
    if (mkMatchOutcome(sc)) return;                    // já resolvido (jogo já jogado)
    let woSide = null;
    const forced = MK_WO_GAMES[key];                   // W.O. explícito de PARTIDA
    if (forced) {
      woSide = g.home === forced ? 'H' : g.away === forced ? 'A' : null; // vencedor tem que ser um dos dois
    } else if (mkGameHasWo(g)) {                        // desistente(s) (MK_WO)
      // Vencedor: quem NÃO desistiu. Se OS DOIS desistiram, vence quem desistiu
      // DEPOIS (índice maior em MK_WO) — quando o 1º saiu, o 2º ainda estava ativo.
      woSide = (mkIsWo(g.home) && mkIsWo(g.away))
        ? (MK_WO.indexOf(g.home) > MK_WO.indexOf(g.away) ? 'H' : 'A')
        : (mkIsWo(g.home) ? 'A' : 'H');
    }
    if (!woSide) return;                               // não é W.O.
    if (!out) out = { ...base };
    out[key] = { ...sc, wo: woSide };
  }));
  return out || base;
}

// ─── MATA-MATA DO MK (top 8 dos pontos corridos) ────────────────────────────
// Formato (Edição 01):
//   J1: 3º × 8º — vencedor pega o 1º na SEMI 1.
//   J2: 4º × 7º e J3: 5º × 6º — repescagem; vencedores fazem o
//   J4 (decisão da repescagem) — vencedor pega o 2º na SEMI 2.
//   SEMI 1: 1º × venc. J1 · SEMI 2: 2º × venc. J4 · FINAL + 3º LUGAR.
// Confronto do mata-mata = MD5 (5 jogos, vence quem fizer 3) com escalação
// BLIND: cada jogador declara a ORDEM dos 5 personagens antes (máx 2x o mesmo
// boneco, qualquer um do MK_CHARACTERS — não usa o elenco de 3 da liga); o
// adversário só descobre na hora de cada jogo.
// Persistência: mk.ko = { published, publishedAt, seeds:[8 nicks], scores, lineups }.
//   scores[matchId] = { g1:'H'|'A', ..., g5 } (vencedor de cada jogo, em ordem)
//   lineups[matchId][nick] = btoa(JSON [5 nomes]) — ofuscado pra não vazar numa
//   olhada casual no doc (é cadeado de bicicleta, não criptografia).
const MK_KO_IDS = ['R1', 'R2', 'R3', 'R4', 'SF1', 'SF2', 'F', 'T3'];
const MK_KO_META = {
  R1:  { label: 'JOGO 1',   phase: 'QUALIFICATÓRIA', dest: 'vencedor pega o 1º na SEMI 1', hints: {} },
  R2:  { label: 'JOGO 2',   phase: 'REPESCAGEM',     dest: 'vencedor vai pra DECISÃO', hints: {} },
  R3:  { label: 'JOGO 3',   phase: 'REPESCAGEM',     dest: 'vencedor vai pra DECISÃO', hints: {} },
  R4:  { label: 'DECISÃO',  phase: 'REPESCAGEM',     dest: 'vencedor pega o 2º na SEMI 2', hints: { home: 'vence o JOGO 2', away: 'vence o JOGO 3' } },
  SF1: { label: 'SEMI 1',   phase: 'SEMIFINAIS',     dest: 'vencedor vai pra FINAL', hints: { away: 'vence o JOGO 1' } },
  SF2: { label: 'SEMI 2',   phase: 'SEMIFINAIS',     dest: 'vencedor vai pra FINAL', hints: { away: 'vence a DECISÃO' } },
  F:   { label: 'A FINAL',  phase: 'TÍTULO',         dest: 'vale o título do MK', hints: { home: 'vence a SEMI 1', away: 'vence a SEMI 2' } },
  T3:  { label: '3º LUGAR', phase: 'TÍTULO',         dest: 'perdedores das semis', hints: { home: 'perde a SEMI 1', away: 'perde a SEMI 2' } },
};
// Jogos que DEPENDEM do resultado de cada confronto (fecho transitivo). Quando
// o vencedor de um confronto MUDA (correção do mod) ou o confronto REABRE, os
// placares/escalações desses jogos apontariam pro classificado errado — são
// limpos no mesmo reducer (ver setMkKoGame) pra não sobrar órfão.
const MK_KO_DOWNSTREAM = {
  R1: ['SF1', 'F', 'T3'], R2: ['R4', 'SF2', 'F', 'T3'], R3: ['R4', 'SF2', 'F', 'T3'],
  R4: ['SF2', 'F', 'T3'], SF1: ['F', 'T3'], SF2: ['F', 'T3'], F: [], T3: [],
};
// Confronto JÁ COMEÇOU? Olha o DOC (qualquer gN lançado), não o outcome — o
// outcome trunca no primeiro buraco (mod desfez o J1 com J2 lançado) e diria
// "não começou" com jogo gravado, reabrindo a escalação blind já revelada.
const mkKoMatchStarted = (sc) => !!sc && ['g1', 'g2', 'g3', 'g4', 'g5', 'fh', 'fr'].some(k => sc[k] === 'H' || sc[k] === 'A');
// Algum confronto do mata-mata já começou? (trava cancelamento de aposta outright).
const mkKoAnyStarted = (koScores) => MK_KO_IDS.some(id => mkKoMatchStarted((koScores || {})[id]));
// Resultado de um confronto MD5: lê g1..g5 EM ORDEM e para no primeiro jogo sem
// vencedor ou quando um lado fecha 3. Sempre devolve objeto (parcial serve pra UI).
function mkKoOutcome(sc) {
  const res = { games: [], h: 0, a: 0, winner: null, done: false, next: 1 };
  for (let i = 1; i <= 5; i++) {
    const w = sc && sc['g' + i];
    if (w !== 'H' && w !== 'A') break;
    res.games.push({ n: i, winner: w });
    if (w === 'H') res.h++; else res.a++;
    if (res.h === 3 || res.a === 3) { res.done = true; res.winner = res.h === 3 ? 'H' : 'A'; res.next = null; break; }
    res.next = i + 1;
  }
  return res;
}
// Monta o chaveamento resolvido a partir dos seeds (1º..8º) + placares. Slots
// FIXOS (sem re-sortear mando): venc. J2 = mandante da DECISÃO; venc. SEMI 1 =
// mandante da FINAL; perd. SEMI 1 = mandante do 3º lugar. null = lado indefinido.
function mkKoBracket(seeds, koScores) {
  const S = (i) => (seeds && seeds[i - 1]) || null;
  const m = {};
  const make = (id, home, away) => {
    const o = mkKoOutcome((koScores || {})[id]);
    const done = !!(o.done && home && away);
    m[id] = {
      id, home, away, o, done,
      winner: done ? (o.winner === 'H' ? home : away) : null,
      loser:  done ? (o.winner === 'H' ? away : home) : null,
    };
  };
  make('R1', S(3), S(8));
  make('R2', S(4), S(7));
  make('R3', S(5), S(6));
  make('R4', m.R2.winner, m.R3.winner);
  make('SF1', S(1), m.R1.winner);
  make('SF2', S(2), m.R4.winner);
  make('F',  m.SF1.winner, m.SF2.winner);
  make('T3', m.SF1.loser,  m.SF2.loser);
  return m;
}
// Seeds do mata-mata: classificação COMPLETA (com os desistentes DENTRO, senão
// os W.O. deles não pontuam pros adversários) e só DEPOIS filtra quem saiu
// (MK_WO) — desistente não disputa o mata-mata. Top 8 do que sobrar.
function mkKoSeedsFrom(players, matches) {
  return computeMkStandings(players, matches)
    .map(s => s.nick)
    .filter(n => !mkIsWo(n) && !mkIsWithdrawn(n))
    .slice(0, 8);
}
// Escalação blind: codifica/decodifica a lista de 5 picks (base64 de JSON).
function mkKoEncodeLineup(list) {
  try { return btoa(JSON.stringify(list)); } catch (e) { return null; }
}
function mkKoDecodeLineup(raw) {
  if (Array.isArray(raw)) return raw; // compat: se algum dia gravar sem codificar
  if (typeof raw !== 'string' || !raw) return null;
  try { const v = JSON.parse(atob(raw)); return Array.isArray(v) ? v : null; } catch (e) { return null; }
}
// Valida a lista de 5 picks: exatamente 5, todos personagens válidos, máx 2x o
// mesmo. Devolve lista de problemas (vazia = ok).
function mkKoLineupProblems(list) {
  const probs = [];
  const picks = (list || []).filter(Boolean);
  if (picks.length < 5) probs.push('Escolha os 5 jogos (' + picks.length + '/5).');
  const bad = picks.filter(c => MK_CHARACTERS.indexOf(c) === -1);
  if (bad.length) probs.push('Personagem inválido: ' + bad.join(', ') + '.');
  const count = {};
  picks.forEach(c => { count[c] = (count[c] || 0) + 1; });
  Object.keys(count).forEach(c => { if (count[c] > 2) probs.push(c + ' escolhido ' + count[c] + 'x — máximo 2x por personagem.'); });
  return probs;
}
// Revela o pick do jogo N de um jogador? Regra única pra TODO MUNDO (inclusive
// mod): o próprio dono sempre vê; os outros só veem picks de jogos que JÁ têm
// resultado lançado (o "na hora do jogo" acontece na live, não no app).
function mkKoPickRevealed(matchOutcome, gameN, ownerNick, viewerNick) {
  if (ownerNick && viewerNick && ownerNick === viewerNick) return true;
  return (matchOutcome.games || []).some(g => g.n === gameN);
}

// Round-dots de um confronto MK (estilo jogo de luta): 2 partidas, cada uma
// "primeiro a 2 rounds" (MD3). Cada lado tem 2 bolinhas; o mod toca pra marcar os
// rounds vencidos (toca de novo na do topo pra desmarcar). Deriva e grava o MESMO
// shape { p1h, p1a, p2h, p2a } (dígitos 0..2 como string) — liquidação/
// classificação seguem iguais. A própria UI impede placar impossível (a partida
// fecha quando um lado chega a 2).
function MkRoundDots({ sc, onPatch, disabled, lineup }) {
  const g = (k) => { const n = parseInt(sc && sc[k], 10); return Number.isNaN(n) ? 0 : Math.max(0, Math.min(2, n)); };
  const partidas = [{ n: 1, h: 'p1h', a: 'p1a', lu: 'p1' }, { n: 2, h: 'p2h', a: 'p2a', lu: 'p2' }];
  const click = (pa, side, idx) => {
    if (disabled) return;
    const cur = { h: g(pa.h), a: g(pa.a) };
    const desired = (cur[side] === idx + 1) ? idx : idx + 1; // liga até idx+1; topo aceso -> desliga
    const next = { ...cur, [side]: desired };
    const other = side === 'h' ? 'a' : 'h';
    if (next.h >= 2 && next.a >= 2) next[other] = 1; // MD3: só um lado chega a 2
    onPatch({ [pa.h]: String(next.h), [pa.a]: String(next.a) });
  };
  const dots = (pa, side, count) => {
    const cls = side === 'h' ? 'home' : 'away';
    return (
      <span className={'mk-dots-side ' + cls}>
        {[0, 1].map(i => (
          <button key={i} type="button" disabled={disabled}
            className={'mk-dot ' + cls + (i < count ? ' on' : '')}
            onClick={() => click(pa, side, i)} aria-label={'P' + pa.n + ' round ' + (i + 1) + ' ' + (side === 'h' ? 'mandante' : 'visitante')} />
        ))}
      </span>
    );
  };
  return (
    <div className="mk-dots">
      <div className="mk-dots-legend"><span className="mk-dot home on mk-dot-leg" /> MANDANTE <span className="mk-dot away on mk-dot-leg" /> VISITANTE</div>
      {partidas.map(pa => {
        const h = g(pa.h), a = g(pa.a);
        const win = h === 2 ? 'h' : a === 2 ? 'a' : null;
        const part = lineup && lineup[pa.lu];
        const hc = part && part.home, ac = part && part.away;
        return (
          <div key={pa.n} className={'mk-dots-row' + (win ? ' decided' : '')}>
            <span className="mk-dots-lbl">P{pa.n}</span>
            {hc ? <span className="mk-dots-char"><MkCharIcon name={hc} sm /></span> : null}
            {dots(pa, 'h', h)}
            <span className="mk-dots-score"><b className={win === 'h' ? 'wh' : ''}>{h}</b><i>×</i><b className={win === 'a' ? 'wa' : ''}>{a}</b></span>
            {dots(pa, 'a', a)}
            {ac ? <span className="mk-dots-char"><MkCharIcon name={ac} sm /></span> : null}
          </div>
        );
      })}
    </div>
  );
}

// Painel LANÇAR RESULTADOS (só mod) — fica no topo de APOSTAS/JOGOS e lista APENAS
// os jogos com apostas TRAVADAS que ainda não têm resultado. Some quando todos
// forem lançados. MK usa as bolinhas de round; FIFA usa placar gh × ga.
function ResultLauncherPanel({ champId, mkDraw, mkScores, mkLineups, onMkScore, cs, onFifaScore, teamPlayers }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const head = (n) => (
    <div className="card-head">
      <div className="title"><Icon name="whistle" size={16} /> LANÇAR RESULTADOS</div>
      <div className="sub">{n} JOGO{n === 1 ? '' : 'S'} TRAVADO{n === 1 ? '' : 'S'} AGUARDANDO</div>
    </div>
  );
  if (champId === 'mk') {
    const pending = [];
    (mkDraw || []).forEach(r => (r.games || []).forEach((g, gi) => {
      if (mkGameVoid(g)) return;
      const key = r.phase + '-' + r.n + '-' + gi;
      const sc = (mkScores || {})[key] || {};
      if (mkGameClosed(sc, now) && !mkMatchOutcome(sc)) pending.push({ r, gi, g, key, sc });
    }));
    if (!pending.length) return null;
    return (
      <div className="card result-launcher">
        {head(pending.length)}
        <div className="card-body"><div className="rl-list">
          {pending.map(({ r, gi, g, key, sc }) => (
            <div className="rl-row rl-row--mk" key={key}>
              <div className="rl-match">
                <span className="rl-rod">RODADA {String(r.n).padStart(2, '0')} · {r.phase} · JOGO {String(gi + 1).padStart(2, '0')}</span>
                <span className="rl-vs"><b>{g.home}</b><i>×</i><b>{g.away}</b></span>
              </div>
              <MkRoundDots sc={sc} lineup={(mkLineups || {})[key]} onPatch={(patch) => onMkScore(key, patch)} />
              <div className="rl-extras">
                <span className="rl-extra-grp">
                  <span className="rl-extra-l">1º ROUND</span>
                  <button type="button" className={'rl-pick home' + (sc.firstRound === 'H' ? ' on' : '')} onClick={() => onMkScore(key, { firstRound: sc.firstRound === 'H' ? '' : 'H' })}>{g.home}</button>
                  <button type="button" className={'rl-pick away' + (sc.firstRound === 'A' ? ' on' : '')} onClick={() => onMkScore(key, { firstRound: sc.firstRound === 'A' ? '' : 'A' })}>{g.away}</button>
                </span>
                <span className="rl-extra-grp">
                  <span className="rl-extra-l"><Icon name="skull" size={11} /> BRUTALITY</span>
                  <button type="button" className={'rl-pick' + (sc.finisher1 === 'brutality' ? ' on' : '')} onClick={() => onMkScore(key, { finisher1: sc.finisher1 === 'brutality' ? '' : 'brutality' })}>P1</button>
                  <button type="button" className={'rl-pick' + (sc.finisher2 === 'brutality' ? ' on' : '')} onClick={() => onMkScore(key, { finisher2: sc.finisher2 === 'brutality' ? '' : 'brutality' })}>P2</button>
                </span>
              </div>
            </div>
          ))}
        </div></div>
      </div>
    );
  }
  // FIFA (e ligas legadas no cs): jogos travados sem placar completo.
  const pending = [];
  ((cs && cs.rounds) || []).forEach((round, ri) => (round || []).forEach((m, gi) => {
    if (!m || !m.locked) return;
    const gh = parseInt(m.gh, 10), ga = parseInt(m.ga, 10);
    if (Number.isNaN(gh) || Number.isNaN(ga)) pending.push({ ri, gi, m });
  }));
  if (!pending.length) return null;
  return (
    <div className="card result-launcher">
      {head(pending.length)}
      <div className="card-body"><div className="rl-list">
        {pending.map(({ ri, gi, m }) => (
          <div className="rl-row" key={ri + '-' + gi}>
            <div className="rl-match">
              <span className="rl-rod">RODADA {String((m.round != null ? m.round : ri + 1)).padStart(2, '0')}</span>
              <span className="rl-vs"><b>{fifaUserOf(m.home, teamPlayers)}</b><i>×</i><b>{fifaUserOf(m.away, teamPlayers)}</b></span>
            </div>
            <span className="rl-fifa">
              <input className="cscore-in" value={m.gh ?? ''} placeholder="–" inputMode="numeric" onChange={e => onFifaScore(ri, gi, { gh: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
              <i className="rl-x">×</i>
              <input className="cscore-in" value={m.ga ?? ''} placeholder="–" inputMode="numeric" onChange={e => onFifaScore(ri, gi, { ga: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
            </span>
          </div>
        ))}
      </div></div>
    </div>
  );
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

// Limpa dos cards (mkLineups) os bonecos que o jogador NÃO tem mais no elenco
// (mkChars) — ex.: o cara montou o card e DEPOIS trocou de elenco; o slot fica
// com personagem velho. Roda na LEITURA do doc (não-destrutivo): o card aparece
// limpo e o mandante remonta. Só mexe em jogo NÃO jogado — concluído é histórico.
// Cada slot de `home`/`away` tem que estar no mkChars do jogador daquele lado.
function mkSanitizeLineups(lineups, draw, scores, users) {
  if (!lineups || !draw) return lineups || {};
  const charsOf = (n) => ((users || {})[n] || {}).mkChars || [];
  const gKey = (r, gi) => r.phase + '-' + r.n + '-' + gi;
  let changed = false;
  const out = { ...lineups };
  draw.forEach(r => (r.games || []).forEach((g, gi) => {
    const key = gKey(r, gi);
    const lu = lineups[key];
    if (!lu) return;
    if (mkMatchOutcome((scores || {})[key] || {})) return; // já jogado: preserva o card
    const hv = charsOf(g.home), av = charsOf(g.away);
    let dirty = false;
    const nlu = { ...lu, p1: { ...(lu.p1 || {}) }, p2: { ...(lu.p2 || {}) } };
    ['p1', 'p2'].forEach(p => {
      if (nlu[p].home && hv.indexOf(nlu[p].home) === -1) { delete nlu[p].home; dirty = true; }
      if (nlu[p].away && av.indexOf(nlu[p].away) === -1) { delete nlu[p].away; dirty = true; }
    });
    if (dirty) { out[key] = nlu; changed = true; }
  }));
  return changed ? out : lineups;
}

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

// ── FORMA & 1º ROUND (stats mostradas no card de aposta do MK) ──────────────
// Últimos confrontos CONCLUÍDOS do nick, em ordem do chaveamento, do mais
// recente pro mais antigo. Item: { res:'V'|'D'|'E', oppNick }.
function mkPlayerRecent(nick, draw, scores, limit) {
  if (!draw || !nick) return [];
  const gk = (r, gi) => r.phase + '-' + r.n + '-' + gi;
  const rows = [];
  draw.forEach(r => (r.games || []).forEach((g, gi) => {
    if (g.home !== nick && g.away !== nick) return;
    if (mkGameVoid(g)) return;
    const o = mkMatchOutcome((scores || {})[gk(r, gi)]);
    if (!o || o.wo) return; // só concluídos DE VERDADE (W.O. não entra na forma)
    const meHome = g.home === nick;
    const iWon = (meHome && o.winner === 'H') || (!meHome && o.winner === 'A');
    rows.push({ res: o.winner === 'D' ? 'E' : (iWon ? 'V' : 'D'), oppNick: meHome ? g.away : g.home });
  }));
  return rows.slice(-(limit || 5)).reverse();
}
// Vitórias de 1º ROUND do nick nos confrontos concluídos onde o mod registrou o
// 1º round (sc.firstRound = 'H'/'A'). Retorna { won, total }.
function mkFirstRoundStats(nick, draw, scores) {
  if (!draw || !nick) return { won: 0, total: 0 };
  const gk = (r, gi) => r.phase + '-' + r.n + '-' + gi;
  let won = 0, total = 0;
  draw.forEach(r => (r.games || []).forEach((g, gi) => {
    if (g.home !== nick && g.away !== nick) return;
    if (mkGameVoid(g)) return;
    const sc = (scores || {})[gk(r, gi)];
    if (!mkMatchOutcome(sc)) return;    // confronto concluído
    if (!sc || !sc.firstRound) return;  // 1º round não registrado
    total++;
    if ((sc.firstRound === 'H') === (g.home === nick)) won++;
  }));
  return { won, total };
}
// Confronto direto entre dois nicks nos jogos concluídos: { games, aWins (do
// primeiro nick), bWins (do segundo), draws, list } — list traz cada encontro
// com os ROUNDS de cada lado (base das barras de histórico no card).
function mkHeadToHead(a, b, draw, scores) {
  if (!draw || !a || !b) return { games: 0, aWins: 0, bWins: 0, draws: 0, list: [] };
  const gk = (r, gi) => r.phase + '-' + r.n + '-' + gi;
  let games = 0, aWins = 0, bWins = 0, draws = 0;
  const list = [];
  draw.forEach(r => (r.games || []).forEach((g, gi) => {
    const pair = (g.home === a && g.away === b) || (g.home === b && g.away === a);
    if (!pair || mkGameVoid(g)) return;
    const o = mkMatchOutcome((scores || {})[gk(r, gi)]);
    if (!o || o.wo) return; // W.O. não conta no confronto direto
    games++;
    const aR = g.home === a ? o.roundsH : o.roundsA;
    const bR = g.home === a ? o.roundsA : o.roundsH;
    list.push({ phase: r.phase, n: r.n, aR, bR });
    if (o.winner === 'D') { draws++; return; }
    const winnerNick = o.winner === 'H' ? g.home : g.away;
    if (winnerNick === a) aWins++; else bWins++;
  }));
  return { games, aWins, bWins, draws, list };
}
// Tendência do jogador pro sparkline: saldo de rounds ACUMULADO jogo a jogo
// (só concluídos, na ordem do chaveamento). Começa em 0.
function mkPlayerTrendSeries(nick, draw, scores, limit) {
  if (!draw || !nick) return [];
  const gk = (r, gi) => r.phase + '-' + r.n + '-' + gi;
  const diffs = [];
  draw.forEach(r => (r.games || []).forEach((g, gi) => {
    if (g.home !== nick && g.away !== nick) return;
    if (mkGameVoid(g)) return;
    const o = mkMatchOutcome((scores || {})[gk(r, gi)]);
    if (!o || o.wo) return; // W.O. não tem rounds pra tendência
    diffs.push(g.home === nick ? o.roundsH - o.roundsA : o.roundsA - o.roundsH);
  }));
  const series = [0];
  diffs.slice(-(limit || 8)).forEach(d => series.push(series[series.length - 1] + d));
  return series;
}
// Stats "pro" do jogador: brutalities feitas (partida vencida com finisher
// marcado) e flawless (vitória sem ceder round no confronto).
function mkPlayerProStats(nick, draw, scores) {
  if (!draw || !nick) return { brutality: 0, flawless: 0 };
  const gk = (r, gi) => r.phase + '-' + r.n + '-' + gi;
  let brutality = 0, flawless = 0;
  draw.forEach(r => (r.games || []).forEach((g, gi) => {
    if (g.home !== nick && g.away !== nick) return;
    if (mkGameVoid(g)) return;
    const sc = (scores || {})[gk(r, gi)];
    const o = mkMatchOutcome(sc);
    if (!o || o.wo) return; // W.O. não tem partidas/finalização/flawless
    const meHome = g.home === nick;
    // brutality é da PARTIDA: atribui ao vencedor dela.
    [[o.p1h, o.p1a, sc.finisher1], [o.p2h, o.p2a, sc.finisher2]].forEach(([h, aa, fin]) => {
      if (fin !== 'brutality') return;
      const winnerHome = h > aa;
      if (winnerHome === meHome) brutality++;
    });
    const iWon = (meHome && o.winner === 'H') || (!meHome && o.winner === 'A');
    const conceded = meHome ? o.roundsA : o.roundsH;
    if (iWon && conceded === 0) flawless++;
  }));
  return { brutality, flawless };
}
// Vitórias por BONECO em todas as PARTIDAS com escalação conhecida:
// { [char]: { played, won } }. Base do "duelo dos bonecos" no card de aposta.
function mkCharWinStats(draw, scores, lineups) {
  const gk = (r, gi) => r.phase + '-' + r.n + '-' + gi;
  const out = {};
  const add = (c, won) => { if (!c) return; const e = out[c] || (out[c] = { played: 0, won: 0 }); e.played++; if (won) e.won++; };
  (draw || []).forEach(r => (r.games || []).forEach((g, gi) => {
    if (mkGameVoid(g)) return;
    const key = gk(r, gi);
    const o = mkMatchOutcome((scores || {})[key]);
    if (!o || o.wo) return; // W.O. não tem escalação/rounds pro win% dos bonecos
    const ln = (lineups || {})[key] || {};
    [['p1', o.p1h, o.p1a], ['p2', o.p2h, o.p2a]].forEach(([p, h, a]) => {
      const part = ln[p] || {};
      add(part.home, h > a);
      add(part.away, a > h);
    });
  }));
  return out;
}
// Vantagem dos BONECOS escalados nesse confronto: média do win% histórico dos
// bonecos do mandante (p1.home + p2.home) menos a média dos do visitante.
// Win% suavizado pra 50% (Laplace +1/+2): boneco de 1 partida não vira 100%,
// e sem histórico (ou card não montado) é neutro. Retorna -1..+1 (mandante).
function mkCharEdge(lineup, charStats) {
  if (!lineup) return 0;
  const rate = (c) => {
    const s = (charStats || {})[c];
    return s ? (s.won + 1) / (s.played + 2) : 0.5;
  };
  const avg = (arr) => arr.reduce((s, c) => s + rate(c), 0) / arr.length;
  const homeChars = ['p1', 'p2'].map(p => (lineup[p] || {}).home).filter(Boolean);
  const awayChars = ['p1', 'p2'].map(p => (lineup[p] || {}).away).filter(Boolean);
  if (!homeChars.length || !awayChars.length) return 0;
  return avg(homeChars) - avg(awayChars);
}
// Vantagem no CONFRONTO DIRETO entre os 2 jogadores (quem venceu mais vezes nos
// encontros já concluídos). Amostra pequena pesa pouco (shrinkage por nº de
// jogos) pra 1 confronto isolado não virar loteria. Retorna -1..+1 (mandante).
function mkH2hEdge(home, away, draw, scores) {
  const h2h = mkHeadToHead(home, away, draw, scores);
  if (!h2h.games) return 0;
  const diff = (h2h.aWins - h2h.bWins) / h2h.games; // -1..+1
  const confidence = h2h.games / (h2h.games + 2); // 1 jogo ~0.33, 2 ~0.5, 4+ ~0.66+
  return diff * confidence;
}
// Vantagem no PRIMEIRO ROUND: taxa de vitórias de 1º round registradas
// (mkFirstRoundStats), suavizada pra 50% em amostra pequena (Laplace +1/+2:
// sem dado = 0.5, 3/3 = 0.8 — nunca vira certeza). Retorna -1..+1 (mandante).
function mkFirstRoundEdge(home, away, draw, scores) {
  const rate = (nick) => { const s = mkFirstRoundStats(nick, draw, scores); return (s.won + 1) / (s.total + 2); };
  return rate(home) - rate(away);
}
// Vantagem de FLAWLESS: taxa de flawless por confronto concluído de cada
// jogador (mkPlayerProStats ÷ jogos), suavizada pra um prior baixo (~20%,
// flawless é raro). Quem atropela sem ceder round domina rounds. -1..+1.
function mkFlawlessRate(nick, draw, scores) {
  const j = mkPlayerRecent(nick, draw, scores, 9999).length;
  const f = mkPlayerProStats(nick, draw, scores).flawless;
  return (f + 0.5) / (j + 2.5); // sem dado -> 0.2
}
function mkFlawlessEdge(home, away, draw, scores) {
  return mkFlawlessRate(home, draw, scores) - mkFlawlessRate(away, draw, scores);
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
// FLAW (Flawless Victory) também foi aposentado: dava pra FARMAR ponto solo e
// não fazia sentido como aposta. A liquidação/label/odds dele seguem abaixo só
// pras apostas antigas continuarem liquidando certo.
const MK_MARKETS = ['VENC', 'DC', 'R1', 'P1', 'P2', 'TOTAL', 'FINISH'];
const MK_MARKET_TITLE = { VENC: 'VENCEDOR', DC: 'CHANCE DUPLA', R1: 'PRIMEIRO ROUND', RESULT: 'RESULTADO (PARTIDAS)', P1: 'PLACAR PARTIDA 1', P2: 'PLACAR PARTIDA 2', TOTAL: 'TOTAL DE ROUNDS', FINISH: 'FINALIZAÇÃO', FLAW: 'FLAWLESS VICTORY' };
const MK_R1_PICKS = ['H', 'A']; // quem vence o primeiro round (mandante/visitante)
// CHANCE DUPLA (aposta dupla): cobre 2 dos 3 resultados. 1X = mandante ou empate,
// 12 = mandante ou visitante (não empate), X2 = empate ou visitante.
const MK_DC_PICKS = ['1X', '12', 'X2'];
const MK_RESULT_PICKS = ['20', '11', '02'];          // 2×0 / 1×1 / 0×2
const MK_PARTIDA_PICKS = ['20', '21', '12', '02']; // mandante x visitante (primeiro a 2)
// Odd do MK: pagamento conservador no COMEÇO. Comprime o "lucro" da odd justa:
// no simétrico o placar (justo 4.00) sai em ~2.25.
//   odd = 1 + (1/p - 1) * MK_ODD_K   ->  4.00 vira 1 + 3*0.4167 = 2.25
const MK_ODD_K = 0.4167;   // 4.00 -> 2.25 no simétrico
const MK_ODD_FALLBACK = 999; // só pro caso degenerado de probabilidade inválida (não deve acontecer: p é clampado)
// TETO NATURAL da odd do MK. Antes era SEM teto e o azarão de um confronto muito
// desigual chegava a ~89 — feio, e "achatava" tudo lá em cima (todo blowout no
// mesmo número, escondendo o efeito de campanha/bonecos/etc). Em vez de cortar
// seco no teto (que empilharia todos os azarões em MK_ODD_MAX), comprime o LUCRO
// suavemente: o lucro tende assintoticamente ao teto sem nunca explodir, então
// o azarão EXTREMO ainda paga um pouco mais que o azarão médio (ordem preservada).
const MK_ODD_MAX = 15;
function mkCapOdd(o) {
  if (!(o > 1) || !isFinite(o)) return o;
  const profit = o - 1, max = MK_ODD_MAX - 1;
  return +(1 + (max * profit) / (max + profit)).toFixed(2);
}
const MK_TOTAL_PICKS = ['4', '5', '6'];   // total de rounds das 2 partidas
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
// Força POR JOGO (pontos ×3 + saldo de rounds, ÷ jogos disputados): normalizar
// por jogos mantém a escala estável a temporada inteira — a força acumulada
// crescia com o nº de jogos e saturava o sigmoid (fim de torneio = todo
// confronto no extremo 1.10/89, começo = tudo igual 2.25).
function computeMkPlayerMetrics(players, matches) {
  const out = {};
  computeMkStandings(players, matches).forEach(s => {
    out[s.nick] = { strength: s.j > 0 ? (s.p * 3 + (s.rp - s.rc)) / s.j : 0 };
  });
  return out;
}
// Kx do peso de cada edge no cálculo: valor -1..+1 vira um termo somado ao
// logit ao lado da força dos jogadores — cada estatística pesa, nenhuma domina
// sozinha. Sinais: campanha (força), duelo/escolha dos bonecos, confronto
// direto, vitórias de 1º round e taxa de flawless.
// Bonecos = maior peso individual: a ESCOLHA do card (quem o mandante escala)
// é decisiva no MK, então o win% histórico dos personagens escalados manda.
const MK_CHAR_EDGE_K = 4;
const MK_H2H_EDGE_K = 2.5;
const MK_FR_EDGE_K = 1.5;   // vitórias de 1º round (edge fica em ~±0.3)
const MK_FLAW_EDGE_K = 2;   // flawless = domínio total de rounds (edge ~±0.4)
// Logit cru do confronto (positivo = mandante): soma de TODAS as estatísticas.
// É a base única das odds E da barra de probabilidade do card.
function mkRoundLogit(home, away, metrics, lineup, charStats, draw, scores) {
  const H = (metrics || {})[home] || { strength: 0 }, A = (metrics || {})[away] || { strength: 0 };
  const charEdge = mkCharEdge(lineup, charStats); // bonecos escalados (win% histórico)
  const h2hEdge = mkH2hEdge(home, away, draw, scores); // confrontos diretos já jogados
  const frEdge = mkFirstRoundEdge(home, away, draw, scores); // vitórias de 1º round
  const flawEdge = mkFlawlessEdge(home, away, draw, scores); // taxa de flawless
  // 0.1 na escala POR JOGO da força (diff típico ±3..8): favorito claro fica
  // em ~0.65-0.80 de round antes dos outros edges, sem saturar o sigmoid.
  return (H.strength - A.strength) * 0.1
    + charEdge * MK_CHAR_EDGE_K + h2hEdge * MK_H2H_EDGE_K
    + frEdge * MK_FR_EDGE_K + flawEdge * MK_FLAW_EDGE_K;
}
// Clamp SÓ das odds pagas (piso/teto de pagamento). A barra de probabilidade
// exibida usa o logit sem clamp (mkMatchupProbs) pra diferenciar mais.
const mkClampP = (x) => Math.max(0.16, Math.min(0.84, x));
// Probabilidades EXIBIDAS (barra do card + pop-up de stats): direto das
// estatísticas, com clamp mais frouxo que o das odds (0.10-0.90) — diferencia
// mais que as odds pagas mas a barra nunca crava 100%/0% (ninguém é certeza).
function mkMatchupProbs(home, away, metrics, lineup, charStats, draw, scores) {
  const pR = Math.max(0.10, Math.min(0.90, sigmoid(mkRoundLogit(home, away, metrics, lineup, charStats, draw, scores))));
  const q = mkPartidaWinProb(pR);
  return { pR, pWin: q * q, pDraw: 2 * q * (1 - q), pLoss: (1 - q) * (1 - q) };
}
function computeMkGameOdds(home, away, metrics, lineup, charStats, draw, scores) {
  const logit = mkRoundLogit(home, away, metrics, lineup, charStats, draw, scores);
  const p = mkClampP(sigmoid(logit));
  const q = mkPartidaWinProb(p);                  // mandante vence uma partida
  const p20 = q * q, p11 = 2 * q * (1 - q), p02 = (1 - q) * (1 - q);
  const pd = mkPartidaDist(p);
  const a = pd['20'] + pd['02'], b = pd['21'] + pd['12']; // partida com 2 ou 3 rounds
  const total = { '4': a * a, '5': 2 * a * b, '6': b * b };
  // odd do MK: justa (1/p) com o lucro comprimido por MK_ODD_K e teto natural
  // suave por mkCapOdd (ver MK_ODD_MAX).
  const mko = (pp) => (!(pp > 0) || !isFinite(pp)) ? MK_ODD_FALLBACK
    : Math.max(ODD_MIN, mkCapOdd(1 + (1 / pp - 1) * MK_ODD_K));
  const partida = {}; MK_PARTIDA_PICKS.forEach(pk => { partida[pk] = mko(pd[pk]); });
  const totalO = {}; MK_TOTAL_PICKS.forEach(t => { totalO[t] = mko(total[t]); });
  // finalização pode sair em QUALQUER das 2 partidas -> P = 1 - (1-p)^2.
  const finish = {}; MK_FINISHERS.forEach(f => { finish[f.id] = mko(1 - Math.pow(1 - f.p, 2)); });
  // 1º ROUND: a estatística específica de 1º round pesa em DOBRO aqui (o
  // primeiro round tem dono — quem começa forte ganha odd melhor nesse mercado).
  const pR1 = mkClampP(sigmoid(logit + mkFirstRoundEdge(home, away, draw, scores) * MK_FR_EDGE_K));
  // FLAWLESS: taxas reais dos DOIS jogadores (rolou flawless de qualquer lado
  // no confronto), no lugar do 40% fixo antigo. Sem histórico cai em ~0.36.
  const fH = mkFlawlessRate(home, draw, scores), fA = mkFlawlessRate(away, draw, scores);
  const pFlawY = Math.max(0.05, Math.min(0.85, 1 - (1 - fH) * (1 - fA)));
  return {
    VENC:   { H: mko(p20), D: mko(p11), A: mko(p02) },
    DC:     { '1X': mko(p20 + p11), '12': mko(p20 + p02), 'X2': mko(p11 + p02) }, // chance dupla
    R1:     { H: mko(pR1), A: mko(1 - pR1) },
    RESULT: { '20': mko(p20), '11': mko(p11), '02': mko(p02) },
    P1: partida, P2: partida, TOTAL: totalO,
    FINISH: finish,
    FLAW:   { Y: mko(pFlawY), N: mko(1 - pFlawY) },
  };
}
// Ordem de exibição (chaves "inteiras" do JS reordenam — fixar aqui).
function mkMarketPicks(market, odds) {
  if (market === 'R1') return MK_R1_PICKS;
  if (market === 'DC') return MK_DC_PICKS;
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
    // CHANCE DUPLA: cobre 2 resultados. 1X vence com H ou D; 12 com H ou A; X2 com D ou A.
    case 'DC':     return ((pick === '1X' && (o.winner === 'H' || o.winner === 'D'))
                        || (pick === '12' && (o.winner === 'H' || o.winner === 'A'))
                        || (pick === 'X2' && (o.winner === 'D' || o.winner === 'A'))) ? 'win' : 'lose';
    // PRIMEIRO ROUND: depende de sc.firstRound ('H'/'A'); se o mod não marcou,
    // fica pendente (não liquida como derrota) até ser lançado.
    case 'R1':     return e.firstRound ? (pick === e.firstRound ? 'win' : 'lose') : 'pending';
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
  if (market === 'R1') return { H: 'MANDANTE', A: 'VISITANTE' }[pick];
  if (market === 'DC') return { '1X': 'MANDANTE OU EMPATE', '12': 'MANDANTE OU VISITANTE', 'X2': 'EMPATE OU VISITANTE' }[pick];
  if (market === 'RESULT' || market === 'P1' || market === 'P2') return pick[0] + '×' + pick[1];
  if (market === 'TOTAL') return pick + ' rounds';
  if (market === 'FLAW') return pick === 'Y' ? 'SIM' : 'NÃO';
  if (market === 'FINISH') { const f = MK_FINISHERS.find(x => x.id === pick); return f ? f.name : pick; }
  return pick;
}

// ─── ODDS + APOSTAS DO MATA-MATA (MD5, melhor de 5, primeiro a 3) ────────────
// Confronto do KO = MD5. Cada JOGO do MD5 é uma luta (primeiro a 2 rounds), então
// a prob de vencer UM jogo reusa a prob de partida da liga (mkPartidaWinProb da
// força dos jogadores). Sem escalação visível (blind) -> charEdge não entra.
// Mercados: KVENC (quem passa, sem empate), KPLACAR (3-0/3-1/3-2 dos dois lados),
// KTOTAL (3/4/5 jogos). Pernas de aposta: champId 'mkko', fixtureId 'mkko:<id>'.
// Mercados do confronto, do mais granular pro mais decisivo:
//  KGOLPE (1º golpe: quem acerta primeiro) · KROUND (quem vence o 1º round) ·
//  KG1/KG2/KG3 (quem vence cada JOGO/luta do MD5 — 1º/2º/3º sempre acontecem) ·
//  KPLACAR/KTOTAL/KVENC (do confronto inteiro). São coisas DIFERENTES: golpe <
//  round < jogo < confronto. KGOLPE e KROUND o MOD registra (sc.fh / sc.fr),
//  igual o "primeiro round" da liga; os KGx saem de quem venceu cada jogo.
const MK_KO_MARKETS = ['KVENC', 'KGOLPE', 'KROUND', 'KG1', 'KG2', 'KG3', 'KPLACAR', 'KTOTAL'];
const MK_KO_MARKET_TITLE = { KVENC: 'QUEM PASSA', KGOLPE: '1º GOLPE (QUEM ACERTA PRIMEIRO)', KROUND: 'VENCE O 1º ROUND', KG1: 'VENCE O 1º JOGO', KG2: 'VENCE O 2º JOGO', KG3: 'VENCE O 3º JOGO', KPLACAR: 'PLACAR (MD5)', KTOTAL: 'TOTAL DE JOGOS' };
const MK_KO_GAME_MARKETS = ['KG1', 'KG2', 'KG3'];
// Mercados cujo palpite é um LADO (H/A) — rótulo vira o nick do jogador.
const MK_KO_SIDE_MARKETS = ['KVENC', 'KGOLPE', 'KROUND', 'KG1', 'KG2', 'KG3'];
const MK_KO_PLACAR_PICKS = ['30', '31', '32', '23', '13', '03']; // mandante 3-x / visitante x-3
const MK_KO_TOTAL_PICKS = ['3', '4', '5'];
// Distribuição do MD5 dado p = prob do MANDANTE vencer 1 jogo. Placar do lado que
// fecha 3: p³·(clincha em 3), 3p³q (em 4), 6p³q² (em 5). Simétrico pro visitante.
function mkKoMd5Dist(p) {
  const q = 1 - p;
  const s30 = p * p * p, s31 = 3 * p * p * p * q, s32 = 6 * p * p * p * q * q;
  const s03 = q * q * q, s13 = 3 * q * q * q * p, s23 = 6 * q * q * q * p * p;
  return {
    '30': s30, '31': s31, '32': s32, '03': s03, '13': s13, '23': s23,
    win: s30 + s31 + s32, loss: s03 + s13 + s23,
    t3: s30 + s03, t4: s31 + s13, t5: s32 + s23,
  };
}
// Odds do confronto de mata-mata (mesma compressão/teto das odds da liga). Da
// força da liga sai a prob de round (pRound); dela a prob de jogo (pGame, base do
// MD5) e a prob do 1º golpe (pHit, puxada pro 50-50 porque é mais aleatório).
function computeMkKoOdds(home, away, metrics, draw, scores) {
  const pRound = mkClampP(sigmoid(mkRoundLogit(home, away, metrics, null, {}, draw, scores)));
  const p = mkClampP(mkPartidaWinProb(pRound));       // prob de vencer 1 JOGO (base do MD5)
  const pHit = mkClampP(0.5 + (pRound - 0.5) * 0.5);  // 1º golpe: mais perto de 50-50
  const d = mkKoMd5Dist(p);
  const mko = (pp) => (!(pp > 0) || !isFinite(pp)) ? MK_ODD_FALLBACK
    : Math.max(ODD_MIN, mkCapOdd(1 + (1 / pp - 1) * MK_ODD_K));
  const placar = {}; MK_KO_PLACAR_PICKS.forEach(k => { placar[k] = mko(d[k]); });
  const perGame = { H: mko(p), A: mko(1 - p) };        // quem vence UM jogo (iid) — mesma odd nos 3
  return {
    KVENC:   { H: mko(d.win), A: mko(d.loss) },
    KGOLPE:  { H: mko(pHit), A: mko(1 - pHit) },
    KROUND:  { H: mko(pRound), A: mko(1 - pRound) },
    KG1: perGame, KG2: perGame, KG3: perGame,
    KPLACAR: placar,
    KTOTAL:  { '3': mko(d.t3), '4': mko(d.t4), '5': mko(d.t5) },
    _p: p, _dist: d,
  };
}
// Liquidação de uma perna do KO. sc = ko.scores[matchId].
function mkKoLegResult(market, pick, sc) {
  // 1º GOLPE / 1º ROUND: o mod registra sc.fh / sc.fr ('H'|'A'). Pendente até lá.
  if (market === 'KGOLPE') { const v = sc && sc.fh; return (v !== 'H' && v !== 'A') ? 'pending' : (pick === v ? 'win' : 'lose'); }
  if (market === 'KROUND') { const v = sc && sc.fr; return (v !== 'H' && v !== 'A') ? 'pending' : (pick === v ? 'win' : 'lose'); }
  // Mercados POR JOGO (KG1/KG2/KG3): liquidam assim que o jogo é lançado, mesmo
  // antes do confronto acabar. Pendente enquanto aquele jogo não saiu.
  if (MK_KO_GAME_MARKETS.indexOf(market) !== -1) {
    const gv = sc && sc['g' + market.slice(2)];
    if (gv !== 'H' && gv !== 'A') return 'pending';
    return pick === gv ? 'win' : 'lose';
  }
  const o = mkKoOutcome(sc);
  if (!o.done) return 'pending';
  const placar = o.winner === 'H' ? ('3' + o.a) : (o.h + '3'); // vencedor fez 3
  switch (market) {
    case 'KVENC':   return pick === o.winner ? 'win' : 'lose';
    case 'KPLACAR': return pick === placar ? 'win' : 'lose';
    case 'KTOTAL':  return pick === String(o.h + o.a) ? 'win' : 'lose';
    default: return 'pending';
  }
}
// Rótulo do palpite do KO (usa os nicks reais nos mercados de LADO).
function mkKoPickLabel(market, pick, home, away) {
  if (MK_KO_SIDE_MARKETS.indexOf(market) !== -1) return pick === 'H' ? home : pick === 'A' ? away : pick;
  if (market === 'KPLACAR') return pick[0] + '×' + pick[1];
  if (market === 'KTOTAL') return pick + ' jogos';
  return pick;
}
function mkKoMarketPicks(market) {
  if (MK_KO_SIDE_MARKETS.indexOf(market) !== -1) return ['H', 'A'];
  if (market === 'KPLACAR') return MK_KO_PLACAR_PICKS;
  if (market === 'KTOTAL') return MK_KO_TOTAL_PICKS;
  return [];
}
// Confronto do KO está APOSTÁVEL? Os dois lados definidos, ainda não começou
// (nenhum jogo lançado) e não terminou. `m` = item de mkKoBracket; sc = ko.scores[id].
function mkKoBettable(m, sc) {
  return !!(m && m.home && m.away && !m.done && !mkKoMatchStarted(sc));
}
// Odd a partir de uma prob (mesma compressão/teto/piso das outras odds do KO).
function mkKoOddFromProb(pp) {
  return (!(pp > 0) || !isFinite(pp)) ? MK_ODD_FALLBACK
    : Math.max(ODD_MIN, mkCapOdd(1 + (1 / pp - 1) * MK_ODD_K));
}

// ─── MERCADOS DO CAMPEONATO (outright: campeão, finalista, etc.) ─────────────
const MK_KO_TOURNEY_MARKETS = ['CHAMP', 'FINAL', 'SEMI', 'VICE', 'PODIUM'];
const MK_KO_TOURNEY_TITLE = { CHAMP: 'CAMPEÃO DO MK', FINAL: 'CHEGA NA FINAL', SEMI: 'CHEGA NA SEMI', VICE: 'VICE-CAMPEÃO', PODIUM: 'PÓDIO (TOP 3)' };
const MK_KO_TOURNEY_PROB = { CHAMP: 'champ', FINAL: 'final', SEMI: 'semi', VICE: 'vice', PODIUM: 'podium' };
// Prob de cada jogador em cada estágio, simulando o chaveamento a partir dos seeds
// + resultados JÁ decididos (fixos, prob 1) + prob de confronto pros futuros (P(a
// vence b num MD5), da força da liga). Devolve { nick: { champ, final, semi, vice, podium } }.
function mkKoTournamentProbs(seeds, koScores, metrics, draw, scores) {
  const out = {};
  (seeds || []).forEach(p => { if (p) out[p] = { champ: 0, final: 0, semi: 0, vice: 0, podium: 0 }; });
  if (!seeds || seeds.filter(Boolean).length < 8) return out;
  const S = (i) => seeds[i - 1];
  const ks = koScores || {};
  const cache = {};
  const pWin = (a, b) => { const k = a + '|' + b; if (cache[k] != null) return cache[k]; const v = computeMkKoOdds(a, b, metrics, draw, scores)._dist.win; cache[k] = v; return v; };
  const decided = (id, a, b) => { const o = mkKoOutcome(ks[id]); return (o.done && a && b) ? (o.winner === 'H' ? [a, b] : [b, a]) : null; };
  const dist = (id, a, b) => { if (!a || !b) return []; const d = decided(id, a, b); if (d) return [[d[0], 1]]; const p = pWin(a, b); return [[a, p], [b, 1 - p]]; };
  const agg = (list) => { const m = {}; list.forEach(([w, p]) => { m[w] = (m[w] || 0) + p; }); return Object.keys(m).map(w => [w, m[w]]); };
  const dR1 = dist('R1', S(3), S(8)), dR2 = dist('R2', S(4), S(7)), dR3 = dist('R3', S(5), S(6));
  const dR4 = [];
  dR2.forEach(([w2, p2]) => dR3.forEach(([w3, p3]) => {
    const d = decided('R4', w2, w3);
    if (d) dR4.push([d[0], p2 * p3]);
    else { const pw = pWin(w2, w3); dR4.push([w2, p2 * p3 * pw]); dR4.push([w3, p2 * p3 * (1 - pw)]); }
  }));
  const aR1 = agg(dR1), aR4 = agg(dR4);
  out[S(1)].semi = 1; out[S(2)].semi = 1;               // cabeças de chave já estão na semi
  aR1.forEach(([w, p]) => { out[w].semi += p; });
  aR4.forEach(([w, p]) => { out[w].semi += p; });
  const wSF1 = [], loSF1 = [], wSF2 = [], loSF2 = [];   // vencedores/perdedores das semis
  aR1.forEach(([w, p]) => { const d = decided('SF1', S(1), w);
    if (d) { wSF1.push([d[0], p]); loSF1.push([d[1], p]); }
    else { const pw = pWin(S(1), w); wSF1.push([S(1), p * pw]); wSF1.push([w, p * (1 - pw)]); loSF1.push([w, p * pw]); loSF1.push([S(1), p * (1 - pw)]); } });
  aR4.forEach(([w, p]) => { const d = decided('SF2', S(2), w);
    if (d) { wSF2.push([d[0], p]); loSF2.push([d[1], p]); }
    else { const pw = pWin(S(2), w); wSF2.push([S(2), p * pw]); wSF2.push([w, p * (1 - pw)]); loSF2.push([w, p * pw]); loSF2.push([S(2), p * (1 - pw)]); } });
  const awSF1 = agg(wSF1), awSF2 = agg(wSF2), aloSF1 = agg(loSF1), aloSF2 = agg(loSF2);
  awSF1.forEach(([w, p]) => { out[w].final += p; });
  awSF2.forEach(([w, p]) => { out[w].final += p; });
  awSF1.forEach(([a, pa]) => awSF2.forEach(([b, pb]) => { const p = pa * pb; const d = decided('F', a, b);
    if (d) out[d[0]].champ += p; else { const pw = pWin(a, b); out[a].champ += p * pw; out[b].champ += p * (1 - pw); } }));
  const p3 = {};                                        // 3º lugar = vence o T3 (perdedor SF1 vs perdedor SF2)
  aloSF1.forEach(([a, pa]) => aloSF2.forEach(([b, pb]) => { const p = pa * pb; const d = decided('T3', a, b);
    if (d) p3[d[0]] = (p3[d[0]] || 0) + p; else { const pw = pWin(a, b); p3[a] = (p3[a] || 0) + p * pw; p3[b] = (p3[b] || 0) + p * (1 - pw); } }));
  Object.keys(out).forEach(x => { out[x].vice = Math.max(0, out[x].final - out[x].champ); out[x].podium = out[x].final + (p3[x] || 0); });
  return out;
}
// Liquidação de uma perna de mercado do campeonato. br = mkKoBracket(seeds, koScores).
function mkKoTourneyLegResult(market, player, br) {
  if (!br || !br.F || !br.SF1 || !br.SF2 || !br.T3) return 'pending';
  switch (market) {
    case 'CHAMP':  return br.F.done ? (br.F.winner === player ? 'win' : 'lose') : 'pending';
    case 'VICE':   return br.F.done ? (br.F.loser === player ? 'win' : 'lose') : 'pending';
    case 'FINAL':  return (br.F.home && br.F.away) ? ((player === br.F.home || player === br.F.away) ? 'win' : 'lose') : 'pending';
    case 'SEMI':   return (br.SF1.away && br.SF2.away) ? ([br.SF1.home, br.SF1.away, br.SF2.home, br.SF2.away].indexOf(player) !== -1 ? 'win' : 'lose') : 'pending';
    case 'PODIUM':
      // Campeão e vice JÁ estão no pódio assim que a final sai — não espera o 3º lugar
      // (senão um palpite garantido ficaria pendente até o T3, que pode demorar/ser pulado).
      if (br.F.done && (player === br.F.winner || player === br.F.loser)) return 'win';
      return (br.F.done && br.T3.done) ? ([br.F.winner, br.F.loser, br.T3.winner].indexOf(player) !== -1 ? 'win' : 'lose') : 'pending';
    default: return 'pending';
  }
}
// Mercado do campeonato ainda ABERTO pra aposta? (o desfecho ainda não é conhecido)
function mkKoTourneyOpen(market, br) {
  switch (market) {
    case 'CHAMP': case 'VICE': return !br.F.done;
    case 'FINAL':  return !(br.F.home && br.F.away);
    case 'SEMI':   return !(br.SF1.away && br.SF2.away);
    case 'PODIUM': return !(br.F.done && br.T3.done);
    default: return false;
  }
}
// Um palpite outright só é OFERECIDO se ainda tem incerteza real: 0 < prob < 1/ODD_MIN.
// Acima de 1/ODD_MIN o piso de odd (ODD_MIN) pagaria prêmio num evento quase certo
// (ex: cabeça de chave "chega na semi" com prob≈1) — vira dinheiro grátis / +EV. Abaixo
// do piso, a fórmula de compressão (mkKoOddFromProb) já garante margem da casa pra
// qualquer prob<1. Vale no cliente (esconde) E no servidor (recusa) — sempre igual.
function mkKoTourneyPickBettable(prob) { return prob > 0 && prob < 1 / ODD_MIN; }

// ── PRÓXIMO JOGO PENDENTE (uso em UI — não trava mais o "liberados") ────────
// Rodada do PRÓXIMO jogo pendente (não lançado) de um jogador. Infinity se já
// lançou tudo. Não bloqueia mais nada em mkLiberadoGames (jogos liberam todos
// de uma vez, sem cap de "quantas rodadas à frente") — usada só pra exibir
// onde o jogador está na campanha.
function mkPlayerFirstPendingRound(player, draw, scores) {
  if (!draw) return Infinity;
  const gk = (r, gi) => r.phase + '-' + r.n + '-' + gi;
  for (let ri = 0; ri < draw.length; ri++) {
    const r = draw[ri];
    const gi = (r.games || []).findIndex(g => g.home === player || g.away === player);
    if (gi < 0) continue;
    if (mkGameVoid(r.games[gi])) continue; // jogo anulado (adversário retirado) = resolvido, não bloqueia
    if (!mkMatchOutcome((scores || {})[gk(r, gi)] || {})) return ri;
  }
  return Infinity;
}
// Jogos LIBERADOS pra jogar/apostar AGORA: todo jogo ainda não lançado da fase
// atual, sem trava por "estar atrasado" — não capa mais quantas rodadas à
// frente dá pra jogar. Retorna [{ r, ri, g, gi, key }].
function mkLiberadoGames(draw, scores) {
  if (!draw || !draw.length) return [];
  const gk = (r, gi) => r.phase + '-' + r.n + '-' + gi;
  // A VOLTA NUNCA libera antes da virada IDA->VOLTA: enquanto a IDA não fechar,
  // jogo da VOLTA não libera. Senão um jogador jogaria a volta cedo e perderia a
  // janela de re-escolher o elenco quando a volta começa (ver mkRosterLockedFor).
  const idaDone = mkIdaComplete(draw, scores);
  const out = [];
  draw.forEach((r, ri) => (r.games || []).forEach((g, gi) => {
    if (mkGameVoid(g)) return; // jogo anulado (jogador retirado) não entra em liberados
    if (r.phase === 'VOLTA' && !idaDone) return; // trava a volta até a ida fechar
    if (mkMatchOutcome((scores || {})[gk(r, gi)] || {})) return;
    out.push({ r, ri, g, gi, key: gk(r, gi) });
  }));
  return out;
}

// ── ELENCO DO MK por FASE (ida/volta) ───────────────────────────────────────
// O elenco trava quando o jogador joga UM confronto na FASE atual. Quando o
// turno de IDA acaba (todos os jogos de ida concluídos), a VOLTA começa e o
// elenco LIBERA de novo — até o jogador jogar a 1ª partida da volta.
const mkRoundConcluded = (r, scores) => {
  const gk = (ri, gi) => ri.phase + '-' + ri.n + '-' + gi;
  return (r.games || []).length > 0 && (r.games || []).every((g, gi) => mkGameVoid(g) || !!mkMatchOutcome((scores || {})[gk(r, gi)] || {}));
};
function mkIdaComplete(draw, scores) {
  const ida = (draw || []).filter(r => r.phase === 'IDA');
  return ida.length > 0 && ida.every(r => mkRoundConcluded(r, scores));
}
function mkCurrentPhase(draw, scores) {
  const hasVolta = (draw || []).some(r => r.phase === 'VOLTA');
  return (hasVolta && mkIdaComplete(draw, scores)) ? 'VOLTA' : 'IDA';
}
// Jogador já jogou (confronto concluído) algum jogo da fase indicada?
function mkPlayedInPhase(nick, phase, draw, scores) {
  const gk = (r, gi) => r.phase + '-' + r.n + '-' + gi;
  return (draw || []).some(r => r.phase === phase && (r.games || []).some((g, gi) =>
    (g.home === nick || g.away === nick) && !mkGameVoid(g) && !!mkMatchOutcome((scores || {})[gk(r, gi)] || {})));
}
// Elenco travado pro nick? (jogou na fase atual). Fonte única pro App e a UI.
function mkRosterLockedFor(nick, draw, scores) {
  if (!draw || !nick) return false;
  return mkPlayedInPhase(nick, mkCurrentPhase(draw, scores), draw, scores);
}

// ── RODADAS COMPLETAS (base do bônus por rodada) ────────────────────────────
// Índices das rodadas 100% concluídas. Set por campeonato evita duplo-crédito e
// lida com rodadas que fecham fora de ordem (MK com adiantar).
function mkCompleteRoundIdxs(draw, scores) {
  const out = [];
  (draw || []).forEach((r, i) => { if (mkRoundConcluded(r, scores)) out.push(i); });
  return out;
}
function fifaCompleteRoundIdxs(cs) {
  const rounds = (cs && cs.rounds) || [];
  const out = [];
  rounds.forEach((r, i) => {
    if (Array.isArray(r) && r.length > 0 && r.every(g => g && g.gh !== '' && g.ga !== '' && g.gh != null && g.ga != null)) out.push(i);
  });
  return out;
}

const START_PC = 50;
// Bônus por RODADA: quando uma rodada de qualquer campeonato (FIFA tabela + MK)
// fecha, todo mundo ganha isso. Substituiu o antigo bônus semanal.
const ROUND_BONUS_PC = 1000;
// DIA OFICIAL: admin liga e toda aposta vencedora paga +25% de PC enquanto ativo.
const OFFICIAL_DAY_MULT = 1.25;

// ── TICKETS ABERTOS / REPUTAÇÃO (M9 — "Mesa dos Cartolas") ──────────────────
// Quem copia um ticket aberto paga o stake e recebe 10% de cashback NA HORA (da
// casa, não do bolso do dono). O dono ganha/perde reputação conforme os
// seguidores que copiaram ganham/perdem (assimétrico: perde mais que ganha).
const CASHBACK_RATE = 0.10;
const MAX_OPEN_TICKETS = 3; // tickets abertos simultâneos por dono (anti-flood)
// Curadoria da MESA: só publica os cupons com odd combinada >= piso (as calls
// ousadas). Apostas "seguras" de odd baixa não entram no feed de cópia.
// MK tem odds comprimidas (teto ~13) — usa piso menor pra Mesa não ficar vazia.
const MESA_MIN_ODDS = 5;      // piso padrão (FIFA e demais)
const MESA_MIN_ODDS_MK = 2;   // piso do MK (odds mais baixas)
const mesaMinOddsFor = (champId) => champId === 'mk' ? MESA_MIN_ODDS_MK : MESA_MIN_ODDS;
const REP_LEVELS = [
  { min: 0,    name: 'NOVATO',       icon: 'ticket',  color: '#8c8478' },
  { min: 50,   name: 'PALPITEIRO',   icon: 'target',  color: '#3f9e57' },
  { min: 150,  name: 'CARTOLA',      icon: 'crown',   color: '#3a86c8' },
  { min: 400,  name: 'CARTOLA OURO', icon: 'trophy',  color: '#d9a521' },
  { min: 1000, name: 'ORÁCULO',      icon: 'sparkle', color: '#a64fd6' },
];
function repLevel(score) { let lv = REP_LEVELS[0]; for (const l of REP_LEVELS) if ((score || 0) >= l.min) lv = l; return lv; }
function repScoreOf(user) { return Math.max(0, Math.round(((user && user.rep && user.rep.score) || 0))); }
// Tier visual do BILHETE pela ODD do cupom (produto das pernas): quanto mais
// ousada a call, mais raro o bilhete. holo > dourado > brilhante > normal >
// rasgado (<2, "seguro"/baixo). MK tem odds comprimidas (teto ~13) — usa faixas
// menores: holo 5 / dourado 4 / brilhante 2.5. Demais: holo 15 / 10 / 6.
function oddTier(odds, champId) {
  const o = Number(odds) || 0;
  const t = champId === 'mk' ? { holo: 5, gold: 4, shiny: 2.5 } : { holo: 15, gold: 10, shiny: 6 };
  if (o >= t.holo) return 'holo';
  if (o >= t.gold) return 'gold';
  if (o >= t.shiny) return 'shiny';
  if (o >= 2) return 'normal';
  return 'torn';
}
const TIER_TAG = { holo: 'HOLOGRÁFICO', gold: 'DOURADO', shiny: 'BRILHANTE' };
// Copiar cupom público = SEGURO com custo. Perdeu: volta CASHBACK_RATE do stake
// (seguro). Ganhou: paga FOLLOW_FEE do lucro (taxa de seguidor); metade disso
// (TIP_COMMISSION) é a gorjeta que vai pro autor da dica.
const FOLLOW_FEE = 0.10;     // taxa sobre o lucro do copiador quando ganha
const TIP_COMMISSION = 0.05; // parte da taxa que vira gorjeta do cartola
// Delta de reputação do DONO por cópia resolvida. Peso pelo stake do seguidor
// (cap em 100 PC pra não dar pra inflar) + assimetria (perda pesa 1.3x).
function repDeltaForCopy(copy, won) {
  const weight = Math.max(0.3, Math.min(1, (copy.amount || 0) / 100));
  const base = 10;
  return won ? Math.round(base * weight) : -Math.round(base * 1.3 * weight);
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

// ─── TEMAS PRÉ-MADE (aparência por jogador) ─────────────────────────────────
// Cada jogador escolhe um tema (cor de destaque + fundo + claro/escuro). Persiste
// em users[nick].theme (Firestore, sincroniza entre dispositivos) como um ID +
// mirror em localStorage (aplica instantâneo no boot, antes do snapshot, sem
// "flash"). Dark é por CLASSE (html.pv-dark), independente do SO.
// 12 claros + 9 escuros. O 1º (classico) é o padrão laranja/papel.
const THEME_KEY = 'pv-theme';
const DEFAULT_THEME = 'classico';   // claro padrão
const DEFAULT_DARK_THEME = 'breu';  // usado só se o SO pede dark e ninguém escolheu
const DEFAULT_ACCENT = '#d76414';
const BONE_BG = 'radial-gradient(circle at 18% 12%, rgba(215,100,20,0.10), transparent 42%), radial-gradient(circle at 82% 88%, rgba(215,100,20,0.06), transparent 42%), #f4ead7';
// Fundo do tema CELIN: peças de quebra-cabeça (autismo) em 4 cores bem sutis,
// sobre o papel — SVG inline tileável (80x80). ORGULHO: lavada arco-íris (LGBT).
const PUZZLE_PIECE_D = 'M6,6 h6 a3,3 0 1 1 6,0 h6 v6 a3,3 0 1 0 0,6 v6 h-6 a3,3 0 1 1 -6,0 h-6 v-6 a3,3 0 1 0 0,-6 z';
const puzzlePiece = (x, y, color) => "<path transform='translate(" + x + "," + y + ")' d='" + PUZZLE_PIECE_D + "' fill='" + color + "'/>";
const CELIN_BG = "url(\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'><g fill-opacity='0.18'>"
  + puzzlePiece(4, 4, '%233a86c8') + puzzlePiece(44, 4, '%23e23b3b') + puzzlePiece(4, 44, '%23e8b23a') + puzzlePiece(44, 44, '%233fa35b')
  + "</g></svg>\"), #f4ead7";
const ORGULHO_BG = 'linear-gradient(160deg, rgba(228,3,3,0.17), rgba(255,140,0,0.17) 20%, rgba(255,214,0,0.17) 40%, rgba(0,140,60,0.17) 60%, rgba(0,90,255,0.17) 80%, rgba(140,20,160,0.17)), #f4ead7';
const PV_THEMES = [
  // ── CLAROS (papel) ──
  { id: 'classico',  name: 'Clássico', accent: '#d76414', dark: false, bg: BONE_BG },
  { id: 'sangue',    name: 'Sangue',   accent: '#c0392b', dark: false, bg: 'radial-gradient(circle at 18% 12%, rgba(192,57,43,0.10), transparent 42%), radial-gradient(circle at 82% 88%, rgba(192,57,43,0.06), transparent 42%), #f4ead7' },
  { id: 'chiclete',  name: 'Chiclete', accent: '#c2185b', dark: false, bg: 'radial-gradient(circle at 18% 12%, rgba(194,24,91,0.09), transparent 42%), radial-gradient(circle at 82% 88%, rgba(194,24,91,0.05), transparent 42%), #f4ead7' },
  { id: 'oceano',    name: 'Oceano',   accent: '#2f6fb0', dark: false, bg: 'radial-gradient(circle at 18% 12%, rgba(47,111,176,0.09), transparent 42%), radial-gradient(circle at 82% 88%, rgba(47,111,176,0.05), transparent 42%), #f4ead7' },
  { id: 'hortela',   name: 'Hortelã',  accent: '#1c8f86', dark: false, bg: 'radial-gradient(circle at 18% 12%, rgba(28,143,134,0.09), transparent 42%), radial-gradient(circle at 82% 88%, rgba(28,143,134,0.05), transparent 42%), #f4ead7' },
  { id: 'campo',     name: 'Campo',    accent: '#2a8f3f', dark: false, bg: 'radial-gradient(circle at 18% 12%, rgba(42,143,63,0.09), transparent 42%), radial-gradient(circle at 82% 88%, rgba(42,143,63,0.05), transparent 42%), #f4ead7' },
  { id: 'ouro',      name: 'Ouro',     accent: '#c9a227', dark: false, bg: 'radial-gradient(circle at 18% 12%, rgba(201,162,39,0.11), transparent 42%), radial-gradient(circle at 82% 88%, rgba(201,162,39,0.06), transparent 42%), #f4ead7' },
  { id: 'petroleo',  name: 'Petróleo', accent: '#1b4965', dark: false, bg: 'radial-gradient(circle at 18% 12%, rgba(27,73,101,0.10), transparent 42%), radial-gradient(circle at 82% 88%, rgba(27,73,101,0.05), transparent 42%), #f4ead7' },
  { id: 'vinho',     name: 'Vinho',    accent: '#8a2846', dark: false, bg: 'radial-gradient(circle at 18% 12%, rgba(138,40,70,0.10), transparent 42%), radial-gradient(circle at 82% 88%, rgba(138,40,70,0.05), transparent 42%), #f4ead7' },
  { id: 'musgo',     name: 'Musgo',    accent: '#4f5a28', dark: false, bg: 'radial-gradient(circle at 18% 12%, rgba(79,90,40,0.10), transparent 42%), radial-gradient(circle at 82% 88%, rgba(79,90,40,0.05), transparent 42%), #f4ead7' },
  { id: 'celin',     name: 'Celin',    accent: '#3a86c8', dark: false, bg: CELIN_BG },   // quebra-cabeça (autismo)
  { id: 'orgulho',   name: 'Orgulho',  accent: '#d02a9c', dark: false, bg: ORGULHO_BG }, // LGBT / arco-íris
  // ── ESCUROS (mesa escura, cards continuam papel) ──
  { id: 'breu',       name: 'Breu',       accent: '#d76414', dark: true, bg: 'radial-gradient(circle at 18% 12%, rgba(215,100,20,0.07), transparent 42%), radial-gradient(circle at 82% 88%, rgba(215,100,20,0.04), transparent 42%), #16100b' },
  { id: 'meia-noite', name: 'Meia-Noite', accent: '#2f6fb0', dark: true, bg: 'radial-gradient(circle at 18% 12%, rgba(47,111,176,0.10), transparent 42%), radial-gradient(circle at 82% 88%, rgba(47,111,176,0.05), transparent 42%), #0c1119' },
  { id: 'ametista',   name: 'Ametista',   accent: '#7a4dc9', dark: true, bg: 'radial-gradient(circle at 18% 12%, rgba(122,77,201,0.11), transparent 42%), radial-gradient(circle at 82% 88%, rgba(122,77,201,0.06), transparent 42%), #120d1c' },
  { id: 'neon',       name: 'Neon',       accent: '#1c8f86', dark: true, bg: 'radial-gradient(circle at 18% 12%, rgba(28,143,134,0.12), transparent 42%), radial-gradient(circle at 82% 88%, rgba(28,143,134,0.06), transparent 42%), #0a1413' },
  { id: 'grafite',    name: 'Grafite',    accent: '#5a5048', dark: true, bg: 'radial-gradient(circle at 18% 12%, rgba(90,80,72,0.10), transparent 42%), radial-gradient(circle at 82% 88%, rgba(90,80,72,0.05), transparent 42%), #14110e' },
  { id: 'petroleo-noite', name: 'Petróleo Escuro', accent: '#2e8ba0', dark: true, bg: 'radial-gradient(circle at 18% 12%, rgba(46,139,160,0.12), transparent 42%), radial-gradient(circle at 82% 88%, rgba(46,139,160,0.06), transparent 42%), #08161a' },
  { id: 'borgonha',   name: 'Borgonha',   accent: '#b5476a', dark: true, bg: 'radial-gradient(circle at 18% 12%, rgba(181,71,106,0.12), transparent 42%), radial-gradient(circle at 82% 88%, rgba(181,71,106,0.06), transparent 42%), #1a0d12' },
  { id: 'floresta',   name: 'Floresta',   accent: '#4a9d5a', dark: true, bg: 'radial-gradient(circle at 18% 12%, rgba(74,157,90,0.12), transparent 42%), radial-gradient(circle at 82% 88%, rgba(74,157,90,0.06), transparent 42%), #0a140c' },
  { id: 'carmesim',   name: 'Carmesim',   accent: '#d61f2b', dark: true, bg: 'radial-gradient(circle at 18% 12%, rgba(214,31,43,0.16), transparent 42%), radial-gradient(circle at 82% 88%, rgba(214,31,43,0.09), transparent 45%), #0b0304' },
];
const pvThemeById = (id) => PV_THEMES.find(t => t.id === id) || null;
function loadThemeLS() {
  try { return localStorage.getItem(THEME_KEY) || null; } catch (e) { return null; }
}
function saveThemeLS(id) {
  try { if (id) localStorage.setItem(THEME_KEY, id); else localStorage.removeItem(THEME_KEY); } catch (e) {}
}
// Escurece um hex multiplicando os canais por f (0-1). Usado pro --pv-orange-2.
function darkenHex(hex, f) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map(x => Math.max(0, Math.min(255, Math.round(x * f))).toString(16).padStart(2, '0'));
  return '#' + ch.join('');
}
// Aplica um tema (id) OU, por retrocompat, uma cor accent hex legada (formato
// usado antes do sistema de temas: vira accent custom sobre o claro padrão).
function applyThemeValue(val) {
  const root = document.documentElement;
  if (!root) return;
  // Legado: hex accent salvo antes dos temas pré-made.
  if (typeof val === 'string' && /^#?[0-9a-fA-F]{6}$/.test(val)) {
    const accent = val[0] === '#' ? val : '#' + val;
    root.style.setProperty('--pv-orange', accent);
    root.style.setProperty('--pv-orange-2', darkenHex(accent, 0.78));
    root.style.removeProperty('--pv-bg');
    root.classList.remove('pv-dark');
    root.setAttribute('data-pv-theme', '_legacy');
    return;
  }
  const t = pvThemeById(val) || pvThemeById(DEFAULT_THEME);
  root.style.setProperty('--pv-orange', t.accent);
  root.style.setProperty('--pv-orange-2', darkenHex(t.accent, 0.78));
  if (t.bg) root.style.setProperty('--pv-bg', t.bg); else root.style.removeProperty('--pv-bg');
  root.classList.toggle('pv-dark', !!t.dark);
  root.setAttribute('data-pv-theme', t.id);
}
// Tema padrão pra quem NÃO escolheu: segue o claro/escuro do SO.
function osDefaultThemeId() {
  try { return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? DEFAULT_DARK_THEME : DEFAULT_THEME; }
  catch (e) { return DEFAULT_THEME; }
}
// Boot: aplica o tema salvo no localStorage já no load (antes do React). Se
// ninguém escolheu, segue o SO (claro/escuro) SEM persistir.
(function bootTheme() {
  const saved = loadThemeLS();
  applyThemeValue(saved || osDefaultThemeId());
})();
// matchMedia: só reage pra quem NÃO fixou tema (mirror vazio). Assim que escolhe, vira no-op.
(function bindOsTheme() {
  try {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { if (loadThemeLS()) return; applyThemeValue(osDefaultThemeId()); };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else if (mq.addListener) mq.addListener(handler);
  } catch (e) {}
})();

const BET_DOC      = () => window.db.doc('primitivao/apostas');
const CLASSIF_DOC  = () => window.db.doc('primitivao/state');
const AVATARS_DOC  = () => window.db.doc('primitivao/avatars');
const CHAMP_DOC    = () => window.db.doc('primitivao/championships'); // M8: campeonatos lançados pelo admin

// ─── AVATARES CUSTOM (upload do jogador) ────────────────────────────────────
// Guardados num doc SEPARADO (primitivao/avatars), shape { nickLower: dataUrl },
// pra NÃO inchar o doc crítico primitivao/apostas. Mapa de módulo lido pelo
// <Avatar> por nick; o App tem um listener (guardas iguais aos de apostas) que
// atualiza AVATAR_MAP + bumpa um contador pra re-render. O thumbnail é comprimido
// no cliente (canvas) pra caber em ~20KB — "vai ter gente mandando arquivo grande".
let AVATAR_MAP = {};
const avatarFor = (nick) => (nick ? (AVATAR_MAP[String(nick).toLowerCase()] || null) : null);

// Comprime uma imagem (dataURL) num quadrado pequeno (cover, centralizado) e
// baixa qualidade/resolução até caber em maxKB. Retorna dataURL JPEG. Rejeita
// se não conseguir (raríssimo: ainda assim oferecemos erro amigável na UI).
function compressAvatarImage(srcDataUrl, maxKB) {
  const cap = maxKB || 20;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const render = (q, dim) => {
        const c = document.createElement('canvas');
        c.width = dim; c.height = dim;
        const ctx = c.getContext('2d');
        const s = Math.min(img.width, img.height) || 1;
        const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
        ctx.drawImage(img, sx, sy, s, s, 0, 0, dim, dim);
        return c.toDataURL('image/jpeg', q);
      };
      let size = 256, q = 0.82;
      let out = render(q, size);
      while (out.length / 1024 > cap && (q > 0.4 || size > 96)) {
        if (q > 0.42) q -= 0.08; else { size = Math.max(96, size - 32); q = 0.7; }
        out = render(q, size);
      }
      if (out.length / 1024 > cap) { reject(new Error('imagem grande demais')); return; }
      resolve(out);
    };
    img.onerror = () => reject(new Error('imagem inválida'));
    img.src = srcDataUrl;
  });
}
// Grava (comprimido) o avatar do nick. merge:true — não toca nos outros.
async function setAvatarImage(nick, srcDataUrl) {
  if (!nick) return { err: 'sem nick' };
  const key = String(nick).toLowerCase();
  try {
    const data = await compressAvatarImage(srcDataUrl, 20);
    await AVATARS_DOC().set({ [key]: data }, { merge: true });
    AVATAR_MAP = { ...AVATAR_MAP, [key]: data };
    return { ok: true };
  } catch (e) {
    console.warn('setAvatarImage failed', e);
    const code = String((e && (e.code || e.message)) || '');
    if (/permission|insufficient/i.test(code)) return { err: 'rules' };
    return { err: (e && e.message) || 'falha ao enviar' };
  }
}
// Remove o avatar do nick (volta pro escudo do time).
async function clearAvatarImage(nick) {
  if (!nick) return;
  const key = String(nick).toLowerCase();
  try {
    await AVATARS_DOC().set({ [key]: firebase.firestore.FieldValue.delete() }, { merge: true });
    const next = { ...AVATAR_MAP }; delete next[key]; AVATAR_MAP = next;
  } catch (e) { console.warn('clearAvatarImage failed', e); }
}

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
    const [betSnap, classifSnap, avatarSnap, champSnap] = await Promise.all([
      BET_DOC().get(),
      CLASSIF_DOC().get(),
      AVATARS_DOC().get(),
      CHAMP_DOC().get(),
    ]);
    const apostas       = parseDocJsonSafe(betSnap);
    const classificacao = parseDocJsonSafe(classifSnap);
    const avatars       = avatarSnap.exists ? (avatarSnap.data() || {}) : {};
    const championships = parseDocJsonSafe(champSnap);
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
        ? { results: topLevelWorldcup.results || {}, picks: topLevelWorldcup.picks || {}, thirds: topLevelWorldcup.thirds || {} }
        : (apostasData.worldcup || { results: {}, picks: {} });
      if (Array.isArray(topLevelNews)) apostasData.news = topLevelNews;
      if (typeof topLevelWebhook === 'string') apostasData.discord_webhook = topLevelWebhook;
    }
    const wcPicks = Object.values(apostasData?.worldcup?.picks || {})
                          .reduce((s, perUser) => s + Object.keys(perUser || {}).length, 0);
    const wcResults = Object.keys(apostasData?.worldcup?.results || {}).length;
    const payload = {
      exportedAt: new Date().toISOString(),
      version: 8,
      source: 'browser-admin',
      apostas:       apostasData,
      classificacao: classificacao.data,
      avatars,   // doc separado primitivao/avatars { nick: dataUrl }
      championships: championships.data,   // doc separado primitivao/championships (M8)
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
      avatars:   Object.keys(avatars).length,
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
        ? { results: worldcup.results || {}, picks: worldcup.picks || {}, thirds: worldcup.thirds || {} }
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
    // Avatares: só escreve se o backup TEM avatares (merge:true). Backup antigo
    // (sem o campo) NÃO apaga os avatares atuais.
    if (payload.avatars && typeof payload.avatars === 'object' && Object.keys(payload.avatars).length > 0) {
      writes.push(AVATARS_DOC().set(payload.avatars, { merge: true }));
    }
    // Campeonatos (M8): só escreve se o backup tem (não apaga os atuais num backup antigo).
    if (payload.championships && typeof payload.championships === 'object') {
      writes.push(CHAMP_DOC().set({ json: JSON.stringify(payload.championships), updatedAt: Date.now() }, { merge: true }));
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
        avatars:   Object.keys(payload.avatars || {}).length,
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
      // Avatares custom: zera o doc inteiro (não há config a preservar aqui).
      AVATARS_DOC().set({}),
      // Campeonatos (M8): zera pro estado inicial.
      CHAMP_DOC().set({ json: JSON.stringify({ champs: {} }), updatedAt: Date.now() }, { merge: true }),
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
// Assinatura canônica das pernas (pra achar cupons IDÊNTICOS na Mesa): conjunto
// ORDENADO de fixtureId|market|pick. Ignora odds (podem variar no tempo).
function legsSignature(legs) {
  return (legs || [])
    .map(l => String(l.fixtureId) + '|' + String(l.market) + '|' + String(l.pick))
    .sort()
    .join('~');
}
function ticketStatusFromLegs(legs) {
  if (legs.some(l => l.result === 'lose')) return 'lost';
  if (legs.length && legs.every(l => l.result === 'win')) return 'won';
  return 'pending';
}
function legLabel(leg, teamPlayers) {
  const fx = leg._fix;
  if (!fx) return '—';
  const h = fifaUserOf(fx.home, teamPlayers);
  const a = fifaUserOf(fx.away, teamPlayers);
  const sn = leg.pick === 'Y' ? 'SIM' : 'NÃO';
  switch (leg.market) {
    case 'BTTS': return `${h}×${a} · AMBOS MARCAM: ${sn}`;
    case 'NM':   return `${h}×${a} · NINGUÉM MARCA: ${sn}`;
    case 'O3H':  return `${h}×${a} · +3 GOLS DE ${h}: ${sn}`;
    case 'O3A':  return `${h}×${a} · +3 GOLS DE ${a}: ${sn}`;
    case '1X2':
    default: {
      const who = leg.pick === 'H' ? h : leg.pick === 'A' ? a : 'EMPATE';
      return `${h}×${a} · ${who}`;
    }
  }
}

// Resumo curto de UMA perna pra MESA DOS CARTOLAS (quem vai copiar vê o que é).
// MK traz home/away/market/pick na própria perna; FIFA precisa do jogo (gamesById).
function legSummary(leg, teamPlayers, gamesById) {
  if (!leg) return '—';
  const isMk = typeof leg.fixtureId === 'string' && leg.fixtureId.indexOf('mk:') === 0;
  if (isMk) {
    return leg.home + ' × ' + leg.away + ' · ' + (MK_MARKET_TITLE[leg.market] || leg.market) + ' ' + (mkPickLabel(leg.market, leg.pick) || '');
  }
  const fx = gamesById && gamesById[leg.fixtureId];
  return fx ? legLabel({ ...leg, _fix: fx }, teamPlayers) : '—';
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
  const sched = generateSchedule(NICKS_FOR_FIFA);
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

// ── M8: GERADORES DE CAMPEONATO (liga round-robin + chaveamento mata-mata) ───
// Liga round-robin (Berger). doubleRound => ida e volta (espelha trocando mando).
function generateLeague(participants, opts) {
  const ps = (participants || []).filter(Boolean);
  if (ps.length < 2) return [];
  const ida = generateSchedule(ps);
  if (!opts || !opts.doubleRound) return ida;
  const volta = ida.map(games => games.map(g => ({ home: g.away, away: g.home })));
  return [...ida, ...volta];
}
// Liga com placeholders de data/placar (mesma forma de cs.rounds), começando hoje.
function champLeagueRounds(participants, opts) {
  const sched = generateLeague(participants, opts);
  const startDate = new Date();
  return sched.map((games, ri) => {
    const base = new Date(startDate); base.setDate(base.getDate() + ri * 7);
    return games.map((g, gi) => {
      const d = new Date(base); d.setDate(d.getDate() + gi);
      const day = DAYS[d.getDay() === 0 ? 6 : d.getDay() - 1];
      const date = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
      return { home: g.home, away: g.away, day, date, time: gi % 2 === 0 ? '21:00' : '21:30', gh: '', ga: '' };
    });
  });
}
function koRoundName(nMatches) {
  return ({ 1: 'FINAL', 2: 'SEMIFINAL', 4: 'QUARTAS', 8: 'OITAVAS', 16: '16-AVOS' })[nMatches] || (nMatches * 2 + ' JOGADORES');
}
// Ordem de seeds num bracket de `size` (potência de 2): 1 enfrenta o pior, favoritos
// só se cruzam no fim. Recursivo: [1,2] -> [1,4,2,3] -> [1,8,4,5,2,7,3,6]...
function seedBracketOrder(size) {
  let arr = [1, 2];
  while (arr.length < size) {
    const m = arr.length * 2 + 1;
    const next = [];
    arr.forEach(s => { next.push(s); next.push(m - s); });
    arr = next;
  }
  return arr;
}
// Chaveamento por seed (1vN, 2v(N-1)...). N não-potência-de-2 => byes pros MELHORES
// seeds (benefício de classificar bem). koLegs = ida(1) ou ida-e-volta(2).
function generateBracket(seedOrder, opts) {
  const seeds = (seedOrder || []).filter(Boolean);
  const n = seeds.length;
  if (n < 2) return null;
  const koLegs = (opts && opts.koLegs) || 1;
  let size = 1; while (size < n) size *= 2;
  const order = seedBracketOrder(size);
  const slot = (s) => (s <= n ? { kind: 'seed', ref: s } : { kind: 'bye' });
  const emptyLegs = () => Array.from({ length: koLegs }, () => ({ gh: '', ga: '' }));
  const first = [];
  for (let i = 0; i < size; i += 2) {
    first.push({ id: 'ko-r0-m' + (i / 2), home: slot(order[i]), away: slot(order[i + 1]), legs: emptyLegs(), pen: null, locked: false, winner: null });
  }
  const rounds = [{ name: koRoundName(first.length), matches: first }];
  let prevCount = first.length, ri = 1;
  while (prevCount > 1) {
    const cnt = prevCount / 2;
    const matches = [];
    for (let i = 0; i < cnt; i++) {
      matches.push({ id: 'ko-r' + ri + '-m' + i, home: { kind: 'winner', ref: 'ko-r' + (ri - 1) + '-m' + (i * 2) }, away: { kind: 'winner', ref: 'ko-r' + (ri - 1) + '-m' + (i * 2 + 1) }, legs: emptyLegs(), pen: null, locked: false, winner: null });
    }
    rounds.push({ name: koRoundName(cnt), matches });
    prevCount = cnt; ri++;
  }
  let thirdPlace = null;
  if (opts && opts.thirdPlace && rounds.length >= 2) {
    const semi = rounds[rounds.length - 2].matches;
    if (semi.length === 2) thirdPlace = { id: 'ko-3p', home: { kind: 'loser', ref: semi[0].id }, away: { kind: 'loser', ref: semi[1].id }, legs: [{ gh: '', ga: '' }], pen: null, locked: false, winner: null };
  }
  return { seedOrder: seeds, rounds, thirdPlace };
}
// Top N de uma classificação (computeStandings .id / computeMkStandings .nick).
function seedFromStandings(standings, n) {
  return (standings || []).slice(0, n).map(s => s.id || s.nick).filter(Boolean);
}
// Resolve o chaveamento: pra cada match calcula home/away (nick), placar agregado,
// vencedor/perdedor e se precisa de pênaltis. Processa rodada a rodada (winner de
// uma alimenta a próxima). Bye = o outro lado avança sem jogar.
function resolveBracket(bracket) {
  const info = {};
  if (!bracket || !Array.isArray(bracket.rounds)) return info;
  const seedOrder = bracket.seedOrder || [];
  const resolveSlot = (slot) => {
    if (!slot) return null;
    if (slot.kind === 'bye') return null;
    if (slot.kind === 'seed') return seedOrder[slot.ref - 1] || null;
    if (slot.kind === 'winner') return info[slot.ref] ? info[slot.ref].winner : null;
    if (slot.kind === 'loser') return info[slot.ref] ? info[slot.ref].loser : null;
    return null;
  };
  const compute = (m) => {
    const homeBye = !!(m.home && m.home.kind === 'bye');
    const awayBye = !!(m.away && m.away.kind === 'bye');
    const home = resolveSlot(m.home), away = resolveSlot(m.away);
    let winner = null, loser = null, aggH = 0, aggA = 0, played = false, needsPen = false;
    if (homeBye && !awayBye && away) { winner = away; played = true; }
    else if (awayBye && !homeBye && home) { winner = home; played = true; }
    else if (home && away) {
      let allFilled = (m.legs || []).length > 0;
      (m.legs || []).forEach(l => {
        const gh = parseInt(l.gh, 10), ga = parseInt(l.ga, 10);
        if (Number.isNaN(gh) || Number.isNaN(ga)) allFilled = false; else { aggH += gh; aggA += ga; }
      });
      if (allFilled) {
        if (aggH > aggA) { winner = home; loser = away; played = true; }
        else if (aggA > aggH) { winner = away; loser = home; played = true; }
        else {
          const ph = m.pen ? parseInt(m.pen.h, 10) : NaN, pa = m.pen ? parseInt(m.pen.a, 10) : NaN;
          if (!Number.isNaN(ph) && !Number.isNaN(pa) && ph !== pa) { winner = ph > pa ? home : away; loser = ph > pa ? away : home; played = true; }
          else needsPen = true;
        }
      }
    }
    info[m.id] = { home, away, winner, loser, aggH, aggA, played, needsPen, homeBye, awayBye };
  };
  bracket.rounds.forEach(rd => (rd.matches || []).forEach(compute));
  if (bracket.thirdPlace) compute(bracket.thirdPlace);
  return info;
}
function bracketChampion(bracket, info) {
  const rounds = bracket && bracket.rounds;
  if (!rounds || !rounds.length) return null;
  const finalM = rounds[rounds.length - 1].matches[0];
  return finalM && info[finalM.id] ? info[finalM.id].winner : null;
}

function computeStandings(rounds) {
  // Dinâmico: cria o registro a partir das CHAVES dos jogos (home/away). Assim
  // funciona tanto pra chaves teamId (antes da migração) quanto nick (depois).
  // `id` é a chave; name/short/color são placeholders — a exibição usa fifaUserOf.
  const rec = {};
  const ensure = (id) => {
    if (!rec[id]) rec[id] = { id, name: String(id), short: String(id).slice(0, 3).toUpperCase(), color: '#1c1612', j:0, v:0, e:0, d:0, gp:0, gc:0, p:0 };
    return rec[id];
  };
  (rounds || []).forEach(round => {
    (round || []).forEach(m => {
      if (!m || m.home == null || m.away == null) return;
      const H = ensure(m.home), A = ensure(m.away); // garante presença mesmo sem placar
      const gh = parseInt(m.gh, 10);
      const ga = parseInt(m.ga, 10);
      if (Number.isNaN(gh) || Number.isNaN(ga)) return;
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
    return String(a.name).localeCompare(String(b.name));
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
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function poissonPmf(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}
const DEFAULT_LAMBDA = 1.3; // gols esperados por time quando não há histórico

// Base de estatísticas das odds: TODOS os jogos já jogados contam (não só
// rodadas 100% fechadas) — mesma regra do MK. Assim as odds e a probabilidade
// do confronto acompanham a classificação em tempo real, jogo a jogo, em vez
// de congelar até a rodada fechar.
function computeTeamMetrics(rounds) {
  const standings = computeStandings(rounds);
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

// Confronto direto (h2h) entre os dois times em TODOS os jogos já jogados,
// qualquer mando. Amostra pequena pesa pouco (mesmo shrinkage do MK):
// (vitóriasH - vitóriasA)/jogos × jogos/(jogos+2). Retorna -1..+1
// (positivo = vantagem histórica do mandante).
function fifaH2hEdge(homeId, awayId, rounds) {
  let games = 0, hWins = 0, aWins = 0;
  (rounds || []).forEach(round => (round || []).forEach(m => {
    if (!m || !isGamePlayed(m)) return;
    const direto  = m.home === homeId && m.away === awayId;
    const inverso = m.home === awayId && m.away === homeId;
    if (!direto && !inverso) return;
    const gh = parseInt(m.gh, 10), ga = parseInt(m.ga, 10);
    games++;
    if (gh === ga) return;
    const winner = gh > ga ? m.home : m.away;
    if (winner === homeId) hWins++; else aWins++;
  }));
  if (!games) return 0;
  return ((hWins - aWins) / games) * (games / (games + 2));
}
// Peso do confronto direto no logit do 1X2: comparável ao termo de força
// (que tipicamente fica em ±0.3..0.6), sem dominar sozinho.
const FIFA_H2H_EDGE_K = 1.0;

function computeGameOdds(homeId, awayId, metrics, rounds) {
  const H = metrics[homeId] || { strength: 0, lambdaAttack: DEFAULT_LAMBDA, lambdaDefense: DEFAULT_LAMBDA };
  const A = metrics[awayId] || { strength: 0, lambdaAttack: DEFAULT_LAMBDA, lambdaDefense: DEFAULT_LAMBDA };

  // 1X2: reserva pra empate + logística no resto (força + confronto direto)
  const diff = H.strength - A.strength;
  const h2hEdge = fifaH2hEdge(homeId, awayId, rounds);
  const pDraw = 0.30 * Math.exp(-Math.abs(diff) / 40);
  const rest  = 1 - pDraw;
  const sigH  = sigmoid(diff * 0.0256 + h2hEdge * FIFA_H2H_EDGE_K);
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
    // probabilidades cruas do 1X2 (barra do card) — NÃO é mercado apostável.
    probs:  { H: pH, D: pDraw, A: pA },
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
      <text x="50" y="76" textAnchor="middle" fontFamily="Anton, Impact" fontSize="38" fill="#f4ead7">
        {t.short.charAt(0)}
      </text>
    </svg>
  );
}

// ─── ESCUDOS DOS CLUBES (FIFA S1) ───────────────────────────────────────────
// Cada jogador da FIFA S1 "é" um clube real. PNGs em apostas/clubs/<nick>.png
// (recorte transparente, ~160px). Nick sem clube cai no escudo genérico TeamMini.
// Clube real que cada jogador usa na FIFA (chave = @nick do jogador). PNGs em
// apostas/clubs/<nick>.png. 'juca'/'jucamelero' são o mesmo jogador (Barcelona).
const CLUB_NAME = {
  jucamelero: 'Barcelona', juca: 'Barcelona', potato: 'Arsenal', celin: 'Liverpool', magreza: 'Real Madrid',
  caco: 'Newcastle', vitinho: 'Bayern', bane: 'PSG', mohamed: 'Man City',
};
// ClubCrest = escudo do CLUBE que o jogador usa na FIFA (pedido do Lucas: nas
// partidas da FIFA o ícone é o time, ex.: bane=PSG, caco=Newcastle). Resolve a
// chave (teamId antigo OU nick) pro @nick via fifaUserOf, acha o clube e mostra
// clubs/<nick>.png. Sem clube cadastrado, cai no avatar do usuário.
function ClubCrest({ nick, teamPlayers, size = 30, className = '' }) {
  const u = fifaUserOf(nick, teamPlayers);
  const club = CLUB_NAME[u];
  if (!club) return <Avatar nick={u} teamPlayers={teamPlayers} size={size} className={className} noBadge />;
  return (
    <img
      src={'clubs/' + u + '.png'}
      alt={club}
      title={club}
      width={size}
      height={size}
      className={'club-crest ' + className}
      style={{ display: 'block', objectFit: 'contain', flexShrink: 0 }}
      loading="lazy"
    />
  );
}

// ─── ÍCONES DOS CAMPEONATOS ─────────────────────────────────────────────────
// Logo real de cada campeonato (imagens em apostas/champs/<id>.(png|svg)).
// Sem imagem (ex.: copa) cai no glifo lineart do tema (tabloidTheme().icon).
const CHAMP_ICON = {
  fifa: 'champs/fifa.png', fifa2: 'champs/fifa.png', mk: 'champs/mk.png',
  rl: 'champs/rl.png', lol: 'champs/lol.svg', cs: 'champs/cs.png',
  gwyf: 'champs/gwyf.png', valorant: 'champs/valorant.png', tft: 'champs/tft.png',
  pokemon: 'champs/pokemon.png', magic: 'champs/magic.png', crab: 'champs/crab.png',
};
function ChampIcon({ champId, size = 22, className = '' }) {
  const src = CHAMP_ICON[champId];
  if (src) {
    return (
      <img src={src} alt="" width={size} height={size}
        className={'champ-img-ic ' + className}
        style={{ objectFit: 'contain', display: 'block', flexShrink: 0 }}
        loading="lazy" />
    );
  }
  const th = tabloidTheme(champId);
  return <Icon name={th.icon} size={Math.round(size * 0.62)} className={className} />;
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

  // Distintivos (badges) do avatar REMOVIDOS da UI (pedido do Lucas). O item de
  // badge continua no inventário, só não é mais renderizado sobre o avatar.
  const renderBadge = () => null;

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

  // AVATAR CUSTOM (upload do jogador): tem prioridade sobre o escudo do time e
  // funciona até sem time. Mantém letra de fallback, badge e moldura.
  const customAv = avatarFor(nick);
  if (customAv) {
    const onErr = (e) => { e.target.style.display = 'none'; e.target.parentNode.classList.add('avatar-fallback'); };
    const lc = (nick || '?').charAt(0).toUpperCase();
    const lbg = nickColor(nick || tid);
    if (fullBody) {
      return (
        <div className={'avatar avatar-full ' + className + frameClass} style={{ width: size, height: size }}>
          <img className="avatar-custom-img" src={customAv} alt={nick || ''} onError={onErr} />
          <span className="avatar-fallback-letter" style={{ background: lbg }}>{lc}</span>
          {renderBadge()}
        </div>
      );
    }
    const iconElC = (
      <div className={'avatar avatar-icon ' + (frameItem ? 'avatar-icon-inner' : className)} style={frameItem ? undefined : { width: size, height: size }}>
        <img className="avatar-custom-img" src={customAv} alt={nick || ''} onError={onErr} />
        <span className="avatar-fallback-letter" style={{ background: lbg, fontSize: size * 0.5 }}>{lc}</span>
        {!frameItem && renderBadge()}
      </div>
    );
    return wrapWithFrameDeco(iconElC);
  }

  if (tid) {
    // Fallback (sem foto custom): cor/letra derivam do NICK, não do TEAM — assim
    // 'jucamelero' não cai na cor/letra do Bane. O PNG avatars/{tid}.png segue
    // valendo pros slots cujo teamId == nick; quem não tiver cai na letra.
    const dispNick = nick || tid;
    const fbBg = nickColor(dispNick);
    const fbLetter = String(dispNick).charAt(0).toUpperCase();
    const src = `avatars/${tid}.png`;
    if (fullBody) {
      return (
        <div className={'avatar avatar-full ' + className + frameClass} style={{ width: size, height: size }}>
          <img src={src} alt={dispNick} onError={(e) => { e.target.style.display = 'none'; e.target.parentNode.classList.add('avatar-fallback'); }} />
          <span className="avatar-fallback-letter" style={{ background: fbBg }}>{fbLetter}</span>
          {renderBadge()}
        </div>
      );
    }
    // Ícone: crop top (mostra só a cabeça). Com moldura decorativa, o avatar
    // circular vai DENTRO de .avatar-framed (sem frameClass de borda) e o SVG
    // da moldura desenha o anel + ornamentos por cima.
    const iconEl = (
      <div className={'avatar avatar-icon ' + (frameItem ? 'avatar-icon-inner' : className)} style={frameItem ? undefined : { width: size, height: size }}>
        <img src={src} alt={dispNick} onError={(e) => { e.target.style.display = 'none'; e.target.parentNode.classList.add('avatar-fallback'); }} />
        <span className="avatar-fallback-letter" style={{ background: fbBg, fontSize: size * 0.5 }}>{fbLetter}</span>
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
function SharedSlipModal({ slip, gamesById, teamPlayers, onUse, onClose }) {
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
                {l._fix ? legLabel(l, teamPlayers) : <em style={{ color: 'rgba(28,22,18,0.55)' }}>jogo não está mais disponível</em>}
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

// Banner fixo "VERSÃO NOVA" — o index.html dispara `primitivao:sw-update`
// quando o service worker instala um build novo com esta página ainda aberta.
// Diferente do toast (some em 4s), o banner fica até o usuário recarregar.
function UpdateBanner() {
  const [ready, setReady] = useState(() => typeof window !== 'undefined' && !!window.__swUpdateReady);
  useEffect(() => {
    const on = () => setReady(true);
    window.addEventListener('primitivao:sw-update', on);
    return () => window.removeEventListener('primitivao:sw-update', on);
  }, []);
  if (!ready) return null;
  return (
    <div className="update-banner" role="alert">
      <Icon name="rocket" size={16} />
      <span className="update-banner-txt">VERSÃO NOVA DISPONÍVEL</span>
      <button type="button" onClick={() => window.location.reload()}>RECARREGAR</button>
    </div>
  );
}

// Modal de confirmação custom — substitui window.confirm (que é feio e
// genérico). Promise-based, mesmo padrão CustomEvent do showToast:
//   const ok = await confirmModal({ title, body, confirmLabel, danger });
// `danger: true` pinta o botão de vermelho (operações destrutivas).
// Com `infoOnly: true` vira um aviso com um botão só (ex: mostrar senha temp).
function confirmModal(opts) {
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent('primitivao:confirm', { detail: { ...(opts || {}), resolve } }));
  });
}
function ConfirmHost() {
  const [req, setReq] = useState(null);
  useEffect(() => {
    const on = (e) => setReq(prev => {
      // Se já tem um aberto, resolve o antigo como "cancelado" (não empilha).
      if (prev) prev.resolve(false);
      return e.detail;
    });
    window.addEventListener('primitivao:confirm', on);
    return () => window.removeEventListener('primitivao:confirm', on);
  }, []);
  useEffect(() => {
    if (!req) return;
    const onEsc = (ev) => { if (ev.key === 'Escape') { req.resolve(false); setReq(null); } };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [req]);
  if (!req) return null;
  const done = (ok) => { req.resolve(ok); setReq(null); };
  return (
    <div className="modal-bg confirm-bg" onClick={() => done(false)}>
      <div
        className={'modal confirm-modal' + (req.danger ? ' confirm-danger' : '')}
        onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={req.title || 'Confirmar'}
      >
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {req.danger && <Icon name="warning" size={18} />}
          {req.title || 'CONFIRMAR?'}
        </h3>
        {req.body && <div className="confirm-body">{req.body}</div>}
        <div className="modal-btns">
          {!req.infoOnly && <button className="btn-secondary" onClick={() => done(false)}>VOLTAR</button>}
          <button className={req.danger ? 'btn-danger' : 'btn-primary'} onClick={() => done(true)} autoFocus>
            {req.confirmLabel || (req.infoOnly ? 'ENTENDI' : 'CONFIRMAR')}
          </button>
        </div>
      </div>
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

// Views navegáveis via hash (#/apostas, #/ranking...). Tem que casar com os
// ids de getTabItems + 'admin'. Hash desconhecido cai em 'apostas'.
const VALID_VIEWS = ['apostas', 'campeonatos', 'copa', 'estatisticas', 'hall', 'inicio', 'loja', 'perfil', 'tickets', 'ranking', 'admin', 'mod'];

// Telas/recursos escondidos POR ENQUANTO. O código continua TODO no lugar — só
// não aparecem na navegação/UI. Pra reativar: tira do set / vira HIDE_CC = false.
const HIDDEN_VIEWS = new Set(['hall', 'inicio', 'loja']); // VITRINE · NEWS · MERCADINHO
const HIDE_CC = true; // Campeão Coins (CC)

function viewFromHash() {
  if (typeof window === 'undefined') return 'apostas';
  const h = (window.location.hash || '').replace(/^#\/?/, '');
  return VALID_VIEWS.indexOf(h) >= 0 ? h : 'apostas';
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
  // M8: campeonatos lançados pelo admin (doc primitivao/championships, separado).
  const [champs, setChamps] = useState({});
  const champsLoadedRef = useRef(false);
  // Avatares custom: contador que força re-render quando AVATAR_MAP (módulo) muda.
  const [avatarsRev, setAvatarsRev] = useState(0);
  const avLoadedRef = useRef(false);

  const [session, _setSession] = useState(loadSession);
  const setSession = (s) => { saveSession(s); _setSession(s); };

  const [slip, setSlip]     = useState([]); // [{fixtureId='rXgY', market, pick, odds}]
  const [synced, setSynced] = useState(false);
  const [championship, setChampionship] = useState('fifa');
  // MEU JOGO (escalar): abre como JANELA (modal) por cima de JOGOS ao clicar VER MEUS JOGOS.
  const [meuJogoOpen, setMeuJogoOpen] = useState(false);
  // Perfil de outro jogador num modal (clicou no nome/foto nas apostas).
  const [profileNick, setProfileNick] = useState(null);
  // Perfil SÓ DE APOSTAS (clicou no ranking de apostas).
  const [betProfileNick, setBetProfileNick] = useState(null);
  // Barra lateral de campeonatos (em CAMPEONATOS): oculta por padrão, expande na seta.
  const [champRailOpen, setChampRailOpen] = useState(() => { try { return localStorage.getItem('pv-champrail') === '1'; } catch (e) { return false; } });
  const toggleChampRail = () => setChampRailOpen(o => { const n = !o; try { localStorage.setItem('pv-champrail', n ? '1' : '0'); } catch (e) {} return n; });
  // Pick MANUAL de campeonato (clicar num "em breve"/encerrado dentro da aba
  // CAMPEONATOS) trava a autosseleção do ATIVO — senão, quando o cs carrega, a
  // gente jogaria o usuário de volta pro MK. lastChampViewRef detecta a ENTRADA
  // na aba pra esquecer o pick manual da visita anterior. Ver o efeito abaixo.
  const manualChampRef = useRef(false);
  const lastChampViewRef = useRef(null);
  const pickChampionship = (id) => { manualChampRef.current = true; setChampionship(id); };
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
  // MATA-MATA: { published, publishedAt, seeds, scores, lineups } (mk.ko no doc).
  const [mkKo, setMkKo] = useState(null);
  // DIA OFICIAL: { active, since, by } no JSON do doc. Quando ativo, payout +25%.
  const [officialDay, setOfficialDayState] = useState(null);

  // Muta o campo `mk` no doc de apostas, preservando o resto. Optimistic: o caller
  // já atualizou o estado local; aqui só persiste. Mutator que devolve o PRÓPRIO
  // `base` (ou undefined) = no-op — não reescreve o doc à toa (guardas dos
  // reducers do mata-mata fazem `return mk`). Falha de transação (ex.: offline)
  // avisa com toast — o snapshot seguinte re-sincroniza a tela com o servidor.
  const persistMk = (mutator) => commitBetDocUpdate(remote => {
    const cur = (remote.mk && typeof remote.mk === 'object') ? remote.mk : {};
    const base = { draw: null, scores: {}, lineups: {}, locked: false, ...cur };
    const next = mutator(base);
    if (next === undefined || next === base) return null; // no-op
    return { ...remote, mk: next };
  }).catch(e => {
    console.warn('persistMk failed', e);
    showToast('Não salvou — sem conexão? A tela pode voltar ao estado anterior.', 'error');
  });

  // M8: muta um campeonato no doc championships (transação própria, doc separado).
  // mutator(champAtual|null, todosChamps) -> novo champ | null(apaga) | undefined(no-op).
  const persistChamp = async (champId, mutator) => {
    try {
      await window.db.runTransaction(async (tx) => {
        const ref = CHAMP_DOC();
        const snap = await tx.get(ref);
        let data = { champs: {} };
        if (snap.exists && typeof snap.data().json === 'string') {
          try { data = JSON.parse(snap.data().json) || { champs: {} }; } catch (_) {}
        }
        const champsMap = (data && typeof data.champs === 'object') ? data.champs : {};
        const next = mutator(champsMap[champId] || null, champsMap);
        if (next === undefined) return;
        const newChamps = { ...champsMap };
        if (next === null) delete newChamps[champId]; else newChamps[champId] = next;
        tx.set(ref, { json: JSON.stringify({ ...data, champs: newChamps }), updatedAt: Date.now() }, { merge: true });
      });
      return { ok: true };
    } catch (e) { console.warn('persistChamp failed', e); return { err: 'falha' }; }
  };
  // M8b: cria um campeonato (gera liga e/ou bracket) e publica no doc championships.
  const createChampionship = async (spec) => {
    const id = 'champ-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5);
    const tag = String(spec.tag || spec.name.split(' ')[0] || 'CAMP').toUpperCase().slice(0, 12);
    const cfg = spec.config || {};
    const champ = {
      id, game: spec.game, name: spec.name, season: spec.season, tag,
      format: spec.format, status: 'running',
      participants: spec.participants, config: cfg,
      league: (spec.format === 'LEAGUE' || spec.format === 'LEAGUE_KO')
        ? { rounds: champLeagueRounds(spec.participants, { doubleRound: cfg.doubleRound }) } : null,
      bracket: (spec.format === 'CUP')
        ? generateBracket(spec.participants, { koLegs: cfg.koLegs, thirdPlace: cfg.thirdPlace }) : null,
      createdAt: Date.now(), by: session.nick,
    };
    const r = await persistChamp(id, () => champ);
    if (r && r.err) showToast('Erro ao criar campeonato.', 'error');
    else showToast('Campeonato "' + spec.name + '" criado e publicado!', 'success');
    return r;
  };
  const setChampScore = (champId, ri, gi, patch) => persistChamp(champId, (c) => {
    if (!c || !c.league || !Array.isArray(c.league.rounds)) return undefined;
    const rounds = c.league.rounds.map((r, i) => i !== ri ? r : r.map((m, j) => j === gi ? { ...m, ...patch } : m));
    return { ...c, league: { ...c.league, rounds } };
  });
  // M8c: lança placar de um jogo do mata-mata (legs/pênaltis) por id do match.
  const setChampMatch = (champId, matchId, patch) => persistChamp(champId, (c) => {
    if (!c || !c.bracket) return undefined;
    const upd = (m) => m.id === matchId ? { ...m, ...patch } : m;
    const rounds = (c.bracket.rounds || []).map(rd => ({ ...rd, matches: (rd.matches || []).map(upd) }));
    const thirdPlace = c.bracket.thirdPlace ? upd(c.bracket.thirdPlace) : null;
    return { ...c, bracket: { ...c.bracket, rounds, thirdPlace } };
  });
  // M8c: gera o mata-mata do CLÁSSICO+MATA-MATA a partir da classificação da liga.
  const generateChampKnockout = async (champId) => persistChamp(champId, (c) => {
    if (!c || c.format !== 'LEAGUE_KO' || !c.league || c.bracket) return undefined;
    const standings = computeStandings(c.league.rounds);
    const cfg = c.config || {};
    const n = Math.min((cfg.koQualifiers || 8), standings.length);
    const seeds = seedFromStandings(standings, n);
    const bracket = generateBracket(seeds, { koLegs: cfg.koLegs, thirdPlace: cfg.thirdPlace });
    if (!bracket) return undefined;
    return { ...c, bracket };
  });
  const deleteChampionship = async (champId) => {
    if (!(await confirmModal({ title: 'APAGAR CAMPEONATO?', body: 'Remove o campeonato e seus jogos. Não dá pra desfazer.', confirmLabel: 'APAGAR', danger: true }))) return;
    const r = await persistChamp(champId, () => null);
    if (!r || !r.err) showToast('Campeonato apagado.', 'success');
  };

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

  // ── MATA-MATA DO MK ────────────────────────────────────────────────────────
  // ADMIN: publica o mata-mata OFICIAL — congela os seeds (top 8 elegíveis da
  // classificação final). Tudo DENTRO da transação, a partir do estado remoto:
  // jogadores saem do PRÓPRIO chaveamento (mk.draw), placares com overlay de
  // W.O. — nada do estado local da aba. Só com a liga 100% fechada.
  const publishMkKo = async () => {
    if (!isAdmin) return;
    const gk = (r, gi) => r.phase + '-' + r.n + '-' + gi;
    let published = false;
    await persistMk(mk => {
      if (mk.ko && mk.ko.published) return mk; // já publicado — não sobrescreve
      const draw = mk.draw || [];
      const scores = mkApplyWo(draw, mk.scores || {});
      const allDone = draw.length > 0 && draw.every(r => (r.games || []).every((g, gi) =>
        mkGameVoid(g) || !!mkMatchOutcome(scores[gk(r, gi)] || {})));
      if (!allDone) return mk; // liga ainda aberta — no-op
      // jogadores = quem está no chaveamento (fonte transacional; retirados fora)
      const players = Array.from(new Set(draw.flatMap(r => (r.games || []).flatMap(g => [g.home, g.away])))).filter(n => n && !mkIsWithdrawn(n));
      const matches = draw.flatMap(r => (r.games || []).map((g, gi) => ({ home: g.home, away: g.away, sc: scores[gk(r, gi)] || {} }))).filter(m => !mkGameVoid(m));
      const seeds = mkKoSeedsFrom(players, matches);
      if (seeds.length < 8) return mk; // sem 8 elegíveis não tem chave completa
      published = true;
      return { ...mk, ko: { published: true, publishedAt: Date.now(), seeds, scores: {}, lineups: {} } };
    });
    showToast(published ? 'Mata-mata publicado! Seeds congelados — escalações blind abertas.' : 'Não publicou (liga aberta ou mata-mata já no ar).', published ? 'success' : 'error');
  };
  // ADMIN: despublica (volta pra prévia). Confirmação com aviso — placares e
  // escalações do mata-mata são APAGADOS.
  const resetMkKo = async () => {
    if (!isAdmin) return;
    if (!(await confirmModal({
      title: 'DESPUBLICAR O MATA-MATA?',
      body: 'Isso APAGA os placares e as escalações do mata-mata e volta pra prévia. Apostas do mata-mata ainda PENDENTES são devolvidas. A liga não é tocada.',
      confirmLabel: 'DESPUBLICAR', danger: true,
    }))) return;
    setMkKo(null);
    // Sem KO, as apostas 'mkko' pendentes nunca liquidariam -> devolve o stake e
    // remove; as já liquidadas (won/lost) ficam no histórico. Tudo numa transação.
    try {
      await commitBetDocUpdate(remote => {
        const mk = (remote.mk && typeof remote.mk === 'object') ? remote.mk : {};
        const users = { ...(remote.users || {}) };
        const kept = [];
        (remote.bets || []).forEach(b => {
          if (b && b.champId === 'mkko' && b.status === 'pending') {
            const u = users[b.user];
            if (u) users[b.user] = { ...u, pc: Math.max(0, (u.pc || 0) + (b.amount || 0)) };
          } else kept.push(b);
        });
        return { ...remote, users, bets: kept, mk: { ...mk, ko: null } };
      });
    } catch (e) { console.warn('resetMkKo failed', e); showToast('Falha ao despublicar.', 'error'); }
  };
  // MOD: lança/corrige o vencedor de um jogo do MD5 (side 'H'|'A'|null desfaz).
  // DESFAZER também apaga os jogos seguintes do confronto (buraco no meio do
  // MD5 não é estado válido — ressuscitaria depois e fecharia 3×0 sem querer).
  // Se o RESULTADO do confronto muda (vencedor troca ou reabre), limpa placares
  // e escalações dos jogos downstream — senão ficam órfãos apontando pro
  // classificado errado (e travando a escalação blind do novo classificado).
  const setMkKoGame = (matchId, gameN, side) => {
    const val = side === 'H' || side === 'A' ? side : null;
    const apply = (ko) => {
      const cur = (ko.scores || {})[matchId] || {};
      const before = mkKoOutcome(cur);
      const nextSc = { ...cur };
      if (val) nextSc['g' + gameN] = val;
      else for (let i = gameN; i <= 5; i++) delete nextSc['g' + i]; // desfez: some do gN em diante
      const after = mkKoOutcome(nextSc);
      const scores = { ...(ko.scores || {}), [matchId]: nextSc };
      let lineups = ko.lineups || {};
      const sig = (o) => (o.done ? o.winner : 'open');
      if (sig(before) !== sig(after)) {
        lineups = { ...lineups };
        (MK_KO_DOWNSTREAM[matchId] || []).forEach(id => { delete scores[id]; delete lineups[id]; });
      }
      return { ...ko, scores, lineups };
    };
    setMkKo(prev => (prev && prev.published) ? apply(prev) : prev);
    return persistMk(mk => (!mk.ko || !mk.ko.published) ? mk : { ...mk, ko: apply(mk.ko) });
  };
  // MOD: registra o 1º GOLPE (fh) ou 1º ROUND (fr) de um confronto ('H'|'A'|null
  // pra limpar). Não mexe no chaveamento (não cascateia).
  const setMkKoField = (matchId, field, side) => {
    if (field !== 'fh' && field !== 'fr') return;
    const val = side === 'H' || side === 'A' ? side : undefined;
    const apply = (ko) => {
      const cur = (ko.scores || {})[matchId] || {};
      const nextSc = { ...cur };
      if (val) nextSc[field] = val; else delete nextSc[field];
      return { ...ko, scores: { ...(ko.scores || {}), [matchId]: nextSc } };
    };
    setMkKo(prev => (prev && prev.published) ? apply(prev) : prev);
    return persistMk(mk => (!mk.ko || !mk.ko.published) ? mk : { ...mk, ko: apply(mk.ko) });
  };
  // JOGADOR: declara a escalação blind (5 picks em ordem) do PRÓPRIO confronto.
  // Valida no reducer: participante do confronto, lista válida, confronto ainda
  // sem NENHUM jogo lançado no doc (mkKoMatchStarted — robusto a buraco).
  const setMkKoLineup = async (matchId, list) => {
    const nick = session && session.nick;
    if (!nick) return { err: 'precisa logar' };
    if (mkKoLineupProblems(list).length) return { err: mkKoLineupProblems(list)[0] };
    const enc = mkKoEncodeLineup(list);
    if (!enc) return { err: 'Falha ao salvar.' };
    let saved = false;
    await persistMk(mk => {
      saved = false; // a transação pode rodar mais de uma vez (retry) — zera
      if (!mk.ko || !mk.ko.published) return mk;
      const br = mkKoBracket(mk.ko.seeds, mk.ko.scores);
      const match = br[matchId];
      if (!match || (match.home !== nick && match.away !== nick)) return mk; // não é seu confronto
      if (mkKoMatchStarted((mk.ko.scores || {})[matchId])) return mk; // já começou: travado
      saved = true;
      return { ...mk, ko: { ...mk.ko, lineups: { ...(mk.ko.lineups || {}), [matchId]: { ...((mk.ko.lineups || {})[matchId] || {}), [nick]: enc } } } };
    });
    if (saved) setMkKo(prev => prev ? { ...prev, lineups: { ...(prev.lineups || {}), [matchId]: { ...((prev.lineups || {})[matchId] || {}), [nick]: enc } } } : prev);
    return saved ? { ok: true } : { err: 'Não deu pra salvar (confronto travado ou não é seu).' };
  };
  // VIEW principal — controla qual "página" mostrar:
  //   apostas | campeonatos | copa | hall | inicio(NEWS) | loja | perfil | tickets | ranking | admin
  // 'discord' não é view — abre link externo direto.
  // APOSTAS (jogos pra apostar) é a tela inicial. CAMPEONATOS = classificação.
  // Ambas são escopadas pelo `championship` selecionado.
  //
  // HASH ROUTING: a view vive na URL (#/apostas, #/ranking...) — F5 mantém a
  // tela, link compartilhado abre direto na view e o botão VOLTAR do browser
  // navega entre views. Hash inválido cai em 'apostas'; 'admin' tem guard
  // próprio (useEffect mais abaixo derruba não-mod pra 'apostas').
  const [view, _setViewRaw] = useState(viewFromHash);
  // Sub-aba do HALL elevada pro App: deixa o link "VER RANKING" (no card de
  // conquistas) cair direto no ranking de caçadores.
  const [hallTab, setHallTab] = useState('fama');
  const seeRanking = () => { setHallTab('cacadores'); setView('hall'); };
  const setView = (id) => {
    _setViewRaw(id);
    const want = '#/' + id;
    if (window.location.hash !== want) {
      // pushState não dispara hashchange — evita set duplicado.
      try { window.history.pushState(null, '', want); }
      catch (e) { window.location.hash = want; }
    }
  };
  useEffect(() => {
    const onNav = () => _setViewRaw(viewFromHash());
    window.addEventListener('popstate', onNav);
    window.addEventListener('hashchange', onNav);
    return () => {
      window.removeEventListener('popstate', onNav);
      window.removeEventListener('hashchange', onNav);
    };
  }, []);
  // Trocar de view sempre volta pro topo — no mobile os atalhos (VER TODOS,
  // ESCALAR/EDITAR) ficam no fundo da página e sem isso o usuário aterrissava
  // no meio da view nova, parecendo que nada aconteceu.
  useLayoutEffect(() => { window.scrollTo(0, 0); }, [view]);
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

  // SEMPRE entrar em APOSTAS/CAMPEONATOS mostrando o campeonato ATIVO DE VERDADE
  // (o MK) — não o FIFA, que já encerrou. champStatusFor depende do `cs`, que
  // carrega ASSÍNCRONO: na 1ª passada o cs pode estar vazio e o FIFA ainda
  // parecer "ativo", caindo na seleção errada. Por isso re-rodamos quando o cs
  // muda (deps [view, cs]) — aí o FIFA vira "encerrado" e corrige pro MK. Um
  // pick manual nesta visita (clicou num "em breve"/encerrado) trava a correção.
  useLayoutEffect(() => {
    const inTabs = view === 'apostas' || view === 'campeonatos';
    if (!inTabs) { lastChampViewRef.current = null; return; }
    // Entrou agora na aba? Esquece o pick manual da visita anterior.
    if (lastChampViewRef.current !== view) { lastChampViewRef.current = view; manualChampRef.current = false; }
    if (manualChampRef.current) return;
    const firstActive = (CHAMPIONSHIPS.find(c => champStatusFor(c, cs) === 'active') || CHAMPIONSHIPS[0]).id;
    setChampionship(firstActive);
  }, [view, cs]);

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
          ? { results: topWc.results || {}, picks: topWc.picks || {}, thirds: topWc.thirds || {} }
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
        const mkUsers = remote.users && typeof remote.users === 'object' ? remote.users : {};
        const mkDrawVal = Array.isArray(mk.draw) ? mk.draw : null;
        const mkScoresVal = mkApplyWo(mkDrawVal, mk.scores && typeof mk.scores === 'object' ? mk.scores : {});
        setMkDraw(mkDrawVal);
        setMkScores(mkScoresVal);
        // Saneia os cards na leitura: remove bonecos que saíram do elenco do jogador
        // (montou o card e depois trocou de elenco). Não toca jogo já concluído.
        setMkLineups(mkSanitizeLineups(
          mk.lineups && typeof mk.lineups === 'object' ? mk.lineups : {},
          mkDrawVal, mkScoresVal, mkUsers
        ));
        setMkLocked(!!mk.locked);
        setMkKo(mk.ko && typeof mk.ko === 'object' ? mk.ko : null);
        setOfficialDayState(remote.officialDay && typeof remote.officialDay === 'object' ? remote.officialDay : null);
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

  // ── Firestore: avatares custom (primitivao/avatars) ───────────────────────
  // Doc separado pra não inchar apostas. Mesmas guardas de !snap.exists (um
  // exists=false transiente NÃO pode zerar os avatares). Atualiza o mapa de
  // módulo AVATAR_MAP + bumpa avatarsRev pra re-render. CLAUDE.md §2.3.
  useEffect(() => {
    const ref = AVATARS_DOC();
    const unsub = ref.onSnapshot(snap => {
      if (!snap.exists) {
        if (avLoadedRef.current) { console.warn('Avatars: exists=false IGNORADO (transiente).'); return; }
        if (snap.metadata && snap.metadata.fromCache) return;
        AVATAR_MAP = {}; avLoadedRef.current = true; setAvatarsRev(r => r + 1);
        return;
      }
      AVATAR_MAP = snap.data() || {};
      avLoadedRef.current = true;
      setAvatarsRev(r => r + 1);
    }, err => console.warn('Avatars subscription failed', err));
    return () => unsub();
  }, []);

  // ── M8: Firestore campeonatos (primitivao/championships) ──────────────────
  // Doc SEPARADO (não incha o apostas, não colide com cs.rounds). Mesmas guardas
  // de !snap.exists transiente da CLAUDE.md §2.3 — nunca zera fora do guard.
  useEffect(() => {
    const ref = CHAMP_DOC();
    const unsub = ref.onSnapshot(snap => {
      if (!snap.exists) {
        if (champsLoadedRef.current) { console.warn('Champs: exists=false IGNORADO (transiente).'); return; }
        if (snap.metadata && snap.metadata.fromCache) return;
        // servidor confirma que não existe: cria vazio com merge (nunca apaga nada).
        ref.set({ json: JSON.stringify({ champs: {} }), updatedAt: Date.now() }, { merge: true }).catch(e => console.warn(e));
        setChamps({}); champsLoadedRef.current = true;
        return;
      }
      try {
        const d = JSON.parse(snap.data().json || '{}');
        setChamps(d && typeof d.champs === 'object' ? d.champs : {});
        champsLoadedRef.current = true;
      } catch (e) { console.warn('Champs parse failed', e); }
    }, err => console.warn('Champs subscription failed', err));
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
            let gorjeta = 0; // gorjeta do cartola (preenchida quando uma cópia vence)
            if (oldStatus === 'won' && newStatus !== 'won' && oldPayout > 0 && newUsers[b.user]) {
              newUsers[b.user] = { ...newUsers[b.user], pc: Math.max(0, newUsers[b.user].pc - oldPayout) };
            }
            const offOn = !!(remote.officialDay && remote.officialDay.active);
            if (newStatus === 'won' && oldStatus !== 'won') {
              const gross = Math.round(b.amount * b.combinedOdds * (offOn ? OFFICIAL_DAY_MULT : 1));
              const profit = Math.max(0, gross - (b.amount || 0));
              // Cópia que vence paga taxa de seguidor (FOLLOW_FEE do lucro); metade vira gorjeta do cartola.
              const fee = b.copyOf ? Math.round(profit * FOLLOW_FEE) : 0;
              gorjeta = b.copyOf ? Math.round(profit * TIP_COMMISSION) : 0;
              newPayout = gross - fee;
              if (newUsers[b.user]) {
                newUsers[b.user] = { ...newUsers[b.user], pc: newUsers[b.user].pc + newPayout };
              }
            } else if (newStatus === 'lost') {
              newPayout = 0;
            } else if (newStatus === 'pending') {
              newPayout = undefined;
            }
            dirty = true;
            // settledAt marca QUANDO o ticket liquidou (Jornalista ordena por isso)
            const settledAt = newStatus === 'pending' ? undefined
              : (oldStatus !== newStatus ? Date.now() : b.settledAt);
            // M9: cópia de ticket aberto resolvida -> credita/debita reputação do DONO (1x, via graded).
            if (b.copyOf && b.copyOwner && (newStatus === 'won' || newStatus === 'lost')) {
              const ow = newUsers[b.copyOwner];
              if (ow) {
                const rep = ow.rep || {};
                if (!(rep.graded && rep.graded[b.id])) {
                  const repWon = newStatus === 'won';
                  const delta = repDeltaForCopy(b, repWon);
                  // Gorjeta do Cartola: parte da taxa de seguidor (calculada no ganho acima).
                  newUsers[b.copyOwner] = { ...ow, pc: (ow.pc || 0) + gorjeta, rep: {
                    score: Math.max(0, (rep.score || 0) + delta),
                    followersWon: (rep.followersWon || 0) + (repWon ? 1 : 0),
                    followersLost: (rep.followersLost || 0) + (repWon ? 0 : 1),
                    tips: (rep.tips || 0) + gorjeta,
                    graded: { ...(rep.graded || {}), [b.id]: 1 },
                  } };
                }
              }
            }
            // SEGURO da cópia: o cashback (10% do stake) só volta na DERROTA (seguro),
            // creditado 1x. cashbackPaid garante idempotência; cópias antigas (sem
            // cashbackDeferred) já receberam na hora e não pagam de novo.
            let cashbackPaid = b.cashbackPaid;
            if (b.copyOf && b.cashbackDeferred && !b.cashbackPaid && newStatus === 'lost' && (b.cashback || 0) > 0 && newUsers[b.user]) {
              newUsers[b.user] = { ...newUsers[b.user], pc: newUsers[b.user].pc + b.cashback };
              cashbackPaid = true;
            }
            return { ...b, legs, status: newStatus, payout: newPayout, settledAt, officialBonus: newStatus === 'won' ? offOn : false, cashbackPaid };
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
              if (mkGameVoid(l)) return l; // jogo anulado (jogador retirado): não liquida nem reverte — preserva o histórico já decidido
              const gk = (typeof l.fixtureId === 'string' && l.fixtureId.indexOf('mk:') === 0) ? l.fixtureId.slice(3) : null;
              const sc = gk ? (snap[gk] || {}) : {};
              if (sc && sc.wo) return l; // jogo em W.O. (desistente): não liquida — o cupom é anulado (devolvido) pelo cleanup de apostas
              const done = !!mkMatchOutcome(sc);
              if (l.result && !done) { changed = true; return { ...l, result: undefined }; }
              if (!l.result && done) {
                const res = mkLegResult(l.market, l.pick, sc, sc);
                // R1 sem firstRound marcado retorna 'pending' mesmo com o confronto
                // concluído — não liquida (espera o mod marcar o 1º round).
                if (res === 'win' || res === 'lose') { changed = true; return { ...l, result: res }; }
              }
              return l;
            });
            if (!changed) return b;
            const newStatus = ticketStatusFromLegs(legs);
            const oldStatus = b.status;
            const oldPayout = b.payout || 0;
            let newPayout = b.payout;
            let gorjeta = 0; // gorjeta do cartola (preenchida quando uma cópia vence)
            if (oldStatus === 'won' && newStatus !== 'won' && oldPayout > 0 && newUsers[b.user]) {
              newUsers[b.user] = { ...newUsers[b.user], pc: Math.max(0, newUsers[b.user].pc - oldPayout) };
            }
            const offOn = !!(remote.officialDay && remote.officialDay.active);
            if (newStatus === 'won' && oldStatus !== 'won') {
              const gross = Math.round(b.amount * b.combinedOdds * (offOn ? OFFICIAL_DAY_MULT : 1));
              const profit = Math.max(0, gross - (b.amount || 0));
              const fee = b.copyOf ? Math.round(profit * FOLLOW_FEE) : 0;
              gorjeta = b.copyOf ? Math.round(profit * TIP_COMMISSION) : 0;
              newPayout = gross - fee;
              if (newUsers[b.user]) newUsers[b.user] = { ...newUsers[b.user], pc: newUsers[b.user].pc + newPayout };
            } else if (newStatus === 'lost') { newPayout = 0; }
            else if (newStatus === 'pending') { newPayout = undefined; }
            dirty = true;
            // settledAt marca QUANDO o ticket liquidou (Jornalista ordena por isso)
            const settledAt = newStatus === 'pending' ? undefined
              : (oldStatus !== newStatus ? Date.now() : b.settledAt);
            // M9: cópia de ticket aberto resolvida -> credita/debita reputação do DONO (1x, via graded).
            if (b.copyOf && b.copyOwner && (newStatus === 'won' || newStatus === 'lost')) {
              const ow = newUsers[b.copyOwner];
              if (ow) {
                const rep = ow.rep || {};
                if (!(rep.graded && rep.graded[b.id])) {
                  const repWon = newStatus === 'won';
                  const delta = repDeltaForCopy(b, repWon);
                  // Gorjeta do Cartola: parte da taxa de seguidor (calculada no ganho acima).
                  newUsers[b.copyOwner] = { ...ow, pc: (ow.pc || 0) + gorjeta, rep: {
                    score: Math.max(0, (rep.score || 0) + delta),
                    followersWon: (rep.followersWon || 0) + (repWon ? 1 : 0),
                    followersLost: (rep.followersLost || 0) + (repWon ? 0 : 1),
                    tips: (rep.tips || 0) + gorjeta,
                    graded: { ...(rep.graded || {}), [b.id]: 1 },
                  } };
                }
              }
            }
            // M9 fix: cashback DIFERIDO da cópia (mesmo da FIFA) — 1x na liquidação.
            let cashbackPaid = b.cashbackPaid;
            if (b.copyOf && b.cashbackDeferred && !b.cashbackPaid && newStatus === 'lost' && (b.cashback || 0) > 0 && newUsers[b.user]) {
              newUsers[b.user] = { ...newUsers[b.user], pc: newUsers[b.user].pc + b.cashback };
              cashbackPaid = true;
            }
            return { ...b, legs, status: newStatus, payout: newPayout, settledAt, officialBonus: newStatus === 'won' ? offOn : false, cashbackPaid };
          });
          if (!dirty) return null;
          return { ...remote, users: newUsers, bets: newBets };
        });
      } catch (e) { if (!cancelled) console.warn('mk auto-settle failed', e); }
    }, 600);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [mkScores]);

  // Liquidação das apostas do MATA-MATA (champId 'mkko'): keyed em mk.ko.scores.
  // RE-AVALIA toda perna a cada passada (idempotente) — assim correção do mod
  // (desfazer/trocar vencedor) reverte pagamento e re-liquida certo, inclusive
  // flip vencedor->outro sem passar por "pendente". Não mexe em cópia/cashback
  // (aposta de KO não é copiável).
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      try {
        await commitBetDocUpdate(remote => {
          const remoteBets = remote.bets || [];
          if (!remoteBets.some(b => b && b.champId === 'mkko')) return null;
          const ko = remote.mk && remote.mk.ko;
          // KO DESPUBLICADO (ko null/não publicado): NÃO mexe nas apostas — senão
          // reverteria prêmio de cupom já ganho e o deixaria órfão em 'pending'. As
          // pendentes já foram devolvidas no resetMkKo. (Distingue "mod corrigiu
          // placar" [ko publicado, scores mudam] de "despublicou" [ko sumiu].)
          if (!ko || !ko.published) return null;
          const koScores = ko.scores || {};
          const koBr = mkKoBracket(ko.seeds || [], koScores); // pras pernas de mercado do campeonato
          const newUsers = { ...(remote.users || {}) };
          let dirty = false;
          const newBets = remoteBets.map(b => {
            if (!b || b.champId !== 'mkko') return b;
            let changed = false;
            const legs = (b.legs || []).map(l => {
              // mkKoLegResult (confronto) / mkKoTourneyLegResult (campeonato) já
              // sabem liquidar cada mercado na hora certa. RE-AVALIA sempre.
              let r;
              if (l.tourney || (typeof l.fixtureId === 'string' && l.fixtureId.indexOf('mkkot:') === 0)) {
                r = mkKoTourneyLegResult(l.koTourneyMarket || l.market, l.pick, koBr);
              } else {
                const mid = (typeof l.fixtureId === 'string' && l.fixtureId.indexOf('mkko:') === 0) ? l.fixtureId.slice(5) : l.koMatch;
                r = mkKoLegResult(l.market, l.pick, mid ? (koScores[mid] || {}) : {});
              }
              const want = (r === 'win' || r === 'lose') ? r : undefined;
              if (want !== l.result) { changed = true; return { ...l, result: want }; }
              return l;
            });
            if (!changed) return b;
            const newStatus = ticketStatusFromLegs(legs);
            const oldStatus = b.status;
            const oldPayout = b.payout || 0;
            let newPayout = b.payout;
            // reverte pagamento anterior se saiu de 'won'
            if (oldStatus === 'won' && newStatus !== 'won' && oldPayout > 0 && newUsers[b.user]) {
              newUsers[b.user] = { ...newUsers[b.user], pc: Math.max(0, newUsers[b.user].pc - oldPayout) };
            }
            const offOn = !!(remote.officialDay && remote.officialDay.active);
            if (newStatus === 'won' && oldStatus !== 'won') {
              const gross = Math.round(b.amount * b.combinedOdds * (offOn ? OFFICIAL_DAY_MULT : 1));
              newPayout = gross;
              if (newUsers[b.user]) newUsers[b.user] = { ...newUsers[b.user], pc: (newUsers[b.user].pc || 0) + newPayout };
            } else if (newStatus === 'lost') { newPayout = 0; }
            else if (newStatus === 'pending') { newPayout = undefined; }
            dirty = true;
            const settledAt = newStatus === 'pending' ? undefined : (oldStatus !== newStatus ? Date.now() : b.settledAt);
            return { ...b, legs, status: newStatus, payout: newPayout, settledAt, officialBonus: newStatus === 'won' ? offOn : false };
          });
          if (!dirty) return null;
          return { ...remote, users: newUsers, bets: newBets };
        });
      } catch (e) { if (!cancelled) console.warn('ko auto-settle failed', e); }
    }, 650);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [mkKo]);

  // ANULA (uma vez) apostas ABERTAS que caíram num confronto de W.O. (desistente).
  // Um jogo em W.O. nunca terá resultado real, então a aposta não tem como
  // liquidar de forma justa — devolve o valor apostado e remove o cupom (mesma
  // regra do adminVoidBet). Só admin/mod dispara (é ação de moderação) e é
  // idempotente: ao remover os cupons, não há mais o que reprocessar. Roda depois
  // do settle (que CONGELA as pernas de W.O.), então não há corrida de saldo.
  useEffect(() => {
    if (!hasLoadedRef.current || !mkDraw) return;
    const me = session && session.nick;
    if (!me || !(me === ADMIN_NICK || MOD_NICKS.includes(me))) return;
    // chaves dos jogos em W.O. (com overlay `wo` já aplicado em mkScores).
    const gk = (r, gi) => r.phase + '-' + r.n + '-' + gi;
    const woKeys = new Set();
    mkDraw.forEach(r => (r.games || []).forEach((g, gi) => {
      if (mkGameHasWo(g) && !mkGameVoid(g) && ((mkScores || {})[gk(r, gi)] || {}).wo) woKeys.add(gk(r, gi));
    }));
    if (!woKeys.size) return;
    const legIsWo = (l) => typeof l.fixtureId === 'string' && l.fixtureId.indexOf('mk:') === 0 && woKeys.has(l.fixtureId.slice(3));
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      try {
        await commitBetDocUpdate(remote => {
          const targets = (remote.bets || []).filter(b => b && b.status === 'pending' && (b.legs || []).some(legIsWo));
          if (!targets.length) return null;
          const users = { ...(remote.users || {}) };
          targets.forEach(t => { // pending: só o valor apostado foi debitado -> devolve
            const u = users[t.user];
            if (u) users[t.user] = { ...u, pc: Math.max(0, (u.pc || 0) + (t.amount || 0)) };
          });
          const ids = new Set(targets.map(t => t.id));
          return { ...remote, users, bets: (remote.bets || []).filter(b => !ids.has(b.id)) };
        });
      } catch (e) { if (!cancelled) console.warn('mk W.O. void failed', e); }
    }, 900);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [mkDraw, mkScores, session]);

  // Derivados de cs.rounds: métricas dos times + jogos disponíveis com odds.
  const rounds   = cs?.rounds || [];
  const metrics  = useMemo(() => computeTeamMetrics(rounds), [rounds]);
  const games    = useMemo(
    () => bettableGames(rounds).map(g => ({ ...g, odds: computeGameOdds(g.home, g.away, metrics, rounds) })),
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
  // O mod pode DESLIGAR o modo mod (ver o app como jogador comum). Fica salvo
  // por dispositivo em localStorage; reativa quando quiser no MEU PERFIL.
  const isNaturalMod = !!(session && MOD_NICKS.includes(session.nick));
  const [modDisabled, setModDisabled] = useState(() => { try { return localStorage.getItem('pv-mod-off') === '1'; } catch (_) { return false; } });
  const toggleModView = () => setModDisabled(d => { const next = !d; try { localStorage.setItem('pv-mod-off', next ? '1' : '0'); } catch (_) {} return next; });
  const isMod = isAdmin || (isNaturalMod && !modDisabled);
  // Se desligar o mod estando na aba ADMIN, volta pra apostas (não fica em tela vazia).
  useEffect(() => { if (view === 'admin') { setView('mod'); return; } if (view === 'mod' && !isMod) setView('apostas'); }, [view, isMod]);

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

  // ── BÔNUS POR RODADA (substitui o semanal) ────────────────────────────────
  // Quando uma rodada de QUALQUER campeonato (tabela da FIFA + MK) fica completa,
  // credita ROUND_BONUS_PC pra TODO MUNDO — UMA vez por rodada. O ledger no json
  // (roundBonus: { fifa:[idx], mk:[idx] }) é set de índices: idempotente, à prova
  // de duplo-crédito (transação) e de rodadas que fecham fora de ordem. Retroativo:
  // ledger vazio na 1ª vez credita todas as rodadas já completas.
  const creditRoundBonus = async () => {
    const fifaIdx = fifaCompleteRoundIdxs(cs);
    const mkIdx = mkCompleteRoundIdxs(mkDraw, mkScores);
    if (fifaIdx.length + mkIdx.length === 0) return;
    try {
      await commitBetDocUpdate(remote => {
        const led = (remote.roundBonus && typeof remote.roundBonus === 'object') ? remote.roundBonus : {};
        const credF = new Set(Array.isArray(led.fifa) ? led.fifa : []);
        const credM = new Set(Array.isArray(led.mk) ? led.mk : []);
        const newF = fifaIdx.filter(i => !credF.has(i));
        const newM = mkIdx.filter(i => !credM.has(i));
        const n = newF.length + newM.length;
        if (n <= 0) return null;
        const add = n * ROUND_BONUS_PC;
        const users = {};
        for (const [nk, u] of Object.entries(remote.users || {})) users[nk] = { ...u, pc: (u.pc || 0) + add };
        return { ...remote, users, roundBonus: {
          fifa: [...credF, ...newF].sort((a, b) => a - b),
          mk: [...credM, ...newM].sort((a, b) => a - b),
        } };
      });
    } catch (e) { console.warn('creditRoundBonus failed', e); }
  };

  // ADMIN: credita `amount` PC pra TODOS de uma vez (botão da aba USUÁRIOS).
  const grantAllPc = async (amount) => {
    const amt = Number(amount) || 0; if (!amt) return { err: 'valor inválido' };
    try {
      const res = await commitBetDocUpdate(remote => {
        const users = {};
        for (const [nk, u] of Object.entries(remote.users || {})) users[nk] = { ...u, pc: (u.pc || 0) + amt };
        return { ...remote, users };
      });
      return res || { ok: true };
    } catch (e) { console.warn('grantAllPc failed', e); return { err: 'falha' }; }
  };

  // ADMIN/MOD: liga/desliga o DIA OFICIAL (+25% PC em apostas vencedoras).
  // Grava no JSON (sibling de users/bets/mk) — coberto pelo backup do json.
  const setOfficialDay = async (active) => {
    try {
      const res = await commitBetDocUpdate(remote => ({
        ...remote,
        officialDay: { active: !!active, since: Date.now(), by: session.nick },
      }));
      return res || { ok: true };
    } catch (e) { console.warn('setOfficialDay failed', e); return { err: 'falha' }; }
  };

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
  // Remove perna do cupom. Com market/pick remove SÓ aquele palpite; sem
  // (compat) remove todos os palpites do jogo. Importante porque o slip
  // aceita vários mercados do mesmo jogo (1X2 + BTTS...) — o X de uma perna
  // não pode engolir as outras.
  const removeLeg = (fixtureId, market, pick) => setSlip(prev => prev.filter(s =>
    market == null
      ? s.fixtureId !== fixtureId
      : !(s.fixtureId === fixtureId && s.market === market && s.pick === pick)
  ));
  const clearSlip = () => setSlip([]);

  // PlaceBet via transação: debita PC + adiciona ticket atomicamente contra
  // o estado remoto (não permite ficar negativo nem perder o ticket).
  // TODO cupom é PÚBLICO (vai direto pra MESA DOS CARTOLAS) e NÃO dá pra tirar —
  // todo cupom pendente fica copiável. `opts` mantido por compat dos callers.
  const placeBet = async (amount, opts) => {
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
      showToast(removed === 1
        ? 'Um palpite foi removido (jogo finalizado/travado). Confere o cupom e tenta de novo.'
        : `${removed} palpites foram removidos (jogos finalizados/travados). Confere o cupom e tenta de novo.`, 'error');
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
      open: true, openMeta: { publishedAt: Date.now(), copies: 0, stakeCopied: 0 },
    };
    try {
      let autoCopyInfo = null;
      const result = await commitBetDocUpdate(remote => {
        autoCopyInfo = null;
        const u = (remote.users || {})[session.nick];
        if (!u) {
          return { __abort: true, result: { err: 'Sua conta não está sincronizada. Faz logout e entra de novo.' } };
        }
        if (u.pc < amount) {
          return { __abort: true, result: { err: 'Saldo insuficiente (tem ' + u.pc + ' PC, aposta de ' + amount + ' PC).' } };
        }
        // Auto-cópia: se um cupom IDÊNTICO já está aberto na Mesa, a aposta vira
        // cópia dele (não duplica o ticket). Own = bloqueia repetir o próprio.
        const { own, other } = findMesaTwins(remote, ticket.legs, session.nick, ticket.champId);
        // Own tem precedência: já tem esse cupom aberto -> bloqueia (não duplica
        // nem vira cópia de terceiro em cima do próprio ticket).
        if (own) return { __abort: true, result: { err: 'Você já tem esse cupom aberto na Mesa dos Cartolas.' } };
        if (other) {
          if ((remote.bets || []).some(c => c.copyOf === other.id && c.user === session.nick)) {
            return { __abort: true, result: { err: 'Você já copiou esse cupom na Mesa dos Cartolas.' } };
          }
          const ac = buildAutoCopy(remote, other, session.nick, amount, u);
          autoCopyInfo = { cashback: ac.cashback, owner: ac.owner, odds: ac.odds };
          return ac.state;
        }
        // Idempotência: se por algum motivo o ticket já foi gravado, não duplica.
        if ((remote.bets || []).some(b => b.id === ticket.id)) return null;
        const users = { ...remote.users, [session.nick]: { ...u, pc: u.pc - amount } };
        const bets = [ticket, ...(remote.bets || [])];
        return { ...remote, users, bets };
      });
      if (result && result.err) { showToast(result.err, 'error'); return; }
      setSlip([]);
      showToast(autoCopyInfo
        ? ('Cupom idêntico já estava na Mesa — você copiou o de ' + autoCopyInfo.owner + ' (odd ' + Number(autoCopyInfo.odds).toFixed(2) + 'x). Seguro de ' + autoCopyInfo.cashback + ' PC se o cupom perder.')
        : `Aposta de ${amount} PC feita e publicada na MESA DOS CARTOLAS!`, 'success');
      return { ok: true };
    } catch (e) {
      console.warn('placeBet failed', e);
      showToast('Erro ao registrar a aposta: ' + (e && e.message || e) + '. Tenta de novo em alguns segundos.', 'error');
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
          if (l.tourney || (typeof l.fixtureId === 'string' && l.fixtureId.indexOf('mkkot:') === 0)) {
            return mkKoAnyStarted((((remote.mk && remote.mk.ko) || {}).scores || {})); // outright: trava quando o mata-mata começa
          }
          if (typeof l.fixtureId === 'string' && l.fixtureId.indexOf('mkko:') === 0) {
            return mkKoMatchStarted((((remote.mk && remote.mk.ko) || {}).scores || {})[l.fixtureId.slice(5)]);
          }
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
      if (result && result.err) showToast(result.err, 'error');
    } catch (e) {
      console.warn('cancelBet failed', e);
    }
  };

  // ── TICKETS ABERTOS (M9) ──────────────────────────────────────────────────
  // True se alguma perna já resolveu ou o jogo travou/jogou (não dá pra abrir/copiar).
  const legBusy = (legs, remote) => (legs || []).some(l => {
    if (l.result) return true;
    if (l.tourney || (typeof l.fixtureId === 'string' && l.fixtureId.indexOf('mkkot:') === 0)) {
      return mkKoAnyStarted((((remote.mk && remote.mk.ko) || {}).scores || {}));
    }
    if (typeof l.fixtureId === 'string' && l.fixtureId.indexOf('mkko:') === 0) {
      return mkKoMatchStarted((((remote.mk && remote.mk.ko) || {}).scores || {})[l.fixtureId.slice(5)]);
    }
    if (typeof l.fixtureId === 'string' && l.fixtureId.indexOf('mk:') === 0) {
      return mkGameClosed(((remote.mk && remote.mk.scores) || {})[l.fixtureId.slice(3)]);
    }
    const p = parseGameId(l.fixtureId); if (!p) return false;
    const g = cs && cs.rounds && cs.rounds[p.ri] && cs.rounds[p.ri][p.gi];
    return !!(g && (g.locked || isGamePlayed(g)));
  });
  // Publicar/despublicar na Mesa foi REMOVIDO: todo cupom é público sempre
  // (nasce open:true; a Mesa lista todo cupom pendente que não é cópia).
  // ── AUTO-CÓPIA (dedup da Mesa dos Cartolas) ────────────────────────────────
  // Se a aposta nova for IDÊNTICA a um cupom já ABERTO e VISÍVEL na Mesa (open,
  // pendente, não-cópia, odd combinada >= MESA_MIN_ODDS), ela vira CÓPIA em vez
  // de virar um ticket repetido no feed. `other` = de outro usuário (candidato a
  // cópia); `own` = do próprio nick (bloqueia o duplicado).
  const findMesaTwins = (remote, legs, nick, champId) => {
    const sig = legsSignature(legs);
    const min = mesaMinOddsFor(champId);
    const twins = (remote.bets || []).filter(b => b && b.open && !b.copyOf && b.status === 'pending'
      && Number(b.combinedOdds || 0) >= min && legsSignature(b.legs) === sig);
    return {
      own: twins.find(b => b.user === nick) || null,
      other: twins.find(b => b.user !== nick && !legBusy(b.legs, remote)) || null,
    };
  };
  // Constrói o estado com a aposta convertida em CÓPIA do `twin` — mesmas regras
  // de copiar (seguro diferido + incrementa seguidores/gorjeta do dono).
  const buildAutoCopy = (remote, twin, nick, amount, u) => {
    const cashback = Math.round(amount * CASHBACK_RATE);
    const copyId = 'c' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const copy = {
      id: copyId, user: nick, amount, status: 'pending', createdAt: Date.now(),
      champId: twin.champId, combinedOdds: twin.combinedOdds, casada: twin.casada,
      legs: (twin.legs || []).map(l => ({ ...l })),
      copyOf: twin.id, copyOwner: twin.user, cashback, cashbackDeferred: true,
      autoCopied: true,
    };
    const users = { ...remote.users, [nick]: { ...u, pc: u.pc - amount } };
    const bets = (remote.bets || []).map(b => b.id !== twin.id ? b
      : ({ ...b, openMeta: { ...(b.openMeta || {}), copies: ((b.openMeta && b.openMeta.copies) || 0) + 1, stakeCopied: ((b.openMeta && b.openMeta.stakeCopied) || 0) + amount } }));
    return { state: { ...remote, users, bets: [copy, ...bets] }, cashback, owner: twin.user, odds: twin.combinedOdds };
  };
  // Copia um ticket aberto: paga o stake. O cashback de 10% (da casa) NÃO é mais
  // creditado na hora — fica DIFERIDO pra liquidação (settle), pago 1x quando a
  // cópia resolve. Isso fecha o exploit (copiar+cancelar ficava com o cashback).
  const copyOpenTicket = async (sourceId, amount) => {
    const amt = Math.round(Number(amount) || 0);
    if (amt <= 0) return { err: 'valor inválido' };
    const cashback = Math.round(amt * CASHBACK_RATE);
    const copyId = 'c' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    try {
      const result = await commitBetDocUpdate(remote => {
        const src = (remote.bets || []).find(b => b.id === sourceId);
        if (!src || !src.open || src.status !== 'pending') return { __abort: true, result: { err: 'Esse ticket não está mais aberto.' } };
        if (src.user === session.nick) return { __abort: true, result: { err: 'Não dá pra copiar o próprio ticket.' } };
        if (legBusy(src.legs, remote)) return { __abort: true, result: { err: 'Esse ticket já começou — não dá mais pra copiar.' } };
        if ((remote.bets || []).some(b => b.copyOf === sourceId && b.user === session.nick)) return { __abort: true, result: { err: 'Você já copiou esse ticket.' } };
        const u = (remote.users || {})[session.nick];
        if (!u) return { __abort: true, result: { err: 'Conta não sincronizada.' } };
        if (u.pc < amt) return { __abort: true, result: { err: 'Saldo insuficiente (tem ' + u.pc + ' PC).' } };
        if ((remote.bets || []).some(b => b.id === copyId)) return null;
        const copy = {
          id: copyId, user: session.nick, amount: amt, status: 'pending', createdAt: Date.now(),
          champId: src.champId, combinedOdds: src.combinedOdds, casada: src.casada,
          legs: (src.legs || []).map(l => ({ ...l })),
          copyOf: sourceId, copyOwner: src.user, cashback, cashbackDeferred: true,
        };
        const users = { ...remote.users, [session.nick]: { ...u, pc: u.pc - amt } };
        const bets = (remote.bets || []).map(b => b.id !== sourceId ? b : ({ ...b, openMeta: { ...(b.openMeta || {}), copies: ((b.openMeta && b.openMeta.copies) || 0) + 1, stakeCopied: ((b.openMeta && b.openMeta.stakeCopied) || 0) + amt } }));
        return { ...remote, users, bets: [copy, ...bets] };
      });
      if (result && result.err) { showToast(result.err, 'error'); return result; }
      showToast('Copiado! Seguro de ' + cashback + ' PC se o cupom perder.', 'success');
      return { ok: true, cashback };
    } catch (e) { console.warn('copyOpenTicket failed', e); return { err: 'falha' }; }
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
      open: true, openMeta: { publishedAt: Date.now(), copies: 0, stakeCopied: 0 }, // todo cupom nasce público
      legs: payload.legs.map(l => ({
        // cada perna leva a SUA rodada (phase/roundN/gi) — casada pode misturar
        // jogos de rodadas diferentes (jogos adiantados) e liquidar certo.
        fixtureId: 'mk:' + (l.phase || payload.phase) + '-' + (l.roundN ?? payload.roundN) + '-' + l.gi,
        market: l.market, pick: l.pick, odds: l.odd, odd: l.odd,
        home: l.home, away: l.away, gi: l.gi,
        roundN: (l.roundN ?? payload.roundN), phase: (l.phase || payload.phase),
      })),
    };
    try {
      let autoCopyInfo = null;
      const res = await commitBetDocUpdate(remote => {
        autoCopyInfo = null;
        const u = (remote.users || {})[nick];
        if (!u) return { __abort: true, result: { err: 'Conta não sincronizada. Faz login de novo.' } };
        if ((u.pc || 0) < stake) return { __abort: true, result: { err: 'Saldo insuficiente (tem ' + (u.pc || 0) + ' PC).' } };
        // Auto-cópia: cupom IDÊNTICO já aberto na Mesa vira cópia (não duplica).
        const { own, other } = findMesaTwins(remote, ticket.legs, nick, ticket.champId);
        // Own tem precedência: já tem esse cupom aberto -> bloqueia (não duplica).
        if (own) return { __abort: true, result: { err: 'Você já tem esse cupom aberto na Mesa dos Cartolas.' } };
        if (other) {
          if ((remote.bets || []).some(c => c.copyOf === other.id && c.user === nick)) {
            return { __abort: true, result: { err: 'Você já copiou esse cupom na Mesa dos Cartolas.' } };
          }
          const ac = buildAutoCopy(remote, other, nick, stake, u);
          autoCopyInfo = { cashback: ac.cashback, owner: ac.owner, odds: ac.odds };
          return ac.state;
        }
        if ((remote.bets || []).some(b => b.id === ticket.id)) return null;
        return { ...remote, users: { ...remote.users, [nick]: { ...u, pc: u.pc - stake } }, bets: [ticket, ...(remote.bets || [])] };
      });
      if (res && res.err) { showToast(res.err, 'error'); return res; }
      showToast(autoCopyInfo
        ? ('Cupom idêntico já estava na Mesa — você copiou o de ' + autoCopyInfo.owner + ' (odd ' + Number(autoCopyInfo.odds).toFixed(2) + 'x). Seguro de ' + autoCopyInfo.cashback + ' PC se o cupom perder.')
        : 'Aposta feita e publicada na MESA DOS CARTOLAS!', 'success');
      return { ok: true, autoCopied: !!autoCopyInfo };
    } catch (e) { console.warn('placeMkBet failed', e); showToast('Erro ao apostar. Tenta de novo.', 'error'); return { err: String(e) }; }
  };
  // APOSTA DO MATA-MATA (champId 'mkko'): fluxo próprio (sem Mesa/cópia), pra NÃO
  // tocar no dinheiro da liga. Valida TUDO na transação a partir do ko remoto:
  // confronto apostável (2 lados, não começou), não é o próprio confronto, palpite
  // válido. Debita o stake. Liquida no effect de KO abaixo.
  const placeKoBet = async (payload) => {
    const nick = session && session.nick;
    if (!nick || !payload || !Array.isArray(payload.legs) || !payload.legs.length) return { err: 'cupom inválido' };
    const stake = Math.floor(Number(payload.stake) || 0);
    if (!(stake > 0) || !isFinite(stake)) return { err: 'valor inválido' };
    const ticketId = 'mkko-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const createdAt = Date.now();
    try {
      let casada = false;
      const res = await commitBetDocUpdate(remote => {
        const u = (remote.users || {})[nick];
        if (!u) return { __abort: true, result: { err: 'Conta não sincronizada. Faz login de novo.' } };
        if ((u.pc || 0) < stake) return { __abort: true, result: { err: 'Saldo insuficiente (tem ' + (u.pc || 0) + ' PC).' } };
        const ko = remote.mk && remote.mk.ko;
        if (!ko || !ko.published) return { __abort: true, result: { err: 'O mata-mata ainda não foi publicado.' } };
        // Recomputa TUDO no servidor (odds e combinada) a partir do estado remoto —
        // não confia no odd/combined do cliente (fecha inflar payout).
        const draw = (remote.mk && remote.mk.draw) || [];
        const gk = (r, gi) => r.phase + '-' + r.n + '-' + gi;
        const scoresOv = mkApplyWo(draw, (remote.mk && remote.mk.scores) || {});
        const leaguePlayers = Array.from(new Set(draw.flatMap(r => (r.games || []).flatMap(g => [g.home, g.away])))).filter(n => n && !mkIsWithdrawn(n));
        const leagueMatches = draw.flatMap(r => (r.games || []).map((g, gi) => ({ home: g.home, away: g.away, sc: scoresOv[gk(r, gi)] || {} }))).filter(m => !mkGameVoid(m) && mkMatchOutcome(m.sc));
        const metrics = computeMkPlayerMetrics(leaguePlayers, leagueMatches);
        const br = mkKoBracket(ko.seeds, ko.scores);
        const oddsCache = {};
        const seenKey = {};
        const legs = [];
        let combined = 1;
        let tourneyProbs = null; // lazy — só computa se tiver perna de mercado do campeonato
        for (const l of payload.legs) {
          // MERCADO DO CAMPEONATO (outright: campeão, finalista...). pick = jogador.
          if (l.tourney) {
            const mkt = l.koTourneyMarket;
            if (MK_KO_TOURNEY_MARKETS.indexOf(mkt) === -1) return { __abort: true, result: { err: 'Mercado inválido.' } };
            if (!mkKoTourneyOpen(mkt, br)) return { __abort: true, result: { err: 'Esse mercado já fechou.' } };
            if (l.pick === nick) return { __abort: true, result: { err: 'Você não pode apostar em você mesmo.' } };
            if ((ko.seeds || []).indexOf(l.pick) === -1) return { __abort: true, result: { err: 'Jogador inválido.' } };
            const dkt = 'mkkot|' + mkt;
            if (seenKey[dkt]) return { __abort: true, result: { err: 'Palpite repetido no mesmo mercado.' } };
            seenKey[dkt] = 1;
            // Um JOGADOR por cupom nos mercados do campeonato: CHAMP/FINAL/SEMI/VICE/PODIUM
            // do mesmo jogador são eventos ENCAIXADOS (campeão⊂final⊂semi, campeão⊂pódio)
            // ou EXCLUDENTES (campeão×vice). Casar dois pro mesmo nick ou paga muito além
            // do justo (odds encaixadas multiplicam) ou é perda garantida — bloqueia os dois.
            const dpl = 'mkkotP|' + l.pick;
            if (seenKey[dpl]) return { __abort: true, result: { err: 'Só um mercado do campeonato por jogador no mesmo cupom (os mercados são ligados).' } };
            seenKey[dpl] = 1;
            if (!tourneyProbs) tourneyProbs = mkKoTournamentProbs(ko.seeds, ko.scores, metrics, draw, scoresOv);
            const prob = (tourneyProbs[l.pick] || {})[MK_KO_TOURNEY_PROB[mkt]] || 0;
            // Recusa palpite decidido/quase-certo (anti dinheiro-grátis pelo piso de odd).
            // Mesma regra do cliente — servidor manda: não confia no que a UI mostrou.
            if (!mkKoTourneyPickBettable(prob)) return { __abort: true, result: { err: prob > 0 ? (l.pick + ' já garantiu (ou está a um passo) — sem aposta nesse mercado.') : (l.pick + ' não tem mais chance nesse mercado.') } };
            const serverOdd = mkKoOddFromProb(prob);
            if (!(serverOdd > 1) || !isFinite(serverOdd)) return { __abort: true, result: { err: l.pick + ' não tem mais chance nesse mercado.' } };
            combined *= serverOdd;
            legs.push({ fixtureId: 'mkkot:' + mkt, tourney: true, koTourneyMarket: mkt, market: mkt, pick: l.pick, odds: serverOdd, odd: serverOdd });
            continue;
          }
          const m = br[l.koMatch];
          const sc = (ko.scores || {})[l.koMatch];
          if (!m || !mkKoBettable(m, sc)) return { __abort: true, result: { err: 'Esse confronto não está aberto pra aposta.' } };
          if (m.home === nick || m.away === nick) return { __abort: true, result: { err: 'Você não pode apostar no próprio confronto.' } };
          // Dá pra casar mercados DIFERENTES do mesmo confronto (igual à liga); só
          // não pode 2 pernas do MESMO mercado no mesmo confronto (duplicata).
          const dk = l.koMatch + '|' + l.market;
          if (seenKey[dk]) return { __abort: true, result: { err: 'Palpite repetido (mesmo mercado no mesmo confronto).' } };
          seenKey[dk] = 1;
          if (mkKoMarketPicks(l.market).indexOf(l.pick) === -1) return { __abort: true, result: { err: 'Palpite inválido.' } };
          const odds = oddsCache[l.koMatch] || (oddsCache[l.koMatch] = computeMkKoOdds(m.home, m.away, metrics, draw, scoresOv));
          const serverOdd = odds[l.market] && odds[l.market][l.pick];
          if (!(serverOdd > 1) || !isFinite(serverOdd)) return { __abort: true, result: { err: 'Odd indisponível pra esse palpite.' } };
          combined *= serverOdd;
          legs.push({ fixtureId: 'mkko:' + l.koMatch, koMatch: l.koMatch, market: l.market, pick: l.pick, odds: serverOdd, odd: serverOdd, home: m.home, away: m.away });
        }
        combined = +combined.toFixed(2);
        casada = legs.length >= 2;
        const ticket = {
          id: ticketId, user: nick, amount: stake, status: 'pending', createdAt,
          champId: 'mkko', combinedOdds: combined, casada, nick, stake, combined, legs,
        };
        if ((remote.bets || []).some(b => b.id === ticket.id)) return null;
        return { ...remote, users: { ...remote.users, [nick]: { ...u, pc: u.pc - stake } }, bets: [ticket, ...(remote.bets || [])] };
      });
      if (res && res.err) { showToast(res.err, 'error'); return res; }
      showToast((casada ? 'Casada' : 'Aposta') + ' do mata-mata feita! ' + stake + ' PC', 'success');
      return { ok: true };
    } catch (e) { console.warn('placeKoBet failed', e); showToast('Erro ao apostar. Tenta de novo.', 'error'); return { err: String(e) }; }
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
          if (l.tourney || (typeof l.fixtureId === 'string' && l.fixtureId.indexOf('mkkot:') === 0)) {
            return mkKoAnyStarted((((remote.mk && remote.mk.ko) || {}).scores || {}));
          }
          if (typeof l.fixtureId === 'string' && l.fixtureId.indexOf('mkko:') === 0) {
            return mkKoMatchStarted((((remote.mk && remote.mk.ko) || {}).scores || {})[l.fixtureId.slice(5)]);
          }
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

  // ADMIN/MOD: ANULAR uma aposta (qualquer usuário, qualquer status). Pro caso
  // de WO/jogo cancelado: desfaz o efeito financeiro (devolve o valor apostado
  // e, se já tinha ganho, estorna o prêmio) e remove o cupom. Funciona pra FIFA
  // e MK, ignorando trava/liquidação (é override de moderação). Como remove do
  // array, a liquidação automática não recria nem reaplica nada.
  const adminVoidBet = async (ticketId) => {
    const me = session && session.nick;
    if (!me || !(me === ADMIN_NICK || MOD_NICKS.includes(me))) return { err: 'Sem permissão.' };
    try {
      const res = await commitBetDocUpdate(remote => {
        const t = (remote.bets || []).find(b => b.id === ticketId);
        if (!t) return { __abort: true, result: { err: 'Aposta não encontrada.' } };
        // Desfaz o efeito no saldo: ao apostar foi -amount; se ganhou foi +payout.
        // pending/lost -> devolve amount; won -> devolve amount e estorna payout.
        const delta = t.status === 'won' ? ((t.amount || 0) - (t.payout || 0)) : (t.amount || 0);
        const users = { ...remote.users };
        const u = users[t.user];
        if (u) users[t.user] = { ...u, pc: Math.max(0, (u.pc || 0) + delta) };
        const bets = (remote.bets || []).filter(b => b.id !== ticketId);
        return { ...remote, users, bets };
      });
      return res || { ok: true };
    } catch (e) { console.warn('adminVoidBet failed', e); return { err: 'Falha ao anular.' }; }
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
        const removing = !!champ[nick];
        if (removing) delete champ[nick];
        else champ[nick] = { at: Date.now() };
        map[champId] = champ;
        newMap = map;
        // IMPORTANTE: merge:true NÃO apaga chave aninhada que sumiu do objeto —
        // só adiciona/atualiza. Pra DESINSCREVER, tem que usar FieldValue.delete
        // no path específico; pra inscrever, grava a chave. (bug: cancelar não saía)
        const fieldPatch = removing
          ? { [nick]: firebase.firestore.FieldValue.delete() }
          : { [nick]: { at: Date.now() } };
        tx.set(ref, { interests: { [champId]: fieldPatch }, updatedAt: Date.now() }, { merge: true });
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
  const saveWorldcupPick = async (matchId, gh, ga, penH, penA) => {
    if (!session || !session.nick) return;
    const nick = session.nick;
    const pgh = parseInt(gh, 10), pga = parseInt(ga, 10);
    // Erros NOMEADOS (não return silencioso): o card mapeia pra mensagem certa
    // em vez de mostrar "palpite salvo" sem ter salvo nada.
    if (Number.isNaN(pgh) || Number.isNaN(pga) || pgh < 0 || pga < 0 || pgh > 20 || pga > 20) {
      throw new Error('PALPITE_INVALIDO');
    }
    // Trava por horário também na GRAVAÇÃO: uma aba aberta antes do pontapé
    // não pode salvar palpite depois que a bola rolou (a UI trava sozinha,
    // isso aqui é o cinto de segurança).
    const wcMatch = (wcData.matches || []).find(x => x.id === matchId);
    if (wcMatch && wcMatch.kickoffTs != null && Date.now() >= wcMatch.kickoffTs) {
      throw new Error('JOGO_INICIADO');
    }
    const ref = BET_DOC();
    let newState = null;
    try {
      await window.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const cur = (snap.exists && snap.data().worldcup && typeof snap.data().worldcup === 'object')
          ? snap.data().worldcup : {};
        // Não permite alterar palpite se o admin já lançou o placar real
        if (cur.results && cur.results[matchId]) throw new Error('RESULTADO_JA_LANCADO');
        const picks = { ...(cur.picks || {}) };
        const userPicks = { ...(picks[nick] || {}) };
        const ph = parseInt(penH, 10), pa = parseInt(penA, 10);
        // só guarda palpite de pênaltis se o palpite do tempo normal é empate
        const pens = (pgh === pga && !Number.isNaN(ph) && !Number.isNaN(pa) && ph >= 0 && pa >= 0 && ph !== pa)
          ? { penH: ph, penA: pa } : {};
        userPicks[matchId] = { gh: pgh, ga: pga, at: Date.now(), ...pens };
        picks[nick] = userPicks;
        const next = { results: cur.results || {}, picks, thirds: cur.thirds || {} };
        newState = next;
        tx.set(ref, { worldcup: next, updatedAt: Date.now() }, { merge: true });
      });
      if (newState) setShared(s => ({ ...s, worldcup: newState }));
    } catch (e) {
      console.warn('saveWorldcupPick failed', e);
      throw e;
    }
  };

  // `penH`/`penA` (opcional): placar dos pênaltis quando o mata-mata empata em
  // 90/prorrogação. Resolve o vencedor (libera a próxima fase) E vale pontos no
  // bolão (placar exato +3 / só quem passou +1). Guardado só se o jogo empatou.
  const setWorldcupResult = async (matchId, gh, ga, penH, penA) => {
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
          const ph = parseInt(penH, 10), pa = parseInt(penA, 10);
          const pens = (pgh === pga && !Number.isNaN(ph) && !Number.isNaN(pa) && ph >= 0 && pa >= 0 && ph !== pa)
            ? { penH: ph, penA: pa } : {};
          results[matchId] = { gh: pgh, ga: pga, at: Date.now(), ...pens };
        }
        const next = { results, picks: cur.picks || {}, thirds: cur.thirds || {} };
        newState = next;
        tx.set(ref, { worldcup: next, updatedAt: Date.now() }, { merge: true });
      });
      if (newState) setShared(s => ({ ...s, worldcup: newState }));
    } catch (e) {
      console.warn('setWorldcupResult failed', e);
      throw e;
    }
  };

  // Mod define qual 3º colocado vai em cada vaga "3A/B/C/D/F" da R32 (pra bater
  // com a tabela oficial da FIFA). worldcup.thirds = { slot: letraDoGrupo }.
  // group vazio/null = volta pro automático.
  const setWorldcupThird = async (slot, group) => {
    if (!isAdmin || !slot) return;
    const ref = BET_DOC();
    let newState = null;
    try {
      await window.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const cur = (snap.exists && snap.data().worldcup && typeof snap.data().worldcup === 'object')
          ? snap.data().worldcup : { results: {}, picks: {} };
        const thirds = { ...(cur.thirds || {}) };
        // tira o grupo de qualquer outra vaga (cada 3º só em um lugar)
        if (group) for (const s in thirds) if (thirds[s] === group) delete thirds[s];
        if (group) thirds[slot] = group; else delete thirds[slot];
        const next = { results: cur.results || {}, picks: cur.picks || {}, thirds };
        newState = next;
        tx.set(ref, { worldcup: next, updatedAt: Date.now() }, { merge: true });
      });
      if (newState) setShared(s => ({ ...s, worldcup: newState }));
    } catch (e) {
      console.warn('setWorldcupThird failed', e);
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
  // M4: lança placar da FIFA direto de JOGOS (mesmo caminho do patchMatch da
  // classificação) — setCs dispara write-back + auto-settle. ri/gi do jogo.
  const setFifaScore = (ri, gi, patch) => {
    setCs(prev => {
      if (!prev || !Array.isArray(prev.rounds)) return prev;
      const rounds = prev.rounds.map((r, rIdx) => rIdx !== ri ? r : r.map((m, mIdx) => mIdx === gi ? { ...m, ...patch } : m));
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
        // Valida que a conquista eh elegivel pra esse user (anti-burlar).
        // cs/worldcup/interests/comments/mk vem do closure (top-level, fora do json).
        if (titleId) {
          const earned = titlesForNick(nick, {
            bets: remote.bets || [],
            users: remote.users || {},
            teamPlayers: remote.teamPlayers || {},
            cs, worldcup, interests,
            comments: comments || {},
            mk: { draw: mkDraw, scores: mkScores },
          });
          if (!earned.some(t => t.id === titleId)) return null;
        }
        const users = { ...remote.users, [nick]: { ...u, title: titleId || null } };
        return { ...remote, users };
      });
    } catch (e) { console.warn('setSelectedTitle failed', e); }
  };

  // PERSONALIZAÇÃO: salva o TEMA (id) escolhido pelo jogador. Aplica na hora
  // (otimista) + mirror no localStorage (boot sem flash) e persiste em
  // users[nick].theme. id inválido => volta pro padrão.
  const setUserTheme = async (themeId) => {
    const clean = pvThemeById(themeId) ? themeId : DEFAULT_THEME;
    applyThemeValue(clean);
    saveThemeLS(clean);
    if (!session || !session.nick) return;
    const nick = session.nick;
    try {
      await commitBetDocUpdate(remote => {
        const u = (remote.users || {})[nick];
        if (!u) return null;
        return { ...remote, users: { ...remote.users, [nick]: { ...u, theme: clean } } };
      });
    } catch (e) { console.warn('setUserTheme failed', e); }
  };

  // Avatar custom: upload (comprime + grava) e remover. Bumpa avatarsRev pro
  // re-render imediato (além do listener). Só pro próprio user logado.
  const uploadAvatar = async (srcDataUrl) => {
    if (!session || !session.nick) return { err: 'precisa logar' };
    const r = await setAvatarImage(session.nick, srcDataUrl);
    setAvatarsRev(x => x + 1);
    return r;
  };
  const removeAvatar = async () => {
    if (!session || !session.nick) return;
    await clearAvatarImage(session.nick);
    setAvatarsRev(x => x + 1);
  };

  // Aplica o tema do PRÓPRIO user quando o registro carrega/muda (sincroniza
  // entre dispositivos). Tolera valor legado (hex accent) via applyThemeValue.
  // Mantém o localStorage alinhado pro próximo boot. Se o user NÃO tem tema,
  // RESETA pro padrão do SO e limpa o mirror — senão o tema do usuário anterior
  // "vaza" pro próximo no mesmo navegador (logout/login sem reload).
  useEffect(() => {
    if (!me) return; // deslogado: deixa o tema do boot/SO como está
    if (me.theme) { applyThemeValue(me.theme); saveThemeLS(me.theme); }
    else { applyThemeValue(osDefaultThemeId()); saveThemeLS(null); }
  }, [me && me.theme]);

  // Contexto ÚNICO das conquistas (score/CC/drops/latch). Inclui TUDO que algum
  // predicado ACH pode olhar: bets/users/teamPlayers/cs/worldcup/interests +
  // comments (comentarista) + mk { draw, scores } (campeão/flawless do MK).
  const ccCtx = useMemo(() => ({
    bets, users, teamPlayers, cs, worldcup, interests,
    comments: comments || {},
    mk: { draw: mkDraw, scores: mkScores },
  }), [bets, users, teamPlayers, cs, worldcup, interests, comments, mkDraw, mkScores]);

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
  // Trava: quem JÁ JOGOU uma rodada (confronto concluído) não pode mais trocar.
  const setMkChars = async (targetNick, chars) => {
    if (!targetNick) return { err: 'sem jogador' };
    const clean = (Array.isArray(chars) ? chars : []).filter(c => MK_CHARACTERS.includes(c)).slice(0, MK_MAX_CHARS);
    try {
      const res = await commitBetDocUpdate(remote => {
        const u = (remote.users || {})[targetNick];
        if (!u) return null;
        // Trava por FASE (fonte da verdade no doc): travado se já jogou na fase
        // atual. Na virada IDA->VOLTA o elenco libera de novo (até jogar a 1ª da volta).
        const mk = remote.mk || {};
        const draw = Array.isArray(mk.draw) ? mk.draw : [];
        const scores = mk.scores || {};
        if (mkRosterLockedFor(targetNick, draw, scores)) {
          const ph = mkCurrentPhase(draw, scores);
          return { __abort: true, result: { err: 'Elenco travado: você já jogou na ' + ph + '.' } };
        }
        return { ...remote, users: { ...remote.users, [targetNick]: { ...u, mkChars: clean } } };
      });
      return res || { ok: true };
    } catch (e) { console.warn('setMkChars failed', e); return { err: 'falha ao salvar' }; }
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
          const ctx = {
            bets: remote.bets || [], users: remote.users || {},
            teamPlayers: remote.teamPlayers || {}, cs, worldcup, interests,
            comments: comments || {}, mk: { draw: mkDraw, scores: mkScores },
          };
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
    const inv = effectiveInventory(session.nick, me, ccCtx);
    ['frame', 'badge'].forEach(slot => {
      const eq = me.cosmetics[slot];
      if (eq && !inv.includes(eq)) {
        console.warn('auto-cleanup: desequipando cosmetico invalido', slot, eq);
        equipItem(slot, null);
      }
    });
  }, [me, ccCtx, session]);

  // BÔNUS POR RODADA: dispara o crédito quando alguma rodada nova fica completa.
  // Só os MODS rodam (são quem lança placar — sempre tem um online ao fechar a
  // rodada); a transação é idempotente, então 2 mods juntos não duplicam. Roda
  // no mount (pega rodadas já completas = retroativo) e a cada placar novo.
  useEffect(() => {
    if (!isMod) return;
    creditRoundBonus();
  }, [isMod, cs, mkDraw, mkScores]);

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
    const ctx = ccCtx;
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
  }, [me, ccCtx, session]);

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
  const mkInscrito = !!(interests && interests.mk && session && interests.mk[session.nick] && !mkIsWithdrawn(session.nick));
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
        isMod={isMod}
        onLogout={logout}
        view={view}
        onView={setView}
        teamPlayers={teamPlayers || {}}
        myCosmetics={me?.cosmetics || {}}
      />
      {officialDay && officialDay.active && (
        <div className="official-day-banner">
          <Icon name="coin-fire" size={16} /> <strong>DIA OFICIAL</strong> — toda aposta vencedora paga <strong>+25%</strong> de Primitivo Coins enquanto durar.
        </div>
      )}
      {/* Sidebar esquerda de perfil REMOVIDA — o perfil mora na aba MEU PERFIL
          (à direita do DISCORD). Conteúdo ocupa a largura toda. */}
      <div className="below-topbar">
        <div className="content-area">
          <div className={'page' + (view === 'campeonatos' || view === 'apostas' ? ' page--wide' : '')}>
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
                onSetThird={setWorldcupThird}
              />
            )}
            {view === 'hall' && (
              <HallView cs={cs} users={users} teamPlayers={teamPlayers || {}} worldcup={worldcup} wcFixtures={wcData.matches} myNick={session.nick} bets={bets} ctx={ccCtx} subTab={hallTab} setSubTab={setHallTab} />
            )}
            {/* APOSTAS — só apostar. SEMPRE num campeonato ATIVO (apostasChampId);
                se o selecionado for "em breve", cai pro ativo sem perder a
                seleção do CAMPEONATOS. Inscrição em "em breve" é na aba
                CAMPEONATOS (e o cancelamento no MEU PERFIL). */}
            {view === 'apostas' && (
              <>
              {/* LANÇAR RESULTADOS (só mod). No MK o lançamento fica DENTRO de cada
                  card travado (ver MkBettingView); aqui só pra FIFA/ligas legadas. */}
              {isMod && apostasChampId !== 'mk' && (
                <ResultLauncherPanel champId={apostasChampId}
                  mkDraw={mkDraw} mkScores={mkScores} mkLineups={mkLineups} onMkScore={setMkScoreField}
                  cs={cs} onFifaScore={setFifaScore} teamPlayers={teamPlayers || {}} />
              )}
              {/* MESA DOS CARTOLAS (M9): tickets abertos pra copiar com cashback. */}
              {!isAdmin && (
                <OpenTicketsFeed bets={bets} users={users} teamPlayers={teamPlayers || {}} gamesById={gamesById}
                  myNick={session.nick} champId={apostasChampId} balance={me ? me.pc : 0} onCopy={copyOpenTicket} />
              )}
              <div className="champ-layout champ-layout--apostas">
                {/* ESQUERDA: onde apostar + MEUS TICKETS resuminho. */}
                <div className="apostas-leftcol">
                  <ChampSidebar value={apostasChampId} onChange={setChampionship} cs={cs} interests={interests || {}} mode="apostas" />
                  {/* MEUS TICKETS sobem; MEU JOGO desce (ordem pedida). */}
                  {!isAdmin && (
                    <TicketsMini bets={(bets || []).filter(b => b.user === session.nick && ((b.champId || 'fifa') === apostasChampId || (apostasChampId === 'mk' && b.champId === 'mkko')))} limit={6} onOpen={() => setView('tickets')} />
                  )}
                  {/* MEU JOGO (mini): escalar abre só ao clicar VER MEUS JOGOS (M3). */}
                  {apostasChampId === 'mk' && mkInscrito && (
                    <MeuJogoMini
                      nick={session.nick} users={users} interests={interests || {}}
                      draw={mkDraw} scores={mkScores} lineups={mkLineups} teamPlayers={teamPlayers || {}}
                      onOpen={() => setMeuJogoOpen(true)} ko={mkKo}
                    />
                  )}
                </div>
                {/* CENTRO: a box de apostar grande (grid com todos os confrontos). */}
                <div className="champ-main">
                  {(apostasChampId === 'mk') ? (
                    // APOSTAS do MK (valendo PC). MK é ativo — todo mundo aposta aqui.
                    <>
                      <ChampHeader value={apostasChampId} onChange={setChampionship} interests={interests || {}} bare activeOnly />
                  <MkBettingView
                    players={mkInscritos(interests)}
                    users={users}
                    teamPlayers={teamPlayers || {}}
                    draw={mkDraw}
                    scores={mkScores}
                    lineups={mkLineups}
                    bets={(bets || []).filter(b => b.champId === 'mk')}
                    onPlaceBet={placeMkBet}
                    onRemoveBet={removeMkBet}
                    onSetGameLock={setMkScoreField}
                    onMkScore={setMkScoreField}
                    onOpenProfile={setProfileNick}
                    onEscalar={() => setMeuJogoOpen(true)}
                    myNick={session.nick}
                    isAdmin={isAdmin} isMod={isMod}
                    balance={me?.pc ?? 0}
                    ko={mkKo} onKoBet={placeKoBet}
                  />
                </>
              ) : (
                <ApostarView
                  games={games} gamesById={gamesById} bets={bets} me={me} session={session} users={users}
                  slip={slip} onToggleLeg={toggleLeg} onRemoveLeg={removeLeg}
                  onClearSlip={clearSlip} onPlaceBet={placeBet} isAdmin={isAdmin} canLock={isMod}
                  slipPruneMsg={slipPruneMsg}
                  onToggleLock={toggleGameLock} onSetScore={setFifaScore}
                  championship={apostasChampId} setChampionship={setChampionship}
                  interests={interests || {}}
                  teamPlayers={teamPlayers || {}}
                />
                  )}
                </div>
                {/* DIREITA: RANKING DE APOSTAS (compacto) do campeonato atual, por LUCRO.
                    A CLASSIFICAÇÃO do campeonato em si mora em CAMPEONATOS. */}
                <aside className="apostas-rankcol">
                  <RankingView users={users} bets={bets} me={session.nick}
                    teamPlayers={teamPlayers || {}} cs={cs} lockChamp={apostasChampId} compact onOpenBetProfile={setBetProfileNick} />
                </aside>
              </div>
              </>
            )}

            {/* CAMPEONATOS — classificação do campeonato selecionado. */}
            {view === 'campeonatos' && (
              <div className={'champ-layout champ-layout--camp' + (champRailOpen ? '' : ' rail-collapsed')}>
                {/* lista de CAMPEONATOS oculta por padrão — abre na seta. */}
                {champRailOpen && (
                  <ChampSidebar value={championship} onChange={pickChampionship} cs={cs} interests={interests || {}} mode="campeonatos" />
                )}
                <div className="champ-main">
                  <button type="button" className="champ-rail-toggle" onClick={toggleChampRail}
                          title={champRailOpen ? 'Esconder lista de campeonatos' : 'Ver outros campeonatos'}>
                    <Icon name={champRailOpen ? 'x' : 'menu'} size={13} /> {champRailOpen ? 'ESCONDER LISTA' : 'OUTROS CAMPEONATOS'}
                  </button>
                  <ChampHeader value={championship} onChange={pickChampionship} interests={interests || {}} bare />
                  {active.id === 'mk' ? (
                    // MK: CLASSIFICACAO (centro) + RODADAS (direita), grid de 2 colunas.
                    <MkChampionshipView
                      players={mkInscritos(interests)}
                      users={users}
                      teamPlayers={teamPlayers || {}}
                      draw={mkDraw} onPublishDraw={publishMkDraw}
                      scores={mkScores} onScore={setMkScoreField} lineups={mkLineups}
                      isAdmin={false} isMod={false} locked={mkLocked} myNick={session.nick}
                      ko={mkKo} onKoLineup={setMkKoLineup} onKoBet={placeKoBet} balance={me?.pc ?? 0}
                    />
                  ) : active.id === 'gwyf' ? (
                    // GOLF: CLASSIFICAÇÃO + RODADAS (mapas), igual ao MK. Pré-lançamento
                    // (segue 'soon' — não vira apostável; inscrições seguem abertas).
                    <GolfView
                      interests={interests || {}}
                      teamPlayers={teamPlayers || {}}
                      session={session}
                      onToggleInterest={() => toggleInterest('gwyf')}
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
                    <ClassificacaoView cs={cs} setCs={setCs} isAdmin={false}
                                       users={users} teamPlayers={teamPlayers || {}} myNick={session.nick} />
                  )}
                  {/* Mobile-only: MEU JOGO mini (no desktop ele vai embaixo do MEU PERFIL). */}
                  {active.id === 'mk' && (isAdmin || mkInscrito) && (
                    <div className="mj-mini-m">
                      <MeuJogoMini
                        nick={session.nick} users={users} interests={interests || {}}
                        draw={mkDraw} scores={mkScores} lineups={mkLineups} teamPlayers={teamPlayers || {}}
                        onOpen={() => setMeuJogoOpen(true)} ko={mkKo}
                      />
                    </div>
                  )}
                  {/* M8b: campeonatos lançados pelo admin (liga round-robin) — só leitura. */}
                  {Object.keys(champs || {}).length > 0 && (
                    <div className="champ-launched">
                      <div className="champ-launched-h"><Icon name="trophy" size={14} /> CAMPEONATOS LANÇADOS</div>
                      {Object.values(champs).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(c => (
                        <ChampLeagueView key={c.id} champ={c} teamPlayers={teamPlayers || {}} editable={false} />
                      ))}
                    </div>
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
                mkDraw={mkDraw} mkScores={mkScores} mkLineups={mkLineups}
                ctx={ccCtx}
                onSeeRanking={seeRanking}
                theme={me?.theme || null}
                onSetTheme={setUserTheme}
                currentAvatar={avatarFor(session.nick)}
                onUploadAvatar={uploadAvatar}
                onRemoveAvatar={removeAvatar}
                isNaturalMod={isNaturalMod} modDisabled={modDisabled} onToggleMod={toggleModView}
              />
            )}
            {view === 'estatisticas' && (
              <EstatisticasView
                nick={session.nick} users={users} cs={cs} bets={bets}
                teamPlayers={teamPlayers || {}} worldcup={worldcup}
                mkDraw={mkDraw} mkScores={mkScores} mkLineups={mkLineups} interests={interests || {}}
                comments={comments || {}}
              />
            )}
            {view === 'tickets' && (
              <TicketsView bets={bets.filter(b => b.user === session.nick)} gamesById={gamesById} cs={cs} mkScores={mkScores} mkLineups={mkLineups} mkKo={mkKo} teamPlayers={teamPlayers || {}} onCancel={cancelBet} onGoApostas={() => setView('apostas')} />
            )}
            {view === 'ranking' && (
              <RankingView users={users} bets={bets} me={session.nick} teamPlayers={teamPlayers || {}} cs={cs} onOpenBetProfile={setBetProfileNick} />
            )}
            {view === 'meujogo' && (
              <MeuJogoView
                nick={session.nick} isAdmin={isAdmin} users={users} interests={interests || {}} onSave={setMkChars}
                draw={mkDraw} scores={mkScores} lineups={mkLineups} onSlot={setMkLineupSlot}
                teamPlayers={teamPlayers || {}} ko={mkKo} onKoLineup={setMkKoLineup}
              />
            )}
            {view === 'loja' && (
              <LojaView
                nick={session.nick}
                me={me}
                ctx={ccCtx}
                onBuy={buyItem}
                onEquip={equipItem}
              />
            )}
            {view === 'mod' && isMod && (
              <>
                <ModView officialDay={officialDay} onSetOfficialDay={setOfficialDay} myNick={session.nick} />
                {/* LANÇAR / CORRIGIR PLACAR — campeonatos é view-only; a edição (incl. correção
                    de jogos já lançados) vive aqui. Reusa os mesmos editores, agora editáveis. */}
                <div className="mk-admin-note" style={{ margin: '18px 0 10px' }}><Icon name="football" size={12} /> LANÇAR / CORRIGIR PLACAR — o dia-a-dia é em JOGOS (trava + caixinhas); aqui dá pra editar qualquer jogo, inclusive corrigir os já lançados.</div>
                <MkChampionshipView
                  players={mkInscritos(interests)} users={users} teamPlayers={teamPlayers || {}}
                  draw={mkDraw} onPublishDraw={publishMkDraw}
                  scores={mkScores} onScore={setMkScoreField} lineups={mkLineups}
                  isAdmin={isAdmin} isMod={isMod} locked={mkLocked} myNick={session.nick} launchOnly
                  ko={mkKo} onPublishKo={publishMkKo} onResetKo={resetMkKo} onKoGame={setMkKoGame} onKoField={setMkKoField}
                />
                <div style={{ height: 18 }} />
                <ClassificacaoView cs={cs} setCs={setCs} isAdmin={isMod}
                                   users={users} teamPlayers={teamPlayers || {}} myNick={session.nick} />
                {/* M8b: criar/gerir campeonatos lançados (liga round-robin + placar). */}
                <ChampAdminPanel champs={champs} users={users} interests={interests || {}}
                                 isFullAdmin={isAdmin} teamPlayers={teamPlayers || {}}
                                 onCreate={createChampionship} onScore={setChampScore}
                                 onMatchScore={setChampMatch} onGenKnockout={generateChampKnockout}
                                 onDelete={deleteChampionship} />
                {/* TODAS as funções de admin agora vivem aqui (aba ADMIN removida). */}
                <div style={{ height: 18 }} />
                <AdminView
                  isFullAdmin={isAdmin}
                  bets={bets} users={users} adjustPc={adjustPc} adjustCc={adjustCc}
                  grantAllPc={grantAllPc}
                  splitCurrency={splitCurrency} ccCtx={ccCtx}
                  teamPlayers={teamPlayers || {}} setTeamPlayer={setTeamPlayer}
                  discordWebhook={discordWebhook} remoteNews={remoteNews}
                  cs={cs} onVoidBet={adminVoidBet}
                  worldcup={worldcup} wcFixtures={wcData.matches}
                />
              </>
            )}
            </ViewBoundary>
          </div>
        </div>
      </div>
      {sharedSlip && (
        <SharedSlipModal
          slip={sharedSlip}
          gamesById={gamesById}
          teamPlayers={teamPlayers || {}}
          onClose={() => setSharedSlip(null)}
          onUse={(legs) => {
            setSlip(legs);
            setView('apostas');
            showToast(`${legs.length} palpite${legs.length === 1 ? '' : 's'} adicionado${legs.length === 1 ? '' : 's'} ao seu cupom`, 'success');
          }}
        />
      )}
      {profileNick && (
        <PlayerProfileModal nick={profileNick} users={users} cs={cs} bets={bets} teamPlayers={teamPlayers || {}}
          mkDraw={mkDraw} mkScores={mkScores} mkLineups={mkLineups} onClose={() => setProfileNick(null)} />
      )}
      {betProfileNick && (
        <BetProfileModal nick={betProfileNick} users={users} bets={bets} cs={cs} teamPlayers={teamPlayers || {}} onClose={() => setBetProfileNick(null)} />
      )}
      {meuJogoOpen && (
        <div className="mj-modal-backdrop" onClick={() => setMeuJogoOpen(false)}>
          <div className="mj-modal" onClick={e => e.stopPropagation()}>
            <button className="mj-modal-close" type="button" aria-label="Fechar" onClick={() => setMeuJogoOpen(false)}><Icon name="x" size={18} /></button>
            <MeuJogoView
              nick={session.nick} isAdmin={isAdmin} users={users} interests={interests || {}} onSave={setMkChars}
              draw={mkDraw} scores={mkScores} lineups={mkLineups} onSlot={setMkLineupSlot}
              teamPlayers={teamPlayers || {}} ko={mkKo} onKoLineup={setMkKoLineup}
            />
          </div>
        </div>
      )}
      <ToastHost />
      <UpdateBanner />
      <ConfirmHost />
    </>
  );
}

// ─── TOP BAR / TABS ─────────────────────────────────────────────────────────
function TopBar({ nick, pc, cc, isAdmin, isMod, onLogout, view, onView, teamPlayers, myCosmetics }) {
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
          <div className="t2">TEMPORADA 2026</div>
        </div>
      </div>
      <nav className="primary-nav" aria-label="Navegação principal">
        <button className={'pnav ' + (view === 'apostas' ? 'active' : '')} onClick={() => onView && onView('apostas')}>APOSTAS/JOGOS</button>
        <button className={'pnav ' + (view === 'campeonatos' ? 'active' : '')} onClick={() => onView && onView('campeonatos')}>CAMPEONATOS</button>
        <button className={'pnav ' + (view === 'copa' ? 'active' : '')} onClick={() => onView && onView('copa')}>COPA DO MUNDO</button>
        <button className={'pnav ' + (view === 'estatisticas' ? 'active' : '')} onClick={() => onView && onView('estatisticas')}>ESTATÍSTICAS</button>
        {!HIDDEN_VIEWS.has('hall') && <button className={'pnav ' + (view === 'hall' ? 'active' : '')} onClick={() => onView && onView('hall')}>VITRINE</button>}
        {!HIDDEN_VIEWS.has('inicio') && <button className={'pnav ' + (view === 'inicio' ? 'active' : '')} onClick={() => onView && onView('inicio')}>NEWS</button>}
        {!HIDDEN_VIEWS.has('loja') && <button className={'pnav ' + (view === 'loja' ? 'active' : '')} onClick={() => onView && onView('loja')}>MERCADINHO</button>}
        <button className="pnav pnav-ext" onClick={goDiscord} title="Abre em nova aba">
          DISCORD <span className="pnav-ext-icon"><Icon name="arrow-up-right" size={12} /></span>
        </button>
        <button className={'pnav ' + (view === 'perfil' ? 'active' : '')} onClick={() => onView && onView('perfil')}>MEU PERFIL</button>
        {isMod && <button className={'pnav ' + (view === 'mod' ? 'active' : '')} onClick={() => onView && onView('mod')}>MOD</button>}
      </nav>
      <div className="wallet">
        {!isAdmin && (
          <button type="button" className="pc-pill" onClick={() => onView && onView('tickets')} title="Ver meus tickets">
            <span className="pc-coin-ic"><Icon name="pcoin" size={26} /></span>
            <span className="pc-info">
              <span className="pc-amt">{Number(pc || 0).toLocaleString('pt-BR')}</span>
              <span className="pc-unit">PRIMITIVO COINS</span>
            </span>
            <span className="pc-go" aria-hidden="true"><Icon name="ticket" size={13} /></span>
          </button>
        )}
        {!isAdmin && !HIDE_CC && (
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
          {!isAdmin && <Avatar nick={nick} teamPlayers={teamPlayers} cosmetics={myCosmetics} size={32} />}
          {isAdmin && <span className="nick-tag" style={{ color: 'var(--pv-orange)', borderColor: 'var(--pv-orange)' }}>ADMIN</span>}
          <span className={isAdmin ? 'nick-tag' : 'nick-name'}>{nick}</span>
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
        <span className="champ-header-id">{champShort(active)}</span>
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
                    <span className="csi-name">{champShort(c)}</span>
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
            const sub = g === 'closed' ? 'encerrado' : g === 'soon' ? (count > 0 ? count + ' inscritos' : 'em breve') : 'em andamento';
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
                <span className="champ-item-ic" style={{ background: CHAMP_ICON[c.id] ? 'var(--pv-bone)' : th.color }}><ChampIcon champId={c.id} size={22} /></span>
                <span className="champ-item-body">
                  <span className="champ-item-name">{champShort(c)}</span>
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

// ─── GOLF WITH YOUR FRIENDS — PREVIEW / PRÉ-LANÇAMENTO ───────────────────────
// Formato "stroke play coletivo": cada rodada é um MAPA; no dia, todos os
// inscritos entram no MESMO mapa e jogam juntos; cada mapa tem classificação
// própria. Ainda é PREVIEW — dá pra se inscrever; o oficial só começa quando o
// Mortal Kombat acabar. Aqui só mora a apresentação (regras + calendário); o
// motor de pontuação real entra quando o campeonato virar 'active'.
const GWYF_MAX_STROKES = 12; // teto de tacadas por mapa (não-completou conta o teto)
const GWYF_SCHEDULE = [
  { n: 1, map: 'Beginners Burrow',      kind: 'named'  },
  { n: 2, map: 'Cecky Golf #11',        kind: 'named'  },
  { n: 3, map: 'Mapa aleatório',        kind: 'random' },
  { n: 4, map: 'Mapa aleatório',        kind: 'random' },
  { n: 5, map: 'Trickster Castle',      kind: 'named'  },
  { n: 6, map: 'Paradox Pines',         kind: 'named'  },
  { n: 7, map: 'Mapa aleatório',        kind: 'random' },
  { n: 8, map: 'Super Stuger World DX', kind: 'named'  },
  { n: 9, map: 'Trickshotopia',         kind: 'named'  },
];
// Os mapas FIXOS ficam OCULTOS (surpresa) — só revelamos que é fixo ou aleatório,
// nunca o nome. (O nome real segue no schedule pro dia do jogo.)
const gwyfMapLabel = (r) => (r && r.kind === 'random') ? 'Mapa aleatório' : 'Mapa oculto';

// Banner de pré-lançamento + inscrição (topo da GolfView). A inscrição é o mesmo
// toggle dos campeonatos "em breve" (campo TOP-LEVEL interests.gwyf, fora do json).
function GolfBanner({ accent, interested, count, onToggleInterest }) {
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const click = async () => {
    if (busy) return;
    setBusy(true); setErrMsg('');
    try { await onToggleInterest(); }
    catch (e) { setErrMsg('Não consegui registrar. Tenta de novo em alguns segundos.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="golf-banner" style={{ '--golf': accent }}>
      <div className="golf-banner-main">
        <span className="golf-banner-tag"><Icon name="flag" size={12} /> PRÉ-LANÇAMENTO</span>
        <div className="golf-banner-tt">GOLF WITH YOUR FRIENDS</div>
        <p className="golf-banner-sub">Inscrições <b>abertas</b> — abaixo já dá pra ver a classificação e as rodadas. A temporada oficial começa quando o <b>Mortal Kombat</b> acabar.</p>
      </div>
      <div className="golf-banner-side">
        {interested ? (
          <>
            <span className="golf-insc-ok"><Icon name="check" size={13} /> INSCRITO</span>
            <button className="golf-btn golf-btn-out" onClick={click} disabled={busy}>{busy ? 'AGUARDE…' : 'CANCELAR'}</button>
          </>
        ) : (
          <button className="golf-btn" onClick={click} disabled={busy}>{busy ? 'AGUARDE…' : 'QUERO PARTICIPAR'}</button>
        )}
        <span className="golf-insc-count">{count} {count === 1 ? 'INSCRITO' : 'INSCRITOS'}</span>
        {errMsg && <span className="golf-insc-err"><Icon name="x" size={12} /> {errMsg}</span>}
      </div>
    </div>
  );
}

// View do GOLF — espelha o MK: CLASSIFICAÇÃO (esquerda) + RODADAS/CALENDÁRIO
// (direita), em grid de 2 colunas. Ainda é pré-lançamento: sem resultados, a
// classificação lista os inscritos zerados e as 9 rodadas ficam "AGUARDANDO".
// Mantém o campeonato como 'soon' (não vira apostável) — o motor de pontuação
// (lançar tacadas por mapa) entra quando o golf virar 'active', depois do MK.
function GolfView({ interests, teamPlayers, session, onToggleInterest }) {
  const accent = tabloidTheme('gwyf').color;
  const [selMap, setSelMap] = useState(0); // rodada/mapa selecionado (índice no GWYF_SCHEDULE)
  const reg = (interests && interests.gwyf) || {};
  const inscritos = Object.keys(reg).sort();
  const interested = !!(session && reg[session.nick]);
  // Sem resultados ainda: todos zerados, ordem alfabética.
  const rows = inscritos.map((nick, i) => ({ pos: i + 1, nick, pts: 0, tac: null, wins: 0 }));
  const accIco = { color: accent, display: 'inline-flex', flexShrink: 0 };
  return (
    <div className="mk-champ golf-champ" style={{ '--golf': accent }}>
      <GolfBanner accent={accent} interested={interested} count={inscritos.length} onToggleInterest={onToggleInterest} />
      <div className="grid mk-grid">

        {/* CLASSIFICAÇÃO GERAL */}
        <div className="card mk-card">
          <div className="card-head">
            <div className="title"><span style={accIco}><Icon name="flag" size={16} /></span> CLASSIFICAÇÃO GERAL</div>
            <div className="sub">{inscritos.length} INSCRITOS · {GWYF_SCHEDULE.length} RODADAS</div>
          </div>
          <div className="card-body">
            <div className="mk-admin-note" style={{ width: '100%', marginBottom: 12 }}><span style={accIco}><Icon name="flag" size={12} /></span> Classificação geral — soma os pontos de cada mapa. Ainda sem resultados (pré-lançamento).</div>
            {inscritos.length === 0 ? (
              <div className="empty"><div className="e1">SEM INSCRITOS</div><div className="e2">Ninguém inscrito no golfe ainda. Seja o primeiro no botão acima.</div></div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="std-table">
                  <thead>
                    <tr><th>#</th><th style={{ textAlign: 'left' }}>JOGADOR</th><th>PTS</th><th>TAC</th><th>V</th></tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.nick}>
                        <td className="std-pos">{String(r.pos).padStart(2, '0')}</td>
                        <td>
                          <div className="tnm" style={{ flexWrap: 'wrap' }}>
                            <Avatar nick={r.nick} teamPlayers={teamPlayers} size={24} />
                            <span>{r.nick}</span>
                            {r.nick === session.nick && <span className="stats-rail-you">VOCÊ</span>}
                          </div>
                        </td>
                        <td style={{ fontFamily: 'Anton, Impact', fontSize: 16 }}>{r.pts}</td>
                        <td style={{ color: 'rgba(28,22,18,0.45)' }}>{r.tac == null ? '—' : r.tac}</td>
                        <td>{r.wins}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mk-legend">
              <strong>PTS</strong> = pontos somados nos mapas. Em cada mapa, com <strong>N jogadores</strong>: 1º leva <strong>N</strong>, 2º N−1, 3º N−2… e o último 1. O <strong>vencedor do mapa</strong> ganha pontuação extra.
              <br /><strong>TAC</strong> = total de tacadas — desempate, quanto menos melhor. Limite de <strong>{GWYF_MAX_STROKES}</strong> por mapa; quem não completa conta <strong>+{GWYF_MAX_STROKES}</strong>. <strong>V</strong> = mapas vencidos.
            </div>
          </div>
        </div>

        {/* RODADAS / CALENDÁRIO DE MAPAS — clica num mapa pra ver a classificação dele */}
        <aside>
          <div className="card mk-card mk-rodada-card">
            <div className="card-head">
              <div className="title">RODADAS</div>
              <div className="sub">CALENDÁRIO · AGUARDANDO</div>
            </div>
            <div className="card-body">
              <div className="mk-admin-note" style={{ width: '100%', marginBottom: 12 }}><span style={accIco}><Icon name="pin" size={12} /></span> Clica numa rodada pra ver a classificação dela. Os mapas ficam <strong>ocultos</strong> até o dia — <strong>6 fixos + 3 aleatórios</strong>.</div>
              <div className="golf-rtabs" role="tablist" aria-label="Rodadas do golfe">
                {GWYF_SCHEDULE.map((r, i) => (
                  <button
                    key={r.n}
                    type="button"
                    role="tab"
                    aria-selected={i === selMap}
                    className={'golf-rtab' + (r.kind === 'random' ? ' rnd' : '') + (i === selMap ? ' sel' : '')}
                    onClick={() => setSelMap(i)}
                    title={'Rodada ' + String(r.n).padStart(2, '0') + ' · ' + gwyfMapLabel(r)}
                  >
                    <span className="golf-rtab-n">{String(r.n).padStart(2, '0')}</span>
                    <span className="golf-rtab-m">{gwyfMapLabel(r)}</span>
                  </button>
                ))}
              </div>

              {/* CLASSIFICAÇÃO DA RODADA SELECIONADA (zerada — pré-lançamento) */}
              <div className="golf-map-class">
                <div className="golf-map-class-h">
                  <span className="golf-map-class-n" style={{ background: GWYF_SCHEDULE[selMap].kind === 'random' ? 'rgba(28,22,18,0.4)' : accent }}>{String(GWYF_SCHEDULE[selMap].n).padStart(2, '0')}</span>
                  <span className="golf-map-class-tt">
                    <span className="golf-map-class-k">RODADA {String(GWYF_SCHEDULE[selMap].n).padStart(2, '0')} · {GWYF_SCHEDULE[selMap].kind === 'random' ? 'MAPA ALEATÓRIO' : 'MAPA FIXO'}</span>
                    <span className="golf-map-class-m">{gwyfMapLabel(GWYF_SCHEDULE[selMap])}</span>
                  </span>
                  <span className="golf-round-st" style={{ marginLeft: 'auto' }}>AGUARDANDO</span>
                </div>
                {inscritos.length === 0 ? (
                  <div className="empty" style={{ padding: '18px 12px' }}><div className="e1">SEM INSCRITOS</div></div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="std-table">
                      <thead>
                        <tr><th>#</th><th style={{ textAlign: 'left' }}>JOGADOR</th><th>TAC</th><th>PTS</th></tr>
                      </thead>
                      <tbody>
                        {rows.map(r => (
                          <tr key={r.nick}>
                            <td className="std-pos">{String(r.pos).padStart(2, '0')}</td>
                            <td>
                              <div className="tnm">
                                <Avatar nick={r.nick} teamPlayers={teamPlayers} size={22} />
                                <span>{r.nick}</span>
                                {r.nick === session.nick && <span className="stats-rail-you">VOCÊ</span>}
                              </div>
                            </td>
                            <td style={{ color: 'rgba(28,22,18,0.45)' }}>—</td>
                            <td style={{ fontFamily: 'Anton, Impact', fontSize: 15 }}>0</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="mk-legend" style={{ marginTop: 8 }}>Classificação do mapa: <strong>TAC</strong> = total de tacadas (teto {GWYF_MAX_STROKES}); <strong>PTS</strong> = pontos do mapa (menos tacadas = mais pontos). Vazio até o mapa rolar.</div>
              </div>
            </div>
          </div>
        </aside>

      </div>
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
          fontFamily: 'Anton, Impact', fontSize: 48,
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
            {list.map(n => n).join(' · ')}
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
    { id: 'apostas',     label: 'APOSTAS/JOGOS', icon: 'ticket' },
    { id: 'campeonatos', label: 'CAMPEONATOS',   icon: 'chart' },
    { id: 'copa',        label: 'COPA DO MUNDO', icon: 'globe' },
    { id: 'estatisticas',label: 'ESTATÍSTICAS',  icon: 'medal' },
    { id: 'hall',        label: 'VITRINE',       icon: 'trophy' },
    { id: 'inicio',      label: 'NEWS',          icon: 'newspaper' },
    { id: 'loja',        label: 'MERCADINHO',    icon: 'coin' },
  ].filter(it => !HIDDEN_VIEWS.has(it.id)); // esconde VITRINE/NEWS/MERCADINHO por enquanto
  // MEUS TICKETS, RANKING e MEU JOGO foram pra dentro de APOSTAS/CAMPEONATOS;
  // o perfil agora é a sidebar esquerda (clica e abre o completo). Sobra só o
  // PERFIL e o ADMIN no "meu espaço" (usado no menu mobile).
  const globalItems = [
    { id: 'perfil',   label: 'MEU PERFIL',   icon: 'user' },
  ];
  if (isMod) globalItems.push({ id: 'mod', label: 'MOD', icon: 'whistle' });
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

// SIDEBAR ESQUERDA DE PERFIL — resumo do jogador, fixa em todas as abas.
// Avatar grande (clica = abre o perfil completo) + troféus, título, posição no
// campeonato e aproveitamento. Botão ADMIN pra mod. Escondida no mobile (vira
// um cartão no topo via CSS / o menu hamburger cobre a navegação).
function ProfileSidebar({ nick, me, cs, bets, users, teamPlayers, worldcup, interests, mkDraw, mkScores, mkLineups, isAdmin, isMod, setView, showMkMini }) {
  const myTeamId = reverseTeamMap(teamPlayers)[nick];
  const trophyCount = trophiesForNick(nick, cs, teamPlayers).length + betKingChamps(nick, cs, bets).length;
  const titleDef = me && me.title ? getTitleDef(me.title) : null;
  const mkPlayers = mkInscritos(interests);
  const gK = (r, gi) => r.phase + '-' + r.n + '-' + gi;
  const concl = [];
  (mkDraw || []).forEach(r => (r.games || []).forEach((g, gi) => { const sc = (mkScores || {})[gK(r, gi)]; if (sc && mkMatchOutcome(sc)) concl.push({ home: g.home, away: g.away, sc }); }));
  const mkStand = mkPlayers.includes(nick) ? computeMkStandings(mkPlayers, concl) : [];
  const mkPos = mkStand.findIndex(s => s.nick === nick) + 1;
  const myBets = (bets || []).filter(b => b.user === nick);
  const won = myBets.filter(b => b.status === 'won').length, lost = myBets.filter(b => b.status === 'lost').length;
  const aprov = (won + lost) ? Math.round(won / (won + lost) * 100) : 0;
  return (
    <aside className="app-profile" style={{ '--ap-accent': (titleDef && titleDef.color) || '#d76414' }}>
      <button type="button" className="ap-card" onClick={() => setView('perfil')} title="Abrir perfil completo">
        <div className="ap-avatar">
          {myTeamId ? <Avatar teamId={myTeamId} nick={nick} cosmetics={me?.cosmetics} size={94} /> : <div className="ap-avatar-fb">{String(nick).slice(0, 2).toUpperCase()}</div>}
        </div>
        <div className="ap-nick">{nick}</div>
        <div className="ap-title">{titleDef ? <><Icon name={titleDef.icon} size={11} /> {titleDef.name}</> : (isAdmin ? 'ADMIN' : 'sem conquista')}</div>
      </button>
      <div className="ap-stats">
        <div className="ap-stat"><Icon name="trophy" size={15} /><span className="ap-stat-v">{trophyCount}</span><span className="ap-stat-l">TROFÉUS</span></div>
        <div className="ap-stat"><Icon name="fist" size={15} /><span className="ap-stat-v">{mkPos ? mkPos + 'º' : '—'}</span><span className="ap-stat-l">MK</span></div>
        <div className="ap-stat"><Icon name="target" size={15} /><span className="ap-stat-v">{aprov}%</span><span className="ap-stat-l">APROVEIT.</span></div>
      </div>
      <button type="button" className="ap-link" onClick={() => setView('perfil')}><Icon name="user" size={13} /> PERFIL COMPLETO</button>
      {isMod && <button type="button" className="ap-admin" onClick={() => setView('admin')}><Icon name="shield" size={13} /> ADMIN</button>}
      {showMkMini && (
        <MeuJogoMini
          nick={nick} users={users} interests={interests || {}}
          draw={mkDraw} scores={mkScores} lineups={mkLineups} teamPlayers={teamPlayers || {}}
          onOpen={() => setView('meujogo')}
        />
      )}
    </aside>
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
function Icon({ name, size = 20, strokeWidth, className = '' }) {
  const s = size;
  // Stroke adaptativo: em ícones pequenos (chips/tags, ≤14px) o traço 1.8
  // some na renderização — engrossa pra manter legível. Quem passa
  // strokeWidth explícito continua mandando.
  const sw = strokeWidth != null ? strokeWidth : (s <= 14 ? 2.4 : 1.8);
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
    case 'pcoin':
      // moeda do Primitivão — disco cunhado + anel + estrela central
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="6.3" opacity="0.4" />
          <path d="M12 7.8L12.97 10.67L15.99 10.7L13.57 12.51L14.47 15.4L12 13.65L9.53 15.4L10.43 12.51L8.01 10.7L11.03 10.67Z" fill="currentColor" stroke="none" />
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
    case 'medal-3': // medalha de 3º lugar (bronze) — pódio do mata-mata
      return (
        <svg {...common}>
          <path d="M7 3l3 6M17 3l-3 6M5 3h4l3 6 3-6h4" />
          <circle cx="12" cy="15.5" r="5.5" />
          <text x="12" y="17.8" textAnchor="middle" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="6.5" fontWeight="800" fill="currentColor" stroke="none">3</text>
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
    case 'chess': // peão de xadrez — TFT / tática
      return (
        <svg {...common}>
          <circle cx="12" cy="6" r="2.6" />
          <path d="M9 11h6" strokeLinecap="round" />
          <path d="M10 11c0 2-1.6 3.5-1.6 6h7.2c0-2.5-1.6-4-1.6-6" />
          <path d="M7.3 17h9.4l1.1 3.5H6.2L7.3 17z" />
        </svg>
      );
    case 'pokeball': // pokébola — Pokémon
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h6.4M14.6 12H21" strokeLinecap="round" />
          <circle cx="12" cy="12" r="2.7" />
        </svg>
      );
    case 'cards': // baralho — Magic (card game)
      return (
        <svg {...common}>
          <path d="M6.2 7 12.6 8.8l-2.1 8.7L4.1 15.7 6.2 7z" strokeLinejoin="round" />
          <rect x="10.2" y="5.8" width="8.4" height="12.6" rx="1.6" />
        </svg>
      );
    case 'crab': // caranguejo — Crab Game
      return (
        <svg {...common}>
          <path d="M6.5 13.5a5.5 4 0 0 1 11 0" />
          <path d="M6.5 13.5h11" />
          <circle cx="10" cy="9.9" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="14" cy="9.9" r="0.9" fill="currentColor" stroke="none" />
          <path d="M10 10.3V9M14 10.3V9" strokeLinecap="round" />
          <path d="M6.6 12.6C4 12 3 10.5 3.3 8.8M3.3 8.8l1.6.2M3.3 8.8l.3 1.6" strokeLinejoin="round" />
          <path d="M17.4 12.6C20 12 21 10.5 20.7 8.8M20.7 8.8l-1.6.2M20.7 8.8l-.3 1.6" strokeLinejoin="round" />
          <path d="M8 14.6l-2.6 2.5M16 14.6l2.6 2.5M10 15.2l-1.4 3M14 15.2l1.4 3" strokeLinecap="round" />
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
    // Validação SÓ pra conta NOVA — conta existente loga com o nick que tem
    // (regra nova não pode trancar ninguém pra fora).
    if (isNew) {
      if (!/^[a-z0-9_.-]{2,20}$/.test(trimmedNick)) {
        setMsg('Nick: 2 a 20 caracteres, só letras minúsculas, números, _ . -');
        return;
      }
      if (senha.length < 4) {
        setMsg('Senha muito curta (mínimo 4 caracteres)');
        return;
      }
      if (senha !== senha2) {
        setMsg('As senhas não conferem');
        return;
      }
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
          <div className="login-feature"><span className="lf-ic"><Icon name="coin" size={22} /></span><span>+550 PC/sem</span></div>
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
    id: 'bonus-por-rodada',
    title: 'BÔNUS AGORA É POR RODADA!',
    subtitle: 'Acabou o domingo: cada rodada que fecha pinga +1000 PC pra todo mundo.',
    date: '25/06/2026',
    tag: 'PROMO',
    image: 'news/bonus-semanal.jpg',
    body: (
      <>
        <p>
          O bônus semanal foi <strong>aposentado</strong>. No lugar entra um bônus
          melhor: toda vez que uma <strong>rodada fecha</strong> (a tabela da FIFA
          OU o Mortal Kombat), o cofre pinga <strong>+1000 PC pra cada jogador</strong>,
          automaticamente — sem precisar reclamar nada.
        </p>
        <p>
          Mais rodada acontecendo = mais PC no bolso de todo mundo. Joga que o
          cofre enche sozinho.
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
          <li><Icon name="coin" size={14} /><span>Bônus semanal de <strong>550 PC</strong> (era 20!) — todo domingo 21h BRT</span></li>
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

// Resolve os slots de mata-mata ("1A","2B","3A/B/C") pro nome real do time
// quando a fase de grupos já decidiu. Compartilhado por JOGOS e ENCERRADOS.
function resolveWcFixtures(fixtures, results, thirds) {
  const groups = Array.from(new Set(fixtures.filter(m => !m.isKnockout && m.group).map(m => m.group)));
  const standingsByGroup = {};
  for (const g of groups) standingsByGroup[g] = computeWcGroupStandings(g, fixtures, results);
  // Alocação dos 8 melhores terceiros (slots "3A/B/C/D/F") quando os grupos acabam;
  // `thirds` = overrides do mod (slot -> grupo) pra bater com a tabela oficial.
  const thirdMap = computeWcThirdAssignment(standingsByGroup, fixtures, thirds);
  // Passo 1: resolve slots de grupo (1A/2B) + terceiros.
  const out = fixtures.map(m => {
    if (!m.slotHome && !m.slotAway) return { ...m };
    const next = { ...m };
    if (m.slotHome && m.rawSlotHome) {
      const r = resolveWcSlot(m.rawSlotHome, standingsByGroup) || thirdMap[m.rawSlotHome];
      if (r) { next.home = r.name; next.flagHome = r.flag; next.slotHome = false; next.resolvedHome = true; }
    }
    if (m.slotAway && m.rawSlotAway) {
      const r = resolveWcSlot(m.rawSlotAway, standingsByGroup) || thirdMap[m.rawSlotAway];
      if (r) { next.away = r.name; next.flagAway = r.flag; next.slotAway = false; next.resolvedAway = true; }
    }
    return next;
  });
  // Passo 2: resolve slots W/L (vencedor/perdedor do jogo N) conforme os placares
  // saem — em passadas, pra cobrir a cadeia R32 -> R16 -> quartas -> semi -> final.
  const byId = {};
  out.forEach(m => { byId[m.id] = m; });
  const sideTeam = (m, side) => side === 'home'
    ? { name: m.home, flag: m.flagHome }
    : { name: m.away, flag: m.flagAway };
  const wlResolve = (letter, num) => {
    const mm = byId['wc-' + num];
    if (!mm || mm.slotHome || mm.slotAway) return null; // jogo ainda sem os 2 times
    const r = results[mm.id]; if (!r) return null;
    const gh = parseInt(r.gh, 10), ga = parseInt(r.ga, 10);
    if (Number.isNaN(gh) || Number.isNaN(ga)) return null;
    // empate no tempo normal -> decide pelo placar dos pênaltis (penH/penA)
    const ph = parseInt(r.penH, 10), pa = parseInt(r.penA, 10);
    const homeWon = gh > ga || (gh === ga && ph > pa);
    const awayWon = ga > gh || (gh === ga && pa > ph);
    if (!homeWon && !awayWon) return null; // empate sem pênaltis definidos
    const winSide = homeWon ? 'home' : 'away';
    const loseSide = homeWon ? 'away' : 'home';
    return sideTeam(mm, letter === 'W' ? winSide : loseSide);
  };
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const m of out) {
      if (m.slotHome && m.rawSlotHome) {
        const wl = String(m.rawSlotHome).match(/^([WL])(\d+)$/);
        if (wl) { const r = wlResolve(wl[1], wl[2]); if (r) { m.home = r.name; m.flagHome = r.flag; m.slotHome = false; m.resolvedHome = true; changed = true; } }
      }
      if (m.slotAway && m.rawSlotAway) {
        const wl = String(m.rawSlotAway).match(/^([WL])(\d+)$/);
        if (wl) { const r = wlResolve(wl[1], wl[2]); if (r) { m.away = r.name; m.flagAway = r.flag; m.slotAway = false; m.resolvedAway = true; changed = true; } }
      }
    }
    if (!changed) break;
  }
  return out;
}

function CopaDoMundoView({ session, isAdmin, users, worldcup, fixtures, onSavePick, onSetResult, onSetThird }) {
  const [subTab, setSubTab] = useState('jogos'); // 'jogos' | 'ranking'
  const thirds = worldcup?.thirds || {};
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
          thirds={thirds}
          onSavePick={onSavePick}
          onSetResult={onSetResult}
        />
      )}

      {subTab === 'grupos' && (
        <CopaGrupos fixtures={fixtures || []} results={results} />
      )}

      {subTab === 'bracket' && (
        <CopaBracket fixtures={fixtures || []} results={results} isAdmin={isAdmin} thirds={thirds} onSetResult={onSetResult} onSetThird={onSetThird} />
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

function CopaJogos({ fixtures, results, myPicks, allPicks, myNick, isAdmin, thirds, onSavePick, onSetResult }) {
  // States dos filtros (precisam vir antes de qualquer return)
  const [stageFilter, setStageFilter] = useState('all'); // 'all' | 'group' | 'knockout'
  const [teamFilter, setTeamFilter]   = useState('');     // nome PT do time, '' = todos
  // Relógio de 30s: quando um jogo atinge o horário do pontapé, a trava de
  // palpite engata sozinha na tela, sem precisar recarregar.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => clearInterval(t);
  }, []);
  // Rodada encerrada (todos os jogos com placar) vem MINIMIZADA por padrão, pra
  // abrir a aba já caindo nos jogos que ainda dá pra palpitar. openMap guarda só
  // os toggles manuais do usuário; o resto segue o default por estado da rodada.
  const [openMap, setOpenMap] = useState({});

  // Resolve slots de mata-mata pro nome real quando a fase de grupos decidir.
  const resolvedFixtures = useMemo(() => resolveWcFixtures(fixtures, results, thirds), [fixtures, results, thirds]);

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

  const passaFiltro = (m) => {
    if (stageFilter === 'group'    && m.isKnockout) return false;
    if (stageFilter === 'knockout' && !m.isKnockout) return false;
    if (teamFilter && m.home !== teamFilter && m.away !== teamFilter) return false;
    return true;
  };

  // ESQUERDA = jogos que ainda NÃO foram (sem placar), agrupados por rodada.
  const activeGames = resolvedFixtures.filter(m => !results[m.id] && passaFiltro(m));
  const byRound = activeGames.reduce((acc, m) => {
    (acc[m.round] = acc[m.round] || []).push(m); return acc;
  }, {});
  const presentRounds = WC_STAGE_ORDER.filter(r => byRound[r] && byRound[r].length > 0);
  const extraRounds = Object.keys(byRound).filter(r => !WC_STAGE_ORDER.includes(r));
  const roundKeys = [...presentRounds, ...extraRounds];

  // DIREITA = todos os jogos FINALIZADOS (com placar) num feed só, do mais
  // recente pro mais antigo, sem separador de rodada. Vai ao lado dos jogos.
  const finishedGames = resolvedFixtures
    .filter(m => !!results[m.id] && passaFiltro(m))
    .sort((a, b) => (b.kickoffTs || 0) - (a.kickoffTs || 0));
  const nicks = Object.keys(allPicks || {});

  // Contagem dos chips = jogos ainda EM ABERTO por fase.
  const openGames = resolvedFixtures.filter(m => !results[m.id]);
  const totalAll = openGames.length;
  const totalGroup = openGames.filter(m => !m.isKnockout).length;
  const totalKO = openGames.filter(m => m.isKnockout).length;

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

      <div className="copa-jogos-wrap">
        {/* ESQUERDA: jogos pra palpitar, agrupados por rodada */}
        <div className="copa-jogos-main">
          {roundKeys.length === 0 && (
            <div className="card"><div className="card-body"><div className="empty">
              {openGames.length === 0 && finishedGames.length > 0
                ? <><div className="e1">TUDO ENCERRADO POR AGORA</div><div className="e2">Todos os jogos já têm placar — os resultados e os palpites estão no painel ao lado.</div></>
                : <div className="e2">Nenhum jogo em aberto bate com esse filtro.</div>}
            </div></div></div>
          )}
      {roundKeys.map(rk => {
        const matches = byRound[rk];
        const isKO = matches[0]?.isKnockout;
        const label = translateRound(rk);
        // EM BREVE = rodada de mata-mata ainda indefinida (placeholder); vem
        // minimizada. A rodada atual (com jogo pra palpitar) vem aberta. As
        // rodadas encerradas já saíram daqui (foram pra aba ENCERRADOS).
        const roundFuture = matches.every(m => (m.slotHome || m.slotAway));
        const isOpen = openMap[rk] !== undefined ? openMap[rk] : !roundFuture;
        return (
          <div key={rk} className={'card copa-round-card' + (isOpen ? '' : ' collapsed')}>
            <button type="button" className="card-head copa-round-head" aria-expanded={isOpen} onClick={() => setOpenMap(o => ({ ...o, [rk]: !isOpen }))}>
              <div className="title">{isKO ? '' : 'FASE DE GRUPOS · '}{label}</div>
              <div className="copa-round-meta">
                {roundFuture && <span className="copa-round-badge soon">EM BREVE</span>}
                <span className="sub">{matches.length} JOGO{matches.length === 1 ? '' : 'S'}</span>
                <Icon name={isOpen ? 'caret-up' : 'caret-down'} size={14} className="copa-round-chev" />
              </div>
            </button>
            {isOpen && (
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
                    now={now}
                    onSavePick={onSavePick}
                    onSetResult={onSetResult}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
        </div>

        {/* DIREITA: feed de FINALIZADOS — tudo junto, sem separador de rodada */}
        <aside className="copa-jogos-side">
          <div className="copa-fin-head"><Icon name="check" size={13} /> ENCERRADOS <span className="copa-fin-count">{finishedGames.length}</span></div>
          {finishedGames.length === 0 ? (
            <div className="copa-fin-empty">Nenhum jogo finalizado ainda. Assim que sair o primeiro placar, os palpites da galera aparecem aqui.</div>
          ) : (
            <div className="copa-fin-list">
              {finishedGames.map(m => {
                const r = results[m.id];
                const gp = nicks
                  .map(n => ({ n, p: (allPicks[n] || {})[m.id] }))
                  .filter(x => x.p)
                  .map(x => ({ ...x, pts: scoreWcPick(r, x.p, m.isKnockout) }))
                  .sort((a, b) => b.pts - a.pts || a.n.localeCompare(b.n, 'pt-BR'));
                return (
                  <div key={m.id} className="copa-fin-game">
                    <div className="copa-fin-top">
                      <span className="copa-fin-round">{translateRound(m.round)}</span>
                      <span className="copa-fin-date">{m.date}</span>
                    </div>
                    <div className="copa-fin-teams">
                      <span className="copa-fin-team"><span className="wc-flag"><TeamFlag flag={m.flagHome} /></span><span className="copa-fin-tn">{m.home}</span></span>
                      <span className="copa-fin-score">{r.gh}<span className="copa-enc-x">×</span>{r.ga}</span>
                      <span className="copa-fin-team away"><span className="copa-fin-tn">{m.away}</span><span className="wc-flag"><TeamFlag flag={m.flagAway} /></span></span>
                    </div>
                    <div className="copa-fin-picks">
                      {gp.length === 0
                        ? <span className="copa-enc-nopick">sem palpites</span>
                        : gp.map(({ n, p, pts }) => (
                            <span key={n} className={'copa-enc-pick pts-' + pts + (n === myNick ? ' me' : '')} title={n + ' palpitou ' + p.gh + '×' + p.ga}>
                              <span className="copa-enc-pn">{n}</span>
                              <span className="copa-enc-pp">{p.gh}×{p.ga}</span>
                              <span className="copa-enc-pts">{pts === 3 ? 'EXATO' : pts === 1 ? 'CERTO' : 'ERROU'}</span>
                            </span>
                          ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// Stepper de gols do palpite: botões -/+ grandes (touch) em volta do input,
// que continua digitável. Sem valor ainda, o "+" começa do zero.
function WcScoreStepper({ value, onChange, disabled, teamLabel, placeholder }) {
  const num = value === '' || value == null ? null : Math.max(0, parseInt(value, 10) || 0);
  const step = (d) => {
    if (disabled) return;
    const next = Math.max(0, Math.min(20, (num == null ? 0 : num) + d));
    onChange(String(next));
  };
  return (
    <span className="wc-stepper">
      <button type="button" className="wc-step" onClick={() => step(-1)}
              disabled={disabled || num == null || num <= 0}
              aria-label={'Tirar um gol de ' + teamLabel} tabIndex={-1}>-</button>
      <span className="wc-stepper-mid">
        <input
          className="wc-score-in"
          type="number" min="0" max="20"
          value={value}
          placeholder={placeholder || '–'}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          aria-label={'Palpite gols ' + teamLabel}
        />
        <span className="wc-stepper-team" aria-hidden="true">{String(teamLabel || '').slice(0, 3).toUpperCase()}</span>
      </span>
      <button type="button" className="wc-step wc-step-plus" onClick={() => step(1)}
              disabled={disabled || (num != null && num >= 20)}
              aria-label={'Mais um gol pra ' + teamLabel} tabIndex={-1}>+</button>
    </span>
  );
}

function CopaMatchCard({ match, result, myPick, allPicks, isAdmin, canBet, now, onSavePick, onSetResult }) {
  const closed = !!result; // admin já lançou o placar real -> congela
  // Se algum time é placeholder (mata-mata não decidido), bloqueia palpite
  const isPlaceholder = match.slotHome || match.slotAway;
  // Bola rolando: passou do horário do pontapé e o resultado ainda não saiu.
  // Palpite trava na hora do jogo — sem isso dava pra palpitar vendo o jogo.
  const started = !closed && match.kickoffTs != null && (now || Date.now()) >= match.kickoffTs;
  const [gh, setGh] = useState(myPick ? String(myPick.gh) : '');
  const [ga, setGa] = useState(myPick ? String(myPick.ga) : '');
  const [penGh, setPenGh] = useState(myPick && myPick.penH != null ? String(myPick.penH) : '');
  const [penGa, setPenGa] = useState(myPick && myPick.penA != null ? String(myPick.penA) : '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg]   = useState('');

  // Admin pra setar resultado
  const [adminGh, setAdminGh] = useState(result ? String(result.gh) : '');
  const [adminGa, setAdminGa] = useState(result ? String(result.ga) : '');
  const [adminPenGh, setAdminPenGh] = useState(result && result.penH != null ? String(result.penH) : '');
  const [adminPenGa, setAdminPenGa] = useState(result && result.penA != null ? String(result.penA) : '');
  const [adminBusy, setAdminBusy] = useState(false);

  // Empate num mata-mata -> abre os pênaltis (palpite e resultado)
  const myDrawKO = match.isKnockout && gh !== '' && ga !== '' && gh === ga;
  const adminDrawKO = match.isKnockout && adminGh !== '' && adminGa !== '' && String(adminGh) === String(adminGa);

  const handleSave = async () => {
    if (busy || closed || started || isPlaceholder) return;
    setBusy(true); setMsg('');
    try {
      await onSavePick(match.id, gh, ga, myDrawKO ? penGh : '', myDrawKO ? penGa : '');
      setMsg('palpite salvo');
      setTimeout(() => setMsg(''), 2000);
    } catch (e) {
      const em = e && e.message;
      setMsg(em === 'JOGO_INICIADO' ? 'jogo já começou — travado'
        : em === 'RESULTADO_JA_LANCADO' ? 'placar já saiu — palpite travado'
        : em === 'PALPITE_INVALIDO' ? 'palpite inválido — usa 0 a 20'
        : 'erro — tenta de novo');
    } finally { setBusy(false); }
  };

  const handleSetResult = async () => {
    if (adminBusy) return;
    setAdminBusy(true);
    try { await onSetResult(match.id, adminGh, adminGa, adminDrawKO ? adminPenGh : '', adminDrawKO ? adminPenGa : ''); }
    finally { setAdminBusy(false); }
  };
  const handleClearResult = async () => {
    if (adminBusy) return;
    setAdminBusy(true);
    try {
      await onSetResult(match.id, '', '');
      setAdminGh(''); setAdminGa(''); setAdminPenGh(''); setAdminPenGa('');
    } finally { setAdminBusy(false); }
  };

  // Conta quantos palpitaram nesse jogo
  const pickCount = Object.values(allPicks || {}).reduce(
    (acc, up) => acc + (up && up[match.id] ? 1 : 0), 0
  );

  let myScore = null;
  if (result && myPick) myScore = scoreWcPick(result, myPick, match.isKnockout);

  const tagPrefix = match.isKnockout ? match.roundLabel : `GRUPO ${match.group}`;

  return (
    <div className={'wc-match ' + (closed ? 'closed' : '') + (isPlaceholder ? ' placeholder' : '') + (started ? ' started' : '')}>
      <div className="wc-match-head">
        <span className="wc-tag">{tagPrefix} · {match.date} · {match.time}</span>
        {started
          ? <span className="wc-live-tag"><span className="wc-live-dot" /> BOLA ROLANDO</span>
          : <span className="wc-pickcount">{pickCount} palpite{pickCount === 1 ? '' : 's'}</span>}
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
          <WcScoreStepper
            value={closed ? (myPick ? String(myPick.gh) : '') : gh}
            onChange={setGh}
            disabled={closed || started || !canBet || busy || isPlaceholder}
            teamLabel={match.home}
            placeholder="–"
          />
          <span className="wc-x">×</span>
          <WcScoreStepper
            value={closed ? (myPick ? String(myPick.ga) : '') : ga}
            onChange={setGa}
            disabled={closed || started || !canBet || busy || isPlaceholder}
            teamLabel={match.away}
            placeholder="–"
          />
        </div>
        <div className="wc-team wc-team-away">
          <span className="wc-name">{match.away}</span>
          <span className="wc-flag"><TeamFlag flag={match.flagAway} /></span>
        </div>
      </div>

      {/* Empate no mata-mata: palpite do placar dos PÊNALTIS (placar exato +3 / só quem passou +1) */}
      {myDrawKO && !closed && !started && canBet && !isPlaceholder && (
        <div className="wc-pens-row">
          <span className="wc-pens-l"><Icon name="target" size={11} /> PÊNALTIS</span>
          <input className="wc-score-in wc-pen-in" type="number" min="0" max="20" value={penGh} onChange={e => setPenGh(e.target.value)} placeholder="–" aria-label={'Pênaltis ' + match.home} />
          <span className="wc-x">×</span>
          <input className="wc-score-in wc-pen-in" type="number" min="0" max="20" value={penGa} onChange={e => setPenGa(e.target.value)} placeholder="–" aria-label={'Pênaltis ' + match.away} />
          <span className="wc-pens-hint">+3 exato · +1 só quem passou</span>
        </div>
      )}

      {isPlaceholder && !closed && (
        <div className="wc-placeholder-note">
          Times ainda não definidos — dependem dos resultados das fases anteriores.
        </div>
      )}

      {started && (
        <div className="wc-live-strip">
          <Icon name="lock" size={12} />
          {myPick
            ? <span>Palpites travados — o jogo começou. Seu palpite: <strong>{myPick.gh}×{myPick.ga}</strong>. Aguardando placar final.</span>
            : <span>Palpites travados — o jogo começou e você ficou sem palpitar esse.</span>}
        </div>
      )}

      {closed && (
        <div className="wc-result-strip">
          <span className="wc-result-label">RESULTADO REAL:</span>
          <span className="wc-result-score">{result.gh} × {result.ga}{result.penH != null ? ` (pên ${result.penH}×${result.penA})` : ''}</span>
          {myPick && (
            <span className={'wc-myscore wc-myscore-' + Math.min(myScore, 3)}>
              SEU PALPITE: {myPick.gh}×{myPick.ga}{myPick.penH != null ? ` (pên ${myPick.penH}×${myPick.penA})` : ''} · {myScore} pt{myScore === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}

      {!closed && !started && canBet && !isPlaceholder && (
        <div className="wc-actions">
          <button className="wc-save" onClick={handleSave} disabled={busy || !gh || !ga}>
            {busy ? 'SALVANDO…' : (myPick ? 'ATUALIZAR PALPITE' : 'SALVAR PALPITE')}
          </button>
          {msg && <span className="wc-msg">{msg === 'palpite salvo' && <Icon name="check" size={11} />} {msg}</span>}
        </div>
      )}

      {/* Admin lança placar MESMO em card placeholder: o resultado vale pro
          confronto do slot — sem isso 3º lugar/final/melhores-terceiros nunca
          pontuariam no bolão. */}
      {isAdmin && (
        <div className="wc-admin">
          <span className="wc-admin-label">ADMIN — PLACAR REAL{isPlaceholder ? ' (slot)' : ''}:</span>
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
          {adminDrawKO && (
            <span className="wc-admin-pens">
              <span className="wc-admin-pens-l"><Icon name="target" size={11} /> PÊN</span>
              <input className="wc-score-in wc-admin-in" type="number" min="0" max="20" value={adminPenGh} onChange={e => setAdminPenGh(e.target.value)} placeholder="–" aria-label={'Pênaltis ' + match.home} />
              <span className="wc-x">×</span>
              <input className="wc-score-in wc-admin-in" type="number" min="0" max="20" value={adminPenGa} onChange={e => setAdminPenGa(e.target.value)} placeholder="–" aria-label={'Pênaltis ' + match.away} />
            </span>
          )}
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
                          <td style={{ fontFamily: 'Anton, Impact', fontSize: 16 }}>{t.P}</td>
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
        pts += scoreWcPick(r, p, m.isKnockout); // total (inclui bônus de pênaltis)
        const base = scoreWcPick(r, p); // só o placar do tempo normal (pro tally)
        if (base === 3) exactos++;
        else if (base === 1) certos++;
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
              <div className="wc-rank-nick">{r.nick}</div>
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
          myNick={myNick}
          onClose={() => setOpenNick(null)}
        />
      )}
    </>
  );
}

// Modal que mostra todos os palpites de um jogador da Copa, agrupados por
// fase (grupo / oitavas / quartas / ...). Palpite ALHEIO em jogo que ainda não
// começou fica escondido — senão dava pra copiar o líder antes da bola rolar.
function CopaPicksModal({ nick, picks, fixtures, results, myNick, onClose }) {
  const isMe = nick === myNick;
  const revealed = (m) => !!results[m.id] || (m.kickoffTs != null && Date.now() >= m.kickoffTs);
  const hiddenCount = isMe ? 0 : fixtures.filter(m => picks[m.id] && !revealed(m)).length;
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
    if (r && p) totalPts += scoreWcPick(r, p, m.isKnockout);
  });

  return (
    <div className="shared-slip-backdrop" onClick={onClose}>
      <div className="shared-slip-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="shared-slip-head">
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.28em', fontWeight: 800, color: 'var(--pv-orange)' }}>PALPITES DO BOLÃO</div>
            <div style={{ fontFamily: 'Bungee Inline, Impact, sans-serif', fontSize: 22, letterSpacing: '0.04em', marginTop: 4 }}>
              {nick}
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
            const pickedInFase = ms.filter(m => picks[m.id] && (isMe || revealed(m)));
            if (pickedInFase.length === 0) return null;
            return (
              <div key={fase} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, letterSpacing: '0.2em', fontWeight: 800, color: 'var(--pv-orange)', marginBottom: 6 }}>{fase}</div>
                {pickedInFase.map(m => {
                  const p = picks[m.id];
                  const r = results[m.id];
                  const pts = r ? scoreWcPick(r, p, m.isKnockout) : null;
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
          {hiddenCount > 0 && (
            <div className="empty">
              <div className="e2"><Icon name="lock" size={12} /> +{hiddenCount} palpite{hiddenCount === 1 ? '' : 's'} escondido{hiddenCount === 1 ? '' : 's'} até a bola rolar.</div>
            </div>
          )}
          {myPickCount === 0 && (
            <div className="empty">
              <div className="e2">{nick} ainda não palpitou em nenhum jogo.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Um confronto do bracket. Mod lança o placar DIRETO aqui (e quem passou nos
// pênaltis se empatar); ao salvar, a próxima fase libera sozinha (W/L resolve).
// Times ainda indefinidos (vencedor de jogo não jogado) ficam "trancados".
function BracketMatch({ m, result, isAdmin, onSetResult }) {
  const ready = !m.slotHome && !m.slotAway;
  const played = !!result;
  const [gh, setGh] = useState(played ? String(result.gh) : '');
  const [ga, setGa] = useState(played ? String(result.ga) : '');
  const [pgh, setPgh] = useState(played && result.penH != null ? String(result.penH) : '');
  const [pga, setPga] = useState(played && result.penA != null ? String(result.penA) : '');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setGh(played ? String(result.gh) : ''); setGa(played ? String(result.ga) : '');
    setPgh(played && result.penH != null ? String(result.penH) : ''); setPga(played && result.penA != null ? String(result.penA) : '');
  }, [result && result.gh, result && result.ga, result && result.penH, result && result.penA]);
  const tie = played && result.gh === result.ga;
  const homeWon = played && (result.gh > result.ga || (tie && result.penH > result.penA));
  const awayWon = played && (result.ga > result.gh || (tie && result.penA > result.penH));
  const editTie = gh !== '' && ga !== '' && gh === ga; // empate digitado -> abre pênaltis
  const canEdit = isAdmin && ready;
  const num = (s) => s.replace(/\D/g, '').slice(0, 2);
  const save = async () => { if (busy) return; setBusy(true); try { await onSetResult(m.id, gh, ga, pgh, pga); } finally { setBusy(false); } };
  const clear = async () => { setBusy(true); try { await onSetResult(m.id, '', ''); setGh(''); setGa(''); setPgh(''); setPga(''); } finally { setBusy(false); } };
  return (
    <div className={'bracket-match' + (played ? ' played' : '') + (ready ? '' : ' locked')}>
      <div className="bracket-date">{m.date} · {m.time}</div>
      <div className={'bracket-team' + (homeWon ? ' winner' : '') + (m.slotHome ? ' slot' : '')}>
        <TeamFlag flag={m.flagHome} size={16} />
        <span className="bracket-team-name">{m.home}</span>
        {tie && result.penH != null && <span className="bracket-pen">{result.penH}</span>}
        {canEdit
          ? <input className="bracket-in" value={gh} inputMode="numeric" onChange={e => setGh(num(e.target.value))} onBlur={save} aria-label={'Gols ' + m.home} />
          : <span className="bracket-score">{played ? result.gh : '–'}</span>}
      </div>
      <div className={'bracket-team' + (awayWon ? ' winner' : '') + (m.slotAway ? ' slot' : '')}>
        <TeamFlag flag={m.flagAway} size={16} />
        <span className="bracket-team-name">{m.away}</span>
        {tie && result.penA != null && <span className="bracket-pen">{result.penA}</span>}
        {canEdit
          ? <input className="bracket-in" value={ga} inputMode="numeric" onChange={e => setGa(num(e.target.value))} onBlur={save} aria-label={'Gols ' + m.away} />
          : <span className="bracket-score">{played ? result.ga : '–'}</span>}
      </div>
      {canEdit && editTie && (
        <div className="bracket-pens">
          <span className="bracket-pens-l">PÊNALTIS</span>
          <input className="bracket-in bracket-pen-in" value={pgh} inputMode="numeric" onChange={e => setPgh(num(e.target.value))} onBlur={save} aria-label={'Pênaltis ' + m.home} />
          <span className="bracket-pen-x">×</span>
          <input className="bracket-in bracket-pen-in" value={pga} inputMode="numeric" onChange={e => setPga(num(e.target.value))} onBlur={save} aria-label={'Pênaltis ' + m.away} />
        </div>
      )}
      {canEdit && played && <button type="button" className="bracket-clear" onClick={clear} title="Limpar resultado"><Icon name="x" size={11} /></button>}
    </div>
  );
}

// Bracket visual do mata-mata: organiza os jogos knockout em colunas por fase
// (32avos / oitavas / quartas / semis / 3o lugar + final). Mod lança o resultado
// direto em cada card; a fase seguinte libera conforme as partidas terminam.
function CopaBracket({ fixtures, results, isAdmin, thirds, onSetResult, onSetThird }) {
  // Resolve os slots (1A/2B, terceiros 3A/B/C/D, vencedor/perdedor WN/LN) antes
  // de montar o chaveamento — senão aparece "1º G A" / "time sem adversário".
  const resolved = useMemo(() => resolveWcFixtures(fixtures, results, thirds), [fixtures, results, thirds]);
  const knockoutMatches = useMemo(() => resolved.filter(m => m.isKnockout), [resolved]);
  // Dados pro painel "ajustar terceiros" (mod): standings -> 8 melhores 3os +
  // as vagas (slots) + a alocação atual (override ou automática).
  const thAux = useMemo(() => {
    const groups = Array.from(new Set(fixtures.filter(m => !m.isKnockout && m.group).map(m => m.group)));
    const sb = {}; groups.forEach(g => { sb[g] = computeWcGroupStandings(g, fixtures, results); });
    const info = wcThirdsInfo(sb);
    const slots = wcThirdSlots(fixtures);
    const assign = computeWcThirdAssignment(sb, fixtures, thirds); // slot -> {name,flag}
    const groupForName = {}; info.qualGroups.forEach(g => { groupForName[info.byGroup[g].name] = g; });
    return { info, slots, assign, groupForName };
  }, [fixtures, results, thirds]);
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
    <>
    {isAdmin && onSetThird && thAux.info.complete && thAux.slots.length > 0 && (
      <div className="card wc-thirds-panel">
        <div className="card-head">
          <div className="title"><Icon name="flag" size={15} /> AJUSTAR MELHORES TERCEIROS</div>
          <div className="sub">DEFINA QUEM VAI EM CADA VAGA (USE O CHAVEAMENTO OFICIAL)</div>
        </div>
        <div className="card-body">
          <div className="wc-thirds-list">
            {thAux.slots.map(ss => {
              const match = knockoutMatches.find(m => m.rawSlotHome === ss.slot || m.rawSlotAway === ss.slot);
              const oppName = match ? (match.rawSlotHome === ss.slot ? match.away : match.home) : '—';
              const eligible = ss.allowed.filter(g => thAux.info.qualGroups.includes(g)).map(g => ({ g, name: thAux.info.byGroup[g].name }));
              const curName = thAux.assign[ss.slot] && thAux.assign[ss.slot].name;
              const val = thirds[ss.slot] || (curName ? thAux.groupForName[curName] : '') || '';
              return (
                <div key={ss.slot} className="wc-third-row">
                  <span className="wc-third-opp">{oppName}</span>
                  <span className="wc-third-vs">×</span>
                  <select className="wc-third-sel" value={val} onChange={e => onSetThird(ss.slot, e.target.value || null)}>
                    <option value="">Automático</option>
                    {eligible.map(o => <option key={o.g} value={o.g}>{o.name} (3º {o.g})</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    )}
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
              {byPhase[p.key].map(m => (
                <BracketMatch key={m.id} m={m} result={results[m.id]} isAdmin={isAdmin} onSetResult={onSetResult} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
    </>
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
    if (!(await confirmModal({ title: 'APAGAR COMENTÁRIO?', body: 'Não tem como desfazer.', confirmLabel: 'APAGAR', danger: true }))) return;
    try {
      await onDelete(newsId, commentId);
      showToast('Comentário apagado.', 'success');
    } catch (e) {
      console.warn(e);
      showToast('Não consegui apagar — tenta de novo.', 'error');
    }
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
                placeholder={`Comentar como ${sessionNick}…`}
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
                  <span className="comment-nick">{c.nick}</span>
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

function ApostarView({ games, gamesById, bets, me, session, users,
                        slip, onToggleLeg, onRemoveLeg, onClearSlip, onPlaceBet, isAdmin, canLock, slipPruneMsg,
                        onToggleLock, onSetScore, championship, setChampionship, interests, teamPlayers }) {
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
                               canLock={canLock} onToggleLock={() => onToggleLock(g.ri, g.gi)}
                               onSetScore={onSetScore ? (patch) => onSetScore(g.ri, g.gi, patch) : null} teamPlayers={teamPlayers} />
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
            <Cupom slip={slip} gamesById={gamesById} balance={me ? me.pc : 0} pruneMsg={slipPruneMsg} teamPlayers={teamPlayers}
                   onRemoveLeg={onRemoveLeg} onClearSlip={onClearSlip}
                   onPlaceBet={async (amt, opts) => {
                     const r = await onPlaceBet(amt, opts);
                     // Aposta entrou: fecha o bottom-sheet (mobile) pra voltar pros jogos.
                     if (r && r.ok) setCupomOpen(false);
                     return r;
                   }} />
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

function GameRow({ game, slip, onToggleLeg, canBet, canLock, onToggleLock, onSetScore, teamPlayers }) {
  const homeNick = fifaUserOf(game.home, teamPlayers);
  const awayNick = fifaUserOf(game.away, teamPlayers);
  const hU = homeNick.toUpperCase(), aU = awayNick.toUpperCase();
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
            <ClubCrest nick={game.home} teamPlayers={teamPlayers} size={42} />
            <div className="team-info"><div className="nm">{homeNick}</div><div className="sh">MANDANTE</div></div>
          </div>
          <div className="vs"><span style={{ color: 'var(--pv-orange)' }}>×</span></div>
          <div className="fixture-team away">
            <ClubCrest nick={game.away} teamPlayers={teamPlayers} size={42} />
            <div className="team-info"><div className="nm">{awayNick}</div><div className="sh">VISITANTE</div></div>
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
      {/* O placar é lançado no painel LANÇAR RESULTADOS (topo de APOSTAS/JOGOS),
          que lista os jogos travados aguardando resultado. Aqui só trava/destrava. */}

      {expanded && (
        <>
          {/* barra de probabilidade do confronto (mesmo modelo das odds; reusa
              o visual da barra do MK — classes mk-bg-prob são standalone) */}
          {o.probs && (
            <div className="mk-bg-prob" title="Probabilidade do confronto (modelo de odds)">
              <div className="mk-bg-prob-bar">
                <span className="mk-bg-prob-seg h" style={{ width: (o.probs.H * 100) + '%' }} />
                <span className="mk-bg-prob-seg d" style={{ width: (o.probs.D * 100) + '%' }} />
                <span className="mk-bg-prob-seg a" style={{ width: (o.probs.A * 100) + '%' }} />
              </div>
              <div className="mk-bg-prob-lab">
                <span className="mand">{homeNick} {Math.round(o.probs.H * 100)}%</span>
                <span className="draw">emp {Math.round(o.probs.D * 100)}%</span>
                <span className="away">{awayNick} {Math.round(o.probs.A * 100)}%</span>
              </div>
            </div>
          )}
          <div className="mkt-label">RESULTADO</div>
          <div className="odds-row">
            <OddBtn lab={`${hU} VENCE`} val={o['1X2']?.H} selected={sel('1X2','H')} disabled={dis} onClick={() => onToggleLeg(game, '1X2', 'H')} />
            <OddBtn lab="EMPATE"        val={o['1X2']?.D} selected={sel('1X2','D')} disabled={dis} onClick={() => onToggleLeg(game, '1X2', 'D')} />
            <OddBtn lab={`${aU} VENCE`} val={o['1X2']?.A} selected={sel('1X2','A')} disabled={dis} onClick={() => onToggleLeg(game, '1X2', 'A')} />
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

          <div className="mkt-label">+3 GOLS · {hU}</div>
          <div className="odds-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <OddBtn lab="SIM" val={o['O3H']?.Y} selected={sel('O3H','Y')} disabled={dis} onClick={() => onToggleLeg(game, 'O3H', 'Y')} />
            <OddBtn lab="NÃO" val={o['O3H']?.N} selected={sel('O3H','N')} disabled={dis} onClick={() => onToggleLeg(game, 'O3H', 'N')} />
          </div>

          <div className="mkt-label">+3 GOLS · {aU}</div>
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
function Cupom({ slip, gamesById, balance, onRemoveLeg, onClearSlip, onPlaceBet, pruneMsg, teamPlayers }) {
  const [amt, setAmt] = useState(50);
  const [busy, setBusy] = useState(false);
  const legs = slip.map(s => ({ ...s, _fix: gamesById ? gamesById[s.fixtureId] : null }));
  // SOMA (não multiplica) — ver placeBet.
  const combined = slip.reduce((p, l) => p + l.odds, 0);
  const payout = Math.round(amt * combined);
  const valid = !busy && slip.length > 0 && amt > 0 && amt <= balance;
  const multi = slip.length > 1;
  const handlePlace = async (opts) => {
    if (busy) return;
    setBusy(true);
    try { await onPlaceBet(amt, opts); }
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
            <div className="e2">Clica nas odds dos jogos pra montar. Vários palpites = aposta casada: as odds somam, mas precisa acertar TODOS pra ganhar. Dá pra combinar mais de um mercado do mesmo jogo (ex: 1X2 + ambos marcam).</div>
          </div>
        )}

        {legs.map(l => (
          <div key={l.fixtureId + l.market + l.pick} className="cupom-leg">
            <div className="cupom-leg-txt">
              <div className="cupom-leg-mkt">{MARKET_TITLE[l.market] || l.market}</div>
              {legLabel(l, teamPlayers)}
            </div>
            <div className="cupom-leg-odd mono">{l.odds.toFixed(2)}</div>
            <button className="cupom-leg-x" title="Tirar este palpite" onClick={() => onRemoveLeg(l.fixtureId, l.market, l.pick)}><Icon name="x" size={12} /></button>
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
            {/* Valores rápidos calibrados pra economia atual (bônus semanal
                de 550 PC, saldos na casa dos milhares). Clampa no saldo. */}
            <div className="quick">
              <button onClick={() => setAmt(Math.min(50, balance))}>50</button>
              <button onClick={() => setAmt(Math.min(100, balance))}>100</button>
              <button onClick={() => setAmt(Math.min(500, balance))}>500</button>
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
              <button className="btn-primary" disabled={!valid} onClick={() => handlePlace()}>
                {busy ? 'APOSTANDO…' : `APOSTAR ${amt} PC`}
              </button>
            </div>
            {/* Todo cupom agora vai pra MESA DOS CARTOLAS automaticamente ao apostar. */}
            <div className="cupom-public-note"><Icon name="cards" size={12} /> Toda aposta é pública na MESA DOS CARTOLAS — os outros podem copiar.</div>
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
// Classificação compacta do campeonato pra mostrar dentro da aba APOSTAS.
// MK: classificação ao vivo (por confrontos concluídos). FIFA: tabela final.
function ChampStandingsCard({ champId, cs, users, teamPlayers, mkDraw, mkScores, interests, myNick }) {
  let rows = [], label = '', closed = false;
  if (champId === 'mk') {
    label = champShort(CHAMP_BY_ID.mk) || 'MK S1';
    const players = mkInscritos(interests);
    const gK = (r, gi) => r.phase + '-' + r.n + '-' + gi;
    const concl = [];
    (mkDraw || []).forEach(r => (r.games || []).forEach((g, gi) => { const sc = (mkScores || {})[gK(r, gi)]; if (sc && mkMatchOutcome(sc)) concl.push({ home: g.home, away: g.away, sc }); }));
    closed = (mkDraw || []).length > 0 && mkDraw.every(r => (r.games || []).every((g, gi) => mkGameVoid(g) || !!mkMatchOutcome((mkScores || {})[gK(r, gi)])));
    rows = computeMkStandings(players, concl).map((s, i) => ({ pos: i + 1, nick: s.nick, p: s.p, v: s.v, e: s.e, d: s.d, sg: (s.rp - s.rc) }));
  } else {
    label = CHAMP_BY_ID[champId] ? champShort(CHAMP_BY_ID[champId]) : (champId.toUpperCase() + ' S1');
    closed = computeChampStandings(champId, cs).status === 'closed';
    rows = computeStandings(cs?.rounds || []).map((t, i) => ({ pos: i + 1, nick: (teamPlayers || {})[t.id] || t.id, p: t.p, v: t.v, e: t.e, d: t.d, sg: (t.gp - t.gc) }));
  }
  if (!rows.length) return null;
  return (
    <div className="card">
      <div className="card-head"><div className="title"><Icon name="chart" size={15} /> CLASSIFICAÇÃO</div><div className="sub">{label} · {closed ? 'FINAL' : 'AO VIVO'}</div></div>
      <div className="card-body">
        <div className="apo-stand">
          <div className="apo-stand-row apo-stand-h"><span className="apo-stand-pos">#</span><span /><span className="apo-stand-nick"></span><span className="apo-stand-rec">V-E-D</span><span className="apo-stand-sg">SG</span><span className="apo-stand-pts">PTS</span></div>
          {rows.map(r => (
            <div key={r.nick} className={'apo-stand-row' + (r.nick === myNick ? ' me' : '') + (r.pos <= 3 ? ' top' : '')}>
              <span className="apo-stand-pos">{r.pos}</span>
              <Avatar nick={r.nick} teamPlayers={teamPlayers} size={22} noBadge />
              <span className="apo-stand-nick">{r.nick}</span>
              <span className="apo-stand-rec">{r.v}-{r.e}-{r.d}</span>
              <span className="apo-stand-sg">{r.sg >= 0 ? '+' : ''}{r.sg}</span>
              <span className="apo-stand-pts">{r.p}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── MESA DOS CARTOLAS (M9): tickets abertos pra copiar + reputação ──────────
function RepBadge({ user, sm }) {
  const score = repScoreOf(user);
  const lv = repLevel(score);
  return (
    <span className={'rep-badge' + (sm ? ' sm' : '')} style={{ '--rep-c': lv.color, color: lv.color, borderColor: lv.color }}
      title={'REPUTAÇÃO DE CARTOLA — ' + lv.name + ' (' + score + ')\nSua fama como palpiteiro. Sobe quando alguém COPIA seu cupom público e GANHA; cai se o seguidor perder.\nPublique bons cupons na MESA DOS CARTOLAS pra evoluir: NOVATO → PALPITEIRO → CARTOLA → CARTOLA OURO → ORÁCULO.'}>
      <Icon name={lv.icon} size={sm ? 10 : 12} /> {lv.name} <b>{score}</b>
    </span>
  );
}
function OpenTicketCard({ t, owner, ownerUser, teamPlayers, gamesById, alreadyCopied, isOwner, balance, onCopy, copiers }) {
  const [amt, setAmt] = useState(50);
  const [busy, setBusy] = useState(false);
  const [showLegs, setShowLegs] = useState(false); // resumo dos palpites começa minimizado
  const copyList = copiers || [];
  const copies = copyList.length; // contagem real (cancelar remove o bet)
  const insurance = Math.round((amt || 0) * CASHBACK_RATE); // volta SE perder (seguro)
  const nLegs = (t.legs || []).length;
  const doCopy = async () => { if (busy) return; setBusy(true); try { await onCopy(t.id, amt); } finally { setBusy(false); } };
  // Bilhete muda pela ODD do cupom: odd alta = holográfico, baixa = rasgado.
  const tier = oddTier(t.combinedOdds, t.champId);
  return (
    <div className={'mesa-card mesa-card--' + tier}>
      {TIER_TAG[tier] && <span className={'mesa-tier-tag tag-' + tier}><Icon name="sparkle" size={10} /> {TIER_TAG[tier]}</span>}
      <div className="mesa-card-h">
        <Avatar nick={owner} teamPlayers={teamPlayers} size={34} noBadge />
        <div className="mesa-card-who">
          <div className="mesa-card-nick">{owner}</div>
          <RepBadge user={ownerUser} sm />
        </div>
      </div>
      <div className="mesa-card-meta">
        <span className="mesa-card-legs">{nLegs} palpite{nLegs === 1 ? '' : 's'}{t.casada ? ' · casada' : ''}</span>
        <span className="mesa-card-odds">{Number(t.combinedOdds || 0).toFixed(2)}x</span>
        <span className="mesa-card-copies" title="cópias"><Icon name="user" size={10} /> {copies}</span>
      </div>
      {/* RESUMO da aposta (minimizado) — quem vai confiar abre e vê o que está copiando. */}
      {nLegs > 0 && (
        <div className="mesa-legs-wrap">
          <button type="button" className="mesa-legs-toggle" onClick={() => setShowLegs(s => !s)} aria-expanded={showLegs}>
            <Icon name={showLegs ? 'caret-up' : 'caret-down'} size={11} />
            {showLegs ? 'MINIMIZAR PALPITES' : 'VER ' + (nLegs === 1 ? 'O PALPITE' : 'OS ' + nLegs + ' PALPITES')}
          </button>
          {showLegs && (
            <ul className="mesa-legs">
              {(t.legs || []).map((l, i) => (
                <li key={i} className="mesa-leg">
                  <span className="mesa-leg-dot">•</span>
                  <span className="mesa-leg-txt">{legSummary(l, teamPlayers, gamesById)} <b>@{Number(l.odds || 0).toFixed(2)}</b></span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {isOwner ? (
        <>
          <div className="mesa-card-tag own"><Icon name="star" size={11} /> SEU TICKET · {copies} seguidor{copies === 1 ? '' : 'es'}</div>
          <div className="mesa-tip-note"><Icon name="coin-fire" size={11} /> GORJETA: você fatura 5% do lucro de cada seguidor que acertar</div>
        </>
      ) : alreadyCopied ? (
        <div className="mesa-card-tag done"><Icon name="check" size={11} /> JÁ NA SUA BANCA</div>
      ) : (
        <>
          <div className="mesa-cashback"><Icon name="shield" size={12} /> SEGURO: se perder volta <b>{insurance} PC</b> (10%). Se ganhar, taxa de 10% do lucro (5% pro cartola).</div>
          <div className="mesa-copyrow">
            <input className="mesa-stake" value={amt} inputMode="numeric" onChange={e => setAmt(Math.max(0, parseInt(e.target.value.replace(/\D/g, ''), 10) || 0))} />
            <button type="button" className="mesa-copybtn" disabled={busy || !amt || amt > balance} onClick={doCopy}>
              {busy ? '...' : (amt > balance ? 'SEM SALDO' : 'COPIAR')}
            </button>
          </div>
        </>
      )}
      {copyList.length > 0 && (
        <div className="mesa-copiers">
          <div className="mesa-copiers-h"><Icon name="heart" size={11} /> QUEM TÁ CONFIANDO · {copyList.length}</div>
          <div className="mesa-copiers-list">
            {copyList.slice(0, 8).map((c, i) => (
              <div key={c.nick + i} className="mesa-copier">
                <Avatar nick={c.nick} teamPlayers={teamPlayers} size={18} noBadge />
                <span className="mesa-copier-n">{c.nick}</span>
                <span className="mesa-copier-a">{compactPC(c.amount)}<small> PC</small></span>
              </div>
            ))}
            {copyList.length > 8 && <div className="mesa-copier-more">+{copyList.length - 8} confiando também</div>}
          </div>
        </div>
      )}
    </div>
  );
}
function OpenTicketsFeed({ bets, users, teamPlayers, gamesById, myNick, champId, balance, onCopy }) {
  const all = bets || [];
  // Cupom PÚBLICO e ousado: pendente, não-cópia, do campeonato atual e com odd
  // combinada >= MESA_MIN_ODDS (curadoria — só as calls que valem copiar).
  const open = all.filter(b => !b.copyOf && b.status === 'pending' && (b.champId || 'fifa') === champId && Number(b.combinedOdds || 0) >= mesaMinOddsFor(champId))
    .sort((a, b) => repScoreOf((users || {})[b.user]) - repScoreOf((users || {})[a.user]) || (b.openMeta?.publishedAt || 0) - (a.openMeta?.publishedAt || 0));
  if (!open.length) return null;
  return (
    <div className="card mesa-card-wrap">
      <div className="card-head"><div className="title"><Icon name="cards" size={16} /> MESA DOS CARTOLAS</div><div className="sub">{open.length} TICKET{open.length === 1 ? '' : 'S'} ABERTO{open.length === 1 ? '' : 'S'} · COPIE COM 10% DE CASHBACK</div></div>
      <div className="card-body">
        <div className="mesa-grid">
          {open.map(t => {
            // Lista de quem copiou (derivada dos bets: cópia = bet com copyOf === id).
            // Cancelar remove o bet, então cópias canceladas somem daqui sozinhas.
            const copiers = all.filter(b => b.copyOf === t.id)
              .map(b => ({ nick: b.user, amount: b.amount || 0 }))
              .sort((a, b) => b.amount - a.amount);
            return (
              <OpenTicketCard key={t.id} t={t} owner={t.user} ownerUser={(users || {})[t.user]}
                teamPlayers={teamPlayers} gamesById={gamesById} isOwner={t.user === myNick} copiers={copiers}
                alreadyCopied={all.some(b => b.copyOf === t.id && b.user === myNick)}
                balance={balance} onCopy={onCopy} />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Versao MINI dos tickets pro trilho esquerdo (embaixo do ONDE APOSTAR): uma
// linha por ticket — bolinha de status + tipo/odd + valor. Bem resumido.
function TicketsMini({ bets, limit = 6, onOpen }) {
  const sorted = [...(bets || [])].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, limit);
  const total = (bets || []).length;
  return (
    <div className="tk-mini">
      <button type="button" className="tk-mini-h" onClick={onOpen}>
        <span>MEUS TICKETS</span><Icon name="chevron-right" size={12} />
      </button>
      {sorted.length === 0 ? (
        <div className="tk-mini-empty">Você ainda não apostou aqui.</div>
      ) : (
        <>
          <div className="tk-mini-list">
            {sorted.map(t => {
              const st = t.status === 'won' ? 'won' : t.status === 'lost' ? 'lost' : 'open';
              const multi = (t.legs || []).length > 1;
              const lab = multi ? 'CASADA ' + t.legs.length + 'x' : 'SIMPLES';
              const val = t.status === 'won' ? '+' + t.payout : t.status === 'lost' ? '-' + t.amount : '' + t.amount;
              return (
                <button type="button" key={t.id} className={'tk-mini-row ' + st} onClick={onOpen} title="ver detalhes / cancelar no MEUS TICKETS">
                  <span className="tk-mini-dot" />
                  <span className="tk-mini-lab">{lab} <small>@{Number(t.combinedOdds || 0).toFixed(2)}</small></span>
                  <span className="tk-mini-val">{val}<small>PC</small></span>
                </button>
              );
            })}
          </div>
          <button type="button" className="tk-mini-all" onClick={onOpen}>
            VER TODOS{total > limit ? ' (' + total + ')' : ''} · CANCELAR <Icon name="chevron-right" size={11} />
          </button>
        </>
      )}
    </div>
  );
}

function TicketsView({ bets, gamesById, cs, mkScores, mkLineups, mkKo, teamPlayers, onCancel, limit, title, onGoApostas }) {
  const [showOld, setShowOld] = useState(false);
  // "22/05 14:32" — quando o ticket foi feito (auditoria pessoal).
  const fmtWhen = (ts) => {
    if (!ts) return null;
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
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
  // Rótulo de rodada do ticket (MK traz roundN/phase; FIFA tira do jogo da 1ª perna).
  const roundOf = (t) => {
    if (t.roundN != null) return 'RODADA ' + String(t.roundN).padStart(2, '0') + (t.phase ? ' · ' + t.phase : '');
    for (const l of (t.legs || [])) { const g = resolveGame(l.fixtureId); if (g && g.round != null) return 'RODADA ' + String(g.round).padStart(2, '0'); }
    return null;
  };
  if (bets.length === 0) {
    return <div className="card"><div className="card-head"><div className="title">{title || 'MEUS TICKETS'}</div></div><div className="card-body"><div className="empty">
      <div className="e1">SEM TICKETS</div><div className="e2">Você ainda não apostou aqui.</div>
      {onGoApostas && (
        <button type="button" className="empty-cta" onClick={onGoApostas}>
          <Icon name="ticket" size={14} /> IR PRAS APOSTAS
        </button>
      )}
    </div></div></div>;
  }
  const sortedAll = [...bets].sort((a, b) => b.createdAt - a.createdAt);
  const sorted = limit ? sortedAll.slice(0, limit) : sortedAll;
  const renderTicket = (t) => {
    const cls = t.status === 'won' ? 'ticket won' : t.status === 'lost' ? 'ticket lost' : 'ticket';
    // Cancelar bloqueado se: já tem perna liquidada OU algum jogo do cupom foi
    // travado (impede saída esperta antes da bola rolar).
    const hasSettled = t.legs.some(l => !!l.result);
    const hasLocked = t.legs.some(l => {
      if (l.tourney || (typeof l.fixtureId === 'string' && l.fixtureId.indexOf('mkkot:') === 0)) return mkKoAnyStarted((mkKo || {}).scores || {});
      if (typeof l.fixtureId === 'string' && l.fixtureId.indexOf('mkko:') === 0) return mkKoMatchStarted(((mkKo || {}).scores || {})[l.fixtureId.slice(5)]);
      if (typeof l.fixtureId === 'string' && l.fixtureId.indexOf('mk:') === 0) return mkGameClosed((mkScores || {})[l.fixtureId.slice(3)]);
      const g = resolveGame(l.fixtureId);
      return !!(g && g.locked);
    });
    const blocked = hasSettled || hasLocked;
    const multi = t.legs.length > 1;
    const isCopy = !!t.copyOf;
    const copies = (t.openMeta && t.openMeta.copies) || 0;
    const rl = roundOf(t);
    const when = fmtWhen(t.createdAt);
    return (
      <div key={t.id} className={cls + (isCopy ? ' ticket--copy' : ' ticket--mine')} style={{ gridTemplateColumns: '1fr auto' }}>
        <div>
          <div className="tk-head">
            {isCopy
              ? <span className="tk-chip copy"><Icon name="cards" size={10} /> CÓPIA DE {t.copyOwner}</span>
              : <span className="tk-chip mine"><Icon name="star" size={10} /> SEU · NA MESA{copies > 0 ? ' · ' + copies + ' cópia' + (copies === 1 ? '' : 's') : ''}</span>}
            {rl && <span className="tk-chip round"><Icon name="flag" size={9} /> {rl}</span>}
            <span className="tk-chip soft">{multi ? 'CASADA ' + t.legs.length : 'SIMPLES'} · @{Number(t.combinedOdds).toFixed(2)}</span>
            {when && <span className="tk-when">{when}</span>}
          </div>
          <div className="pick">
            {t.legs.map((l, i) => {
              const isKoT = l.tourney || (typeof l.fixtureId === 'string' && l.fixtureId.indexOf('mkkot:') === 0);
              const isKo = !isKoT && typeof l.fixtureId === 'string' && l.fixtureId.indexOf('mkko:') === 0;
              const isMk = !isKoT && !isKo && typeof l.fixtureId === 'string' && l.fixtureId.indexOf('mk:') === 0;
              const f = (isMk || isKo || isKoT) ? null : resolveGame(l.fixtureId);
              const lg = { ...l, _fix: f };
              const iconName = l.result === 'win' ? 'check' : l.result === 'lose' ? 'x' : null;
              const iconColor = l.result === 'win' ? '#3a7d2a' : l.result === 'lose' ? '#c33' : 'rgba(28,22,18,0.5)';
              const lu = isMk ? (mkLineups || {})[l.fixtureId.slice(3)] : null;
              const out = isMk ? mkMatchOutcome((mkScores || {})[l.fixtureId.slice(3)] || {}) : null; // {winner H/A/D} ou null
              // Mercado de LADO (VENCEDOR / 1º ROUND / KVENC): o palpite é um JOGADOR (H/A).
              // Destaca quem você escolheu — fica claro de relance o que foi apostado.
              const sidePick = (isMk && (l.market === 'VENC' || l.market === 'R1')) || (isKo && l.market === 'KVENC') ? (l.pick === 'H' ? 'home' : l.pick === 'A' ? 'away' : null) : null;
              const tMkt = isKoT ? (l.koTourneyMarket || l.market) : null;
              const mktTitle = isKoT ? (MK_KO_TOURNEY_TITLE[tMkt] || tMkt) : isKo ? (MK_KO_MARKET_TITLE[l.market] || l.market) : (MK_MARKET_TITLE[l.market] || l.market);
              const pickTxt = isKo ? (mkKoPickLabel(l.market, l.pick, l.home, l.away) || '') : (mkPickLabel(l.market, l.pick) || '');
              const label = (isMk || isKo)
                ? l.home + ' × ' + l.away + ' · ' + mktTitle + ' ' + pickTxt
                : (f ? legLabel(lg, teamPlayers) : '(jogo removido)');
              return (
                <div key={i} className={'tk-leg' + (l.result === 'win' ? ' leg-won' : l.result === 'lose' ? ' leg-lost' : '')}>
                  <div className="tk-leg-main">
                    {iconName ? <span className="tk-res" style={{ color: iconColor }}><Icon name={iconName} size={12} /></span> : <span style={{ color: iconColor }}>•</span>}
                    {isKoT ? (
                      <span>
                        <span className="tk-ko-chip">CAMPEONATO MK</span>
                        <span className="tk-pickn">{l.pick}</span>
                        {' · ' + mktTitle}{' '}
                        <span style={{ color: 'var(--pv-orange)' }}>@{l.odds.toFixed(2)}</span>
                      </span>
                    ) : (isMk || isKo) ? (
                      <span>
                        {isKo && <span className="tk-ko-chip">MATA-MATA</span>}
                        <span className={sidePick === 'home' ? 'tk-pickn' : undefined}>{l.home}</span>
                        {' × '}
                        <span className={sidePick === 'away' ? 'tk-pickn' : undefined}>{l.away}</span>
                        {' · ' + mktTitle + ' ' + pickTxt}{' '}
                        <span style={{ color: 'var(--pv-orange)' }}>@{l.odds.toFixed(2)}</span>
                      </span>
                    ) : (
                      <span>{label} <span style={{ color: 'var(--pv-orange)' }}>@{l.odds.toFixed(2)}</span></span>
                    )}
                  </div>
                  {lu && (
                    <span className="tk-chars">
                      <span className={'tk-side' + (out ? (out.winner === 'H' ? ' won' : out.winner === 'A' ? ' lost' : '') : '') + (sidePick === 'home' ? ' picked' : '')}>
                        {['p1', 'p2'].map(p => (lu[p] && lu[p].home) ? <MkCharIcon key={'h' + p} name={lu[p].home} sm /> : null)}
                        {out && out.winner === 'A' && <span className="tk-x"><Icon name="x" size={11} /></span>}
                      </span>
                      <i className="tk-chars-x">×</i>
                      <span className={'tk-side' + (out ? (out.winner === 'A' ? ' won' : out.winner === 'H' ? ' lost' : '') : '') + (sidePick === 'away' ? ' picked' : '')}>
                        {out && out.winner === 'H' && <span className="tk-x"><Icon name="x" size={11} /></span>}
                        {['p1', 'p2'].map(p => (lu[p] && lu[p].away) ? <MkCharIcon key={'a' + p} name={lu[p].away} sm /> : null)}
                      </span>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className={'status ' + t.status}>
            {t.status === 'pending' ? 'EM ABERTO' : t.status === 'won' ? `VENCEU · +${t.payout} PC` : 'PERDEU'}
          </div>
          {isCopy && t.cashback ? <div className="tk-sub"><Icon name="shield" size={10} /> seguro de {t.cashback} PC se perder</div> : null}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="stake">{t.amount} <span style={{ fontSize: 10, fontFamily: 'Space Grotesk', letterSpacing: '0.2em' }}>PC</span></div>
          {t.status === 'pending' && !blocked && (
            <button onClick={() => onCancel(t.id)} style={{ marginTop: 8, padding: '6px 10px', fontSize: 10, fontWeight: 800, letterSpacing: '0.18em', background: 'transparent', border: '1.5px solid var(--pv-charcoal)' }}>CANCELAR</button>
          )}
          {t.status === 'pending' && hasLocked && !hasSettled && (
            <div style={{ marginTop: 8, fontSize: 9, letterSpacing: '0.16em', fontWeight: 800, color: '#c33', lineHeight: 1.3, maxWidth: 110, display: 'inline-flex', alignItems: 'flex-start', gap: 4 }}>
              <Icon name="lock" size={10} /> <span>JOGO TRAVADO<br />NÃO DÁ PRA CANCELAR</span>
            </div>
          )}
        </div>
      </div>
    );
  };
  // Histórico: mostra sempre os 10 mais recentes; o resto fica oculto atrás do toggle.
  const HISTORY = 10;
  const head = sortedAll.slice(0, HISTORY);
  const rest = sortedAll.slice(HISTORY);
  return (
    <div className="card">
      <div className="card-head"><div className="title">{title || 'MEUS TICKETS'}</div><div className="sub">{limit ? `${sorted.length} DE ${bets.length}` : `${bets.length} TOTAL`}</div></div>
      <div className="card-body">
        {limit ? sorted.map(renderTicket) : (
          <>
            {head.map(renderTicket)}
            {rest.length > 0 && (
              <button type="button" className="tk-old-toggle" onClick={() => setShowOld(s => !s)}>
                <Icon name={showOld ? 'caret-up' : 'caret-down'} size={12} /> {showOld ? 'OCULTAR ANTIGOS' : 'VER TICKETS ANTIGOS (' + rest.length + ')'}
              </button>
            )}
            {showOld && rest.map(renderTicket)}
          </>
        )}
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
  if (!nick) return [];
  // Casa em "espaço de @nick": resolve a chave de cada standing pro nick e
  // compara. Funciona com cs por teamId (antes) ou por nick (depois da migração).
  const mine = (s) => !!s && fifaUserOf(s.id, teamPlayers) === nick;
  const trophies = [];
  for (const c of CHAMPIONSHIPS) {
    const { status, standings } = computeChampStandings(c.id, cs);
    if (status !== 'closed' || !standings || standings.length < 2) continue;
    if (!standings.some(mine)) continue; // não jogou esta edição
    const last = standings.length - 1;
    if (mine(standings[0]))        trophies.push({ champId: c.id, kind: 'champion' });
    else if (mine(standings[1]))   trophies.push({ champId: c.id, kind: 'vice' });
    // 3º lugar (bronze) só conta se o pódio não encostar na lanterna/penúltimo (5+ times)
    else if (last > 3 && mine(standings[2])) trophies.push({ champId: c.id, kind: 'terceiro' });
    else if (mine(standings[last]))   trophies.push({ champId: c.id, kind: 'lanterna' });
    else if (mine(standings[last - 1])) trophies.push({ champId: c.id, kind: 'penultimo' });
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

// Resumo de apostas de um nick (TODAS as seasons) — pro perfil de apostas.
function betProfileStats(nick, bets) {
  const mine = (bets || []).filter(b => b.user === nick);
  let won = 0, lost = 0, pend = 0, wagered = 0, retorno = 0, stakeResolvido = 0, biggest = 0, copies = 0;
  mine.forEach(b => {
    wagered += b.amount || 0;
    if (b.status === 'won') { won++; retorno += b.payout || 0; stakeResolvido += b.amount || 0; biggest = Math.max(biggest, (b.payout || 0) - (b.amount || 0)); }
    else if (b.status === 'lost') { lost++; stakeResolvido += b.amount || 0; }
    else pend++;
    if (b.copyOf) copies++;
  });
  const resolved = won + lost;
  return { total: mine.length, won, lost, pend, wagered, lucro: retorno - stakeResolvido, winRate: resolved ? Math.round(won / resolved * 100) : 0, biggest, copies, bestStreak: maxBetStreak(bets, nick, 'won') };
}
// Posição do nick no ranking de apostas de cada SEASON ENCERRADA. Base dos
// títulos de apostas (rei/vice/mico). Retorna [{ champId, pos, total, lucro,
// apostas }] — uma entrada por season fechada em que o nick apostou.
function bettingSeasonRanks(nick, cs, bets) {
  const out = [];
  for (const c of CHAMPIONSHIPS) {
    if (computeChampStandings(c.id, cs).status !== 'closed') continue;
    const rank = seasonBettingRanking(c.id, bets);
    const idx = rank.findIndex(r => r.nick === nick);
    if (idx < 0) continue;
    out.push({ champId: c.id, pos: idx + 1, total: rank.length, lucro: rank[idx].lucro, apostas: rank[idx].apostas });
  }
  return out;
}

// ─── HELPERS DE CONQUISTA (compartilhados por títulos e distintivos) ────────

// Posição do nick na classificação FECHADA da FIFA. null se não fechou ou
// nick sem time. { pos, total, isLast, isPenult }.
function champStandingPos(nick, cs, teamPlayers) {
  if (!cs) return null;
  const rounds = cs.rounds || [];
  const allDone = rounds.length > 0 && rounds.every(r => Array.isArray(r) && r.length > 0 && r.every(g => g.gh !== '' && g.ga !== ''));
  if (!allDone) return null;
  const st = computeStandings(rounds).slice().sort((a, b) => b.p - a.p || (b.gp - b.gc) - (a.gp - a.gc) || b.gp - a.gp);
  // Casa em "espaço de @nick" (resolve a chave do standing pro nick).
  const idx = st.findIndex(s => fifaUserOf(s.id, teamPlayers) === nick);
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

// Quantos comentários o nick já postou. comments[newsId] = [{ id, nick, text, at }].
function commentsCountFor(nick, comments) {
  let n = 0;
  for (const arr of Object.values(comments || {})) {
    if (Array.isArray(arr)) for (const c of arr) if (c && c.nick === nick) n++;
  }
  return n;
}

// Em quantos campeonatos o nick se inscreveu (interests[champId][nick] = true).
function participationCount(nick, interests) {
  return Object.values(interests || {}).filter(m => m && m[nick]).length;
}

// Estatísticas do MK pro nick a partir do ctx.mk { draw, scores } + ctx.interests.
//   won      = nº de confrontos vencidos (concluídos)
//   flawless = venceu ALGUM confronto sem ceder nenhum round (2×0 / 2×0)
//   champion = terminou em 1º numa season de MK 100% concluída
function mkStatsFor(nick, ctx) {
  const mk = (ctx && ctx.mk) || {};
  const draw = Array.isArray(mk.draw) ? mk.draw : [];
  const scores = mk.scores || {};
  const players = mkInscritos((ctx && ctx.interests) || {});
  const empty = { won: 0, flawless: false, champion: false, pos: 0, total: 0, isLast: false, beat: [] };
  if (!players.includes(nick)) return empty;
  const key = (r, gi) => r.phase + '-' + r.n + '-' + gi;
  const concluded = [];
  let won = 0, flawless = false;
  const beat = [];
  draw.forEach(r => (r.games || []).forEach((g, gi) => {
    if (mkGameVoid(g)) return;
    const o = mkMatchOutcome(scores[key(r, gi)]);
    if (!o) return;
    concluded.push({ home: g.home, away: g.away, sc: scores[key(r, gi)] });
    const meHome = g.home === nick, meAway = g.away === nick;
    if (!meHome && !meAway) return;
    const iWon = (meHome && o.winner === 'H') || (meAway && o.winner === 'A');
    if (iWon) {
      won++;
      if (beat.indexOf(meHome ? g.away : g.home) < 0) beat.push(meHome ? g.away : g.home);
      const conceded = meHome ? o.roundsA : o.roundsH;
      if (conceded === 0) flawless = true;
    }
  }));
  const allDone = draw.length > 0 && draw.every(r => (r.games || []).every((g, gi) =>
    mkGameVoid(g) || !!mkMatchOutcome(scores[key(r, gi)])));
  let champion = false, pos = 0, total = 0, isLast = false;
  if (allDone && players.length >= 2) {
    const stand = computeMkStandings(players, concluded);
    const idx = stand.findIndex(s => s.nick === nick);
    if (idx >= 0 && stand[idx].j > 0) {
      pos = idx + 1; total = stand.length;
      champion = pos === 1;
      isLast = pos === total;
    }
  }
  return { won, flawless, champion, pos, total, isLast, beat };
}

// Venceu um JOGO da FIFA contra o time `oppTeamId`? Resolve o time do nick via
// teamPlayers e varre cs.rounds (placares gh/ga por teamId). false se for o
// próprio time ou se nunca venceu esse adversário.
function fifaBeat(nick, oppNick, ctx) {
  // Compara tudo em "espaço de @nick" via fifaUserOf, então funciona tanto com
  // cs.rounds em teamId (antes da migração) quanto em nick (depois).
  const cs = ctx && ctx.cs; if (!cs) return false;
  const tp = (ctx && ctx.teamPlayers) || {};
  if (!nick || nick === oppNick) return false;
  for (const r of (cs.rounds || [])) for (const m of (r || [])) {
    const gh = parseInt(m.gh, 10), ga = parseInt(m.ga, 10);
    if (Number.isNaN(gh) || Number.isNaN(ga)) continue;
    const hN = fifaUserOf(m.home, tp), aN = fifaUserOf(m.away, tp);
    if (hN === nick && aN === oppNick && gh > ga) return true;
    if (aN === nick && hN === oppNick && ga > gh) return true;
  }
  return false;
}

// Terminou a temporada da FIFA INVICTO (jogou tudo e não perdeu nenhum jogo).
function fifaUnbeaten(nick, ctx) {
  const cs = ctx && ctx.cs; if (!cs) return false;
  const rounds = cs.rounds || [];
  const allDone = rounds.length > 0 && rounds.every(r => Array.isArray(r) && r.length > 0 && r.every(g => g.gh !== '' && g.ga !== ''));
  if (!allDone) return false;
  const tp = (ctx && ctx.teamPlayers) || {};
  const st = computeStandings(rounds).find(s => fifaUserOf(s.id, tp) === nick);
  return !!st && st.j > 0 && st.d === 0;
}

// Hora local (0-23) em que um cupom foi criado, ou null.
function betHour(b) {
  if (!b || !b.createdAt) return null;
  try { return new Date(b.createdAt).getHours(); } catch (_) { return null; }
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
  ironStreak:  ({ nick, bets }) => maxBetStreak(bets, nick, 'won') >= 10,
  cursed:      ({ nick, bets }) => maxBetStreak(bets, nick, 'lost') >= 10,
  // Apostas por SEASON encerrada: rei (1º), vice (2º), mico (último no vermelho).
  betKing:     ({ nick, cs, bets }) => bettingSeasonRanks(nick, cs, bets).some(r => r.pos === 1),
  betVice:     ({ nick, cs, bets }) => bettingSeasonRanks(nick, cs, bets).some(r => r.pos === 2 && r.total >= 3),
  betMico:     ({ nick, cs, bets }) => bettingSeasonRanks(nick, cs, bets).some(r => r.pos === r.total && r.total >= 3 && r.lucro < 0 && r.apostas >= 5),
  // ── NOVAS (gamificação 2026-06) ──
  rookie:      ({ nick, bets }) => betsOf(bets, nick).length >= 1,
  centurion:   ({ nick, bets }) => betsOf(bets, nick).length >= 200,
  nightOwl:    ({ nick, bets }) => betsOf(bets, nick).some(b => { const h = betHour(b); return h !== null && h >= 0 && h < 5; }),
  oddInsane:   ({ nick, bets }) => betsOf(bets, nick).some(b => b.status === 'won' && Number(b.combinedOdds) >= 50),
  bigPayout:   ({ nick, bets }) => betsOf(bets, nick).some(b => b.status === 'won' && Number(b.payout) >= 50000),
  minimalist:  ({ nick, bets }) => betsOf(bets, nick).some(b => b.status === 'won' && Array.isArray(b.legs) && b.legs.length === 1),
  bronze:      ({ nick, cs, teamPlayers }) => { const p = champStandingPos(nick, cs, teamPlayers); return !!p && p.pos === 3; },
  podium:      ({ nick, cs, teamPlayers }) => { const p = champStandingPos(nick, cs, teamPlayers); return !!p && p.pos <= 3; },
  copaMarathon:({ nick, worldcup }) => Object.keys((worldcup && worldcup.picks && worldcup.picks[nick]) || {}).length >= 10,
  copaTrio:    ({ nick, worldcup }) => wcExactCount(nick, worldcup) >= 3,
  veteran:     ({ nick, interests }) => participationCount(nick, interests) >= 3,
  mkChamp:     (ctx) => mkStatsFor(ctx.nick, ctx).champion,
  mkFlawless:  (ctx) => mkStatsFor(ctx.nick, ctx).flawless,
  mkVice:      (ctx) => { const s = mkStatsFor(ctx.nick, ctx); return s.pos === 2 && s.total >= 3; },
  mkBronze:    (ctx) => { const s = mkStatsFor(ctx.nick, ctx); return s.pos === 3 && s.total >= 4; },
  mkLast:      (ctx) => { const s = mkStatsFor(ctx.nick, ctx); return s.isLast && s.total >= 3; },
  fifaUnbeaten:(ctx) => fifaUnbeaten(ctx.nick, ctx),
  // ── Apostas de VALOR ALTO ──
  megaRoller:  ({ nick, bets }) => betsOf(bets, nick).some(b => Number(b.amount) >= 500000),
  ultraRoller: ({ nick, bets }) => betsOf(bets, nick).some(b => Number(b.amount) >= 1000000),
  halfMilWin:  ({ nick, bets }) => betsOf(bets, nick).some(b => b.status === 'won' && Number(b.payout) >= 500000),
  jackpot:     ({ nick, bets }) => betsOf(bets, nick).some(b => b.status === 'won' && Number(b.payout) >= 1000000),
  megaWhale:   ({ nick, bets }) => totalWagered(bets, nick) >= 5000000,
  multiMil:    ({ nick, users }) => ((users || {})[nick]?.pc || 0) >= 1000000,
  // ── RIVAIS (zoeira interna do grupo) ──
  beatMohamedMk: (ctx) => mkStatsFor(ctx.nick, ctx).beat.indexOf('mohamed') >= 0,
  beatJucaFifa:  (ctx) => fifaBeat(ctx.nick, 'jucamelero', ctx),
  beatBaneLol:   () => false, // LoL ainda é "em breve" — dispara quando o campeonato abrir
};

// ─── CONQUISTAS (ACHIEVEMENTS) ──────────────────────────────────────────────
// FONTE ÚNICA do sistema de conquistas. Cada conquista:
//   - id        : estável (NÃO mudar — persiste em users[].title/.earnedTitles)
//   - name/desc : copy PT-BR
//   - icon/color: visual (Icon SVG + cor)
//   - cat       : categoria (ver ACH_CATS) — agrupa na UI
//   - rarity    : comum|rara|epica|lendaria → vira PONTOS via ACH_POINTS
//   - check     : predicado (de ACH) — ctx { nick, bets, users, teamPlayers, cs, worldcup, interests, comments, mk }
//   - rewards   : { badge?, frame? } — itens cosméticos (ITEMS) que a conquista DROPA
// O jogador escolhe 1 conquista pra exibir como LABEL ao lado do nick (equipar).
// Os pontos somados dão o "score de caçador" (ranking) e a base do CC.
const ACHIEVEMENTS = [
  // ── PARTICIPAÇÃO ──
  { id: 'beta_tester', name: 'BETA TESTER', icon: 'flask', color: '#7a4dc9', cat: 'participacao', rarity: 'rara',
    desc: 'Jogou a primeira temporada do Primitivão (FIFA 2026 Season 1).', check: ACH.betaTester, rewards: { badge: 'badge-beta' } },
  { id: 'veterano', name: 'VETERANO', icon: 'shield', color: '#6b4423', cat: 'participacao', rarity: 'rara',
    desc: 'Se inscreveu em 3 campeonatos ou mais. Já é da casa.', check: ACH.veteran },
  // ── CAMPEONATO (FIFA) ──
  { id: 'campeao', name: 'CAMPEÃO DA FIFA', icon: 'trophy', color: '#d4af37', cat: 'campeonato', rarity: 'lendaria',
    desc: 'Terminou uma temporada da FIFA em PRIMEIRO lugar. Leva o troféu pra casa.', check: ACH.champion, rewards: { badge: 'badge-campeao', frame: 'frame-gold' } },
  { id: 'fifa_invicto', name: 'INVICTO NA FIFA', icon: 'shield', color: '#2a8f3f', cat: 'campeonato', rarity: 'lendaria',
    desc: 'Terminou a temporada da FIFA SEM PERDER nenhum jogo. Muralha.', check: ACH.fifaUnbeaten },
  { id: 'vice', name: 'VICE-CAMPEÃO', icon: 'medal', color: '#9a9a9a', cat: 'campeonato', rarity: 'epica',
    desc: 'Terminou em SEGUNDO. A medalha de prata — tão perto, tão longe.', check: ACH.vice, rewards: { badge: 'badge-vice' } },
  { id: 'terceiro', name: 'TERCEIRO LUGAR', icon: 'medal', color: '#b06a2c', cat: 'campeonato', rarity: 'rara',
    desc: 'Terminou a temporada da FIFA em TERCEIRO. Pódio é pódio.', check: ACH.bronze },
  { id: 'podio', name: 'PÓDIO', icon: 'trophy', color: '#c9a227', cat: 'campeonato', rarity: 'epica',
    desc: 'Terminou uma temporada da FIFA no TOP 3. Entre os grandes.', check: ACH.podium },
  { id: 'penultimo', name: 'PENÚLTIMO', icon: 'toothbrush', color: '#6b4423', cat: 'campeonato', rarity: 'rara',
    desc: 'Terminou em PENÚLTIMO. Escapou da lanterna por um fio — mas o gostinho é quase o mesmo.', check: ACH.penultimo, rewards: { badge: 'badge-penultimo' } },
  { id: 'lanterna', name: 'LANTERNA', icon: 'toilet', color: '#7a2222', cat: 'campeonato', rarity: 'rara',
    desc: 'Terminou a temporada em ÚLTIMO. Vexame carimbado.', check: ACH.lanterna, rewards: { badge: 'badge-lanterna' } },
  // ── MORTAL KOMBAT ──
  { id: 'mk_campeao', name: 'CAMPEÃO DO MK', icon: 'sword', color: '#8a1f1f', cat: 'mk', rarity: 'lendaria',
    desc: 'Terminou uma temporada de Mortal Kombat em PRIMEIRO. FINISH HIM.', check: ACH.mkChamp, rewards: { badge: 'badge-fatality', frame: 'frame-fatality' } },
  { id: 'mk_flawless', name: 'FLAWLESS VICTORY', icon: 'fist', color: '#8a1f1f', cat: 'mk', rarity: 'epica',
    desc: 'Venceu um confronto de MK sem ceder NENHUM round. Perfeito.', check: ACH.mkFlawless },
  { id: 'mk_vice', name: 'VICE DO MK', icon: 'medal', color: '#9a9a9a', cat: 'mk', rarity: 'epica',
    desc: 'Terminou uma temporada de Mortal Kombat em SEGUNDO. Quase o cinturão.', check: ACH.mkVice },
  { id: 'mk_bronze', name: 'BRONZE DO MK', icon: 'medal', color: '#b06a2c', cat: 'mk', rarity: 'rara',
    desc: 'Terminou uma temporada de Mortal Kombat em TERCEIRO. No pódio das porradas.', check: ACH.mkBronze },
  { id: 'mk_lanterna', name: 'SACO DE PANCADA', icon: 'fist', color: '#7a2222', cat: 'mk', rarity: 'rara',
    desc: 'Terminou a temporada de MK em ÚLTIMO. Apanhou a season inteira.', check: ACH.mkLast },
  // ── APOSTAS: valor ──
  { id: 'high_roller', name: 'HIGH ROLLER', icon: 'coin', color: '#c9a227', cat: 'apostas', rarity: 'rara',
    desc: 'Apostou 100.000 PC ou mais num único cupom. Coragem (ou loucura).', check: ACH.highRoller, rewards: { badge: 'badge-high-roller' } },
  { id: 'high_roller_win', name: 'QUEBROU A BANCA', icon: 'coin-stack', color: '#2a8f3f', cat: 'apostas', rarity: 'lendaria',
    desc: 'Apostou 100k+ PC E venceu. A casa chorou.', check: ACH.brokeBank, rewards: { badge: 'badge-quebrou' } },
  { id: 'high_roller_loss', name: 'QUEIMOU 100K', icon: 'coin-fire', color: '#c33', cat: 'apostas', rarity: 'rara',
    desc: 'Apostou 100k+ PC E perdeu. Adeus, dinheirinho.', check: ACH.burned100k },
  { id: 'bolada', name: 'BOLADA', icon: 'coin-stack', color: '#2a8f3f', cat: 'apostas', rarity: 'epica',
    desc: 'Embolsou 50.000 PC ou mais num único cupom vencedor.', check: ACH.bigPayout },
  { id: 'milionario', name: 'MILIONÁRIO', icon: 'coin', color: '#d4af37', cat: 'apostas', rarity: 'epica',
    desc: 'Acumulou 100.000 PC ou mais no saldo. Banca gorda.', check: ACH.millionaire, rewards: { badge: 'badge-milionario' } },
  { id: 'tubarao', name: 'TUBARÃO', icon: 'coin-stack', color: '#2a6f8f', cat: 'apostas', rarity: 'lendaria',
    desc: 'Movimentou 1.000.000 PC somando todos os cupons. Peixe grande do mercado.', check: ACH.whale, rewards: { badge: 'badge-tubarao' } },
  // ── APOSTAS: valores ALTÍSSIMOS ──
  { id: 'mega_roller', name: 'MEGA ROLLER', icon: 'coin-fire', color: '#c9a227', cat: 'apostas', rarity: 'epica',
    desc: 'Apostou 500.000 PC ou mais num único cupom. Sangue nos olhos.', check: ACH.megaRoller },
  { id: 'ultra_roller', name: 'ULTRA ROLLER', icon: 'coin-fire', color: '#d4af37', cat: 'apostas', rarity: 'lendaria',
    desc: 'Apostou 1.000.000 PC ou mais num único cupom. Lenda do cassino.', check: ACH.ultraRoller },
  { id: 'meio_jackpot', name: 'MEIO MILHÃO', icon: 'coin-stack', color: '#2a8f3f', cat: 'apostas', rarity: 'epica',
    desc: 'Embolsou 500.000 PC ou mais num único cupom vencedor.', check: ACH.halfMilWin },
  { id: 'jackpot', name: 'JACKPOT', icon: 'coin-stack', color: '#d4af37', cat: 'apostas', rarity: 'lendaria',
    desc: 'Embolsou 1.000.000 PC ou mais num único cupom vencedor. A casa quebrou.', check: ACH.jackpot },
  { id: 'mega_tubarao', name: 'BALEIA', icon: 'coin-stack', color: '#2a6f8f', cat: 'apostas', rarity: 'lendaria',
    desc: 'Movimentou 5.000.000 PC somando todos os cupons. O maior fluxo do mercado.', check: ACH.megaWhale },
  { id: 'multimilionario', name: 'MULTIMILIONÁRIO', icon: 'coin', color: '#d4af37', cat: 'apostas', rarity: 'lendaria',
    desc: 'Acumulou 1.000.000 PC ou mais no saldo. Cofre transbordando.', check: ACH.multiMil },
  { id: 'falido', name: 'FALIDO', icon: 'coin-fire', color: '#7a2222', cat: 'apostas', rarity: 'comum',
    desc: 'Zerou o saldo. Já apostou de tudo, hoje só resta o bônus de domingo.', check: ACH.broke },
  // ── APOSTAS: volume ──
  { id: 'sorte_novato', name: 'SORTE DE NOVATO', icon: 'sparkle', color: '#c9a227', cat: 'apostas', rarity: 'comum',
    desc: 'Venceu a PRIMEIRA aposta da vida no Primitivão. Começou voando.', check: ACH.luckyStart, rewards: { badge: 'badge-novato' } },
  { id: 'estreante', name: 'ESTREANTE', icon: 'ticket', color: '#d76414', cat: 'apostas', rarity: 'comum',
    desc: 'Fez a primeira aposta no Primitivão. Bem-vindo ao balcão.', check: ACH.rookie },
  { id: 'apostador_plantao', name: 'APOSTADOR DE PLANTÃO', icon: 'ticket', color: '#d76414', cat: 'apostas', rarity: 'comum',
    desc: 'Fez 50 apostas ou mais. Não perde uma rodada.', check: ACH.grinder50 },
  { id: 'viciado', name: 'VICIADO EM PC', icon: 'dice', color: '#a8324f', cat: 'apostas', rarity: 'rara',
    desc: 'Fez 100 apostas ou mais. Procura ajuda (depois da próxima).', check: ACH.addict100 },
  { id: 'centuriao', name: 'CENTURIÃO', icon: 'dice', color: '#a8324f', cat: 'apostas', rarity: 'epica',
    desc: 'Fez 200 apostas ou mais. Lenda viva do balcão.', check: ACH.centurion },
  { id: 'madrugador', name: 'MADRUGADOR', icon: 'eye', color: '#3a78c2', cat: 'apostas', rarity: 'rara',
    desc: 'Fez uma aposta de madrugada (entre 0h e 5h). Sono é pra fracos.', check: ACH.nightOwl },
  // ── APOSTAS: skill ──
  { id: 'minimalista', name: 'MINIMALISTA', icon: 'check', color: '#2a8f3f', cat: 'apostas', rarity: 'comum',
    desc: 'Venceu uma aposta simples (1 palpite). Direto ao ponto.', check: ACH.minimalist },
  { id: 'profeta', name: 'PROFETA DAS ODDS', icon: 'target', color: '#3a78c2', cat: 'apostas', rarity: 'rara',
    desc: 'Venceu uma aposta com odd combinada de 20x ou mais. Vidência pura.', check: ACH.prophet, rewards: { badge: 'badge-profeta' } },
  { id: 'odd_insana', name: 'ODD INSANA', icon: 'target', color: '#7a4dc9', cat: 'apostas', rarity: 'epica',
    desc: 'Venceu uma aposta com odd combinada de 50x ou mais. Surreal.', check: ACH.oddInsane },
  { id: 'casadinha', name: 'REI DA CASADINHA', icon: 'chart', color: '#2a8f3f', cat: 'apostas', rarity: 'rara',
    desc: 'Venceu uma aposta casada com 5 palpites ou mais. Tudo ou nada.', check: ACH.parlayKing },
  { id: 'azarao', name: 'AZARÃO', icon: 'arrow-up-right', color: '#2a8f3f', cat: 'apostas', rarity: 'rara',
    desc: 'Venceu uma aposta simples com odd 5x ou mais. Ninguém dava nada por ele.', check: ACH.underdog, rewards: { badge: 'badge-azarao' } },
  { id: 'mao_quente', name: 'MÃO QUENTE', icon: 'fire', color: '#d76414', cat: 'apostas', rarity: 'rara',
    desc: 'Venceu 5 apostas seguidas. Tá pegando fogo, bicho.', check: ACH.hotHand, rewards: { badge: 'badge-mao-quente' } },
  { id: 'invencivel', name: 'INVENCÍVEL', icon: 'bolt', color: '#c9a227', cat: 'apostas', rarity: 'epica',
    desc: 'Venceu 10 apostas SEGUIDAS. Intocável — ninguém segura.', check: ACH.ironStreak },
  { id: 'tudo_ou_nada', name: 'TUDO OU NADA', icon: 'bolt', color: '#a8324f', cat: 'apostas', rarity: 'rara',
    desc: 'Montou uma casada com 8 palpites ou mais. Coragem (ou teimosia) de sobra.', check: ACH.allIn, rewards: { badge: 'badge-tudo-ou-nada' } },
  { id: 'pe_frio', name: 'PÉ FRIO', icon: 'skull', color: '#5a5a5a', cat: 'apostas', rarity: 'comum',
    desc: 'Perdeu 5 apostas seguidas. O VARIMITIVÃO tá de olho.', check: ACH.coldFoot },
  { id: 'amaldicoado', name: 'AMALDIÇOADO', icon: 'skull', color: '#3e0f0f', cat: 'apostas', rarity: 'rara',
    desc: 'Perdeu 10 apostas SEGUIDAS. O VARIMITIVÃO lavou as mãos.', check: ACH.cursed },
  // ── APOSTAS: season encerrada ──
  { id: 'rei_apostas', name: 'REI DAS APOSTAS', icon: 'crown', color: '#d4af37', cat: 'apostas', rarity: 'lendaria',
    desc: 'Terminou uma season no TOPO do ranking de apostas — o maior lucro da temporada. A coroa é sua.', check: ACH.betKing },
  { id: 'vice_apostas', name: 'VICE DAS APOSTAS', icon: 'coin-stack', color: '#9a9a9a', cat: 'apostas', rarity: 'epica',
    desc: 'Terminou em SEGUNDO no ranking de apostas de uma season. Faltou pouco pra coroa.', check: ACH.betVice },
  { id: 'mico_apostas', name: 'MICO DAS APOSTAS', icon: 'coin-fire', color: '#7a2222', cat: 'apostas', rarity: 'rara',
    desc: 'Terminou em ÚLTIMO no ranking de apostas de uma season, no vermelho. A casa agradece a preferência.', check: ACH.betMico },
  // ── COPA DO MUNDO ──
  { id: 'copa_player', name: 'BOLÃO DA COPA', icon: 'globe', color: '#1c7a6e', cat: 'copa', rarity: 'comum',
    desc: 'Palpitou em pelo menos um jogo da Copa do Mundo.', check: ACH.copaPlayer, rewards: { badge: 'badge-copa' } },
  { id: 'maratonista_copa', name: 'MARATONISTA DA COPA', icon: 'globe', color: '#1c7a6e', cat: 'copa', rarity: 'rara',
    desc: 'Palpitou em 10 jogos ou mais da Copa. Não perde uma.', check: ACH.copaMarathon },
  { id: 'vidente_copa', name: 'VIDENTE DA COPA', icon: 'target', color: '#3a78c2', cat: 'copa', rarity: 'rara',
    desc: 'Acertou um placar EXATO no bolão da Copa do Mundo (3 pts).', check: ACH.copaSeer, rewards: { badge: 'badge-vidente' } },
  { id: 'tika_taka', name: 'TIKA-TAKA', icon: 'target', color: '#1c7a6e', cat: 'copa', rarity: 'epica',
    desc: 'Acertou 3 placares EXATOS no bolão da Copa. Tá lendo o jogo.', check: ACH.copaTrio },
  { id: 'oraculo_copa', name: 'ORÁCULO DA COPA', icon: 'eye', color: '#1c7a6e', cat: 'copa', rarity: 'lendaria',
    desc: 'Acertou 5 placares EXATOS no bolão da Copa. Não é palpite, é dom.', check: ACH.copaOracle, rewards: { badge: 'badge-oraculo' } },
  // ── RIVAIS (zoeira interna do grupo) ──
  { id: 'vs_mohamed_mk', name: 'DETONOU O MOHAMED', icon: 'sword', color: '#8a1f1f', cat: 'rivais', rarity: 'rara',
    desc: 'Venceu o Mohamed num confronto de Mortal Kombat. Pode subir a treta.', check: ACH.beatMohamedMk },
  { id: 'vs_juca_fifa', name: 'PASSOU O JUCA', icon: 'football', color: '#d76414', cat: 'rivais', rarity: 'rara',
    desc: 'Venceu o Juca num jogo da FIFA. Joga na cara dele.', check: ACH.beatJucaFifa },
  { id: 'vs_bane_lol', name: 'DERRUBOU O BANE', icon: 'crosshair', color: '#3a78c2', cat: 'rivais', rarity: 'rara',
    desc: 'Venceu o Bane no League of Legends. (Dispara quando o LoL abrir.)', check: ACH.beatBaneLol },
];
// Categorias de conquista (ordem + rótulo na UI).
const ACH_CATS = [
  { id: 'campeonato',   label: 'CAMPEONATO' },
  { id: 'mk',           label: 'MORTAL KOMBAT' },
  { id: 'rivais',       label: 'RIVAIS' },
  { id: 'apostas',      label: 'APOSTAS' },
  { id: 'copa',         label: 'COPA DO MUNDO' },
  { id: 'participacao', label: 'PARTICIPAÇÃO' },
];
// Pontos por raridade — base do score de caçador E do CC (ver ccEarnedFor).
const ACH_POINTS = { comum: 50, rara: 120, epica: 250, lendaria: 500 };
const achPoints = (a) => (a && ACH_POINTS[a.rarity]) || 0;
const RARITY_LABEL = { comum: 'COMUM', rara: 'RARA', epica: 'ÉPICA', lendaria: 'LENDÁRIA' };
// ── SKILL TREE: ordem de progressão dentro de cada lane (categoria) ──────────
// Conquistas da mesma trilha ficam ADJACENTES (esq→dir) pra ler como "caminho"
// (ex: 50→100→200 apostas; high→mega→ultra roller). Fora de trilha cai no fim
// da lane, ordenado por raridade asc. IDs aqui têm que bater com ACHIEVEMENTS
// (um id errado só cai no fallback de raridade — não quebra).
const ACH_PATHS = [
  // campeonato
  ['terceiro', 'vice', 'campeao'], ['podio'], ['fifa_invicto'], ['penultimo', 'lanterna'],
  // mk
  ['mk_bronze', 'mk_vice', 'mk_campeao'], ['mk_flawless'], ['mk_lanterna'],
  // apostas: volume / valor / skill
  ['estreante', 'apostador_plantao', 'viciado', 'centuriao'], ['sorte_novato'], ['madrugador'],
  ['high_roller', 'mega_roller', 'ultra_roller'], ['high_roller_win', 'high_roller_loss'],
  ['bolada', 'meio_jackpot', 'jackpot'], ['milionario', 'multimilionario'], ['tubarao', 'mega_tubarao'],
  ['mao_quente', 'invencivel'], ['pe_frio', 'amaldicoado'],
  ['minimalista', 'azarao', 'profeta', 'odd_insana'], ['casadinha', 'tudo_ou_nada'], ['falido'],
  ['rei_apostas', 'vice_apostas', 'mico_apostas'],
  // copa
  ['copa_player', 'maratonista_copa'], ['vidente_copa', 'tika_taka', 'oraculo_copa'],
];
const RARITY_ORD = { comum: 0, rara: 1, epica: 2, lendaria: 3 };
const ACH_ORDER = (() => { const m = {}; ACH_PATHS.forEach((p, pi) => p.forEach((id, si) => { m[id] = pi * 100 + si; })); return m; })();
const achLaneSort = (a, b) => {
  const oa = ACH_ORDER[a.id], ob = ACH_ORDER[b.id];
  if (oa != null && ob != null) return oa - ob;
  if (oa != null) return -1;
  if (ob != null) return 1;
  return (RARITY_ORD[a.rarity] - RARITY_ORD[b.rarity]) || (achPoints(a) - achPoints(b));
};
// Alias retrocompat: muito código ainda referencia TITLE_DEFS / "título".
const TITLE_DEFS = ACHIEVEMENTS;
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

// Items que a conquista DROPA pra esse nick. FONTE: ACHIEVEMENTS[].rewards.
// Uma conquista entrega seu badge/frame quando está desbloqueada (latched em
// earnedTitles OU válida ao vivo). Só varremos conquistas COM rewards — isso
// evita recursão caso alguma conquista dependa de effectiveInventory (uma com
// reward nunca pode). Todos os items de reward são drops (sem price).
function itemsDroppedFor(nick, ctx) {
  const u = (((ctx && ctx.users) || {})[nick]) || {};
  const persisted = new Set(Array.isArray(u.earnedTitles) ? u.earnedTitles : []);
  const ids = new Set();
  for (const a of ACHIEVEMENTS) {
    if (!a.rewards) continue;
    let ok = persisted.has(a.id);
    if (!ok) { try { ok = !!a.check({ nick, ...ctx }); } catch (_) { ok = false; } }
    if (!ok) continue;
    if (a.rewards.badge) ids.add(a.rewards.badge);
    if (a.rewards.frame) ids.add(a.rewards.frame);
  }
  return ITEMS.filter(i => ids.has(i.id));
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

// Score de caçador = soma dos PONTOS (por raridade) das conquistas desbloqueadas.
function achievementScore(nick, ctx) {
  let s = 0;
  try { for (const a of titlesForNick(nick, ctx || {})) s += achPoints(a); } catch (_) {}
  return s;
}

// ── CAMPEÃO COINS (CC) — moeda da loja, RARA e de mérito ────────────────────
// Saldo DERIVADO (não some ao gastar): saldo = ganho + bônus_admin - gasto.
// GANHO vem de mérito: os PONTOS das conquistas (raridade vale mais) + cada
// CAMPEONATO em que o cara participou (inscrição). Como o CC = score de
// conquista, conquista rara/épica/lendária rende muito mais que comum.
// Ajuste ACH_POINTS (raridade) e CC_PER_PARTICIPATION pra calibrar a economia.
const CC_PER_PARTICIPATION = 25;   // por campeonato em que participou (inscrito)
function ccEarnedFor(nick, ctx) {
  if (!nick) return 0;
  let earned = 0;
  try { earned += achievementScore(nick, ctx || {}); } catch (_) {}  // 1 CC por ponto de conquista
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
// Slug do arquivo do ícone (igual ao gerador apostas/scripts/gen-mk-chars.mjs).
function mkCharSlug(name) { return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
// Badge do personagem: quadrado colorido + monograma de fundo + a imagem por
// cima. Tenta o RETRATO PNG (apostas/mk-chars/<slug>.png) primeiro; se faltar,
// cai pro ícone-símbolo SVG; se faltar os dois, fica só o monograma.
function MkCharIcon({ name, sm }) {
  const slug = mkCharSlug(name);
  return (
    <span className={'mk-fc-mono' + (sm ? ' sm' : '')} style={{ '--hue': mkHue(name) }}>
      {mkMono(name)}
      <img className="mk-char-ico" src={'mk-chars/' + slug + '.png'} alt="" loading="lazy"
        onError={e => {
          const img = e.currentTarget;
          if (img.dataset.fb !== 'svg') { img.dataset.fb = 'svg'; img.src = 'mk-chars/' + slug + '.svg'; }
          else { img.style.display = 'none'; }
        }} />
    </span>
  );
}
// Lado do confronto (mandante OU visitante) com os 3 bonecos como portraits
// clicáveis. `cur` = escolhido nessa partida; `taken` = travado (usado na outra).
function MkFighterPick({ nick, chars, cur, taken, onPick, teamPlayers }) {
  return (
    <div className="mk-fc-side">
      <div className="mk-fc-nick"><Avatar nick={nick} teamPlayers={teamPlayers} size={20} noBadge /> {nick}</div>
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
                <MkCharIcon name={c} />
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
      <div className="mk-fc-nick"><Avatar nick={nick} teamPlayers={teamPlayers} size={20} noBadge /> {nick}</div>
      {char ? (
        <div className="mk-fc-chosen">
          <MkCharIcon name={char} />
          <span className="mk-fc-cname">{char}</span>
        </div>
      ) : <div className="mk-fc-noelenco">a definir</div>}
    </div>
  );
}

// ─── MEU JOGO (MK) — elenco do turno + escalação dos confrontos ────────────
// O MANDANTE escala as 2 partidas dos jogos onde é mando (boneco dos DOIS lados,
// vindo do elenco de 3 de cada um). O VISITANTE só vê como o mandante dispôs.
// Versao MINI do MEU JOGO pro trilho esquerdo de CAMPEONATOS (embaixo da sidebar):
// mostra o ELENCO (3 personagens) e o CONFRONTO da rodada com os icones dos
// personagens. Clica e abre o MEU JOGO completo (escalacao/edicao).
function MeuJogoMini({ nick, users, interests, draw, scores, lineups, teamPlayers, onOpen, ko }) {
  const isInscrito = !!(((interests && interests.mk) || {})[nick]) && !mkIsWithdrawn(nick);
  const myChars = ((users || {})[nick] || {}).mkChars || [];
  // MATA-MATA publicado: o foco vira o confronto do KO (escalação blind MD5).
  const koPub = !!(ko && ko.published);
  const koBrMini = koPub ? mkKoBracket(ko.seeds || [], ko.scores || {}) : null;
  const koMyMatch = koBrMini ? MK_KO_IDS.map(id => koBrMini[id]).find(m => m.home && m.away && !m.done && (m.home === nick || m.away === nick)) : null;
  const koOpp = koMyMatch ? (koMyMatch.home === nick ? koMyMatch.away : koMyMatch.home) : null;
  const koStarted = koMyMatch ? mkKoMatchStarted((ko.scores || {})[koMyMatch.id]) : false;
  const koSaved = koMyMatch ? (mkKoDecodeLineup((((ko.lineups || {})[koMyMatch.id]) || {})[nick]) || []).length === 5 : false;
  const gKey = (r, gi) => r.phase + '-' + r.n + '-' + gi;
  // MEU JOGO segue o PRÓXIMO jogo DO JOGADOR (1ª rodada pendente dele), não a
  // rodada do campeonato — assim quem adiantou já vê/escala o próximo confronto.
  const myIdx = mkPlayerFirstPendingRound(nick, draw, scores);
  const curRound = (draw && myIdx < draw.length) ? draw[myIdx] : null;
  let myGame = null;
  if (curRound) {
    curRound.games.forEach((g, gi) => {
      if (g.home === nick || g.away === nick) myGame = { key: gKey(curRound, gi), g, mandante: g.home === nick, opp: g.home === nick ? g.away : g.home };
    });
  }
  // total de jogos pendentes do jogador — agora dá pra escalar todos, não só o próximo
  let pendingCount = 0;
  if (draw) draw.forEach((r) => (r.games || []).forEach((g, gi) => {
    if ((g.home === nick || g.away === nick) && !mkGameVoid(g) && !mkMatchOutcome((scores || {})[gKey(r, gi)] || {})) pendingCount++;
  }));
  const lu = myGame ? ((lineups || {})[myGame.key] || {}) : {};
  return (
    <div className="mj-mini">
      <button type="button" className="mj-mini-h" onClick={onOpen}>
        <span><Icon name="fist" size={12} /> MEU JOGO</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', color: 'var(--pv-orange)' }}>VER MEUS JOGOS <Icon name="arrow-right" size={11} /></span>
      </button>
      {!isInscrito ? (
        <div className="mj-mini-empty">Você não está no MK.</div>
      ) : koPub ? (
        // MATA-MATA: escala os 5 personagens (blind) do seu confronto aqui.
        koMyMatch ? (
          <>
            <div className="mj-mini-lbl mj-mini-lbl-ko"><Icon name="sword" size={11} /> MATA-MATA · {MK_KO_META[koMyMatch.id].label}</div>
            <div className="mj-mini-game">
              <div className="mj-mini-vs">
                <Avatar nick={nick} teamPlayers={teamPlayers} size={18} noBadge />
                <span className="mj-mini-x">×</span>
                <Avatar nick={koOpp} teamPlayers={teamPlayers} size={18} noBadge />
                <span className="mj-mini-opp">{koOpp}</span>
              </div>
              <div className={'mj-mini-ko-status ' + (koStarted ? 'live' : koSaved ? 'ok' : 'warn')}>
                {koStarted ? <><Icon name="lock" size={10} /> em andamento — ordem travada</>
                  : koSaved ? <><Icon name="check" size={10} /> escalação blind salva (dá pra editar)</>
                  : <><Icon name="warning" size={10} /> escale seus 5 personagens (máx 2x)</>}
              </div>
            </div>
            <button type="button" className="mj-mini-cta mj-mini-cta-ko" onClick={onOpen}>
              {koStarted ? 'VER CONFRONTO' : koSaved ? 'EDITAR ESCALAÇÃO' : 'ESCALAR MD5'} <Icon name="chevron-right" size={11} />
            </button>
          </>
        ) : (
          <>
            <div className="mj-mini-lbl mj-mini-lbl-ko"><Icon name="sword" size={11} /> MATA-MATA</div>
            <div className="mj-mini-warn">Sem confronto aberto pra você agora. Acompanhe a chave em CAMPEONATOS.</div>
            <button type="button" className="mj-mini-cta" onClick={onOpen}>VER MEUS JOGOS <Icon name="chevron-right" size={11} /></button>
          </>
        )
      ) : (
        <>
          <div className="mj-mini-lbl">MEU ELENCO <span>{myChars.length}/{MK_MAX_CHARS}</span></div>
          {myChars.length ? (
            <div className="mj-mini-chars">
              {myChars.map(c => (
                <span key={c} className="mj-mini-char" title={c}><MkCharIcon name={c} /><span className="mj-mini-cn">{c}</span></span>
              ))}
            </div>
          ) : (
            <div className="mj-mini-warn">Monte seu elenco — toque pra abrir.</div>
          )}
          {curRound && <div className="mj-mini-lbl">PRÓXIMO · RODADA {String(curRound.n).padStart(2, '0')} · {curRound.phase}{pendingCount > 1 && <span>+{pendingCount - 1} pendentes</span>}</div>}
          {curRound && (myGame ? (
            <div className="mj-mini-game">
              <div className="mj-mini-vs">
                <Avatar nick={nick} teamPlayers={teamPlayers} size={18} noBadge />
                <span className="mj-mini-x">×</span>
                <Avatar nick={myGame.opp} teamPlayers={teamPlayers} size={18} noBadge />
                <span className="mj-mini-opp">{myGame.opp}</span>
              </div>
              <div className="mj-mini-parts">
                {['p1', 'p2'].map((p, pi) => {
                  const pr = lu[p] || {};
                  return (
                    <div key={p} className="mj-mini-part">
                      <span className="mj-mini-pn">{pi + 1}</span>
                      {pr.home ? <MkCharIcon name={pr.home} /> : <span className="mj-mini-tbd">?</span>}
                      <span className="mj-mini-px">vs</span>
                      {pr.away ? <MkCharIcon name={pr.away} /> : <span className="mj-mini-tbd">?</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="mj-mini-warn">Folga nessa rodada.</div>
          ))}
          <button type="button" className="mj-mini-cta" onClick={onOpen}>
            {myGame && myGame.mandante ? 'ESCALAR / EDITAR' : 'VER MEUS JOGOS'} <Icon name="chevron-right" size={11} />
          </button>
        </>
      )}
    </div>
  );
}

function MeuJogoView({ nick, isAdmin, users, interests, onSave, draw, scores, lineups, onSlot, teamPlayers, ko, onKoLineup }) {
  const inscritos = mkInscritos(interests).sort();
  const [target, setTarget] = useState(isAdmin ? (inscritos[0] || '') : nick);
  const [sel, setSel] = useState(((users || {})[isAdmin ? (inscritos[0] || '') : nick] || {}).mkChars || []);
  const [busy, setBusy] = useState(false);
  // Jogos do mandante abrem TODOS por padrão (montar tudo de uma vez); cada um
  // pode ser recolhido individualmente. collapsed[key]=true => recolhido.
  const [collapsed, setCollapsed] = useState({});
  useEffect(() => { setSel(((users || {})[target] || {}).mkChars || []); }, [target, users]);
  useEffect(() => { setCollapsed({}); }, [target]);

  const isInscrito = !!(((interests && interests.mk) || {})[target]) && !mkIsWithdrawn(target);
  const charsFor = (n) => ((users || {})[n] || {}).mkChars || [];
  const toggle = (c) => setSel(prev => prev.includes(c) ? prev.filter(x => x !== c) : (prev.length >= MK_MAX_CHARS ? prev : [...prev, c]));
  const save = async () => {
    if (busy || !target) return;
    setBusy(true);
    try {
      const res = await onSave(target, sel);
      if (res && res.err) { showToast(res.err, 'error'); return; }
      showToast('Elenco salvo pra ' + target + '!', 'success');
    }
    catch (e) { showToast('Falha ao salvar.', 'error'); }
    finally { setBusy(false); }
  };

  // TODOS OS JOGOS DO JOGADOR (não só a rodada atual). Agora que quase todo mundo
  // montou elenco, o mandante já pode escalar o card de luta de TODOS os seus
  // confrontos que ainda não foram jogados — sem esperar rodada por rodada.
  // Os jogos pendentes de um jogador são sempre um sufixo contíguo (só dá pra
  // jogar a rodada N depois de concluir as anteriores), então a ordem cronológica
  // já deixa o PRÓXIMO no topo. Jogos já encerrados saem da lista (nada pra escalar).
  const gKey = (r, gi) => r.phase + '-' + r.n + '-' + gi;
  const nextRoundIdx = mkPlayerFirstPendingRound(target, draw, scores);
  const myGames = [];
  if (draw && target) {
    draw.forEach((r, ri) => {
      (r.games || []).forEach((g, gi) => {
        if (g.home !== target) return; // SÓ jogos onde sou MANDANTE (é quem escala o card)
        if (mkGameVoid(g)) return; // jogo anulado (adversário retirado) — some
        const key = gKey(r, gi);
        if (mkMatchOutcome((scores || {})[key] || {})) return; // já jogado
        myGames.push({ key, phase: r.phase, n: r.n, ri, g, mandante: true, isNext: ri === nextRoundIdx });
      });
    });
  }
  // ELENCO TRAVADO por FASE: trava quando o jogador joga 1 confronto da fase
  // atual. Na virada IDA->VOLTA libera de novo (até jogar a 1ª partida da volta).
  const rosterLocked = mkRosterLockedFor(target, draw, scores);
  const rosterPhase = mkCurrentPhase(draw, scores);
  // Atualiza um slot da escalação (mandante). lineups[key] = { p1:{home,away}, p2:{home,away} }
  const setSlot = (key, part, side, val) => onSlot(key, part, side, val);

  // MATA-MATA: escalação BLIND do MD5 (5 personagens em ordem) do PRÓPRIO
  // confronto ativo do jogador LOGADO — aparece no topo do MEU JOGO quando o KO
  // está publicado. (No KO cada um escala o seu, diferente da liga.)
  const koBrMJ = ko && ko.published ? mkKoBracket(ko.seeds || [], ko.scores || {}) : null;
  const koMyMatch = koBrMJ ? MK_KO_IDS.map(id => koBrMJ[id]).find(m => m.home && m.away && !m.done && (m.home === nick || m.away === nick)) : null;

  return (
    <>
    {koMyMatch && (
      <MkKoMyMatch key={koMyMatch.id + ':' + ((((ko || {}).lineups || {})[koMyMatch.id] || {})[nick] || '')}
        match={koMyMatch} myNick={nick} ko={ko} onKoLineup={onKoLineup} teamPlayers={teamPlayers} />
    )}
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
              {inscritos.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        {!isInscrito ? (
          <div className="empty">
            <div className="e1">SEM INSCRIÇÃO NO MK</div>
            <div className="e2">{isAdmin ? 'Esse jogador não está inscrito no MK.' : 'Você não está inscrito no Mortal Kombat. Inscreva-se na aba CAMPEONATOS.'}</div>
          </div>
        ) : (
          <div className="mk-jogo-secs">
            {/* ELENCO DO TURNO (3 fixos) — via CSS aparece DEPOIS do "meu jogo da rodada". */}
            <div className="mk-jogo-sec">
              <div className="mk-jogo-sec-h"><Icon name="user" size={13} /> MEU ELENCO DO TURNO <span className="mk-jogo-sec-c">{sel.length}/{MK_MAX_CHARS}</span></div>
              {rosterLocked ? (
                <div className="mk-roster-lock"><Icon name="lock" size={12} /> <span><strong>Elenco travado.</strong> {isAdmin ? 'Esse jogador já' : 'Você já'} jogou na {rosterPhase} — o elenco destrava de novo quando a {rosterPhase === 'IDA' ? 'VOLTA' : 'próxima fase'} começar.</span></div>
              ) : (
                <p className="mk-jogo-hint">Seus <strong>{MK_MAX_CHARS} personagens fixos</strong> da <strong>{rosterPhase}</strong>. Escolhe com calma: <strong>quando você joga a 1ª partida da {rosterPhase}, o elenco trava</strong> — e libera de novo na virada do turno. O mandante escala esses bonecos.</p>
              )}
              <div className="mk-roster">
                {MK_CHARACTERS.map(c => {
                  const on = sel.includes(c);
                  return (
                    <button key={c} type="button" className={'mk-char' + (on ? ' on' : '') + (rosterLocked ? ' locked' : '')} onClick={() => toggle(c)} title={rosterLocked ? 'Elenco travado' : c} disabled={rosterLocked}>
                      {on && <span className="mk-char-slot">{sel.indexOf(c) + 1}</span>}
                      <span className="mk-char-ic"><Icon name={on ? 'fist' : 'user'} size={18} /></span>
                      <span className="mk-char-name">{c}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mk-foot">
                <div className="mk-selected">{sel.length}/{MK_MAX_CHARS} escolhidos{sel.length ? ': ' + sel.join(' · ') : ''}</div>
                {!rosterLocked && <button className="tp-btn-go" onClick={save} disabled={busy || sel.length === 0}>{busy ? 'SALVANDO…' : 'SALVAR ELENCO'}</button>}
              </div>
            </div>

            {/* MEU JOGO DA RODADA ATUAL (escalação do confronto) */}
            <div className="mk-jogo-sec">
              <div className="mk-jogo-sec-h"><Icon name="skull" size={13} /> MEUS JOGOS EM CASA {myGames.length > 0 && <span className="mk-jogo-sec-c">{myGames.length} pra montar</span>}</div>
              {myGames.length > 0 && <p className="mk-jogo-hint">Você é o <strong>MANDANTE</strong> nesses confrontos — monta o card de luta de todos de uma vez. Os jogos fora de casa quem escala é o adversário.</p>}
              {!draw ? (
                <div className="mk-jogo-empty"><Icon name="dice" size={20} /> As rodadas ainda não foram sorteadas. {isAdmin ? 'Sorteie em CAMPEONATOS.' : 'Aguarde o sorteio.'}</div>
              ) : myGames.length === 0 ? (
                <div className="mk-jogo-empty"><Icon name="trophy" size={18} /> {isAdmin ? target + ' já jogou' : 'Você já jogou'} todos os jogos do turno. Nada pra escalar agora.</div>
              ) : (
                <div className="mk-jogo-list">
                  {myGames.map(mg => {
                    const opp = mg.mandante ? mg.g.away : mg.g.home;
                    const lu = lineups[mg.key] || {};
                    const homeChars = charsFor(mg.g.home);
                    const awayChars = charsFor(mg.g.away);
                    const arranged = ['p1', 'p2'].some(p => (lu[p] || {}).home || (lu[p] || {}).away);
                    const filled = ['p1', 'p2'].reduce((nn, p) => nn + ((lu[p] || {}).home ? 1 : 0) + ((lu[p] || {}).away ? 1 : 0), 0);
                    const open = !collapsed[mg.key];
                    // selinho de status no cabeçalho (pra ver de relance sem abrir)
                    let stTxt, stCls;
                    if (mg.mandante) {
                      if (filled === 4) { stTxt = 'PRONTO'; stCls = 'ok'; }
                      else if (filled === 0) { stTxt = 'MONTAR'; stCls = 'todo'; }
                      else { stTxt = filled + '/4'; stCls = 'partial'; }
                    } else {
                      stTxt = arranged ? 'CARD PRONTO' : 'AGUARDANDO'; stCls = arranged ? 'ok' : 'wait';
                    }
                    return (
                      <div key={mg.key} className={'mk-jogo-card' + (mg.mandante ? ' is-mandante' : '') + (mg.isNext ? ' is-next' : '') + (open ? ' is-open' : '')}>
                        {/* Cabeçalho + linha do confronto = UM botão: o card fechado
                            inteiro abre/fecha (a linha com avatares é a área mais
                            convidativa). span no lugar de div: div dentro de button
                            é HTML inválido. */}
                        <button type="button" className="mk-jogo-card-h" aria-expanded={open} onClick={() => setCollapsed(c => ({ ...c, [mg.key]: !c[mg.key] }))}>
                          <span className="mk-jogo-rod">RODADA {String(mg.n).padStart(2, '0')} · {mg.phase}{mg.isNext && <span className="mk-jogo-next">PRÓXIMO</span>}</span>
                          <span className="mk-jogo-hmeta">
                            <span className={'mk-jogo-role ' + (mg.mandante ? 'mandante' : 'visitante')}>{mg.mandante ? 'MANDANTE' : 'VISITANTE'}</span>
                            <span className={'mk-jogo-st ' + stCls}>{stTxt}</span>
                            <span className={'mk-jogo-chev' + (open ? ' open' : '')}><Icon name="chevron-right" size={14} /></span>
                          </span>
                          <span className="mk-jogo-vs">
                            <span className="mk-jogo-vs-side"><Avatar nick={target} teamPlayers={teamPlayers} size={24} noBadge /> {target}</span>
                            <span className="mk-jogo-vs-x">×</span>
                            <span className="mk-jogo-vs-side opp">{opp} <Avatar nick={opp} teamPlayers={teamPlayers} size={24} noBadge /></span>
                          </span>
                        </button>

                        {open && (mg.mandante ? (
                          <div className="mk-jogo-arr">
                            <div className="mk-jogo-arr-hint"><Icon name="fist" size={11} /> Monta o CARD DE LUTA — escolhe o boneco dos dois lados em cada partida.</div>
                            {homeChars.length === 0 && (
                              <div className="mk-jogo-warn">Escolhe teu elenco logo abaixo pra poder escalar.</div>
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
                              {filled === 4
                                ? <button type="button" className="mk-fc-confirm" onClick={() => { setCollapsed(c => ({ ...c, [mg.key]: true })); showToast('Escalação confirmada — FIGHT!', 'success'); }}>
                                    <Icon name="check" size={14} /> CONFIRMAR ESCALAÇÃO
                                  </button>
                                : <div className="mk-fc-todo">Escala os 2 lados das 2 partidas · <strong>{filled}/4</strong></div>}
                            </div>
                          </div>
                        ) : (
                          <div className="mk-jogo-arr ro">
                            <div className="mk-jogo-arr-hint"><Icon name="eye" size={11} /> {mg.g.home} (mandante) monta o card — você só vê.</div>
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
                                <div className="mk-fc-wait"><Icon name="refresh" size={13} /> Aguardando {mg.g.home} montar o card de luta.</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
    </>
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

// LANÇADOR DE RESULTADOS do MK (MOD, sem classificação): lista os jogos —
// PENDENTES primeiro — com busca por jogador. Cada linha lança pelas bolinhas de
// round + 1º round + finalização. Toggle mostra os já lançados (pra corrigir).
function MkResultLauncher({ draw, scores, lineups, teamPlayers, onScore }) {
  const [q, setQ] = useState('');
  const [showDone, setShowDone] = useState(false);
  const gKey = (r, gi) => r.phase + '-' + r.n + '-' + gi;
  const setFinisher = (key, which, val) => onScore(key, { [which]: val || undefined });
  const all = (draw || []).flatMap(r => (r.games || []).map((g, gi) => ({ r, gi, g, key: gKey(r, gi) })).filter(x => !mkGameVoid(x.g)));
  const qq = q.trim().toLowerCase();
  const pendingCount = all.filter(x => !mkMatchOutcome(scores[x.key] || {})).length;
  const list = all.filter(x => {
    const done = !!mkMatchOutcome(scores[x.key] || {});
    if (!showDone && done) return false;
    if (qq && !((x.g.home + ' ' + x.g.away).toLowerCase().includes(qq))) return false;
    return true;
  });
  return (
    <div className="card mk-card">
      <div className="card-head">
        <div className="title"><Icon name="whistle" size={16} /> LANÇAR RESULTADO · MK</div>
        <div className="sub">{pendingCount} PENDENTE{pendingCount === 1 ? '' : 'S'}</div>
      </div>
      <div className="card-body">
        <div className="mk-admin-note" style={{ marginBottom: 12 }}><Icon name="shield" size={12} /> Lançamento por jogo — pendentes primeiro. Toque as bolinhas dos rounds; marque o 1º round e a finalização. Busca pelo nome do jogador.</div>
        <div className="mk-launch-tools">
          <input className="mk-launch-search" value={q} onChange={e => setQ(e.target.value)} placeholder="buscar jogador (ex: vitinho)" />
          <label className="mk-launch-toggle"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> mostrar já lançados</label>
        </div>
        {list.length === 0 ? (
          <div className="empty"><div className="e1">{showDone ? 'NENHUM JOGO' : 'TUDO LANÇADO'}</div><div className="e2">{qq ? 'Nada pra essa busca.' : (showDone ? 'Sem jogos no chaveamento.' : 'Não há jogos pendentes.')}</div></div>
        ) : (
          <div className="mk-launch-list">
            {list.map(({ r, gi, g, key }) => {
              const sc = scores[key] || {};
              const out = mkMatchOutcome(sc);
              const done = !!out;
              return (
                <div key={key} className={'mk-launch-row' + (done ? ' done' : '')}>
                  <div className="mk-launch-h">
                    <span className="mk-launch-rod">RODADA {String(r.n).padStart(2, '0')} · {r.phase} · JOGO {String(gi + 1).padStart(2, '0')}</span>
                    <span className={'mk-launch-st ' + (done ? 'done' : 'pend')}>
                      {done ? <><Icon name="check" size={11} /> {out.wo ? 'W.O.' : <>{out.confH}×{out.confA}{out.winner === 'D' ? ' EMPATE' : ''}</>}</> : <>A LANÇAR</>}
                    </span>
                  </div>
                  <div className="mk-launch-match">
                    <span className="mk-launch-nick mand">{g.home}</span>
                    <span className="mk-launch-vs">×</span>
                    <span className="mk-launch-nick">{g.away}</span>
                  </div>
                  <MkRoundDots sc={sc} lineup={(lineups || {})[key]} onPatch={(patch) => onScore(key, patch)} />
                  <div className="rl-extras mk-launch-extras">
                    <span className="rl-extra-grp">
                      <span className="rl-extra-l">1º ROUND</span>
                      <button type="button" className={'rl-pick home' + (sc.firstRound === 'H' ? ' on' : '')} onClick={() => onScore(key, { firstRound: sc.firstRound === 'H' ? '' : 'H' })}>{g.home}</button>
                      <button type="button" className={'rl-pick away' + (sc.firstRound === 'A' ? ' on' : '')} onClick={() => onScore(key, { firstRound: sc.firstRound === 'A' ? '' : 'A' })}>{g.away}</button>
                    </span>
                    <span className="rl-extra-grp">
                      <span className="rl-extra-l"><Icon name="skull" size={11} /> FINALIZAÇÃO</span>
                      <span className="mk-fx-finish-pl">P1</span>
                      <select className="mk-fx-finish-sel" value={sc.finisher1 || ''} onChange={e => setFinisher(key, 'finisher1', e.target.value)}>
                        <option value="">Nenhuma</option>
                        {MK_FINISHERS.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                      <span className="mk-fx-finish-pl">P2</span>
                      <select className="mk-fx-finish-sel" value={sc.finisher2 || ''} onChange={e => setFinisher(key, 'finisher2', e.target.value)}>
                        <option value="">Nenhuma</option>
                        {MK_FINISHERS.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MATA-MATA — COMPONENTES ────────────────────────────────────────────────
// Selo de seed (1º..8º) com a cor do top-8 da classificação.
function MkKoSeedTag({ n }) {
  const col = n >= 1 && n <= 8 ? MK_TOP8_COLORS[n - 1] : undefined;
  return <span className="mk-ko-seed" style={col ? { borderColor: col, color: col } : undefined}>{n ? n + 'º' : '?'}</span>;
}
// Trilha do MD5: 5 quadradinhos, um por jogo — laranja = mandante levou,
// vermelho = visitante levou, contorno pulsante = próximo jogo, vazio = não rolou.
function MkKoGameDots({ o }) {
  return (
    <span className="mk-ko-dots" title={'MD5 — vence quem fizer 3 · ' + o.h + '×' + o.a}>
      {[1, 2, 3, 4, 5].map(n => {
        const g = (o.games || []).find(x => x.n === n);
        const cls = g ? (g.winner === 'H' ? ' h' : ' a') : (!o.done && o.next === n ? ' next' : '');
        return <i key={n} className={'mk-ko-dot' + cls} />;
      })}
    </span>
  );
}
// Card de UM confronto do mata-mata. `seedOf` = { nick: 1..8 }.
function MkKoMatchCard({ m, seedOf, teamPlayers, myNick }) {
  const meta = MK_KO_META[m.id];
  const started = (m.o.games || []).length > 0;
  const mine = !!(myNick && (m.home === myNick || m.away === myNick));
  const status = m.done ? (m.o.h + '×' + m.o.a)
    : (!m.home || !m.away) ? 'A DEFINIR'
    : started ? ('EM ANDAMENTO · ' + m.o.h + '×' + m.o.a) : 'AGUARDANDO';
  const row = (nick, side) => {
    const isWin = m.done && m.winner === nick;
    const isLose = m.done && m.loser === nick;
    return (
      <div className={'mk-ko-pl' + (isWin ? ' win' : '') + (isLose ? ' lose' : '')}>
        {nick ? (
          <>
            <MkKoSeedTag n={seedOf[nick]} />
            <Avatar nick={nick} teamPlayers={teamPlayers} size={22} noBadge />
            <span className="mk-ko-nick">{nick}</span>
            {isWin && <span className="mk-ko-wintag"><Icon name="check" size={10} /> VENCEU</span>}
          </>
        ) : (
          <span className="mk-ko-tbd"><Icon name="question" size={11} /> {(meta.hints || {})[side] || 'a definir'}</span>
        )}
        <span className={'mk-ko-score' + (isWin ? ' win' : '')}>{m.home && m.away ? (side === 'home' ? m.o.h : m.o.a) : ''}</span>
      </div>
    );
  };
  return (
    <div className={'mk-ko-match' + (m.done ? ' done' : '') + (mine ? ' mine' : '') + (m.id === 'F' ? ' final' : '')}>
      <div className="mk-ko-match-h">
        <span className="mk-ko-match-lb">{m.id === 'F' && <Icon name="crown" size={11} />}{m.id === 'T3' && <Icon name="medal-3" size={11} />} {meta.label}{mine && <span className="mk-ko-minetag"><Icon name="fist" size={9} /> SEU JOGO</span>}</span>
        <span className={'mk-ko-match-st' + (m.done ? ' done' : '')}>{status}</span>
      </div>
      {row(m.home, 'home')}
      <div className="mk-ko-mid"><MkKoGameDots o={m.o} /></div>
      {row(m.away, 'away')}
      <div className="mk-ko-dest"><Icon name="arrow-right" size={9} /> {meta.dest}</div>
    </div>
  );
}
// O CHAVEAMENTO em colunas de fase. Colunas: 1ª FASE → DECISÃO → SEMIS → TÍTULO.
function MkKoBracketView({ br, seedOf, teamPlayers, myNick, preview }) {
  const col = (title, cap, ids, extra) => (
    <div className="mk-ko-col">
      <div className="mk-ko-col-h"><span className="mk-ko-col-t">{title}</span><span className="mk-ko-col-c">{cap}</span></div>
      {extra}
      {ids.map(id => <MkKoMatchCard key={id} m={br[id]} seedOf={seedOf} teamPlayers={teamPlayers} myNick={myNick} />)}
    </div>
  );
  return (
    <div className={'mk-ko-wrap' + (preview ? ' preview' : '')}>
      {preview && <div className="mk-ko-stamp">PRÉVIA</div>}
      <div className="mk-ko-cols">
        {col('1ª FASE', '3º ao 8º entram aqui', ['R1', 'R2', 'R3'])}
        <div className="mk-ko-flow"><Icon name="arrow-right" size={16} /></div>
        {col('DECISÃO', 'repescagem se resolve', ['R4'], (
          <div className="mk-ko-note"><Icon name="shield" size={11} /> <strong>1º e 2º descansam</strong> — cabeças de chave entram direto nas semifinais.</div>
        ))}
        <div className="mk-ko-flow"><Icon name="arrow-right" size={16} /></div>
        {col('SEMIFINAIS', 'cabeças de chave entram', ['SF1', 'SF2'])}
        <div className="mk-ko-flow"><Icon name="arrow-right" size={16} /></div>
        {col('TÍTULO', 'coroa e pódio', ['F', 'T3'])}
      </div>
    </div>
  );
}
// Pódio quando a final (e o 3º lugar) fecharem.
function MkKoPodium({ br, teamPlayers }) {
  if (!br.F.done) return null;
  const spots = [
    { nick: br.F.winner, t: 'CAMPEÃO', icon: 'crown', col: MK_PODIUM_COLORS[0] },
    { nick: br.F.loser, t: 'VICE', icon: 'medal', col: MK_PODIUM_COLORS[1] },
    br.T3.done ? { nick: br.T3.winner, t: '3º LUGAR', icon: 'medal-3', col: MK_PODIUM_COLORS[2] } : null,
  ].filter(Boolean);
  return (
    <div className="mk-ko-podium">
      {spots.map(s => (
        <div key={s.t} className="mk-ko-podium-spot" style={{ borderColor: s.col }}>
          <span className="mk-ko-podium-ic" style={{ color: s.col }}><Icon name={s.icon} size={18} /></span>
          <Avatar nick={s.nick} teamPlayers={teamPlayers} size={30} noBadge />
          <span className="mk-ko-podium-nick">{s.nick}</span>
          <span className="mk-ko-podium-t" style={{ color: s.col }}>{s.t}</span>
        </div>
      ))}
    </div>
  );
}
// Escalação BLIND do MD5 — o jogador declara a ORDEM dos 5 personagens do SEU
// confronto. Trava quando o 1º jogo é lançado. O adversário nunca vê antes.
function MkKoMyMatch({ match, myNick, ko, onKoLineup, teamPlayers }) {
  const opp = match.home === myNick ? match.away : match.home;
  const rawMine = (((ko.lineups || {})[match.id]) || {})[myNick];
  const saved = mkKoDecodeLineup(rawMine);
  const [list, setList] = useState(() => (saved && saved.length === 5 ? saved : ['', '', '', '', '']));
  const [busy, setBusy] = useState(false);
  // "começou" olha o DOC (robusto a buraco de correção do mod) — mesma regra do reducer.
  const started = mkKoMatchStarted((ko.scores || {})[match.id]);
  // Depois que trava, o que vale é o que foi SALVO — não a edição local não salva.
  const shown = started ? (saved && saved.length === 5 ? saved : list) : list;
  const probs = mkKoLineupProblems(list);
  const dirty = JSON.stringify(list) !== JSON.stringify(saved || ['', '', '', '', '']);
  const countOf = (c) => list.filter(x => x === c).length;
  const save = async () => {
    if (probs.length || busy) return;
    setBusy(true);
    const r = await onKoLineup(match.id, list);
    setBusy(false);
    if (r && r.err) showToast(r.err, 'error');
    else showToast('Escalação salva — blind, só você vê.', 'success');
  };
  const rawOpp = (((ko.lineups || {})[match.id]) || {})[opp];
  const oppList = mkKoDecodeLineup(rawOpp);
  const meta = MK_KO_META[match.id];
  return (
    <div className="mk-ko-my">
      <div className="mk-ko-my-h">
        <span className="mk-ko-my-t"><Icon name="fist" size={13} /> SEU CONFRONTO · {meta.label}</span>
        <span className="mk-ko-my-blind"><Icon name="eye-off" size={11} /> BLIND — {opp} não vê sua ordem</span>
      </div>
      <div className="mk-ko-my-vs">
        <Avatar nick={myNick} teamPlayers={teamPlayers} size={22} noBadge /> <strong>{myNick}</strong>
        <span className="mk-ko-my-x">×</span>
        <Avatar nick={opp} teamPlayers={teamPlayers} size={22} noBadge /> <strong>{opp}</strong>
        <span className="mk-ko-my-md5">MD5 · vence quem fizer 3 · máx 2x o mesmo personagem</span>
      </div>
      <div className="mk-ko-my-slots">
        {[0, 1, 2, 3, 4].map(i => {
          const played = (match.o.games || []).find(g => g.n === i + 1);
          const oppRevealed = oppList && mkKoPickRevealed(match.o, i + 1, opp, myNick);
          const myWon = played && ((played.winner === 'H') === (match.home === myNick));
          return (
            <div key={i} className={'mk-ko-slot' + (played ? (myWon ? ' won' : ' lost') : '')}>
              <span className="mk-ko-slot-n">J{i + 1}</span>
              {started ? (
                <span className="mk-ko-slot-fix">{shown[i] ? <><MkCharIcon name={shown[i]} sm /> {shown[i]}</> : <span className="mk-ko-slot-empty">—</span>}</span>
              ) : (
                <select className="mk-ko-slot-sel" value={list[i]} onChange={e => { const v = e.target.value; setList(l => l.map((x, j) => j === i ? v : x)); }}>
                  <option value="">— escolher —</option>
                  {MK_CHARACTERS.map(c => (
                    <option key={c} value={c} disabled={c !== list[i] && countOf(c) >= 2}>{c}{countOf(c) >= 2 && c !== list[i] ? ' (2x)' : ''}</option>
                  ))}
                </select>
              )}
              <span className="mk-ko-slot-opp">
                {played ? (myWon ? <span className="mk-ko-slot-res win"><Icon name="check" size={10} /> VENCEU</span> : <span className="mk-ko-slot-res lose"><Icon name="x" size={10} /> PERDEU</span>) : null}
                {oppRevealed ? <span className="mk-ko-slot-oppc">vs <MkCharIcon name={oppList[i]} sm /> {oppList[i]}</span>
                  : <span className="mk-ko-slot-oppc hidden"><Icon name="eye-off" size={10} /> {opp}: oculto</span>}
              </span>
            </div>
          );
        })}
      </div>
      {started ? (
        <div className="mk-ko-my-foot"><Icon name="lock" size={11} /> Confronto em andamento — ordem travada.</div>
      ) : (
        <div className="mk-ko-my-foot">
          {probs.length > 0 && dirty && <span className="mk-ko-my-err"><Icon name="warning" size={11} /> {probs[0]}</span>}
          {saved && !dirty && <span className="mk-ko-my-ok"><Icon name="check" size={11} /> Escalação salva. Dá pra editar até o 1º jogo ser lançado.</span>}
          <button type="button" className="tp-btn-go mk-ko-my-save" disabled={probs.length > 0 || !dirty || busy} onClick={save}>
            <Icon name="eye-off" size={13} /> {busy ? 'SALVANDO…' : saved ? 'ATUALIZAR ESCALAÇÃO' : 'SALVAR ESCALAÇÃO BLIND'}
          </button>
        </div>
      )}
    </div>
  );
}

function MkKoSection({ players, teamPlayers, draw, scores, ko, myNick, onKoLineup }) {
  if (!draw || !draw.length) return null; // liga nem sorteada: nada a prever
  const gk = (r, gi) => r.phase + '-' + r.n + '-' + gi;
  const published = !!(ko && ko.published);
  const matches = draw.flatMap(r => (r.games || []).map((g, gi) => ({ home: g.home, away: g.away, sc: (scores || {})[gk(r, gi)] || {} }))).filter(m => !mkGameVoid(m));
  const seeds = published ? (ko.seeds || []) : mkKoSeedsFrom(players, matches);
  const seedOf = {};
  seeds.forEach((n, i) => { if (n) seedOf[n] = i + 1; });
  const br = mkKoBracket(seeds, published ? (ko.scores || {}) : {});
  const pendLeft = draw.reduce((acc, r) => acc + (r.games || []).filter((g, gi) => !mkGameVoid(g) && !mkMatchOutcome((scores || {})[gk(r, gi)] || {})).length, 0);
  // Seu próximo confronto ATIVO (os dois lados definidos, sem vencedor ainda).
  const myMatch = published ? MK_KO_IDS.map(id => br[id]).find(m => m.home && m.away && !m.done && (m.home === myNick || m.away === myNick)) : null;
  return (
    <div className="card mk-card mk-ko-card">
      <div className="card-head">
        <div className="title"><Icon name="sword" size={16} /> MATA-MATA · MORTAL KOMBAT</div>
        <div className="sub">{published ? 'OFICIAL — TOP 8 DOS PONTOS CORRIDOS' : 'PRÉVIA — SEEDS DA CLASSIFICAÇÃO DE HOJE'}</div>
      </div>
      <div className="card-body">
        {!published && (
          <div className="mk-ko-preheader">
            <Icon name="eye" size={12} /> <strong>Só visualização por enquanto.</strong> Os seeds abaixo seguem a classificação de HOJE e mudam a cada rodada — o chaveamento oficial sai quando os pontos corridos acabarem{pendLeft > 0 ? <> (falta{pendLeft === 1 ? '' : 'm'} <strong>{pendLeft}</strong> jogo{pendLeft === 1 ? '' : 's'})</> : null}.
          </div>
        )}
        <div className="mk-ko-rules">
          <div className="mk-ko-rule"><span className="mk-ko-rule-ic"><Icon name="target" size={14} /></span><div><strong>A CHAVE</strong><br />3º×8º vale a semi contra o 1º. 4º×7º e 5º×6º fazem a repescagem: os vencedores se enfrentam pela semi contra o 2º.</div></div>
          <div className="mk-ko-rule"><span className="mk-ko-rule-ic"><Icon name="eye-off" size={14} /></span><div><strong>MD5 BLIND</strong><br />5 jogos, vence quem fizer 3. Cada um declara a ORDEM dos 5 personagens em segredo — o rival só descobre na hora de cada jogo.</div></div>
          <div className="mk-ko-rule"><span className="mk-ko-rule-ic"><Icon name="cards" size={14} /></span><div><strong>MÁX 2X</strong><br />Pode repetir personagem, no máximo 2 vezes. Vale qualquer um do elenco do MK 1 — não precisa ser os 3 da liga.</div></div>
        </div>
        {myMatch && <div className="mk-ko-note" style={{ marginBottom: 12 }}><Icon name="fist" size={11} /> Você joga o <strong>{MK_KO_META[myMatch.id].label}</strong> — escale seus 5 personagens em <strong>MEU JOGO</strong> (na aba APOSTAS).</div>}
        <MkKoPodium br={br} teamPlayers={teamPlayers} />
        <MkKoBracketView br={br} seedOf={seedOf} teamPlayers={teamPlayers} myNick={myNick} preview={!published} />
        {seeds.length < 8 && <div className="mk-ko-note" style={{ marginTop: 10 }}><Icon name="warning" size={11} /> Menos de 8 elegíveis na classificação — a chave completa aparece quando tiver 8.</div>}
        {published && <div className="mk-ko-note" style={{ marginTop: 10 }}><Icon name="ticket" size={11} /> Aposte nos confrontos do mata-mata na aba <strong>APOSTAS</strong>.</div>}
      </div>
    </div>
  );
}
// LANÇADOR do mata-mata (MOD): marca o vencedor de cada jogo do MD5, na ordem.
// Revela os personagens do jogo só DEPOIS do resultado (mesma regra de todo mundo).
function MkKoLauncher({ ko, teamPlayers, onKoGame, onKoField, myNick }) {
  const br = mkKoBracket((ko && ko.seeds) || [], (ko && ko.scores) || {});
  const ready = MK_KO_IDS.map(id => br[id]).filter(m => m.home && m.away);
  const pend = ready.filter(m => !m.done), done = ready.filter(m => m.done);
  const lineupFor = (m, nick) => mkKoDecodeLineup((((ko.lineups || {})[m.id]) || {})[nick]);
  const row = (m) => {
    const luH = lineupFor(m, m.home), luA = lineupFor(m, m.away);
    return (
      <div key={m.id} className={'mk-ko-launch' + (m.done ? ' done' : '')}>
        <div className="mk-ko-launch-h">
          <span className="mk-ko-launch-lb">{MK_KO_META[m.id].label} · {MK_KO_META[m.id].phase}</span>
          <span className={'mk-launch-st ' + (m.done ? 'done' : 'pend')}>{m.done ? <><Icon name="check" size={11} /> {m.o.h}×{m.o.a}</> : 'MD5 · ' + m.o.h + '×' + m.o.a}</span>
        </div>
        <div className="mk-ko-launch-vs">
          <span className="mk-ko-launch-side"><Avatar nick={m.home} teamPlayers={teamPlayers} size={20} noBadge /> {m.home}</span>
          <span className="mk-ko-launch-x">×</span>
          <span className="mk-ko-launch-side"><Avatar nick={m.away} teamPlayers={teamPlayers} size={20} noBadge /> {m.away}</span>
          {(!luH || !luA) && <span className="mk-ko-launch-warn"><Icon name="warning" size={10} /> {[!luH && m.home, !luA && m.away].filter(Boolean).join(' e ')} sem escalação blind</span>}
        </div>
        {/* 1º GOLPE e 1º ROUND — quem foi o primeiro (mercados de aposta). */}
        {onKoField && [{ f: 'fh', lb: '1º GOLPE' }, { f: 'fr', lb: '1º ROUND' }].map(({ f, lb }) => {
          const raw = (((ko.scores || {})[m.id]) || {})[f];
          const cur = raw === 'H' || raw === 'A' ? raw : null;
          return (
            <div key={f} className={'mk-ko-launch-g mk-ko-launch-meta' + (cur ? ' set' : '')}>
              <span className="mk-ko-launch-gn">{lb}</span>
              <button type="button" className={'mk-ko-gbtn h' + (cur === 'H' ? ' on' : '')}
                onClick={() => onKoField(m.id, f, cur === 'H' ? null : 'H')} title={m.home + ' fez o ' + lb.toLowerCase()}>
                <Icon name="fist" size={10} /> {m.home}
              </button>
              <span className="mk-ko-launch-gx">×</span>
              <button type="button" className={'mk-ko-gbtn a' + (cur === 'A' ? ' on' : '')}
                onClick={() => onKoField(m.id, f, cur === 'A' ? null : 'A')} title={m.away + ' fez o ' + lb.toLowerCase()}>
                <Icon name="fist" size={10} /> {m.away}
              </button>
            </div>
          );
        })}
        {[1, 2, 3, 4, 5].map(n => {
          // vencedor do jogo DIRETO do doc (não do outcome, que trunca em buraco
          // de correção) — todo jogo gravado fica visível e desfazível.
          const raw = (((ko.scores || {})[m.id]) || {})['g' + n];
          const w = raw === 'H' || raw === 'A' ? raw : null;
          const enabled = !!w || (!m.done && m.o.next === n);
          const revH = luH && mkKoPickRevealed(m.o, n, m.home, myNick);
          const revA = luA && mkKoPickRevealed(m.o, n, m.away, myNick);
          return (
            <div key={n} className={'mk-ko-launch-g' + (w ? ' set' : '') + (!enabled ? ' off' : '')}>
              <span className="mk-ko-launch-gn">J{n}</span>
              <button type="button" disabled={!enabled} className={'mk-ko-gbtn h' + (w === 'H' ? ' on' : '')}
                onClick={() => onKoGame(m.id, n, w === 'H' ? null : 'H')}
                title={w === 'H' ? 'toque pra desfazer (apaga também os jogos seguintes)' : m.home + ' venceu o J' + n}>
                {revH ? <><MkCharIcon name={luH[n - 1]} sm /> {luH[n - 1]}</> : <><Icon name="eye-off" size={10} /> {m.home}</>}
              </button>
              <span className="mk-ko-launch-gx">×</span>
              <button type="button" disabled={!enabled} className={'mk-ko-gbtn a' + (w === 'A' ? ' on' : '')}
                onClick={() => onKoGame(m.id, n, w === 'A' ? null : 'A')}
                title={w === 'A' ? 'toque pra desfazer (apaga também os jogos seguintes)' : m.away + ' venceu o J' + n}>
                {revA ? <><MkCharIcon name={luA[n - 1]} sm /> {luA[n - 1]}</> : <><Icon name="eye-off" size={10} /> {m.away}</>}
              </button>
            </div>
          );
        })}
      </div>
    );
  };
  return (
    <div className="mk-ko-launcher">
      <div className="mk-admin-note" style={{ marginBottom: 10 }}><Icon name="whistle" size={12} /> MATA-MATA — marque o <strong>1º GOLPE</strong> e o <strong>1º ROUND</strong> (quem foi primeiro) e o LADO que venceu cada jogo (na ordem). Personagens aparecem depois do resultado. Toque de novo pra corrigir.</div>
      {pend.length === 0 && done.length === 0 && <div className="empty"><div className="e1">NADA A LANÇAR</div><div className="e2">Nenhum confronto do mata-mata com os dois lados definidos.</div></div>}
      {pend.map(row)}
      {done.length > 0 && <div className="mk-ko-launch-done-lb">JÁ ENCERRADOS</div>}
      {done.map(row)}
    </div>
  );
}

function MkChampionshipView({ players, users, teamPlayers, draw, lineups, onPublishDraw, scores, onScore, isAdmin, isMod, locked, myNick, launchOnly, ko, onPublishKo, onResetKo, onKoGame, onKoField, onKoLineup, onKoBet, balance }) {
  // draw/scores vêm do App (persistidos no doc de apostas, campo `mk`).
  // null = segue a 1ª rodada com jogo pendente (a "rodada atual"); número =
  // navegação manual do usuário pelas setas.
  const [selRound, setSelRound] = useState(null);
  const [curtain, setCurtain] = useState(() => {
    try { return !localStorage.getItem(MK_CURTAIN_KEY); } catch (e) { return false; }
  });
  const closeCurtain = () => { try { localStorage.setItem(MK_CURTAIN_KEY, '1'); } catch (e) {} setCurtain(false); };
  const replayCurtain = () => { try { localStorage.removeItem(MK_CURTAIN_KEY); } catch (e) {} setCurtain(true); };
  const insc = (players || []).slice().sort();

  // ADMIN sorteia e PUBLICA o chaveamento. Se já existe, confirma (zera placares).
  const doDraw = async () => {
    if (draw && !(await confirmModal({
      title: 'REFAZER O CHAVEAMENTO?',
      body: 'Isso ZERA todos os placares lançados. As apostas seguem valendo no novo confronto.',
      confirmLabel: 'REFAZER', danger: true,
    }))) return;
    onPublishDraw(generateMkDraw(shuffleArr(insc)));
    setSelRound(null);
  };
  const gKey = (r, gi) => r.phase + '-' + r.n + '-' + gi;
  const setScore = (key, side, val) => {
    const v = val.replace(/[^0-2]/g, '').slice(0, 1); // 1 dígito, 0..2 (primeiro a 2)
    onScore(key, { [side]: v });
  };
  const setFinisher = (key, which, val) => onScore(key, { [which]: val || undefined });
  const toggleFlawless = (key) => onScore(key, { flawless: !(scores[key] || {}).flawless });

  // Resultados lançados -> confrontos -> classificação (recalcula ao vivo).
  const matches = draw ? draw.flatMap(r => r.games.map((g, gi) => ({ home: g.home, away: g.away, sc: scores[gKey(r, gi)] || {} }))).filter(m => !mkGameVoid(m)) : [];
  const playedCount = matches.filter(m => mkMatchOutcome(m.sc)).length;
  const standings = computeMkStandings(insc, matches);
  const charsFor = (nick) => ((users || {})[nick] || {}).mkChars || [];
  // Confronto do usuário logado: destaca e joga pro TOPO da rodada (cada um joga
  // 1 jogo por rodada), pra não precisar caçar entre JOGO 01, 02, 03...
  const isMine = (g) => !!(myNick && (g.home === myNick || g.away === myNick));
  // Rodada exibida: a escolhida nas setas, senão a 1ª com jogo pendente
  // (temporada encerrada cai na última).
  const pendIdx = draw ? draw.findIndex(r => r.games.some((g, gi) => !mkGameVoid(g) && !mkMatchOutcome(scores[gKey(r, gi)] || {}))) : -1;
  const viewRound = selRound != null ? selRound : (pendIdx === -1 ? (draw ? draw.length - 1 : 0) : pendIdx);
  const curRound = draw ? draw[viewRound] : null;

  // Visão geral das rodadas (trilho clicável): status de cada uma —
  // 'done' (todos os jogos com placar) · 'live' (a rodada atual / em andamento)
  // · 'future' (ainda não começou). pendIdx = 1ª rodada com jogo pendente.
  const roundsMeta = (draw || []).map((r, idx) => {
    const total = r.games.filter(g => !mkGameVoid(g)).length;
    const doneN = r.games.reduce((acc, g, gi) => acc + ((!mkGameVoid(g) && mkMatchOutcome(scores[gKey(r, gi)] || {})) ? 1 : 0), 0);
    const allDone = total > 0 && doneN >= total;
    const st = allDone ? 'done' : ((idx === pendIdx || doneN > 0) ? 'live' : 'future');
    return { idx, phase: r.phase, n: r.n, total, doneN, st };
  });
  const doneRounds = roundsMeta.filter(rm => rm.st === 'done').length;

  // MOD (launchOnly): sem classificação — só o lançador de resultados (pendentes
  // primeiro + busca). Sem sorteio ainda, cai no fluxo normal (mostra SORTEAR).
  // Liga 100% fechada? (todo jogo anulado OU com resultado — W.O. conta como
  // resultado). Gate do PUBLICAR MATA-MATA.
  const leagueDone = !!draw && draw.length > 0 && draw.every(r => (r.games || []).every((g, gi) =>
    mkGameVoid(g) || !!mkMatchOutcome(scores[gKey(r, gi)] || {})));
  const koPublished = !!(ko && ko.published);
  const leaguePendLeft = draw ? matches.length - playedCount : 0;

  if (launchOnly && draw) {
    return (
      <div className="mk-champ mk-champ-launch">
        <MkResultLauncher draw={draw} scores={scores} lineups={lineups} teamPlayers={teamPlayers} onScore={onScore} />
        {/* MATA-MATA (mod): publicar (admin, só com a liga fechada) + lançar MD5. */}
        {isAdmin && !koPublished && (
          <div className="mk-sorteio-bar" style={{ marginTop: 12 }}>
            <span><Icon name="sword" size={12} /> MATA-MATA: {leagueDone ? 'liga encerrada — pronto pra publicar.' : 'libera quando a liga fechar (' + (leaguePendLeft === 1 ? 'falta 1 jogo' : 'faltam ' + leaguePendLeft + ' jogos') + ').'}</span>
            <button className="tp-btn-go" onClick={onPublishKo} disabled={!leagueDone} title={leagueDone ? 'Congela os seeds (top 8) e abre as escalações blind' : 'Ainda tem jogo de liga pendente'}>
              <Icon name="sword" size={13} /> PUBLICAR MATA-MATA
            </button>
          </div>
        )}
        {koPublished && (
          <>
            <div style={{ height: 14 }} />
            <MkKoLauncher ko={ko} teamPlayers={teamPlayers} onKoGame={onKoGame} onKoField={onKoField} myNick={myNick} />
            {isAdmin && (
              <div className="mk-sorteio-bar" style={{ marginTop: 10 }}>
                <span>Mata-mata publicado{ko.publishedAt ? ' em ' + new Date(ko.publishedAt).toLocaleDateString('pt-BR') : ''}.</span>
                <button className="mk-resort" onClick={onResetKo}><Icon name="warning" size={12} /> DESPUBLICAR</button>
              </div>
            )}
          </>
        )}
        {isAdmin && (
          <div className="mk-sorteio-bar" style={{ marginTop: 12 }}>
            <span>{matches.length} jogos · {playedCount} lançados</span>
            <button className="mk-resort" onClick={doDraw}><Icon name="refresh" size={12} /> SORTEAR DE NOVO</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mk-champ">
      {curtain && <MkCurtainOpening onDone={closeCurtain} />}
      <div className="grid mk-grid">
      {/* OFICIAL: o mata-mata sobe pro TOPO (foco); a classificação vira secundária
          abaixo. Enquanto é só prévia, ele fica embaixo (ver o outro render). */}
      {koPublished && (
        <MkKoSection players={insc} teamPlayers={teamPlayers} draw={draw} scores={scores}
          ko={ko} myNick={myNick} onKoLineup={onKoLineup} />
      )}
      <div className={'card mk-card' + (koPublished ? ' mk-card-secondary' : '')}>
        <div className="card-head">
          <div className="title"><Icon name="skull" size={16} /> CLASSIFICAÇÃO · MORTAL KOMBAT{koPublished && <span className="mk-secondary-tag"> · pontos corridos (encerrado)</span>}</div>
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
                            <span>{s.nick}</span>
                            {chars.length > 0 && <span className="mk-row-chars">{chars.join(' · ')}</span>}
                          </div>
                        </td>
                        <td>{s.j}</td><td style={{ fontWeight: 800 }}>{s.v}</td><td>{s.e}</td>
                        <td style={{ color: 'rgba(28,22,18,0.45)' }}>{s.d}</td>
                        <td>{sr > 0 ? '+' + sr : sr}</td>
                        <td style={{ fontFamily: 'Anton, Impact', fontSize: 16 }}>{s.p}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="mk-legend">
            <strong>SR</strong> = saldo de rounds. Confronto = <strong>2 partidas</strong> (cada uma primeiro a 2 rounds). Resultado: 2×0 vence, <strong>1×1 empata</strong>, 0×2 perde. Vitória 3, empate 1.
            <br /><strong>TOP 8 vai pro mata-mata</strong>: <strong>1º e 2º</strong> são cabeças de chave (entram direto nas semifinais); <strong>3º×8º</strong> valem a semi contra o 1º; <strong>4º×7º</strong> e <strong>5º×6º</strong> fazem a repescagem — os vencedores decidem quem pega o 2º. Detalhes no quadro MATA-MATA aqui embaixo. <span style={{ opacity: 0.8 }}>(Pódio 1º–3º com cor própria; 4º–8º na mesma cor.)</span>
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
                <button className="mk-rnav-btn" onClick={() => setSelRound(Math.max(0, viewRound - 1))} disabled={viewRound === 0} aria-label="Rodada anterior">
                  <Icon name="chevron-left" size={18} />
                </button>
                <div className="mk-rnav-mid">
                  <div className="mk-rnav-phase">{curRound.phase === 'IDA' ? 'TURNO · IDA' : 'RETURNO · VOLTA'}</div>
                  <div className="mk-rnav-count">{viewRound + 1} <span>/ {draw.length}</span></div>
                </div>
                <button className="mk-rnav-btn" onClick={() => setSelRound(Math.min(draw.length - 1, viewRound + 1))} disabled={viewRound === draw.length - 1} aria-label="Próxima rodada">
                  <Icon name="chevron-right" size={18} />
                </button>
              </div>
              {/* Trilho de rodadas: visão geral clicável (encerrada/atual/a vir). */}
              {draw.length > 1 && (
                <div className="mk-rstrip" role="tablist" aria-label="Todas as rodadas">
                  {['IDA', 'VOLTA'].map(phase => {
                    const list = roundsMeta.filter(rm => rm.phase === phase);
                    if (!list.length) return null;
                    return (
                      <div className="mk-rstrip-grp" key={phase}>
                        <span className="mk-rstrip-lab">{phase === 'IDA' ? 'TURNO' : 'RETURNO'}</span>
                        <div className="mk-rstrip-chips">
                          {list.map(rm => (
                            <button
                              key={rm.idx}
                              type="button"
                              role="tab"
                              aria-selected={rm.idx === viewRound}
                              className={'mk-rchip mk-rchip-' + rm.st + (rm.idx === viewRound ? ' sel' : '')}
                              onClick={() => setSelRound(rm.idx)}
                              title={'Rodada ' + String(rm.n).padStart(2, '0') + ' · ' + (phase === 'IDA' ? 'ida' : 'volta') + ' · ' + rm.doneN + '/' + rm.total + ' jogos'}
                            >
                              <span className="mk-rchip-n">{String(rm.n).padStart(2, '0')}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {draw.length > 1 && (
                <div className="mk-rstrip-leg">
                  <span><i className="mk-lg-dot done" /> encerrada</span>
                  <span><i className="mk-lg-dot live" /> atual</span>
                  <span><i className="mk-lg-dot future" /> a vir</span>
                  {/* atalho: volta pra rodada atual e VOLTA a seguir ela (selRound=null) */}
                  {pendIdx >= 0 && viewRound !== pendIdx && (
                    <button type="button" className="mk-rstrip-now" onClick={() => setSelRound(null)}>
                      <Icon name="target" size={11} /> RODADA ATUAL
                    </button>
                  )}
                  <span className="mk-rstrip-prog">{doneRounds}/{draw.length} rodadas</span>
                </div>
              )}
              <div className="mk-fixtures">
                {curRound.games
                  .map((g, gi) => ({ g, gi }))
                  .filter(({ g }) => !mkGameVoid(g)) // jogo anulado (jogador retirado) some da rodada
                  .sort((a, b) => (isMine(b.g) ? 1 : 0) - (isMine(a.g) ? 1 : 0)) // SEU JOGO no topo
                  .map(({ g, gi }) => {
                  const k = gKey(curRound, gi);
                  const sc = scores[k] || {};
                  const out = mkMatchOutcome(sc);
                  const done = !!out;
                  const mine = isMine(g);
                  const hc = charsFor(g.home), ac = charsFor(g.away);
                  // partida com placar completo mas impossível (MD3: um lado fecha 2)
                  const badP = (h, a) => h !== '' && h != null && a !== '' && a != null
                    && !((Number(h) === 2 && Number(a) <= 1) || (Number(a) === 2 && Number(h) <= 1));
                  const p1bad = badP(sc.p1h, sc.p1a), p2bad = badP(sc.p2h, sc.p2a);
                  return (
                    <div key={gi} className={'mk-fx' + (done ? ' done' : '') + (mine ? ' mine' : '')}>
                      <div className="mk-fx-top">
                        <span className="mk-fx-jogo">JOGO {String(gi + 1).padStart(2, '0')}{mine && <span className="mk-fx-mine"><Icon name="fist" size={10} /> SEU JOGO</span>}</span>
                        {done && <span className="mk-fx-done"><Icon name="check" size={11} /> {out.wo ? 'W.O.' : <>{out.confH}×{out.confA}{out.winner === 'D' ? ' · EMPATE' : ''}</>}</span>}
                      </div>
                      <div className="mk-fx-body">
                        <div className="mk-fx-side home">
                          <Avatar nick={g.home} teamPlayers={teamPlayers} size={28} noBadge />
                          <div className="mk-fx-id">
                            <div className="mk-fx-nick">{g.home}</div>
                            <div className="mk-fx-role mandante">MANDANTE</div>
                          </div>
                        </div>
                        <div className="mk-fx-duel">
                          {[1, 2].map(pi => {
                            const luP = ((lineups || {})[k] || {})['p' + pi] || {};
                            const sh = sc['p' + pi + 'h'], sa = sc['p' + pi + 'a'];
                            const playd = sh !== '' && sh != null && sa !== '' && sa != null;
                            const homeLost = playd && Number(sh) < Number(sa);
                            const awayLost = playd && Number(sa) < Number(sh);
                            return (
                              <div key={pi} className="mk-fx-duel-row">
                                <span className="mk-fx-duel-pl">P{pi}</span>
                                <span className={'mk-fx-fighter' + (homeLost ? ' lost' : '')}>
                                  {luP.home ? <MkCharIcon name={luP.home} /> : <span className="mk-fx-fighter-tbd">?</span>}
                                  {homeLost && <span className="mk-fx-loseX"><Icon name="x" size={24} /></span>}
                                </span>
                                <span className="mk-fx-duel-vs">{playd ? <span className="mk-fx-duel-sc">{sh}×{sa}</span> : <Icon name="skull" size={10} />}</span>
                                <span className={'mk-fx-fighter' + (awayLost ? ' lost' : '')}>
                                  {luP.away ? <MkCharIcon name={luP.away} /> : <span className="mk-fx-fighter-tbd">?</span>}
                                  {awayLost && <span className="mk-fx-loseX"><Icon name="x" size={24} /></span>}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="mk-fx-side away">
                          <Avatar nick={g.away} teamPlayers={teamPlayers} size={28} noBadge />
                          <div className="mk-fx-id">
                            <div className="mk-fx-nick">{g.away}</div>
                            <div className="mk-fx-role visitante">VISITANTE</div>
                          </div>
                        </div>
                      </div>
                      {isMod && (
                        <div className="mk-fx-admin-score">
                          <span className="mk-fx-admin-l"><Icon name="shield" size={10} /> LANÇAR PLACAR <span className="mk-fx-finish-adm">toque as bolinhas dos rounds</span></span>
                          <MkRoundDots sc={sc} lineup={(lineups || {})[k]} onPatch={(patch) => onScore(k, patch)} />
                        </div>
                      )}
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
      {/* PRÉVIA (liga rodando): o mata-mata fica embaixo. Oficial já subiu pro topo. */}
      {!koPublished && (
        <MkKoSection players={insc} teamPlayers={teamPlayers} draw={draw} scores={scores}
          ko={ko} myNick={myNick} onKoLineup={onKoLineup} />
      )}
      </div>
    </div>
  );
}

// APOSTAS do MK (aba APOSTAS, admin por enquanto). Lê o sorteio/resultados
// compartilhados (App). Cupom = palpites combinados de QUALQUER mercado (dá pra
// apostar tudo do mesmo card); jogos de rodadas diferentes valem — casada
// MULTIPLICA as odds. Única trava: VENCEDOR e CHANCE DUPLA não juntos no card.
function mkLegLabel(l) {
  if (l.tourney) return l.pick; // perna outright (campeão/finalista/etc): palpite é um nick
  if (l.isKo) return mkKoPickLabel(l.market, l.pick, l.home, l.away); // perna do mata-mata
  // CHANCE DUPLA no cupom: usa os nicks reais (ex: "bane ou empate").
  if (l.market === 'DC') return l.pick === '1X' ? (l.home + ' ou empate') : l.pick === '12' ? (l.home + ' ou ' + l.away) : ('empate ou ' + l.away);
  return mkPickLabel(l.market, l.pick);
}
// Título do mercado da perna (liga ou mata-mata).
function mkLegMktTitle(l) { return l.tourney ? (MK_KO_TOURNEY_TITLE[l.koTourneyMarket || l.market] || l.market) : l.isKo ? (MK_KO_MARKET_TITLE[l.market] || l.market) : (MK_MARKET_TITLE[l.market] || l.market); }
// Sparkline de tendência (saldo de rounds acumulado). SVG minúsculo, escala
// automática; some com menos de 2 pontos (nenhum jogo concluído).
function MkSparkline({ series, away }) {
  if (!series || series.length < 2) return null;
  const W = 84, H = 20, PAD = 2;
  const min = Math.min(...series), max = Math.max(...series);
  const span = (max - min) || 1;
  const pts = series.map((v, i) => {
    const x = PAD + (i / (series.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((v - min) / span) * (H - PAD * 2);
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  return (
    <svg className={'mk-spark' + (away ? ' away' : '')} viewBox={'0 0 ' + W + ' ' + H} width={W} height={H}
      role="img" aria-label="Tendência de saldo de rounds">
      <title>Tendência: saldo de rounds acumulado (jogo a jogo)</title>
      <polyline points={pts} fill="none" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
// Radar de desempenho (3 eixos REAIS): OFENSIVA (rounds ganhos/jogo), DEFESA
// (rounds evitados/jogo) e APROVEITAMENTO (pontos/possíveis). Dois polígonos:
// mandante (laranja) × visitante (charcoal).
function MkRadar({ home, away, recH, recA }) {
  const axes = [
    { k: 'OFENSIVA', f: (r) => (r.rp / r.j) / 4 },
    { k: 'DEFESA', f: (r) => 1 - (r.rc / r.j) / 4 },
    { k: 'APROVEIT.', f: (r) => r.p / (3 * r.j) },
  ];
  if (!recH || !recA || !(recH.j > 0) || !(recA.j > 0)) return null;
  const cx = 70, cy = 60, R = 42;
  const clamp01 = (x) => Math.max(0.06, Math.min(1, x)); // 0.06 = polígono nunca some
  const pt = (i, v) => {
    const ang = (-90 + i * 120) * Math.PI / 180;
    return (cx + Math.cos(ang) * R * v).toFixed(1) + ',' + (cy + Math.sin(ang) * R * v).toFixed(1);
  };
  const poly = (rec) => axes.map((ax, i) => pt(i, clamp01(ax.f(rec)))).join(' ');
  const grid = (v) => axes.map((_, i) => pt(i, v)).join(' ');
  const labPos = [{ x: cx, y: cy - R - 5, a: 'middle' }, { x: cx + R + 4, y: cy + R * 0.62, a: 'start' }, { x: cx - R - 4, y: cy + R * 0.62, a: 'end' }];
  return (
    <div className="mk-radar-wrap">
      <div className="mk-radar-leg">
        <span className="mk-radar-leg-i home"><i /> {home}</span>
        <span className="mk-radar-leg-i away"><i /> {away}</span>
      </div>
      <svg className="mk-radar" viewBox="-26 0 192 120" role="img" aria-label={'Radar de desempenho: ' + home + ' × ' + away}>
        <title>OFENSIVA = rounds ganhos por jogo · DEFESA = rounds evitados · APROVEIT. = pontos conquistados</title>
        <polygon className="mk-radar-grid" points={grid(1)} />
        <polygon className="mk-radar-grid" points={grid(0.5)} />
        {axes.map((_, i) => { const [x, y] = pt(i, 1).split(','); return <line key={i} className="mk-radar-axis" x1={cx} y1={cy} x2={x} y2={y} />; })}
        <polygon className="mk-radar-a" points={poly(recH)} />
        <polygon className="mk-radar-b" points={poly(recA)} />
        {axes.map((ax, i) => <text key={ax.k} className="mk-radar-lab" x={labPos[i].x} y={labPos[i].y} textAnchor={labPos[i].a}>{ax.k}</text>)}
      </svg>
    </div>
  );
}
// Tira de FORMA do nick (últimos 5 confrontos) — bolinhas V/E/D, mais recente à
// esquerda. Aparece no resumo do card de aposta do MK.
function MkForm({ nick, draw, scores, align }) {
  const recent = mkPlayerRecent(nick, draw, scores, 5);
  if (!recent.length) return <span className="mk-form empty">sem jogos</span>;
  return (
    <span className={'mk-form' + (align === 'right' ? ' right' : '')}
      title={'Forma (mais recente primeiro): ' + recent.map(m => m.res + ' vs ' + m.oppNick).join(' · ')}>
      {recent.map((m, i) => (
        <span key={i} className={'mk-form-dot ' + (m.res === 'V' ? 'v' : m.res === 'D' ? 'd' : 'e')}>{m.res}</span>
      ))}
    </span>
  );
}
// Conteúdo de ESTATÍSTICAS PRO de um confronto (agora num POP-UP, pra não
// esticar o card do jogo). Deriva tudo dos jogos reais.
function MkGameStats({ g, gkey, draw, scores, lineups, metrics, standings, charStats }) {
  const recOf = (n) => { const i = (standings || []).findIndex(s => s.nick === n); return i < 0 ? null : { ...standings[i], pos: i + 1 }; };
  const { pR, pWin, pDraw, pLoss } = mkMatchupProbs(g.home, g.away, metrics, (lineups || {})[gkey], charStats, draw, scores);
  const pctI = (x) => Math.round(x * 100);
  const h2h = mkHeadToHead(g.home, g.away, draw, scores);
  const recH = recOf(g.home), recA = recOf(g.away);
  const srTxt = (rec) => (rec.rp - rec.rc >= 0 ? '+' : '') + (rec.rp - rec.rc);
  const proH = mkPlayerProStats(g.home, draw, scores);
  const proA = mkPlayerProStats(g.away, draw, scores);
  const frH = mkFirstRoundStats(g.home, draw, scores);
  const frA = mkFirstRoundStats(g.away, draw, scores);
  const luCard = (lineups || {})[gkey] || null;
  return (
    <div className="mk-bg-stats">
      {/* DUELO DOS BONECOS: win% por personagem nas partidas já jogadas */}
      {(() => {
        const parts = ['p1', 'p2']
          .map((p, pi) => ({ pi, h: ((luCard || {})[p] || {}).home, a: ((luCard || {})[p] || {}).away }))
          .filter(x => x.h && x.a);
        if (!parts.length) return null;
        return (
          <div className="mk-ps-block">
            <div className="mk-ps-t">DUELO DOS BONECOS <span className="mk-ps-hint">win% do personagem nas partidas</span></div>
            {parts.map(({ pi, h, a }) => {
              const sH = charStats[h], sA = charStats[a];
              const rH = sH && sH.played ? sH.won / sH.played : null;
              const rA = sA && sA.played ? sA.won / sA.played : null;
              const noData = rH == null || rA == null;
              const share = noData ? 0.5 : (rH + rA) === 0 ? 0.5 : rH / (rH + rA);
              return (
                <div key={pi} className="mk-ps-duel">
                  <div className="mk-ps-duel-names">
                    <span className="h">{h}{rH != null && <b> {Math.round(rH * 100)}%</b>}</span>
                    <span className="a">{rA != null && <b>{Math.round(rA * 100)}% </b>}{a}</span>
                  </div>
                  <div className="mk-ps-duel-bar" title={noData ? 'Ainda sem histórico suficiente pra comparar os bonecos' : undefined}>
                    <span className={'seg h' + (noData ? ' nd' : '')} style={{ width: (share * 100) + '%' }} />
                    <span className={'seg a' + (noData ? ' nd' : '')} style={{ width: ((1 - share) * 100) + '%' }} />
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}
      <MkRadar home={g.home} away={g.away} recH={recH} recA={recA} />
      <div className="mk-ps-block">
        <div className="mk-ps-t">CONFRONTO DIRETO <span className="mk-ps-hint">{h2h.games === 0 ? 'primeiro encontro' : (g.home + ' ' + h2h.aWins + ' · ' + h2h.draws + 'E · ' + h2h.bWins + ' ' + g.away)}</span></div>
        {h2h.list.map((m, i) => {
          const tot = (m.aR + m.bR) || 1;
          return (
            <div key={i} className="mk-ps-h2h">
              <span className="mk-ps-h2h-l">{m.phase} {String(m.n).padStart(2, '0')}</span>
              <div className="mk-ps-duel-bar">
                <span className="seg h" style={{ width: (m.aR / tot * 100) + '%' }} />
                <span className="seg a" style={{ width: (m.bR / tot * 100) + '%' }} />
              </div>
              <span className="mk-ps-h2h-sc">{m.aR}×{m.bR}</span>
            </div>
          );
        })}
      </div>
      <div className="mk-ps-tiles">
        <div className="mk-ps-tile">
          <span className="mk-ps-tile-k">1º ROUND</span>
          <span className="mk-ps-tile-r"><i className="h">{g.home}</i><b>{frH.total ? Math.round(frH.won / frH.total * 100) + '%' : '—'}</b></span>
          <span className="mk-ps-tile-r"><i>{g.away}</i><b>{frA.total ? Math.round(frA.won / frA.total * 100) + '%' : '—'}</b></span>
        </div>
        <div className="mk-ps-tile">
          <span className="mk-ps-tile-k">BRUTALITY</span>
          <span className="mk-ps-tile-r"><i className="h">{g.home}</i><b>{proH.brutality}</b></span>
          <span className="mk-ps-tile-r"><i>{g.away}</i><b>{proA.brutality}</b></span>
        </div>
        <div className="mk-ps-tile">
          <span className="mk-ps-tile-k">FLAWLESS</span>
          <span className="mk-ps-tile-r"><i className="h">{g.home}</i><b>{proH.flawless}</b></span>
          <span className="mk-ps-tile-r"><i>{g.away}</i><b>{proA.flawless}</b></span>
        </div>
      </div>
      <div className="mk-bg-stat-grid">
        <div className="mk-bg-stat"><span className="mk-bg-stat-k">Prob. vencer</span><span className="mk-bg-stat-v">{g.home} {pctI(pWin)}% · emp {pctI(pDraw)}% · {g.away} {pctI(pLoss)}%</span></div>
        <div className="mk-bg-stat"><span className="mk-bg-stat-k">Prob. 1º round</span><span className="mk-bg-stat-v">{g.home} {pctI(pR)}% · {g.away} {pctI(1 - pR)}%</span></div>
        <div className="mk-bg-stat"><span className="mk-bg-stat-k">{g.home}</span><span className="mk-bg-stat-v">{recH && recH.j > 0 ? (recH.pos + 'º · ' + recH.v + 'V ' + recH.e + 'E ' + recH.d + 'D · SR ' + srTxt(recH)) : 'sem jogos ainda'}</span></div>
        <div className="mk-bg-stat"><span className="mk-bg-stat-k">{g.away}</span><span className="mk-bg-stat-v">{recA && recA.j > 0 ? (recA.pos + 'º · ' + recA.v + 'V ' + recA.e + 'E ' + recA.d + 'D · SR ' + srTxt(recA)) : 'sem jogos ainda'}</span></div>
      </div>
    </div>
  );
}
function MkBettingView({ players, users, teamPlayers, draw, scores, lineups, bets, onPlaceBet, onRemoveBet, onSetGameLock, onMkScore, onOpenProfile, onEscalar, myNick, isAdmin, isMod, balance, ko, onKoBet }) {
  const insc = (players || []).slice().sort();
  const gKey = (r, gi) => r.phase + '-' + r.n + '-' + gi;
  const skey = (phase, n, gi) => phase + '-' + n + '-' + gi;
  const [cupom, setCupom] = useState([]);
  const [stake, setStake] = useState(50);
  // #layout: cada jogo é uma CAIXA que expande ao clicar (accordion). As chaves
  // abertas ficam num Set; por padrão tudo começa fechado (só o resumo aparece).
  const [openGames, setOpenGames] = useState(() => new Set());
  const toggleGame = (key) => setOpenGames(prev => {
    const n = new Set(prev);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });
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
    // somem da tela — senão ficariam "fantasmas" (visíveis só no cupom). Mantém
    // os mercados do modo simples: VENC (liga), KVENC e KTOTAL (mata-mata).
    if (m === 'simples') setCupom(prev => prev.filter(l => l.market === 'VENC' || l.market === 'KVENC' || l.market === 'KTOTAL'));
  };
  const visibleMarkets = betMode === 'avancado' ? MK_MARKETS : MK_MARKETS.filter(m => m === 'VENC' || m === 'DC' || m === 'R1');
  // POP-UP de estatísticas (em vez de esticar o card): guarda { g, key } do jogo.
  const [statsGame, setStatsGame] = useState(null);
  useEffect(() => {
    if (!statsGame) return;
    const onEsc = (e) => { if (e.key === 'Escape') setStatsGame(null); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [statsGame]);
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

  // Cupom como GAVETA no mobile (igual já é na FIFA): em vez de cair lá embaixo
  // depois de todos os jogos, vira um bottom-sheet que sobe pelo FAB "VER CUPOM".
  const [cupomOpen, setCupomOpen] = useState(false);
  useEffect(() => {
    if (!cupomOpen) return;
    const onEsc = (e) => { if (e.key === 'Escape') setCupomOpen(false); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [cupomOpen]);

  // odds usam TODOS os jogos já LANÇADOS (não só rodadas 100% fechadas) — assim os
  // jogos adiantados já têm odd com base no desempenho real até agora.
  const oddsMatches = draw ? draw.flatMap(r => (r.games || []).map((g, gi) => ({
    home: g.home, away: g.away, sc: (scores || {})[gKey(r, gi)] || {},
  })).filter(m => mkMatchOutcome(m.sc))) : [];
  const metrics = computeMkPlayerMetrics(insc, oddsMatches);
  const mkStandings = computeMkStandings(insc, oddsMatches);
  // MATA-MATA: quando publicado, os confrontos MD5 abertos entram AQUI (na aba de
  // apostas) como cards normais (mesmo visual/cupom da liga). Chave em CAMPEONATOS.
  const koScores = (ko && ko.scores) || {};
  const koBr = ko && ko.published ? mkKoBracket(ko.seeds || [], koScores) : null;
  const koBettable = koBr ? MK_KO_IDS.map(id => koBr[id]).filter(m => mkKoBettable(m, koScores[m.id])) : [];
  // MERCADOS DO CAMPEONATO (outright): campeão / finalista / semi / vice / pódio.
  // Probabilidade derivada do bracket + força (mkKoTournamentProbs); odd no MESMO
  // modelo comprimido dos confrontos. Só mercados ABERTOS e jogadores ainda vivos.
  const koTourneyProbs = koBr ? mkKoTournamentProbs(ko.seeds || [], koScores, metrics, draw, scores) : null;
  const koTourneyMarkets = koBr ? MK_KO_TOURNEY_MARKETS.filter(mkt => mkKoTourneyOpen(mkt, koBr)).map(mkt => ({
    market: mkt,
    title: MK_KO_TOURNEY_TITLE[mkt],
    picks: (ko.seeds || []).map(p => ({ player: p, prob: (koTourneyProbs[p] || {})[MK_KO_TOURNEY_PROB[mkt]] || 0 }))
      // fora: já-garantidos/quase-certos (>~91%, viraria dinheiro grátis) E quem tem
      // chance desprezível (<0.5%, exibiria "0%") — o mercado só lista disputa real.
      .filter(x => mkKoTourneyPickBettable(x.prob) && x.prob >= 0.005)
      .map(x => ({ player: x.player, prob: x.prob, odd: mkKoOddFromProb(x.prob) }))
      .sort((a, b) => a.odd - b.odd),
  })).filter(m => m.picks.length > 0) : [];
  // vitórias por boneco (todas as partidas com escalação) — "duelo dos bonecos".
  const charStats = useMemo(() => mkCharWinStats(draw, scores, lineups), [draw, scores, lineups]);
  // LISTA ÚNICA "LIBERADOS": todo jogo que dá pra apostar AGORA (de qualquer rodada,
  // os 2 jogadores sem pendência atrás). Sem navegação por rodada.
  // SEUS jogos primeiro (você está no confronto) — depois o resto, ordem estável.
  const isMine = (g) => !!myNick && (g.home === myNick || g.away === myNick);
  const liberados = mkLiberadoGames(draw, scores);
  // DESTAQUE (mk-scores[key].featured, marcado pelo MOD): sai da lista normal de
  // RODADAS e vive só na caixa DESTAQUES (topo da tela) — não duplica em dois
  // lugares. destaques usa o MESMO renderGameCard (cupom/mercados compartilhados).
  const isFeatured = (item) => !!(((scores || {})[item.key] || {}).featured);
  const destaques = liberados.filter(isFeatured);
  // AGRUPA o resto (não-destacado) por RODADA (fase+n) — cada rodada numa caixa
  // própria; SEU JOGO primeiro dentro de cada uma. Ordem do chaveamento entre rodadas.
  const libGroups = (() => {
    const groups = [], idx = {};
    liberados.filter(item => !isFeatured(item)).forEach(item => {
      const gk = item.r.phase + '·' + item.r.n;
      if (!(gk in idx)) { idx[gk] = groups.length; groups.push({ r: item.r, ri: item.ri, items: [] }); }
      groups[idx[gk]].items.push(item);
    });
    groups.sort((a, b) => a.ri - b.ri);
    groups.forEach(gr => gr.items.sort((a, b) => (isMine(a.g) ? 0 : 1) - (isMine(b.g) ? 0 : 1)));
    return groups;
  })();
  // tira do cupom pernas de jogos que deixaram de estar liberados (foram lançados).
  const liberadoKeys = liberados.map(x => x.key).join('|');
  useEffect(() => {
    const set = new Set(liberadoKeys ? liberadoKeys.split('|') : []);
    setCupom(prev => prev.filter(l => set.has(l.phase + '-' + l.roundN + '-' + l.gi)));
  }, [liberadoKeys]);

  const legKey = (r, gi, market) => r.phase + '-' + r.n + '-' + gi + '-' + market;
  const pickInCupom = (r, gi, market, pick) => cupom.some(l => l.key === legKey(r, gi, market) && l.pick === pick);
  const toggleLeg = (r, gi, g, market, pick, odd) => {
    if (myNick && (g.home === myNick || g.away === myNick)) { showToast('Você não pode apostar no próprio jogo.', 'error'); return; }
    if (mkGameClosed((scores || {})[gKey(r, gi)], now)) { showToast('As apostas desse jogo estão travadas.', 'error'); return; }
    const key = legKey(r, gi, market);
    const ex = cupom.find(l => l.key === key);
    if (ex && ex.pick === pick) { setCupom(prev => prev.filter(l => l.key !== key)); return; } // desmarca
    // CASADA agora combina QUALQUER mercado — dá pra apostar tudo do mesmo card
    // (VENCEDOR + TOTAL + PLACAR...) ou misturar jogos. Única trava: VENCEDOR e
    // CHANCE DUPLA são a MESMA aposta (quem vence o confronto) por dois caminhos,
    // então no MESMO card só cabe um dos dois — senão a casada só inflaria a odd
    // sem risco real (uma cobre a outra).
    const WINNER_MKTS = ['VENC', 'DC'];
    if (WINNER_MKTS.includes(market)) {
      const twin = market === 'VENC' ? 'DC' : 'VENC';
      const clash = cupom.find(l => l.market === twin && l.phase === r.phase && l.roundN === r.n && l.gi === gi);
      if (clash) {
        showToast('Nesse card já tem "' + MK_MARKET_TITLE[twin] + '". VENCEDOR e CHANCE DUPLA são a mesma aposta — escolhe só uma.', 'error');
        return;
      }
    }
    const newLeg = { key, roundN: r.n, phase: r.phase, gi, home: g.home, away: g.away, market, pick, odd };
    setCupom(prev => [...prev.filter(l => l.key !== key && !l.isKo), newLeg]); // cupom homogêneo (tira legs do KO)
  };
  // Palpite de um confronto do MATA-MATA no MESMO cupom. Chave por CONFRONTO
  // (mkko-<id>): um palpite por confronto (KVENC/KPLACAR/KTOTAL são correlacionados).
  const koPickInCupom = (matchId, market, pick) => cupom.some(l => l.isKo && l.koMatch === matchId && l.market === market && l.pick === pick);
  const koTourneyPickInCupom = (market, player) => cupom.some(l => l.tourney && l.koTourneyMarket === market && l.pick === player);
  const toggleKoLeg = (m, market, pick, odd) => {
    if (myNick && (m.home === myNick || m.away === myNick)) { showToast('Você não pode apostar no próprio confronto.', 'error'); return; }
    // Chave por (confronto, MERCADO) — igual à liga: dá pra casar mercados
    // diferentes do MESMO confronto (VENCEDOR + TOTAL + PLACAR...). Um pick por
    // mercado (clicar outro pick do mesmo mercado troca).
    const key = 'mkko-' + m.id + '-' + market;
    setCupom(prev => {
      const ex = prev.find(l => l.key === key);
      if (ex && ex.pick === pick) return prev.filter(l => l.key !== key); // toca de novo -> desmarca
      // cupom homogêneo (só legs do KO — a liga já acabou de qualquer forma)
      return [...prev.filter(l => l.key !== key && l.isKo), { key, isKo: true, koMatch: m.id, home: m.home, away: m.away, market, pick, odd }];
    });
  };
  // Mercado OUTRIGHT do campeonato (campeão / finalista / semi / vice / pódio).
  // O palpite é um JOGADOR (nick). Um pick por mercado (clicar outro troca).
  // Casa com os confrontos do KO (mesmo cupom, isKo).
  const toggleKoTourneyLeg = (market, player, odd) => {
    if (myNick && myNick === player) { showToast('Você não pode apostar em você mesmo.', 'error'); return; }
    const key = 'mkkot-' + market;
    const ex = cupom.find(l => l.key === key);
    const isUnmark = ex && ex.pick === player; // clicar de novo no mesmo -> desmarca (sempre ok)
    if (!isUnmark && cupom.some(l => l.tourney && l.key !== key && l.pick === player)) {
      // já tem esse jogador em OUTRO mercado do campeonato — mercados encaixados/excludentes,
      // não dá pra casar dois pro mesmo nick (ver placeKoBet).
      showToast(player + ' já está em outro mercado do campeonato — um mercado por jogador no cupom.', 'error');
      return;
    }
    setCupom(prev => {
      const cur = prev.find(l => l.key === key);
      if (cur && cur.pick === player) return prev.filter(l => l.key !== key); // toca de novo -> desmarca
      return [...prev.filter(l => l.key !== key && l.isKo), { key, isKo: true, tourney: true, koTourneyMarket: market, market, pick: player, odd }];
    });
  };
  const combined = cupom.length ? cupom.reduce((p, l) => p * l.odd, 1) : 0; // MULTIPLICA (casada de verdade), sem teto
  const isCasada = cupom.length >= 2;
  const place = async (opts) => {
    if (!cupom.length || !(stake > 0)) return;
    const isKoCupom = cupom.some(l => l.isKo);
    let res;
    if (isKoCupom) {
      // aposta do mata-mata: fluxo próprio (placeKoBet mostra o próprio toast).
      res = await onKoBet({ legs: cupom.map(l => l.tourney ? ({ tourney: true, koTourneyMarket: l.koTourneyMarket, market: l.market, pick: l.pick, odd: l.odd }) : ({ koMatch: l.koMatch, home: l.home, away: l.away, market: l.market, pick: l.pick, odd: l.odd })), stake, combined: +combined.toFixed(2), casada: isCasada });
    } else {
      const first = cupom[0];
      res = await onPlaceBet({
        nick: myNick, roundN: first.roundN, phase: first.phase,
        legs: cupom.map(({ key, ...l }) => l), stake, combined: +combined.toFixed(2), casada: isCasada,
        open: !!(opts && opts.open),
      });
    }
    if (res && res.err) return; // erro já avisado por toast
    setCupom([]);
    setCupomOpen(false);
    // liga: auto-cópia mostra o próprio toast; KO: placeKoBet já mostra o toast.
    if (!isKoCupom && !(opts && opts.open) && !(res && res.autoCopied)) showToast((isCasada ? 'Casada' : 'Aposta') + ' feita! ' + stake + ' PC', 'success');
  };
  const betStatus = (bet) => {
    let pending = false;
    for (const l of (bet.legs || [])) {
      const sc = (scores || {})[skey(l.phase, l.roundN, l.gi)] || {};
      const r = mkLegResult(l.market, l.pick, sc, { finisher1: sc.finisher1, finisher2: sc.finisher2, flawless: sc.flawless, firstRound: sc.firstRound });
      if (r === 'lose') return 'lost';
      if (r !== 'win') pending = true;
    }
    return pending ? 'pending' : 'won';
  };

  const renderGameCard = ({ r, gi, g, key }) => {
    const odds = computeMkGameOdds(g.home, g.away, metrics, (lineups || {})[key], charStats, draw, scores);
    const ownGame = !!myNick && (g.home === myNick || g.away === myNick);
    const scEntry = (scores || {})[key] || null;
    const gameLocked = mkGameClosed(scEntry, now);
    const secsLeft = mkLockSecondsLeft(scEntry, now);
    const counting = secsLeft > 0;
    const locked = ownGame || gameLocked;
    const featured = !!(scEntry && scEntry.featured);
    const expanded = openGames.has(key);
    const frH = mkFirstRoundStats(g.home, draw, scores);
    const frA = mkFirstRoundStats(g.away, draw, scores);
    const scoreMkt = (m) => m === 'RESULT' || m === 'P1' || m === 'P2';
    // probabilidades EXIBIDAS (mandante/empate/visitante + 1º round): direto
    // das estatísticas (mkMatchupProbs, sem o clamp de pagamento das odds).
    const { pR, pWin, pDraw, pLoss } = mkMatchupProbs(g.home, g.away, metrics, (lineups || {})[key], charStats, draw, scores);
    const pctI = (x) => Math.round(x * 100);
    const trendH = mkPlayerTrendSeries(g.home, draw, scores);
    const trendA = mkPlayerTrendSeries(g.away, draw, scores);
    return (
      <div key={key} className={'mk-bet-game' + (featured ? ' featured' : '') + (ownGame ? ' own' : '') + (gameLocked ? ' locked' : '') + (counting && !gameLocked ? ' closing' : '') + (expanded ? ' open' : '')}>
        {/* RESUMO da caixa (sempre visível): confronto + forma + 1º round.
            Clica em qualquer lugar (menos nos jogadores) pra EXPANDIR e
            ver as odds/mercados. */}
        <div className="mk-bg-summary" role="button" tabIndex={0} aria-expanded={expanded}
          onClick={() => toggleGame(key)}
          onKeyDown={(e) => {
            // só reage quando o FOCO está no próprio resumo — senão Enter/Space
            // nos botões internos (perfil/escalar) togglaria o card e mataria o clique.
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGame(key); }
          }}>
          <div className="mk-bg-top">
            <span className="mk-bet-rod">RODADA {String(r.n).padStart(2, '0')} · {r.phase} · JOGO {String(gi + 1).padStart(2, '0')}</span>
            <span className="mk-bg-caret">{expanded ? 'FECHAR' : 'VER MERCADOS'} <Icon name={expanded ? 'caret-up' : 'caret-down'} size={13} /></span>
          </div>
          <div className="mk-bet-match">
            <button type="button" className="mk-bm-side" onClick={(e) => { e.stopPropagation(); onOpenProfile && onOpenProfile(g.home); }} title={'Ver perfil de ' + g.home}>
              <Avatar nick={g.home} teamPlayers={teamPlayers} size={30} noBadge />
              <span className="mk-bm-info">
                <span className="mk-bm-nick mand">{g.home}</span>
                <span className="mk-bm-role mand">MANDANTE</span>
                <MkForm nick={g.home} draw={draw} scores={scores} />
                {frH.total > 0 && <span className="mk-bm-fr" title="Vitórias de 1º round nos confrontos concluídos">1º ROUND {frH.won}/{frH.total}</span>}
                <MkSparkline series={trendH} />
              </span>
            </button>
            <span className="mk-bm-vs">×</span>
            <button type="button" className="mk-bm-side right" onClick={(e) => { e.stopPropagation(); onOpenProfile && onOpenProfile(g.away); }} title={'Ver perfil de ' + g.away}>
              <span className="mk-bm-info">
                <span className="mk-bm-nick">{g.away}</span>
                <span className="mk-bm-role">VISITANTE</span>
                <MkForm nick={g.away} draw={draw} scores={scores} align="right" />
                {frA.total > 0 && <span className="mk-bm-fr" title="Vitórias de 1º round nos confrontos concluídos">1º ROUND {frA.won}/{frA.total}</span>}
                <MkSparkline series={trendA} away />
              </span>
              <Avatar nick={g.away} teamPlayers={teamPlayers} size={30} noBadge />
            </button>
          </div>
          {/* barra de probabilidade do confronto (estatísticas) */}
          <div className="mk-bg-prob" title="Probabilidade do confronto (estatísticas: campanha, bonecos, confronto direto, 1º round e flawless)">
            <div className="mk-bg-prob-bar">
              <span className="mk-bg-prob-seg h" style={{ width: (pWin * 100) + '%' }} />
              <span className="mk-bg-prob-seg d" style={{ width: (pDraw * 100) + '%' }} />
              <span className="mk-bg-prob-seg a" style={{ width: (pLoss * 100) + '%' }} />
            </div>
            <div className="mk-bg-prob-lab">
              <span className="mand">{g.home} {pctI(pWin)}%</span>
              <span className="draw">emp {pctI(pDraw)}%</span>
              <span className="away">{g.away} {pctI(pLoss)}%</span>
            </div>
          </div>
          {/* odds do VENCEDOR (display) — sempre visível no resumo */}
          <div className="mk-bg-odds">
            <span className="mk-bg-odds-l">VENCEDOR</span>
            <span className="mk-bg-odd"><b>MAND</b> <i>{odds.VENC.H.toFixed(2)}</i></span>
            <span className="mk-bg-odd"><b>EMP</b> <i>{odds.VENC.D.toFixed(2)}</i></span>
            <span className="mk-bg-odd"><b>VIS</b> <i>{odds.VENC.A.toFixed(2)}</i></span>
          </div>
          {/* bonecos (card de luta) — sempre visível no resumo */}
          {(() => {
            const lu = (lineups || {})[key] || null;
            const arranged = !!lu && ['p1', 'p2'].every(p => (lu[p] || {}).home && (lu[p] || {}).away);
            if (!arranged) return <div className="mk-bet-fc empty"><Icon name="refresh" size={10} /> card de luta não montado ainda</div>;
            return (
              <div className="mk-bet-fc">
                {['p1', 'p2'].map((p, pi) => {
                  const h = (lu[p] || {}).home, a = (lu[p] || {}).away;
                  return (
                    <div key={p} className="mk-bet-fc-part">
                      <span className="mk-bet-fc-num">J{pi + 1}</span>
                      <span className="mk-bet-fc-fig"><MkCharIcon name={h} sm /><span className="mk-bet-fc-cn">{h}</span></span>
                      <span className="mk-bet-fc-vs"><Icon name="skull" size={10} /></span>
                      <span className="mk-bet-fc-fig right"><MkCharIcon name={a} sm /><span className="mk-bet-fc-cn">{a}</span></span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          <div className="mk-bg-flags">
            {featured && <span className="mk-bg-flag destaque"><Icon name="star" size={10} /> DESTAQUE</span>}
            {ownGame && <span className="mk-bg-flag seu"><Icon name="fist" size={10} /> SEU JOGO</span>}
            {/* atalho: escalar direto do resumo (só o mandante monta o card) */}
            {ownGame && g.home === myNick && onEscalar && (
              <button type="button" className="mk-bg-escalar" onClick={(e) => { e.stopPropagation(); onEscalar(); }}>
                <Icon name="skull" size={10} /> ESCALAR MEU CARD
              </button>
            )}
            {gameLocked && <span className="mk-bg-flag lock"><Icon name="lock" size={10} /> TRAVADO</span>}
            {counting && !gameLocked && <span className="mk-bg-flag closing"><Icon name="warning" size={10} /> FECHA {fmtSecs(secsLeft)}</span>}
            {/* MOD: destacar/remover destaque — botão só ícone (liga/desliga), sempre
                visível (não precisa expandir o card) pra marcar rápido na lista toda. */}
            {isMod && onSetGameLock && (
              <button type="button" className={'mk-bg-feat-btn' + (featured ? ' on' : '')}
                onClick={(e) => { e.stopPropagation(); onSetGameLock(key, { featured: !featured }); }}
                title={featured ? 'Remover destaque' : 'Destacar este jogo'}
                aria-pressed={featured}>
                <Icon name="star" size={13} />
              </button>
            )}
            {/* estatísticas viram POP-UP (não estica o card) — à direita da linha */}
            <button type="button" className="mk-bg-stats-btn" onClick={(e) => { e.stopPropagation(); setStatsGame({ g, key }); }}>
              <Icon name="chart" size={11} /> ESTATÍSTICAS
            </button>
          </div>
        </div>
        {expanded && (
        <div className="mk-bg-body">
        {ownGame && (
          <div className="mk-bet-own seu">
            <span><Icon name="fist" size={11} /> SEU JOGO — você está nesse confronto</span>
            {g.home === myNick && onEscalar && (
              <button type="button" className="mk-bet-escalar" onClick={onEscalar}><Icon name="skull" size={11} /> ESCALAR MEU CARD</button>
            )}
          </div>
        )}
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
              <button type="button" className="mk-bet-lockbtn on" onClick={() => onSetGameLock(key, { locked: false, lockAt: null })}>
                <Icon name="unlock" size={11} /> DESTRAVAR APOSTAS
              </button>
            ) : counting ? (
              <>
                <button type="button" className="mk-bet-lockbtn ghost" onClick={() => onSetGameLock(key, { lockAt: null })}>
                  <Icon name="x" size={11} /> CANCELAR ({fmtSecs(secsLeft)})
                </button>
                <button type="button" className="mk-bet-lockbtn danger" onClick={() => onSetGameLock(key, { locked: true, lockAt: null })}>
                  <Icon name="lock" size={11} /> TRAVAR JÁ
                </button>
              </>
            ) : (
              <>
                <button type="button" className="mk-bet-lockbtn" onClick={() => onSetGameLock(key, { lockAt: Date.now() + MK_LOCK_COUNTDOWN_S * 1000, locked: false })}>
                  <Icon name="warning" size={11} /> FECHAR EM {MK_LOCK_COUNTDOWN_S}s
                </button>
                <button type="button" className="mk-bet-lockbtn danger" onClick={() => onSetGameLock(key, { locked: true, lockAt: null })}>
                  <Icon name="lock" size={11} /> TRAVAR JÁ
                </button>
              </>
            )}
          </div>
        )}
        {/* LANÇAR RESULTADO direto no card travado (só mod). #M4 */}
        {gameLocked && isMod && onMkScore && (
          <div className="mk-bet-launch">
            <div className="mk-bet-launch-h"><Icon name="whistle" size={12} /> LANÇAR RESULTADO</div>
            <MkRoundDots sc={scEntry || {}} lineup={(lineups || {})[key]} onPatch={(patch) => onMkScore(key, patch)} />
            <div className="rl-extras">
              <span className="rl-extra-grp">
                <span className="rl-extra-l">1º ROUND</span>
                <button type="button" className={'rl-pick home' + ((scEntry && scEntry.firstRound) === 'H' ? ' on' : '')} onClick={() => onMkScore(key, { firstRound: (scEntry && scEntry.firstRound) === 'H' ? '' : 'H' })}>{g.home}</button>
                <button type="button" className={'rl-pick away' + ((scEntry && scEntry.firstRound) === 'A' ? ' on' : '')} onClick={() => onMkScore(key, { firstRound: (scEntry && scEntry.firstRound) === 'A' ? '' : 'A' })}>{g.away}</button>
              </span>
              <span className="rl-extra-grp">
                <span className="rl-extra-l"><Icon name="skull" size={11} /> BRUTALITY</span>
                <button type="button" className={'rl-pick' + ((scEntry && scEntry.finisher1) === 'brutality' ? ' on' : '')} onClick={() => onMkScore(key, { finisher1: (scEntry && scEntry.finisher1) === 'brutality' ? '' : 'brutality' })}>P1</button>
                <button type="button" className={'rl-pick' + ((scEntry && scEntry.finisher2) === 'brutality' ? ' on' : '')} onClick={() => onMkScore(key, { finisher2: (scEntry && scEntry.finisher2) === 'brutality' ? '' : 'brutality' })}>P2</button>
              </span>
            </div>
          </div>
        )}
        {visibleMarkets.map(mkt => {
          // marca o AZARÃO (maior prêmio, fogo) e o FAVORITO (menor
          // odd, alvo) quando o mercado tem spread relevante (2x+).
          const picks = mkMarketPicks(mkt, odds);
          const vals = picks.map(p => odds[mkt][p]);
          const mx = Math.max(...vals), mn = Math.min(...vals);
          const spread = picks.length > 1 && mx >= mn * 2;
          return (
          <div key={mkt} className="mk-bet-mkt">
            <div className="mk-bet-mkt-h">{MK_MARKET_TITLE[mkt]}</div>
            <div className="mk-bet-picks">
              {picks.map(pick => {
                const on = pickInCupom(r, gi, mkt, pick);
                const v = odds[mkt][pick];
                const hot = spread && v === mx, fav = spread && v === mn;
                return (
                  <button key={pick} type="button"
                    className={'mk-odd' + (on ? ' on' : '') + (locked ? ' off' : '') + (hot ? ' hot' : '') + (fav ? ' fav' : '')}
                    title={hot ? 'Maior prêmio do mercado (azarão)' : fav ? 'Favorito do mercado' : undefined}
                    onClick={() => toggleLeg(r, gi, g, mkt, pick, v)} disabled={locked}>
                    <span className="mk-odd-l">
                      {mkt === 'DC'
                        ? (pick === '1X' ? (g.home + ' ou EMP') : pick === '12' ? (g.home + ' ou ' + g.away) : ('EMP ou ' + g.away))
                        : scoreMkt(mkt)
                        ? <span className="mk-odd-pl"><span className="mk-sc-h">{pick[0]}</span><span className="mk-sc-x">×</span><span className="mk-sc-a">{pick[1]}</span></span>
                        : mkPickLabel(mkt, pick)}
                    </span>
                    <span className="mk-odd-v">
                      {hot && <Icon name="fire" size={10} className="mk-odd-ic hot" />}
                      {fav && <Icon name="target" size={10} className="mk-odd-ic fav" />}
                      {v.toFixed(2)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          );
        })}
        </div>
      )}
      </div>
    );
  };

  // Card de um confronto do MATA-MATA — MESMA casca visual do renderGameCard
  // (accordion, barra de probabilidade, botões de odd), mas com odds/mercados de
  // MD5 e alimentando o MESMO cupom via toggleKoLeg.
  const renderKoCard = (m) => {
    const key = 'mkko-' + m.id;
    const expanded = openGames.has(key);
    const odds = computeMkKoOdds(m.home, m.away, metrics, draw, scores);
    const d = odds._dist;
    const ownGame = !!myNick && (m.home === myNick || m.away === myNick);
    const meta = MK_KO_META[m.id];
    const pctI = (x) => Math.round(x * 100);
    const frH = mkFirstRoundStats(m.home, draw, scores);
    const frA = mkFirstRoundStats(m.away, draw, scores);
    const trendH = mkPlayerTrendSeries(m.home, draw, scores);
    const trendA = mkPlayerTrendSeries(m.away, draw, scores);
    // SIMPLES = só QUEM PASSA; AVANÇADO = + PLACAR + TOTAL (mesmo toggle da liga).
    const koMarkets = betMode === 'avancado' ? MK_KO_MARKETS : ['KVENC', 'KTOTAL'];
    const statG = { home: m.home, away: m.away };
    return (
      <div key={key} className={'mk-bet-game mk-ko-game' + (ownGame ? ' own' : '') + (expanded ? ' open' : '')}>
        <div className="mk-bg-summary" role="button" tabIndex={0} aria-expanded={expanded}
          onClick={() => toggleGame(key)}
          onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleGame(key); } }}>
          <div className="mk-bg-top">
            <span className="mk-bet-rod"><Icon name="sword" size={11} /> MATA-MATA · {meta.label} · MELHOR DE 5</span>
            <span className="mk-bg-caret">{expanded ? 'FECHAR' : 'VER MERCADOS'} <Icon name={expanded ? 'caret-up' : 'caret-down'} size={13} /></span>
          </div>
          <div className="mk-bet-match">
            <button type="button" className="mk-bm-side" onClick={(e) => { e.stopPropagation(); onOpenProfile && onOpenProfile(m.home); }} title={'Ver perfil de ' + m.home}>
              <Avatar nick={m.home} teamPlayers={teamPlayers} size={30} noBadge />
              <span className="mk-bm-info">
                <span className="mk-bm-nick mand">{m.home}</span>
                <span className="mk-bm-role mand">MANDANTE</span>
                <MkForm nick={m.home} draw={draw} scores={scores} />
                {frH.total > 0 && <span className="mk-bm-fr" title="Vitórias de 1º round nos confrontos da liga">1º ROUND {frH.won}/{frH.total}</span>}
                <MkSparkline series={trendH} />
              </span>
            </button>
            <span className="mk-bm-vs">×</span>
            <button type="button" className="mk-bm-side right" onClick={(e) => { e.stopPropagation(); onOpenProfile && onOpenProfile(m.away); }} title={'Ver perfil de ' + m.away}>
              <span className="mk-bm-info">
                <span className="mk-bm-nick">{m.away}</span>
                <span className="mk-bm-role">VISITANTE</span>
                <MkForm nick={m.away} draw={draw} scores={scores} align="right" />
                {frA.total > 0 && <span className="mk-bm-fr" title="Vitórias de 1º round nos confrontos da liga">1º ROUND {frA.won}/{frA.total}</span>}
                <MkSparkline series={trendA} away />
              </span>
              <Avatar nick={m.away} teamPlayers={teamPlayers} size={30} noBadge />
            </button>
          </div>
          <div className="mk-bg-prob" title="Chance de PASSAR (melhor de 5, pela força na liga)">
            <div className="mk-bg-prob-bar">
              <span className="mk-bg-prob-seg h" style={{ width: (d.win * 100) + '%' }} />
              <span className="mk-bg-prob-seg a" style={{ width: (d.loss * 100) + '%' }} />
            </div>
            <div className="mk-bg-prob-lab">
              <span className="mand">{m.home} {pctI(d.win)}%</span>
              <span className="away">{m.away} {pctI(d.loss)}%</span>
            </div>
          </div>
          <div className="mk-bg-odds">
            <span className="mk-bg-odds-l">QUEM PASSA</span>
            <span className="mk-bg-odd"><b>MAND</b> <i>{odds.KVENC.H.toFixed(2)}</i></span>
            <span className="mk-bg-odd"><b>VIS</b> <i>{odds.KVENC.A.toFixed(2)}</i></span>
          </div>
          <div className="mk-bg-flags">
            {ownGame && <span className="mk-bg-flag seu"><Icon name="fist" size={10} /> SEU CONFRONTO</span>}
            <span className="mk-bg-flag mk-ko-flag"><Icon name="sword" size={10} /> MELHOR DE 5</span>
            <button type="button" className="mk-bg-stats-btn" onClick={(e) => { e.stopPropagation(); setStatsGame({ g: statG, key }); }}>
              <Icon name="chart" size={11} /> ESTATÍSTICAS
            </button>
          </div>
        </div>
        {expanded && (
          <div className="mk-bg-body">
            {ownGame && <div className="mk-bet-own seu"><span><Icon name="fist" size={11} /> SEU CONFRONTO — você não aposta nele</span></div>}
            {koMarkets.map(mkt => {
              const picks = mkKoMarketPicks(mkt);
              const vals = picks.map(p => odds[mkt][p]);
              const mx = Math.max(...vals), mn = Math.min(...vals);
              const spread = picks.length > 1 && mx >= mn * 2;
              return (
                <div key={mkt} className="mk-bet-mkt">
                  <div className="mk-bet-mkt-h">{MK_KO_MARKET_TITLE[mkt]}</div>
                  <div className="mk-bet-picks">
                    {picks.map(pick => {
                      const on = koPickInCupom(m.id, mkt, pick);
                      const v = odds[mkt][pick];
                      const hot = spread && v === mx, fav = spread && v === mn;
                      return (
                        <button key={pick} type="button"
                          className={'mk-odd' + (on ? ' on' : '') + (ownGame ? ' off' : '') + (hot ? ' hot' : '') + (fav ? ' fav' : '')}
                          title={hot ? 'Maior prêmio do mercado' : fav ? 'Favorito do mercado' : undefined}
                          onClick={() => toggleKoLeg(m, mkt, pick, v)} disabled={ownGame}>
                          <span className="mk-odd-l">
                            {MK_KO_SIDE_MARKETS.indexOf(mkt) !== -1 ? (pick === 'H' ? m.home : m.away)
                              : mkt === 'KPLACAR' ? <span className="mk-odd-pl"><span className="mk-sc-h">{pick[0]}</span><span className="mk-sc-x">×</span><span className="mk-sc-a">{pick[1]}</span></span>
                              : pick + ' jogos'}
                          </span>
                          <span className="mk-odd-v">
                            {hot && <Icon name="fire" size={10} className="mk-odd-ic hot" />}
                            {fav && <Icon name="target" size={10} className="mk-odd-ic fav" />}
                            {v.toFixed(2)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // MERCADOS DO CAMPEONATO (outright). Cada mercado é um acordeão; dentro, os
  // jogadores ainda vivos ordenados do favorito (menor odd) ao azarão.
  const MK_KO_TOURNEY_ICON = { CHAMP: 'crown', FINAL: 'trophy', SEMI: 'sword', VICE: 'medal', PODIUM: 'medal-3' };
  const renderKoTourneyBlock = () => {
    if (!koTourneyMarkets.length) return null;
    return (
      <div className="mk-lib-round mk-ko-libround mk-ko-tny-box">
        <div className="mk-lib-round-h"><Icon name="trophy" size={12} /> MERCADOS DO CAMPEONATO <span className="mk-lib-round-c">{koTourneyMarkets.length} MERCADO{koTourneyMarkets.length === 1 ? '' : 'S'}</span></div>
        <div className="mk-ko-tny-sub">Aposte em quem leva o título, chega na final, na semi, fica com o vice ou sobe ao pódio. Quem já garantiu a vaga (ou está a um passo) sai do mercado — só aparece quem ainda tem disputa. Um palpite por mercado — casa com os confrontos.</div>
        <div className="mk-tny-list">
          {koTourneyMarkets.map(mkt => {
            const key = 'mkkot-' + mkt.market;
            const expanded = openGames.has(key);
            const best = mkt.picks[0];
            return (
              <div key={mkt.market} className={'mk-tny' + (expanded ? ' open' : '')}>
                <button type="button" className="mk-tny-h" aria-expanded={expanded} onClick={() => toggleGame(key)}>
                  <span className="mk-tny-title"><Icon name={MK_KO_TOURNEY_ICON[mkt.market] || 'trophy'} size={14} /> {mkt.title}</span>
                  <span className="mk-tny-meta">
                    <span className="mk-tny-fav">{mkt.picks.length} <Icon name="user" size={10} /></span>
                    <span className="mk-tny-fav mk-tny-favp">{best.player} <i>{best.odd.toFixed(2)}</i></span>
                    <Icon name={expanded ? 'caret-up' : 'caret-down'} size={14} />
                  </span>
                </button>
                {expanded && (
                  <div className="mk-tny-picks">
                    {mkt.picks.map(pk => {
                      const on = koTourneyPickInCupom(mkt.market, pk.player);
                      const own = !!myNick && myNick === pk.player;
                      return (
                        <button key={pk.player} type="button"
                          className={'mk-tny-pick' + (on ? ' on' : '') + (own ? ' off' : '')}
                          title={own ? 'Você não aposta em si mesmo' : undefined}
                          onClick={() => toggleKoTourneyLeg(mkt.market, pk.player, pk.odd)} disabled={own}>
                          <span className="mk-tny-pk-l">
                            <Avatar nick={pk.player} teamPlayers={teamPlayers} size={22} noBadge />
                            <span className="mk-tny-pk-nick">{pk.player}</span>
                            {own && <span className="mk-tny-pk-you">VOCÊ</span>}
                          </span>
                          <span className="mk-tny-pk-r">
                            <span className="mk-tny-pk-prob">{Math.round(pk.prob * 100)}%</span>
                            <span className="mk-tny-pk-odd">{pk.odd.toFixed(2)}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className={'card mk-card mk-betting' + (cupom.length ? ' mk-betting--betbar' : '')}>
      <div className="card-head">
        <div className="title"><Icon name="coin" size={16} /> APOSTAS · MORTAL KOMBAT</div>
        <div className="sub">ODDS AUTOMÁTICAS</div>
      </div>
      <div className="card-body">
        {!draw || !draw.length ? (
          <div className="empty"><div className="e1">SEM SORTEIO AINDA</div><div className="e2">O admin sorteia as rodadas em CAMPEONATOS → MK. Aí as odds aparecem aqui.</div></div>
        ) : (
          <>
            <div className="mk-bet-layout">
              <div className="mk-bet-main">
                {/* #8: modo do apostador — SIMPLES (só quem vence) x AVANÇADO (tudo).
                    Vale pra liga E pro mata-mata (fica no topo, sempre visível). */}
                {(koBettable.length > 0 || liberados.length > 0) && (
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
                        ? 'Só quem vence o confronto. Casada = junta confrontos.'
                        : 'Tudo: placares e totais (rounds na liga, jogos no mata-mata).'}
                    </span>
                  </div>
                )}
                {/* MATA-MATA: confrontos abertos como cards normais (mesmo cupom). */}
                {koBettable.length > 0 && (
                  <div className="mk-lib-round mk-ko-libround">
                    <div className="mk-lib-round-h"><Icon name="sword" size={12} /> MATA-MATA · CONFRONTOS ABERTOS <span className="mk-lib-round-c">{koBettable.length} JOGO{koBettable.length === 1 ? '' : 'S'}</span></div>
                    <div className="mk-bet-games">{koBettable.map(renderKoCard)}</div>
                  </div>
                )}
                {/* MERCADOS DO CAMPEONATO (outright: campeão, final, semi, vice, pódio). */}
                {renderKoTourneyBlock()}
                {koBr && koBettable.length === 0 && koTourneyMarkets.length === 0 && liberados.length === 0 && (
                  <div className="empty"><div className="e1">MATA-MATA EM ANDAMENTO</div><div className="e2">Os confrontos abertos aparecem aqui pra apostar. No momento nenhum está liberado (começaram ou terminaram). A chave completa fica em CAMPEONATOS → MK.</div></div>
                )}
                {(!koBr || liberados.length > 0) && (<>
                {/* DESTAQUES: jogos marcados pelo MOD — cartão cheio (mesmo
                    renderGameCard da lista normal), pra dar pra apostar direto
                    sem precisar achar o jogo lá embaixo. */}
                {destaques.length > 0 && (
                  <div className="mk-destaques-box">
                    <div className="mk-destaques-h"><Icon name="star" size={13} /> DESTAQUES <span className="mk-destaques-c">{destaques.length}</span></div>
                    <div className="mk-bet-games">
                      {destaques.map(renderGameCard)}
                    </div>
                  </div>
                )}
                <div className="mk-liberados-h"><Icon name="skull" size={13} /> JOGOS LIBERADOS <span className="mk-liberados-c">{liberados.length - destaques.length}</span></div>
                {libGroups.length === 0 ? (
                  <div className="empty"><div className="e1">NENHUM JOGO LIBERADO</div><div className="e2">No momento não tem confronto com os 2 jogadores livres. Assim que alguém fecha a rodada anterior, libera aqui.</div></div>
                ) : libGroups.map(gr => (
                  <div key={gr.r.phase + gr.r.n} className="mk-lib-round">
                    <div className="mk-lib-round-h">
                      <Icon name="skull" size={12} /> RODADA {String(gr.r.n).padStart(2, '0')} · {gr.r.phase}
                      <span className="mk-lib-round-c">{gr.items.length} JOGO{gr.items.length === 1 ? '' : 'S'}</span>
                    </div>
                    <div className="mk-bet-games">
                  {gr.items.map(renderGameCard)}
                    </div>
                  </div>
                ))}
                </>)}
              </div>

              <aside className={'mk-cupom-wrap' + (cupomOpen ? ' cupom-open' : '')}
                     style={cupomOpen ? { transform: 'translateY(0)' } : undefined}>
                {/* Handle aparece só no bottom-sheet (mobile) — fecha o cupom.
                    O transform de abrir vai INLINE (vence cascade) e é no-op na
                    sidebar do desktop, onde cupomOpen nunca fica true. */}
                <button type="button" className="cupom-sheet-handle" onClick={() => setCupomOpen(false)}>
                  <span className="cupom-sheet-grip" aria-hidden="true" />
                  <span className="cupom-sheet-handle-label">FECHAR CUPOM</span>
                  <Icon name="caret-down" size={14} />
                </button>
                <div className="card cupom">
                  <div className="card-head">
                    <div className="title">CUPOM {isCasada ? '· CASADA' : ''}</div>
                    <div className="sub">{cupom.length} {cupom.length === 1 ? 'PALPITE' : 'PALPITES'}</div>
                  </div>
                  <div className="card-body">
                    {cupom.length === 0 ? (
                      <div className="empty">
                        <div className="e1">VAZIO</div>
                        <div className="e2">Clica nas odds pra montar. 2+ palpites = casada (pode misturar mercados do mesmo card) — as odds multiplicam.</div>
                      </div>
                    ) : (<>
                      {cupom.map(l => (
                        <div key={l.key} className="cupom-leg">
                          <div className="cupom-leg-txt">
                            <div className="cupom-leg-mkt">{l.tourney ? <span className="cupom-leg-ko">CAMPEONATO MK</span> : l.isKo && <span className="cupom-leg-ko">MATA-MATA</span>}{mkLegMktTitle(l)}</div>
                            <div className="cupom-leg-pick">{l.tourney ? <strong>{mkLegLabel(l)}</strong> : <>{l.home}×{l.away} - <strong>{mkLegLabel(l)}</strong></>}</div>
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
                      {/* mesmos valores rápidos do cupom FIFA (50/100/500) */}
                      <div className="quick">
                        <button onClick={() => setStake(Number.isFinite(balance) ? Math.min(50, balance) : 50)}>50</button>
                        <button onClick={() => setStake(Number.isFinite(balance) ? Math.min(100, balance) : 100)}>100</button>
                        <button onClick={() => setStake(Number.isFinite(balance) ? Math.min(500, balance) : 500)}>500</button>
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
                      <div className="modal-btns">
                        <button className="btn-secondary" onClick={() => setCupom([])}>LIMPAR</button>
                        <button className="btn-primary" disabled={!cupom.length || !(stake > 0) || (Number.isFinite(balance) && stake > balance)} onClick={() => place()}>{Number.isFinite(balance) && stake > balance ? 'SALDO INSUFICIENTE' : 'APOSTAR ' + stake + ' PC'}</button>
                      </div>
                      {/* Todo cupom agora vai pra MESA DOS CARTOLAS automaticamente ao apostar. */}
                      <div className="cupom-public-note"><Icon name="cards" size={12} /> Toda aposta é pública na MESA DOS CARTOLAS — os outros podem copiar.</div>
                      <button type="button" className="cupom-share" onClick={() => {
                        const txt = 'Cupom MK: ' + cupom.map(l => mkLegMktTitle(l) + ' ' + mkLegLabel(l) + ' @' + l.odd.toFixed(2)).join(' + ') + ' = ' + combined.toFixed(2) + 'x';
                        navigator.clipboard.writeText(txt).then(() => showToast('Cupom copiado!', 'success'), () => showToast('Falha ao copiar.', 'error'));
                      }}>
                        <Icon name="arrow-up-right" size={13} /> COMPARTILHAR CUPOM
                      </button>
                    </>)}
                  </div>
                </div>
              </aside>
            </div>
            <div className="mk-bets-hint"><Icon name="ticket" size={12} /> Suas apostas ficam em <strong>MEUS TICKETS</strong>.</div>
            <div className="mk-admin-note" style={{ marginTop: 12 }}><Icon name="coin" size={11} /> Valendo <strong>PC</strong> · você não aposta no próprio jogo. Um jogo <strong>libera</strong> quando os <strong>2 jogadores</strong> já fecharam as rodadas anteriores — dá pra adiantar.</div>

            {/* Backdrop do bottom-sheet (mobile): toca fora pra fechar. */}
            {cupomOpen && (
              <button className="cupom-sheet-backdrop" type="button" aria-label="Fechar cupom" onClick={() => setCupomOpen(false)} />
            )}
            {/* BARRA DO CUPOM: aparece embaixo quando há palpites — bem visível
                (resumo + retorno), abre a gaveta com o cupom completo ao clicar. */}
            {cupom.length > 0 && !cupomOpen && (
              <button className="mk-betbar" onClick={() => setCupomOpen(true)} type="button">
                <span className="mk-betbar-main">
                  <span className="mk-betbar-badge"><Icon name="ticket" size={16} /> {cupom.length}</span>
                  <span className="mk-betbar-info">
                    <span className="mk-betbar-title">{cupom.length === 1 ? '1 PALPITE' : cupom.length + ' PALPITES'}{isCasada ? ' · CASADA' : ''}</span>
                    <span className="mk-betbar-sub">retorno ~{Math.round(stake * combined)} PC</span>
                  </span>
                </span>
                <span className="mk-betbar-cta">
                  <span className="mk-betbar-odd">{combined.toFixed(2)}x</span>
                  <span className="mk-betbar-go">VER CUPOM <Icon name="caret-up" size={14} /></span>
                </span>
              </button>
            )}
            {/* POP-UP de ESTATÍSTICAS (em vez de esticar o card do jogo) */}
            {statsGame && (
              <div className="mk-stats-modal-backdrop" onClick={() => setStatsGame(null)}>
                <div className="mk-stats-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
                  <div className="mk-stats-modal-head">
                    <div className="mk-stats-modal-title"><Icon name="chart" size={15} /> {statsGame.g.home} <span className="mk-stats-x">×</span> {statsGame.g.away}</div>
                    <button type="button" className="mk-stats-modal-close" onClick={() => setStatsGame(null)} aria-label="Fechar"><Icon name="x" size={18} /></button>
                  </div>
                  <div className="mk-stats-modal-body">
                    <MkGameStats g={statsGame.g} gkey={statsGame.key} draw={draw} scores={scores} lineups={lineups} metrics={metrics} standings={mkStandings} charStats={charStats} />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Card "TROCAR SENHA" do perfil. Valida a senha atual contra o hash gravado
// e troca numa transação. Colapsado por padrão pra não poluir o resumo.
function TrocarSenhaCard({ nick }) {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState('');
  const [nova, setNova] = useState('');
  const [conf, setConf] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (nova.length < 4) { showToast('Senha nova muito curta (mínimo 4 caracteres).', 'error'); return; }
    if (nova !== conf) { showToast('A confirmação não bate com a senha nova.', 'error'); return; }
    setBusy(true);
    try {
      const curHash = await hashPassword(cur);
      const novaHash = await hashPassword(nova);
      const r = await commitBetDocUpdate(remote => {
        const u = (remote.users || {})[nick];
        if (!u) return { __abort: true, result: { err: 'Conta não sincronizada — sai e entra de novo.' } };
        if (u.senhaHash && u.senhaHash !== curHash) return { __abort: true, result: { err: 'Senha atual incorreta.' } };
        return { ...remote, users: { ...remote.users, [nick]: { ...u, senhaHash: novaHash } } };
      });
      if (r && r.err) { showToast(r.err, 'error'); return; }
      setCur(''); setNova(''); setConf(''); setOpen(false);
      showToast('Senha trocada!', 'success');
    } catch (e2) {
      showToast('Falha ao trocar senha: ' + (e2.message || e2), 'error');
    } finally { setBusy(false); }
  };
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <button type="button" className="senha-card-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="senha-card-title"><Icon name="lock" size={14} /> TROCAR SENHA</span>
        <Icon name={open ? 'caret-up' : 'caret-down'} size={12} />
      </button>
      {open && (
        <div className="card-body">
          <form onSubmit={submit} className="senha-form">
            <label className="small-label">SENHA ATUAL
              <input type="password" value={cur} onChange={e => setCur(e.target.value)} autoComplete="current-password" />
            </label>
            <label className="small-label">SENHA NOVA
              <input type="password" value={nova} onChange={e => setNova(e.target.value)} autoComplete="new-password" />
            </label>
            <label className="small-label">CONFIRMA A NOVA
              <input type="password" value={conf} onChange={e => setConf(e.target.value)} autoComplete="new-password" />
            </label>
            <button type="submit" className="btn-primary senha-submit" disabled={busy || !cur || !nova || !conf}>
              {busy ? 'TROCANDO…' : 'TROCAR SENHA'}
            </button>
          </form>
          <div className="senha-hint">Esqueceu a atual? Pede pro admin resetar (ele te manda uma temporária).</div>
        </div>
      )}
    </div>
  );
}

// ─── ESTATÍSTICAS ───────────────────────────────────────────────────────────
// Hub de comparação: escolhe um jogador (seletor visual de avatares) e mostra o
// perfil dele (troféus/títulos), uma comparação VOCÊ × ELE e TODOS os confrontos
// diretos (H2H) em todos os jogos com fixtures (FIFA = 1 jogo/par, MK = ida+volta).
// ── STATS DETALHADOS (M10) ──────────────────────────────────────────────────
// Métricas FIFA de um jogador a partir de cs.rounds (resolve teamId/nick via fifaUserOf).
function fifaPlayerDetailedStats(nick, teamPlayers, rounds) {
  const games = [];
  (rounds || []).forEach((r, ri) => (r || []).forEach((g) => {
    const hN = fifaUserOf(g.home, teamPlayers), aN = fifaUserOf(g.away, teamPlayers);
    const iAmHome = hN === nick, iAmAway = aN === nick;
    if (!iAmHome && !iAmAway) return;
    const gh = parseInt(g.gh, 10), ga = parseInt(g.ga, 10);
    if (Number.isNaN(gh) || Number.isNaN(ga)) return; // só jogados
    const myG = iAmHome ? gh : ga, opG = iAmHome ? ga : gh;
    games.push({ round: ri + 1, opp: iAmHome ? aN : hN, myG, opG, res: myG > opG ? 'V' : myG < opG ? 'D' : 'E' });
  }));
  const ordered = games.sort((a, b) => a.round - b.round);
  const n = ordered.length;
  const wins = ordered.filter(g => g.res === 'V').length;
  const draws = ordered.filter(g => g.res === 'E').length;
  const losses = ordered.filter(g => g.res === 'D').length;
  const gf = ordered.reduce((s, g) => s + g.myG, 0);
  const ga = ordered.reduce((s, g) => s + g.opG, 0);
  const points = wins * 3 + draws;
  let curW = 0, bestW = 0, curUnb = 0, bestUnb = 0;
  ordered.forEach(g => {
    if (g.res === 'V') { curW++; curUnb++; } else if (g.res === 'E') { curW = 0; curUnb++; } else { curW = 0; curUnb = 0; }
    if (curW > bestW) bestW = curW; if (curUnb > bestUnb) bestUnb = curUnb;
  });
  let endW = 0; for (let i = ordered.length - 1; i >= 0; i--) { if (ordered[i].res === 'V') endW++; else break; }
  return {
    n, wins, draws, losses, gf, ga, sg: gf - ga, points,
    ppg: n ? points / n : 0, winRate: n ? wins / n * 100 : 0,
    cleanSheets: ordered.filter(g => g.opG === 0).length,
    failToScore: ordered.filter(g => g.myG === 0).length,
    goleadas: ordered.filter(g => g.res === 'V' && (g.myG - g.opG) >= 3).length,
    biggestWin: ordered.filter(g => g.res === 'V').reduce((b, g) => Math.max(b, g.myG - g.opG), 0),
    biggestLoss: ordered.filter(g => g.res === 'D').reduce((b, g) => Math.max(b, g.opG - g.myG), 0),
    bestWinStreak: bestW, bestUnbeaten: bestUnb, curWinStreak: endW,
  };
}
// Métricas MK de um jogador (draw + mkScores + mkLineups). 2x0/2x1/shutout + personagens.
function mkPlayerDetailedStats(nick, draw, scores, lineups) {
  const gk = (r, gi) => r.phase + '-' + r.n + '-' + gi;
  const out = [];
  (draw || []).forEach(r => (r.games || []).forEach((g, gi) => {
    if (g.home !== nick && g.away !== nick) return;
    if (mkGameVoid(g)) return;
    const o = mkMatchOutcome((scores || {})[gk(r, gi)]); if (!o) return;
    const meHome = g.home === nick;
    const myConf = meHome ? o.confH : o.confA, opConf = meHome ? o.confA : o.confH;
    const myRounds = meHome ? o.roundsH : o.roundsA, opRounds = meHome ? o.roundsA : o.roundsH;
    const res = myConf > opConf ? 'V' : myConf < opConf ? 'D' : 'E';
    const ln = (lineups || {})[gk(r, gi)] || {};
    const ch = (part, side) => (ln[part] && ln[part][side]) || null;
    const chars = [ch('p1', meHome ? 'home' : 'away'), ch('p2', meHome ? 'home' : 'away')].filter(Boolean);
    // 2×0 (lavada) e 2×1 (suado) são por PARTIDA (em rounds), não por confronto —
    // o confronto só tem 2 partidas, então "2×1 de partidas" nem existe.
    const myPart = meHome ? [[o.p1h, o.p1a], [o.p2h, o.p2a]] : [[o.p1a, o.p1h], [o.p2a, o.p2h]];
    let lavadas = 0, suados = 0;
    myPart.forEach(([mine, opp]) => { if (mine === 2 && opp === 0) lavadas++; else if (mine === 2 && opp === 1) suados++; });
    out.push({ res, myConf, opConf, myRounds, opRounds, lavadas, suados, shutout: myConf > opConf && opRounds === 0, chars });
  }));
  const n = out.length;
  const wins = out.filter(m => m.res === 'V').length;
  const draws = out.filter(m => m.res === 'E').length;
  const losses = out.filter(m => m.res === 'D').length;
  const rf = out.reduce((s, m) => s + (m.myRounds || 0), 0);
  const ra = out.reduce((s, m) => s + (m.opRounds || 0), 0);
  const shutouts = out.filter(m => m.shutout).length;
  const charMap = {};
  out.forEach(m => m.chars.forEach(c => { if (!charMap[c]) charMap[c] = { char: c, apps: 0, wins: 0 }; charMap[c].apps++; if (m.res === 'V') charMap[c].wins++; }));
  const characters = Object.values(charMap).sort((a, b) => b.apps - a.apps || b.wins - a.wins);
  let curW = 0, bestW = 0; out.forEach(m => { if (m.res === 'V') curW++; else curW = 0; if (curW > bestW) bestW = curW; });
  let endW = 0; for (let i = out.length - 1; i >= 0; i--) { if (out[i].res === 'V') endW++; else break; }
  const points = wins * 3 + draws;
  return {
    n, wins, draws, losses, rf, ra, sg: rf - ra, points,
    winRate: n ? wins / n * 100 : 0, ppg: n ? points / n : 0,
    twoZero: out.reduce((s, m) => s + m.lavadas, 0), twoOne: out.reduce((s, m) => s + m.suados, 0),
    shutouts, shutoutRate: n ? shutouts / n * 100 : 0,
    characters, bestWinStreak: bestW, curWinStreak: endW,
  };
}
// Ranking POR PERSONAGEM: pra cada boneco, quem tem o melhor aproveitamento.
function characterLeaderboard(players, draw, scores, lineups) {
  const byChar = {};
  (players || []).forEach(nick => {
    const m = mkPlayerDetailedStats(nick, draw, scores, lineups);
    m.characters.forEach(c => {
      (byChar[c.char] || (byChar[c.char] = { char: c.char, rows: [] })).rows.push({ nick, apps: c.apps, wins: c.wins });
    });
  });
  return Object.values(byChar).map(cd => {
    const ranked = cd.rows.slice().sort((a, b) => (b.wins / b.apps) - (a.wins / a.apps) || b.apps - a.apps);
    return { char: cd.char, best: ranked[0], totalApps: cd.rows.reduce((s, r) => s + r.apps, 0) };
  }).filter(x => x.best).sort((a, b) => b.totalApps - a.totalApps);
}
// Ranking de TODOS os jogadores com UM personagem (clicou no boneco no domínio).
function charPlayerRanking(char, players, draw, scores, lineups) {
  const rows = [];
  (players || []).forEach(nick => {
    const m = mkPlayerDetailedStats(nick, draw, scores, lineups);
    const c = m.characters.find(x => x.char === char);
    if (c && c.apps > 0) rows.push({ nick, apps: c.apps, wins: c.wins, losses: c.apps - c.wins, winRate: c.wins / c.apps });
  });
  return rows.sort((a, b) => b.winRate - a.winRate || b.apps - a.apps || b.wins - a.wins);
}
function CharRankModal({ char, players, draw, scores, lineups, teamPlayers, onClose }) {
  if (!char) return null;
  const rows = charPlayerRanking(char, players, draw, scores, lineups);
  return (
    <div className="mj-modal-backdrop" onClick={onClose}>
      <div className="mj-modal cr-modal" onClick={e => e.stopPropagation()}>
        <button className="mj-modal-close" type="button" aria-label="Fechar" onClick={onClose}><Icon name="x" size={18} /></button>
        <div className="cr-head">
          <MkCharIcon name={char} />
          <div className="cr-head-info">
            <div className="cr-title">{char}</div>
            <div className="cr-sub">RANKING POR PERSONAGEM · {rows.length} JOGADOR{rows.length === 1 ? '' : 'ES'}</div>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            {rows.length === 0 ? (
              <div className="empty"><div className="e1">SEM DADOS</div><div className="e2">Ninguém usou {char} ainda.</div></div>
            ) : (
              <div className="cr-list">
                {rows.map((r, i) => (
                  <div key={r.nick} className={'cr-row' + (i === 0 ? ' top' : '')}>
                    <span className={'cr-pos rank-' + (i + 1)}>{i + 1}</span>
                    <Avatar nick={r.nick} teamPlayers={teamPlayers} size={26} noBadge />
                    <span className="cr-nick">{r.nick}</span>
                    <span className="cr-wr">{Math.round(r.winRate * 100)}%</span>
                    <span className="cr-vd">{r.wins}V · {r.losses}D <small>· {r.apps} usos</small></span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
// `bare`: renderiza SEM o wrapper .card (pra encaixar dentro de outro card,
// ex.: dentro do MORTAL KOMBAT · DETALHADO, logo após a seção PERSONAGENS).
function CharacterLeaderboard({ players, mkDraw, mkScores, mkLineups, teamPlayers, onOpenProfile, bare }) {
  const [open, setOpen] = useState(false);
  const [openChar, setOpenChar] = useState(null);
  const board = characterLeaderboard(players, mkDraw, mkScores, mkLineups);
  if (!board.length) return null;
  const inner = (
    <>
      <button type="button" className={'charlb-toggle' + (bare ? ' charlb-toggle--inline' : '')} onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="charlb-toggle-t"><Icon name="skull" size={15} /> DOMÍNIO POR PERSONAGEM</span>
        <span className="charlb-toggle-r">{open ? 'OCULTAR' : 'VER DETALHES'} <Icon name={open ? 'caret-up' : 'caret-down'} size={13} /></span>
      </button>
      {open && (
        <div className={bare ? 'charlb-body' : 'card-body'}>
          <div className="charlb">
            {board.map(x => {
              const b = x.best, losses = b.apps - b.wins, wr = Math.round(b.wins / b.apps * 100);
              return (
                <button type="button" key={x.char} className="charlb-row" onClick={() => setOpenChar(x.char)} title={'Ver ranking de ' + x.char}>
                  <MkCharIcon name={x.char} />
                  <div className="charlb-info">
                    <div className="charlb-char">{x.char}</div>
                    <span className="charlb-best">
                      <Avatar nick={b.nick} teamPlayers={teamPlayers} size={18} noBadge /> <span>{b.nick}</span>
                    </span>
                  </div>
                  <div className="charlb-stat">
                    <div className="charlb-wr">{wr}%</div>
                    <div className="charlb-vd">{b.wins}V · {losses}D <span className="charlb-apps">· {x.totalApps} usos</span></div>
                  </div>
                  <Icon name="arrow-right" size={13} className="charlb-go" />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
  const modal = <CharRankModal char={openChar} players={players} draw={mkDraw} scores={mkScores} lineups={mkLineups} teamPlayers={teamPlayers} onClose={() => setOpenChar(null)} />;
  return bare
    ? <><div className="charlb-inline">{inner}</div>{modal}</>
    : <><div className="card">{inner}</div>{modal}</>;
}
function StatTile({ label, value, hl }) {
  return (
    <div className={'dstat' + (hl ? ' hl' : '')}>
      <div className="dstat-v">{value}</div>
      <div className="dstat-l">{label}</div>
    </div>
  );
}
// Detalhamento a fundo de UM jogador (quando o mesmo perfil é escolhido nos 2 lados).
// `players` (opcional): se vier, mostra o DOMÍNIO POR PERSONAGEM (ranking global)
// logo após a seção de personagens do jogador.
function DetailedStatsCard({ nick, teamPlayers, cs, mkDraw, mkScores, mkLineups, players, onOpenProfile }) {
  const f = fifaPlayerDetailedStats(nick, teamPlayers, cs ? cs.rounds : []);
  const m = mkPlayerDetailedStats(nick, mkDraw, mkScores, mkLineups);
  const pct = (v) => Math.round(v) + '%';
  const dec = (v) => (Math.round(v * 100) / 100).toFixed(2);
  return (
    <>
      {f.n > 0 && (
        <div className="card">
          <div className="card-head"><div className="title"><Icon name="football" size={15} /> FIFA · DETALHADO</div><div className="sub">{f.n} JOGOS</div></div>
          <div className="card-body">
            <div className="dstats-grid">
              <StatTile label="APROVEITAMENTO" value={pct(f.winRate)} hl />
              <StatTile label="V / E / D" value={f.wins + '/' + f.draws + '/' + f.losses} />
              <StatTile label="PONTOS" value={f.points} />
              <StatTile label="PTS/JOGO" value={dec(f.ppg)} />
              <StatTile label="GOLS PRÓ" value={f.gf} />
              <StatTile label="GOLS CONTRA" value={f.ga} />
              <StatTile label="SALDO" value={(f.sg > 0 ? '+' : '') + f.sg} />
              <StatTile label="SEM SOFRER" value={f.cleanSheets} />
              <StatTile label="NÃO MARCOU" value={f.failToScore} />
              <StatTile label="GOLEADAS (3+)" value={f.goleadas} />
              <StatTile label="MAIOR VITÓRIA" value={'+' + f.biggestWin} />
              <StatTile label="MELHOR SEQ. V" value={f.bestWinStreak} hl />
              <StatTile label="INVENCIBILIDADE" value={f.bestUnbeaten} />
              <StatTile label="SEQ. ATUAL V" value={f.curWinStreak} />
            </div>
          </div>
        </div>
      )}
      {m.n > 0 && (
        <div className="card">
          <div className="card-head"><div className="title"><Icon name="skull" size={15} /> MORTAL KOMBAT · DETALHADO</div><div className="sub">{m.n} CONFRONTOS</div></div>
          <div className="card-body">
            <div className="dstats-grid">
              <StatTile label="APROVEITAMENTO" value={pct(m.winRate)} hl />
              <StatTile label="V / E / D" value={m.wins + '/' + m.draws + '/' + m.losses} />
              <StatTile label="2×0 (LAVADA)" value={m.twoZero} hl />
              <StatTile label="2×1 (SUADO)" value={m.twoOne} />
              <StatTile label="ROUNDS PRÓ" value={m.rf} />
              <StatTile label="ROUNDS CONTRA" value={m.ra} />
              <StatTile label="PERFEITAS" value={m.shutouts} />
              <StatTile label="% PERFEITA" value={pct(m.shutoutRate)} />
              <StatTile label="MELHOR SEQ. V" value={m.bestWinStreak} hl />
              <StatTile label="SEQ. ATUAL V" value={m.curWinStreak} />
            </div>
            {m.characters.length > 0 && (
              <>
                <div className="dstats-sub">PERSONAGENS · USO E APROVEITAMENTO</div>
                <div className="dstats-chars">
                  {m.characters.map(c => (
                    <div key={c.char} className="dchar">
                      <MkCharIcon name={c.char} />
                      <div className="dchar-info">
                        <div className="dchar-n">{c.char}</div>
                        <div className="dchar-s">{c.apps}x · {c.apps ? Math.round(c.wins / c.apps * 100) : 0}% V</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {players && players.length > 0 && (
              <CharacterLeaderboard bare players={players} mkDraw={mkDraw} mkScores={mkScores} mkLineups={mkLineups} teamPlayers={teamPlayers} onOpenProfile={onOpenProfile} />
            )}
          </div>
        </div>
      )}
      {f.n === 0 && m.n === 0 && (
        <div className="card"><div className="card-body"><div className="empty"><div className="e1">SEM DADOS</div><div className="e2">{nick} ainda não tem jogos lançados na FIFA nem no MK.</div></div></div></div>
      )}
    </>
  );
}

// Perfil de QUALQUER jogador num modal (clicou no nome/foto nas apostas):
// foto + nome + reputação + troféus + estatísticas detalhadas. Só leitura.
function PlayerProfileModal({ nick, users, cs, bets, teamPlayers, mkDraw, mkScores, mkLineups, onClose }) {
  if (!nick) return null;
  const u = (users || {})[nick] || {};
  const tro = trophiesForNick(nick, cs, teamPlayers || {});
  const betKing = betKingChamps(nick, cs, bets || []);
  const groups = ['champion', 'vice', 'terceiro', 'participou', 'penultimo', 'lanterna'];
  return (
    <div className="mj-modal-backdrop" onClick={onClose}>
      <div className="mj-modal pp-modal" onClick={e => e.stopPropagation()}>
        <button className="mj-modal-close" type="button" aria-label="Fechar" onClick={onClose}><Icon name="x" size={18} /></button>
        <div className="pp-head">
          <Avatar nick={nick} teamPlayers={teamPlayers} size={58} noBadge />
          <div className="pp-head-info">
            <div className="pp-name">{nick}</div>
            <RepBadge user={u} />
          </div>
        </div>
        {(tro.length > 0 || betKing.length > 0) && (
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-head"><div className="title"><Icon name="trophy" size={15} /> TROFÉUS</div><div className="sub">{tro.length + betKing.length}</div></div>
            <div className="card-body">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {betKing.length > 0 && (
                  <TrophyGroup kind="betking" editions={betKing.map(b => { const c = CHAMP_BY_ID[b.champId]; return { tag: c ? c.tag : b.champId, season: c ? c.season : '' }; })} />
                )}
                {groups.map(kind => {
                  const group = tro.filter(t => t.kind === kind);
                  if (!group.length) return null;
                  const editions = group.map(t => { const cc = CHAMP_BY_ID[t.champId]; return { tag: cc && cc.tag, season: cc && cc.season }; });
                  return <TrophyGroup key={kind} kind={kind} editions={editions} />;
                })}
              </div>
            </div>
          </div>
        )}
        <DetailedStatsCard nick={nick} teamPlayers={teamPlayers} cs={cs} mkDraw={mkDraw} mkScores={mkScores} mkLineups={mkLineups} />
      </div>
    </div>
  );
}

// Perfil SÓ DE APOSTAS de um jogador (clicou no ranking de apostas).
function BetProfileModal({ nick, users, bets, cs, teamPlayers, onClose }) {
  if (!nick) return null;
  const u = (users || {})[nick] || {};
  const rep = u.rep || {};
  const s = betProfileStats(nick, bets);
  const betKing = betKingChamps(nick, cs, bets || []);
  const sign = (v) => (v < 0 ? '-' : v > 0 ? '+' : '') + compactPC(v); // compacto (900K) com sinal
  const recent = (bets || []).filter(b => b.user === nick).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 3);
  return (
    <div className="mj-modal-backdrop" onClick={onClose}>
      <div className="mj-modal pp-modal" onClick={e => e.stopPropagation()}>
        <button className="mj-modal-close" type="button" aria-label="Fechar" onClick={onClose}><Icon name="x" size={18} /></button>
        <div className="pp-head">
          <Avatar nick={nick} teamPlayers={teamPlayers} size={58} noBadge />
          <div className="pp-head-info">
            <div className="pp-name">{nick}</div>
            <RepBadge user={u} />
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div className="title"><Icon name="ticket" size={15} /> PERFIL DE APOSTAS</div><div className="sub">{s.total} APOSTAS</div></div>
          <div className="card-body">
            <div className="dstats-grid">
              <StatTile label="LUCRO" value={sign(s.lucro)} hl />
              <StatTile label="APROVEITAMENTO" value={s.winRate + '%'} />
              <StatTile label="VITÓRIAS / DERROTAS" value={s.won + ' / ' + s.lost} />
              <StatTile label="ABERTAS" value={s.pend} />
              <StatTile label="TOTAL APOSTADO" value={compactPC(s.wagered)} />
              <StatTile label="MAIOR GANHO" value={'+' + compactPC(s.biggest)} />
              <StatTile label="MELHOR SEQ. V" value={s.bestStreak} hl />
              <StatTile label="CÓPIAS FEITAS" value={s.copies} />
            </div>
            {betKing.length > 0 && (
              <div className="bp-king"><Icon name="tr-betking" size={22} /> REI DAS APOSTAS · {betKing.map(b => { const c = CHAMP_BY_ID[b.champId]; return (c ? c.tag : b.champId) + ' ' + (c ? c.season.replace('Season ', 'S') : ''); }).join(' · ')}</div>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div className="title"><Icon name="cards" size={15} /> REPUTAÇÃO DE DICAS</div></div>
          <div className="card-body">
            <div className="bp-rep">
              <RepBadge user={u} />
              <div className="bp-rep-stats">
                <span><b>{rep.followersWon || 0}</b> seguidores ganharam</span>
                <span><b>{rep.followersLost || 0}</b> perderam</span>
                {rep.tips ? <span>gorjetas: <b>+{compactPC(rep.tips)} PC</b></span> : null}
              </div>
            </div>
          </div>
        </div>
        {recent.length > 0 && (
          <div className="card">
            <div className="card-head"><div className="title"><Icon name="ticket" size={15} /> ÚLTIMOS TICKETS</div></div>
            <div className="card-body">
              <div className="bp-tklist">
                {recent.map(t => (
                  <div key={t.id} className={'bp-tk ' + t.status}>
                    <span className="bp-tk-dot" />
                    <span className="bp-tk-l">
                      <span className="bp-tk-type">{(t.legs || []).length > 1 ? 'CASADA ' + t.legs.length : 'SIMPLES'} · {Number(t.combinedOdds || 0).toFixed(2)}x{t.copyOf ? ' · cópia' : ''}</span>
                      <span className="bp-tk-st">{t.status === 'won' ? 'VENCEU · +' + compactPC(t.payout || 0) + ' PC' : t.status === 'lost' ? 'PERDEU' : 'EM ABERTO'}</span>
                    </span>
                    <span className="bp-tk-amt">{compactPC(t.amount)} <small>PC</small></span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EstatisticasView({ nick, users, cs, bets, teamPlayers, worldcup, mkDraw, mkScores, mkLineups, interests, comments }) {
  const ctx = { users: users || {}, bets: bets || [], teamPlayers: teamPlayers || {}, cs, worldcup, interests: interests || {}, comments: comments || {}, mk: { draw: mkDraw, scores: mkScores } };

  // universo de jogadores (menos o admin e quem se retirou), em ordem alfabética
  const players = Object.keys(users || {}).filter(n => n && n !== ADMIN_NICK && !mkIsWithdrawn(n)).sort((a, b) => a.localeCompare(b));
  // ESQUERDA começa em VOCÊ; DIREITA no primeiro outro. As setas trocam cada
  // lado independente — dá pra comparar dois perfis quaisquer. VOCÊ (`nick`)
  // fica destacado onde aparecer.
  const left0 = players.indexOf(nick) >= 0 ? nick : (players[0] || nick);
  const [left, setLeft] = useState(left0);
  const [right, setRight] = useState(null); // direita começa VAZIA (escolhe na lista pra comparar)

  // FIFA guarda fixtures por TEAM ID (não nick); teamPlayers mapeia teamId->nick.
  // reverseTeamMap dá nick->teamId. Identidade na maioria, menos ex.: juca->jucamelero.
  const fifaStand = computeStandings(cs ? cs.rounds : []);
  const nick2team = reverseTeamMap(teamPlayers || {});
  const teamOf = (n) => nick2team[n] || n;        // nick -> teamId (fallback: o próprio)
  const nickOf = (tid) => (teamPlayers || {})[tid] || tid; // teamId -> nick (fallback: o próprio)
  const fifaPos = (n) => { const i = fifaStand.findIndex(s => s.id === teamOf(n)); return i < 0 ? null : i + 1; };
  const gKey = (r, gi) => r.phase + '-' + r.n + '-' + gi;
  const mkPlayers = mkInscritos(interests);
  const mkMatchesAll = (mkDraw || []).flatMap(r => r.games.map((g, gi) => ({ home: g.home, away: g.away, sc: (mkScores || {})[gKey(r, gi)] || {} }))).filter(m => !mkGameVoid(m));
  const mkStand = computeMkStandings(mkPlayers, mkMatchesAll);
  const mkPos = (n) => { const i = mkStand.findIndex(s => s.nick === n); return i < 0 ? null : i + 1; };

  const trophiesOf = (n) => trophiesForNick(n, cs, teamPlayers || {});
  const titlesOf = (n) => titlesForNick(n, ctx);
  const pcOf = (n) => Math.round(((users || {})[n] || {}).pc || 0);
  // REI DAS APOSTAS — campeão da season de apostas (por campeonato fechado).
  const betKingOf = (n) => betKingChamps(n, cs, bets).map(b => { const c = CHAMP_BY_ID[b.champId]; return { tag: (c && c.tag) || b.champId, season: (c && c.season) || '' }; });
  const troTotal = (n) => trophiesOf(n).length + betKingOf(n).length;
  // Jogos da FIFA de um jogador (resolve nick -> teamId), com round/índices.
  const fifaGamesOf = (n) => {
    const tid = teamOf(n);
    const out = [];
    (cs ? cs.rounds : []).forEach((r, ri) => (r || []).forEach((g, gi) => {
      if (g.home === tid || g.away === tid) out.push({ ...g, ri, gi, round: ri + 1 });
    }));
    return out;
  };

  // confrontos diretos entre A (esq) e B (dir) em todos os jogos.
  const h2hBetween = (a, b) => {
    const out = [];
    const aT = teamOf(a), bT = teamOf(b);
    (cs ? cs.rounds : []).forEach((r, ri) => (r || []).forEach(m => {
      if (!((m.home === aT && m.away === bT) || (m.home === bT && m.away === aT))) return;
      const gh = parseInt(m.gh, 10), ga = parseInt(m.ga, 10);
      if (Number.isNaN(gh) || Number.isNaN(ga)) return;
      const wT = gh > ga ? m.home : gh < ga ? m.away : null;
      out.push({ game: 'fifa', label: 'FIFA · R' + String(ri + 1).padStart(2, '0'), home: m.home, away: m.away, homeLabel: nickOf(m.home), awayLabel: nickOf(m.away), sh: gh, sa: ga, winner: wT ? nickOf(wT) : 'D' });
    }));
    (mkDraw || []).forEach(r => r.games.forEach((g, gi) => {
      if (mkGameVoid(g)) return; // jogo anulado (jogador retirado) não conta no H2H
      if (!((g.home === a && g.away === b) || (g.home === b && g.away === a))) return;
      const o = mkMatchOutcome((mkScores || {})[gKey(r, gi)]);
      if (!o) return;
      out.push({ game: 'mk', label: 'MK · ' + (r.phase === 'IDA' ? 'IDA' : 'VOLTA') + ' R' + String(r.n).padStart(2, '0'), home: g.home, away: g.away, homeLabel: g.home, awayLabel: g.away, sh: o.confH, sa: o.confA, winner: o.winner === 'H' ? g.home : o.winner === 'A' ? g.away : 'D' });
    }));
    return out;
  };

  const playerIc = (n, game) => game === 'fifa'
    ? <ClubCrest nick={n} teamPlayers={teamPlayers} size={30} />
    : <Avatar nick={n} teamPlayers={teamPlayers} size={28} noBadge />;
  const sideLabel = (n) => n === nick ? 'VOCÊ' : n;
  const better = (a, b, dir) => {
    if (a == null && b == null) return 0;
    if (a == null) return 1; if (b == null) return -1;
    if (a === b) return 0;
    return dir === 'more' ? (a > b ? -1 : 1) : (a < b ? -1 : 1);
  };

  const list = right ? h2hBetween(left, right) : [];
  // DETALHAMENTO a fundo quando há UM perfil em foco: só a esquerda (sem direita
  // escolhida) OU o mesmo nos dois lados. Dois perfis diferentes -> comparação.
  const sameProfile = !right || right === left;
  const profiles = sameProfile ? [left] : [left, right].filter(Boolean);
  let aWins = 0, bWins = 0, draws = 0;
  list.forEach(x => { if (x.winner === 'D') draws++; else if (x.winner === left) aWins++; else if (x.winner === right) bWins++; });
  const cmpRows = [
    { label: 'TROFÉUS', a: troTotal(left), b: troTotal(right), dir: 'more' },
    { label: 'CONQUISTAS', a: titlesOf(left).length, b: titlesOf(right).length, dir: 'more' },
    { label: 'PONTOS', a: achievementScore(left, ctx), b: achievementScore(right, ctx), dir: 'more' },
    { label: 'PRIMITIVO COINS', a: pcOf(left), b: pcOf(right), dir: 'more' },
    { label: 'POSIÇÃO FIFA', a: fifaPos(left), b: fifaPos(right), dir: 'less' },
    { label: 'POSIÇÃO MK', a: mkPos(left), b: mkPos(right), dir: 'less' },
  ];

  return (
    <div className="stats-layout">
      {/* SIDEBAR ESQUERDA — escolhe o jogador da esquerda */}
      <aside className="stats-rail">
        <div className="stats-rail-h"><Icon name="user" size={12} /> ESQUERDA</div>
        <div className="stats-rail-list">
          {players.map(n => (
            <button key={n} type="button" className={'stats-rail-item' + (left === n ? ' on' : '')} onClick={() => setLeft(n)}>
              <Avatar nick={n} teamPlayers={teamPlayers} size={28} noBadge />
              <span className="stats-rail-nick">{n}</span>
              {n === nick && <span className="stats-rail-you">VOCÊ</span>}
            </button>
          ))}
        </div>
      </aside>

      {/* CENTRO — comparação */}
      <div className="stats-main">
        <div className="card">
          <div className="card-head">
            <div className="title"><Icon name="medal" size={16} /> ESTATÍSTICAS</div>
            <div className="sub">COMPARAÇÃO · H2H</div>
          </div>
          <div className="card-body">
            <div className="stats-vs">
              <div className={'stats-vs-side' + (left === nick ? ' me' : '')}>
                <Avatar nick={left} teamPlayers={teamPlayers} size={64} />
                <span className="stats-vs-nick">{left}</span><small>{sideLabel(left)}</small>
              </div>
              <div className="stats-vs-mid">
                {sameProfile ? (
                  <span className="stats-vs-novs">DETALHADO</span>
                ) : right ? (
                  <>
                    <span className="stats-vs-score"><b className={aWins > bWins ? 'hi' : ''}>{aWins}</b><i>-</i><b className={bWins > aWins ? 'hi' : ''}>{bWins}</b></span>
                    <span className="stats-vs-d">{draws} empate{draws === 1 ? '' : 's'}</span>
                  </>
                ) : <span className="stats-vs-novs">VS</span>}
              </div>
              {right ? (
                <div className={'stats-vs-side' + (right === nick ? ' me' : '')}>
                  <Avatar nick={right} teamPlayers={teamPlayers} size={64} />
                  <span className="stats-vs-nick">{right}</span><small>{sideLabel(right)}</small>
                </div>
              ) : (
                <div className="stats-vs-empty">Escolha um jogador na lista da <strong>direita</strong> pra comparar.</div>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="title"><Icon name="trophy" size={16} /> TROFÉUS</div></div>
          <div className="card-body">
            <div className={'stats-tro-cols' + (profiles.length > 1 ? '' : ' single')}>
              {profiles.map((p, pi) => {
                const tro = trophiesOf(p), betKing = betKingOf(p);
                const totalTro = tro.length + betKing.length;
                return (
                  <div key={p + pi} className="stats-prof">
                    <div className={'stats-tro-name' + (p === nick ? ' me' : '')}>{p}{p === nick && <span className="stats-you">VOCÊ</span>}</div>
                    <div className="stats-tro-h">TROFÉUS · {totalTro}</div>
                    {totalTro === 0 ? <div className="stats-none">Sem troféus ainda.</div> : (
                      <div className="stats-tro-big">
                        {betKing.length > 0 && <TrophyGroup kind="betking" editions={betKing} />}
                        {['champion', 'vice', 'terceiro', 'participou', 'penultimo', 'lanterna'].map(kind => {
                          const group = tro.filter(t => t.kind === kind);
                          if (!group.length) return null;
                          const editions = group.map(t => { const cc = CHAMP_BY_ID[t.champId]; return { tag: (cc && cc.tag) || t.champId, season: (cc && cc.season) || '' }; });
                          return <TrophyGroup key={kind} kind={kind} editions={editions} />;
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {sameProfile && (
          <DetailedStatsCard nick={left} teamPlayers={teamPlayers} cs={cs} mkDraw={mkDraw} mkScores={mkScores} mkLineups={mkLineups} players={players} />
        )}

        {right && !sameProfile && (
          <div className="card">
            <div className="card-head"><div className="title">COMPARAÇÃO</div></div>
            <div className="card-body" style={{ overflowX: 'auto' }}>
              <table className="stats-cmp">
                <thead><tr><th></th><th className={left === nick ? 'me' : ''}>{left}{left === nick && <span className="stats-you">VOCÊ</span>}</th><th className={right === nick ? 'me' : ''}>{right}{right === nick && <span className="stats-you">VOCÊ</span>}</th></tr></thead>
                <tbody>
                  {cmpRows.map(r => {
                    const c = better(r.a, r.b, r.dir);
                    const fmt = (v) => v == null ? '—' : (r.label.indexOf('POSIÇÃO') === 0 ? v + 'º' : v);
                    return (
                      <tr key={r.label}>
                        <td className="stats-cmp-l">{r.label}</td>
                        <td className={c < 0 ? 'win' : ''}>{fmt(r.a)}</td>
                        <td className={c > 0 ? 'win' : ''}>{fmt(r.b)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {right && !sameProfile && (
          <div className="card mk-card">
            <div className="card-head"><div className="title"><Icon name="sword" size={15} /> CONFRONTOS DIRETOS</div><div className="sub">{list.length} JOGO{list.length === 1 ? '' : 'S'}</div></div>
            <div className="card-body">
              {list.length === 0 ? (
                <div className="empty"><div className="e1">SEM CONFRONTOS</div><div className="e2">{left} e {right} ainda não se enfrentaram em nenhum jogo lançado.</div></div>
              ) : (
                <div className="mk-fixtures">
                  {list.map((x, i) => {
                    const draw = x.winner === 'D';
                    const youIn = left === nick || right === nick;
                    const youWon = x.winner === nick;
                    const youLost = youIn && !draw && !youWon;
                    const resClass = draw ? 'd' : youWon ? 'w' : youLost ? 'l' : 'n';
                    const resText = draw ? 'EMPATE' : (youWon ? 'VOCÊ VENCEU' : x.winner + ' VENCEU');
                    return (
                      <div key={i} className={'mk-fx done' + (youWon ? ' mine' : '')}>
                        <div className="mk-fx-top">
                          <span className="mk-fx-jogo">{x.label}</span>
                          <span className={'h2h-res ' + resClass}>{resText}</span>
                        </div>
                        <div className="mk-fx-body">
                          <div className="mk-fx-side home">{playerIc(x.home, x.game)}<div className="mk-fx-id"><div className="mk-fx-nick">{x.homeLabel}</div></div></div>
                          <div className="fifa-fx-score"><span className="fifa-fx-sc">{x.sh} × {x.sa}</span></div>
                          <div className="mk-fx-side away">{playerIc(x.away, x.game)}<div className="mk-fx-id"><div className="mk-fx-nick">{x.awayLabel}</div></div></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* HISTÓRICO DE PARTIDAS — FIFA (@nick) + MK (placares das partidas + personagens) */}
        <div className="card">
          <div className="card-head"><div className="title">HISTÓRICO DE PARTIDAS</div></div>
          <div className="card-body">
            <div className={'stats-tro-cols' + (profiles.length > 1 ? '' : ' single')}>
              {profiles.map((p, pi) => {
                const tid = teamOf(p);
                const fifaPlayed = fifaGamesOf(p).filter(isGamePlayed);
                const inMk = mkPlayers.includes(p);
                return (
                  <div key={'h' + p + pi} className="stats-prof">
                    <div className={'stats-tro-name' + (p === nick ? ' me' : '')}>{p}{p === nick && <span className="stats-you">VOCÊ</span>}</div>
                    <CollapseBox title="FIFA" count={fifaPlayed.length} icon="football" defaultOpen>
                      {fifaPlayed.length === 0
                        ? <div className="stats-none">Sem jogos na FIFA.</div>
                        : fifaPlayed.map(g => <MatchRow key={'f' + g.ri + '-' + g.gi} g={g} myTeamId={tid} teamPlayers={teamPlayers} />)}
                    </CollapseBox>
                    {inMk && (
                      <CollapseBox title="MORTAL KOMBAT" icon="skull" defaultOpen>
                        <MkMatchHistory nick={p} draw={mkDraw} scores={mkScores} lineups={mkLineups} />
                      </CollapseBox>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* SIDEBAR DIREITA — escolhe o jogador da direita (clica de novo pra limpar) */}
      <aside className="stats-rail">
        <div className="stats-rail-h"><Icon name="user" size={12} /> DIREITA</div>
        <div className="stats-rail-list">
          {players.map(n => (
            <button key={n} type="button" className={'stats-rail-item' + (right === n ? ' on' : '')} onClick={() => setRight(right === n ? null : n)}>
              <Avatar nick={n} teamPlayers={teamPlayers} size={28} noBadge />
              <span className="stats-rail-nick">{n}</span>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}

function MeuPerfilView({ nick, me, cs, bets, users, teamPlayers, worldcup, isAdmin, onSelectTitle, onEquip, interests, onCancelInterest, mkDraw, mkScores, mkLineups, ctx, onSeeRanking, theme, onSetTheme, currentAvatar, onUploadAvatar, onRemoveAvatar, isNaturalMod, modDisabled, onToggleMod }) {
  const [inscBusy, setInscBusy] = useState(null);
  const [ptab, setPtab] = useState('resumo'); // sub-aba: resumo / time / trofeus / titulos / colecao
  const champLabel = (cid) => cid === 'copa'
    ? 'COPA DO MUNDO'
    : (CHAMP_BY_ID[cid] ? `${CHAMP_BY_ID[cid].tag} · ${CHAMP_BY_ID[cid].season}` : cid.toUpperCase());
  const champTag = (cid) => cid === 'copa' ? 'COPA' : (CHAMP_BY_ID[cid]?.tag || cid.toUpperCase());
  // Só inscrições de campeonatos que AINDA NÃO COMEÇARAM (status 'soon'/em breve).
  // Quando o campeonato vira 'active' (ex: MK, que já rolou o sorteio) ou fecha,
  // sai da lista — não dá pra "cancelar inscrição" de algo que já começou.
  const myInscriptions = Object.keys(interests || {}).filter(cid =>
    interests[cid] && interests[cid][nick] && (CHAMP_BY_ID[cid] ? CHAMP_BY_ID[cid].status === 'soon' : false));
  const cancelInscription = async (cid) => {
    if (inscBusy) return;
    if (!(await confirmModal({ title: 'CANCELAR INSCRIÇÃO?', body: 'Sai da lista de ' + champLabel(cid) + '. Dá pra se inscrever de novo depois.', confirmLabel: 'CANCELAR INSCRIÇÃO', danger: true }))) return;
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
  const myTeam = !!myTeamId; // participa da FIFA? (sem mais "times")
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

  // POSIÇÃO/RESULTADO no FIFA (campeonato do time). Mostra a colocação — final
  // se encerrado, parcial se em andamento — pra refletir o fim da temporada.
  const fifaTable = computeStandings(rounds);
  const myPosIdx = myTeamId ? fifaTable.findIndex(s => s.id === myTeamId) : -1;
  const myPos = myPosIdx >= 0 ? myPosIdx + 1 : 0;
  const totalTeams = fifaTable.length || TEAMS.length;
  const fifaClosed = computeChampStandings('fifa', cs).status === 'closed';
  const posResult = (pos, total) => {
    if (!pos) return null;
    if (pos === 1) return { label: 'CAMPEÃO', color: '#c79a1e', icon: 'trophy' };
    if (pos === 2) return { label: 'VICE-CAMPEÃO', color: '#7e8794', icon: 'medal' };
    if (pos === 3) return { label: '3º LUGAR', color: '#b06a2c', icon: 'medal' };
    if (pos === total) return { label: 'LANTERNA', color: '#9a3434', icon: 'toilet' };
    if (pos === total - 1) return { label: 'PENÚLTIMO', color: '#6b4423', icon: 'toothbrush' };
    return { label: pos + 'º LUGAR', color: 'rgba(28,22,18,0.6)', icon: 'shield' };
  };
  const myResult = myTeam ? posResult(myPos, totalTeams) : null;
  const lucro = totalReturn - totalStake;
  const resolved = wonBets.length + lostBets.length;
  const aproveit = resolved ? Math.round((wonBets.length / resolved) * 100) : 0;
  const earnedTitleCount = titlesForNick(nick, ctx || {}).length;
  const collectionCount = isAdmin ? 0 : effectiveInventory(nick, me, ctx || {}).length;
  const trophyCount = myTrophies.length + (showBetKing ? betKingSeasons.length : 0);

  // MORTAL KOMBAT (rolando agora): é por JOGADOR, não por time. Calcula a
  // colocação na classificação do MK + os confrontos do jogador.
  const mkPlayers = mkInscritos(interests);
  const mkInscrito = mkPlayers.includes(nick);
  const mkGKeyP = (r, gi) => r.phase + '-' + r.n + '-' + gi;
  const mkConcluded = [];
  (mkDraw || []).forEach(r => (r.games || []).forEach((g, gi) => {
    const sc = (mkScores || {})[mkGKeyP(r, gi)];
    if (sc && mkMatchOutcome(sc)) mkConcluded.push({ home: g.home, away: g.away, sc });
  }));
  const mkStand = mkInscrito ? computeMkStandings(mkPlayers, mkConcluded) : [];
  const myMkIdx = mkStand.findIndex(s => s.nick === nick);
  const myMkPos = myMkIdx >= 0 ? myMkIdx + 1 : 0;
  const myMkRec = myMkIdx >= 0 ? mkStand[myMkIdx] : null;
  const myMkChars = Array.isArray(me?.mkChars) ? me.mkChars : [];
  const myMkGames = [];
  (mkDraw || []).forEach((r, ri) => (r.games || []).forEach((g, gi) => {
    if (mkGameVoid(g)) return; // jogo anulado (adversário retirado) — some do perfil
    if (g.home === nick || g.away === nick) {
      const key = mkGKeyP(r, gi);
      myMkGames.push({ ri, gi, round: r.n, phase: r.phase, opp: g.home === nick ? g.away : g.home, mandante: g.home === nick, sc: (mkScores || {})[key] });
    }
  }));
  const mkAllConcluded = (mkDraw || []).length > 0 && mkDraw.every(r => (r.games || []).every((g, gi) => mkGameVoid(g) || !!mkMatchOutcome((mkScores || {})[mkGKeyP(r, gi)])));
  const mkResult = mkAllConcluded ? posResult(myMkPos, mkStand.length) : null;

  return (
    <div className="perfil perfil-grid" style={{ '--ap-accent': ((me && me.title && getTitleDef(me.title)) || {}).color || '#d76414' }}>
      {/* SIDEBAR do perfil: cartão de identidade (mesma linguagem do rail global
          .ap-card — charcoal + moldura na cor do título) + navegação vertical. */}
      <aside className="perfil-side">
      <div className="perfil-id-card">
        {myTeamId
          ? <Avatar teamId={myTeamId} nick={nick} cosmetics={me?.cosmetics} size={92} className="perfil-id-avatar" />
          : <div className="perfil-id-avatar-fb">{String(nick).slice(0, 2).toUpperCase()}</div>}
        <div className="perfil-id-nick">{nick}</div>
        {me?.title && <TitleBadge titleId={me.title} size="lg" />}
        <div className="perfil-id-meta">
          {myTeam
            ? <span className="perfil-id-team">FIFA</span>
            : <span className="perfil-id-team none">{isAdmin ? 'ADMIN' : 'FORA DA FIFA'}</span>}
          {myResult && (
            <span className="perfil-pos" style={{ color: myResult.color, borderColor: myResult.color }}>
              <Icon name={myResult.icon} size={11} /> {myPos}º · {myResult.label}
            </span>
          )}
        </div>
        {!isAdmin && (
          <div className={'perfil-id-coins' + (HIDE_CC ? ' solo' : '')}>
            <div className="perfil-id-coin" title={(me?.pc ?? 0).toLocaleString('pt-BR') + ' Primitivo Coins'}>
              <span className="perfil-id-coin-v">{compactPC(me?.pc ?? 0)}</span><span className="perfil-id-coin-l">PC</span>
            </div>
            {!HIDE_CC && (
              <div className="perfil-id-coin cc" title="Caco Coins">
                <span className="perfil-id-coin-v">{compactPC(ccBalanceFor(nick, me, ctx || {}))}</span><span className="perfil-id-coin-l">CC</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* NAV vertical do perfil (a sidebar) */}
      <nav className="perfil-side-nav">
        <button className={'perfil-navi ' + (ptab === 'resumo' ? 'active' : '')} onClick={() => setPtab('resumo')}><Icon name="chart" size={14} /> RESUMO</button>
        {(myTeam || mkInscrito) && <button className={'perfil-navi ' + (ptab === 'time' ? 'active' : '')} onClick={() => setPtab('time')}><Icon name="shield" size={14} /> MEUS JOGOS</button>}
        <button className={'perfil-navi ' + (ptab === 'titulos' ? 'active' : '')} onClick={() => setPtab('titulos')}><Icon name="trophy" size={14} /> CONQUISTAS</button>
        {!isAdmin && <button className={'perfil-navi ' + (ptab === 'colecao' ? 'active' : '')} onClick={() => setPtab('colecao')}><Icon name="star" size={14} /> COLEÇÃO</button>}
        <button className={'perfil-navi ' + (ptab === 'aparencia' ? 'active' : '')} onClick={() => setPtab('aparencia')}><Icon name="sparkle" size={14} /> APARÊNCIA</button>
      </nav>
      </aside>
      {/* CONTEÚDO da aba selecionada */}
      <div className="perfil-main">

      {/* ===== RESUMO ===== */}
      {ptab === 'resumo' && (
        <>
          {isNaturalMod && (
            <div className="card" style={{ marginBottom: 14, borderColor: modDisabled ? 'rgba(28,22,18,0.2)' : 'var(--pv-orange)' }}>
              <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 12, letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="shield" size={13} /> MODO MODERADOR · {modDisabled ? 'DESATIVADO' : 'ATIVO'}</div>
                  <div style={{ fontSize: 11, color: 'rgba(28,22,18,0.6)', marginTop: 3, lineHeight: 1.4 }}>{modDisabled ? 'Você está vendo o app como jogador comum. Reative quando quiser.' : 'Você lança placar, trava apostas e vê a aba ADMIN. Pode desativar pra usar como jogador.'}</div>
                </div>
                <button type="button" onClick={onToggleMod} className="tp-btn-go" style={{ flexShrink: 0, background: modDisabled ? 'var(--pv-orange)' : 'var(--pv-charcoal)' }}>
                  {modDisabled ? 'ATIVAR MOD' : 'DESATIVAR MOD'}
                </button>
              </div>
            </div>
          )}
          {!isAdmin && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="card-head"><div className="title">MINHAS APOSTAS</div><div className="sub">{myBets.length} TICKETS</div></div>
              <div className="card-body">
                <div className="perfil-stats">
                  <Stat label="APOSTADO" value={`${totalStake} PC`} />
                  <Stat label="RETORNO" value={`${totalReturn} PC`} accent />
                  <Stat label="LUCRO" value={`${lucro >= 0 ? '+' : ''}${lucro} PC`} accent={lucro >= 0} />
                  <Stat label="VITÓRIAS" value={wonBets.length} />
                  <Stat label="DERROTAS" value={lostBets.length} />
                  <Stat label="APROVEIT." value={`${aproveit}%`} />
                </div>
              </div>
            </div>
          )}

          {/* MEUS TROFÉUS — vitrine direto no resumo */}
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-head">
              <div className="title"><Icon name="trophy" size={16} /> MEUS TROFÉUS</div>
              <div className="sub">{myTrophies.length ? myTrophies.length : (previewTrophies.length ? 'PRÉVIA' : (showBetKing ? betKingSeasons.length : 0))}</div>
            </div>
            <div className="card-body">
              {previewTrophies.length > 0 && (
                <div className="mk-admin-note" style={{ marginBottom: 12 }}><Icon name="lock" size={11} /> Prévia (admin): todos os troféus pra você conferir o visual. Cada jogador vê só os que conquistou.</div>
              )}
              {(showBetKing || showTrophies.length > 0) ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  {showBetKing && <TrophyGroup kind="betking" editions={betKingSeasons} />}
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
              ) : (
                <div className="empty">
                  <div className="e1">VITRINE VAZIA</div>
                  <div className="e2">Você ainda não conquistou nenhum campeonato encerrado.</div>
                </div>
              )}
            </div>
          </div>

          {/* MINHAS INSCRIÇÕES — só "em breve"; chips bem compactos (x = cancelar) */}
          {myInscriptions.length > 0 && (
            <div className="card perfil-insc-card">
              <div className="perfil-insc-head">
                <span className="perfil-insc-title">INSCRIÇÕES · EM BREVE</span>
                <span className="perfil-insc-count">{myInscriptions.length}</span>
              </div>
              <div className="insc-chips">
                {myInscriptions.map(cid => (
                  <span key={cid} className="insc-chip" title={champLabel(cid)}>
                    <span className="insc-chip-tag">{champTag(cid)}</span>
                    <button type="button" className="insc-chip-x" onClick={() => cancelInscription(cid)} disabled={inscBusy === cid} title={'Cancelar inscrição em ' + champLabel(cid)} aria-label={'Cancelar inscrição em ' + champLabel(cid)}>
                      {inscBusy === cid ? '…' : <Icon name="x" size={10} />}
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* SEGURANÇA — trocar a própria senha (admin tem senha fixa no código) */}
          {!isAdmin && <TrocarSenhaCard nick={nick} />}
        </>
      )}

      {/* ===== MEU TIME (FIFA) + MORTAL KOMBAT ===== */}
      {ptab === 'time' && (
        <>
          {myTeam && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="card-head">
                <div className="title">FIFA</div>
                <div className="sub">{nick}</div>
              </div>
              <div className="card-body">
                <div className="perfil-team-hero">
                  <ClubCrest nick={nick} teamPlayers={teamPlayers} size={72} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: 'Anton, Impact', fontSize: 28, lineHeight: 1 }}>{nick}</div>
                    {myResult && (
                      <div className="perfil-team-result" style={{ color: myResult.color }}>
                        <Icon name={myResult.icon} size={15} /> {myPos}º de {totalTeams} · {myResult.label}
                      </div>
                    )}
                    <div className="perfil-team-status">{fifaClosed ? <><Icon name="check" size={11} /> FIFA SEASON 1 · ENCERRADO</> : <>FIFA SEASON 1 · EM ANDAMENTO</>}</div>
                    {stand && (
                      <div style={{ marginTop: 6, fontSize: 12, letterSpacing: '0.14em', fontWeight: 700, color: 'rgba(28,22,18,0.7)' }}>
                        {stand.p} PTS · {stand.v}V {stand.e}E {stand.d}D · SG {(stand.gp - stand.gc) >= 0 ? '+' : ''}{stand.gp - stand.gc}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mkt-label" style={{ marginTop: 14 }}>JOGOS DISPUTADOS ({played.length})</div>
                {played.length === 0 && <div style={{ fontSize: 12, color: 'rgba(28,22,18,0.5)', padding: '6px 2px' }}>Nenhum jogo ainda.</div>}
                {played.map(g => <MatchRow key={`p-${g.ri}-${g.gi}`} g={g} myTeamId={myTeamId} teamPlayers={teamPlayers} />)}

                <div className="mkt-label" style={{ marginTop: 16 }}>PRÓXIMOS JOGOS ({upcoming.length})</div>
                {upcoming.length === 0 && <div style={{ fontSize: 12, color: 'rgba(28,22,18,0.5)', padding: '6px 2px' }}>Nenhum jogo agendado.</div>}
                {upcoming.map(g => <MatchRow key={`u-${g.ri}-${g.gi}`} g={g} myTeamId={myTeamId} teamPlayers={teamPlayers} />)}
              </div>
            </div>
          )}

          {mkInscrito && (
            <div className="card">
              <div className="card-head">
                <div className="title"><Icon name="fist" size={15} /> MORTAL KOMBAT</div>
                <div className="sub">SEASON 1 · {mkAllConcluded ? 'ENCERRADO' : 'AO VIVO'}</div>
              </div>
              <div className="card-body">
                <div className="perfil-team-hero">
                  <div className="perfil-mk-badge"><Icon name="fist" size={34} /></div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: 'Anton, Impact', fontSize: 24, lineHeight: 1 }}>{nick}</div>
                    <div className="perfil-team-result" style={{ color: mkResult ? mkResult.color : 'var(--pv-orange)' }}>
                      <Icon name={mkResult ? mkResult.icon : 'fist'} size={15} /> {myMkPos ? `${myMkPos}º de ${mkStand.length}` : '—'}{mkResult ? ` · ${mkResult.label}` : ''}
                    </div>
                    <div className="perfil-team-status">{mkAllConcluded ? <><Icon name="check" size={11} /> MK SEASON 1 · ENCERRADO</> : <>MK SEASON 1 · AO VIVO</>}</div>
                    {myMkRec && (
                      <div style={{ marginTop: 6, fontSize: 12, letterSpacing: '0.14em', fontWeight: 700, color: 'rgba(28,22,18,0.7)' }}>
                        {myMkRec.p} PTS · {myMkRec.v}V {myMkRec.e}E {myMkRec.d}D · ROUNDS {myMkRec.rp}–{myMkRec.rc}
                      </div>
                    )}
                  </div>
                </div>

                {myMkChars.length > 0 && (
                  <>
                    <div className="mkt-label" style={{ marginTop: 14 }}>MEU ELENCO</div>
                    <div className="perfil-mk-roster">
                      {myMkChars.map(c => (
                        <span key={c} className="perfil-mk-char"><MkCharIcon name={c} sm /> {c}</span>
                      ))}
                    </div>
                  </>
                )}

                <div className="mkt-label" style={{ marginTop: 16 }}>HISTÓRICO DAS PARTIDAS</div>
                <MkMatchHistory nick={nick} draw={mkDraw} scores={mkScores} lineups={mkLineups} />

                <div className="mkt-label" style={{ marginTop: 16 }}>MEUS CONFRONTOS ({myMkGames.length})</div>
                {myMkGames.length === 0 && <div style={{ fontSize: 12, color: 'rgba(28,22,18,0.5)', padding: '6px 2px' }}>Aguardando o sorteio.</div>}
                {myMkGames.map((m, i) => {
                  const o = mkMatchOutcome(m.sc);
                  let scoreLabel = 'a jogar', res = null;
                  if (o) {
                    const myConf = m.mandante ? o.confH : o.confA, oppConf = m.mandante ? o.confA : o.confH;
                    scoreLabel = myConf + '×' + oppConf;
                    res = myConf > oppConf ? 'V' : myConf < oppConf ? 'D' : 'E';
                  }
                  const resColor = res === 'V' ? '#2a8f3f' : res === 'D' ? '#c33' : 'rgba(28,22,18,0.5)';
                  return (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '40px 1fr auto auto', gap: 10, alignItems: 'center', padding: '8px 4px', borderBottom: '1px solid rgba(28,22,18,0.08)' }}>
                      <div style={{ fontSize: 10, letterSpacing: '0.16em', fontWeight: 800, color: 'rgba(28,22,18,0.55)' }}>R{String(m.round).padStart(2, '0')}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <span style={{ fontSize: 8.5, fontWeight: 800, color: 'var(--pv-orange)', letterSpacing: '0.04em' }}>{m.mandante ? 'MANDANTE' : 'VISITANTE'}</span>
                        <span style={{ color: 'rgba(28,22,18,0.4)' }}>vs</span>
                        <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.opp}</span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: o ? 'var(--pv-orange)' : 'rgba(28,22,18,0.4)' }}>{scoreLabel}</div>
                      <div style={{ width: 22, textAlign: 'center', fontWeight: 800, color: resColor }}>{res || '·'}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ===== CONQUISTAS ===== */}
      {ptab === 'titulos' && (
        <TitulosCard
          nick={nick}
          ctx={ctx}
          selectedTitle={me?.title || null}
          onSelectTitle={onSelectTitle}
          onSeeRanking={onSeeRanking}
        />
      )}

      {/* ===== COLEÇÃO ===== */}
      {ptab === 'colecao' && !isAdmin && (
        <ColecaoCard
          nick={nick}
          me={me}
          previewTeamId={myTeamId}
          ctx={ctx}
          onEquip={onEquip}
        />
      )}

      {/* ===== APARÊNCIA (tema) ===== */}
      {ptab === 'aparencia' && (
        <AparenciaCard theme={theme} onSetTheme={onSetTheme}
          nick={nick} teamPlayers={teamPlayers} cosmetics={me?.cosmetics}
          currentAvatar={currentAvatar} onUploadAvatar={onUploadAvatar} onRemoveAvatar={onRemoveAvatar} />
      )}
      </div>{/* /.perfil-main */}
    </div>
  );
}

// Linha do HISTÓRICO de partidas (FIFA), na perspectiva do jogador: avatar +
// @nick do adversário + placar (meu × dele) + resultado V/E/D colorido.
// Pendentes mostram a data. teamPlayers resolve teamId -> @nick (mostra o USER,
// não o time).
function MatchRow({ g, myTeamId, teamPlayers }) {
  const iAmHome = g.home === myTeamId;
  const oppTid = iAmHome ? g.away : g.home;
  const oppNick = (teamPlayers || {})[oppTid] || oppTid;
  const played = isGamePlayed(g);
  const ghN = parseInt(g.gh, 10), gaN = parseInt(g.ga, 10);
  const myG = iAmHome ? ghN : gaN;
  const oppG = iAmHome ? gaN : ghN;
  const outcome = !played ? null : (myG > oppG ? 'V' : myG < oppG ? 'D' : 'E');
  const cls = outcome === 'V' ? 'win' : outcome === 'D' ? 'loss' : outcome === 'E' ? 'draw' : 'pending';
  const resLabel = outcome === 'V' ? 'Vitória' : outcome === 'D' ? 'Derrota' : outcome === 'E' ? 'Empate' : 'A jogar';
  return (
    <div className={'mh-row ' + cls}>
      <span className="mh-round">R{String(g.round).padStart(2, '0')}</span>
      <span className="mh-res" title={resLabel}>{outcome || '·'}</span>
      <ClubCrest nick={oppNick} teamPlayers={teamPlayers} size={20} />
      <span className="mh-opp">{oppNick}</span>
      {played
        ? <span className="mh-score">{myG}<i>×</i>{oppG}</span>
        : <span className="mh-date">{g.day} {g.date}</span>}
    </div>
  );
}

// Caixinha expansiva reutilizável (histórico por campeonato / fase). Header
// clicável com título + contagem + caret; corpo aparece só quando aberta.
function CollapseBox({ title, count, icon, defaultOpen, children }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className={'histbox' + (open ? ' open' : '')}>
      <button type="button" className="histbox-h" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="histbox-t">{icon && <Icon name={icon} size={13} />} {title}{count != null && <span className="histbox-c">{count}</span>}</span>
        <Icon name={open ? 'caret-up' : 'caret-down'} size={14} />
      </button>
      {open && <div className="histbox-b">{children}</div>}
    </div>
  );
}

// HISTÓRICO de confrontos do MK pro nick: cada confronto concluído com vs @opp,
// placar das 2 partidas (ex: 2×1, 2×0) e os personagens escalados em cada uma.
// Agrupado por FASE (IDA/VOLTA), cada fase numa caixinha expansiva.
function MkMatchHistory({ nick, draw, scores, lineups }) {
  if (!draw || !nick) return null;
  const gk = (r, gi) => r.phase + '-' + r.n + '-' + gi;
  const rows = [];
  draw.forEach(r => (r.games || []).forEach((g, gi) => {
    if (g.home !== nick && g.away !== nick) return;
    if (mkGameVoid(g)) return;
    const o = mkMatchOutcome((scores || {})[gk(r, gi)]);
    if (!o) return; // só concluídos
    const meHome = g.home === nick;
    const oppNick = meHome ? g.away : g.home;
    const myWon = (meHome && o.winner === 'H') || (!meHome && o.winner === 'A');
    const res = o.winner === 'D' ? 'E' : (myWon ? 'V' : 'D');
    const ln = (lineups || {})[gk(r, gi)] || {};
    const ch = (part, side) => (ln[part] && ln[part][side]) || null;
    rows.push({
      key: gk(r, gi), phase: r.phase, n: r.n, oppNick, res,
      p1my: meHome ? o.p1h : o.p1a, p1op: meHome ? o.p1a : o.p1h,
      p2my: meHome ? o.p2h : o.p2a, p2op: meHome ? o.p2a : o.p2h,
      c1my: ch('p1', meHome ? 'home' : 'away'), c1op: ch('p1', meHome ? 'away' : 'home'),
      c2my: ch('p2', meHome ? 'home' : 'away'), c2op: ch('p2', meHome ? 'away' : 'home'),
    });
  }));
  if (!rows.length) return <div className="mkh-empty">Nenhum confronto concluído ainda.</div>;
  const resLabel = (r) => r === 'V' ? 'Vitória' : r === 'D' ? 'Derrota' : 'Empate';
  // agrupa por FASE (IDA/VOLTA) na ordem em que aparecem no chaveamento; cada
  // fase é uma caixinha expansiva. A última fase com jogos abre por padrão.
  const phaseOrder = [];
  rows.forEach(m => { if (!phaseOrder.includes(m.phase)) phaseOrder.push(m.phase); });
  const groups = phaseOrder.map(ph => ({ ph, items: rows.filter(m => m.phase === ph) }));
  const renderRow = (m) => (
    <div key={m.key} className={'mkh-row ' + (m.res === 'V' ? 'win' : m.res === 'D' ? 'loss' : 'draw')}>
      <div className="mkh-head">
        <span className="mkh-res" title={resLabel(m.res)}>{m.res}</span>
        <span className="mkh-opp">vs {m.oppNick}</span>
        <span className="mkh-phase">{m.phase} {m.n}</span>
      </div>
      <div className="mkh-partidas">
        <div className="mkh-part">
          <span className="mkh-pl">P1</span>
          <span className="mkh-sc">{m.p1my}<i>×</i>{m.p1op}</span>
          {(m.c1my || m.c1op) && <span className="mkh-ch">{m.c1my || '?'} <i>vs</i> {m.c1op || '?'}</span>}
        </div>
        <div className="mkh-part">
          <span className="mkh-pl">P2</span>
          <span className="mkh-sc">{m.p2my}<i>×</i>{m.p2op}</span>
          {(m.c2my || m.c2op) && <span className="mkh-ch">{m.c2my || '?'} <i>vs</i> {m.c2op || '?'}</span>}
        </div>
      </div>
    </div>
  );
  return (
    <div className="mkh-groups">
      {groups.map((g, gi) => (
        <CollapseBox key={g.ph || gi} title={g.ph || 'JOGOS'} count={g.items.length} defaultOpen={gi === groups.length - 1}>
          <div className="mkh-list">{g.items.map(renderRow)}</div>
        </CollapseBox>
      ))}
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

// Ranking de CAÇADORES DE CONQUISTAS: ordena todos os jogadores por pontos de
// conquista (desempate: nº de conquistas -> nome). Exclui o admin (sem time/jogo).
// Retorna [{ nick, score, count }].
function computeHunterRanking(ctx) {
  const users = (ctx && ctx.users) || {};
  return Object.keys(users)
    .filter(n => n !== ADMIN_NICK)
    .map(nick => {
      const earned = titlesForNick(nick, ctx || {});
      const score = earned.reduce((s, a) => s + achPoints(a), 0);
      return { nick, score, count: earned.length };
    })
    .sort((a, b) => b.score - a.score || b.count - a.count || a.nick.localeCompare(b.nick));
}

// ─── LOJA (items cosméticos) ────────────────────────────────────────────────
function LojaView({ nick, me, ctx, onBuy, onEquip }) {
  const [busy, setBusy] = useState({}); // { itemId: 'buy' | 'equip' }
  // PROVADOR: { slot, id } — mostra o item aplicado no avatar grande lá em
  // cima ANTES de comprar/equipar (funciona até pra item bloqueado).
  const [prova, setProva] = useState(null);
  const inv = useMemo(() => effectiveInventory(nick, me, ctx), [nick, me, ctx]);
  const equipped = me?.cosmetics || {};
  const cc = ccBalanceFor(nick, me, ctx);
  const provaCosm = prova ? { ...equipped, [prova.slot]: prova.id } : equipped;
  const provaItem = prova ? ITEM_BY_ID[prova.id] : null;
  const toggleProva = (slotId, itemId) => {
    setProva(p => (p && p.id === itemId) ? null : { slot: slotId, id: itemId });
    // garante que o provador (lá no topo) fica visível ao tocar PROVAR
    const el = document.querySelector('.loja-prova-strip');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

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
            <strong> CC é raro: você ganha os PONTOS das suas conquistas (quanto mais rara, mais CC) e
            participando de campeonatos (+{CC_PER_PARTICIPATION} cada).</strong> Compra molduras
            com CC e equipa distintivos desbloqueados por conquista. Items equipados aparecem no
            seu avatar em todo o site (TopBar, Ranking, Perfil, Vitrine).
          </p>
          {/* PROVADOR: avatar grande com o item "provado" por cima do equipado */}
          <div className="loja-prova-strip">
            <Avatar nick={nick} teamPlayers={ctx?.teamPlayers} cosmetics={provaCosm} size={84} />
            <div className="loja-prova-txt">
              {provaItem ? (
                <>
                  <div className="loja-prova-name" style={{ color: provaItem.color }}>
                    PROVANDO: {provaItem.name}
                  </div>
                  <div className="loja-prova-price">
                    {inv.includes(provaItem.id)
                      ? 'JÁ É SEU'
                      : (provaItem.drop ? 'DESBLOQUEIA POR CONQUISTA' : provaItem.price + ' CC' + (cc >= (provaItem.price || 0) ? '' : ' — FALTA ' + ((provaItem.price || 0) - cc)))}
                  </div>
                  <button type="button" className="loja-prova-clear" onClick={() => setProva(null)}>
                    <Icon name="x" size={11} /> TIRAR
                  </button>
                </>
              ) : (
                <div className="loja-prova-hint">
                  Seu avatar como está hoje. Toca no <Icon name="eye" size={12} /> de qualquer
                  item pra provar antes de comprar ou equipar.
                </div>
              )}
            </div>
          </div>
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
                  const emProva = prova && prova.id === item.id;
                  return (
                    <div key={item.id} className={'loja-item rarity-' + item.rarity + (owned ? ' owned' : ' locked') + (emProva ? ' em-prova' : '')}>
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
                        <button
                          type="button"
                          className={'loja-prova-btn' + (emProva ? ' on' : '')}
                          onClick={() => toggleProva(slot.id, item.id)}
                          title={emProva ? 'Tirar do provador' : 'Provar no avatar'}
                          aria-label={(emProva ? 'Tirar do provador: ' : 'Provar no avatar: ') + item.name}
                        >
                          <Icon name={emProva ? 'eye-off' : 'eye'} size={14} />
                        </button>
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

function TitulosCard({ nick, ctx, selectedTitle, onSelectTitle, onSeeRanking }) {
  const earnedIds = useMemo(() => new Set(titlesForNick(nick, ctx || {}).map(t => t.id)), [nick, ctx]);
  const owners = useMemo(() => computeTitleOwners(ctx || {}), [ctx]);
  const ranking = useMemo(() => computeHunterRanking(ctx || {}), [ctx]);
  const earned = TITLE_DEFS.filter(t => earnedIds.has(t.id));
  const locked = TITLE_DEFS.filter(t => !earnedIds.has(t.id));
  const [showLocked, setShowLocked] = useState(true); // árvore completa por padrão

  const score = earned.reduce((s, t) => s + achPoints(t), 0);
  const maxScore = TITLE_DEFS.reduce((s, t) => s + achPoints(t), 0);
  const myRankIdx = ranking.findIndex(r => r.nick === nick);
  const myRank = myRankIdx >= 0 ? myRankIdx + 1 : null;

  const handleClick = (id, isLocked) => {
    if (isLocked || !onSelectTitle) return;
    onSelectTitle(selectedTitle === id ? null : id);
  };

  // Card de conquista: ícone + nome + raridade/pontos + REQUISITO (sempre
  // visível) + estado (bloqueada / exibir no nome). O requisito é a própria
  // descrição — o ponto principal: dá pra ver o que falta SEM hover.
  const renderCard = (t) => {
    const isLocked = !earnedIds.has(t.id);
    const isEquipped = !isLocked && selectedTitle === t.id;
    const own = owners[t.id] || [];
    return (
      <div key={t.id}
        className={'achv-card rarity-' + t.rarity + (isLocked ? ' locked' : ' unlocked') + (isEquipped ? ' equipped' : '')}
        style={!isLocked ? { '--tc': t.color } : undefined}>
        <div className="achv-ic">{isLocked ? <Icon name="lock" size={22} /> : <Icon name={t.icon} size={26} />}</div>
        <div className="achv-body">
          <div className="achv-top">
            <span className="achv-name">{t.name}</span>
            <span className="achv-pts">{achPoints(t)} PTS</span>
          </div>
          <div className="achv-rarity">{RARITY_LABEL[t.rarity]}{isLocked ? ' · BLOQUEADA' : ' · CONQUISTADA'}</div>
          <div className="achv-desc">{t.desc}</div>
          <div className="achv-foot">
            {isLocked ? (
              <span className="achv-owners">{own.length ? (own.length + (own.length === 1 ? ' já tem' : ' já têm')) : 'ninguém tem ainda'}</span>
            ) : (
              <button type="button" className={'achv-equip' + (isEquipped ? ' on' : '')}
                onClick={() => handleClick(t.id, false)} aria-pressed={isEquipped}>
                {isEquipped ? <><Icon name="check" size={12} /> EXIBINDO NO NOME</> : 'EXIBIR NO NOME'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Uma seção por categoria, conquistas ordenadas pela trilha de progressão.
  const lanes = ACH_CATS.map(cat => {
    const items = TITLE_DEFS.filter(t => t.cat === cat.id).sort(achLaneSort);
    const got = items.filter(t => earnedIds.has(t.id)).length;
    return { cat, items, got, total: items.length };
  }).filter(l => l.total > 0);

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head">
        <div className="title"><Icon name="trophy" size={16} /> CONQUISTAS</div>
        <div className="sub">{earned.length}/{TITLE_DEFS.length} · {score} PTS</div>
      </div>
      <div className="card-body">
        {/* Faixa de score do caçador */}
        <div className="cacador-banner">
          <div className="cacador-banner-main">
            <span className="cacador-banner-score">{score}</span>
            <span className="cacador-banner-lbl">PONTOS DE CAÇADOR</span>
          </div>
          <div className="cacador-banner-rankcol">
            <div className="cacador-banner-rank">
              {myRank ? <><Icon name="crosshair" size={13} /> {myRank}º de {ranking.length} caçadores</> : 'sem ranking ainda'}
            </div>
            {onSeeRanking && (
              <button type="button" className="cacador-banner-see" onClick={onSeeRanking}>
                VER RANKING <Icon name="arrow-right" size={11} />
              </button>
            )}
          </div>
        </div>
        <p style={{ marginTop: 10, marginBottom: 12, fontSize: 11, color: 'rgba(28,22,18,0.6)', lineHeight: 1.4 }}>
          Cada conquista mostra o que você precisa fazer pra desbloquear. Nas que você já tem,
          toca em <strong>EXIBIR NO NOME</strong> pra mostrar do lado do seu nick (quanto mais rara, mais pontos e CC).
        </p>

        <div className="achv-list">
          {lanes.map(({ cat, items, got, total }) => {
            const visible = items.filter(t => showLocked || earnedIds.has(t.id));
            if (visible.length === 0) return null;
            return (
              <section key={cat.id} className="achv-cat">
                <div className="achv-cat-head">
                  <span className="achv-cat-label">{cat.label}</span>
                  <span className="achv-cat-bar" style={{ '--pct': (total ? (got / total) * 100 : 0) + '%' }} />
                  <span className="achv-cat-count">{got}/{total}</span>
                </div>
                <div className="achv-grid">{visible.map(renderCard)}</div>
              </section>
            );
          })}
        </div>

        {locked.length > 0 && (
          <button className="titulos-toggle" onClick={() => setShowLocked(s => !s)}>
            <Icon name={showLocked ? 'eye-off' : 'eye'} size={12} />
            {showLocked ? 'ESCONDER BLOQUEADAS' : 'MOSTRAR BLOQUEADAS'} ({locked.length})
          </button>
        )}
      </div>
    </div>
  );
}

// APARÊNCIA — personalização da cor de destaque do site (por jogador).
// Presets + cor livre (color picker) + voltar ao padrão. Aplica na hora via
// onSetTheme (que mexe nas CSS vars + persiste). Prévia ao vivo no próprio card.
function AparenciaCard({ theme, onSetTheme, nick, teamPlayers, cosmetics, currentAvatar, onUploadAvatar, onRemoveAvatar }) {
  // Tema atual (id) — otimista: reflete a escolha na hora; tolera valor legado
  // (hex) e cai pro localStorage/padrão quando não há id no registro.
  const resolveTheme = () => {
    if (theme && pvThemeById(theme)) return theme;
    const ls = loadThemeLS();
    if (ls && pvThemeById(ls)) return ls;
    return DEFAULT_THEME;
  };
  const [themeId, setThemeId] = useState(resolveTheme);
  useEffect(() => { setThemeId(resolveTheme()); }, [theme]);
  const pickTheme = (id) => { setThemeId(id); onSetTheme(id); };

  // Upload de foto
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);
  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!/^image\//.test(f.type || '')) { setErr('Manda uma imagem (jpg, png...).'); return; }
    setErr(''); setBusy(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const r = await onUploadAvatar(String(reader.result));
      setBusy(false);
      if (r && r.err) {
        if (r.err === 'rules') setErr('Fotos ainda não liberadas no servidor — o admin precisa publicar as regras do Firestore (firestore.rules). Temas e conquistas funcionam normal.');
        else if (r.err === 'imagem grande demais') setErr('Imagem pesada demais mesmo comprimindo — tenta uma menor/mais simples.');
        else setErr('Falha: ' + r.err);
      }
    };
    reader.onerror = () => { setBusy(false); setErr('Não consegui ler o arquivo.'); };
    reader.readAsDataURL(f);
  };
  const onRemove = async () => { setBusy(true); setErr(''); await onRemoveAvatar(); setBusy(false); };

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head">
        <div className="title"><Icon name="sparkle" size={16} /> APARÊNCIA</div>
        <div className="sub">SUA FOTO + TEMA</div>
      </div>
      <div className="card-body">
        {/* ── FOTO (avatar custom) ── */}
        <div className="small-label" style={{ marginTop: 0, marginBottom: 8 }}>SUA FOTO</div>
        <div className="aparencia-avatar">
          <Avatar nick={nick} teamPlayers={teamPlayers} cosmetics={cosmetics} size={88} />
          <div className="aparencia-avatar-side">
            <p className="aparencia-avatar-hint">
              Sua foto aparece no lugar do escudo do time em todo o site (topo, ranking, perfil).
              É cortada num quadrado e comprimida automaticamente.
            </p>
            <div className="aparencia-avatar-btns">
              <button type="button" className="aparencia-up-btn" disabled={busy} onClick={() => fileRef.current && fileRef.current.click()}>
                <Icon name="user" size={13} /> {busy ? 'ENVIANDO…' : (currentAvatar ? 'TROCAR FOTO' : 'ENVIAR FOTO')}
              </button>
              {currentAvatar && (
                <button type="button" className="aparencia-rm-btn" disabled={busy} onClick={onRemove}>
                  <Icon name="trash" size={12} /> REMOVER
                </button>
              )}
            </div>
            {err && <div className="aparencia-err">{err}</div>}
            <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />
          </div>
        </div>

        {/* ── TEMA do site ── */}
        <div className="small-label" style={{ marginTop: 18, marginBottom: 8 }}>TEMA DO SITE</div>
        <div className="aparencia-themes">
          {PV_THEMES.map(t => {
            const sel = t.id === themeId;
            return (
              <button key={t.id} type="button" className={'aparencia-theme' + (sel ? ' sel' : '')} onClick={() => pickTheme(t.id)} aria-pressed={sel} title={t.name}>
                <span className="aparencia-theme-pv" style={{ background: t.bg }}>
                  <span className="aparencia-theme-dot" style={{ background: t.accent }} />
                  {sel && <span className="aparencia-theme-check"><Icon name="check" size={13} /></span>}
                </span>
                <span className="aparencia-theme-name">{t.name}</span>
                {t.dark && <span className="aparencia-theme-tag">ESCURO</span>}
              </button>
            );
          })}
        </div>
        <p style={{ marginTop: 10, fontSize: 11, color: 'rgba(28,22,18,0.55)', lineHeight: 1.4 }}>
          O tema vale só pra você e segue em todos os seus dispositivos. Os escuros deixam a "mesa"
          preta; os cards continuam de papel.
        </p>
      </div>
    </div>
  );
}

// Um card por TIPO de troféu (campeão/vice/...), com a lista de edições embaixo.
// Um card por TIPO de troféu, estilo FIGURINHA-MEDALHA de jornal: disco metálico
// + faixa de raridade + textura de papel + plaquinha gravada. Vexame (penúltimo/
// último) = selo tombado/rachado com carimbo "VEXAME". Cards sempre claros ->
// texto sempre escuro (--tf-ink). Sem emoji, só <Icon/>. (redesign via ultracode)
function TrophyGroup({ kind, editions }) {
  const meta = {
    champion:   { icon: 'tr-champion',   label: 'CAMPEÃO',    rarity: 'OURO',     ink: '#5a3e00', metal: '#e9c64a', deep: '#9c7a16', frame: '#caa01f', bg: '#fbf3d3' },
    vice:       { icon: 'tr-vice',       label: 'VICE',       rarity: 'PRATA',    ink: '#3a4049', metal: '#cfd6dd', deep: '#5f6770', frame: '#9aa3ad', bg: '#eef0f2' },
    terceiro:   { icon: 'tr-terceiro',   label: 'TERCEIRO',   rarity: 'BRONZE',   ink: '#5e3411', metal: '#e0a468', deep: '#8a5320', frame: '#bd7d3c', bg: '#f7e9da' },
    participou: { icon: 'tr-participou', label: 'PARTICIPOU', rarity: 'PRESENÇA', ink: '#5a3410', metal: '#e6a463', deep: '#a85f1c', frame: '#d76414', bg: '#f6ece0' },
    penultimo:  { icon: 'tr-penultimo',  label: 'PENÚLTIMO',  rarity: 'VEXAME',   ink: '#3f2812', metal: '#cbb8a6', deep: '#6b4423', frame: '#9d8267', bg: '#f0e7df' },
    lanterna:   { icon: 'tr-lanterna',   label: 'ÚLTIMO',     rarity: 'VEXAME',   ink: '#5c1717', metal: '#d8a0a0', deep: '#7a2222', frame: '#b56b6b', bg: '#fce4e4' },
    betking:    { icon: 'tr-betking',    label: 'REI DAS APOSTAS', rarity: 'APOSTAS', ink: '#6b4e0a', metal: '#f4d65a', deep: '#a6810f', frame: '#d4af37', bg: '#fbf1cf' },
  }[kind] || { icon: null, label: '', rarity: '', ink: '#1c1612', metal: '#ddd', deep: '#999', frame: '#bbb', bg: '#eee' };
  const shame = kind === 'lanterna' || kind === 'penultimo';
  const champ = kind === 'champion' || kind === 'betking';
  const multi = editions.length > 1;
  const cls = 'tf tf-' + kind + (shame ? ' tf-shame' : '') + (champ ? ' tf-champ' : '');
  return (
    <div className={cls} style={{ '--tf-metal': meta.metal, '--tf-deep': meta.deep, '--tf-frame': meta.frame, '--tf-bg': meta.bg, '--tf-ink': meta.ink }}>
      <span className="tf-ribbon" aria-hidden="true"><span>{meta.rarity}</span></span>
      <div className="tf-stage">
        {multi && <span className="tf-count">{editions.length}x</span>}
        <span className="tf-disc">
          <span className="tf-disc-face">{meta.icon && <Icon name={meta.icon} size={38} />}</span>
          {shame && <span className="tf-crack" aria-hidden="true" />}
        </span>
        {shame && <span className="tf-overprint">VEXAME</span>}
        <span className="tf-floor" aria-hidden="true" />
      </div>
      <div className="tf-plate">
        <div className="tf-label">{meta.label}</div>
        <div className="tf-eds">
          {editions.map((e, i) => (
            <div key={i} className="tf-ed">
              <span className="tf-ed-tag">{e.tag}</span>
              <span className="tf-ed-dot" />
              <span className="tf-ed-season">{e.season}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div style={{ padding: 10, background: 'rgba(0,0,0,0.03)' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.22em', fontWeight: 800, color: 'rgba(28,22,18,0.55)' }}>{label}</div>
      <div style={{
        marginTop: 4, fontFamily: 'Anton, Impact', fontSize: 22,
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
// Formata um valor de PC de forma compacta pro ranking: 1.53M, 391K, 10K...
// Sempre devolve o módulo (sem sinal) — o +/- fica por conta de quem renderiza.
// Quem quiser o número exato confere no tooltip (title) da linha.
function compactPC(n) {
  let v = Math.abs(Number(n) || 0);
  if (v < 1000) return String(Math.round(v));
  const units = ['K', 'M', 'B', 'T'];
  let i = -1;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  let dec = v < 10 ? 2 : v < 100 ? 1 : 0; // 1.53M / 39.7K / 391K
  // evita "1000K": se arredondar estourar a unidade, sobe pra próxima
  if (Number(v.toFixed(dec)) >= 1000 && i < units.length - 1) { v /= 1000; i++; dec = 2; }
  let s = v.toFixed(dec);
  if (s.indexOf('.') >= 0) s = s.replace(/\.?0+$/, ''); // tira zeros à toa só na fração
  return s + units[i];
}

function RankingView({ users, bets, me, teamPlayers, cs, lockChamp, compact, onOpenBetProfile }) {
  const withBets = new Set((bets || []).map(b => b.champId || 'fifa'));
  const champList = CHAMPIONSHIPS
    .filter(c => c.status === 'active' || withBets.has(c.id))
    .sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1));
  const [sel, setSel] = useState(champList[0] ? champList[0].id : 'fifa');
  // Embutido nas APOSTAS: trava num campeonato (lockChamp) e esconde o seletor.
  const effSel = lockChamp || sel;
  const champ = CHAMP_BY_ID[effSel] || CHAMPIONSHIPS[0];
  const encerrada = computeChampStandings(effSel, cs).status === 'closed';
  const ranking = seasonBettingRanking(effSel, bets);

  return (
    <div className="card">
      <div className="card-head">
        <div className="title"><Icon name="tr-betking" size={16} /> RANKING DE APOSTAS</div>
        <div className="sub">{champ.tag} · {champ.season} · {encerrada ? 'ENCERRADA' : 'AO VIVO'}</div>
      </div>
      <div className="card-body">
        {!lockChamp && champList.length > 1 && (
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
          <div className={'rank-list' + (compact ? ' rank-list--mini' : '')}>
            {ranking.map((r, i) => {
              const u = users[r.nick] || {};
              const rei = i === 0 && (r.lucro > 0 || r.vit > 0);
              return (
                <div key={r.nick} role={onOpenBetProfile ? 'button' : undefined} tabIndex={onOpenBetProfile ? 0 : undefined}
                  onClick={onOpenBetProfile ? () => onOpenBetProfile(r.nick) : undefined}
                  title={onOpenBetProfile ? 'Ver perfil de apostas de ' + r.nick : undefined}
                  className={'lb-row rank-row' + (r.nick === me ? ' me' : '') + (rei ? ' rei' : '') + (onOpenBetProfile ? ' rank-row--click' : '')} style={{ gridTemplateColumns: '34px 42px 1fr auto', gap: 10 }}>
                  <div className="lb-pos">{rei ? <Icon name="tr-betking" size={20} /> : i + 1}</div>
                  <Avatar nick={r.nick} teamPlayers={teamPlayers} cosmetics={u.cosmetics || {}} size={compact ? 36 : 42} />
                  <div style={{ minWidth: 0 }}>
                    <div className="lb-nick">{r.nick}{r.nick === me && <span className="lb-you">VOCÊ</span>}{u.title && <TitleBadge titleId={u.title} />}{rei && <span className="rank-rei-tag">REI</span>}</div>
                    <div className="rank-row-stats">{r.apostas} apostas · <span style={{ color: 'var(--pv-green)' }}>{r.vit}V</span> · <span style={{ color: 'var(--pv-red)' }}>{r.der}D</span>{r.pend ? ' · ' + r.pend + ' aberta' + (r.pend > 1 ? 's' : '') : ''}</div>
                  </div>
                  <div className="rank-lucro" title={(r.lucro > 0 ? '+' : '') + r.lucro.toLocaleString('pt-BR') + ' PC'} style={{ color: r.lucro > 0 ? 'var(--pv-green)' : r.lucro < 0 ? 'var(--pv-red)' : 'rgba(28,22,18,0.45)' }}>
                    {r.lucro > 0 ? '+' : r.lucro < 0 ? '-' : ''}{compactPC(r.lucro)}<small>PC</small>
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
  const koById = {};
  (wcFixtures || []).forEach(f => { koById[f.id] = !!f.isKnockout; });
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
        pts += scoreWcPick(r, up[fid], koById[fid]); // total (com bônus pênaltis)
        const base = scoreWcPick(r, up[fid]); // só placar normal (tally)
        if (base === 3) exatos++; else if (base === 1) certos++; else errados++;
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
    pos, label, name: r.nick, nick: null,
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
        {item.nick && <div className="showcase-nick">{item.nick}</div>}
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
            <div className="showcase-side-head"><Icon name={sideIcon || 'coin'} size={13} /> {sideTitle || 'OS GRANDES CAÇADORES'}</div>
            <div className="showcase-side-list">
              {sideRanking.map((r, i) => (
                <div key={r.nick} className={'showcase-side-row' + (r.nick === myNick ? ' me' : '')}>
                  <span className="showcase-side-pos">{i + 1}</span>
                  <Avatar nick={r.nick} teamPlayers={r._tp} cosmetics={r.cosmetics} size={26} noBadge />
                  <span className="showcase-side-nick">{r.nick}</span>
                  <span className="showcase-side-pc">{r.signed && r.pc >= 0 ? '+' : ''}{r.pc.toLocaleString('pt-BR')}<small>PC</small></span>
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

// Ranking de apostadores por LUCRO nas apostas (retorno das ganhas − o valor
// apostado nas resolvidas), de todos os tempos. NÃO usa o saldo PC, que muda
// com reset/bônus e não reflete quem aposta bem. order: 'top' (maiores) ou
// 'bottom' (piores). pc carrega o lucro (com sinal) só pro display reaproveitar.
function bettorProfitRanking(bets, users, teamPlayers, order) {
  const profit = {};
  (bets || []).forEach(b => {
    if (b.user === ADMIN_NICK) return;
    if (b.status === 'won') profit[b.user] = (profit[b.user] || 0) + (b.payout || 0) - (b.amount || 0);
    else if (b.status === 'lost') profit[b.user] = (profit[b.user] || 0) - (b.amount || 0);
  });
  return Object.entries(profit)
    .map(([nick, lucro]) => ({ nick, pc: lucro, signed: true, cosmetics: ((users || {})[nick] || {}).cosmetics || null, _tp: teamPlayers }))
    .sort((a, b) => order === 'bottom' ? a.pc - b.pc : b.pc - a.pc)
    .slice(0, 8);
}

function HallDaFamaView({ cs, users, teamPlayers, worldcup, wcFixtures, myNick, bets }) {
  const copa = computeCopaStandings(worldcup, wcFixtures);
  // Os maiores caçadores: ranking por LUCRO nas apostas (não por saldo PC).
  const apostadores = bettorProfitRanking(bets, users, teamPlayers, 'top');
  return (
    <div>
      {CHAMPIONSHIPS.map(c => {
        const { status, standings } = computeChampStandings(c.id, cs);
        const items = status !== 'soon' ? buildShowcase('fame', standings, users, teamPlayers) : [];
        return <TrophyShowcase key={c.id} champ={c} items={items} theme="fame" status={status}
          sideRanking={c.id === 'fifa' ? apostadores : null} sideTitle="OS GRANDES CAÇADORES" sideIcon="coin-stack" myNick={myNick} />;
      })}
      <TrophyShowcase
        champ={COPA_CHAMP}
        items={copa.status !== 'soon' ? buildCopaShowcase('fame', copa.ranking, users, teamPlayers) : []}
        theme="fame" status={copa.status}
      />
    </div>
  );
}

function HallDaVergonhaView({ cs, users, teamPlayers, worldcup, wcFixtures, myNick, bets }) {
  const copa = computeCopaStandings(worldcup, wcFixtures);
  // Os mais quebrados: ranking pelos MAIORES PREJUÍZOS nas apostas (lucro mais
  // negativo), não pelo saldo PC (que muda com reset/bônus).
  const quebrados = bettorProfitRanking(bets, users, teamPlayers, 'bottom');
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
function HallView({ cs, users, teamPlayers, worldcup, wcFixtures, myNick, bets, ctx, subTab: subTabProp, setSubTab: setSubTabProp }) {
  // subTab pode ser controlado pelo App (pro link "VER RANKING" cair no CAÇADORES)
  // ou local (fallback) quando os props não vierem.
  const [subTabLocal, setSubTabLocal] = useState('fama'); // 'fama' | 'vergonha' | 'cacadores'
  const subTab = subTabProp != null ? subTabProp : subTabLocal;
  const setSubTab = setSubTabProp || setSubTabLocal;
  const season = (CHAMPIONSHIPS.find(c => c.id === 'fifa') || {}).season || '';
  const hero = {
    fama:      { tag: `PRIMITIVÃO · MORADA DOS DEUSES · ${season}`, title: 'OLIMPO PRIMITIVÃO', sub: 'Os deuses de cada temporada. Imortalizados em ouro e prata no alto do Olimpo.' },
    vergonha:  { tag: `PRIMITIVÃO · ABISMO DOS CONDENADOS · ${season}`, title: 'TÁRTARO', sub: 'O abismo onde os condenados penam. Privada, escova e o fundo do poço pra eternidade.' },
    cacadores: { tag: `PRIMITIVÃO · CAÇADORES DE CONQUISTAS · ${season}`, title: 'CAÇADORES', sub: 'Quem mais desbloqueou conquistas. Cada raridade vale mais pontos — a caça é eterna.' },
  }[subTab];
  return (
    <div>
      <div className={'hall-hero ' + subTab}>
        <div className="hall-hero-ornament" aria-hidden="true">
          <Icon name="star" size={12} /><span /><Icon name="trophy" size={16} /><span /><Icon name="star" size={12} />
        </div>
        <div className="hall-hero-tag">{hero.tag}</div>
        <div className="hall-hero-title">{hero.title}</div>
        <div className="hall-hero-sub">{hero.sub}</div>
      </div>
      <div className="hall-subtabs">
        <button className={'hall-subtab fame ' + (subTab === 'fama' ? 'active' : '')} onClick={() => setSubTab('fama')}>
          <Icon name="trophy" size={14} /> OLIMPO
        </button>
        <button className={'hall-subtab shame ' + (subTab === 'vergonha' ? 'active' : '')} onClick={() => setSubTab('vergonha')}>
          <Icon name="toilet" size={14} /> TÁRTARO
        </button>
        <button className={'hall-subtab hunt ' + (subTab === 'cacadores' ? 'active' : '')} onClick={() => setSubTab('cacadores')}>
          <Icon name="crosshair" size={14} /> CAÇADORES
        </button>
      </div>
      {subTab === 'fama'      && <HallDaFamaView cs={cs} users={users} teamPlayers={teamPlayers} worldcup={worldcup} wcFixtures={wcFixtures} myNick={myNick} bets={bets} />}
      {subTab === 'vergonha'  && <HallDaVergonhaView cs={cs} users={users} teamPlayers={teamPlayers} worldcup={worldcup} wcFixtures={wcFixtures} myNick={myNick} bets={bets} />}
      {subTab === 'cacadores' && <CacadoresView ctx={ctx} teamPlayers={teamPlayers} myNick={myNick} />}
    </div>
  );
}

// Ranking de CAÇADORES DE CONQUISTAS — leaderboard por pontos de conquista.
// Pódio dos 3 primeiros + lista completa, com a sua linha destacada.
function CacadoresView({ ctx, teamPlayers, myNick }) {
  const ranking = useMemo(() => computeHunterRanking(ctx || {}), [ctx]);
  const maxScore = useMemo(() => TITLE_DEFS.reduce((s, t) => s + achPoints(t), 0), []);
  const users = (ctx && ctx.users) || {};
  const cosmOf = (n) => (users[n] || {}).cosmetics || {};
  const top3 = ranking.slice(0, 3);
  const podiumOrder = [top3[1], top3[0], top3[2]]; // prata, ouro, bronze
  const medalColor = ['#d4af37', '#9a9a9a', '#b06a2c'];
  if (ranking.length === 0) {
    return <div className="card"><div className="card-body"><div className="empty"><div className="e1">SEM CAÇADORES AINDA</div><div className="e2">Desbloqueie conquistas pra entrar no ranking.</div></div></div></div>;
  }
  return (
    <div>
      {/* Pódio */}
      <div className="cacador-podium">
        {podiumOrder.map((r, i) => {
          if (!r) return <div key={'e' + i} className="cacador-pod-slot empty" />;
          const rank = ranking.findIndex(x => x.nick === r.nick) + 1;
          return (
            <div key={r.nick} className={'cacador-pod-slot pos' + rank + (r.nick === myNick ? ' me' : '')}>
              <div className="cacador-pod-medal" style={{ color: medalColor[rank - 1] }}><Icon name="medal" size={20} /> {rank}º</div>
              <Avatar nick={r.nick} teamPlayers={teamPlayers} cosmetics={cosmOf(r.nick)} size={54} />
              <div className="cacador-pod-nick">{r.nick}</div>
              <div className="cacador-pod-score">{r.score} <span>PTS</span></div>
              <div className="cacador-pod-count">{r.count} conquistas</div>
            </div>
          );
        })}
      </div>
      {/* Lista completa */}
      <div className="card">
        <div className="card-head">
          <div className="title"><Icon name="crosshair" size={16} /> RANKING DE CAÇADORES</div>
          <div className="sub">{ranking.length} JOGADORES</div>
        </div>
        <div className="card-body">
          <div className="cacador-list">
            {ranking.map((r, i) => {
              const pct = maxScore ? Math.round((r.score / maxScore) * 100) : 0;
              return (
                <div key={r.nick} className={'cacador-row' + (r.nick === myNick ? ' me' : '')}>
                  <span className="cacador-row-pos">{String(i + 1).padStart(2, '0')}</span>
                  <Avatar nick={r.nick} teamPlayers={teamPlayers} cosmetics={cosmOf(r.nick)} size={30} noBadge />
                  <span className="cacador-row-nick">{r.nick}{r.nick === myNick ? ' (você)' : ''}</span>
                  <span className="cacador-row-bar"><span className="cacador-row-fill" style={{ width: pct + '%' }} /></span>
                  <span className="cacador-row-count">{r.count}</span>
                  <span className="cacador-row-score">{r.score} PTS</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CLASSIFICAÇÃO (aba) ────────────────────────────────────────────────────
// Controlled component: cs e setCs vêm do App (que mantém o subscribe ao
// primitivao/state, faz write-back e liquidação automática das apostas).
function ClassificacaoView({ cs, setCs, isAdmin, users, teamPlayers, myNick }) {
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
  const rounds = cs.rounds || [];
  const round = rounds[viewRound] || [];

  // status de cada rodada pro trilho (igual ao MK): encerrada / atual / a vir.
  const isPlayed = (m) => { const h = parseInt(m.gh, 10), a = parseInt(m.ga, 10); return !Number.isNaN(h) && !Number.isNaN(a); };
  const pendIdx = rounds.findIndex(r => r.some(m => !isPlayed(m)));
  const liveIdx = pendIdx === -1 ? TOTAL_ROUNDS - 1 : pendIdx;
  const roundsMeta = rounds.map((r, idx) => {
    const total = r.length;
    const doneN = r.reduce((acc, m) => acc + (isPlayed(m) ? 1 : 0), 0);
    const allDone = total > 0 && doneN >= total;
    const st = allDone ? 'done' : ((idx === pendIdx || doneN > 0) ? 'live' : 'future');
    return { idx, n: idx + 1, total, doneN, st };
  });
  const doneRounds = roundsMeta.filter(rm => rm.st === 'done').length;
  // confronto do usuário logado: destaca e joga pro topo da rodada.
  // FIFA guarda fixtures por TEAM ID; o nick do logado pode diferir do teamId
  // (ex.: juca->jucamelero), então resolve nick->teamId antes de comparar.
  const myTeam = reverseTeamMap(teamPlayers || {})[myNick] || myNick;
  const isMine = (m) => !!(myTeam && (m.home === myTeam || m.away === myTeam));

  const patchMatch = (gi, patch) => {
    setCs(prev => {
      const rs = prev.rounds.map((r, ri) => ri !== viewRound ? r : r.map((m, mi) => mi === gi ? { ...m, ...patch } : m));
      return { ...prev, rounds: rs };
    });
  };

  return (
    <div className="grid mk-grid">
      <div className="card mk-card">
        <div className="card-head">
          <div className="title"><Icon name="football" size={16} /> CLASSIFICAÇÃO · FIFA</div>
          <div className="sub">{standings.length} JOGADORES · IDA</div>
        </div>
        <div className="card-body">
          <div style={{ overflowX: 'auto' }}>
            <table className="std-table">
              <thead>
                <tr><th>#</th><th style={{ textAlign: 'left' }}>JOGADOR</th><th>J</th><th>V</th><th>E</th><th>D</th><th>SG</th><th>P</th></tr>
              </thead>
              <tbody>
                {standings.map((s, i) => {
                  const sg = s.gp - s.gc;
                  const cls = i < 2 ? 'glory' : i >= standings.length - 2 ? 'releg' : '';
                  const pNick = (teamPlayers || {})[s.id] || s.id; // teamId -> nick do jogador
                  const playerTitle = (users || {})[pNick]?.title;
                  return (
                    <tr key={s.id} className={cls}>
                      <td className="std-pos">{String(i + 1).padStart(2, '0')}</td>
                      <td>
                        <div className="tnm" style={{ flexWrap: 'wrap' }}>
                          <ClubCrest nick={s.id} teamPlayers={teamPlayers} size={24} />
                          <span>{pNick}</span>
                          {playerTitle && <TitleBadge titleId={playerTitle} />}
                        </div>
                      </td>
                      <td>{s.j}</td><td style={{ fontWeight: 800 }}>{s.v}</td><td>{s.e}</td>
                      <td style={{ color: 'rgba(28,22,18,0.45)' }}>{s.d}</td>
                      <td>{sg > 0 ? '+' + sg : sg}</td>
                      <td style={{ fontFamily: 'Anton, Impact', fontSize: 16 }}>{s.p}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mk-legend">
            <strong>SG</strong> = saldo de gols. Vitória vale 3, empate 1. Os <strong>2 primeiros</strong> em glória, os <strong>2 últimos</strong> na zona.
          </div>
        </div>
      </div>

      <aside>
        <div className="card mk-card mk-rodada-card">
          <div className="card-head">
            <div className="title">RODADA {String(viewRound + 1).padStart(2, '0')}</div>
            <div className="sub">{isAdmin ? 'EDITÁVEL' : 'OFICIAL'}</div>
          </div>
          <div className="card-body">
            <div className="mk-rnav">
              <button className="mk-rnav-btn" onClick={() => setViewRound(Math.max(0, viewRound - 1))} disabled={viewRound === 0} aria-label="Rodada anterior"><Icon name="chevron-left" size={18} /></button>
              <div className="mk-rnav-mid">
                <div className="mk-rnav-phase">PRIMITIVÃO · IDA</div>
                <div className="mk-rnav-count">{viewRound + 1} <span>/ {TOTAL_ROUNDS}</span></div>
              </div>
              <button className="mk-rnav-btn" onClick={() => setViewRound(Math.min(TOTAL_ROUNDS - 1, viewRound + 1))} disabled={viewRound === TOTAL_ROUNDS - 1} aria-label="Próxima rodada"><Icon name="chevron-right" size={18} /></button>
            </div>
            <div className="mk-rstrip" role="tablist" aria-label="Todas as rodadas">
              <div className="mk-rstrip-grp">
                <span className="mk-rstrip-lab">RODADAS</span>
                <div className="mk-rstrip-chips">
                  {roundsMeta.map(rm => (
                    <button key={rm.idx} type="button" role="tab" aria-selected={rm.idx === viewRound}
                            className={'mk-rchip mk-rchip-' + rm.st + (rm.idx === viewRound ? ' sel' : '')}
                            onClick={() => setViewRound(rm.idx)}
                            title={'Rodada ' + String(rm.n).padStart(2, '0') + ' · ' + rm.doneN + '/' + rm.total + ' jogos'}>
                      <span className="mk-rchip-n">{String(rm.n).padStart(2, '0')}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mk-rstrip-leg">
              <span><i className="mk-lg-dot done" /> encerrada</span>
              <span><i className="mk-lg-dot live" /> atual</span>
              <span><i className="mk-lg-dot future" /> a vir</span>
              {viewRound !== liveIdx && (
                <button type="button" className="mk-rstrip-now" onClick={() => setViewRound(liveIdx)}><Icon name="target" size={11} /> RODADA ATUAL</button>
              )}
              <span className="mk-rstrip-prog">{doneRounds}/{TOTAL_ROUNDS} rodadas</span>
            </div>
            <div className="mk-fixtures">
              {round
                .map((m, gi) => ({ m, gi }))
                .sort((a, b) => (isMine(b.m) ? 1 : 0) - (isMine(a.m) ? 1 : 0)) // SEU JOGO no topo
                .map(({ m, gi }) => {
                  const ghN = parseInt(m.gh, 10), gaN = parseInt(m.ga, 10);
                  const played = !Number.isNaN(ghN) && !Number.isNaN(gaN);
                  const mine = isMine(m);
                  return (
                    <div key={gi} className={'mk-fx' + (played ? ' done' : '') + (mine ? ' mine' : '')}>
                      <div className="mk-fx-top">
                        <span className="mk-fx-jogo">JOGO {String(gi + 1).padStart(2, '0')}{mine && <span className="mk-fx-mine"><Icon name="football" size={10} /> SEU JOGO</span>}</span>
                        {played
                          ? <span className="mk-fx-done"><Icon name="check" size={11} /> {ghN}×{gaN}</span>
                          : (m.day || m.date || m.time) ? <span className="mk-fx-meta">{[m.day, m.date, m.time].filter(Boolean).join(' · ')}</span> : null}
                      </div>
                      <div className="mk-fx-body">
                        <div className="mk-fx-side home">
                          <ClubCrest nick={m.home} teamPlayers={teamPlayers} size={32} />
                          <div className="mk-fx-id">
                            {isAdmin
                              ? <select className="cteam-sel" value={m.home} onChange={e => patchMatch(gi, { home: e.target.value })}>{Object.keys(teamPlayers || {}).map(k => <option key={k} value={k}>{fifaUserOf(k, teamPlayers)}</option>)}</select>
                              : <div className="mk-fx-nick">{fifaUserOf(m.home, teamPlayers)}</div>}
                            <div className="mk-fx-role mandante">MANDANTE</div>
                          </div>
                        </div>
                        <div className="fifa-fx-score">
                          {isAdmin ? (
                            <>
                              <input className="cscore-in" value={m.gh} placeholder="–" inputMode="numeric" onChange={e => patchMatch(gi, { gh: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
                              <span className="fifa-fx-x">×</span>
                              <input className="cscore-in" value={m.ga} placeholder="–" inputMode="numeric" onChange={e => patchMatch(gi, { ga: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
                            </>
                          ) : (
                            <span className="fifa-fx-sc" style={{ color: played ? 'var(--pv-orange)' : 'rgba(28,22,18,0.3)' }}>{played ? ghN + ' × ' + gaN : '– × –'}</span>
                          )}
                        </div>
                        <div className="mk-fx-side away">
                          <ClubCrest nick={m.away} teamPlayers={teamPlayers} size={32} />
                          <div className="mk-fx-id">
                            {isAdmin
                              ? <select className="cteam-sel" value={m.away} onChange={e => patchMatch(gi, { away: e.target.value })}>{Object.keys(teamPlayers || {}).map(k => <option key={k} value={k}>{fifaUserOf(k, teamPlayers)}</option>)}</select>
                              : <div className="mk-fx-nick">{fifaUserOf(m.away, teamPlayers)}</div>}
                            <div className="mk-fx-role visitante">VISITANTE</div>
                          </div>
                        </div>
                      </div>
                      {isAdmin && (
                        <div className="cmatch-foot">
                          <input className="cfld" value={m.day} maxLength={3} placeholder="DIA" onChange={e => patchMatch(gi, { day: e.target.value.toUpperCase().slice(0, 3) })} />
                          <input className="cfld" value={m.date} maxLength={5} placeholder="DATA" onChange={e => patchMatch(gi, { date: e.target.value })} />
                          <input className="cfld" value={m.time} maxLength={5} placeholder="HORA" onChange={e => patchMatch(gi, { time: e.target.value })} />
                          <button className="cclear" onClick={() => patchMatch(gi, { gh: '', ga: '' })}>LIMPAR</button>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
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
  // Dinâmico: cria o histórico a partir das chaves dos jogos (teamId ou nick).
  const teamHistory = {};
  const ensure = (id) => { if (!teamHistory[id]) teamHistory[id] = []; return teamHistory[id]; };
  (rounds || []).forEach(round => {
    (round || []).forEach(m => {
      if (!m || m.home == null || m.away == null) return;
      const gh = parseInt(m.gh, 10);
      const ga = parseInt(m.ga, 10);
      if (Number.isNaN(gh) || Number.isNaN(ga)) return;
      const wH = gh > ga ? 'W' : gh < ga ? 'L' : 'D';
      const wA = wH === 'W' ? 'L' : wH === 'L' ? 'W' : 'D';
      ensure(m.home).push(wH);
      ensure(m.away).push(wA);
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
function detectJournalistEvents({ cs, bets, users, teamPlayers }) {
  const events = [];
  const rounds = (cs && cs.rounds) || [];
  const nm = (id) => fifaUserOf(id, teamPlayers); // nome p/ texto: @nick (sem times)
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
          home: nm(m.home),
          away: nm(m.away),
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
        home: nm(m.home), away: nm(m.away),
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
          winner: gh > ga ? nm(m.home) : nm(m.away),
          loser:  gh > ga ? nm(m.away) : nm(m.home),
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
    events.push({
      type: 'streak',
      id: `streak-${s.team}-${s.kind}`,
      team: nm(s.team),
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
        champion: nm(st[0].id),
        vice:     nm(st[1].id),
        lanterna: nm(st[st.length - 1].id),
        penultimo: nm(st[st.length - 2].id),
        topScorerTeam: nm(st[0].id),
        topScorerGoals: st[0].gp,
      });
    }
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
      return `APOSTA GORDA: ${e.user} acertou ${e.legCount} palpite${e.legCount > 1 ? 's' : ''} e levou ${e.payout} PC (apostou ${e.stake} PC, odds ${e.odds.toFixed(2)}x)`;
    case 'streak':
      return `SEQUÊNCIA: ${e.team} ${e.kind === 'win' ? 'venceu' : 'perdeu'} ${e.count} jogos seguidos`;
    case 'season_end':
      return `FIM DE TEMPORADA: Campeão ${e.champion} · Vice ${e.vice} · Penúltimo ${e.penultimo} · Lanterna ${e.lanterna} (artilheiro do líder: ${e.topScorerGoals} gols)`;
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
function TpTeamSelect({ value, onChange, teamPlayers }) {
  const tp = teamPlayers || {};
  const keys = Object.keys(tp);
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value)} className="tp-input tp-select">
      <option value="">— sem jogador —</option>
      {keys.map(k => <option key={k} value={k}>{fifaUserOf(k, tp)}</option>)}
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
    const o = (computeGameOdds(g.home, g.away, metrics, rounds) || {})['1X2'] || {};
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
  const nm = (id) => nickOf(id) || id; // nome p/ texto: nick do jogador (sem mais times)
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
        `${nm(big.winId)} ${big.hi}x${big.lo} ${nm(big.loseId)}. Foi covardia, chama o SAMU.`, 'skull', 'spice');
    // Confronto da semana (primeiro jogo aberto da rodada atual).
    const open = bettableGames(rounds);
    if (open.length) {
      const minRi = Math.min.apply(null, open.map(g => g.ri));
      const next = open.filter(g => g.ri === minRi)[0];
      if (next)
        push('proximo', next.home, nickOf(next.home), 'JOGO DA SEMANA',
          `Olho nesse: ${nm(next.home)} × ${nm(next.away)}. Vai pegar fogo.`, 'fire', 'spice');
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
            `${nm(g.home)} ${gh}x${ga} ${nm(g.away)}. Ninguém quis ganhar.`, 'football', 'spice');
        } else {
          const winId = gh > ga ? g.home : g.away, loseId = gh > ga ? g.away : g.home;
          const W = nm(winId), L = nm(loseId), hi = Math.max(gh, ga), lo = Math.min(gh, ga);
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
        ? { nick: lead.nick, teamId: tf(lead.nick), crown: true, title: `${lead.nick.toUpperCase()} LIDERA O BOLÃO!`, stats: [{ k: 'PTS', v: String(lead.pts) }, { k: 'EXATOS', v: String(lead.exatos) }, { k: 'CERTOS', v: String(lead.certos) }, { k: 'PALPITES', v: String(lead.palpitados) }], note: '' }
        : base.champion,
      sideBlocks: (worst && lead && worst.nick !== lead.nick)
        ? [{ nick: worst.nick, teamId: tf(worst.nick), kicker: worst.nick, title: 'BOLA MURCHA', text: `${worst.pts} pts. Chuta de olho fechado.`, tone: 'bad', stats: [] }]
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
  const teamName = (id) => (id ? fifaUserOf(id, teamPlayers) : '');
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
                <span className="tp-strip-name">{p.nick ? p.nick : teamName(p.teamId)}</span>
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

  const reload = async () => {
    if (!(await confirmModal({ title: 'RECARREGAR TABLOIDE?', body: 'Refaz tudo a partir da classificação. Você perde as edições manuais desta edição.', confirmLabel: 'RECARREGAR', danger: true }))) return;
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
          <label className="tp-fld"><span className="tp-fld-label">Jogador</span><TpTeamSelect value={data.champion.teamId} onChange={v => patchChamp({ teamId: v })} teamPlayers={teamPlayers} /></label>
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
              <label className="tp-fld"><span className="tp-fld-label">Jogador</span><TpTeamSelect value={b.teamId} onChange={v => patchBlock(i, { teamId: v })} teamPlayers={teamPlayers} /></label>
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
              <label className="tp-fld" style={{ flex: 2 }}><span className="tp-fld-label">{`Jogador ${i + 1}`}</span><TpTeamSelect value={p.teamId} onChange={v => patchStripPlayer(i, { teamId: v })} teamPlayers={teamPlayers} /></label>
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
                  <label className="tp-fld" style={{ flex: 2 }}><span className="tp-fld-label">Quem</span><TpTeamSelect value={s.teamId} onChange={v => patchStory(i, { teamId: v })} teamPlayers={teamPlayers} /></label>
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
              <TpTeamSelect value={m.homeId} onChange={v => patchMatch(i, { homeId: v })} teamPlayers={teamPlayers} />
              <input type="text" value={m.oddHome} onChange={e => patchMatch(i, { oddHome: e.target.value })} className="tp-input tp-odd" placeholder="1.45" />
              <input type="text" value={m.oddDraw} onChange={e => patchMatch(i, { oddDraw: e.target.value })} className="tp-input tp-odd" placeholder="X" />
              <input type="text" value={m.oddAway} onChange={e => patchMatch(i, { oddAway: e.target.value })} className="tp-input tp-odd" placeholder="2.10" />
              <TpTeamSelect value={m.awayId} onChange={v => patchMatch(i, { awayId: v })} teamPlayers={teamPlayers} />
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
            placeholder="ex: BÔNUS SEMANAL LIBERADO! Vai lá pegar 550 PC."
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
          <strong>Posts automáticos planejados</strong> (em breve): rodada fechada (+bônus),
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
                <button onClick={async (e) => { e.stopPropagation(); if (await confirmModal({ title: 'REMOVER NOTÍCIA?', body: '"' + n.title + '" sai do feed pra todo mundo.', confirmLabel: 'REMOVER', danger: true })) removeNews(n.id); }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--pv-red)', padding: 4, display: 'inline-flex' }}>
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
  'snowflake', 'rocket', 'crosshair', 'fist', 'chess', 'pokeball', 'cards', 'crab',
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

      {/* CONQUISTAS */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <div className="title">CONQUISTAS</div>
          <div className="sub">{TITLE_DEFS.length} NO CATÁLOGO · {TITLE_DEFS.reduce((s, t) => s + achPoints(t), 0)} PTS TOTAIS</div>
        </div>
        <div className="card-body">
          <div className="catalogo-grid">
            {TITLE_DEFS.map(t => (
              <div key={t.id} className={'catalogo-card rarity-' + t.rarity} style={{ borderLeftColor: t.color }}>
                <div className="catalogo-card-head">
                  <span style={{ color: t.color, display: 'inline-flex' }}><Icon name={t.icon} size={22} /></span>
                  <span className="catalogo-card-name" style={{ color: t.color }}>{t.name}</span>
                </div>
                <div className="catalogo-card-desc">{t.desc}</div>
                <div className="catalogo-card-meta">{(ACH_CATS.find(c => c.id === t.cat) || {}).label || t.cat} · {RARITY_LABEL[t.rarity]} · {achPoints(t)} PTS{t.rewards ? ' · dropa ' + [t.rewards.badge, t.rewards.frame].filter(Boolean).join(' + ') : ''}</div>
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

// ADMIN/MOD: lista TODAS as apostas (todos os usuários) com filtro por jogador,
// jogo e status, e botão pra ANULAR (devolve o valor; estorna prêmio se ganhou).
// Pro caso de WO / jogo cancelado (ex: o cara não apareceu).
function AdminBetsPanel({ bets, users, teamPlayers, cs, onVoidBet }) {
  const [statusF, setStatusF] = useState('all');
  const [champF, setChampF] = useState('all');
  const [userF, setUserF] = useState('all');
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState(null);
  // lista de apostadores (exceto admin) pro filtro por usuário
  const bettors = Array.from(new Set((bets || []).filter(b => b.user && b.user !== 'admin').map(b => b.user))).sort((a, b) => a.localeCompare(b));

  const isKoLeg = (l) => typeof l.fixtureId === 'string' && l.fixtureId.indexOf('mkko:') === 0;
  const legMatchup = (l) => {
    if (isKoLeg(l)) return l.home + ' x ' + l.away;
    if (typeof l.fixtureId === 'string' && l.fixtureId.indexOf('mk:') === 0) return l.home + ' x ' + l.away;
    const p = parseGameId(l.fixtureId);
    if (p && cs && cs.rounds && cs.rounds[p.ri] && cs.rounds[p.ri][p.gi]) {
      const g = cs.rounds[p.ri][p.gi];
      return ((teamPlayers || {})[g.home] || g.home) + ' x ' + ((teamPlayers || {})[g.away] || g.away);
    }
    return l.fixtureId || '?';
  };
  const legText = (l) => {
    if (isKoLeg(l)) return 'MATA-MATA · ' + (MK_KO_MARKET_TITLE[l.market] || l.market) + ' ' + mkKoPickLabel(l.market, l.pick, l.home, l.away);
    const isMk = typeof l.fixtureId === 'string' && l.fixtureId.indexOf('mk:') === 0;
    if (isMk) return (MK_MARKET_TITLE[l.market] || l.market) + ' ' + mkPickLabel(l.market, l.pick);
    return (l.market || '') + ' ' + (l.pick || '');
  };
  const searchable = (b) => {
    const parts = [b.user];
    (b.legs || []).forEach(l => {
      if (isKoLeg(l) || (typeof l.fixtureId === 'string' && l.fixtureId.indexOf('mk:') === 0)) { parts.push(l.home, l.away); }
      else { const p = parseGameId(l.fixtureId); if (p && cs && cs.rounds && cs.rounds[p.ri] && cs.rounds[p.ri][p.gi]) { const g = cs.rounds[p.ri][p.gi]; parts.push((teamPlayers || {})[g.home] || g.home, (teamPlayers || {})[g.away] || g.away); } }
    });
    return parts.filter(Boolean).join(' ').toLowerCase();
  };

  const qq = q.trim().toLowerCase();
  const list = (bets || [])
    .filter(b => b.user !== 'admin')
    .filter(b => userF === 'all' || b.user === userF)
    .filter(b => statusF === 'all' || (b.status || 'pending') === statusF)
    .filter(b => champF === 'all' || (b.champId || 'fifa') === champF)
    .filter(b => !qq || searchable(b).includes(qq))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const doVoid = async (b) => {
    const head = b.status === 'won' ? 'ANULAR APOSTA VENCEDORA?' : b.status === 'lost' ? 'ANULAR APOSTA PERDIDA?' : 'CANCELAR APOSTA?';
    const extra = b.status === 'won'
      ? 'ATENÇÃO: essa aposta de ' + b.user + ' JÁ GANHOU. Anular ESTORNA o prêmio (' + (b.payout || 0) + ' PC) e devolve o valor apostado (' + (b.amount || 0) + ' PC).'
      : 'Devolve ' + (b.amount || 0) + ' PC pro ' + b.user + '.';
    if (!(await confirmModal({ title: head, body: extra, confirmLabel: b.status === 'pending' ? 'CANCELAR APOSTA' : 'ANULAR', danger: true }))) return;
    setBusyId(b.id);
    try {
      const r = await onVoidBet(b.id);
      if (r && r.err) showToast(r.err, 'error');
      else showToast('Aposta anulada — valor devolvido pro ' + b.user + '.', 'success');
    } finally { setBusyId(null); }
  };

  const fld = { padding: '6px 10px', fontWeight: 700, fontSize: 12 };
  return (
    <div className="card">
      <div className="card-head">
        <div className="title">TODAS AS APOSTAS</div>
        <div className="sub">{list.length} {list.length === 1 ? 'CUPOM' : 'CUPONS'}</div>
      </div>
      <div className="card-body">
        <div className="mk-admin-note" style={{ marginBottom: 12 }}><Icon name="shield" size={12} /> Anular devolve o valor apostado (e estorna o prêmio, se já tinha ganho). Use pra WO / jogo cancelado.</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="buscar jogador (ex: caco)" style={{ ...fld, flex: 1, minWidth: 140 }} />
          <select value={userF} onChange={e => setUserF(e.target.value)} style={fld} title="Filtrar por usuário">
            <option value="all">Todos os usuários</option>
            {bettors.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <select value={champF} onChange={e => setChampF(e.target.value)} style={fld}>
            <option value="all">Todos os jogos</option>
            <option value="fifa">FIFA</option>
            <option value="mk">MK</option>
            <option value="mkko">MK (mata-mata)</option>
          </select>
          <select value={statusF} onChange={e => setStatusF(e.target.value)} style={fld}>
            <option value="all">Todos os status</option>
            <option value="pending">Em aberto</option>
            <option value="won">Ganhas</option>
            <option value="lost">Perdidas</option>
          </select>
        </div>
        {list.length === 0 ? (
          <div className="empty"><div className="e1">NENHUMA APOSTA</div><div className="e2">Ajusta os filtros aí em cima.</div></div>
        ) : list.map(b => {
          const st = b.status || 'pending';
          const stLabel = st === 'won' ? 'GANHOU +' + (b.payout || 0) : st === 'lost' ? 'PERDEU' : 'EM ABERTO';
          const stColor = st === 'won' ? '#3a7d2a' : st === 'lost' ? '#c33' : 'var(--pv-orange)';
          const champTag = b.champId === 'mkko' ? 'MK KO' : (b.champId || 'fifa') === 'mk' ? 'MK' : 'FIFA';
          return (
            <div key={b.id} className="lb-row" style={{ gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center', borderLeft: '3px solid ' + stColor, paddingLeft: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span className="lb-nick">{b.user}</span>
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', color: 'var(--pv-orange)' }}>{champTag}</span>
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', color: stColor }}>{stLabel}</span>
                  {b.legs && b.legs.length > 1 && <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(28,22,18,0.5)' }}>CASADA {b.legs.length}</span>}
                </div>
                <div style={{ fontSize: 11, color: 'rgba(28,22,18,0.7)', marginTop: 2 }}>
                  {(b.legs || []).map((l, i) => (
                    <div key={i} style={{ fontWeight: 600 }}>{legMatchup(l)} <span style={{ color: 'rgba(28,22,18,0.45)' }}>· {legText(l)}</span></div>
                  ))}
                </div>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: 'rgba(28,22,18,0.55)', marginTop: 2 }}>{b.amount} PC @ {Number(b.combinedOdds || 0).toFixed(2)}</div>
              </div>
              <button onClick={() => doVoid(b)} disabled={busyId === b.id} style={{ padding: '7px 12px', fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', background: 'transparent', border: '1.5px solid #c33', color: '#c33', cursor: busyId === b.id ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>
                {busyId === b.id ? '...' : (st === 'pending' ? 'CANCELAR' : 'ANULAR')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Ajustador de moedas do admin com PREVIEW: acumula o delta local e mostra
// "atual → novo" antes de gravar. Um clique errado não dispara mais transação
// no Firestore — só o APLICAR grava (e em UMA transação, não N).
function CoinAdjuster({ label, value, accent, onApply }) {
  const [delta, setDelta] = useState(0);
  const [busy, setBusy] = useState(false);
  const cur = value || 0;
  // Não deixa o preview ir abaixo de zero (saldo nunca fica negativo).
  const step = (dir) => setDelta(d => Math.max(-cur, d + dir * 50));
  const target = cur + delta;
  const apply = async () => {
    if (!delta || busy) return;
    setBusy(true);
    try { await onApply(delta); setDelta(0); }
    finally { setBusy(false); }
  };
  return (
    <div className="coin-adj">
      <span className="coin-adj-lab" style={accent ? { color: 'var(--pv-orange)' } : undefined}>{label}</span>
      <button type="button" className="coin-adj-btn" onClick={() => step(-1)} disabled={busy || target <= 0}>-</button>
      <div className="coin-adj-val mono">
        {delta === 0 ? cur : (
          <>
            <span className="coin-adj-old">{cur}</span>
            <Icon name="arrow-right" size={10} />
            <strong className="coin-adj-new">{target}</strong>
          </>
        )}
      </div>
      <button type="button" className="coin-adj-btn coin-adj-plus" onClick={() => step(1)} disabled={busy}>+</button>
      {delta !== 0 && (
        <>
          <button type="button" className="coin-adj-apply" onClick={apply} disabled={busy}>
            {busy ? 'GRAVANDO…' : 'APLICAR ' + (delta > 0 ? '+' : '') + delta}
          </button>
          <button type="button" className="coin-adj-undo" onClick={() => setDelta(0)} disabled={busy} title="Descartar ajuste">
            <Icon name="x" size={11} />
          </button>
        </>
      )}
    </div>
  );
}

// ── ABA MOD: painel de moderação (Dia Oficial, e futuramente sorteio/placar) ──
// ── M8b: campeonatos lançados (classificação da liga + placar editável) ─────
// M8c: chaveamento do mata-mata. Resolve seeds/byes/vencedores e renderiza colunas
// por rodada. Mod lança placar (por leg) + pênaltis no empate; o vencedor sobe.
function ChampBracketView({ bracket, teamPlayers, editable, onMatchScore }) {
  if (!bracket || !bracket.rounds || !bracket.rounds.length) return null;
  const info = resolveBracket(bracket);
  const champion = bracketChampion(bracket, info);
  const setLeg = (m, li, fld, val) => {
    const legs = (m.legs || []).map((l, i) => i === li ? { ...l, [fld]: val.replace(/\D/g, '').slice(0, 2) } : l);
    onMatchScore(m.id, { legs });
  };
  const setPen = (m, side, val) => onMatchScore(m.id, { pen: { ...(m.pen || {}), [side]: val.replace(/\D/g, '').slice(0, 2) } });
  const row = (m, side) => {
    const inf = info[m.id] || {};
    const bye = side === 'home' ? inf.homeBye : inf.awayBye;
    const nick = inf[side];
    const isWin = !!inf.winner && !!nick && inf.winner === nick;
    const fld = side === 'home' ? 'gh' : 'ga';
    return (
      <div className={'bm-row' + (isWin ? ' win' : '')}>
        <span className="bm-who">
          {bye ? <span className="bm-bye">BYE</span>
            : nick ? <><Avatar nick={nick} teamPlayers={teamPlayers} size={18} noBadge /><span className="bm-nick">{nick}</span></>
              : <span className="bm-tbd">a definir</span>}
        </span>
        {!bye && nick && (
          <span className="bm-score">
            {(m.legs || []).map((l, li) => editable
              ? <input key={li} className="cscore-in xs" value={l[fld] || ''} placeholder="–" inputMode="numeric" onChange={e => setLeg(m, li, fld, e.target.value)} />
              : <b key={li}>{(l[fld] === '' || l[fld] == null) ? '–' : l[fld]}</b>)}
          </span>
        )}
      </div>
    );
  };
  const matchBox = (m, key) => {
    const inf = info[m.id] || {};
    return (
      <div className={'bm' + (inf.played ? ' done' : '')} key={key}>
        {row(m, 'home')}
        {row(m, 'away')}
        {inf.needsPen && (editable
          ? <div className="bm-pen"><span className="bm-pen-l">PÊNALTIS</span><input className="cscore-in xs" value={(m.pen && m.pen.h) || ''} inputMode="numeric" onChange={e => setPen(m, 'h', e.target.value)} /><i>×</i><input className="cscore-in xs" value={(m.pen && m.pen.a) || ''} inputMode="numeric" onChange={e => setPen(m, 'a', e.target.value)} /></div>
          : <div className="bm-pen-need">empate — pênaltis pendentes</div>)}
      </div>
    );
  };
  return (
    <div className="champ-bracket">
      {champion && <div className="bracket-champ"><Icon name="trophy" size={14} /> CAMPEÃO: <b>{champion}</b></div>}
      <div className="bracket-cols">
        {bracket.rounds.map((rd, ri) => (
          <div className="bracket-col" key={ri}>
            <div className="bracket-col-h">{rd.name}</div>
            {(rd.matches || []).map((m, mi) => matchBox(m, mi))}
          </div>
        ))}
        {bracket.thirdPlace && (
          <div className="bracket-col" key="3p">
            <div className="bracket-col-h">3º LUGAR</div>
            {matchBox(bracket.thirdPlace, '3p')}
          </div>
        )}
      </div>
    </div>
  );
}
function ChampLeagueView({ champ, teamPlayers, editable, onScore, onMatchScore, onGenKnockout }) {
  const rounds = (champ.league && champ.league.rounds) || [];
  const hasLeague = rounds.length > 0;
  const standings = computeStandings(rounds);
  const [vr, setVr] = useState(0);
  const round = rounds[vr] || [];
  const leagueComplete = hasLeague && rounds.every(rd => (rd || []).every(m => {
    const a = parseInt(m.gh, 10), b = parseInt(m.ga, 10); return !Number.isNaN(a) && !Number.isNaN(b);
  }));
  const fmtLabel = champ.format === 'CUP' ? 'COPA (MATA-MATA)' : champ.format === 'LEAGUE_KO' ? 'LIGA + MATA-MATA' : 'LIGA';
  return (
    <div className="card">
      <div className="card-head">
        <div className="title"><Icon name={champ.format === 'CUP' ? 'sword' : 'chart'} size={15} /> {champ.name}</div>
        <div className="sub">{champ.season} · {fmtLabel}{champ.config && champ.config.doubleRound ? ' · IDA/VOLTA' : ''}</div>
      </div>
      <div className="card-body">
        {hasLeague && (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table className="std-table">
                <thead><tr><th>#</th><th style={{ textAlign: 'left' }}>JOGADOR</th><th>J</th><th>V</th><th>E</th><th>D</th><th>SG</th><th>P</th></tr></thead>
                <tbody>
                  {standings.map((s, i) => {
                    const sg = s.gp - s.gc;
                    const cls = i < 2 ? 'glory' : i >= standings.length - 2 ? 'releg' : '';
                    return (
                      <tr key={s.id} className={cls}>
                        <td className="std-pos">{String(i + 1).padStart(2, '0')}</td>
                        <td><div className="tnm" style={{ flexWrap: 'wrap' }}><Avatar nick={s.id} teamPlayers={teamPlayers} size={22} noBadge /><span>{s.id}</span></div></td>
                        <td>{s.j}</td><td style={{ fontWeight: 800 }}>{s.v}</td><td>{s.e}</td><td style={{ color: 'rgba(28,22,18,0.45)' }}>{s.d}</td><td>{sg > 0 ? '+' + sg : sg}</td>
                        <td style={{ fontFamily: 'Anton, Impact', fontSize: 16 }}>{s.p}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="champ-rd-chips">
              {rounds.map((r, ri) => <button key={ri} type="button" className={'mk-rchip' + (ri === vr ? ' sel' : '')} onClick={() => setVr(ri)}>{String(ri + 1).padStart(2, '0')}</button>)}
            </div>
            <div className="champ-rd-games">
              {round.map((m, gi) => {
                const ghN = parseInt(m.gh, 10), gaN = parseInt(m.ga, 10);
                const played = !Number.isNaN(ghN) && !Number.isNaN(gaN);
                return (
                  <div key={gi} className={'mk-fx' + (played ? ' done' : '')}>
                    <div className="mk-fx-body">
                      <div className="mk-fx-side home"><Avatar nick={m.home} teamPlayers={teamPlayers} size={28} noBadge /><div className="mk-fx-id"><div className="mk-fx-nick">{m.home}</div></div></div>
                      <div className="fifa-fx-score">
                        {editable
                          ? <><input className="cscore-in" value={m.gh} placeholder="–" inputMode="numeric" onChange={e => onScore(vr, gi, { gh: e.target.value.replace(/\D/g, '').slice(0, 2) })} /><span className="fifa-fx-x">×</span><input className="cscore-in" value={m.ga} placeholder="–" inputMode="numeric" onChange={e => onScore(vr, gi, { ga: e.target.value.replace(/\D/g, '').slice(0, 2) })} /></>
                          : <span className="fifa-fx-sc" style={{ color: played ? 'var(--pv-orange)' : 'rgba(28,22,18,0.3)' }}>{played ? ghN + ' × ' + gaN : '– × –'}</span>}
                      </div>
                      <div className="mk-fx-side away"><Avatar nick={m.away} teamPlayers={teamPlayers} size={28} noBadge /><div className="mk-fx-id"><div className="mk-fx-nick">{m.away}</div></div></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        {champ.format === 'LEAGUE_KO' && leagueComplete && !champ.bracket && editable && onGenKnockout && (
          <button type="button" className="btn-primary" style={{ marginTop: 12 }} onClick={() => onGenKnockout(champ.id)}>
            <Icon name="trophy" size={13} /> GERAR MATA-MATA (TOP {(champ.config && champ.config.koQualifiers) || 8})
          </button>
        )}
        {champ.bracket && (
          <>
            <div className="champ-bracket-h"><Icon name="sword" size={13} /> CHAVEAMENTO — MATA-MATA</div>
            <ChampBracketView bracket={champ.bracket} teamPlayers={teamPlayers} editable={editable}
              onMatchScore={(mid, patch) => onMatchScore && onMatchScore(champ.id, mid, patch)} />
          </>
        )}
        {!hasLeague && !champ.bracket && (
          <div className="empty"><div className="e1">SEM JOGOS</div><div className="e2">Campeonato sem fase de liga nem chaveamento ainda.</div></div>
        )}
      </div>
    </div>
  );
}
const CHAMP_FORMATS = [
  { id: 'LEAGUE',    name: 'PRIMITIVÃO CLÁSSICO',     desc: 'Todos contra todos. Mais pontos vence.', icon: 'chart' },
  { id: 'LEAGUE_KO', name: 'CLÁSSICO + MATA-MATA',    desc: 'Liga + top classificados no mata-mata. O mais difícil.', icon: 'trophy' },
  { id: 'CUP',       name: 'COPA PRIMITIVA',          desc: 'Mata-mata direto, do início ao fim.', icon: 'sword' },
];
function ChampWizard({ users, interests, onCreate }) {
  const [name, setName] = useState('');
  const [season, setSeason] = useState('Season 1');
  const [game, setGame] = useState('fifa');
  const [format, setFormat] = useState('LEAGUE');
  const [doubleRound, setDoubleRound] = useState(true);
  const [koQualifiers, setKoQualifiers] = useState(8);
  const [koLegs, setKoLegs] = useState(1);
  const [thirdPlace, setThirdPlace] = useState(true);
  const [parts, setParts] = useState({});
  const [busy, setBusy] = useState(false);
  const allNicks = Object.keys(users || {}).filter(n => n && n !== ADMIN_NICK).sort((a, b) => a.localeCompare(b));
  const toggle = (n) => setParts(p => ({ ...p, [n]: !p[n] }));
  const selected = allNicks.filter(n => parts[n]);
  const isKO = format === 'CUP' || format === 'LEAGUE_KO';
  const hasLeague = format === 'LEAGUE' || format === 'LEAGUE_KO';
  const create = async () => {
    if (busy) return;
    if (!name.trim() || selected.length < 2) { showToast('Põe um nome e pelo menos 2 jogadores.', 'error'); return; }
    setBusy(true);
    try {
      await onCreate({ name: name.trim(), game, season, format, participants: selected, config: { doubleRound, koQualifiers, koLegs, thirdPlace, pointsWin: 3, pointsDraw: 1, pointsLoss: 0 } });
      setName(''); setParts({});
    } finally { setBusy(false); }
  };
  return (
    <div className="card">
      <div className="card-head"><div className="title"><Icon name="trophy" size={15} /> CRIAR CAMPEONATO</div></div>
      <div className="card-body champ-wizard">
        <div className="cw-row">
          <label className="cw-fld"><span>NOME</span><input value={name} placeholder="Primitivão FIFA" onChange={e => setName(e.target.value)} /></label>
          <label className="cw-fld"><span>SEASON</span><input value={season} onChange={e => setSeason(e.target.value)} /></label>
          <label className="cw-fld"><span>JOGO</span>
            <select value={game} onChange={e => setGame(e.target.value)}>
              <option value="fifa">FIFA</option><option value="mk">Mortal Kombat</option><option value="rl">Rocket League</option><option value="lol">LoL</option><option value="outro">Outro</option>
            </select>
          </label>
        </div>
        <div className="cw-lbl">FORMATO</div>
        <div className="cw-formats">
          {CHAMP_FORMATS.map(f => (
            <button key={f.id} type="button" className={'cw-fmt' + (format === f.id ? ' on' : '')} onClick={() => setFormat(f.id)}>
              <Icon name={f.icon} size={18} /><div className="cw-fmt-n">{f.name}</div><div className="cw-fmt-d">{f.desc}</div>
            </button>
          ))}
        </div>
        <div className="cw-lbl">CONFIGURAÇÃO</div>
        <div className="cw-cfg">
          {hasLeague && <label className="cw-check"><input type="checkbox" checked={doubleRound} onChange={e => setDoubleRound(e.target.checked)} /> Ida e volta</label>}
          {isKO && <label className="cw-check"><input type="checkbox" checked={koLegs === 2} onChange={e => setKoLegs(e.target.checked ? 2 : 1)} /> Mata-mata ida e volta</label>}
          {isKO && <label className="cw-check"><input type="checkbox" checked={thirdPlace} onChange={e => setThirdPlace(e.target.checked)} /> Disputa de 3º lugar</label>}
          {format === 'LEAGUE_KO' && <label className="cw-fld inline"><span>CLASSIFICAM</span><select value={koQualifiers} onChange={e => setKoQualifiers(+e.target.value)}><option value={4}>Top 4</option><option value={8}>Top 8</option></select></label>}
        </div>
        <div className="cw-lbl">PARTICIPANTES <span className="cw-count">{selected.length} escolhidos</span></div>
        <div className="cw-parts">
          {allNicks.map(n => (
            <button key={n} type="button" className={'cw-part' + (parts[n] ? ' on' : '')} onClick={() => toggle(n)}>
              <Avatar nick={n} size={22} noBadge /> {n}{parts[n] && <Icon name="check" size={12} />}
            </button>
          ))}
        </div>
        <button type="button" className="btn-primary cw-create" disabled={busy} onClick={create}>{busy ? 'CRIANDO…' : 'CRIAR E PUBLICAR'}</button>
      </div>
    </div>
  );
}

function ChampAdminPanel({ champs, users, interests, isFullAdmin, teamPlayers, onCreate, onScore, onMatchScore, onGenKnockout, onDelete }) {
  const list = Object.values(champs || {}).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return (
    <div>
      <div className="mk-admin-note" style={{ margin: '18px 0 10px' }}><Icon name="trophy" size={12} /> CAMPEONATOS — crie ligas e copas e lance os placares aqui. Aparecem pra todos em CAMPEONATOS.</div>
      {isFullAdmin && <ChampWizard users={users} interests={interests} onCreate={onCreate} />}
      {list.length === 0 ? (
        <div className="empty" style={{ marginTop: 12 }}><div className="e1">NENHUM CAMPEONATO</div><div className="e2">{isFullAdmin ? 'Crie o primeiro no formulário acima.' : 'Nenhum campeonato lançado ainda.'}</div></div>
      ) : list.map(c => (
        <div key={c.id} style={{ marginTop: 14 }}>
          <ChampLeagueView champ={c} teamPlayers={teamPlayers} editable onScore={(ri, gi, patch) => onScore(c.id, ri, gi, patch)} onMatchScore={onMatchScore} onGenKnockout={onGenKnockout} />
          {isFullAdmin && <button type="button" className="btn-danger" style={{ marginTop: 8 }} onClick={() => onDelete(c.id)}><Icon name="trash" size={13} /> APAGAR "{c.name}"</button>}
        </div>
      ))}
    </div>
  );
}

function ModView({ officialDay, onSetOfficialDay, myNick }) {
  const [busy, setBusy] = useState(false);
  const active = !!(officialDay && officialDay.active);
  const toggle = async () => {
    if (busy) return;
    const ok = await confirmModal({
      title: active ? 'DESLIGAR DIA OFICIAL?' : 'LIGAR DIA OFICIAL?',
      body: active
        ? 'As apostas vencedoras voltam a pagar o valor normal (sem o +25%).'
        : 'Enquanto ligado, TODA aposta vencedora paga +25% de Primitivo Coins. Liga num dia de jogos oficiais e desliga depois — não retroage.',
      confirmLabel: active ? 'DESLIGAR' : 'LIGAR +25%', danger: active,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await onSetOfficialDay(!active);
      if (r && r.err) showToast('Erro: ' + r.err, 'error');
      else showToast(active ? 'Dia Oficial desligado.' : 'Dia Oficial LIGADO — +25% PC nas vitórias!', 'success');
    } finally { setBusy(false); }
  };
  return (
    <>
      <div className="mk-admin-note" style={{ marginBottom: 14 }}><Icon name="whistle" size={12} /> Painel do MODERADOR — gestão da liga.</div>
      <div className="card">
        <div className="card-head"><div className="title">DIA OFICIAL</div><div className="sub">{active ? 'ATIVO · +25% PC' : 'desligado'}</div></div>
        <div className="card-body">
          <p style={{ marginTop: 0, fontSize: 13, lineHeight: 1.5 }}>
            Em dias oficiais de jogos, ligue o bônus pra que <strong>toda aposta vencedora pague +25%</strong> de Primitivo Coins. Vale só pras apostas liquidadas <strong>enquanto estiver ligado</strong> — não retroage as já pagas.
          </p>
          {active && officialDay && officialDay.by && (
            <div style={{ fontSize: 11, color: 'rgba(28,22,18,0.6)', marginBottom: 10 }}>Ligado por {officialDay.by}.</div>
          )}
          <button onClick={toggle} disabled={busy} style={{ background: active ? 'var(--pv-charcoal)' : 'var(--pv-orange)', color: 'var(--pv-bone)', border: 'none', padding: '10px 18px', fontWeight: 800, fontSize: 13, letterSpacing: '0.1em', cursor: busy ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Icon name={active ? 'x' : 'coin-fire'} size={14} /> {busy ? 'SALVANDO…' : (active ? 'DESLIGAR DIA OFICIAL' : 'LIGAR DIA OFICIAL (+25%)')}
          </button>
        </div>
      </div>
    </>
  );
}

// ── MIGRAÇÃO: REMOVER TIMES (FIFA por @nick) ────────────────────────────────
// Reducer do doc apostas (json): zera teamPlayers pra um mapa IDENTIDADE
// {nick:nick} dos 8 jogadores. Idempotente. Mantém os ~164 sites que resolvem
// via teamPlayers/reverseTeamMap funcionando (agora identidade nick->nick).
function fifaMigrateTeamsToNicks(cur) {
  const tp = (cur && cur.teamPlayers) || {};
  // IDENTIDADE = os NICKS REAIS (valores do mapa) -> eles mesmos. NÃO usar os
  // teamIds: na vida real teamId != nick (ex.: potato->ivansf, caco->spider).
  const isIdentity = Object.keys(tp).length > 0 && Object.entries(tp).every(([k, v]) => k === v);
  if (isIdentity) return { __abort: true, result: { ok: true, alreadyDone: true } };
  const next = {};
  Object.values(tp).forEach(n => { if (n) next[n] = n; });
  return { next: { ...cur, teamPlayers: next } };
}
// Reescreve cs.rounds (doc state) trocando home/away de teamId->nick via o mapa
// ORIGINAL (teamId->nick). Idempotente (chave já-nick resolve pra si mesma).
// Honra a guarda transiente de !exists (NUNCA cria/seed aqui) e {merge:true}.
async function migrateStateRoundsTeamsToNicks(origTeamPlayers) {
  const ref = CLASSIF_DOC();
  return await window.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { err: 'doc state não existe (abortado, não cria)' };
    const data = snap.data();
    let state = {};
    if (typeof data.json === 'string') {
      try { state = JSON.parse(data.json); } catch (_) { return { err: 'json da classificação inválido' }; }
    }
    const rounds = Array.isArray(state.rounds) ? state.rounds : [];
    const nextRounds = rounds.map(r => (r || []).map(g => ({
      ...g,
      home: fifaUserOf(g.home, origTeamPlayers),
      away: fifaUserOf(g.away, origTeamPlayers),
    })));
    tx.set(ref, { json: JSON.stringify({ ...state, rounds: nextRounds }), updatedAt: Date.now() }, { merge: true });
    return { ok: true };
  });
}

function AdminView({ isFullAdmin, bets, users, adjustPc, adjustCc, grantAllPc, splitCurrency, ccCtx, teamPlayers, setTeamPlayer, discordWebhook, remoteNews, cs, worldcup, wcFixtures, onVoidBet }) {
  const [splitting, setSplitting] = useState(false);
  const handleSplit = async () => {
    if (splitting) return;
    if (!(await confirmModal({
      title: 'SEPARAR MOEDAS AGORA?',
      body: 'Devolve em PC o que cada um gastou na loja, remove os itens comprados (recompra com CC depois), mantém os drops de conquista e cria o saldo CC (zerado). Roda uma vez (idempotente).',
      confirmLabel: 'RODAR MIGRAÇÃO', danger: true,
    }))) return;
    setSplitting(true);
    try {
      const r = await splitCurrency();
      if (r && r.err) showToast('Erro na migração: ' + r.err, 'error');
      else showToast('Moedas separadas! PC devolvido a quem comprou; loja agora roda em Campeão Coins.', 'success');
    } finally { setSplitting(false); }
  };
  // Crédito manual de PC pra TODOS de uma vez (botão da aba USUÁRIOS).
  const [granting, setGranting] = useState(false);
  const handleGrantAll = async () => {
    if (granting) return;
    const n = Object.keys(users || {}).length;
    if (!(await confirmModal({
      title: 'DAR +1000 PC PRA TODOS?',
      body: 'Soma 1000 PC ao saldo de TODOS os ' + n + ' jogadores cadastrados. Isso é manual e some no histórico — cada clique credita de novo.',
      confirmLabel: 'CREDITAR +1000 A TODOS', danger: true,
    }))) return;
    setGranting(true);
    try {
      const r = await grantAllPc(1000);
      if (r && r.err) showToast('Erro: ' + r.err, 'error');
      else showToast('+1000 PC creditados pra todos os ' + n + ' jogadores!', 'success');
    } finally { setGranting(false); }
  };
  // REMOVER TIMES (migrar FIFA pra @nick). Deliberado (botão), idempotente.
  // Ordem: 1) reescreve cs.rounds com o mapa ORIGINAL (teamId->nick); 2) zera
  // teamPlayers pra identidade {nick:nick}. Faça backup antes (aba BACKUP).
  const [fifaMigrating, setFifaMigrating] = useState(false);
  const handleFifaMigration = async () => {
    if (fifaMigrating) return;
    const origTP = teamPlayers || {};
    const already = Object.keys(origTP).length > 0 && Object.entries(origTP).every(([k, v]) => k === v);
    if (!(await confirmModal({
      title: 'REMOVER TIMES — MIGRAR FIFA PRA @NICK?',
      body: already
        ? 'Parece que já está migrado (o mapa de times já é identidade). Rodar de novo é seguro (idempotente), mas não deve mudar nada.'
        : 'Reescreve os jogos da FIFA (classificação) trocando o time pelo @nick do jogador e zera o mapa de times pra identidade. Idempotente. FAÇA UM BACKUP ANTES na aba BACKUP e rode num momento calmo (sem ninguém lançando placar).',
      confirmLabel: 'MIGRAR FIFA', danger: true,
    }))) return;
    setFifaMigrating(true);
    try {
      const r1 = await migrateStateRoundsTeamsToNicks(origTP);
      if (!r1 || r1.err) { showToast('Falha na classificação: ' + ((r1 && r1.err) || 'desconhecida'), 'error'); return; }
      const r2 = await commitBetDocUpdate(fifaMigrateTeamsToNicks);
      if (r2 && r2.err) { showToast('Falha no doc de apostas: ' + r2.err, 'error'); return; }
      showToast('FIFA migrada pra @nick! Recarregue (Ctrl+Shift+R) pra confirmar.', 'success');
    } catch (e) {
      showToast('Erro na migração: ' + (e.message || e), 'error');
    } finally { setFifaMigrating(false); }
  };
  // Reset de senha: gera temporária de 6 chars, grava o hash e mostra a temp
  // pro admin repassar (a antiga para de valer na hora). O usuário troca
  // depois em MEU PERFIL → TROCAR SENHA.
  const resetPassword = async (nick) => {
    const ok = await confirmModal({
      title: 'RESETAR SENHA?',
      body: 'Gera uma senha temporária pra ' + nick + '. A senha antiga para de funcionar na hora.',
      confirmLabel: 'GERAR SENHA', danger: true,
    });
    if (!ok) return;
    const temp = Math.random().toString(36).replace(/[^a-z0-9]/g, '').slice(0, 6) || 'troca1';
    try {
      const senhaHash = await hashPassword(temp);
      const r = await commitBetDocUpdate(remote => {
        const u = (remote.users || {})[nick];
        if (!u) return { __abort: true, result: { err: 'Usuário não encontrado.' } };
        return { ...remote, users: { ...remote.users, [nick]: { ...u, senhaHash } } };
      });
      if (r && r.err) { showToast(r.err, 'error'); return; }
      await confirmModal({
        title: 'SENHA TEMPORÁRIA GERADA',
        body: nick + ' agora entra com a senha:  ' + temp + '  — manda pra ele e sugere trocar em MEU PERFIL → TROCAR SENHA.',
        confirmLabel: 'ANOTEI', infoOnly: true,
      });
    } catch (e) {
      showToast('Falha ao resetar senha: ' + (e.message || e), 'error');
    }
  };

  // Tabs do admin. Moderador vê: APOSTAS (anular) e BACKUP (restrito).
  // NEWS/JORNALISTA/USUÁRIOS/CATÁLOGO/DISCORD/PERIGO são só do admin full.
  // PERIGO ficou em aba separada pra não ser clicado por engano.
  const [tab, setTab] = useState(isFullAdmin ? 'usuarios' : 'apostas');
  const playerTeam = reverseTeamMap(teamPlayers);

  return (
    <>
      {!isFullAdmin && (
        <div className="mk-admin-note" style={{ marginBottom: 12 }}><Icon name="shield" size={12} /> Você é MODERADOR — lança placar e trava aposta. Operações de moeda e perigo ficam só com o admin.</div>
      )}
      <div className="tabs" style={{ marginBottom: 14 }}>
        <button className={'tab ' + (tab === 'apostas' ? 'active' : '')} onClick={() => setTab('apostas')}>APOSTAS</button>
        {isFullAdmin && <button className={'tab ' + (tab === 'usuarios' ? 'active' : '')} onClick={() => setTab('usuarios')}>USUÁRIOS</button>}
        {isFullAdmin && <button className={'tab ' + (tab === 'news' ? 'active' : '')} onClick={() => setTab('news')}>NEWS</button>}
        {isFullAdmin && <button className={'tab ' + (tab === 'jornalista' ? 'active' : '')} onClick={() => setTab('jornalista')}>JORNALISTA</button>}
        {isFullAdmin && <button className={'tab ' + (tab === 'catalogo' ? 'active' : '')} onClick={() => setTab('catalogo')}>CATÁLOGO</button>}
        {isFullAdmin && <button className={'tab ' + (tab === 'discord' ? 'active' : '')} onClick={() => setTab('discord')}>DISCORD</button>}
        <button className={'tab ' + (tab === 'backup' ? 'active' : '')} onClick={() => setTab('backup')}>BACKUP</button>
        {isFullAdmin && <button className={'tab ' + (tab === 'perigo' ? 'active' : '')} onClick={() => setTab('perigo')} style={{ color: tab === 'perigo' ? '#c33' : 'rgba(195,51,51,0.6)', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="warning" size={12} /> PERIGO</button>}
      </div>

      {tab === 'apostas' && <AdminBetsPanel bets={bets} users={users} teamPlayers={teamPlayers} cs={cs} onVoidBet={onVoidBet} />}
      {tab === 'news' && isFullAdmin && <NewsAdminPanel remoteNews={remoteNews} />}
      {tab === 'jornalista' && isFullAdmin && <JournalistAdminPanel cs={cs} bets={bets} users={users} teamPlayers={teamPlayers} worldcup={worldcup} wcFixtures={wcFixtures} />}
      {tab === 'catalogo' && isFullAdmin && <CatalogoAdminPanel cs={cs} teamPlayers={teamPlayers} />}
      {tab === 'discord' && isFullAdmin && <DiscordAdminPanel webhook={discordWebhook} />}

      {tab === 'usuarios' && isFullAdmin && (
        <div className="card">
          <div className="card-head"><div className="title">USUÁRIOS</div><div className="sub">{Object.keys(users).length} CADASTRADOS</div></div>
          <div className="card-body">
            <div style={{ marginBottom: 14, padding: 12, border: '2px solid var(--pv-green, #2a8f3f)', background: 'rgba(42,143,63,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 12, letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="coin" size={14} /> DAR +1000 PC PRA TODOS</div>
                <div style={{ fontSize: 11, color: 'rgba(28,22,18,0.7)', lineHeight: 1.4, marginTop: 4 }}>
                  Credita 1000 PC pra cada um dos {Object.keys(users).length} jogadores. Manual — cada clique soma de novo.
                </div>
              </div>
              <button onClick={handleGrantAll} disabled={granting} style={{ background: 'var(--pv-green, #2a8f3f)', color: 'var(--pv-bone)', border: 'none', padding: '10px 16px', fontWeight: 800, fontSize: 12, letterSpacing: '0.1em', cursor: granting ? 'wait' : 'pointer', flexShrink: 0 }}>
                {granting ? 'CREDITANDO…' : '+1000 PRA TODOS'}
              </button>
            </div>
            <div style={{ marginBottom: 14, padding: 12, border: '2px solid var(--pv-orange)', background: 'rgba(215,100,20,0.08)' }}>
              <div style={{ fontWeight: 800, fontSize: 12, letterSpacing: '0.06em' }}>SEPARAR MOEDAS — PC (apostas) × CAMPEÃO COINS (loja)</div>
              <div style={{ fontSize: 11, color: 'rgba(28,22,18,0.7)', lineHeight: 1.4, margin: '6px 0 10px' }}>
                Roda UMA vez: devolve em PC o que cada um gastou na loja, remove os itens comprados (pra recomprar com CC), mantém os drops de conquista e cria o saldo CC (zerado). Idempotente — rodar de novo não duplica.
              </div>
              <button onClick={handleSplit} disabled={splitting} style={{ background: 'var(--pv-charcoal)', color: 'var(--pv-bone)', border: 'none', padding: '8px 16px', fontWeight: 800, fontSize: 12, letterSpacing: '0.12em', cursor: splitting ? 'wait' : 'pointer' }}>
                {splitting ? 'RODANDO…' : 'RODAR MIGRAÇÃO'}
              </button>
            </div>
            <div style={{ marginBottom: 14, padding: 12, border: '2px solid var(--pv-orange)', background: 'rgba(215,100,20,0.08)' }}>
              <div style={{ fontWeight: 800, fontSize: 12, letterSpacing: '0.06em' }}>REMOVER TIMES — FIFA POR @NICK</div>
              <div style={{ fontSize: 11, color: 'rgba(28,22,18,0.7)', lineHeight: 1.4, margin: '6px 0 10px' }}>
                Reescreve os jogos da FIFA trocando o time pelo @nick do jogador e zera o mapa de times pra identidade. Idempotente. FAÇA UM BACKUP ANTES (aba BACKUP) e rode num momento calmo.
              </div>
              <button onClick={handleFifaMigration} disabled={fifaMigrating} style={{ background: 'var(--pv-orange)', color: 'var(--pv-bone)', border: 'none', padding: '8px 16px', fontWeight: 800, fontSize: 12, letterSpacing: '0.12em', cursor: fifaMigrating ? 'wait' : 'pointer' }}>
                {fifaMigrating ? 'MIGRANDO…' : 'MIGRAR FIFA'}
              </button>
            </div>
            {Object.entries(users).map(([nick, u]) => {
              return (
                <div key={nick} className="lb-row" style={{ gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
                  <div>
                    <div className="lb-nick">{nick}</div>
                    <button type="button" className="admin-reset-pass" onClick={() => resetPassword(nick)}>
                      <Icon name="lock" size={11} /> RESETAR SENHA
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <CoinAdjuster label="PC" value={u.pc || 0} onApply={(d) => adjustPc(nick, d)} />
                    <CoinAdjuster label="CC" accent value={ccBalanceFor(nick, u, ccCtx)} onApply={(d) => adjustCc(nick, d)} />
                  </div>
                </div>
              );
            })}
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
            <Icon name="check" size={14} /> Backup baixado: {status.users} usuários, {status.bets} apostas, {status.wcPicks || 0} palpites da Copa ({status.wcResults || 0} resultados), {status.news || 0} news, {status.titles || 0} c/ título, {status.cosmetics || 0} c/ cosmético equipado, {status.inventory || 0} c/ inventário, {status.avatars || 0} c/ foto.
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
    const ok = await confirmModal({
      title: 'RESTAURAR BACKUP?',
      body: 'Vai SOBRESCREVER o estado atual com o conteúdo do backup. Um backup de segurança do estado ATUAL é baixado antes (caso queira voltar).',
      confirmLabel: 'RESTAURAR', danger: true,
    });
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
    <div className="card" style={{ marginTop: 20, border: '2px solid var(--pv-red-bright)' }}>
      <div className="card-head" style={{ background: 'var(--pv-red-deep)' }}>
        <div className="title" style={{ color: 'var(--pv-red-soft)', display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="warning" size={16} /> ZONA DE PERIGO</div>
        <div className="sub" style={{ color: 'var(--pv-red-soft)' }}>OPERAÇÃO IRREVERSÍVEL</div>
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
          Pra confirmar, digite <code style={{ background: 'var(--pv-charcoal)', padding: '2px 6px', color: 'var(--pv-red-soft)' }}>{WIPE_CONFIRM_PHRASE}</code> no campo abaixo:
        </p>
        <input
          type="text"
          value={confirmText}
          onChange={e => setConfirmText(e.target.value)}
          placeholder={WIPE_CONFIRM_PHRASE}
          disabled={status === 'running'}
          style={{ width: '100%', maxWidth: 280, padding: '8px 12px', fontSize: 14, fontFamily: 'monospace', border: '1.5px solid var(--pv-red-bright)', background: 'var(--pv-red-deep)', color: 'var(--pv-red-soft)', marginBottom: 12, letterSpacing: '0.1em' }}
        />
        <div>
          <button
            onClick={onClick}
            disabled={!canFire}
            style={{
              background: canFire ? 'var(--pv-red-bright)' : '#5a2a2a',
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
