// =============================================================================
// PRIMICORD — a central de voz dos primitivos
// =============================================================================
// Discord caseiro do grupo: salas persistentes com voz em grupo, compartilhar
// tela e clipes dos últimos segundos. Vanilla JS (sem build), GH Pages.
//
// ARQUITETURA
//   - Áudio/vídeo: WebRTC em MALHA (P2P todo-mundo-com-todo-mundo). Pro nosso
//     tamanho de grupo (<10) malha aguenta bem e não precisa de servidor.
//   - Signaling: Firestore (coleção rtc_rooms — ver firestore.rules).
//       rtc_rooms/{roomId}                 { name, createdBy, createdAt }
//       rtc_rooms/{roomId}/peers/{peerId}  presença: { nick, joinedAt, lastSeen,
//                                            muted, sharing, voiceSid, shareSid }
//       rtc_rooms/{roomId}/mail/{de__para} caixa de sinalização DIRECIONAL:
//                                            { msgs: [{i,t:'sdp'|'ice',d,at}] }
//       rtc_rooms/{roomId}/chat/{autoId}   { nick, text, at }
//   - Negociação: "perfect negotiation" (MDN) — os dois lados podem ofertar,
//     o lado "polite" faz rollback em caso de colisão. Isso permite renegociar
//     ao vivo (ligar/desligar tela) sem derrubar a chamada.
//   - Clipes: 2 MediaRecorders defasados (janela ~90s, defasagem 45s) gravando
//     a tela em foco + mix de TODAS as vozes. CLIPE = blob do recorder mais
//     antigo → download local (45–90s de buffer garantido após aquecer).
//
// A sessão do app de apostas (localStorage pv-bet-session) é reaproveitada
// pro nick — mesma origem no GH Pages.
// =============================================================================

(() => {
'use strict';

console.log('%c PRIMICORD v=20260729-1 ', 'background:#d76414;color:#1c1612;font-weight:bold');

// ─── CONSTANTES ──────────────────────────────────────────────────────────────
const ROOMS_COL       = 'rtc_rooms';
const SESSION_KEY     = 'pv-bet-session';   // sessão do app de apostas (mesma origem)
const GUEST_NICK_KEY  = 'pc-guest-nick';
const HEARTBEAT_MS    = 20 * 1000;          // presença: atualiza lastSeen
const STALE_MS        = 90 * 1000;          // sem heartbeat há 90s = saiu
const JANITOR_MS      = 10 * 60 * 1000;     // docs mais velhos que isso = lixo
const CLIP_WINDOW_MS  = 90 * 1000;          // janela do buffer rolante de clipe

// STUN público do Google + TURN público best-effort (Open Relay). Se o TURN
// estiver fora, a maioria das redes domésticas ainda conecta só com STUN.
const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turns:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

const FV = () => firebase.firestore.FieldValue;
const roomsCol = () => window.db.collection(ROOMS_COL);

// ─── ESTADO ─────────────────────────────────────────────────────────────────
const S = {
  nick: null,
  peerId: null,             // por sessão: nick-xxxx (permite 2 abas do mesmo nick)
  roomId: null,
  roomName: null,
  micStream: null,          // stream do microfone (null = modo só-ouvir)
  muted: false,
  shareStream: null,        // minha tela compartilhada
  links: new Map(),         // peerId -> link (pc + signaling + mídia)
  peersInfo: new Map(),     // peerId -> dados de presença
  focusedShare: null,       // 'me' | peerId | null — tela no palco
  clipper: null,            // buffer rolante da tela em foco
  manualRec: null,          // gravação manual em andamento
  avatars: {},              // nickLower -> dataUrl (doc primitivao/avatars)
  unsub: [],                // listeners da sala (desinscreve ao sair)
  lobbyUnsub: [],
  timers: [],
  audioCtx: null,
  mixDest: null,            // destino do mix de áudio (pros clipes)
  mixNodes: new Map(),      // streamId -> sourceNode (pra desconectar)
  analysers: new Map(),     // peerId -> {analyser, data} (detecção de fala)
  tileEls: new Map(),       // peerId -> elemento do tile
  chatOpen: false,
  rulesBlocked: false,      // escrita negada → rules não publicadas ainda
};

// ─── ÍCONES (SVG lineart 24x24 — REGRA DO PROJETO: nada de emoji) ───────────
const ICONS = {
  mic:        '<path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  'mic-off':  '<path d="M15 9V6a3 3 0 0 0-5.7-1.3M9 9v3a3 3 0 0 0 5 2.2"/><path d="M5 11a7 7 0 0 0 11.6 5.2M19 11a7 7 0 0 1-.4 2.3"/><path d="M12 18v3"/><path d="M4 4l16 16"/>',
  screen:     '<rect x="3" y="4" width="18" height="13" rx="1"/><path d="M8 21h8M12 17v4"/>',
  'screen-off':'<rect x="3" y="4" width="18" height="13" rx="1"/><path d="M8 21h8M12 17v4"/><path d="M5 6l14 9"/>',
  scissors:   '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8.2 7.6 20 18M8.2 16.4 20 6"/>',
  record:     '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/>',
  stop:       '<rect x="7" y="7" width="10" height="10"/>',
  chat:       '<path d="M4 5h16v11H9l-5 4z"/>',
  plus:       '<path d="M12 5v14M5 12h14"/>',
  x:          '<path d="M6 6l12 12M18 6L6 18"/>',
  exit:       '<path d="M9 4H5v16h4"/><path d="M13 8l4 4-4 4M17 12H8"/>',
  link:       '<path d="M9 15l6-6"/><path d="M10.5 7.5 12 6a3.5 3.5 0 0 1 5 5l-1.5 1.5M13.5 16.5 12 18a3.5 3.5 0 0 1-5-5l1.5-1.5"/>',
  users:      '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M16.5 14.6c2.6.4 4.5 2.7 4.5 5.4"/>',
  arrowright: '<path d="M4 12h16M13 5l7 7-7 7"/>',
  warning:    '<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18v.5"/>',
  trash:      '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/>',
  eye:        '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/>',
};
function icon(name, size = 18) {
  return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
}

// ─── HELPERS DOM ────────────────────────────────────────────────────────────
const $app = () => document.getElementById('app');
function el(tag, attrs, ...children) {
  const n = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}

let toastHost = null;
function toast(msg, kind) {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = el('div', { class: 'pc-toasts' });
    document.body.appendChild(toastHost);
  }
  const t = el('div', { class: 'pc-toast' + (kind === 'error' ? ' err' : '') }, msg);
  toastHost.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

// Escrita negada = rules do rtc_rooms ainda não publicadas no Firebase Console.
function handleWriteError(e) {
  console.warn('[primicord] escrita negada:', e);
  if (e && (e.code === 'permission-denied' || String(e).includes('permission'))) {
    if (!S.rulesBlocked) {
      S.rulesBlocked = true;
      const b = el('div', { class: 'pc-banner' },
        'O FIRESTORE RECUSOU A ESCRITA — as rules do namespace rtc_rooms ainda não foram publicadas no Firebase Console (arquivo firestore.rules do repo).');
      document.body.prepend(b);
    }
    toast('Sem permissão no Firestore (rules pendentes)', 'error');
    return true;
  }
  return false;
}

function fmtTime(ms) {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function slugify(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'sala';
}
function randId(n) {
  return Math.random().toString(36).slice(2, 2 + n);
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// ─── SESSÃO / NICK ──────────────────────────────────────────────────────────
function sessionNick() {
  try {
    const v = localStorage.getItem(SESSION_KEY);
    if (v) { const s = JSON.parse(v); if (s && s.nick) return String(s.nick); }
  } catch (e) {}
  try { return localStorage.getItem(GUEST_NICK_KEY) || null; } catch (e) { return null; }
}

async function loadAvatars() {
  try {
    const snap = await window.db.doc('primitivao/avatars').get();
    if (snap.exists) S.avatars = snap.data() || {};
  } catch (e) { /* leitura pública; se falhar segue sem foto */ }
}
function avatarEl(nick, size) {
  const url = S.avatars[String(nick).toLowerCase()];
  const wrap = el('div', { class: 'ava', style: 'width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.46) + 'px' });
  if (url) wrap.appendChild(el('img', { src: url, alt: '' }));
  else { wrap.classList.add('display'); wrap.textContent = String(nick).charAt(0).toUpperCase(); }
  return wrap;
}

// ═══════════════════════════════════════════════════════════════════════════
// GATE — identificação
// ═══════════════════════════════════════════════════════════════════════════
function renderGate() {
  const known = sessionNick();
  const root = $app();
  root.innerHTML = '';

  const input = el('input', { class: 'pc-input', maxlength: '20', placeholder: 'seu nick do Primitivão', value: known || '' });
  const enter = () => {
    const nick = input.value.trim().replace(/^@+/, '');
    if (!nick) { toast('Digita um nick primeiro', 'error'); return; }
    try { localStorage.setItem(GUEST_NICK_KEY, nick); } catch (e) {}
    S.nick = nick;
    renderLobby();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') enter(); });

  root.appendChild(el('div', { class: 'pc-masthead' },
    el('div', { class: 'kicker' }, 'A CENTRAL DE VOZ DOS PRIMITIVOS'),
    el('h1', { class: 'display' }, 'PRIMICORD'),
    el('div', { class: 'sub' }, 'SALAS DE VOZ · TELA AO VIVO · CLIPES')));

  root.appendChild(el('div', { class: 'pc-gate' },
    el('div', { class: 'pc-card' },
      el('div', { class: 'title display' }, 'QUEM FALA?'),
      el('div', { class: 'hint' }, known
        ? 'Reconheci sua sessão do Primitivão. Confirma o nick e entra.'
        : 'Usa o mesmo nick do app de apostas pra puxar sua foto.'),
      el('label', { class: 'pc-label' }, 'NICK'),
      input,
      el('div', { style: 'margin-top:16px' },
        el('button', { class: 'pc-btn wide', onclick: enter, html: 'ENTRAR ' + icon('arrowright', 14) })))));

  root.appendChild(el('div', { class: 'pc-footer' }, 'PRIMITIVÃO 2026 · P2P · SEM SERVIDOR · SEM FRESCURA'));
  input.focus();
}

// ═══════════════════════════════════════════════════════════════════════════
// LOBBY — lista de salas
// ═══════════════════════════════════════════════════════════════════════════
function stopLobby() {
  S.lobbyUnsub.forEach(u => { try { u(); } catch (e) {} });
  S.lobbyUnsub = [];
}

function renderLobby() {
  stopLobby();
  const root = $app();
  root.innerHTML = '';

  const trocar = el('button', {
    class: 'pc-btn ghost sm', style: 'margin-left:10px;vertical-align:middle',
    onclick: () => { S.nick = null; try { localStorage.removeItem(GUEST_NICK_KEY); } catch (e) {} stopLobby(); renderGate(); },
  }, 'TROCAR');
  root.appendChild(el('div', { class: 'pc-masthead' },
    el('div', { class: 'kicker' }, 'A CENTRAL DE VOZ DOS PRIMITIVOS'),
    el('h1', { class: 'display' }, 'PRIMICORD'),
    el('div', { class: 'sub' }, 'LOGADO COMO ' + S.nick.toUpperCase(), trocar)));

  const lobby = el('div', { class: 'pc-lobby' });
  root.appendChild(lobby);

  // criar sala
  const nameInput = el('input', { class: 'pc-input', maxlength: '28', placeholder: 'nome da sala (ex: RANQUEADA, RESENHA...)' });
  const createRoom = async () => {
    const name = nameInput.value.trim();
    if (!name) { toast('Dá um nome pra sala', 'error'); return; }
    const id = slugify(name) + '-' + randId(4);
    try {
      await roomsCol().doc(id).set({
        name: name.toUpperCase(),
        createdBy: S.nick,
        createdAt: FV().serverTimestamp(),
      });
      nameInput.value = '';
      joinRoom(id, name.toUpperCase());
    } catch (e) { if (!handleWriteError(e)) toast('Não consegui criar a sala', 'error'); }
  };
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') createRoom(); });

  lobby.appendChild(el('div', { class: 'pc-section-label' }, 'ABRIR SALA NOVA'));
  lobby.appendChild(el('div', { class: 'pc-newroom' },
    nameInput,
    el('button', { class: 'pc-btn', onclick: createRoom, html: icon('plus', 14) + ' CRIAR' })));

  lobby.appendChild(el('div', { class: 'pc-section-label' }, 'SALAS'));
  const list = el('div', {});
  lobby.appendChild(list);

  root.appendChild(el('div', { class: 'pc-footer' }, 'DICA: COMPARTILHAR TELA FUNCIONA NO PC · NO CELULAR DÁ PRA OUVIR, FALAR E ASSISTIR'));

  const roomPeers = new Map(); // roomId -> [{nick,...}]
  const roomDocs = new Map();  // roomId -> data

  const redraw = () => {
    list.innerHTML = '';
    if (roomDocs.size === 0) {
      list.appendChild(el('div', { class: 'pc-empty' }, 'Nenhuma sala ainda. Abre a primeira aí em cima.'));
      return;
    }
    for (const [id, data] of roomDocs) {
      const peers = (roomPeers.get(id) || []).filter(p => Date.now() - (p.lastSeen || 0) < STALE_MS);
      const occ = el('div', { class: 'occupants' });
      peers.forEach(p => occ.appendChild(el('span', { class: 'pc-chip' },
        el('span', { class: 'dot' }), p.nick)));

      const left = el('div', {},
        el('div', { class: 'rname display' }, data.name || id),
        el('div', { class: 'rmeta' }, peers.length
          ? peers.length + ' na sala agora'
          : 'vazia · criada por ' + (data.createdBy || '?')),
        peers.length ? occ : null);

      const right = el('div', { class: 'right' });
      if (!peers.length) {
        right.appendChild(el('button', {
          class: 'pc-btn ghost sm', title: 'Excluir sala',
          onclick: (ev) => { ev.stopPropagation(); deleteRoom(id, data.name || id); },
          html: icon('trash', 14),
        }));
      }
      right.appendChild(el('button', {
        class: 'pc-btn sm',
        onclick: () => joinRoom(id, data.name || id),
        html: 'ENTRAR ' + icon('arrowright', 12),
      }));

      list.appendChild(el('div', { class: 'pc-room' }, left, right));
    }
  };

  const peerSubs = new Map();
  S.lobbyUnsub.push(roomsCol().orderBy('createdAt', 'asc').onSnapshot((snap) => {
    const seen = new Set();
    snap.forEach(doc => {
      seen.add(doc.id);
      roomDocs.set(doc.id, doc.data());
      if (!peerSubs.has(doc.id)) {
        const u = roomsCol().doc(doc.id).collection('peers').onSnapshot((ps) => {
          roomPeers.set(doc.id, ps.docs.map(d => d.data()));
          redraw();
        }, () => {});
        peerSubs.set(doc.id, u);
        S.lobbyUnsub.push(u);
      }
    });
    for (const id of [...roomDocs.keys()]) if (!seen.has(id)) { roomDocs.delete(id); roomPeers.delete(id); }
    redraw();
  }, (err) => {
    console.warn('[primicord] lobby snapshot err:', err);
    list.innerHTML = '';
    list.appendChild(el('div', { class: 'pc-empty' },
      'Não consegui ler as salas — provavelmente as rules do rtc_rooms ainda não foram publicadas no Firebase Console.'));
  }));

  // link direto #sala=xxx
  const m = location.hash.match(/sala=([a-z0-9-]+)/);
  if (m) {
    history.replaceState(null, '', location.pathname);
    roomsCol().doc(m[1]).get().then((d) => {
      if (d.exists) joinRoom(m[1], (d.data() || {}).name || m[1]);
      else toast('Essa sala não existe mais', 'error');
    }).catch(() => {});
  }
}

async function deleteRoom(id, name) {
  if (!confirm('Excluir a sala "' + name + '"? O histórico de chat some junto.')) return;
  try {
    const ref = roomsCol().doc(id);
    for (const sub of ['peers', 'mail', 'chat']) {
      const docs = await ref.collection(sub).limit(400).get();
      const batch = window.db.batch();
      docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    await ref.delete();
    toast('Sala excluída');
  } catch (e) { if (!handleWriteError(e)) toast('Não consegui excluir', 'error'); }
}

// ═══════════════════════════════════════════════════════════════════════════
// SALA — voz + tela + clipes
// ═══════════════════════════════════════════════════════════════════════════
const roomRef  = () => roomsCol().doc(S.roomId);
const presRef  = () => roomRef().collection('peers').doc(S.peerId);
const mailOut  = (them) => roomRef().collection('mail').doc(S.peerId + '__' + them);
const mailIn   = (them) => roomRef().collection('mail').doc(them + '__' + S.peerId);

async function joinRoom(roomId, roomName) {
  stopLobby();
  S.roomId = roomId;
  S.roomName = roomName;
  S.peerId = slugify(S.nick) + '-' + randId(5);

  // microfone — se negar, entra em modo só-ouvir
  try {
    S.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) {
    S.micStream = null;
    toast('Sem microfone — você entrou em modo só-ouvir', 'error');
  }

  // mix de áudio (pros clipes) + análise de fala
  try {
    S.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    S.audioCtx.resume();
    S.mixDest = S.audioCtx.createMediaStreamDestination();
    if (S.micStream) mixAttach(S.micStream);
    if (S.micStream) analyserAttach('me', S.micStream);
  } catch (e) { console.warn('[primicord] sem AudioContext:', e); }

  // presença
  try {
    await presRef().set({
      nick: S.nick,
      joinedAt: FV().serverTimestamp(),
      lastSeen: Date.now(),
      muted: !S.micStream,
      sharing: false,
      voiceSid: S.micStream ? S.micStream.id : null,
      shareSid: null,
    });
  } catch (e) {
    if (!handleWriteError(e)) toast('Não consegui entrar na sala', 'error');
    leaveRoom(true);
    return;
  }

  janitor().catch(() => {});

  renderRoomView();

  // heartbeat de presença
  S.timers.push(setInterval(() => {
    presRef().set({ lastSeen: Date.now() }, { merge: true }).catch(() => {});
  }, HEARTBEAT_MS));

  // poda links de peers que sumiram sem despedida (heartbeat velho)
  S.timers.push(setInterval(() => {
    for (const [pid, info] of S.peersInfo) {
      if (Date.now() - (info.lastSeen || 0) > STALE_MS) { S.peersInfo.delete(pid); dropLink(pid); }
    }
    rebuildTiles();
  }, 30 * 1000));

  // presença dos outros → cria/derruba conexões
  S.unsub.push(roomRef().collection('peers').onSnapshot((snap) => {
    const alive = new Set();
    snap.forEach(doc => {
      if (doc.id === S.peerId) return;
      const info = doc.data();
      if (Date.now() - (info.lastSeen || 0) > STALE_MS) return;
      alive.add(doc.id);
      S.peersInfo.set(doc.id, info);
      ensureLink(doc.id);
      evaluateStreams(doc.id);
    });
    for (const pid of [...S.links.keys()]) {
      if (!alive.has(pid)) { S.peersInfo.delete(pid); dropLink(pid); }
    }
    autoFocusShare();
    rebuildTiles();
  }, (err) => console.warn('[primicord] peers snapshot err:', err)));

  // chat
  S.unsub.push(roomRef().collection('chat').orderBy('at', 'asc').limitToLast(80)
    .onSnapshot((snap) => {
      const box = document.querySelector('.pc-chat .cmsgs');
      if (!box) return;
      box.innerHTML = '';
      snap.forEach(doc => {
        const c = doc.data();
        const at = c.at && c.at.toMillis ? c.at.toMillis() : Date.now();
        box.appendChild(el('div', { class: 'pc-cmsg' },
          el('span', { class: 'cnick' }, c.nick || '?'),
          String(c.text || ''),
          el('span', { class: 'ctime mono' }, fmtTime(at))));
      });
      box.scrollTop = box.scrollHeight;
    }, () => {}));

  // saída suja (fechar aba) — melhor esforço
  window.addEventListener('pagehide', onPageHide);
}

function onPageHide() { leaveRoom(true); }

// Limpa lixo de sessões antigas (peers sem heartbeat, mail órfão).
async function janitor() {
  const now = Date.now();
  const peers = await roomRef().collection('peers').get();
  const aliveIds = new Set();
  const batch = window.db.batch();
  let dirty = false;
  peers.forEach(d => {
    const ls = (d.data() || {}).lastSeen || 0;
    if (now - ls > JANITOR_MS) { batch.delete(d.ref); dirty = true; }
    else aliveIds.add(d.id);
  });
  const mail = await roomRef().collection('mail').get();
  mail.forEach(d => {
    const [from, to] = d.id.split('__');
    if (!aliveIds.has(from) || !aliveIds.has(to)) { batch.delete(d.ref); dirty = true; }
  });
  if (dirty) await batch.commit().catch(() => {});
}

// ─── LINK P2P (um por colega de sala) ───────────────────────────────────────
function ensureLink(them) {
  if (S.links.has(them)) return S.links.get(them);

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const link = {
    them, pc,
    polite: S.peerId > them,   // desempate determinístico do perfect negotiation
    makingOffer: false,
    ignoreOffer: false,
    seq: 0,
    readIdx: 0,
    q: Promise.resolve(),      // fila: processa signaling em ordem
    streams: new Map(),        // streamId -> MediaStream recebida
    voiceEl: null,
    shareSenders: [],
  };
  S.links.set(them, link);

  if (S.micStream) S.micStream.getTracks().forEach(t => pc.addTrack(t, S.micStream));
  if (S.shareStream) link.shareSenders = S.shareStream.getTracks().map(t => pc.addTrack(t, S.shareStream));

  pc.onnegotiationneeded = async () => {
    try {
      link.makingOffer = true;
      await pc.setLocalDescription();
      sendMail(link, { t: 'sdp', d: JSON.stringify(pc.localDescription) });
    } catch (e) { console.warn('[primicord] negotiation err:', e); }
    finally { link.makingOffer = false; }
  };
  pc.onicecandidate = ({ candidate }) => {
    sendMail(link, { t: 'ice', d: JSON.stringify(candidate) });
  };
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed') { try { pc.restartIce(); } catch (e) {} }
    updateTileConn(them);
  };
  pc.onconnectionstatechange = () => updateTileConn(them);
  pc.ontrack = (ev) => {
    (ev.streams || []).forEach(st => {
      link.streams.set(st.id, st);
      st.onremovetrack = () => { evaluateStreams(them); autoFocusShare(); };
    });
    evaluateStreams(them);
    autoFocusShare();
  };

  // caixa de entrada de signaling deste par
  link.mailUnsub = mailIn(them).onSnapshot((snap) => {
    const msgs = (snap.exists && (snap.data() || {}).msgs) || [];
    while (link.readIdx < msgs.length) {
      const m = msgs[link.readIdx++];
      link.q = link.q.then(() => handleSignal(link, m)).catch(e => console.warn('[primicord] signal err:', e));
    }
  }, () => {});
  S.unsub.push(link.mailUnsub);

  return link;
}

function sendMail(link, msg) {
  mailOut(link.them).set({
    msgs: FV().arrayUnion({ i: link.seq++, at: Date.now(), ...msg }),
  }, { merge: true }).catch(handleWriteError);
}

// Perfect negotiation (MDN) — ambos os lados podem ofertar; o polite recua.
async function handleSignal(link, m) {
  const pc = link.pc;
  if (m.t === 'sdp') {
    const desc = JSON.parse(m.d);
    if (!desc) return;
    const collision = desc.type === 'offer' && (link.makingOffer || pc.signalingState !== 'stable');
    link.ignoreOffer = !link.polite && collision;
    if (link.ignoreOffer) return;
    await pc.setRemoteDescription(desc);
    if (desc.type === 'offer') {
      await pc.setLocalDescription();
      sendMail(link, { t: 'sdp', d: JSON.stringify(pc.localDescription) });
    }
  } else if (m.t === 'ice') {
    const cand = JSON.parse(m.d);
    if (!cand) return;
    try { await pc.addIceCandidate(cand); }
    catch (e) { if (!link.ignoreOffer) console.warn('[primicord] ICE err:', e); }
  }
}

function dropLink(them) {
  const link = S.links.get(them);
  if (!link) return;
  S.links.delete(them);
  try { link.mailUnsub && link.mailUnsub(); } catch (e) {}
  try { link.pc.close(); } catch (e) {}
  if (link.voiceEl) { link.voiceEl.remove(); link.voiceEl = null; }
  for (const [sid] of link.streams) mixDetach(sid);
  analyserDetach(them);
  mailOut(them).delete().catch(() => {});
  mailIn(them).delete().catch(() => {});
  if (S.focusedShare === them) { S.focusedShare = null; autoFocusShare(); }
}

// Decide o papel de cada stream recebida (voz vs tela) usando os stream ids
// publicados na presença do peer (voiceSid/shareSid).
function evaluateStreams(them) {
  const link = S.links.get(them);
  const info = S.peersInfo.get(them);
  if (!link || !info) return;

  for (const [sid, st] of link.streams) {
    if (st.getTracks().length === 0) { link.streams.delete(sid); mixDetach(sid); continue; }

    if (sid === info.voiceSid) {
      if (!link.voiceEl) {
        link.voiceEl = el('audio', { autoplay: '', playsinline: '' });
        link.voiceEl.srcObject = st;
        hiddenAudioHost().appendChild(link.voiceEl);
        link.voiceEl.play().catch(() => {});
        mixAttach(st);
        analyserAttach(them, st);
      }
    } else if (sid === info.shareSid) {
      mixAttach(st); // áudio do jogo entra no mix dos clipes
    }
  }
  // tela do peer = stream cujo id ele publicou como shareSid (se ainda existe)
  link.shareStream = (info.sharing && info.shareSid && link.streams.get(info.shareSid)) || null;
  syncStage();
}

function updateTileConn(them) {
  const tile = S.tileEls.get(them);
  if (!tile) return;
  const link = S.links.get(them);
  const st = link ? link.pc.connectionState : 'new';
  const lbl = tile.querySelector('.conn');
  if (!lbl) return;
  if (st === 'connected') { lbl.textContent = ''; lbl.classList.remove('bad'); }
  else if (st === 'failed' || st === 'disconnected') { lbl.textContent = 'RECONECTANDO'; lbl.classList.add('bad'); }
  else { lbl.textContent = 'CONECTANDO'; lbl.classList.remove('bad'); }
}

// ─── MIX DE ÁUDIO + DETECÇÃO DE FALA ────────────────────────────────────────
function mixAttach(stream) {
  if (!S.audioCtx || !S.mixDest || S.mixNodes.has(stream.id)) return;
  if (stream.getAudioTracks().length === 0) return;
  try {
    const src = S.audioCtx.createMediaStreamSource(stream);
    src.connect(S.mixDest);
    S.mixNodes.set(stream.id, src);
  } catch (e) {}
}
function mixDetach(sid) {
  const n = S.mixNodes.get(sid);
  if (n) { try { n.disconnect(); } catch (e) {} S.mixNodes.delete(sid); }
}
function analyserAttach(pid, stream) {
  if (!S.audioCtx || S.analysers.has(pid)) return;
  if (stream.getAudioTracks().length === 0) return;
  try {
    const an = S.audioCtx.createAnalyser();
    an.fftSize = 512;
    S.audioCtx.createMediaStreamSource(stream).connect(an);
    S.analysers.set(pid, { an, data: new Uint8Array(an.fftSize) });
  } catch (e) {}
}
function analyserDetach(pid) { S.analysers.delete(pid); }

function speakingLoop() {
  for (const [pid, { an, data }] of S.analysers) {
    an.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) { const v = (data[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / (data.length / 4));
    const tile = S.tileEls.get(pid);
    if (tile) {
      const speaking = rms > 0.045 && !(pid === 'me' && S.muted);
      tile.classList.toggle('speaking', speaking);
    }
  }
}

let hiddenHost = null;
function hiddenAudioHost() {
  if (!hiddenHost || !hiddenHost.isConnected) {
    hiddenHost = el('div', { style: 'position:fixed;left:-9999px;top:0' });
    document.body.appendChild(hiddenHost);
  }
  return hiddenHost;
}

// ─── UI DA SALA ─────────────────────────────────────────────────────────────
function renderRoomView() {
  const root = $app();
  root.innerHTML = '';

  const stageVideo = el('video', { autoplay: '', playsinline: '' });
  const stage = el('div', { class: 'pc-stage', id: 'pc-stage' },
    el('div', { class: 'stage-tag display', id: 'stage-tag' }, ''),
    el('div', { class: 'stage-buffer mono', id: 'stage-buffer' }, ''),
    stageVideo);

  const tiles = el('div', { class: 'pc-tiles', id: 'pc-tiles' });

  const chatInput = el('input', { maxlength: '300', placeholder: 'manda a braba...' });
  const sendChat = () => {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    roomRef().collection('chat').add({ nick: S.nick, text, at: FV().serverTimestamp() })
      .catch(handleWriteError);
  };
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

  const chat = el('div', { class: 'pc-chat', id: 'pc-chat' },
    el('div', { class: 'chead' },
      el('span', { html: icon('chat', 14) }), 'CHAT DA SALA',
      el('button', {
        class: 'pc-btn ghost sm', style: 'margin-left:auto;display:none', id: 'chat-close',
        onclick: () => toggleChat(false), html: icon('x', 12),
      })),
    el('div', { class: 'cmsgs' }),
    el('div', { class: 'cform' },
      chatInput,
      el('button', { onclick: sendChat, html: icon('arrowright', 18) })));

  const copyLink = async () => {
    const url = location.origin + location.pathname + '#sala=' + S.roomId;
    try { await navigator.clipboard.writeText(url); toast('Link da sala copiado'); }
    catch (e) { prompt('Copia o link da sala:', url); }
  };

  root.appendChild(el('div', { class: 'pc-roomview' },
    el('div', { class: 'pc-topbar' },
      el('span', { class: 'logo display' }, 'PRIMICORD'),
      el('span', { class: 'roomname' }, S.roomName),
      el('div', { class: 'right' },
        el('button', { class: 'pc-btn ghost sm', onclick: copyLink, title: 'Copiar link da sala', html: icon('link', 14) }),
        el('button', { class: 'pc-btn ghost sm chat-toggle', onclick: () => toggleChat(true), title: 'Chat', html: icon('chat', 14) }))),
    el('div', { class: 'pc-main' },
      el('div', { class: 'pc-stagewrap' }, stage, tiles),
      chat),
    buildControls()));

  rebuildTiles();

  // loops de UI
  S.timers.push(setInterval(speakingLoop, 150));
  S.timers.push(setInterval(updateBufferLabel, 1000));
}

function toggleChat(open) {
  const chat = document.getElementById('pc-chat');
  const close = document.getElementById('chat-close');
  if (!chat) return;
  chat.classList.toggle('open', open);
  if (close) close.style.display = open ? '' : 'none';
}

function buildControls() {
  const canShare = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

  const micBtn = el('button', { class: 'pc-ctl', id: 'ctl-mic', onclick: toggleMute });
  const shareBtn = canShare
    ? el('button', { class: 'pc-ctl', id: 'ctl-share', onclick: toggleShare })
    : null;
  const clipBtn = el('button', { class: 'pc-ctl', id: 'ctl-clip', onclick: makeClip, title: 'Salva os últimos 45–90s da tela em foco' });
  const recBtn = el('button', { class: 'pc-ctl', id: 'ctl-rec', onclick: toggleManualRec, title: 'Gravação manual (começa/para)' });
  const exitBtn = el('button', { class: 'pc-ctl exit', onclick: () => leaveRoom(false), html: icon('exit') + '<span class="lbl">SAIR</span>' });

  const bar = el('div', { class: 'pc-controls' }, micBtn, shareBtn, clipBtn, recBtn, exitBtn);
  requestAnimationFrame(syncControls);
  return bar;
}

function syncControls() {
  const micBtn = document.getElementById('ctl-mic');
  if (micBtn) {
    if (!S.micStream) {
      micBtn.className = 'pc-ctl off';
      micBtn.innerHTML = icon('mic-off') + '<span class="lbl">SEM MIC</span>';
      micBtn.disabled = true;
    } else {
      micBtn.className = 'pc-ctl' + (S.muted ? ' off' : '');
      micBtn.innerHTML = (S.muted ? icon('mic-off') : icon('mic')) + '<span class="lbl">' + (S.muted ? 'MUTADO' : 'MUTAR') + '</span>';
    }
  }
  const shareBtn = document.getElementById('ctl-share');
  if (shareBtn) {
    shareBtn.className = 'pc-ctl' + (S.shareStream ? ' on' : '');
    shareBtn.innerHTML = (S.shareStream ? icon('screen-off') : icon('screen')) +
      '<span class="lbl">' + (S.shareStream ? 'PARAR TELA' : 'TELA') + '</span>';
  }
  const clipBtn = document.getElementById('ctl-clip');
  if (clipBtn) {
    clipBtn.disabled = !S.clipper;
    clipBtn.innerHTML = icon('scissors') + '<span class="lbl">CLIPE</span>';
  }
  const recBtn = document.getElementById('ctl-rec');
  if (recBtn) {
    recBtn.disabled = !S.clipper && !S.manualRec;
    recBtn.className = 'pc-ctl' + (S.manualRec ? ' off' : '');
    recBtn.innerHTML = (S.manualRec ? icon('stop') : icon('record')) +
      '<span class="lbl">' + (S.manualRec ? 'PARAR REC' : 'GRAVAR') + '</span>';
  }
}

function rebuildTiles() {
  const box = document.getElementById('pc-tiles');
  if (!box) return;
  box.innerHTML = '';
  S.tileEls.clear();

  const mkTile = (pid, nick, info) => {
    const status = el('div', { class: 'tstatus' });
    if (info.muted) status.appendChild(el('span', { class: 'muted-ico', html: icon('mic-off', 13) }));
    if (info.sharing) {
      status.appendChild(el('span', { class: 'share-ico', html: icon('screen', 13) }));
      status.appendChild(el('span', {}, 'NA TELA'));
    }
    const tile = el('div', {
      class: 'pc-tile' + (info.sharing ? ' sharing-tile' : '') + (S.focusedShare === pid ? ' focused' : ''),
    },
      el('span', { class: 'conn' }, ''),
      avatarEl(nick, 56),
      el('div', { class: 'tnick' }, pid === 'me' ? nick + ' (VOCÊ)' : nick),
      status);
    if (info.sharing) {
      tile.title = 'Ver a tela de ' + nick;
      tile.addEventListener('click', () => { S.focusedShare = pid; syncStage(); rebuildTiles(); });
    }
    S.tileEls.set(pid, tile);
    box.appendChild(tile);
  };

  mkTile('me', S.nick, { muted: S.muted || !S.micStream, sharing: !!S.shareStream });
  for (const [pid, info] of S.peersInfo) {
    mkTile(pid, info.nick || pid, info);
    updateTileConn(pid);
  }
}

// ─── PALCO (tela em foco) ───────────────────────────────────────────────────
function currentStageStream() {
  if (S.focusedShare === 'me') return S.shareStream;
  const link = S.links.get(S.focusedShare);
  return (link && link.shareStream) || null;
}

function autoFocusShare() {
  if (currentStageStream()) { syncStage(); return; }
  S.focusedShare = null;
  if (S.shareStream) S.focusedShare = 'me';
  else {
    for (const [pid, link] of S.links) if (link.shareStream) { S.focusedShare = pid; break; }
  }
  syncStage();
}

function syncStage() {
  const stage = document.getElementById('pc-stage');
  if (!stage) return;
  const video = stage.querySelector('video');
  const tag = document.getElementById('stage-tag');
  const stream = currentStageStream();

  if (!stream) {
    stage.classList.remove('on');
    video.srcObject = null;
    stopClipper();
    syncControls();
    return;
  }
  stage.classList.add('on');
  if (video.srcObject !== stream) {
    video.srcObject = stream;
    // minha própria tela: sem áudio local (senão eco do próprio sistema)
    video.muted = (S.focusedShare === 'me');
    video.play().catch(() => {});
    restartClipper();
  }
  const nick = S.focusedShare === 'me' ? S.nick
    : ((S.peersInfo.get(S.focusedShare) || {}).nick || S.focusedShare);
  tag.textContent = 'TELA DE ' + String(nick).toUpperCase();
  syncControls();
}

// ─── COMPARTILHAR TELA ──────────────────────────────────────────────────────
async function toggleShare() {
  if (S.shareStream) { stopShare(); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: true, // áudio da aba/sistema quando o navegador deixa
    });
  } catch (e) { return; } // usuário cancelou o seletor
  S.shareStream = stream;

  const vTrack = stream.getVideoTracks()[0];
  if (vTrack) vTrack.onended = () => stopShare(); // botão "parar" do navegador

  for (const [, link] of S.links) {
    link.shareSenders = stream.getTracks().map(t => link.pc.addTrack(t, stream));
  }
  mixAttach(stream); // áudio do MEU jogo também entra no mix dos clipes
  presRef().set({ sharing: true, shareSid: stream.id }, { merge: true }).catch(handleWriteError);
  S.focusedShare = 'me';
  syncStage();
  rebuildTiles();
}

function stopShare() {
  if (!S.shareStream) return;
  mixDetach(S.shareStream.id);
  S.shareStream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
  for (const [, link] of S.links) {
    (link.shareSenders || []).forEach(s => { try { link.pc.removeTrack(s); } catch (e) {} });
    link.shareSenders = [];
  }
  S.shareStream = null;
  presRef().set({ sharing: false, shareSid: null }, { merge: true }).catch(() => {});
  if (S.focusedShare === 'me') S.focusedShare = null;
  autoFocusShare();
  rebuildTiles();
}

// ─── MUTE ───────────────────────────────────────────────────────────────────
function toggleMute() {
  if (!S.micStream) return;
  S.muted = !S.muted;
  S.micStream.getAudioTracks().forEach(t => { t.enabled = !S.muted; });
  presRef().set({ muted: S.muted }, { merge: true }).catch(() => {});
  syncControls();
  rebuildTiles();
}

// ─── CLIPES (buffer rolante) ────────────────────────────────────────────────
function pickMime() {
  const cands = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  for (const m of cands) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) {}
  }
  return '';
}

// Stream composta: vídeo da tela em foco + mix de todas as vozes (+ áudio do jogo).
function composedStageStream() {
  const src = currentStageStream();
  if (!src) return null;
  const vTrack = src.getVideoTracks()[0];
  if (!vTrack) return null;
  const tracks = [vTrack];
  if (S.mixDest && S.mixDest.stream.getAudioTracks().length) {
    tracks.push(S.mixDest.stream.getAudioTracks()[0]);
  } else if (src.getAudioTracks().length) {
    tracks.push(src.getAudioTracks()[0]);
  }
  return new MediaStream(tracks);
}

function createClipper(stream) {
  const mime = pickMime();
  const opts = { videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 128_000 };
  if (mime) opts.mimeType = mime;
  const slots = [null, null];
  let stopped = false;

  function spawn(idx) {
    if (stopped) return;
    let rec;
    try { rec = new MediaRecorder(stream, opts); }
    catch (e) { console.warn('[primicord] MediaRecorder falhou:', e); return; }
    const slot = { rec, chunks: [], startedAt: Date.now(), flushResolve: null };
    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size) slot.chunks.push(ev.data);
      if (slot.flushResolve) { const r = slot.flushResolve; slot.flushResolve = null; r(); }
    };
    rec.start(1000);
    slot.timer = setTimeout(() => {
      try { rec.stop(); } catch (e) {}
      spawn(idx);
    }, CLIP_WINDOW_MS);
    slots[idx] = slot;
  }

  spawn(0);
  const staggerTimer = setTimeout(() => spawn(1), CLIP_WINDOW_MS / 2);

  return {
    mime,
    async clip() {
      const live = slots.filter(s => s && s.chunks.length + (s.rec.state === 'recording' ? 1 : 0) > 0);
      if (!live.length) return null;
      const s = live.sort((a, b) => a.startedAt - b.startedAt)[0]; // buffer mais longo
      if (s.rec.state === 'recording') {
        await new Promise((res) => {
          s.flushResolve = res;
          try { s.rec.requestData(); } catch (e) { res(); }
          setTimeout(res, 1500); // não trava se o flush não vier
        });
      }
      if (!s.chunks.length) return null;
      return {
        blob: new Blob(s.chunks, { type: mime || 'video/webm' }),
        seconds: Math.min(Math.round((Date.now() - s.startedAt) / 1000), Math.round(CLIP_WINDOW_MS / 1000)),
      };
    },
    bufferSeconds() {
      const live = slots.filter(Boolean);
      if (!live.length) return 0;
      const oldest = Math.min(...live.map(s => s.startedAt));
      return Math.min(Math.round((Date.now() - oldest) / 1000), Math.round(CLIP_WINDOW_MS / 1000));
    },
    stop() {
      stopped = true;
      clearTimeout(staggerTimer);
      slots.forEach(s => { if (s) { clearTimeout(s.timer); try { s.rec.stop(); } catch (e) {} } });
    },
  };
}

function restartClipper() {
  stopClipper();
  const stream = composedStageStream();
  if (!stream) return;
  S.clipper = createClipper(stream);
  syncControls();
}
function stopClipper() {
  if (S.clipper) { S.clipper.stop(); S.clipper = null; }
  if (S.manualRec) stopManualRec(true);
  updateBufferLabel();
  syncControls();
}

function updateBufferLabel() {
  const lbl = document.getElementById('stage-buffer');
  if (!lbl) return;
  if (S.manualRec) {
    lbl.innerHTML = '<span class="rec-dot"></span>REC ' + Math.round((Date.now() - S.manualRec.startedAt) / 1000) + 's';
  } else if (S.clipper) {
    lbl.textContent = 'BUFFER ' + S.clipper.bufferSeconds() + 's';
  } else {
    lbl.textContent = '';
  }
}

function clipExt(mime) { return (mime || '').includes('mp4') ? 'mp4' : 'webm'; }
function clipStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

async function makeClip() {
  if (!S.clipper) { toast('Ninguém compartilhando tela — sem o que clipar', 'error'); return; }
  const out = await S.clipper.clip();
  if (!out) { toast('Buffer ainda vazio — espera uns segundos', 'error'); return; }
  download(out.blob, 'primicord-' + S.roomId + '-' + clipStamp() + '.' + clipExt(S.clipper.mime));
  toast('CLIPE SALVO — últimos ~' + out.seconds + 's');
}

function toggleManualRec() {
  if (S.manualRec) { stopManualRec(false); return; }
  const stream = composedStageStream();
  if (!stream) { toast('Ninguém compartilhando tela', 'error'); return; }
  const mime = pickMime();
  const opts = { videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 128_000 };
  if (mime) opts.mimeType = mime;
  let rec;
  try { rec = new MediaRecorder(stream, opts); }
  catch (e) { toast('Gravação não suportada neste navegador', 'error'); return; }
  const chunks = [];
  rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
  rec.onstop = () => {
    if (S.manualRec && S.manualRec.discard) return;
    if (chunks.length) {
      download(new Blob(chunks, { type: mime || 'video/webm' }), 'primicord-rec-' + S.roomId + '-' + clipStamp() + '.' + clipExt(mime));
      toast('GRAVAÇÃO SALVA');
    }
    S.manualRec = null;
    syncControls();
    updateBufferLabel();
  };
  rec.start(1000);
  S.manualRec = { rec, startedAt: Date.now(), discard: false };
  toast('GRAVANDO — aperta de novo pra parar e salvar');
  syncControls();
}
function stopManualRec(discard) {
  if (!S.manualRec) return;
  S.manualRec.discard = !!discard;
  try { S.manualRec.rec.stop(); } catch (e) { S.manualRec = null; }
  if (discard) S.manualRec = null;
}

// ─── SAIR ───────────────────────────────────────────────────────────────────
function leaveRoom(silent) {
  window.removeEventListener('pagehide', onPageHide);

  stopClipper();
  if (S.shareStream) { S.shareStream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} }); S.shareStream = null; }
  if (S.micStream) { S.micStream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} }); S.micStream = null; }

  for (const pid of [...S.links.keys()]) dropLink(pid);
  S.unsub.forEach(u => { try { u(); } catch (e) {} });
  S.unsub = [];
  S.timers.forEach(t => clearInterval(t));
  S.timers = [];
  S.peersInfo.clear();
  S.tileEls.clear();
  S.analysers.clear();
  S.mixNodes.clear();
  if (S.audioCtx) { try { S.audioCtx.close(); } catch (e) {} S.audioCtx = null; S.mixDest = null; }

  if (S.roomId && S.peerId) presRef().delete().catch(() => {});
  S.roomId = null; S.roomName = null; S.peerId = null;
  S.focusedShare = null; S.muted = false;

  if (!silent) renderLobby();
}

// ─── BOOT ───────────────────────────────────────────────────────────────────
(async function boot() {
  await loadAvatars();
  const known = sessionNick();
  if (known) { S.nick = known; renderLobby(); }
  else renderGate();
})();

})();
