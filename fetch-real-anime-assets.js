const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ZIP_URL = 'http://219.94.233.91/jewel-s/jewel-s-free101j.zip';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function getPngDimensions(buf) {
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') {
    return null;
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

async function fetchRange(url, start, end) {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}`, 'User-Agent': UA } });
  if (!res.ok && res.status !== 206) {
    throw new Error(`HTTP ${res.status} for range ${start}-${end}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function readZipIndex() {
  const head = await fetch(ZIP_URL, { method: 'HEAD', headers: { 'User-Agent': UA } });
  const total = Number(head.headers.get('content-length'));
  const tailSize = 262144;
  const tailBuf = await fetchRange(ZIP_URL, total - tailSize, total - 1);

  let eocd = -1;
  for (let i = tailBuf.length - 22; i >= 0; i--) {
    if (tailBuf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('EOCD not found in ZIP');

  const cdSize = tailBuf.readUInt32LE(eocd + 12);
  const cdOffset = tailBuf.readUInt32LE(eocd + 16);
  const cdBuf = await fetchRange(ZIP_URL, cdOffset, cdOffset + cdSize - 1);

  const entries = new Map();
  const dec = new TextDecoder('shift-jis');
  let pos = 0;
  while (pos < cdBuf.length && cdBuf.readUInt32LE(pos) === 0x02014b50) {
    const compMethod = cdBuf.readUInt16LE(pos + 10);
    const compSize = cdBuf.readUInt32LE(pos + 20);
    const nameLen = cdBuf.readUInt16LE(pos + 28);
    const extraLen = cdBuf.readUInt16LE(pos + 30);
    const commentLen = cdBuf.readUInt16LE(pos + 32);
    const localHeaderOffset = cdBuf.readUInt32LE(pos + 42);
    const name = dec.decode(cdBuf.subarray(pos + 46, pos + 46 + nameLen));
    entries.set(name, { name, compMethod, compSize, localHeaderOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function extractEntry(entry) {
  const end = entry.localHeaderOffset + 512 + entry.compSize;
  const buf = await fetchRange(ZIP_URL, entry.localHeaderOffset, end);
  const nLen = buf.readUInt16LE(26);
  const eLen = buf.readUInt16LE(28);
  const dataStart = 30 + nLen + eLen;
  const compData = buf.subarray(dataStart, dataStart + entry.compSize);
  return entry.compMethod === 8 ? zlib.inflateRawSync(compData) : compData;
}

async function fetchWataokibaCandidates() {
  const all = [];
  for (let p = 1; p <= 4; p++) {
    const res = await fetch(`https://wataokiba.net/wp-json/wp/v2/media?per_page=100&page=${p}`, {
      headers: { 'User-Agent': UA },
    });
    if (!res.ok) break;
    all.push(...(await res.json()));
  }

  // Pick one clean full-color (_a) character pose per character group
  const preferredFiles = [
    { file: 'josei_20_a-1.png', artist: 3, title: '連帽衛衣少女・小凜' },
    { file: 'dansei_16_a.png', artist: 3, title: '針織外套少年・悠真' },
    { file: 'dansei_15_a.png', artist: 3, title: '領結學員・蒼太' },
    { file: 'dansei_14_a.png', artist: 3, title: '吊帶潮男・蓮' },
    { file: 'josei_16_a.png', artist: 3, title: '導覽領航員・千尋' },
    { file: 'dansei_10_b_a.png', artist: 3, title: '街頭少年・朔' },
    { file: 'dansei_08_m_a.png', artist: 3, title: '眼鏡電玩部員・真司' },
    { file: 'dansei_09_a.png', artist: 3, title: '學生會書記・柊' },
    { file: 'josei_15_01_a.png', artist: 2, title: '銀髮聖騎士・亞絲娜風' },
    { file: 'josei_18_01_a.png', artist: 2, title: '純白羽翼天使・賽拉' },
    { file: 'josei_17_a.png', artist: 2, title: '雪女冰晶法師・雪音' },
    { file: 'josei_13_a.png', artist: 2, title: '深海人魚姬・瑪琳' },
    { file: 'josei_19_01_a.png', artist: 4, title: '小惡魔降臨・莉莉絲' },
    { file: 'josei_14_o1_a.png', artist: 4, title: '狐面和服巫女・咲夜' },
    { file: 'dansei_11_o1_a.png', artist: 4, title: '狐面和服陰陽師・晴明' },
    { file: 'dansei_13_a.png', artist: 4, title: '道符殭屍少年・小黒' },
    { file: 'dansei_12_a.png', artist: 4, title: '蒼藍符咒師・墨塵' },
  ];

  const urlMap = new Map();
  for (const m of all) {
    const file = m.source_url.split('/').pop();
    if (!urlMap.has(file)) urlMap.set(file, m.source_url);
  }

  const results = [];
  for (const item of preferredFiles) {
    const url = urlMap.get(item.file);
    if (!url) continue;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    const dims = getPngDimensions(buf);
    // Reject square multi-face preview sheets (keep portrait character illustrations)
    if (!dims || dims.width >= dims.height * 0.95) continue;
    results.push({ ...item, buf, source: 'わたおきば (Wataokiba)' });
  }
  return results;
}

async function main() {
  const assetsDir = path.join(__dirname, 'public', 'assets');
  const cardsDir = path.join(assetsDir, 'cards');
  const avatarsDir = path.join(assetsDir, 'avatars');
  fs.mkdirSync(cardsDir, { recursive: true });
  fs.mkdirSync(avatarsDir, { recursive: true });

  // Clean old test_*.png and old card_*.svg files
  for (const f of fs.readdirSync(assetsDir)) {
    if (f.startsWith('test_') && f.endsWith('.png')) {
      fs.unlinkSync(path.join(assetsDir, f));
    }
  }
  for (const f of fs.readdirSync(cardsDir)) {
    if (f.endsWith('.svg')) {
      fs.unlinkSync(path.join(cardsDir, f));
    }
  }

  console.log('1. Reading JewelSavior FREE ZIP index...');
  const entries = await readZipIndex();
  const csvEntry = entries.get('jewel-s-free101j/text_data/chara_data.csv');
  const csvBuf = await extractEntry(csvEntry);
  const csvText = new TextDecoder('shift-jis').decode(csvBuf);

  const jewelRows = csvText
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const p = line.split(',');
      return {
        cardId: p[0],
        imageId: p[1],
        name: p[2],
        sex: p[4],
        charaId: p[5],
        stone: p[6],
        skill: p[8],
        rank: Number(p[9]) || 1,
      };
    })
    .filter((r) => r.imageId && r.imageId.startsWith('f') && entries.has(`jewel-s-free101j/image/character/${r.imageId}.png`));

  // Sort highest rank first, keeping distinct character_id where possible so every card looks distinct
  const sortedRows = [...jewelRows].sort((a, b) => b.rank - a.rank || Number(a.cardId) - Number(b.cardId));

  console.log('2. Fetching Wataokiba clean character portraits...');
  const wataList = await fetchWataokibaCandidates();
  console.log(`   Verified ${wataList.length} clean portrait PNGs from Wataokiba.`);

  const usedImageIds = new Set();
  const usedCharaIds = new Set();

  function pickJewel(predicate, needed) {
    const picked = [];
    // Pass 1: unique charaId
    for (const r of sortedRows) {
      if (picked.length >= needed) break;
      if (usedImageIds.has(r.imageId) || usedCharaIds.has(r.charaId)) continue;
      if (predicate(r)) {
        usedImageIds.add(r.imageId);
        usedCharaIds.add(r.charaId);
        picked.push(r);
      }
    }
    // Pass 2: fallback allowing transformed alt form (still distinct imageId!)
    for (const r of sortedRows) {
      if (picked.length >= needed) break;
      if (usedImageIds.has(r.imageId)) continue;
      if (predicate(r)) {
        usedImageIds.add(r.imageId);
        picked.push(r);
      }
    }
    return picked;
  }

  // Artist 0 (12 cards): High-rank heroes & action/mecha-vibe characters (Garnet, Diamond, Sapphire, Spinel, Alexandrite, etc.)
  const a0Jewel = pickJewel(
    (r) => r.rank >= 4 && /アレキ|ダイヤ|サファイア|ルビー|トパーズ|ガーネット|オニキス|タイガー/.test(r.stone),
    12
  );
  while (a0Jewel.length < 12) a0Jewel.push(...pickJewel((r) => r.rank >= 4, 12 - a0Jewel.length));

  // Artist 1 (13 cards): Female idol / sakura / jewel heroines
  const a1Jewel = pickJewel(
    (r) => r.sex === 'female' && r.rank >= 3 && /アクア|オパール|パール|ピンク|ルビー|ローズ|コーラル|クリスタル/.test(r.stone),
    13
  );
  while (a1Jewel.length < 13) a1Jewel.push(...pickJewel((r) => r.sex === 'female' && r.rank >= 3, 13 - a1Jewel.length));

  // Artist 2 (14 cards): Fantasy Wataokiba (4) + JewelSavior Emerald/Nature/Fantasy (10)
  const a2Wata = wataList.filter((w) => w.artist === 2).slice(0, 4);
  const a2Jewel = pickJewel(
    (r) => /エメラルド|グリーン|ペリドット|フローライト|ムーン|ジェイド|ターコイズ/.test(r.stone) || r.rank >= 4,
    14 - a2Wata.length
  );

  // Artist 3 (15 cards): Modern/Urban Wataokiba + JewelSavior
  const a3Wata = wataList.filter((w) => w.artist === 3).slice(0, 8);
  const a3Jewel = pickJewel((r) => r.rank >= 3, 15 - a3Wata.length);

  // Artist 4 (16 cards): Occult/Dark Wataokiba + JewelSavior Obsidian/Amethyst/Morion/Bloodstone
  const a4Wata = wataList.filter((w) => w.artist === 4).slice(0, 5);
  const a4Jewel = pickJewel(
    (r) => /オブシディアン|アメジスト|モリオン|ブラッド|ラピス|オニキス/.test(r.stone) || r.rank >= 4,
    16 - a4Wata.length
  );
  while (a4Jewel.length < 16 - a4Wata.length) {
    a4Jewel.push(...pickJewel(() => true, 16 - a4Wata.length - a4Jewel.length));
  }

  const buckets = [
    a0Jewel.map((r) => ({ type: 'jewel', ...r })),
    a1Jewel.map((r) => ({ type: 'jewel', ...r })),
    [...a2Wata.map((w) => ({ type: 'wata', ...w })), ...a2Jewel.map((r) => ({ type: 'jewel', ...r }))],
    [...a3Wata.map((w) => ({ type: 'wata', ...w })), ...a3Jewel.map((r) => ({ type: 'jewel', ...r }))],
    [...a4Wata.map((w) => ({ type: 'wata', ...w })), ...a4Jewel.map((r) => ({ type: 'jewel', ...r }))],
  ];

  const cardMetadata = {};
  const hashes = new Set();
  let seq = 1;

  console.log('3. Extracting 70 unique PNG cards...');
  for (let aIdx = 0; aIdx < 5; aIdx++) {
    const items = buckets[aIdx];
    for (let i = 0; i < items.length; i++) {
      const cardNum = seq++;
      const item = items[i];
      let buf;
      let title;
      let source;

      if (item.type === 'wata') {
        buf = item.buf;
        title = item.title;
        source = item.source;
      } else {
        const entry = entries.get(`jewel-s-free101j/image/character/${item.imageId}.png`);
        buf = await extractEntry(entry);
        title = item.skill ? `${item.name}《${item.skill}》` : `${item.name}（${item.stone}）`;
        source = '星宝転生ジュエルセイバー FREE';
      }

      const outPath = path.join(cardsDir, `card_${cardNum}.png`);
      fs.writeFileSync(outPath, buf);
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      hashes.add(hash);

      cardMetadata[cardNum] = { title, source };

      // Also save first card of each artist as artist_X.png
      if (i === 0) {
        fs.writeFileSync(path.join(assetsDir, `artist_${aIdx}.png`), buf);
      }
    }
  }

  console.log('4. Extracting 10 anime player avatars...');
  const avatarCandidates = sortedRows.filter((r) => r.rank >= 4).slice(0, 10);
  for (let i = 0; i < avatarCandidates.length; i++) {
    const iconEntry = entries.get(`jewel-s-free101j/image/icon/${avatarCandidates[i].imageId}.png`);
    const iconBuf = await extractEntry(iconEntry);
    fs.writeFileSync(path.join(avatarsDir, `avatar_${i}.png`), iconBuf);
  }

  fs.writeFileSync(path.join(__dirname, 'cardMetadata.json'), JSON.stringify(cardMetadata, null, 2), 'utf8');

  console.log(`Done! Saved ${seq - 1} real anime card PNGs, unique SHA-256 hashes: ${hashes.size}`);
  if (seq - 1 !== 70 || hashes.size !== 70) {
    throw new Error(`Expected 70 unique PNG cards, got ${hashes.size}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
