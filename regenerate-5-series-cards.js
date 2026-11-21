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
  3: 'Modern Japanese Pixiv pop illustration in the style of Yoneyama Mai and LAM, dynamic wide-angle composition, bold graphic flat color blocks with electric cyan and cobalt blue, halftone dot accents, energetic expressive brush splatters, sharp eye highlights, crisp graphic design aesthetic',
};

const TARGET_CARDS = [
  {
    cardNumber: 13,
    artistIndex: 1,
    title: '櫻吹雪的放課後鐵道',
    models: ['Flat-2D Animerge', 'Dreamshaper'],
    fallbackModels: ['Flat-2D Animerge', 'MeinaMix', 'Dreamshaper'],
    prompt: `${STYLE_PROMPTS[1]}, An expressive anime girl in a pastel sailor uniform catching cherry blossom petals beside a sunlit railway crossing under a soft pastel sky, pastel pink and sky-blue palette on light paper ### ${NEGATIVE_PROMPT}`,
  },
  {
    cardNumber: 14,
    artistIndex: 1,
    title: '夏空頂樓的紙飛機',
    models: ['Flat-2D Animerge', 'Dreamshaper'],
    fallbackModels: ['Flat-2D Animerge', 'MeinaMix', 'Dreamshaper'],
    prompt: `${STYLE_PROMPTS[1]}, A twin-tailed anime schoolgirl in a cream cardigan releasing a white paper airplane on a breezy school rooftop against pastel watercolor cumulus clouds, pastel pink and sky-blue palette on light paper ### ${NEGATIVE_PROMPT}`,
  },
  {
    cardNumber: 37,
    artistIndex: 2,
    title: '發條魔偶與工坊少女',
    models: ['Deliberate', 'Dreamshaper'],
    fallbackModels: ['Dreamshaper', 'Deliberate', 'Rev Animated', 'Flat-2D Animerge'],
    prompt: `${STYLE_PROMPTS[2]}, A fantasy clockwork artificer calibrating an intricate brass-and-jade automaton knight with glowing emerald rune gears on warm antique parchment background ### ${NEGATIVE_PROMPT}`,
  },
  {
    cardNumber: 40,
    artistIndex: 3,
    title: '秋葉原雨夜的電競少年',
    models: ['Flat-2D Animerge'],
    fallbackModels: ['Flat-2D Animerge', 'MeinaMix'],
    prompt: `${STYLE_PROMPTS[3]}, A stylish cyberpunk street gamer wearing an oversized white-and-cyan techwear jacket and glowing electric-blue headphones on a bright graphic background ### ${NEGATIVE_PROMPT}`,
  },
  {
    cardNumber: 41,
    artistIndex: 3,
    title: '澀谷十字路口的滑板駭客',
    models: ['Flat-2D Animerge'],
    fallbackModels: ['Flat-2D Animerge', 'MeinaMix'],
    prompt: `${STYLE_PROMPTS[3]}, An energetic streetwear anime girl kicking up a glowing electric-blue and cobalt skateboard with dynamic cyan brush splatters on a bright graphic background ### ${NEGATIVE_PROMPT}`,
  },
];

const HORDE_HEADERS = {
  'Content-Type': 'application/json',
  apikey: '0000000000',
  'Client-Agent': 'modern-art-online:1.0:series5',
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

async function generateOne(spec, models, attempt) {
  const submit = await withSubmitRateLimit(() =>
    fetchJsonWithRetry('https://stablehorde.net/api/v2/generate/async', {
      method: 'POST',
      headers: HORDE_HEADERS,
      body: JSON.stringify({
        prompt: spec.prompt,
        params: {
          width: 512,
          height: 384,
          steps: 22,
          cfg_scale: 7,
          sampler_name: 'k_euler_a',
          seed: String(55000 + spec.cardNumber * 211 + attempt * 997),
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

async function generateWithRetry(spec) {
  try {
    return await generateOne(spec, spec.models, 0);
  } catch (err1) {
    console.warn(`[Retry] Card #${spec.cardNumber} fallback: ${err1.message}`);
    return await generateOne(spec, spec.fallbackModels, 1);
  }
}

async function main() {
  const generated = await Promise.all(
    TARGET_CARDS.map(async (spec) => {
      const res = await generateWithRetry(spec);
      console.log(`[Generated #${spec.cardNumber}] ${spec.title} via ${res.modelUsed} (${res.buf.length} bytes)`);
      return { spec, ...res };
    })
  );

  for (const { spec, buf } of generated) {
    fs.writeFileSync(path.join(CARDS_DIR, `card_${spec.cardNumber}.jpg`), buf);
    fs.writeFileSync(path.join(CARDS_DIR, `card_${spec.cardNumber}.png`), buf);
  }

  fs.copyFileSync(path.join(CARDS_DIR, 'card_13.jpg'), path.join(ASSETS_DIR, 'artist_1.png'));
  fs.copyFileSync(path.join(CARDS_DIR, 'card_40.jpg'), path.join(ASSETS_DIR, 'artist_3.png'));
  fs.copyFileSync(path.join(CARDS_DIR, 'card_13.jpg'), path.join(AVATARS_DIR, 'avatar_4.png'));
  fs.copyFileSync(path.join(CARDS_DIR, 'card_14.jpg'), path.join(AVATARS_DIR, 'avatar_5.png'));
  fs.copyFileSync(path.join(CARDS_DIR, 'card_40.jpg'), path.join(AVATARS_DIR, 'avatar_8.png'));

  const rawMeta = fs.readFileSync(META_PATH, 'utf8').replace(/^\uFEFF/, '');
  const meta = JSON.parse(rawMeta);
  const byNum = new Map(generated.map((g) => [g.spec.cardNumber, g]));

  for (let n = 1; n <= 70; n++) {
    const entry = meta[String(n)];
    entry.image = `/assets/cards/card_${n}.jpg?v=series5`;
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
  console.log(`ALL DONE! Updated cards 13, 14, 37, 40, 41. UniqueHashes=${hashes.size}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
