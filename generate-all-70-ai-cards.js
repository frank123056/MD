const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ARTIFACT_DIR = 'C:\\Users\\Frank\\.gemini\\antigravity\\brain\\89963a54-e141-403a-8542-bd6479effd7c';
const PROJECT_DIR = __dirname;
const CARDS_DIR = path.join(PROJECT_DIR, 'public', 'assets', 'cards');
const AVATARS_DIR = path.join(PROJECT_DIR, 'public', 'assets', 'avatars');
const ASSETS_DIR = path.join(PROJECT_DIR, 'public', 'assets');

const NEGATIVE_PROMPT =
  'glossy 3D render, oily plastic skin, over-blended airbrush gradients, generic AI face, symmetrical passport pose, photorealistic CGI, messy neon clutter, text, watermark, signature, blurry, bad anatomy';

const STYLE_PROMPTS = [
  '1990s vintage Japanese cel-animated OVA key visual, hand-painted anime production cel, bold G-pen ink outlines, flat cel shading with crisp hard shadow edges, subtle 35mm film grain, warm golden-orange rim lighting, retro anime color palette, authentic hand-drawn linework',
  'Japanese Comiket artbook cover illustration, delicate transparent watercolor and colored pencil linework on textured cold-press paper, soft backlit hair strands, pastel magenta and sky-blue washes, natural watercolor bleed and paper grain, gentle nostalgic atmosphere, soft matte finish',
  'Japanese high-fantasy RPG character artbook illustration in the style of Akihiko Yoshida and Granblue Fantasy, intricate cross-hatching and visible expressive pencil-and-gouache brushwork, ornate gold filigree, warm parchment undertones with vibrant emerald accents, rich painterly texture, 2D concept art',
  'Modern Japanese Pixiv pop illustration in the style of Yoneyama Mai and LAM, dynamic wide-angle composition, bold graphic flat color blocks with electric cyan and cobalt blue, halftone dot accents, energetic expressive brush splatters, sharp eye highlights, crisp graphic design aesthetic',
  'Japanese dark Wa-Gothic anime illustration inspired by Mononoke and modern Pixiv kimono artbooks, traditional sumi-e ink brush outlines on textured washi paper, high-contrast deep violet, obsidian black, and crimson red palette with gold leaf accents, ornate flat kimono patterns, dramatic graphic composition',
];

const STYLE_LABELS = [
  '90年代手繪賽璐珞機甲原畫風',
  '透明水彩同人畫集 × 青春光影風',
  '王道奇幻設定集 × 吉田明彥畫風',
  '涉谷系潮流撞色 × 米山舞視覺風',
  '浮世繪和風哥德 × 雙色極簡怪談風',
];

const ARTIST_MODELS = [
  ['Flat-2D Animerge', 'Counterfeit', 'MeinaMix', 'Abyss OrangeMix', 'Rev Animated', 'Deliberate'],
  ['Pastel Mix', 'Counterfeit', 'MeinaMix', 'Flat-2D Animerge', 'Abyss OrangeMix', 'Dreamshaper'],
  ['Rev Animated', 'Abyss OrangeMix', 'Counterfeit', 'Deliberate', 'Dreamshaper', 'MeinaMix'],
  ['Flat-2D Animerge', 'MeinaMix', 'Inkpunk Diffusion', 'Comic-Diffusion', 'Counterfeit', 'Rev Animated'],
  ['Counterfeit', 'Abyss OrangeMix', 'MeinaMix', 'Inkpunk Diffusion', 'Rev Animated', 'Deliberate'],
];

const FALLBACK_MODELS = [
  'Flat-2D Animerge',
  'MeinaMix',
  'Counterfeit',
  'Rev Animated',
  'Deliberate',
  'stable_diffusion',
];

const EXISTING_GEMINI_FILES = {
  1: 'gen_card_01_1795268361973.jpg',
  2: 'mecha_genga_keyframe_1795265067037.jpg',
  3: 'mecha_zero_card_art_1795264787916.jpg',
  6: 'gen_card_06_1795268363761.jpg',
  11: 'gen_card_11_1795268365953.jpg',
  13: 'retro_shoujo_idol_watercolor_1795265071405.jpg',
  14: 'hoshino_yoko_card_1795264789539.jpg',
  26: 'elven_mage_impasto_oil_fullbleed_1795265088309.jpg',
  27: 'christin_el_card_1795264791535.jpg',
  28: 'elven_mage_impasto_oil_1795265071893.jpg',
  32: 'gen_card_32_1795268376015.jpg',
  37: 'gen_card_37_1795268371771.jpg',
  40: 'cyberpunk_risograph_manga_zine_1795265073653.jpg',
  41: 'karl_8bit_card_1795264790153.jpg',
  55: 'gothic_kimono_witch_woodblock_1795265072692.jpg',
  56: 'krypto_nox_key_visual_1795264800924.jpg',
};

const CARD_SPECS = [
  // Artist 0: Mecha Zero (1-12)
  [1, 0, '零號機庫・黃昏出擊', 'A cool silver-haired female mecha pilot in a sleek white-and-amber plugsuit leaning against a weathered giant robot cockpit hatch inside a sunset hangar'],
  [2, 0, '赤翼瓦爾基里・原畫分鏡', 'A fierce red-haired ace pilot inside a glowing amber HUD cockpit pulling twin control levers during atmospheric entry with fiery orange plasma outside the canopy'],
  [3, 0, '重裝甲整備班長・蕾娜', 'An energetic short-haired female chief mechanic in a grease-stained orange jumpsuit holding a heavy torque wrench on a giant mecha shoulder gantry'],
  [4, 0, '軌道電梯防衛戰', 'A towering white-and-amber real-robot mecha bracing its shield and firing a shoulder railgun on an orbital ring bridge at dusk'],
  [5, 0, '殘陽下的斷刃機神', 'A battle-damaged white-and-amber giant robot mecha kneeling in shallow ocean surf under a golden-orange sunset sky with sea spray'],
  [6, 0, '雙子同步率測試', 'Twin teenage anime pilots wearing retro amber neural headsets sitting back-to-back in a 1990s CRT monitor control lab with cables'],
  [7, 0, '艦橋戰術通信官', 'A stoic female bridge officer with short navy hair and an amber visor pointing across a glowing retro wireframe tactical table'],
  [8, 0, '成層圈超音速迎擊', 'A variable fighter-mecha banking sharply through golden sunset cirrus clouds leaving twin vapor contrails'],
  [9, 0, '廢墟都市的裝甲偵察兵', 'A lone female pilot with her flight helmet tucked under her arm standing atop a moss-covered tank in a flooded city ruin at twilight'],
  [10, 0, '最終決戰・陽電子砲充能', 'A heavy sniper mecha anchored into mountain rock as golden-amber lightning coils around its long cannon barrel'],
  [11, 0, '機庫天台的夕陽咖啡', 'An off-duty male mecha pilot in a half-unzipped flight suit drinking canned coffee on a windy hangar railing overlooking a giant robot hand at sunset'],
  [12, 0, '覺醒暴走・琥珀光翼', 'A prototype white-and-gold mecha spreading geometric amber wings of light as mechanical armor plates vent steam and sparks'],

  // Artist 1: Hoshino Yoko (13-25)
  [13, 1, '櫻吹雪的放課後鐵道', 'An expressive anime girl in a pastel sailor uniform catching cherry blossom petals beside a sunlit railway crossing under a twilight sky'],
  [14, 1, '夏空頂樓的星光偶像', 'A twin-tailed schoolgirl in a cream cardigan releasing a white paper airplane on a breezy rooftop against towering watercolor cumulus clouds'],
  [15, 1, '雨後繡球花與透明傘', 'A gentle bob-haired girl holding a clear vinyl umbrella beaded with raindrops among blooming pastel pink and sky-blue hydrangeas'],
  [16, 1, '音樂教室的窗邊長笛', 'A long-haired anime girl playing a silver concert flute beside fluttering sheer white curtains in a sunlit school music room'],
  [17, 1, '夏日祭典的金魚氣球', 'A cheerful girl in a pastel magenta morning-glory yukata holding a translucent water balloon yo-yo under warm festival lanterns'],
  [18, 1, '海風單車與向日葵坡道', 'A carefree girl standing on bicycle pedals coasting down a coastal hill lined with watercolor sunflowers and a sparkling sky-blue sea horizon'],
  [19, 1, '圖書館角落的午後睡顏', 'A quiet bespectacled girl resting her chin on stacked sketchbooks by an arched library window with floating golden dust motes'],
  [20, 1, '星象儀下的玻璃彈珠', 'A dreamy girl holding a translucent glass marble up to a pastel magenta-and-indigo twilight sky streaked with a shooting star'],
  [21, 1, '草莓芭菲與喫茶店約會', 'A cheerful anime student in a collared school uniform blazer stirring a strawberry parfait glass in a bright retro wooden cafe booth'],
  [22, 1, '初雪車站的粉色圍巾', 'A girl burying her rosy cheeks into a hand-knitted rose-pink scarf as soft watercolor snowflakes drift onto a country train platform'],
  [23, 1, '美術社的向晚水彩畫架', 'A young student painter holding a wooden watercolor palette and brush with a pastel pink paint smudge on her cheek at golden hour'],
  [24, 1, '蒲公英原野的微風協奏', 'A girl in a flowing white sundress holding her straw hat while running across a pastel meadow of floating dandelion seeds'],
  [25, 1, '畢業典禮的花束告白', 'A tearful smiling schoolgirl clutching a bouquet of pink sweet peas under falling sakura petals in a school courtyard'],

  // Artist 2: Christin El (26-39)
  [26, 2, '翡翠森的古語詠唱者', 'An elegant elven spellcaster with braided silver hair and an emerald cloak casting glowing ancient runes in a sunlit forest ruin'],
  [27, 2, '風精靈契約・翠翼精靈', 'An agile sylph ranger drawing an ornate recurve bow carved from living golden wood atop a mossy stone gargoyle'],
  [28, 2, '白銀薔薇與畫架秘林', 'A noble female paladin in engraved silver-and-emerald plate armor resting a greatsword wrapped in blooming ivy vines'],
  [29, 2, '世界樹根部的鍊金藥師', 'A young alchemist with leather satchels distilling glowing emerald potion flasks inside a warm hollow tree laboratory'],
  [30, 2, '幼龍棲木的馴龍少女', 'A freckled dragon tamer in an embroidered travel cloak feeding a jewel-scaled emerald wyvern hatchling perched on her leather gauntlet'],
  [31, 2, '星盤塔的占星賢者', 'A serene blindfolded oracle in layered parchment-and-emerald robes surrounded by rotating brass astrolabe rings and floating scrolls'],
  [32, 2, '迷霧濕地的吟遊豎琴師', 'A wandering bard in a feathered emerald cavalier hat plucking a golden celtic harp beside a glowing woodland fairy ring'],
  [33, 2, '雙劍舞孃與沙海綠洲', 'A graceful bladesinger in emerald silk veils and gold filigree jewelry leaping with twin curved scimitars in an ancient sandstone courtyard'],
  [34, 2, '古代魔導書庫的守護者', 'A horned scholar-mage adjusting brass spectacles while summoning spectral emerald feathers from an open illuminated grimoire'],
  [35, 2, '獅鷲騎士的浮空島巡航', 'A sky-knight in a windswept emerald tabard mounted on a majestic feathered griffon perched on a floating ruin cliff'],
  [36, 2, '荊棘王冠的森林德魯伊', 'An antler-crowned druidess weaving glowing emerald vines and white woodland lilies with an ornate staff in dappled forest light'],
  [37, 2, '發條魔偶與工坊少女', 'A fantasy clockwork artificer calibrating an intricate brass-and-jade automaton knight with glowing rune gears'],
  [38, 2, '聖堂刺客的月下翠影', 'A hooded rogue in a gold-trimmed leather doublet balanced on a gothic spire wielding twin emerald crystal daggers'],
  [39, 2, '誓約聖劍的湖畔加冕', 'A Valkyrie maiden lifting an emerald-jeweled broadsword from a misty forest lake surrounded by carved monoliths'],

  // Artist 3: Karl 8-Bit (40-54)
  [40, 3, '秋葉原雨夜的電競少年', 'A stylish cyberpunk street gamer wearing an oversized techwear jacket and glowing cyan headphones in rainy neon Akihabara'],
  [41, 3, '澀谷十字路口的滑板駭客', 'An energetic streetwear girl kicking up a holographic electric-blue skateboard over a rain-slicked Shibuya crosswalk'],
  [42, 3, '地下音遊機台的連擊女王', 'A twin-bun arcade rhythm gamer in neon-blue visor glasses slamming glowing turntable keys with graphic motion streaks'],
  [43, 3, '深夜便利商店的改造人少女', 'A cool cyborg girl with a translucent cobalt mechanical arm sipping a canned soda outside a graphic blue-lit convenience store'],
  [44, 3, '電光藍貝斯手的極限獨奏', 'A punk anime bassist in a cropped tech hoodie leaping mid-air with an electric cyan bass guitar and halftone soundwave rings'],
  [45, 3, '無人機快遞的跑酷少女', 'An agile courier girl in a cobalt windbreaker vaulting over a rooftop railing alongside a glowing cyan delivery drone'],
  [46, 3, '復古掌機與像素幽靈暴走', 'A trendy boy in an oversized graphic sweater pulling down his sunglasses as 8-bit cyan pixel monsters burst from his handheld console'],
  [47, 3, '虛擬歌姬的雷射舞台降臨', 'A pop virtual idol with flowing electric-blue twintails singing into a chrome microphone amid bold geometric cyan laser beams'],
  [48, 3, '街頭塗鴉客的霓虹噴罐', 'A street artist wearing a graphic respirator mask spraying vivid cyan and cobalt halftone graffiti splashes toward the camera'],
  [49, 3, '重機騎士的首都高殘影', 'A cyberpunk biker girl leaning on a sleek cobalt electric motorcycle with graphic speed lines and cyan rain splashes'],
  [50, 3, '多螢幕秘密基地的情報屋', 'A smirking hacker with glowing cyan iris reflections surrounded by floating retro terminal windows and braided data cables'],
  [51, 3, '高空電塔的電磁溜溜球手', 'A street fighter teen spinning an electric-blue plasma yo-yo with dramatic wide-angle foreshortening atop a steel radio tower'],
  [52, 3, '合成器DJ的午夜音波浪潮', 'A hooded female DJ adjusting glowing cyan modular synthesizer knobs as bold graphic equalizer bars erupt behind her'],
  [53, 3, '機械柴犬與涉谷潮男', 'A trendy youth in a graphic cobalt vest walking a robotic cyan shiba inu through a poster-covered alleyway'],
  [54, 3, '次元裂縫的8-Bit最終魔王戰', 'A heroine swinging a pixel-blade katana that shatters into electric cyan cubes and bold halftone polygons'],

  // Artist 4: Krypto Nox (55-70)
  [55, 4, '彼岸花海的白狐巫女', 'A mysterious kitsune shrine witch holding a painted fox mask amidst blooming crimson spider lilies and floating paper talismans'],
  [56, 4, '百鬼夜行的紫煙魔女', 'An aristocratic yokai courtesan in a layered obsidian-and-violet kimono exhaling purple smoke whorls from a long gold kiseru pipe'],
  [57, 4, '鴉天狗的朱紅鳥居月夜', 'A white-haired Tengu swordsman with black crow wings perched on a vermilion torii gate under a violet eclipse moon'],
  [58, 4, '金繼古鏡與雙面怨靈姬', 'A traditional anime shrine maiden in full ceremonial red-and-violet kimono robes holding an antique bronze mirror with gold filigree'],
  [59, 4, '提燈引路的冥界擺渡人', 'A masked boatman in a patterned indigo-and-violet haori holding a glowing paper lantern on a black sumi-e ink river of paper cranes'],
  [60, 4, '紫藤花下的琵琶法師', 'A traditional anime musician in full dark violet kimono robes playing a wooden biwa lute beneath blooming wisteria flowers and gold clouds'],
  [61, 4, '折扇結界的陰陽少主', 'A young onmyoji noble snapping open a gold-leaf folding fan as black sumi-e shikigami wolves with crimson eyes leap forward'],
  [62, 4, '和傘迴旋的蝶妖少女', 'A horned butterfly demoness twirling a violet oiled-paper wagasa umbrella in a storm of gold and crimson paper butterflies'],
  [63, 4, '鬼火竹林的妖刀斬擊', 'A ronin girl in patterned dark violet hakama drawing a cursed crimson katana amidst floating purple will-o-the-wisps in an ink bamboo grove'],
  [64, 4, '紅線傀儡的淨琉璃人形', 'A porcelain-pale gothic puppeteer manipulating an ornate kimono doll with glowing crimson silk threads against gold-leaf screens'],
  [65, 4, '金魚屏風前的夢魔花魁', 'A traditional anime noblewoman in full ornate kimono robes seated beside a gold-leaf folding screen painted with giant crimson ink goldfish'],
  [66, 4, '骷髏茶會的彼岸宵宴', 'A smiling witch in a black-and-violet kimono uchikake pouring violet tea from an iron kettle surrounded by decorative ukiyo-e ink skulls'],
  [67, 4, '九尾覺醒・金箔障子破滅', 'A nine-tailed fox spirit priestess bursting through torn gold-leaf shoji screens with swirling sumi-e ink and violet fire tails'],
  [68, 4, '紙鶴咒縛的古鐘樓怪談', 'A dark-haired exorcist weaving a spiral of crimson and violet origami cranes around an ancient temple bronze bell'],
  [69, 4, '月蝕鬼面的神樂舞姬', 'A ceremonial dancer wearing a horned gold-and-crimson Hannya mask performing with sacred bells and trailing violet silk ribbons'],
  [70, 4, '百物語最終夜・吹熄青燭', 'A pale gothic storyteller about to blow out the last blue-violet candle flame as shadowy ukiyo-e spirits gather on the washi wall behind'],
];

const HORDE_HEADERS = {
  'Content-Type': 'application/json',
  apikey: '0000000000',
  'Client-Agent': 'modern-art-online:1.0:acg-auction',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let submitChain = Promise.resolve();
let lastSubmitAt = 0;

function withSubmitRateLimit(fn) {
  const next = submitChain.then(async () => {
    const wait = Math.max(0, 750 - (Date.now() - lastSubmitAt));
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
        await sleep(1200 * (i + 1) + Math.floor(Math.random() * 500));
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

async function generateViaHorde(cardNumber, artistIndex, title, subjectPrompt, models, attempt) {
  const fullPrompt = `${STYLE_PROMPTS[artistIndex]}, ${subjectPrompt} ### ${NEGATIVE_PROMPT}`;
  const submit = await withSubmitRateLimit(() =>
    fetchJsonWithRetry('https://stablehorde.net/api/v2/generate/async', {
      method: 'POST',
      headers: HORDE_HEADERS,
      body: JSON.stringify({
        prompt: fullPrompt,
        params: {
          width: 512,
          height: 384,
          steps: 20,
          cfg_scale: 7,
          sampler_name: 'k_euler_a',
          seed: String(10000 + cardNumber * 137 + attempt * 991),
          n: 1,
        },
        nsfw: false,
        censor_nsfw: false,
        trusted_workers: false,
        slow_workers: true,
        models,
      }),
    })
  );

  if (!submit.ok || !submit.data?.id) {
    throw new Error(`Horde submit failed card #${cardNumber}: ${JSON.stringify(submit.data)}`);
  }

  const id = submit.data.id;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 45000) {
    await sleep(2500);
    const check = await fetchJsonWithRetry(`https://stablehorde.net/api/v2/generate/check/${id}`);
    if (check.data?.faulted) {
      throw new Error(`Horde job faulted for card #${cardNumber}`);
    }
    if (check.data?.done) {
      const status = await fetchJsonWithRetry(`https://stablehorde.net/api/v2/generate/status/${id}`);
      const gen = status.data?.generations?.[0];
      if (!gen?.img) {
        throw new Error(`Horde empty generation for card #${cardNumber}`);
      }
      let buf;
      if (gen.img.startsWith('http')) {
        const imgRes = await fetch(gen.img);
        if (!imgRes.ok) {
          throw new Error(`Failed downloading R2 image HTTP ${imgRes.status} for card #${cardNumber}`);
        }
        buf = Buffer.from(await imgRes.arrayBuffer());
      } else {
        buf = Buffer.from(gen.img, 'base64');
      }
      if (gen.censored === true || buf.length === 22676 || buf.length < 25000) {
        throw new Error(`Censored or small buffer (${buf.length} bytes, censored=${gen.censored}) for card #${cardNumber}`);
      }
      return { buf, modelUsed: gen.model || models[0] };
    }
  }

  try {
    await fetch(`https://stablehorde.net/api/v2/generate/status/${id}`, {
      method: 'DELETE',
      headers: HORDE_HEADERS,
    });
  } catch {
    // Ignore cancel cleanup errors
  }
  throw new Error(`Horde job timed out after 45s for card #${cardNumber}`);
}

const REGEN_CARDS = new Set([5, 21, 58, 60, 65]);
const REGEN_MODELS = ['Flat-2D Animerge', 'Counterfeit', 'MeinaMix', 'Rev Animated', 'Dreamshaper'];

async function generateCardWithFallback(spec) {
  const [cardNumber, artistIndex, title, subjectPrompt] = spec;
  const primaryModels = REGEN_CARDS.has(cardNumber) ? REGEN_MODELS : ARTIST_MODELS[artistIndex];
  try {
    return await generateViaHorde(cardNumber, artistIndex, title, subjectPrompt, primaryModels, 0);
  } catch (err1) {
    console.warn(`[Retry] Card #${cardNumber} (${title}) with fallback models: ${err1.message}`);
    return await generateViaHorde(cardNumber, artistIndex, title, subjectPrompt, FALLBACK_MODELS, 1);
  }
}

async function main() {
  fs.mkdirSync(CARDS_DIR, { recursive: true });
  fs.mkdirSync(AVATARS_DIR, { recursive: true });

  const results = new Map();
  const pendingSpecs = [];

  for (const spec of CARD_SPECS) {
    const [cardNumber, artistIndex, title] = spec;
    const existingName = EXISTING_GEMINI_FILES[cardNumber];
    if (existingName) {
      const srcPath = path.join(ARTIFACT_DIR, existingName);
      if (fs.existsSync(srcPath)) {
        const buf = fs.readFileSync(srcPath);
        results.set(cardNumber, {
          buf,
          source: 'Gemini AI Studio Original',
          title,
          artistIndex,
        });
        console.log(`[Gemini #${String(cardNumber).padStart(2, '0')}] Copied ${existingName} (${buf.length} bytes)`);
        continue;
      }
    }
    const diskCardPath = path.join(CARDS_DIR, `card_${cardNumber}.jpg`);
    if (!REGEN_CARDS.has(cardNumber) && fs.existsSync(diskCardPath) && fs.statSync(diskCardPath).size > 25000) {
      const buf = fs.readFileSync(diskCardPath);
      results.set(cardNumber, {
        buf,
        source: 'AI Horde Anime Model',
        title,
        artistIndex,
      });
      continue;
    }
    pendingSpecs.push(spec);
  }

  console.log(`\nStarting AI Horde generation for ${pendingSpecs.length} remaining cards (concurrency=12)...`);
  let cursor = 0;
  const CONCURRENCY = 12;

  async function worker() {
    while (cursor < pendingSpecs.length) {
      const idx = cursor++;
      const spec = pendingSpecs[idx];
      const [cardNumber, artistIndex, title] = spec;
      const { buf, modelUsed } = await generateCardWithFallback(spec);
      results.set(cardNumber, {
        buf,
        source: `AI Horde (${modelUsed})`,
        title,
        artistIndex,
      });
      console.log(`[Horde #${String(cardNumber).padStart(2, '0')}] ${title} via ${modelUsed} (${buf.length} bytes) [${results.size}/70]`);
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  const hashes = new Set();
  const metadata = {};

  for (const [cardNumber, artistIndex, title] of CARD_SPECS) {
    const item = results.get(cardNumber);
    if (!item || !item.buf || item.buf.length < 4096) {
      throw new Error(`Missing or invalid buffer for card #${cardNumber}`);
    }
    const jpgPath = path.join(CARDS_DIR, `card_${cardNumber}.jpg`);
    const pngPath = path.join(CARDS_DIR, `card_${cardNumber}.png`);
    fs.writeFileSync(jpgPath, item.buf);
    fs.writeFileSync(pngPath, item.buf);
    const sha = crypto.createHash('sha256').update(item.buf).digest('hex');
    hashes.add(sha);

    metadata[String(cardNumber)] = {
      title,
      image: `/assets/cards/card_${cardNumber}.jpg?v=ai70`,
      style: STYLE_LABELS[artistIndex],
      source: item.source,
    };
  }

  if (hashes.size !== 70) {
    throw new Error(`Expected 70 unique hashes, got ${hashes.size}`);
  }

  const flagshipCards = [1, 13, 26, 40, 55];
  flagshipCards.forEach((n, idx) => {
    fs.copyFileSync(path.join(CARDS_DIR, `card_${n}.jpg`), path.join(ASSETS_DIR, `artist_${idx}.png`));
  });

  const avatarCards = [1, 2, 3, 6, 13, 14, 26, 27, 40, 55];
  avatarCards.forEach((n, idx) => {
    fs.copyFileSync(path.join(CARDS_DIR, `card_${n}.jpg`), path.join(AVATARS_DIR, `avatar_${idx}.png`));
  });

  fs.writeFileSync(path.join(PROJECT_DIR, 'cardMetadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
  console.log(`\nALL DONE! Saved 70 unique AI card images (UniqueHashes=${hashes.size}), 5 artist icons, 10 avatars, and cardMetadata.json.`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
