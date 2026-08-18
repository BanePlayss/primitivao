// Calcula odds da rodada 7 usando a mesma logica do app (poisson + sigmoid).

const TEAM_NAMES = {
  juca:'Juca', potato:'Potato', magreza:'Magreza', celin:'Celin',
  caco:'Caco', bane:'Bane', vitinho:'Vitinho', mohamed:'Mohamed',
};

// Standings apos rodada 6
const standings = [
  { id:'juca',    p:18, gp:38, gc:2 },
  { id:'potato',  p:13, gp:20, gc:16 },
  { id:'magreza', p:10, gp:25, gc:11 },
  { id:'celin',   p: 9, gp:18, gc:16 },
  { id:'caco',    p: 9, gp:18, gc:19 },
  { id:'bane',    p: 7, gp:13, gc:20 },
  { id:'vitinho', p: 4, gp:10, gc:25 },
  { id:'mohamed', p: 0, gp: 6, gc:39 },
];
const JOGOS_PER_TEAM = 6;
const DEFAULT_LAMBDA = 1.3;
const ODD_MIN = 1.10;
const ODD_MAX = 10.00;

const metrics = {};
for (const t of standings) {
  metrics[t.id] = {
    strength: t.p * 3 + (t.gp - t.gc),
    lambdaAttack:  JOGOS_PER_TEAM > 0 ? t.gp / JOGOS_PER_TEAM : DEFAULT_LAMBDA,
    lambdaDefense: JOGOS_PER_TEAM > 0 ? t.gc / JOGOS_PER_TEAM : DEFAULT_LAMBDA,
  };
}

const sigmoid = x => 1 / (1 + Math.exp(-x));
const poissonPmf = (lambda, k) => {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
};
const toOdd = p => {
  if (!(p > 0) || !isFinite(p)) return ODD_MAX;
  return Math.max(ODD_MIN, Math.min(ODD_MAX, +(1/p).toFixed(2)));
};

function computeOdds(homeId, awayId) {
  const H = metrics[homeId];
  const A = metrics[awayId];
  const diff = H.strength - A.strength;
  const pDraw = 0.30 * Math.exp(-Math.abs(diff)/40);
  const rest = 1 - pDraw;
  const sigH = sigmoid(diff * 0.0256);
  const pH = rest * sigH;
  const pA = rest * (1 - sigH);

  // Poisson pra mercados de gol
  const lH = Math.max(0.2, (H.lambdaAttack + A.lambdaDefense) / 2);
  const lA = Math.max(0.2, (A.lambdaAttack + H.lambdaDefense) / 2);
  // BTTS (ambos marcam)
  const pBy = (1 - poissonPmf(lH, 0)) * (1 - poissonPmf(lA, 0));
  // NM (ninguem marca = 0x0)
  const pNm = poissonPmf(lH, 0) * poissonPmf(lA, 0);
  // +3 gols mandante
  let p3H = 0;
  for (let k = 3; k <= 12; k++) p3H += poissonPmf(lH, k);
  // +3 gols visitante
  let p3A = 0;
  for (let k = 3; k <= 12; k++) p3A += poissonPmf(lA, k);

  return {
    H: toOdd(pH), D: toOdd(pDraw), A: toOdd(pA),
    BY: toOdd(pBy), BN: toOdd(1 - pBy),
    NM_Y: toOdd(pNm), NM_N: toOdd(1 - pNm),
    O3H_Y: toOdd(p3H), O3H_N: toOdd(1 - p3H),
    O3A_Y: toOdd(p3A), O3A_N: toOdd(1 - p3A),
    diff, lH: lH.toFixed(2), lA: lA.toFixed(2),
  };
}

const games = [
  { home:'juca',    away:'magreza' },
  { home:'caco',    away:'vitinho' },
  { home:'celin',   away:'bane'    },
  { home:'mohamed', away:'potato'  },
];

console.log('═══ ODDS DA RODADA 7 (recalculadas pos-rodada 6) ═══\n');
for (const g of games) {
  const o = computeOdds(g.home, g.away);
  const hName = TEAM_NAMES[g.home];
  const aName = TEAM_NAMES[g.away];
  console.log(`${hName.toUpperCase()} × ${aName.toUpperCase()}  (strength diff = ${o.diff > 0 ? '+' : ''}${o.diff})`);
  console.log(`  1X2:           ${hName} ${o.H} · Empate ${o.D} · ${aName} ${o.A}`);
  console.log(`  Ambos marcam:  Sim ${o.BY} · Nao ${o.BN}`);
  console.log(`  Ninguem marca: Sim ${o.NM_Y} · Nao ${o.NM_N}`);
  console.log(`  +3 ${hName}:       Sim ${o.O3H_Y} · Nao ${o.O3H_N}  (lambda=${o.lH})`);
  console.log(`  +3 ${aName}:       Sim ${o.O3A_Y} · Nao ${o.O3A_N}  (lambda=${o.lA})`);
  console.log('');
}
