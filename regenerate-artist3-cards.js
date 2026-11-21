const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_DIR = __dirname;
const CARDS_DIR = path.join(PROJECT_DIR, 'public', 'assets', 'cards');
const AVATARS_DIR = path.join(PROJECT_DIR, 'public', 'assets', 'avatars');
const META_PATH = path.join(PROJECT_DIR, 'cardMetadata.json');

const ARTIST3_PORTRAIT_STYLE =
  'Japanese high-fantasy RPG character artbook bust portrait in the style of Akihiko Yoshida and Granblue Fantasy, beautiful 2D anime girl with clear detailed anime eyes, intricate cross-hatching and expressive pencil-and-gouache brushwork, ornate emerald-green and gold filigree, warm antique cream parchment paper background';

const ARTIST3_NEGATIVE =
  'glossy 3D render, oily plastic skin, realistic western face, male face, beard, distant full body, tiny face, blurry face, deformed hands, extra fingers, manuscript text, fake text, calligraphy, book columns, dark background, neon, watermark, signature';

const MODELS = ['Rev Animated', 'Deliberate 3.0', 'Deliberate', 'Dreamshaper', 'Lyriel'];

const TARGET_CARDS = [
  {
    cardNumber: 27,
    title: '風精靈契約・翠翼精靈',
    prompt: `${ARTIST3_PORTRAIT_STYLE}, upper-body bust portrait of an elegant anime elven archer maiden with silver hair, feathered emerald hood, and golden filigree pauldron on warm antique parchment background ### ${ARTIST3_NEGATIVE}`,
  },
  {
    cardNumber: 31,
    title: '星盤塔的占星賢者',
    prompt: `${ARTIST3_PORTRAIT_STYLE}, upper-body bust portrait of a serene anime female astrologer mage with long braided hair, golden circlet, and emerald-and-gold embroidered cloak surrounded by delicate brass astrolabe rings on warm antique parchment background ### ${ARTIST3_NEGATIVE}`,
  },
  {
    cardNumber: 32,
    title: '迷霧濕地的吟遊豎琴師',
    prompt: `${ARTIST3_PORTRAIT_STYLE}, upper-body bust portrait of a charming anime female bard wearing an ornate emerald cavalier hat with a white feather and gold-embroidered cape on warm antique parchment background ### ${ARTIST3_NEGATIVE}`,
  },
  {
    cardNumber: 34,
    title: '古代魔導書庫的守護者',
    prompt: `${ARTIST3_PORTRAIT_STYLE}, upper-body bust portrait of a cute anime female scholar mage wearing round spectacles and an ornate emerald-and-gold high-collared robe with intricate golden runes on warm antique parchment background ### ${ARTIST3_NEGATIVE}, holding stick, deformed hand`,
  },
  {
    cardNumber: 36,
    title: '荊棘王冠的森林德魯伊',
    prompt: `${ARTIST3_PORTRAIT_STYLE}, upper-body bust portrait of a graceful anime forest druid maiden wearing a golden leaf-and-emerald crown and ornate green velvet cloak with botanical gold filigree border on warm antique parchment background ### ${ARTIST3_NEGATIVE}`,
  },
  {
    cardNumber: 37,
    title: '發條魔偶與工坊少女',
    prompt: `${ARTIST3_PORTRAIT_STYLE}, upper-body bust portrait of an anime female royal clockwork alchemist wearing brass goggles on her forehead and an emerald-green velvet coat with ornate golden gear filigree on warm antique parchment background ### ${ARTIST3_NEGATIVE}`,
  },
];

const HORDE_HEADERS = {
  'Content-Type': 'application/json',
  apikey: '0000000000',
  'Client-Agent': 'modern-art-online:1.0:fix7',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let submitChain = Promise.resolve();
let lastSubmitAt = 0;

function withSubmitRateLimit(fn) {
  const next = submitChain.then(async () => {
    const wait = Math.max(0, 800 - (Date.now() - lastSubmitAt));
    if (wait > 0) await sleep(wait);
    lastSubmitAt = Date.now();
    return fn();
  });
  submitChain = next.catch(() => {});
  return next;
}

async function fetchJsonWithRetry(url, options = {}, retries = 6) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429 || res.status >= 500) {
        const txt = await res.text();
        lastErr = new Error(`HTTP ${res.status}: ${txt.slice(0, 180)}`);
        await sleep(1200 * (i + 1) + Math.floor(Math.random() * 400));
        continue;
      }
      const data = await res.json();
      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      lastErr = err;
      await sleep(1000 * (i + 1));
    }
  }
  throw lastErr;
}

async function generateOne(spec, models, attempt, extraSeed = 0) {
  const submit = await withSubmitRateLimit(() =>
    fetchJsonWithRetry('https://stablehorde.net/api/v2/generate/async', {
      method: 'POST',
      headers: HORDE_HEADERS,
      body: JSON.stringify({
        prompt: spec.prompt,
        params: {
          width: 512,
          height: 384,
          steps: 25,
          cfg_scale: 7.5,
          sampler_name: 'k_euler_a',
          seed: String(91000 + spec.cardNumber * 331 + attempt * 1013 + extraSeed),
          n: 1,
        },
        nsfw: false,
        censor_nsfw: false,
        slow_workers: true,
        models,
      }),
    })
  );

  if (!submit.ok || !submit.data?.id) {
    throw new Error(`Submit failed card #${spec.cardNumber}: ${JSON.stringify(submit.data)}`);
  }

  const id = submit.data.id;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 100000) {
    await sleep(2500);
    const check = await fetchJsonWithRetry(`https://stablehorde.net/api/v2/generate/check/${id}`);
    if (check.data?.faulted) {
      throw new Error(`Horde job faulted card #${spec.cardNumber}`);
    }
    if (check.data?.done) {
      const status = await fetchJsonWithRetry(`https://stablehorde.net/api/v2/generate/status/${id}`);
      const gen = status.data?.generations?.[0];
      if (!gen?.img) {
        throw new Error(`Empty generation card #${spec.cardNumber}`);
      }
      const imgRes = await fetch(gen.img);
      if (!imgRes.ok) {
        throw new Error(`Download failed HTTP ${imgRes.status} card #${spec.cardNumber}`);
      }
      const buf = Buffer.from(await imgRes.arrayBuffer());
      if (gen.censored === true || buf.length === 22676 || buf.length < 25000) {
        throw new Error(`Rejected buffer (${buf.length} bytes, censored=${gen.censored}) card #${spec.cardNumber}`);
      }
      return { buf, modelUsed: gen.model || models[0] };
    }
  }

  try {
    await fetch(`https://stablehorde.net/api/v2/generate/status/${id}`, {
      method: 'DELETE',
      headers: HORDE_HEADERS,
    });
  } catch {}
  throw new Error(`Timeout waiting for card #${spec.cardNumber}`);
}

async function generateWithRetry(spec, extraSeed = 0) {
  try {
    return await generateOne(spec, MODELS, 0, extraSeed);
  } catch (err1) {
    console.warn(`[Retry] Card #${spec.cardNumber} fallback: ${err1.message}`);
    return await generateOne(spec, ['Flat-2D Animerge', 'Dreamshaper', 'Deliberate'], 1, extraSeed);
  }
}

async function main() {
  const onlyArg = process.argv[2];
  const filterNums = onlyArg
    ? new Set(onlyArg.split(',').map((s) => Number(s.trim())).filter(Boolean))
    : null;
  const extraSeed = Number(process.argv[3] || 0);
  const runTargets = filterNums
    ? TARGET_CARDS.filter((c) => filterNums.has(c.cardNumber))
    : TARGET_CARDS;

  const generated = await Promise.all(
    runTargets.map(async (spec) => {
      const res = await generateWithRetry(spec, extraSeed);
      fs.writeFileSync(path.join(CARDS_DIR, `card_${spec.cardNumber}.jpg`), res.buf);
      fs.writeFileSync(path.join(CARDS_DIR, `card_${spec.cardNumber}.png`), res.buf);
      console.log(`[Generated #${spec.cardNumber}] ${spec.title} via ${res.modelUsed} (${res.buf.length} bytes)`);
      return { spec, ...res };
    })
  );

  if (fs.existsSync(path.join(CARDS_DIR, 'card_27.jpg'))) {
    fs.copyFileSync(path.join(CARDS_DIR, 'card_27.jpg'), path.join(AVATARS_DIR, 'avatar_7.png'));
  }

  const rawMeta = fs.readFileSync(META_PATH, 'utf8').replace(/^\uFEFF/, '');
  const meta = JSON.parse(rawMeta);
  const byNum = new Map(generated.map((g) => [g.spec.cardNumber, g]));

  for (let n = 1; n <= 70; n++) {
    const entry = meta[String(n)];
    entry.image = `/assets/cards/card_${n}.jpg?v=fix7`;
    if (byNum.has(n)) {
      const g = byNum.get(n);
      entry.title = g.spec.title;
      entry.source = `AI Horde (${g.modelUsed})`;
    }
  }

  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2), 'utf8');

  const hashes = new Set();
  for (let n = 1; n <= 70; n++) {
    const b = fs.readFileSync(path.join(CARDS_DIR, `card_${n}.jpg`));
    hashes.add(crypto.createHash('sha256').update(b).digest('hex'));
  }
  if (hashes.size !== 70) {
    throw new Error(`Expected 70 unique hashes, got ${hashes.size}`);
  }
  console.log(`ALL DONE! Updated Artist 3 cards [${runTargets.map((c) => c.cardNumber).join(', ')}]. UniqueHashes=${hashes.size}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
