// brand-system.jsx
// Sistema visual do PRIMITIVÃO 2026 — primitivo puro com paleta laranja/preto.
//
// Paleta (referenciada via vars do TweakColor; defaults definidos aqui pra
// componentes que renderizam fora do App principal):
//   --pv-orange : laranja queimado, cor de chama
//   --pv-bone   : branco osso, cor de papel
//   --pv-charcoal : preto carvão, cor de pintura rupestre
//   --pv-rust   : vermelho ferrugem, acento de sangue
//
// Tipografia:
//   - Display: Bungee Inline / Bungee → letras de escudo, robustas, com peso
//   - Tribal: "Rye" ou stencil bold → títulos secundários
//   - Body: Space Grotesk → texto corrido, contraste moderno
//
// SVGs primitivos: máscara, lança cruzada, mão rupestre, fogo, totem do troféu.
// Todos usam currentColor pra herdar a cor do contexto (mono/cor).

// ─── Marcas rupestres / iconografia ────────────────────────────────────────

// Máscara tribal — central no escudo. Olhos triangulares, dentes serrilhados.
function MaskaTribal({ size = 200, color = 'currentColor', stroke = 'none' }) {
  return (
    <svg viewBox="0 0 200 240" width={size} height={size * 1.2} style={{ display: 'block' }}>
      <g fill={color} stroke={stroke} strokeWidth="0">
        {/* contorno principal — formato de máscara africana alongada */}
        <path d="M100 8 C 60 8, 38 36, 36 88 C 34 130, 42 168, 60 200 C 74 224, 88 232, 100 232 C 112 232, 126 224, 140 200 C 158 168, 166 130, 164 88 C 162 36, 140 8, 100 8 Z" />
        {/* recorte interno — face mais clara */}
      </g>
      {/* olhos triangulares — invertidos, evocam pinturas rupestres */}
      <path d="M62 90 L 88 90 L 75 112 Z" fill="var(--pv-bone, #f4ead7)" />
      <path d="M112 90 L 138 90 L 125 112 Z" fill="var(--pv-bone, #f4ead7)" />
      {/* boca — dentes em zigue-zague */}
      <path d="M62 156 L 70 168 L 78 156 L 86 168 L 94 156 L 102 168 L 110 156 L 118 168 L 126 156 L 134 168 L 138 158 L 138 178 L 62 178 Z"
            fill="var(--pv-bone, #f4ead7)" />
      {/* marca de tinta — testa */}
      <path d="M85 40 L 100 28 L 115 40 L 110 52 L 100 46 L 90 52 Z" fill="var(--pv-bone, #f4ead7)" opacity="0.85" />
      {/* listras tribais nas bochechas */}
      <rect x="44" y="120" width="12" height="3" fill="var(--pv-bone, #f4ead7)" opacity="0.7" />
      <rect x="44" y="128" width="8" height="3" fill="var(--pv-bone, #f4ead7)" opacity="0.7" />
      <rect x="144" y="120" width="12" height="3" fill="var(--pv-bone, #f4ead7)" opacity="0.7" />
      <rect x="148" y="128" width="8" height="3" fill="var(--pv-bone, #f4ead7)" opacity="0.7" />
    </svg>
  );
}

// Lanças cruzadas — substituem chuteiras/espadas. Pontas de pedra lascada.
function LancasCruzadas({ size = 200, color = 'currentColor' }) {
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} style={{ display: 'block' }}>
      <g fill={color}>
        {/* lança 1 — diagonal nw→se */}
        <g transform="rotate(45 100 100)">
          {/* haste */}
          <rect x="98" y="20" width="4" height="160" />
          {/* ponta de pedra (folha lascada) */}
          <path d="M100 6 L 92 28 L 96 36 L 100 22 L 104 36 L 108 28 Z" />
          {/* amarração na haste */}
          <rect x="94" y="38" width="12" height="2" />
          <rect x="94" y="42" width="12" height="2" />
          <rect x="94" y="46" width="12" height="2" />
          {/* ponta inferior (cabo) */}
          <path d="M100 184 L 96 178 L 104 178 Z" />
        </g>
        {/* lança 2 — diagonal ne→sw */}
        <g transform="rotate(-45 100 100)">
          <rect x="98" y="20" width="4" height="160" />
          <path d="M100 6 L 92 28 L 96 36 L 100 22 L 104 36 L 108 28 Z" />
          <rect x="94" y="38" width="12" height="2" />
          <rect x="94" y="42" width="12" height="2" />
          <rect x="94" y="46" width="12" height="2" />
          <path d="M100 184 L 96 178 L 104 178 Z" />
        </g>
      </g>
    </svg>
  );
}

// Mão rupestre — silhueta de Lascaux, impressa em negativo
function MaoRupestre({ size = 100, color = 'currentColor' }) {
  return (
    <svg viewBox="0 0 100 110" width={size} height={size * 1.1} style={{ display: 'block' }}>
      <g fill={color}>
        {/* palma */}
        <path d="M28 50 C 28 38, 34 32, 50 32 C 66 32, 72 38, 72 50 L 72 88 C 72 100, 64 106, 50 106 C 36 106, 28 100, 28 88 Z" />
        {/* polegar */}
        <path d="M22 56 C 14 58, 12 68, 18 76 C 24 82, 32 80, 32 72 L 32 60 Z" />
        {/* dedo indicador */}
        <path d="M34 32 C 34 18, 38 8, 42 8 C 46 8, 48 14, 48 28 L 48 36 Z" />
        {/* dedo médio */}
        <path d="M48 32 C 48 14, 52 4, 56 4 C 60 4, 62 12, 62 26 L 62 36 Z" />
        {/* dedo anelar */}
        <path d="M60 32 C 60 18, 64 10, 68 10 C 72 10, 72 18, 72 30 L 72 38 Z" />
        {/* dedo mínimo */}
        <path d="M68 38 C 68 28, 72 22, 76 22 C 80 22, 80 30, 78 40 L 76 46 Z" />
      </g>
    </svg>
  );
}

// Bola rupestre — círculo com costuras tipo bola antiga, traços primitivos
function BolaRupestre({ size = 80, color = 'currentColor' }) {
  return (
    <svg viewBox="0 0 80 80" width={size} height={size} style={{ display: 'block' }}>
      <circle cx="40" cy="40" r="36" fill={color} />
      {/* hexágono central — tipo bola Telstar primitiva */}
      <path d="M40 18 L 58 28 L 58 50 L 40 60 L 22 50 L 22 28 Z"
            fill="none" stroke="var(--pv-bone, #f4ead7)" strokeWidth="2.5" />
      {/* linhas radiais saindo do hexágono */}
      <path d="M40 18 L 40 6" stroke="var(--pv-bone, #f4ead7)" strokeWidth="2.5" />
      <path d="M58 28 L 70 22" stroke="var(--pv-bone, #f4ead7)" strokeWidth="2.5" />
      <path d="M58 50 L 70 56" stroke="var(--pv-bone, #f4ead7)" strokeWidth="2.5" />
      <path d="M40 60 L 40 74" stroke="var(--pv-bone, #f4ead7)" strokeWidth="2.5" />
      <path d="M22 50 L 10 56" stroke="var(--pv-bone, #f4ead7)" strokeWidth="2.5" />
      <path d="M22 28 L 10 22" stroke="var(--pv-bone, #f4ead7)" strokeWidth="2.5" />
    </svg>
  );
}

// Fogo / chama tribal — pra acentos
function ChamaTribal({ size = 60, color = 'currentColor' }) {
  return (
    <svg viewBox="0 0 60 80" width={size} height={size * 1.33} style={{ display: 'block' }}>
      <path d="M30 4 C 18 18, 14 30, 18 42 C 14 38, 10 36, 8 42 C 6 50, 12 60, 18 64
               C 14 68, 14 72, 18 74 L 42 74 C 46 72, 46 68, 42 64
               C 48 60, 54 50, 52 42 C 50 36, 46 38, 42 42 C 46 30, 42 18, 30 4 Z"
            fill={color} />
    </svg>
  );
}

// Padrão tribal repetível — borda inferior de banner, listras, etc
function PadraoTribal({ width = 400, height = 24, color = 'currentColor' }) {
  // Triângulos alternados + pontos
  const tri = [];
  const step = 24;
  for (let x = 0; x < width; x += step) {
    tri.push(<path key={'t' + x} d={`M${x} ${height} L${x + 12} 4 L${x + 24} ${height} Z`} fill={color} />);
    tri.push(<circle key={'c' + x} cx={x + 12} cy={height - 4} r="1.5" fill="var(--pv-bone, #f4ead7)" />);
  }
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} preserveAspectRatio="none" style={{ display: 'block' }}>
      {tri}
    </svg>
  );
}

// Granulado / textura de arenito — overlay pra dar pegada de pintura rupestre
function TexturaCaverna({ opacity = 0.18 }) {
  // SVG turbulência → ruído estampado tipo poeira de pedra
  return (
    <svg width="100%" height="100%" style={{
      position: 'absolute', inset: 0, pointerEvents: 'none', opacity, mixBlendMode: 'multiply',
    }}>
      <defs>
        <filter id="cv-noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" />
          <feColorMatrix values="0 0 0 0 0.1  0 0 0 0 0.05  0 0 0 0 0.02  0 0 0 1 0" />
        </filter>
      </defs>
      <rect width="100%" height="100%" filter="url(#cv-noise)" />
    </svg>
  );
}

// ─── LOGO PRINCIPAL ────────────────────────────────────────────────────────
// Escudo crest brasileiro com: máscara central detalhada, lanças cruzadas
// atrás, faixa "PRIMITIVÃO" no topo, fita "SEASON I · 2026" embaixo, listras
// tribais nas laterais, marcações rupestres (mãos, pontos) e raios solares
// no topo. Tudo em laranja/preto/osso.

function LogoPrincipal({ size = 320, palette = 'cor', display = 'Bungee Inline' }) {
  const isMono = palette === 'mono';
  const isInverso = palette === 'inverso';
  const fg = isInverso ? 'var(--pv-bone)' : isMono ? 'var(--pv-charcoal)' : 'var(--pv-orange)';
  const dark = isInverso ? 'var(--pv-bone)' : 'var(--pv-charcoal)';
  const bone = isInverso ? 'var(--pv-charcoal)' : 'var(--pv-bone)';

  return (
    <div style={{
      width: size, height: size * 1.18, position: 'relative',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: dark,
    }}>
      <svg viewBox="0 0 400 470" width={size} height={size * 1.175} style={{ display: 'block', overflow: 'visible' }}>
        {/* ─── raios solares no topo (acima do escudo) ─── */}
        <g transform="translate(200 50)">
          {/* sol central */}
          <circle r="14" fill={dark} />
          <circle r="7" fill={fg} />
          {/* raios — alternando longos e curtos */}
          {Array.from({ length: 12 }).map((_, i) => {
            const ang = (i * 30) - 90;
            const long = i % 2 === 0;
            const r1 = 18, r2 = long ? 36 : 28;
            const rad = ang * Math.PI / 180;
            return (
              <line key={i}
                    x1={Math.cos(rad) * r1} y1={Math.sin(rad) * r1}
                    x2={Math.cos(rad) * r2} y2={Math.sin(rad) * r2}
                    stroke={dark} strokeWidth={long ? 4 : 2.5} strokeLinecap="round" />
            );
          })}
        </g>

        {/* ─── lanças atrás do escudo (saindo nas diagonais) ─── */}
        <g transform="translate(200 240)">
          <g transform="rotate(38)">
            <rect x="-3.5" y="-220" width="7" height="440" fill={dark} />
            {/* ponta superior — folha lascada larga */}
            <path d="M0 -240 L -18 -200 L -10 -188 L 0 -208 L 10 -188 L 18 -200 Z"
                  fill={dark} stroke={dark} strokeWidth="1.5" strokeLinejoin="miter" />
            {/* ranhuras na ponta */}
            <path d="M-10 -208 L 10 -208" stroke={bone} strokeWidth="1.2" />
            <path d="M-7 -218 L 7 -218" stroke={bone} strokeWidth="1.2" />
            {/* amarração de couro */}
            <rect x="-13" y="-180" width="26" height="3.5" fill={bone} />
            <rect x="-13" y="-172" width="26" height="3.5" fill={bone} />
            <rect x="-13" y="-164" width="26" height="3.5" fill={bone} />
            {/* cabo inferior */}
            <path d="M0 224 L -10 210 L 10 210 Z" fill={dark} />
            <rect x="-10" y="200" width="20" height="3" fill={bone} />
          </g>
          <g transform="rotate(-38)">
            <rect x="-3.5" y="-220" width="7" height="440" fill={dark} />
            <path d="M0 -240 L -18 -200 L -10 -188 L 0 -208 L 10 -188 L 18 -200 Z"
                  fill={dark} stroke={dark} strokeWidth="1.5" strokeLinejoin="miter" />
            <path d="M-10 -208 L 10 -208" stroke={bone} strokeWidth="1.2" />
            <path d="M-7 -218 L 7 -218" stroke={bone} strokeWidth="1.2" />
            <rect x="-13" y="-180" width="26" height="3.5" fill={bone} />
            <rect x="-13" y="-172" width="26" height="3.5" fill={bone} />
            <rect x="-13" y="-164" width="26" height="3.5" fill={bone} />
            <path d="M0 224 L -10 210 L 10 210 Z" fill={dark} />
            <rect x="-10" y="200" width="20" height="3" fill={bone} />
          </g>
        </g>

        {/* ─── escudo principal ─── */}
        <path d="M40 80
                 L 360 80
                 L 360 250
                 C 360 332, 326 392, 200 442
                 C 74 392, 40 332, 40 250
                 Z"
              fill={fg} stroke={dark} strokeWidth="7" strokeLinejoin="miter" />

        {/* segunda borda interna — cria moldura dupla */}
        <path d="M52 92
                 L 348 92
                 L 348 248
                 C 348 322, 318 378, 200 426
                 C 82 378, 52 322, 52 248
                 Z"
              fill="none" stroke={dark} strokeWidth="2" strokeDasharray="4 3" opacity="0.5" />

        {/* ─── faixa preta horizontal (PRIMITIVÃO) ─── */}
        <g>
          <rect x="40" y="106" width="320" height="50" fill={dark} />
          {/* dentes triangulares acima da faixa */}
          {Array.from({ length: 16 }).map((_, i) => {
            const x = 40 + i * 20;
            return <path key={'tu' + i} d={`M${x} 106 L${x + 10} 96 L${x + 20} 106 Z`} fill={dark} />;
          })}
          {/* nome */}
          <text x="200" y="140"
                fontFamily={display + ', "Rye", Impact, sans-serif'}
                fontSize="32" fontWeight="900" letterSpacing="2"
                fill={bone} textAnchor="middle">PRIMITIVÃO</text>
          {/* linha de pontos abaixo do nome (textura rupestre) */}
          {Array.from({ length: 9 }).map((_, i) => (
            <circle key={'dt' + i} cx={130 + i * 17.5} cy={150} r="1.2" fill={bone} opacity="0.7" />
          ))}
        </g>

        {/* ─── máscara central detalhada ─── */}
        <g transform="translate(200 290)">
          {/* sombra do escudo interna — leve gradiente em forma de círculo */}
          <ellipse cx="0" cy="-10" rx="115" ry="115" fill={dark} opacity="0.08" />

          {/* contorno máscara (formato alongado tipo africana) */}
          <path d="M0 -110
                   C -52 -110, -78 -76, -80 -22
                   C -82 24, -72 64, -52 96
                   C -36 122, -18 130, 0 130
                   C 18 130, 36 122, 52 96
                   C 72 64, 82 24, 80 -22
                   C 78 -76, 52 -110, 0 -110 Z"
                fill={dark} stroke={dark} strokeWidth="2" />

          {/* recorte interno — linha clara dentro pra dar profundidade */}
          <path d="M0 -100
                   C -44 -100, -68 -72, -70 -22
                   C -72 22, -64 60, -46 88
                   C -32 110, -16 118, 0 118
                   C 16 118, 32 110, 46 88
                   C 64 60, 72 22, 70 -22
                   C 68 -72, 44 -100, 0 -100 Z"
                fill="none" stroke={fg} strokeWidth="1.5" opacity="0.6" />

          {/* testa — marca tribal triangular */}
          <path d="M-20 -76 L 0 -90 L 20 -76 L 14 -64 L 0 -72 L -14 -64 Z" fill={bone} opacity="0.9" />
          <circle cx="0" cy="-58" r="2.5" fill={bone} />

          {/* olhos — triangulares descendentes (tipo arte rupestre) */}
          <path d="M-38 -36 L -10 -36 L -24 -10 Z" fill={bone} />
          <path d="M10 -36 L 38 -36 L 24 -10 Z" fill={bone} />
          {/* pupilas — pontos pretos */}
          <circle cx="-24" cy="-22" r="3" fill={dark} />
          <circle cx="24" cy="-22" r="3" fill={dark} />

          {/* nariz — barra fina com base triangular */}
          <rect x="-3" y="-8" width="6" height="34" fill={bone} opacity="0.85" />
          <path d="M-7 26 L 7 26 L 0 36 Z" fill={bone} opacity="0.85" />

          {/* boca — dentes em zigue-zague */}
          <path d="M-42 50
                   L -34 64 L -26 50 L -18 64 L -10 50 L -2 64 L 6 50 L 14 64 L 22 50 L 30 64 L 38 50 L 42 60
                   L 42 78 L -42 78 Z"
                fill={bone} />
          {/* linha de divisão dos dentes */}
          <path d="M-42 70 L 42 70" stroke={dark} strokeWidth="1" opacity="0.6" />

          {/* listras tribais nas bochechas */}
          <rect x="-66" y="0" width="14" height="3" fill={fg} />
          <rect x="-66" y="8" width="10" height="3" fill={fg} />
          <rect x="-64" y="16" width="6" height="3" fill={fg} />
          <rect x="52" y="0" width="14" height="3" fill={fg} />
          <rect x="56" y="8" width="10" height="3" fill={fg} />
          <rect x="58" y="16" width="6" height="3" fill={fg} />

          {/* pingentes / brincos — círculos pendurados */}
          <circle cx="-78" cy="40" r="4" fill={dark} stroke={bone} strokeWidth="1.5" />
          <circle cx="78" cy="40" r="4" fill={dark} stroke={bone} strokeWidth="1.5" />
          <line x1="-78" y1="32" x2="-78" y2="36" stroke={dark} strokeWidth="1.5" />
          <line x1="78" y1="32" x2="78" y2="36" stroke={dark} strokeWidth="1.5" />
        </g>

        {/* ─── pontos rupestres simétricos (lados do escudo) ─── */}
        <g fill={dark}>
          <circle cx="68" cy="200" r="3.5" />
          <circle cx="68" cy="220" r="2.5" />
          <circle cx="74" cy="240" r="2" />
          <circle cx="332" cy="200" r="3.5" />
          <circle cx="332" cy="220" r="2.5" />
          <circle cx="326" cy="240" r="2" />
        </g>

        {/* ─── fita inferior estilo banner medieval com chanfros ─── */}
        <g transform="translate(200 412)">
          {/* sombra atrás */}
          <path d="M-110 -2 L 110 -2 L 102 16 L 110 34 L -110 34 L -102 16 Z" fill={dark} opacity="0.18" />
          {/* fita principal */}
          <path d="M-108 -16
                   L 108 -16
                   L 96 0
                   L 108 16
                   L -108 16
                   L -96 0 Z"
                fill={dark} stroke={dark} strokeWidth="1" strokeLinejoin="miter" />
          {/* abas laterais (dobras) */}
          <path d="M-108 -16 L -120 -10 L -120 22 L -108 16 Z" fill={dark} opacity="0.7" />
          <path d="M108 -16 L 120 -10 L 120 22 L 108 16 Z" fill={dark} opacity="0.7" />
          {/* recorte triangular nas abas */}
          <path d="M-120 22 L -114 18 L -120 10 Z" fill={fg} opacity="0.4" />
          <path d="M120 22 L 114 18 L 120 10 Z" fill={fg} opacity="0.4" />
          {/* texto */}
          <text x="0" y="6"
                fontFamily="'Space Grotesk', system-ui, sans-serif"
                fontSize="13" fontWeight="800" letterSpacing="3.5"
                fill={bone} textAnchor="middle">SEASON I · 2026</text>
        </g>

        {/* ─── pequenas estrelinhas/marcações rupestres na fita ─── */}
        <g fill={fg}>
          <circle cx="92" cy="412" r="2" />
          <circle cx="308" cy="412" r="2" />
        </g>
      </svg>
    </div>
  );
}

// ─── LOGO HORIZONTAL / WORDMARK ────────────────────────────────────────────

function LogoHorizontal({ width = 440, palette = 'cor', display = 'Bungee Inline' }) {
  const isMono = palette === 'mono';
  const fg = isMono ? 'var(--pv-charcoal)' : 'var(--pv-orange)';
  const dark = 'var(--pv-charcoal)';
  const bone = 'var(--pv-bone)';
  return (
    <div style={{ width, display: 'flex', alignItems: 'center', gap: 18 }}>
      {/* mini-escudo */}
      <svg viewBox="0 0 100 120" width={68} height={82} style={{ flexShrink: 0 }}>
        <path d="M12 14 L 88 14 L 88 60 C 88 88, 80 102, 50 116 C 20 102, 12 88, 12 60 Z"
              fill={fg} stroke={dark} strokeWidth="4" />
        {/* mini máscara */}
        <ellipse cx="50" cy="58" rx="16" ry="22" fill={dark} />
        <path d="M40 50 L 48 50 L 44 58 Z" fill={bone} />
        <path d="M52 50 L 60 50 L 56 58 Z" fill={bone} />
        <path d="M40 70 L 44 76 L 48 70 L 52 76 L 56 70 L 60 76 L 60 80 L 40 80 Z" fill={bone} />
      </svg>
      {/* wordmark */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 0.85 }}>
        <div style={{
          fontFamily: display + ', Impact, sans-serif',
          fontSize: width * 0.118, fontWeight: 900, letterSpacing: '0.02em',
          color: dark,
        }}>PRIMITIVÃO</div>
        <div style={{
          fontFamily: '"Space Grotesk", system-ui, sans-serif',
          fontSize: width * 0.032, fontWeight: 700, letterSpacing: '0.32em',
          color: fg,
        }}>SEASON I · 2026 · 8 GUERREIROS</div>
      </div>
    </div>
  );
}

Object.assign(window, {
  MaskaTribal, LancasCruzadas, MaoRupestre, BolaRupestre, ChamaTribal,
  PadraoTribal, TexturaCaverna,
  LogoPrincipal, LogoHorizontal,
});
