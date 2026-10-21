/**
 * Original, deterministic product illustrations used in place of photography.
 * Each category has a still-life motif; the slug seeds tone and composition, and `view`
 * (0–3) produces the alternate gallery angles.
 */
const PALETTES: Record<string, { bg: string[]; ink: string; accent: string; soft: string }> = {
  rudraksha: { bg: ['#efe6da', '#e8dccb', '#f3ece2'], ink: '#5a3a24', accent: '#8b5a36', soft: '#c9a27c' },
  'consecrated-products': { bg: ['#f1e7d6', '#ecdcc0', '#f6efe3'], ink: '#6b4a1c', accent: '#b8862f', soft: '#e0b867' },
  'yoga-store': { bg: ['#e7e9e1', '#dfe3d6', '#eef0ea'], ink: '#3f4a3a', accent: '#6f7f5f', soft: '#a9b597' },
  'natural-food': { bg: ['#f0e9d8', '#e9dfc6', '#f5f0e4'], ink: '#5b4a28', accent: '#a07a2c', soft: '#d6bc7a' },
  'health-and-immunity': { bg: ['#e6ebe2', '#dce4d5', '#eef2ea'], ink: '#33503a', accent: '#5f8a5c', soft: '#a6c29a' },
  clothing: { bg: ['#ebe8e3', '#e2ddd5', '#f2efeb'], ink: '#3b3a45', accent: '#4c5a7a', soft: '#a2abc2' },
  'body-care': { bg: ['#f1e6e1', '#eadad2', '#f6eeea'], ink: '#5c3d36', accent: '#a46a5a', soft: '#d9ab9b' },
  'home-decor': { bg: ['#ece6dc', '#e3dacb', '#f3eee6'], ink: '#4a3f33', accent: '#9a6b3f', soft: '#cfae84' },
  books: { bg: ['#e9e6df', '#dfdbd1', '#f1eee8'], ink: '#33363b', accent: '#7a4f3a', soft: '#b9a99a' },
};

function hash(s: string) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

function motif(category: string, c: (typeof PALETTES)[string], h: number) {
  const v = (n: number) => (h >> n) & 0xff;
  switch (category) {
    case 'rudraksha': {
      const beads = 30 + (v(3) % 10);
      const r = 120 + (v(5) % 20);
      let out = '';
      for (let i = 0; i < beads; i++) {
        const a = (i / beads) * Math.PI * 2;
        const x = 300 + Math.cos(a) * r;
        const y = 300 + Math.sin(a) * r * 0.82;
        out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" fill="${c.accent}"/><circle cx="${(x - 3).toFixed(1)}" cy="${(y - 3).toFixed(1)}" r="3" fill="${c.soft}" opacity=".7"/>`;
      }
      return `${out}<path d="M300 ${300 + r * 0.82 + 10} q-6 40 0 70 q6 -30 0 -70" fill="none" stroke="${c.ink}" stroke-width="3"/><circle cx="300" cy="${300 + r * 0.82 + 84}" r="16" fill="${c.ink}"/>`;
    }
    case 'consecrated-products':
      return `<ellipse cx="300" cy="420" rx="120" ry="18" fill="${c.ink}" opacity=".18"/>
        <path d="M200 340 q100 90 200 0 z" fill="${c.accent}"/><rect x="285" y="380" width="30" height="34" fill="${c.accent}"/>
        <ellipse cx="300" cy="418" rx="70" ry="12" fill="${c.accent}"/>
        <path d="M300 245 c-26 40 -14 70 0 86 c14 -16 26 -46 0 -86z" fill="${c.soft}"/>
        <path d="M300 280 c-10 18 -6 34 0 42 c6 -8 10 -24 0 -42z" fill="#fff6dc"/>`;
    case 'yoga-store':
      return `<rect x="150" y="300" width="300" height="110" rx="55" fill="${c.accent}"/>
        <circle cx="395" cy="355" r="55" fill="${c.soft}"/><circle cx="395" cy="355" r="38" fill="none" stroke="${c.accent}" stroke-width="6"/>
        <circle cx="395" cy="355" r="20" fill="none" stroke="${c.accent}" stroke-width="5"/>
        <path d="M150 330 h220" stroke="${c.soft}" stroke-width="4" opacity=".6"/><path d="M150 380 h220" stroke="${c.soft}" stroke-width="4" opacity=".6"/>`;
    case 'natural-food':
      return `<ellipse cx="300" cy="440" rx="110" ry="14" fill="${c.ink}" opacity=".15"/>
        <rect x="215" y="230" width="170" height="210" rx="34" fill="${c.soft}"/>
        <rect x="230" y="205" width="140" height="36" rx="8" fill="${c.accent}"/>
        <rect x="240" y="300" width="120" height="70" rx="6" fill="#fbf6ea"/>
        <circle cx="300" cy="335" r="18" fill="${c.accent}" opacity=".7"/>`;
    case 'health-and-immunity':
      return `<path d="M300 180 c90 40 110 150 0 230 c-110 -80 -90 -190 0 -230z" fill="${c.accent}"/>
        <path d="M300 200 v200" stroke="${c.soft}" stroke-width="5"/>
        ${[240, 280, 320, 360].map((y, i) => `<path d="M300 ${y} l${i % 2 ? 45 : -45} -30" stroke="${c.soft}" stroke-width="4"/>`).join('')}
        <ellipse cx="300" cy="440" rx="90" ry="12" fill="${c.ink}" opacity=".15"/>`;
    case 'clothing':
      return `<path d="M230 190 l-70 50 l30 50 l40 -20 v190 h140 v-190 l40 20 l30 -50 l-70 -50 q-30 30 -70 0z" fill="${c.accent}"/>
        <path d="M270 190 q30 30 60 0" fill="none" stroke="${c.soft}" stroke-width="5"/>
        <path d="M300 220 v100" stroke="${c.soft}" stroke-width="3" stroke-dasharray="6 8"/>`;
    case 'body-care':
      return `<rect x="170" y="330" width="150" height="90" rx="28" fill="${c.soft}"/><rect x="190" y="350" width="110" height="50" rx="18" fill="#fbf1ec" opacity=".6"/>
        <rect x="340" y="230" width="90" height="190" rx="22" fill="${c.accent}"/><rect x="362" y="195" width="46" height="40" rx="6" fill="${c.ink}"/>
        <ellipse cx="300" cy="430" rx="140" ry="12" fill="${c.ink}" opacity=".15"/>`;
    case 'home-decor':
      return `<path d="M250 210 h100 q-10 40 30 90 q40 70 -20 130 h-120 q-60 -60 -20 -130 q40 -50 30 -90z" fill="${c.accent}"/>
        <path d="M270 300 q30 20 60 0" fill="none" stroke="${c.soft}" stroke-width="5"/>
        <path d="M300 210 q-20 -50 -60 -70 M300 210 q10 -60 50 -80" stroke="${c.ink}" stroke-width="4" fill="none"/>
        <ellipse cx="300" cy="438" rx="110" ry="12" fill="${c.ink}" opacity=".15"/>`;
    default:
      return `<rect x="190" y="360" width="230" height="44" rx="4" fill="${c.accent}"/>
        <rect x="205" y="316" width="210" height="44" rx="4" fill="${c.soft}"/>
        <rect x="180" y="272" width="240" height="44" rx="4" fill="${c.ink}"/>
        <path d="M200 294 h180" stroke="${c.soft}" stroke-width="3"/>
        <ellipse cx="300" cy="412" rx="140" ry="10" fill="${c.ink}" opacity=".15"/>`;
  }
}

// Keyword motifs so items within one category are visually distinguishable.
const KEYWORD_MOTIFS: [RegExp, (c: (typeof PALETTES)[string]) => string][] = [
  [/bottle|jug|oil(?!-sesame)|hair-oil/, (c) => `<rect x="250" y="230" width="100" height="200" rx="26" fill="${c.accent}"/><rect x="278" y="185" width="44" height="52" rx="8" fill="${c.ink}"/><rect x="262" y="300" width="76" height="60" rx="6" fill="#fbf6ea" opacity=".85"/><ellipse cx="300" cy="440" rx="100" ry="12" fill="${c.ink}" opacity=".15"/>`],
  [/block|soap|bar-/, (c) => `<path d="M190 330 l110 -50 l110 50 l-110 50z" fill="${c.soft}"/><path d="M190 330 v70 l110 50 v-70z" fill="${c.accent}"/><path d="M410 330 v70 l-110 50 v-70z" fill="${c.ink}" opacity=".55"/>`],
  [/strap|wick|thread|cord/, (c) => `<path d="M170 380 C 230 220, 330 460, 430 260" fill="none" stroke="${c.accent}" stroke-width="22" stroke-linecap="round"/><rect x="410" y="235" width="40" height="40" rx="8" fill="none" stroke="${c.ink}" stroke-width="8"/>`],
  [/cushion|bolster|pillow/, (c) => `<ellipse cx="300" cy="350" rx="160" ry="70" fill="${c.accent}"/><ellipse cx="300" cy="330" rx="150" ry="55" fill="${c.soft}"/><circle cx="300" cy="330" r="10" fill="${c.ink}" opacity=".5"/>`],
  [/bag|pouch/, (c) => `<path d="M210 280 h180 l-20 170 h-140z" fill="${c.accent}"/><path d="M250 280 q50 -90 100 0" fill="none" stroke="${c.ink}" stroke-width="8"/><path d="M220 330 h160" stroke="${c.soft}" stroke-width="4"/>`],
  [/tea|latte|infusion/, (c) => `<path d="M220 300 h160 v70 a80 80 0 0 1 -160 0z" fill="${c.accent}"/><path d="M380 320 a30 30 0 0 1 0 60" fill="none" stroke="${c.accent}" stroke-width="12"/><path d="M270 270 q15 -25 0 -50 M310 270 q15 -25 0 -50" stroke="${c.soft}" stroke-width="6" fill="none"/><ellipse cx="300" cy="455" rx="120" ry="12" fill="${c.ink}" opacity=".15"/>`],
  [/millet|flakes|jaggery|makhana|powder|turmeric|pongal|mix/, (c) => `<path d="M220 250 h160 l20 200 h-200z" fill="${c.soft}"/><path d="M220 250 l20 -30 h120 l20 30" fill="${c.accent}"/><circle cx="300" cy="350" r="34" fill="${c.accent}" opacity=".75"/>`],
  [/bracelet|wrist/, (c) => Array.from({ length: 18 }, (_, i) => { const a = (i / 18) * Math.PI * 2; return `<circle cx="${(300 + Math.cos(a) * 90).toFixed(1)}" cy="${(320 + Math.sin(a) * 60).toFixed(1)}" r="13" fill="${c.accent}"/>`; }).join('')],
  [/pendant|single-rudraksha|panchamukhi/, (c) => `<path d="M220 170 q80 160 160 0" fill="none" stroke="${c.ink}" stroke-width="3"/><circle cx="300" cy="300" r="40" fill="${c.accent}"/><circle cx="288" cy="288" r="10" fill="${c.soft}" opacity=".7"/>`],
  [/rug|runner|cover|stole|wall-hanging|macram/, (c) => `<rect x="170" y="230" width="260" height="200" rx="10" fill="${c.soft}"/>${[0, 1, 2, 3].map((i) => `<rect x="170" y="${250 + i * 45}" width="260" height="14" fill="${c.accent}" opacity=".75"/>`).join('')}`],
  [/planter|urli|bowl|plate|diya/, (c) => `<ellipse cx="300" cy="330" rx="150" ry="40" fill="${c.soft}"/><path d="M150 330 q150 160 300 0" fill="${c.accent}"/><ellipse cx="300" cy="450" rx="110" ry="12" fill="${c.ink}" opacity=".15"/>`],
  [/incense|dhoop|holder/, (c) => `<rect x="180" y="410" width="240" height="18" rx="9" fill="${c.ink}"/>${[0, 1, 2].map((i) => `<path d="M${260 + i * 40} 410 l${-30 + i * 30} -180" stroke="${c.accent}" stroke-width="7" stroke-linecap="round"/>`).join('')}<path d="M300 220 q20 -30 0 -60 q-20 -30 0 -60" fill="none" stroke="${c.soft}" stroke-width="4"/>`],
  [/journal|book/, (c) => `<rect x="200" y="200" width="200" height="250" rx="8" fill="${c.accent}"/><rect x="215" y="215" width="170" height="220" rx="4" fill="none" stroke="${c.soft}" stroke-width="3"/><rect x="250" y="270" width="100" height="10" fill="${c.soft}"/>`],
  [/pants|dhoti/, (c) => `<path d="M220 200 h160 l20 260 h-75 l-25 -170 l-25 170 h-75z" fill="${c.accent}"/><path d="M220 225 h160" stroke="${c.soft}" stroke-width="6"/>`],
  [/tee|shirt/, (c) => `<path d="M230 200 l-80 50 l30 50 l50 -25 v175 h140 v-175 l50 25 l30 -50 l-80 -50 q-30 25 -70 0z" fill="${c.accent}"/><path d="M270 200 q30 25 60 0" fill="none" stroke="${c.soft}" stroke-width="5"/>`],
];

export function productArt(slug: string, category: string, view: number) {
  const c = PALETTES[category] ?? PALETTES.books;
  const h = hash(`${slug}:${view}`);
  const bg = c.bg[h % c.bg.length];
  const scale = [1, 1.25, 0.85, 1.1][view % 4];
  const rot = [0, -8, 6, 0][view % 4];
  const dx = [0, -30, 25, 0][view % 4];
  const sun = 120 + (h % 340);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600" role="img">
  <defs><radialGradient id="g" cx="${sun / 600}" cy="0.25" r="0.9"><stop offset="0" stop-color="#ffffff" stop-opacity=".55"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs>
  <rect width="600" height="600" fill="${bg}"/><rect width="600" height="600" fill="url(#g)"/>
  ${view === 3 ? `<rect x="0" y="440" width="600" height="160" fill="${c.soft}" opacity=".25"/>` : ''}
  <g transform="translate(${300 + dx} 300) rotate(${rot}) scale(${scale}) translate(-300 -300)">${(KEYWORD_MOTIFS.find(([re]) => re.test(slug))?.[1](c)) ?? motif(category, c, h)}</g>
</svg>`;
}
