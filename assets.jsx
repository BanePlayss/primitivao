// assets.jsx — todos os entregáveis individuais do Primitivão
// Lê variáveis CSS --pv-orange, --pv-charcoal, --pv-bone, --pv-rust

// ─── TROFÉU PRIMITIVO ──────────────────────────────────────────────────────
// Cálice/totem em ossos com máscara no topo e bola na ponta
function TrofeuPrimitivo({ width = 320, height = 460 }) {
  return (
    <div style={{ width, height, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg viewBox="0 0 320 460" width={width} height={height}>
        {/* base — pedra trapezoidal lascada */}
        <path d="M70 440 L 250 440 L 240 412 L 180 408 L 160 396 L 140 408 L 80 412 Z"
              fill="var(--pv-charcoal)" />
        <path d="M82 412 L 238 412 L 230 388 L 90 388 Z" fill="var(--pv-charcoal)" />
        {/* placa — texto gravado */}
        <rect x="100" y="392" width="120" height="14" fill="var(--pv-orange)" />
        <text x="160" y="402" textAnchor="middle"
              fontFamily="'Space Grotesk', sans-serif" fontSize="9" fontWeight="800"
              letterSpacing="2" fill="var(--pv-charcoal)">PRIMITIVÃO 2026</text>

        {/* haste central — formato de osso/totem */}
        <path d="M148 388 L 148 290 L 142 280 L 142 240 L 146 232 L 146 180 L 138 170 L 138 130 L 144 122
                 L 176 122 L 182 130 L 182 170 L 174 180 L 174 232 L 178 240 L 178 280 L 172 290 L 172 388 Z"
              fill="var(--pv-bone)" stroke="var(--pv-charcoal)" strokeWidth="4" strokeLinejoin="miter" />
        {/* amarrações de couro */}
        <rect x="138" y="208" width="44" height="4" fill="var(--pv-charcoal)" />
        <rect x="138" y="216" width="44" height="4" fill="var(--pv-charcoal)" />
        <rect x="138" y="306" width="44" height="4" fill="var(--pv-charcoal)" />
        <rect x="138" y="314" width="44" height="4" fill="var(--pv-charcoal)" />

        {/* cálice — boca larga em formato de coroa de osso */}
        <path d="M60 130 L 90 60 L 110 90 L 130 50 L 160 100 L 190 50 L 210 90 L 230 60 L 260 130 Z"
              fill="var(--pv-orange)" stroke="var(--pv-charcoal)" strokeWidth="5" strokeLinejoin="miter" />
        {/* faixa do cálice */}
        <rect x="60" y="100" width="200" height="22" fill="var(--pv-charcoal)" />
        {/* triângulos rupestres na faixa */}
        {Array.from({ length: 10 }).map((_, i) => (
          <path key={i} d={`M${66 + i * 20} 122 L${74 + i * 20} 108 L${82 + i * 20} 122 Z`}
                fill="var(--pv-bone)" />
        ))}

        {/* bola/totem no topo, dentro do cálice */}
        <g transform="translate(160 80)">
          <circle r="36" fill="var(--pv-charcoal)" />
          <path d="M0 -22 L 18 -10 L 18 12 L 0 22 L -18 12 L -18 -10 Z"
                fill="none" stroke="var(--pv-bone)" strokeWidth="2.2" />
          <path d="M0 -22 L 0 -36" stroke="var(--pv-bone)" strokeWidth="2" />
          <path d="M18 -10 L 32 -18" stroke="var(--pv-bone)" strokeWidth="2" />
          <path d="M18 12 L 32 22" stroke="var(--pv-bone)" strokeWidth="2" />
          <path d="M0 22 L 0 36" stroke="var(--pv-bone)" strokeWidth="2" />
          <path d="M-18 12 L -32 22" stroke="var(--pv-bone)" strokeWidth="2" />
          <path d="M-18 -10 L -32 -18" stroke="var(--pv-bone)" strokeWidth="2" />
        </g>

        {/* penas/raios saindo do topo */}
        <g stroke="var(--pv-charcoal)" strokeWidth="3" strokeLinecap="round">
          <path d="M160 38 L 160 12" />
          <path d="M130 48 L 110 22" />
          <path d="M190 48 L 210 22" />
          <path d="M104 64 L 78 50" />
          <path d="M216 64 L 242 50" />
        </g>
        {/* pontinhas das penas */}
        <g fill="var(--pv-orange)">
          <circle cx="160" cy="10" r="4" />
          <circle cx="108" cy="20" r="4" />
          <circle cx="212" cy="20" r="4" />
          <circle cx="76" cy="48" r="3" />
          <circle cx="244" cy="48" r="3" />
        </g>

        {/* sombra inferior */}
        <ellipse cx="160" cy="448" rx="100" ry="6" fill="var(--pv-charcoal)" opacity="0.18" />
      </svg>
    </div>
  );
}

// ─── BANNER WHATSAPP ───────────────────────────────────────────────────────
// 1280x720 reduzido. Composto: bg laranja, máscara enorme à esquerda, wordmark
function BannerWhatsApp({ width = 540, height = 540 }) {
  // WhatsApp group icon é quadrado (640x640). Vamos fazer quadrado.
  return (
    <div style={{
      width, height, position: 'relative', overflow: 'hidden',
      background: 'var(--pv-orange)', color: 'var(--pv-charcoal)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {/* listras tribais — borda superior */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 28, background: 'var(--pv-charcoal)', display: 'flex' }}>
        {Array.from({ length: 22 }).map((_, i) => (
          <div key={i} style={{
            width: 0, height: 0, marginLeft: i === 0 ? 12 : 16,
            borderLeft: '10px solid transparent', borderRight: '10px solid transparent',
            borderTop: '20px solid var(--pv-orange)', alignSelf: 'flex-end',
          }} />
        ))}
      </div>
      {/* listras tribais — borda inferior, espelho */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 28, background: 'var(--pv-charcoal)', display: 'flex' }}>
        {Array.from({ length: 22 }).map((_, i) => (
          <div key={i} style={{
            width: 0, height: 0, marginLeft: i === 0 ? 12 : 16,
            borderLeft: '10px solid transparent', borderRight: '10px solid transparent',
            borderBottom: '20px solid var(--pv-orange)', alignSelf: 'flex-start',
          }} />
        ))}
      </div>
      {/* máscara de fundo, gigante, em sépia escuro */}
      <svg viewBox="0 0 200 240" width={width * 0.85} height={width * 0.85 * 1.2}
           style={{ position: 'absolute', opacity: 0.16, color: 'var(--pv-charcoal)' }}>
        <path d="M100 8 C 60 8, 38 36, 36 88 C 34 130, 42 168, 60 200 C 74 224, 88 232, 100 232 C 112 232, 126 224, 140 200 C 158 168, 166 130, 164 88 C 162 36, 140 8, 100 8 Z"
              fill="currentColor" />
      </svg>
      {/* mãos rupestres dispersas */}
      <svg width="50" height="55" viewBox="0 0 100 110" style={{ position: 'absolute', top: 60, right: 50, opacity: 0.22 }}>
        <path d="M28 50 C 28 38 34 32 50 32 C 66 32 72 38 72 50 L 72 88 C 72 100 64 106 50 106 C 36 106 28 100 28 88 Z M22 56 C 14 58 12 68 18 76 C 24 82 32 80 32 72 L 32 60 Z M34 32 C 34 18 38 8 42 8 C 46 8 48 14 48 28 L 48 36 Z M48 32 C 48 14 52 4 56 4 C 60 4 62 12 62 26 L 62 36 Z M60 32 C 60 18 64 10 68 10 C 72 10 72 18 72 30 L 72 38 Z M68 38 C 68 28 72 22 76 22 C 80 22 80 30 78 40 L 76 46 Z"
              fill="var(--pv-charcoal)" />
      </svg>
      <svg width="40" height="44" viewBox="0 0 100 110" style={{ position: 'absolute', bottom: 70, left: 40, opacity: 0.22, transform: 'rotate(-15deg)' }}>
        <path d="M28 50 C 28 38 34 32 50 32 C 66 32 72 38 72 50 L 72 88 C 72 100 64 106 50 106 C 36 106 28 100 28 88 Z M22 56 C 14 58 12 68 18 76 C 24 82 32 80 32 72 L 32 60 Z M34 32 C 34 18 38 8 42 8 C 46 8 48 14 48 28 L 48 36 Z M48 32 C 48 14 52 4 56 4 C 60 4 62 12 62 26 L 62 36 Z M60 32 C 60 18 64 10 68 10 C 72 10 72 18 72 30 L 72 38 Z M68 38 C 68 28 72 22 76 22 C 80 22 80 30 78 40 L 76 46 Z"
              fill="var(--pv-charcoal)" />
      </svg>

      {/* wordmark central */}
      <div style={{
        position: 'relative', textAlign: 'center', display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 8,
      }}>
        <div style={{
          fontFamily: '"Bungee Inline", Impact, sans-serif',
          fontSize: width * 0.155, lineHeight: 0.9,
          color: 'var(--pv-charcoal)', letterSpacing: '0.01em',
          textShadow: '4px 4px 0 var(--pv-bone)',
        }}>PRIMITI<br />VÃO</div>
        <div style={{
          background: 'var(--pv-charcoal)', color: 'var(--pv-bone)',
          padding: '6px 16px', fontFamily: '"Space Grotesk", sans-serif',
          fontSize: width * 0.028, fontWeight: 800, letterSpacing: '0.3em',
          marginTop: 4,
        }}>SEASON I · 2026</div>
      </div>
    </div>
  );
}

// ─── 8 TIMES (dados) ───────────────────────────────────────────────────────
// Cada player vira um time. mascot dirige o desenho do crest.
const TEAMS = [
  { id: 'bane',     name: 'Bane',     short: 'BAN', color: '#1c1612', mascot: 'mascara' },
  { id: 'mohamed',  name: 'Mohamed',  short: 'MOH', color: '#c75418', mascot: 'tigre' },
  { id: 'potato',   name: 'Potato',   short: 'PTT', color: '#8b3a14', mascot: 'pedra' },
  { id: 'magreza',  name: 'Magreza',  short: 'MGR', color: '#2a201a', mascot: 'cruz' },
  { id: 'celin',    name: 'Celin',    short: 'CEL', color: '#e8800f', mascot: 'mao' },
  { id: 'juca',     name: 'Juca',     short: 'JUC', color: '#d63c0a', mascot: 'chama' },
  { id: 'caco',     name: 'Caco',     short: 'CAC', color: '#4a3020', mascot: 'mamute' },
  { id: 'vitinho',  name: 'Vitinho',  short: 'VIT', color: '#6e4824', mascot: 'osso' },
];

// Crests pequenos para cada time — cada um único, paleta laranja/preto/osso
function TeamCrest({ team, size = 64 }) {
  const t = typeof team === 'string' ? TEAMS.find((x) => x.id === team) : team;
  if (!t) return null;
  const fg = t.color;
  const bone = 'var(--pv-bone)';
  const dark = 'var(--pv-charcoal)';

  // shapes diferentes por mascot (não por id, já que id agora é nome do player)
  const shape = (() => {
    const s = t.mascot;
    if (s === 'osso') {
      // osso vertical
      return (
        <g>
          <circle cx="50" cy="22" r="14" fill={bone} stroke={dark} strokeWidth="3" />
          <circle cx="50" cy="78" r="14" fill={bone} stroke={dark} strokeWidth="3" />
          <rect x="44" y="22" width="12" height="56" fill={bone} stroke={dark} strokeWidth="3" />
        </g>
      );
    }
    if (s === 'mascara') {
      return (
        <g>
          {/* máscara mini */}
          <ellipse cx="50" cy="55" rx="22" ry="32" fill={dark} />
          <path d="M40 48 L 48 48 L 44 56 Z" fill={bone} />
          <path d="M52 48 L 60 48 L 56 56 Z" fill={bone} />
          <path d="M40 68 L 44 74 L 48 68 L 52 74 L 56 68 L 60 74 L 60 80 L 40 80 Z" fill={bone} />
        </g>
      );
    }
    if (s === 'tigre') {
      return (
        <g>
          {/* dente sabre */}
          <path d="M50 18 L 38 78 L 50 70 L 62 78 Z" fill={bone} stroke={dark} strokeWidth="3" strokeLinejoin="miter" />
          <circle cx="44" cy="32" r="2" fill={dark} />
          <circle cx="56" cy="32" r="2" fill={dark} />
        </g>
      );
    }
    if (s === 'mao') {
      return (
        <g>
          {/* mão */}
          <path d="M30 52 C 30 40 36 34 50 34 C 64 34 70 40 70 52 L 70 84 C 70 92 62 96 50 96 C 38 96 30 92 30 84 Z M24 56 C 18 58 18 68 22 74 C 28 78 32 76 32 70 L 32 60 Z M36 36 C 36 24 38 16 42 16 C 46 16 48 22 48 30 L 48 38 Z M50 34 C 50 18 54 10 58 10 C 62 10 64 18 64 28 L 64 36 Z M62 34 C 62 22 66 16 70 16 C 74 16 74 24 74 34 L 74 40 Z"
                fill={bone} stroke={dark} strokeWidth="2" strokeLinejoin="miter" />
        </g>
      );
    }
    if (s === 'mamute' || s === 'mamuteshape') {
      return (
        <g>
          {/* mamute estilizado */}
          <path d="M22 64 L 26 50 C 30 38 42 34 50 34 C 60 34 70 38 74 48 L 78 60 L 78 76 L 72 78 L 72 86 L 64 86 L 64 78 L 40 78 L 40 86 L 32 86 L 32 78 L 26 76 Z"
                fill={bone} stroke={dark} strokeWidth="3" strokeLinejoin="miter" />
          {/* presas */}
          <path d="M28 70 C 22 74 18 80 22 84" fill="none" stroke={dark} strokeWidth="2.5" strokeLinecap="round" />
          <path d="M32 72 C 26 78 24 84 28 86" fill="none" stroke={dark} strokeWidth="2.5" strokeLinecap="round" />
          {/* olho */}
          <circle cx="34" cy="48" r="1.8" fill={dark} />
        </g>
      );
    }
    if (s === 'chama') {
      return (
        <g transform="translate(50 16)">
          <path d="M0 4 C -12 18 -16 30 -12 42 C -16 38 -20 36 -22 42 C -24 50 -18 60 -12 64
                   C -16 68 -16 72 -12 74 L 12 74 C 16 72 16 68 12 64
                   C 18 60 24 50 22 42 C 20 36 16 38 12 42 C 16 30 12 18 0 4 Z"
                fill={bone} stroke={dark} strokeWidth="3" strokeLinejoin="miter" />
        </g>
      );
    }
    if (s === 'pedra' || s === 'rocha') {
      return (
        <g>
          {/* pedra lascada */}
          <path d="M30 36 L 50 22 L 72 32 L 78 56 L 64 80 L 38 78 L 22 60 Z"
                fill={bone} stroke={dark} strokeWidth="3" strokeLinejoin="miter" />
          <path d="M40 50 L 56 44 L 62 60" fill="none" stroke={dark} strokeWidth="2" />
          <circle cx="48" cy="62" r="2" fill={dark} />
          <circle cx="58" cy="50" r="1.5" fill={dark} />
        </g>
      );
    }
    if (s === 'cruz') {
      // ossos cruzados em X
      return (
        <g>
          <g transform="rotate(45 50 55)">
            <circle cx="32" cy="55" r="8" fill={bone} stroke={dark} strokeWidth="2.5" />
            <circle cx="68" cy="55" r="8" fill={bone} stroke={dark} strokeWidth="2.5" />
            <rect x="32" y="50" width="36" height="10" fill={bone} stroke={dark} strokeWidth="2.5" />
          </g>
          <g transform="rotate(-45 50 55)">
            <circle cx="32" cy="55" r="8" fill={bone} stroke={dark} strokeWidth="2.5" />
            <circle cx="68" cy="55" r="8" fill={bone} stroke={dark} strokeWidth="2.5" />
            <rect x="32" y="50" width="36" height="10" fill={bone} stroke={dark} strokeWidth="2.5" />
          </g>
        </g>
      );
    }
  })();

  return (
    <svg viewBox="0 0 100 110" width={size} height={size * 1.1} style={{ display: 'block', flexShrink: 0 }}>
      {/* escudo */}
      <path d="M8 12 L 92 12 L 92 56 C 92 84 82 96 50 108 C 18 96 8 84 8 56 Z"
            fill={fg} stroke={dark} strokeWidth="4" strokeLinejoin="miter" />
      {shape}
    </svg>
  );
}

// ─── TABELA DE CLASSIFICAÇÃO ───────────────────────────────────────────────
function TabelaClassificacao({ width = 540, height = 720 }) {
  // dados simulados após 7 rodadas
  const standings = [
    { team: 'bane',    p: 16, j: 7, v: 5, e: 1, d: 1, gp: 14, gc: 6 },
    { team: 'mohamed', p: 15, j: 7, v: 4, e: 3, d: 0, gp: 12, gc: 5 },
    { team: 'juca',    p: 13, j: 7, v: 4, e: 1, d: 2, gp: 11, gc: 9 },
    { team: 'celin',   p: 11, j: 7, v: 3, e: 2, d: 2, gp: 10, gc: 8 },
    { team: 'caco',    p: 9,  j: 7, v: 2, e: 3, d: 2, gp: 7,  gc: 8 },
    { team: 'magreza', p: 7,  j: 7, v: 2, e: 1, d: 4, gp: 6,  gc: 11 },
    { team: 'vitinho', p: 4,  j: 7, v: 1, e: 1, d: 5, gp: 5,  gc: 13 },
    { team: 'potato',  p: 3,  j: 7, v: 1, e: 0, d: 6, gp: 4,  gc: 13 },
  ];

  return (
    <div style={{
      width, height, background: 'var(--pv-bone)', color: 'var(--pv-charcoal)',
      fontFamily: '"Space Grotesk", system-ui, sans-serif', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* header */}
      <div style={{ background: 'var(--pv-charcoal)', color: 'var(--pv-bone)', padding: '20px 24px', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <svg viewBox="0 0 100 120" width="40" height="48">
            <path d="M12 14 L 88 14 L 88 60 C 88 88 80 102 50 116 C 20 102 12 88 12 60 Z"
                  fill="var(--pv-orange)" stroke="var(--pv-bone)" strokeWidth="3" />
            <ellipse cx="50" cy="58" rx="14" ry="20" fill="var(--pv-bone)" />
          </svg>
          <div>
            <div style={{ fontFamily: '"Bungee Inline", Impact, sans-serif', fontSize: 28, lineHeight: 1, letterSpacing: '0.02em' }}>CLASSIFICAÇÃO</div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.32em', marginTop: 6, color: 'var(--pv-orange)' }}>
              PRIMITIVÃO 2026 · RODADA 7/14
            </div>
          </div>
        </div>
      </div>

      {/* table head */}
      <div style={{
        display: 'grid', gridTemplateColumns: '40px 1fr 36px 36px 36px 36px 56px 44px',
        padding: '12px 24px', fontSize: 10, fontWeight: 800, letterSpacing: '0.18em',
        color: 'rgba(28,22,18,0.55)', borderBottom: '2px solid var(--pv-charcoal)',
      }}>
        <div>#</div>
        <div>TIME</div>
        <div style={{ textAlign: 'center' }}>J</div>
        <div style={{ textAlign: 'center' }}>V</div>
        <div style={{ textAlign: 'center' }}>E</div>
        <div style={{ textAlign: 'center' }}>D</div>
        <div style={{ textAlign: 'center' }}>SG</div>
        <div style={{ textAlign: 'right' }}>P</div>
      </div>

      {/* rows */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {standings.map((s, i) => {
          const t = TEAMS.find((x) => x.id === s.team);
          const sg = s.gp - s.gc;
          const isTop = i < 2;
          const isBot = i >= standings.length - 2;
          return (
            <div key={s.team} style={{
              display: 'grid', gridTemplateColumns: '40px 1fr 36px 36px 36px 36px 56px 44px',
              padding: '12px 24px', alignItems: 'center', fontSize: 14,
              borderBottom: '1px dashed rgba(28,22,18,0.15)',
              background: i % 2 === 0 ? 'transparent' : 'rgba(199,84,24,0.05)',
            }}>
              <div style={{
                fontFamily: '"Bungee Inline", Impact, sans-serif', fontSize: 18,
                color: isTop ? 'var(--pv-orange)' : isBot ? 'rgba(28,22,18,0.4)' : 'var(--pv-charcoal)',
              }}>{i + 1}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <TeamCrest team={t} size={28} />
                <div>
                  <div style={{ fontWeight: 700, lineHeight: 1.1 }}>{t.name}</div>
                  <div style={{ fontSize: 10, color: 'rgba(28,22,18,0.5)', letterSpacing: '0.18em', fontWeight: 700 }}>{t.short}</div>
                </div>
              </div>
              <div style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{s.j}</div>
              <div style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{s.v}</div>
              <div style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{s.e}</div>
              <div style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums', color: 'rgba(28,22,18,0.55)' }}>{s.d}</div>
              <div style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums',
                            color: sg > 0 ? 'var(--pv-orange)' : sg < 0 ? '#8b3a14' : 'inherit', fontWeight: 700 }}>
                {sg > 0 ? '+' : ''}{sg}
              </div>
              <div style={{ textAlign: 'right', fontFamily: '"Bungee Inline", Impact, sans-serif',
                            fontSize: 22, color: 'var(--pv-charcoal)' }}>{s.p}</div>
            </div>
          );
        })}
      </div>

      {/* footer com legenda */}
      <div style={{ padding: '14px 24px', display: 'flex', gap: 18, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(28,22,18,0.6)' }}>
        <div><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--pv-orange)', marginRight: 6, verticalAlign: 'middle' }} />ZONA DE GLÓRIA</div>
        <div><span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(28,22,18,0.4)', marginRight: 6, verticalAlign: 'middle' }} />ZONA DE VERGONHA</div>
      </div>
    </div>
  );
}

// ─── CARD DE JOGO DA RODADA ────────────────────────────────────────────────
function CardJogo({ width = 540, height = 320, home = 'caverna', away = 'troglo', round = 8, day = 'QUI', date = '14 MAI', time = '21:00' }) {
  const h = TEAMS.find((x) => x.id === home);
  const a = TEAMS.find((x) => x.id === away);
  return (
    <div style={{
      width, height, background: 'var(--pv-charcoal)', color: 'var(--pv-bone)',
      fontFamily: '"Space Grotesk", sans-serif', overflow: 'hidden', position: 'relative',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* faixa superior tribal */}
      <div style={{ height: 14, background: 'var(--pv-orange)', display: 'flex', alignItems: 'flex-end' }}>
        {Array.from({ length: 30 }).map((_, i) => (
          <div key={i} style={{
            width: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent',
            borderTop: '10px solid var(--pv-charcoal)', marginLeft: i === 0 ? 8 : 6,
          }} />
        ))}
      </div>

      {/* meta */}
      <div style={{ padding: '14px 22px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{
          fontFamily: '"Bungee Inline", Impact, sans-serif', fontSize: 14, letterSpacing: '0.18em',
          color: 'var(--pv-orange)',
        }}>RODADA {String(round).padStart(2, '0')}</div>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.32em', color: 'rgba(244,234,215,0.5)' }}>
          PRIMITIVÃO · 2026
        </div>
      </div>

      {/* confronto */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', padding: '0 24px' }}>
        {/* home */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <TeamCrest team={h} size={92} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: '"Bungee Inline", Impact, sans-serif', fontSize: 14, lineHeight: 1.1 }}>{h.name}</div>
            <div style={{ fontSize: 10, letterSpacing: '0.32em', color: 'var(--pv-orange)', fontWeight: 800, marginTop: 4 }}>{h.short}</div>
          </div>
        </div>
        {/* vs */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '0 16px' }}>
          <div style={{
            fontFamily: '"Bungee Inline", Impact, sans-serif', fontSize: 64, lineHeight: 1,
            color: 'var(--pv-orange)', textShadow: '3px 3px 0 rgba(244,234,215,0.1)',
          }}>VS</div>
          <div style={{ width: 40, height: 1, background: 'var(--pv-orange)', margin: '4px 0' }} />
          <div style={{ fontSize: 10, letterSpacing: '0.32em', fontWeight: 800, color: 'rgba(244,234,215,0.55)' }}>10 MIN</div>
        </div>
        {/* away */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <TeamCrest team={a} size={92} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: '"Bungee Inline", Impact, sans-serif', fontSize: 14, lineHeight: 1.1 }}>{a.name}</div>
            <div style={{ fontSize: 10, letterSpacing: '0.32em', color: 'var(--pv-orange)', fontWeight: 800, marginTop: 4 }}>{a.short}</div>
          </div>
        </div>
      </div>

      {/* footer com data */}
      <div style={{
        background: 'var(--pv-bone)', color: 'var(--pv-charcoal)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 22px',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div style={{ fontFamily: '"Bungee Inline", Impact, sans-serif', fontSize: 22, lineHeight: 1, color: 'var(--pv-orange)' }}>{day}</div>
          <div style={{ fontWeight: 800, letterSpacing: '0.18em', fontSize: 12 }}>{date}</div>
        </div>
        <div style={{
          fontFamily: '"Bungee Inline", Impact, sans-serif', fontSize: 22, lineHeight: 1,
        }}>{time}</div>
      </div>
    </div>
  );
}

// ─── UNIFORME ──────────────────────────────────────────────────────────────
function Uniforme({ width = 280, height = 360, team = 'caverna' }) {
  const t = TEAMS.find((x) => x.id === team);
  const fg = t.color;
  return (
    <div style={{
      width, height, background: 'var(--pv-bone)', position: 'relative', overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <svg viewBox="0 0 280 360" width={width} height={height}>
        {/* camisa formato */}
        <path d="M70 60
                 L 105 40
                 L 120 56
                 L 160 56
                 L 175 40
                 L 210 60
                 L 240 110
                 L 220 130
                 L 210 110
                 L 210 310
                 L 70 310
                 L 70 110
                 L 60 130
                 L 40 110 Z"
              fill={fg} stroke="var(--pv-charcoal)" strokeWidth="3" strokeLinejoin="miter" />
        {/* gola V */}
        <path d="M120 56 L 140 88 L 160 56" fill="var(--pv-charcoal)" />
        {/* listra tribal vertical */}
        <rect x="135" y="100" width="10" height="180" fill="var(--pv-bone)" opacity="0.25" />
        {/* triângulos rupestres no peito */}
        {Array.from({ length: 5 }).map((_, i) => (
          <path key={i} d={`M${94 + i * 18} 180 L${102 + i * 18} 168 L${110 + i * 18} 180 Z`} fill="var(--pv-charcoal)" />
        ))}
        {/* crest pequeno no peito */}
        <g transform="translate(96 110)">
          <path d="M0 0 L 32 0 L 32 18 C 32 28 28 32 16 38 C 4 32 0 28 0 18 Z" fill="var(--pv-charcoal)" />
          <text x="16" y="22" textAnchor="middle" fontSize="10" fontWeight="900" fill="var(--pv-orange)" fontFamily="'Bungee Inline', Impact, sans-serif">PV</text>
        </g>
        {/* numeração nas costas (placeholder) */}
        <text x="170" y="130" fontFamily="'Bungee Inline', Impact, sans-serif"
              fontSize="14" fontWeight="900" fill="var(--pv-charcoal)">{t.short}</text>
        {/* mangas — listras */}
        <rect x="40" y="100" width="30" height="6" fill="var(--pv-bone)" />
        <rect x="40" y="112" width="30" height="3" fill="var(--pv-bone)" opacity="0.6" />
        <rect x="210" y="100" width="30" height="6" fill="var(--pv-bone)" />
        <rect x="210" y="112" width="30" height="3" fill="var(--pv-bone)" opacity="0.6" />
        {/* barra inferior */}
        <rect x="70" y="296" width="140" height="14" fill="var(--pv-charcoal)" />
        {/* triângulos brancos na barra */}
        {Array.from({ length: 8 }).map((_, i) => (
          <path key={i} d={`M${78 + i * 17} 310 L${86 + i * 17} 300 L${94 + i * 17} 310 Z`} fill="var(--pv-bone)" />
        ))}
      </svg>
      {/* nome do time abaixo */}
      <div style={{
        position: 'absolute', bottom: 12, left: 0, right: 0, textAlign: 'center',
        fontFamily: '"Space Grotesk", sans-serif', fontSize: 10, fontWeight: 800, letterSpacing: '0.32em',
        color: 'var(--pv-charcoal)',
      }}>{t.name.toUpperCase()}</div>
    </div>
  );
}

// ─── MOCKUP WHATSAPP (chat com banner) ─────────────────────────────────────
function MockupWhatsApp({ width = 360, height = 720 }) {
  return (
    <div style={{
      width, height, background: '#0b1418', position: 'relative', overflow: 'hidden',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* status bar */}
      <div style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0 22px', color: '#fff', fontSize: 13, fontWeight: 600 }}>
        <span>21:42</span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11 }}>5G</span>
          <span style={{ width: 18, height: 10, border: '1.5px solid #fff', borderRadius: 2, padding: 1, display: 'inline-block' }}>
            <span style={{ display: 'block', width: '70%', height: '100%', background: '#fff' }} />
          </span>
        </span>
      </div>
      {/* header do grupo */}
      <div style={{ height: 64, background: '#1f2c33', display: 'flex', alignItems: 'center', padding: '0 14px', gap: 12, color: '#fff' }}>
        <span style={{ fontSize: 18 }}>‹</span>
        {/* avatar = banner WhatsApp em miniatura */}
        <div style={{ width: 40, height: 40, borderRadius: '50%', overflow: 'hidden', background: 'var(--pv-orange)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <div style={{
            fontFamily: '"Bungee Inline", Impact, sans-serif', fontSize: 9, fontWeight: 900,
            color: 'var(--pv-charcoal)', textAlign: 'center', lineHeight: 0.9,
          }}>PV</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>🔥 PRIMITIVÃO 2026 🔥</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>Você, Tito, Léo, Fabri +5</div>
        </div>
        <span style={{ fontSize: 16, color: '#aaa' }}>⋮</span>
      </div>

      {/* messages */}
      <div style={{ padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* date */}
        <div style={{ alignSelf: 'center', background: '#1f2c33', color: 'rgba(255,255,255,0.7)',
                      fontSize: 11, padding: '4px 10px', borderRadius: 6 }}>HOJE</div>

        {/* msg de outro com banner */}
        <div style={{ alignSelf: 'flex-start', maxWidth: '85%', background: '#1f2c33', borderRadius: 8,
                      padding: 4, color: '#e9edef' }}>
          <div style={{ overflow: 'hidden', borderRadius: 6, marginBottom: 4 }}>
            <div style={{
              width: '100%', height: 240, background: 'var(--pv-orange)', position: 'relative',
              display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 14, background: 'var(--pv-charcoal)' }} />
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 14, background: 'var(--pv-charcoal)' }} />
              <svg viewBox="0 0 200 240" width="180" height="216" style={{ opacity: 0.18, position: 'absolute' }}>
                <path d="M100 8 C 60 8 38 36 36 88 C 34 130 42 168 60 200 C 74 224 88 232 100 232 C 112 232 126 224 140 200 C 158 168 166 130 164 88 C 162 36 140 8 100 8 Z" fill="var(--pv-charcoal)" />
              </svg>
              <div style={{
                position: 'relative', textAlign: 'center', color: 'var(--pv-charcoal)',
                fontFamily: '"Bungee Inline", Impact, sans-serif', fontSize: 36, lineHeight: 0.9,
                textShadow: '2px 2px 0 var(--pv-bone)',
              }}>PRIMITI<br />VÃO</div>
            </div>
          </div>
          <div style={{ padding: '4px 8px 6px', fontSize: 13.5 }}>
            Senhores, abertura oficial do <b>PRIMITIVÃO 2026</b> 🦴⚔️
          </div>
          <div style={{ padding: '0 8px 6px', fontSize: 13.5 }}>
            8 guerreiros, 14 rodadas, 1 só campeão.
          </div>
          <div style={{ padding: '0 8px 4px', fontSize: 11, color: 'rgba(255,255,255,0.5)', textAlign: 'right' }}>21:32</div>
        </div>

        {/* msg curta */}
        <div style={{ alignSelf: 'flex-start', maxWidth: '70%', background: '#1f2c33', borderRadius: 8,
                      padding: '6px 10px', color: '#e9edef', fontSize: 13.5 }}>
          Tabela e regulamento já no arquivo fixado 📌
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', textAlign: 'right', marginTop: 2 }}>21:33</div>
        </div>

        {/* minha msg */}
        <div style={{ alignSelf: 'flex-end', maxWidth: '70%', background: '#005c4b', borderRadius: 8,
                      padding: '6px 10px', color: '#e9edef', fontSize: 13.5 }}>
          taca-le pau 🔥 quem fica com a minha equipe?
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', textAlign: 'right', marginTop: 2 }}>21:35 ✓✓</div>
        </div>

        {/* outro */}
        <div style={{ alignSelf: 'flex-end', maxWidth: '60%', background: '#005c4b', borderRadius: 8,
                      padding: '6px 10px', color: '#e9edef', fontSize: 13.5 }}>
          Caverna United no chão dos primitivos 🪨
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', textAlign: 'right', marginTop: 2 }}>21:36 ✓✓</div>
        </div>

        <div style={{ alignSelf: 'flex-start', maxWidth: '60%', background: '#1f2c33', borderRadius: 8,
                      padding: '6px 10px', color: '#e9edef', fontSize: 13.5 }}>
          Tô nos Tigres de Sabre 🐯
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', textAlign: 'right', marginTop: 2 }}>21:38</div>
        </div>
      </div>

      {/* input */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 8, background: '#0b1418',
                    display: 'flex', gap: 6, alignItems: 'center' }}>
        <div style={{ flex: 1, background: '#1f2c33', borderRadius: 22, padding: '10px 14px',
                      color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
          Mensagem
        </div>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#00a884',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 18 }}>🎤</div>
      </div>
    </div>
  );
}

Object.assign(window, {
  TEAMS, TeamCrest,
  TrofeuPrimitivo, BannerWhatsApp, TabelaClassificacao, CardJogo, Uniforme, MockupWhatsApp,
});
