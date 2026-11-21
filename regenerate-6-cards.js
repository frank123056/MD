const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_DIR = __dirname;
const CARDS_DIR = path.join(PROJECT_DIR, 'public', 'assets', 'cards');
const ASSETS_DIR = path.join(PROJECT_DIR, 'public', 'assets');
const AVATARS_DIR = path.join(ASSETS_DIR, 'avatars');
const META_PATH = path.join(PROJECT_DIR, 'cardMetadata.json');

const NEGATIVE_PROMPT =
  'glossy 3D render, oily plastic skin, over-blended airbrush gradients, generic AI face, symmetrical passport pose, photorealistic CGI, messy neon clutter, text, watermark, signature, blurry, bad anatomy';

const STYLE_PROMPTS = {
  1: 'Japanese Comiket artbook cover illustration, delicate transparent watercolor and colored pencil linework on textured cold-press paper, soft backlit hair strands, pastel magenta and sky-blue washes, natural watercolor bleed and paper grain, gentle nostalgic atmosphere, soft matte finish',
  2: 'Japanese high-fantasy RPG character artbook illustration in the style of Akihiko Yoshida and Granblue Fantasy, intricate cross-hatching and visible expressive pencil-and-gouache brushwork, ornate gold filigree, warm parchment undertones with vibrant emerald accents, rich painterly texture, 2D concept art',
  4: 'Japanese dark Wa-Gothic anime illustration inspired by Mononoke and modern Pixiv kimono artbooks, traditional sumi-e ink brush outlines on textured washi paper, high-contrast deep violet, obsidian black, and crimson red palette with gold leaf accents, ornate flat kimono patterns, dramatic graphic composition',
};

const TARGET_CARDS = [
  {
    cardNumber: 21,
    artistIndex: 1,
    title: '草莓芭菲與喫茶店約會',
    models: ['Flat-2D Animerge'],
    fallbackModels: ['Flat-2D Animerge', 'MeinaMix'],
    prompt: `${STYLE_PROMPTS[1]}, close-up 2D anime portrait of a cute anime girl with ribbon hair smiling and holding a spoon with a strawberry parfait cup, pastel pink and sky-blue watercolor washes on light paper ### ${NEGATIVE_PROMPT}, building exterior, empty room, realistic face`,
  },
  {
    cardNumber: 22,
    artistIndex: 1,
    title: '初雪車站的粉色圍巾',
    models: ['Flat-2D Animerge'],
    fallbackModels: ['Flat-2D Animerge', 'MeinaMix'],
    prompt: `${STYLE_PROMPTS[1]}, close-up 2D anime portrait of a cute anime schoolgirl wearing a cozy rose-pink knitted scarf with gentle snowflakes in her hair, pastel magenta and sky-blue watercolor washes on light paper ### ${NEGATIVE_PROMPT}, realistic face, 3d, western comic`,
  },
  {
    cardNumber: 25,
    artistIndex: 1,
    title: '畢業典禮的花束告白',
    models: ['Flat-2D Animerge'],
    fallbackModels: ['Flat-2D Animerge', 'MeinaMix'],
    prompt: `${STYLE_PROMPTS[1]}, close-up 2D anime portrait of a cute anime schoolgirl in sailor uniform holding a bouquet of pink flowers under falling cherry blossom petals, pastel pink and sky-blue watercolor washes on light paper ### ${NEGATIVE_PROMPT}, realistic face, 3d, western comic`,
  },
  {
    cardNumber: 30,
    artistIndex: 2,
    title: '幼龍棲木的馴龍少女',
    models: ['Dreamshaper', 'Deliberate'],
    fallbackModels: ['Dreamshaper', 'Deliberate', 'Rev Animated', 'Flat-2D Animerge'],
    prompt: `${STYLE_PROMPTS[2]}, upper-body portrait of a young anime fantasy girl dragon tamer in an ornate emerald-green and gold cloak smiling beside a cute baby emerald dragon on her wooden staff, warm sunlit forest parchment background ### ${NEGATIVE_PROMPT}, manuscript text, fake text, calligraphy, columns, book page`,
  },
  {
    cardNumber: 55,
    artistIndex: 4,
    title: '彼岸花海的白狐巫女',
    models: ['Deliberate', 'Flat-2D Animerge'],
    fallbackModels: ['Flat-2D Animerge', 'Deliberate', 'Dreamshaper'],
    prompt: `${STYLE_PROMPTS[4]}, upper-body portrait of a mysterious anime kitsune shrine maiden holding a painted white-and-crimson fox mask in an obsidian-black and deep-violet kimono with gold leaf patterns and red spider lilies ### ${NEGATIVE_PROMPT}`,
  },
  {
    cardNumber: 56,
    artistIndex: 4,
    title: '百鬼夜行的紫煙魔女',
    models: ['Deliberate', 'Flat-2D Animerge'],
    fallbackModels: ['Flat-2D Animerge', 'Deliberate', 'Dreamshaper'],
    prompt: `${STYLE_PROMPTS[4]}, upper-body portrait of an elegant dark Wa-Gothic anime noblewoman in a layered obsidian-and-violet kimono with gold-leaf floral patterns holding a traditional paper umbrella against crimson and black ink swirls ### ${NEGATIVE_PROMPT}`,
  },
];

const HORDE_HEADERS = {
  'Content-Type': 'application/json',
  apikey: '0000000000',
  'Client-Agent': 'modern-art-online:1.0:fix6',
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
          steps: 24,
          cfg_scale: 7.5,
          sampler_name: 'k_euler_a',
          seed: String(77000 + spec.cardNumber * 313 + attempt * 1009 + extraSeed),
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
  while (Date.now() - startedAt < 50000) {
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
    return await generateOne(spec, spec.models, 0, extraSeed);
  } catch (err1) {
    console.warn(`[Retry] Card #${spec.cardNumber} fallback: ${err1.message}`);
    return await generateOne(spec, spec.fallbackModels, 1, extraSeed);
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
      console.log(`[Generated #${spec.cardNumber}] ${spec.title} via ${res.modelUsed} (${res.buf.length} bytes)`);
      return { spec, ...res };
    })
  );

  for (const { spec, buf } of generated) {
    fs.writeFileSync(path.join(CARDS_DIR, `card_${spec.cardNumber}.jpg`), buf);
    fs.writeFileSync(path.join(CARDS_DIR, `card_${spec.cardNumber}.png`), buf);
  }

  fs.copyFileSync(path.join(CARDS_DIR, 'card_55.jpg'), path.join(ASSETS_DIR, 'artist_4.png'));
  fs.copyFileSync(path.join(CARDS_DIR, 'card_55.jpg'), path.join(AVATARS_DIR, 'avatar_9.png'));

  const rawMeta = fs.readFileSync(META_PATH, 'utf8').replace(/^\uFEFF/, '');
  const meta = JSON.parse(rawMeta);
  const byNum = new Map(generated.map((g) => [g.spec.cardNumber, g]));

  for (let n = 1; n <= 70; n++) {
    const entry = meta[String(n)];
    entry.image = `/assets/cards/card_${n}.jpg?v=fix6`;
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
  console.log(`ALL DONE! Updated cards [${runTargets.map((c) => c.cardNumber).join(', ')}]. UniqueHashes=${hashes.size}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
