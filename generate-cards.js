const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ARTISTS = [
  { index: 0, count: 12, color: '#f59e0b', prefix: 'UNIT' },
  { index: 1, count: 13, color: '#ec4899', prefix: 'VOL' },
  { index: 2, count: 14, color: '#10b981', prefix: 'ARC' },
  { index: 3, count: 15, color: '#3b82f6', prefix: 'STAGE' },
  { index: 4, count: 16, color: '#a855f7', prefix: '編號' },
];

function stripOuterXml(svgStr) {
  return svgStr.replace(/<\?xml[^>]*\?>/gi, '').trim();
}

function buildOverlayDecoration(artistIndex, serial, cardNum) {
  const s = serial * 19 + cardNum * 7;
  const pad = String(serial).padStart(2, '0');

  if (artistIndex === 0) {
    // 1980s Genga red/blue construction hairlines & unit stamp
    const yLine = 25 + (s % 130);
    const xLine = 35 + ((s * 3) % 210);
    return `
      <g opacity="0.72" stroke-linecap="round">
        <line x1="8" y1="${yLine}" x2="292" y2="${(yLine + 24) % 190}" stroke="#dc2626" stroke-width="1.3" stroke-dasharray="6 4"/>
        <line x1="${xLine}" y1="6" x2="${(xLine + 40) % 280}" y2="194" stroke="#2563eb" stroke-width="1.3" stroke-dasharray="5 3"/>
        <circle cx="${28 + (s % 25)}" cy="${30 + (s % 25)}" r="${12 + (s % 10)}" fill="none" stroke="#dc2626" stroke-width="1.2"/>
      </g>
      <rect x="218" y="170" width="72" height="20" rx="4" fill="rgba(15,23,42,0.78)" stroke="#f59e0b" stroke-width="1.2"/>
      <text x="254" y="184" text-anchor="middle" font-family="monospace" font-size="11" font-weight="bold" fill="#fde047">UNIT-${pad}</text>
    `;
  }

  if (artistIndex === 1) {
    // Watercolor bloom circles & ribbon curve + VOL stamp
    const cx1 = 35 + (s % 60);
    const cy1 = 35 + ((s * 2) % 90);
    const cx2 = 225 + (s % 50);
    const cy2 = 40 + ((s * 3) % 100);
    return `
      <g opacity="0.45">
        <circle cx="${cx1}" cy="${cy1}" r="${22 + (s % 16)}" fill="#f472b6"/>
        <circle cx="${cx2}" cy="${cy2}" r="${18 + (s % 18)}" fill="#fb7185"/>
        <path d="M10,${145 - (s % 50)} Q150,${20 + (s % 70)} 290,${130 - (s % 45)}" fill="none" stroke="#fbcfe8" stroke-width="3"/>
      </g>
      <rect x="220" y="170" width="70" height="20" rx="10" fill="rgba(131,24,67,0.82)" stroke="#f472b6" stroke-width="1.2"/>
      <text x="255" y="184" text-anchor="middle" font-family="Georgia, serif" font-size="11" font-weight="bold" fill="#fce7f3">VOL.${pad}</text>
    `;
  }

  if (artistIndex === 2) {
    // Emerald arcane magic circle & runes + ARC stamp
    const rot = (serial * 25) % 360;
    return `
      <g transform="translate(150 96) rotate(${rot})" opacity="0.58">
        <circle cx="0" cy="0" r="82" fill="none" stroke="#34d399" stroke-width="1.6" stroke-dasharray="10 5"/>
        <circle cx="0" cy="0" r="66" fill="none" stroke="#a7f3d0" stroke-width="1"/>
        <polygon points="0,-78 67,39 -67,39" fill="none" stroke="#10b981" stroke-width="1.4"/>
      </g>
      <rect x="218" y="170" width="72" height="20" rx="4" fill="rgba(6,78,59,0.84)" stroke="#34d399" stroke-width="1.2"/>
      <text x="254" y="184" text-anchor="middle" font-family="serif" font-size="11" font-weight="bold" fill="#d1fae5">ARC-${pad}</text>
    `;
  }

  if (artistIndex === 3) {
    // Risograph halftone grid & CRT scan ticks + STAGE stamp
    const patId = `dots_${cardNum}`;
    return `
      <defs>
        <pattern id="${patId}" width="10" height="10" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="3" r="1.4" fill="#3b82f6" opacity="0.38"/>
        </pattern>
      </defs>
      <rect x="8" y="8" width="284" height="184" fill="url(#${patId})" opacity="0.65"/>
      <path d="M12,28 L12,12 L28,12 M272,12 L288,12 L288,28 M12,172 L12,188 L28,188" fill="none" stroke="#60a5fa" stroke-width="2.5"/>
      <rect x="208" y="170" width="82" height="20" rx="2" fill="rgba(15,23,42,0.88)" stroke="#60a5fa" stroke-width="1.4"/>
      <text x="249" y="184" text-anchor="middle" font-family="monospace" font-size="10.5" font-weight="bold" fill="#93c5fd">STAGE ${pad}</text>
    `;
  }

  // Artist 4: Crescent moon, camellia petals & red hanko seal
  const moonX = 36 + (s % 45);
  const moonY = 38 + ((s * 2) % 35);
  return `
    <g opacity="0.72">
      <circle cx="${moonX}" cy="${moonY}" r="20" fill="#c084fc" opacity="0.45"/>
      <circle cx="${moonX + 7}" cy="${moonY - 4}" r="16" fill="#0f0b18" opacity="0.55"/>
      <circle cx="262" cy="${40 + (s % 80)}" r="6" fill="#e11d48" opacity="0.7"/>
      <circle cx="245" cy="${70 + ((s * 3) % 70)}" r="4.5" fill="#fb7185" opacity="0.65"/>
    </g>
    <rect x="228" y="164" width="60" height="26" rx="3" fill="#991b1b" stroke="#fca5a5" stroke-width="1.4"/>
    <text x="258" y="181" text-anchor="middle" font-family="serif" font-size="11.5" font-weight="bold" fill="#fef2f2">編號${pad}</text>
  `;
}

async function main() {
  const { createAvatar } = await import('@dicebear/core');
  const collection = await import('@dicebear/collection');

  const outDir = path.join(__dirname, 'public', 'assets', 'cards');
  fs.mkdirSync(outDir, { recursive: true });

  const hashes = new Set();
  let seq = 1;

  for (const artist of ARTISTS) {
    for (let i = 0; i < artist.count; i++) {
      const cardNum = seq++;
      const serial = i + 1;
      const seed = `acg-modern-art-a${artist.index}-c${cardNum}-s${serial}-salt${cardNum * 37}`;

      let style;
      if (artist.index === 0) {
        style = collection.bottts;
      } else if (artist.index === 1) {
        style = collection.lorelei;
      } else if (artist.index === 2) {
        style = collection.adventurer;
      } else if (artist.index === 3) {
        style = collection.pixelArt;
      } else {
        style = i < 8 ? collection.openPeeps : collection.notionists;
      }

      const avatar = createAvatar(style, {
        seed,
        size: 184,
        backgroundColor: ['transparent'],
      });

      const rawAvatarSvg = stripOuterXml(avatar.toString());
      const innerAvatarSvg = rawAvatarSvg.replace(/^<svg\b([^>]*)>/i, (_match, attrs) => {
        const cleaned = attrs
          .replace(/\s+(?:width|height|x|y)="[^"]*"/gi, '')
          .trim();
        return `<svg x="58" y="6" width="184" height="184" ${cleaned}>`;
      });

      const composedSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200" width="300" height="200">
  ${buildOverlayDecoration(artist.index, serial, cardNum)}
  ${innerAvatarSvg}
</svg>`;

      const outPath = path.join(outDir, `card_${cardNum}.svg`);
      fs.writeFileSync(outPath, composedSvg, 'utf8');

      const hash = crypto.createHash('sha256').update(composedSvg).digest('hex');
      hashes.add(hash);
    }
  }

  console.log(`Generated ${seq - 1} SVG card artworks in ${outDir}`);
  console.log(`Unique SHA-256 hashes: ${hashes.size}`);
  if (hashes.size !== 70 || seq - 1 !== 70) {
    throw new Error(`Expected 70 unique card SVGs, got ${hashes.size}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
