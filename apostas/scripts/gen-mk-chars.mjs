// Gera ícones-símbolo SVG pra cada personagem de MK em apostas/mk-chars/<slug>.svg.
// Glifo branco em fundo TRANSPARENTE — o chip já tem a cor do personagem por trás.
// Rodar: node apostas/scripts/gen-mk-chars.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'mk-chars');
mkdirSync(OUT, { recursive: true });

const W = '#fff';
const D = '#241712'; // recortes escuros (olhos etc.)
// Cada glifo: markup SVG (branco, ~viewBox 40x40, centrado).
const G = {
  bolt:  `<path d="M23 6 L12 23 h7 l-3 11 L29 16 h-7 z" fill="${W}"/>`,
  flame: `<path d="M20 6 C26 13 27 16 27 21 a7 7 0 0 1-14 0 c0-4 3-7 4-9 c0 2 1 3 2 3 c-1-4 0-8 1-9z" fill="${W}"/>`,
  ice:   `<g stroke="${W}" stroke-width="2.4" stroke-linecap="round"><path d="M20 7v26"/><path d="M9 13.5l22 13"/><path d="M31 13.5l-22 13"/><path d="M20 7l-3.2 3.2M20 7l3.2 3.2M20 33l-3.2-3.2M20 33l3.2-3.2"/></g>`,
  blade: `<path d="M30 8 l-13 13 2.4 2.4 13-13z" fill="${W}"/><path d="M14.5 23.8 L10 30 l6.2-4.5z" fill="${W}"/><path d="M23 13l4 4" stroke="${W}" stroke-width="2.6" stroke-linecap="round"/>`,
  skull: `<path d="M20 8a10 10 0 0 0-10 10c0 4.2 2 6.4 3.2 7.6V29a2.4 2.4 0 0 0 2.4 2.4h8.8A2.4 2.4 0 0 0 26.8 29v-3.4C28 24.4 30 22.2 30 18A10 10 0 0 0 20 8z" fill="${W}"/><circle cx="16" cy="19" r="2.4" fill="${D}"/><circle cx="24" cy="19" r="2.4" fill="${D}"/><path d="M18 27v3M22 27v3" stroke="${D}" stroke-width="1.6"/>`,
  robot: `<rect x="11.5" y="11" width="17" height="18" rx="4.5" fill="${W}"/><rect x="15" y="17" width="10" height="3.4" rx="1.7" fill="${D}"/><path d="M20 11V6.5" stroke="${W}" stroke-width="2.2"/><circle cx="20" cy="5.6" r="1.8" fill="${W}"/>`,
  drop:  `<path d="M20 7c5.5 7.5 8.5 11.5 8.5 15.5a8.5 8.5 0 0 1-17 0C11.5 18.5 14.5 14.5 20 7z" fill="${W}"/>`,
  fan:   `<path d="M20 30 L9.5 15 a13 13 0 0 1 21 0 z" fill="${W}"/><path d="M20 30V13M14.5 15.5 20 30M25.5 15.5 20 30" stroke="${D}" stroke-width="1.3"/>`,
  star:  `<path d="M20 7l3.3 7.2 7.9.8-5.9 5.3 1.7 7.8L20 31.2 13 28.2l1.7-7.8-5.9-5.3 7.9-.8z" fill="${W}"/>`,
  cloud: `<path d="M13.5 27a5.2 5.2 0 0 1 .2-10.4 7.2 7.2 0 0 1 13.7-1.6A5.4 5.4 0 0 1 27 27z" fill="${W}"/>`,
  claw:  `<g stroke="${W}" stroke-width="2.6" fill="none" stroke-linecap="round"><path d="M13 10c2.2 6 3 12 1.8 21"/><path d="M20 9c1.1 7 1.1 13 0 22"/><path d="M27 10c-2.2 6-3 12-1.8 21"/></g>`,
  disc:  `<circle cx="20" cy="20" r="11.5" fill="none" stroke="${W}" stroke-width="3.2"/><circle cx="20" cy="20" r="3.2" fill="${W}"/>`,
};

// Personagem -> glifo (elemento/arma/tema).
const MAP = {
  'Ashrah': 'star', 'Baraka': 'claw', 'Conan': 'blade', 'Cyrax': 'robot',
  'Ermac': 'skull', 'General Shao': 'blade', 'Geras': 'disc', 'Ghostface': 'skull',
  'Havik': 'skull', 'Homelander': 'bolt', 'Johnny Cage': 'star', 'Kenshi': 'blade',
  'Kitana': 'fan', 'Kung Lao': 'disc', 'Li Mei': 'star', 'Liu Kang': 'flame',
  'Mileena': 'blade', 'Nitara': 'drop', 'Noob Saibot': 'skull', 'Omni-Man': 'bolt',
  'Peacemaker': 'disc', 'Quan Chi': 'skull', 'Raiden': 'bolt', 'Rain': 'drop',
  'Reptile': 'claw', 'Scorpion': 'flame', 'Sektor': 'robot', 'Shang Tsung': 'skull',
  'Sindel': 'star', 'Smoke': 'cloud', 'Sub-Zero': 'ice', 'T-1000': 'robot',
  'Takeda': 'bolt', 'Tanya': 'blade',
};

const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Mesma cor (hue) que o monograma usa no app — assim o ícone "veste" a cor do personagem.
const mkHue = (name) => { let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360; return h; };

let n = 0;
for (const [name, key] of Object.entries(MAP)) {
  const glyph = G[key];
  if (!glyph) { console.error('SEM GLIFO:', name, key); continue; }
  const hue = mkHue(name);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" aria-hidden="true">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">`
    + `<stop offset="0" stop-color="hsl(${hue},68%,56%)"/><stop offset="1" stop-color="hsl(${hue},60%,33%)"/></linearGradient></defs>`
    + `<rect x="0" y="0" width="40" height="40" rx="11" fill="url(#g)"/>`
    + `<g opacity="0.96">${glyph}</g></svg>\n`;
  writeFileSync(join(OUT, slug(name) + '.svg'), svg, 'utf8');
  n++;
}
console.log('Gerados', n, 'ícones em', OUT);
