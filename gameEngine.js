const fs = require('fs');
const path = require('path');

const ARTISTS = [
  { id: 'lite_metal', index: 0, name: 'Mecha Zero', zhName: '鋼鐵機神・零', count: 12, color: '#f59e0b', style: 'geometric', image: '/assets/artist_0.png' },
  { id: 'yoko', index: 1, name: 'Hoshino Yoko', zhName: '星野洋子', count: 13, color: '#ec4899', style: 'brush', image: '/assets/artist_1.png' },
  { id: 'christin', index: 2, name: 'Christin El', zhName: '克莉絲汀・艾爾', count: 14, color: '#10b981', style: 'collage', image: '/assets/artist_2.png' },
  { id: 'karl', index: 3, name: 'Karl 8-Bit', zhName: '卡爾・8bit', count: 15, color: '#3b82f6', style: 'grid', image: '/assets/artist_3.png' },
  { id: 'krypto', index: 4, name: 'Krypto Nox', zhName: '闇夜克里普托', count: 16, color: '#a855f7', style: 'wave', image: '/assets/artist_4.png' },
];

const AUCTION_TYPES = ['open', 'once_around', 'hidden', 'fixed_price', 'double'];

const AUCTION_LABELS = {
  open: '公開競標',
  once_around: '一輪競標',
  hidden: '暗標',
  fixed_price: '定價拍賣',
  double: '聯合拍賣',
};

const DEAL_COUNTS = {
  3: [10, 6, 6, 0],
  4: [9, 4, 4, 0],
  5: [8, 3, 3, 0],
};

const TOP_BONUSES = [30, 20, 10];

const ART_TITLES = [
  'C105 完售幻之新刊原畫', '最終話作畫監督修正稿', '限定閃卡特典親簽直筆', '傳說泳裝回分鏡原畫',
  'BD全卷購入特典原稿', '秋葉原軸中心掛軸原畫', '十週年紀念主視覺原稿', '劇場版高潮戰鬥卡原畫',
  '神回OP無字幕原畫稿', '公式設定集封面原畫', '冬コミ企業攤巨幅海報', '生誕祭紀念限定原畫',
  '幻之未公開廢案設定稿', '百萬訂閱紀念主視覺', '初回限定版特典原畫', '最終覺醒特效原畫稿',
];

function loadCardMetadata() {
  try {
    const metaPath = path.join(__dirname, 'cardMetadata.json');
    if (fs.existsSync(metaPath)) {
      return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    }
  } catch {
    // Fallback to default titles
  }
  return {};
}

function createDeck() {
  const deck = [];
  const metaMap = loadCardMetadata();
  let seq = 1;
  for (const artist of ARTISTS) {
    for (let i = 0; i < artist.count; i++) {
      const cardNumber = seq++;
      const auctionType = AUCTION_TYPES[i % AUCTION_TYPES.length];
      const meta = metaMap[String(cardNumber)];
      deck.push({
        id: `card_${cardNumber}`,
        cardNumber,
        artistSerial: i + 1,
        artistIndex: artist.index,
        artistId: artist.id,
        artistName: `${artist.name} (${artist.zhName})`,
        color: artist.color,
        style: artist.style,
        image: meta?.image || `/assets/cards/card_${cardNumber}.jpg?v=fix7`,
        backdropImage: artist.image,
        auctionType,
        title: meta?.title || `${ART_TITLES[i % ART_TITLES.length]} #${i + 1}`,
        source: meta?.source || '星宝転生ジュエルセイバー FREE',
        artSeed: artist.index * 100 + i + 1,
      });
    }
  }
  return deck;
}

function shuffle(array, rng = Math.random) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function dealForSeason(game) {
  const count = DEAL_COUNTS[game.players.length][game.season - 1];
  if (count <= 0) return;
  for (const player of game.players) {
    for (let i = 0; i < count; i++) {
      if (game.deck.length > 0) {
        player.hand.push(game.deck.pop());
      }
    }
    player.hand.sort((a, b) => a.artistIndex - b.artistIndex || a.auctionType.localeCompare(b.auctionType));
  }
}

function addLog(game, message, type = 'info') {
  game.logs.push({
    id: ++game.logSeq,
    season: game.season,
    message,
    type,
    ts: Date.now(),
  });
  if (game.logs.length > 120) {
    game.logs.shift();
  }
}

function createGame(playerSpecs, options = {}) {
  if (!Array.isArray(playerSpecs) || playerSpecs.length < 3 || playerSpecs.length > 5) {
    throw new Error('現代藝術需要 3 至 5 位玩家才能開始遊戲');
  }

  const deck = options.deck ? [...options.deck] : shuffle(createDeck(), options.rng);

  const players = playerSpecs.map((spec, idx) => ({
    id: spec.id,
    name: spec.name,
    isAI: Boolean(spec.isAI),
    avatarIndex:
      Number.isInteger(spec.avatarIndex) && spec.avatarIndex >= 0 && spec.avatarIndex < 10
        ? spec.avatarIndex
        : null,
    seatIndex: idx,
    money: 100,
    hand: [],
    purchased: [],
    totalPaintingsBought: 0,
  }));

  const game = {
    season: 1,
    deck,
    players,
    turnPlayerIndex: 0,
    lastFifthCardPlayerIndex: players.length - 1,
    seasonCounts: [0, 0, 0, 0, 0],
    seasonValues: [
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ],
    phase: 'PLAY_CARD',
    aiDifficulty: options.aiDifficulty === 'standard' ? 'standard' : 'master',
    activeAuction: null,
    doubleState: null,
    fifthCardTrigger: null,
    hiddenReveal: null,
    lastAuctionSummary: null,
    lastSeasonReport: null,
    rankings: null,
    logs: [],
    logSeq: 0,
  };

  dealForSeason(game);
  addLog(game, `第 1 季拍賣開始！每人獲得起始資金 $100 與 ${DEAL_COUNTS[players.length][0]} 張畫作手牌。`, 'season');
  return game;
}

function findNextPlayerWithCards(game, startAfterIndex) {
  const n = game.players.length;
  for (let offset = 1; offset <= n; offset++) {
    const idx = (startAfterIndex + offset) % n;
    if (game.players[idx].hand.length > 0) {
      return idx;
    }
  }
  return -1;
}

function advanceAfterTurn(game, lastAuctioneerIndex) {
  const nextIdx = findNextPlayerWithCards(game, lastAuctioneerIndex);
  if (nextIdx === -1) {
    game.lastFifthCardPlayerIndex = lastAuctioneerIndex;
    addLog(game, '所有玩家手牌皆已打完，本季提前進入結算！', 'season');
    settleSeason(game);
    return;
  }
  game.turnPlayerIndex = nextIdx;
  game.phase = 'PLAY_CARD';
}

const OPEN_AUCTION_DURATION_MS = 90000;

function startAuction(game, cards, auctionType, auctioneerIndex, coAuctioneerIndex) {
  const isOpen = auctionType === 'open';
  const isFixed = auctionType === 'fixed_price';
  const isOnce = auctionType === 'once_around';

  let askingPlayerIndex = null;
  if (isFixed) {
    askingPlayerIndex = auctioneerIndex;
  } else if (isOnce) {
    askingPlayerIndex = (auctioneerIndex + 1) % game.players.length;
  }

  game.phase = 'AUCTION';
  game.activeAuction = {
    cards,
    auctionType,
    auctioneerIndex,
    coAuctioneerIndex,
    currentBid: 0,
    highestBidderIndex: null,
    askingPlayerIndex,
    askedCount: 0,
    passedPlayers: [],
    onceAroundBids: {},
    hiddenBids: {},
    fixedPrice: null,
    openExpiresAt: isOpen ? Date.now() + OPEN_AUCTION_DURATION_MS : null,
    openDurationMs: isOpen ? OPEN_AUCTION_DURATION_MS : null,
    startedAt: Date.now(),
  };

  const aucPlayer = game.players[auctioneerIndex];
  const cardLabel = cards.map((c) => `${c.artistName}「${c.title}」`).join(' + ');
  if (coAuctioneerIndex !== null) {
    const coPlayer = game.players[coAuctioneerIndex];
    addLog(
      game,
      `聯合拍賣成立！${coPlayer.name} 與新拍賣官 ${aucPlayer.name} 共同拍賣 ${cardLabel}（${AUCTION_LABELS[auctionType]}）`,
      'auction'
    );
  } else {
    addLog(game, `${aucPlayer.name} 拍賣 ${cardLabel}（${AUCTION_LABELS[auctionType]}）`, 'auction');
  }
}

function resolveAuction(game, winnerIndex, price, extra = {}) {
  const auction = game.activeAuction;
  if (!auction) return;

  const { cards, auctionType, auctioneerIndex, coAuctioneerIndex } = auction;
  const winner = game.players[winnerIndex];
  const auctioneer = game.players[auctioneerIndex];

  winner.purchased.push(...cards);
  winner.totalPaintingsBought += cards.length;

  let paymentNote = '';
  if (price > 0) {
    winner.money -= price;
    if (coAuctioneerIndex === null) {
      if (winnerIndex !== auctioneerIndex) {
        auctioneer.money += price;
        paymentNote = `支付 $${price} 給拍賣官 ${auctioneer.name}`;
      } else {
        paymentNote = `自己得標，支付 $${price} 給銀行`;
      }
    } else {
      const coPlayer = game.players[coAuctioneerIndex];
      const coShare = Math.floor(price / 2);
      const aucShare = Math.ceil(price / 2);
      if (winnerIndex !== auctioneerIndex && winnerIndex !== coAuctioneerIndex) {
        coPlayer.money += coShare;
        auctioneer.money += aucShare;
        paymentNote = `支付 $${coShare} 給 ${coPlayer.name}、$${aucShare} 給 ${auctioneer.name}`;
      } else if (winnerIndex === auctioneerIndex) {
        coPlayer.money += coShare;
        paymentNote = `自己得標，支付 $${coShare} 給 ${coPlayer.name}、$${aucShare} 給銀行`;
      } else {
        auctioneer.money += aucShare;
        paymentNote = `合拍者自己得標，支付 $${aucShare} 給 ${auctioneer.name}、$${coShare} 給銀行`;
      }
    }
  } else {
    paymentNote = '無人出價，免費獲得';
  }

  game.lastAuctionSummary = {
    cards,
    auctionType,
    winnerIndex,
    winnerName: winner.name,
    price,
    auctioneerIndex,
    coAuctioneerIndex,
    paymentNote,
    revealedBids: extra.revealedBids || null,
    ts: Date.now(),
  };

  const lotName = cards.map((c) => `${c.artistName}`).join(' + ');
  addLog(game, `🔨 成交！${winner.name} 以 $${price} 標得 ${lotName}（${paymentNote}）。`, 'deal');

  game.activeAuction = null;

  if (auctionType === 'hidden' && Array.isArray(extra.revealedBids)) {
    const nextIdx = findNextPlayerWithCards(game, auctioneerIndex);
    if (nextIdx !== -1) {
      game.turnPlayerIndex = nextIdx;
    }
    const now = Date.now();
    const durationMs = 30000;
    game.phase = 'HIDDEN_REVEAL';
    game.hiddenReveal = {
      cards,
      auctioneerIndex,
      coAuctioneerIndex,
      winnerIndex,
      winnerName: winner.name,
      price,
      paymentNote,
      revealedBids: extra.revealedBids,
      confirmedPlayerIndexes: [],
      startedAt: now,
      expiresAt: now + durationMs,
      durationMs,
    };
    return;
  }

  advanceAfterTurn(game, auctioneerIndex);
}

function finalizeHiddenReveal(game) {
  if (game.phase !== 'HIDDEN_REVEAL' || !game.hiddenReveal) return false;
  const { auctioneerIndex } = game.hiddenReveal;
  game.hiddenReveal = null;
  advanceAfterTurn(game, auctioneerIndex);
  return true;
}

function confirmHiddenReveal(game, playerIndex) {
  if (game.phase !== 'HIDDEN_REVEAL' || !game.hiddenReveal) {
    throw new Error('目前不是暗標結果確認階段');
  }
  if (!Number.isInteger(playerIndex) || playerIndex < 0 || playerIndex >= game.players.length) {
    throw new Error('無效的玩家座位');
  }
  const reveal = game.hiddenReveal;
  if (!reveal.confirmedPlayerIndexes.includes(playerIndex)) {
    reveal.confirmedPlayerIndexes.push(playerIndex);
  }
  if (reveal.confirmedPlayerIndexes.length >= game.players.length) {
    finalizeHiddenReveal(game);
    return true;
  }
  return false;
}

function playCard(game, playerIndex, cardId) {
  if (game.phase !== 'PLAY_CARD') {
    throw new Error('目前不是出牌階段');
  }
  if (playerIndex !== game.turnPlayerIndex) {
    throw new Error('尚未輪到你出牌');
  }

  const player = game.players[playerIndex];
  const cardIdx = player.hand.findIndex((c) => c.id === cardId);
  if (cardIdx === -1) {
    throw new Error('手牌中找不到這張畫作');
  }

  const [card] = player.hand.splice(cardIdx, 1);
  game.seasonCounts[card.artistIndex] += 1;
  game.lastAuctionSummary = null;
  game.hiddenReveal = null;

  if (game.seasonCounts[card.artistIndex] >= 5) {
    game.fifthCardTrigger = { cards: [card], playerIndex, playerName: player.name };
    game.lastFifthCardPlayerIndex = playerIndex;
    addLog(
      game,
      `🚨 ${player.name} 打出了 ${card.artistName} 的第 5 張畫！本季立刻結束（此畫不拍賣）。`,
      'season'
    );
    settleSeason(game);
    return;
  }

  if (card.auctionType === 'double') {
    game.phase = 'DOUBLE_OFFER';
    game.doubleState = {
      primaryCard: card,
      originalAuctioneerIndex: playerIndex,
      askingPlayerIndex: playerIndex,
      askedCount: 0,
    };
    addLog(
      game,
      `${player.name} 打出 ${card.artistName} 的「聯合拍賣」牌，等待搭配第二張同畫家畫作。`,
      'auction'
    );
    return;
  }

  startAuction(game, [card], card.auctionType, playerIndex, null);
}

function respondDouble(game, playerIndex, { cardId = null, pass = false } = {}) {
  if (game.phase !== 'DOUBLE_OFFER' || !game.doubleState) {
    throw new Error('目前不在聯合拍賣補牌階段');
  }
  if (playerIndex !== game.doubleState.askingPlayerIndex) {
    throw new Error('尚未輪到你回應聯合拍賣');
  }

  const player = game.players[playerIndex];
  const { primaryCard, originalAuctioneerIndex } = game.doubleState;

  if (!pass && cardId) {
    const idx = player.hand.findIndex((c) => c.id === cardId);
    if (idx === -1) {
      throw new Error('手牌中找不到這張畫作');
    }
    const candidate = player.hand[idx];
    if (candidate.artistIndex !== primaryCard.artistIndex) {
      throw new Error('第二張畫作必須是同一位畫家');
    }
    if (candidate.auctionType === 'double') {
      throw new Error('第二張畫作不能再是聯合拍賣牌');
    }

    const [secondCard] = player.hand.splice(idx, 1);
    game.seasonCounts[secondCard.artistIndex] += 1;
    game.doubleState = null;

    if (game.seasonCounts[secondCard.artistIndex] >= 5) {
      game.fifthCardTrigger = { cards: [primaryCard, secondCard], playerIndex, playerName: player.name };
      game.lastFifthCardPlayerIndex = playerIndex;
      addLog(
        game,
        `🚨 ${player.name} 搭配打出 ${secondCard.artistName} 的第 5 張畫！本季立刻結束（兩張皆不拍賣）。`,
        'season'
      );
      settleSeason(game);
      return;
    }

    const coAuctioneerIndex = playerIndex === originalAuctioneerIndex ? null : originalAuctioneerIndex;
    startAuction(game, [primaryCard, secondCard], secondCard.auctionType, playerIndex, coAuctioneerIndex);
    return;
  }

  // Pass / Decline to add second card
  game.doubleState.askedCount += 1;
  if (game.doubleState.askedCount >= game.players.length) {
    const orig = game.players[originalAuctioneerIndex];
    orig.purchased.push(primaryCard);
    orig.totalPaintingsBought += 1;
    game.lastAuctionSummary = {
      cards: [primaryCard],
      auctionType: 'double',
      winnerIndex: originalAuctioneerIndex,
      winnerName: orig.name,
      price: 0,
      auctioneerIndex: originalAuctioneerIndex,
      coAuctioneerIndex: null,
      paymentNote: '全場無人搭配補牌，原拍賣官免費獲得',
      revealedBids: null,
      ts: Date.now(),
    };
    addLog(game, `全場皆未搭配聯合拍賣，${orig.name} 免費獲得 ${primaryCard.artistName} 的畫作。`, 'deal');
    game.doubleState = null;
    advanceAfterTurn(game, originalAuctioneerIndex);
  } else {
    game.doubleState.askingPlayerIndex = (game.doubleState.askingPlayerIndex + 1) % game.players.length;
  }
}

function placeBid(game, playerIndex, { amount = null, pass = false } = {}) {
  if (game.phase !== 'AUCTION' || !game.activeAuction) {
    throw new Error('目前沒有進行中的拍賣');
  }
  const auction = game.activeAuction;
  const player = game.players[playerIndex];

  if (auction.auctionType === 'open') {
    if (pass) {
      if (auction.highestBidderIndex === playerIndex) {
        throw new Error('你是目前最高出價者，不能 Pass');
      }
      if (!auction.passedPlayers.includes(playerIndex)) {
        auction.passedPlayers.push(playerIndex);
      }
      if (auction.passedPlayers.length >= game.players.length) {
        const winner = auction.highestBidderIndex !== null ? auction.highestBidderIndex : auction.auctioneerIndex;
        resolveAuction(game, winner, auction.currentBid);
      }
      return;
    }

    const bid = Number(amount);
    if (!Number.isInteger(bid) || bid <= auction.currentBid) {
      throw new Error(`出價必須大於目前最高價 $${auction.currentBid}`);
    }
    if (bid > player.money) {
      throw new Error('出價不可超過你擁有的現金');
    }

    auction.currentBid = bid;
    auction.highestBidderIndex = playerIndex;
    auction.passedPlayers = [playerIndex];
    auction.openExpiresAt = Date.now() + OPEN_AUCTION_DURATION_MS;
    addLog(game, `${player.name} 喊價 $${bid}`, 'bid');
    return;
  }

  if (auction.auctionType === 'once_around') {
    if (playerIndex !== auction.askingPlayerIndex) {
      throw new Error('尚未輪到你表態');
    }

    if (!pass && amount !== null && amount !== undefined) {
      const bid = Number(amount);
      if (!Number.isInteger(bid) || bid <= auction.currentBid) {
        throw new Error(`出價必須大於目前最高價 $${auction.currentBid}`);
      }
      if (bid > player.money) {
        throw new Error('出價不可超過你擁有的現金');
      }
      auction.currentBid = bid;
      auction.highestBidderIndex = playerIndex;
      auction.onceAroundBids[playerIndex] = { action: 'bid', amount: bid };
      addLog(game, `${player.name} 喊價 $${bid}`, 'bid');
    } else {
      auction.onceAroundBids[playerIndex] = { action: 'pass', amount: null };
      addLog(game, `${player.name} 選擇 Pass`, 'bid');
    }

    auction.askedCount += 1;
    if (auction.askedCount >= game.players.length) {
      const winner = auction.highestBidderIndex !== null ? auction.highestBidderIndex : auction.auctioneerIndex;
      resolveAuction(game, winner, auction.currentBid);
    } else {
      auction.askingPlayerIndex = (auction.askingPlayerIndex + 1) % game.players.length;
    }
    return;
  }

  throw new Error('目前的拍賣類型不支援此出價指令');
}

function submitHiddenBid(game, playerIndex, amount) {
  if (game.phase !== 'AUCTION' || !game.activeAuction || game.activeAuction.auctionType !== 'hidden') {
    throw new Error('目前不是暗標拍賣');
  }
  const auction = game.activeAuction;
  if (Object.prototype.hasOwnProperty.call(auction.hiddenBids, playerIndex)) {
    throw new Error('你已經提交過暗標金額');
  }
  const bid = Number(amount);
  const player = game.players[playerIndex];
  if (!Number.isInteger(bid) || bid < 0 || bid > player.money) {
    throw new Error('暗標金額必須是 0 到你現有現金之間的整數');
  }

  auction.hiddenBids[playerIndex] = bid;

  if (Object.keys(auction.hiddenBids).length >= game.players.length) {
    let maxBid = -1;
    let winnerIndex = auction.auctioneerIndex;
    const n = game.players.length;
    const revealedBids = [];

    for (let offset = 0; offset < n; offset++) {
      const idx = (auction.auctioneerIndex + offset) % n;
      const b = auction.hiddenBids[idx];
      revealedBids.push({ playerIndex: idx, playerName: game.players[idx].name, amount: b });
      if (b > maxBid) {
        maxBid = b;
        winnerIndex = idx;
      }
    }

    const revealText = revealedBids.map((r) => `${r.playerName}:$${r.amount}`).join('、');
    addLog(game, `暗標揭曉 → ${revealText}`, 'bid');
    resolveAuction(game, winnerIndex, maxBid, { revealedBids });
  }
}

function setFixedPrice(game, playerIndex, price) {
  if (game.phase !== 'AUCTION' || !game.activeAuction || game.activeAuction.auctionType !== 'fixed_price') {
    throw new Error('目前不是定價拍賣');
  }
  const auction = game.activeAuction;
  if (auction.fixedPrice !== null) {
    throw new Error('定價已經設定完成');
  }
  if (playerIndex !== auction.auctioneerIndex) {
    throw new Error('只有拍賣官可以設定定價');
  }

  const p = Number(price);
  const auctioneer = game.players[playerIndex];
  const minPrice = auctioneer.money > 0 ? 1 : 0;
  if (!Number.isInteger(p) || p < minPrice || p > auctioneer.money) {
    throw new Error(`定價必須在 $${minPrice} 到 $${auctioneer.money} 之間`);
  }

  auction.fixedPrice = p;
  auction.askingPlayerIndex = (auction.auctioneerIndex + 1) % game.players.length;
  auction.askedCount = 0;
  addLog(game, `${auctioneer.name} 將畫作定價為 $${p}！`, 'bid');
}

function buyFixedPrice(game, playerIndex, buy) {
  if (game.phase !== 'AUCTION' || !game.activeAuction || game.activeAuction.auctionType !== 'fixed_price') {
    throw new Error('目前不是定價拍賣');
  }
  const auction = game.activeAuction;
  if (auction.fixedPrice === null) {
    throw new Error('拍賣官尚未設定價格');
  }
  if (playerIndex !== auction.askingPlayerIndex) {
    throw new Error('尚未輪到你決定是否購買');
  }

  const player = game.players[playerIndex];
  if (buy) {
    if (player.money < auction.fixedPrice) {
      throw new Error('你的現金不足以買下此畫作');
    }
    resolveAuction(game, playerIndex, auction.fixedPrice);
    return;
  }

  addLog(game, `${player.name} 放棄購買`, 'bid');
  auction.askedCount += 1;
  const nextIdx = (auction.askingPlayerIndex + 1) % game.players.length;

  if (nextIdx === auction.auctioneerIndex) {
    const auctioneer = game.players[auction.auctioneerIndex];
    addLog(game, `無人購買，拍賣官 ${auctioneer.name} 必須自行以 $${auction.fixedPrice} 買下畫作！`, 'bid');
    resolveAuction(game, auction.auctioneerIndex, auction.fixedPrice);
  } else {
    auction.askingPlayerIndex = nextIdx;
  }
}

function checkOpenAuctionTimeout(game, now = Date.now()) {
  if (
    game.phase === 'AUCTION' &&
    game.activeAuction &&
    game.activeAuction.auctionType === 'open' &&
    game.activeAuction.openExpiresAt &&
    now >= game.activeAuction.openExpiresAt
  ) {
    const auction = game.activeAuction;
    const winner = auction.highestBidderIndex !== null ? auction.highestBidderIndex : auction.auctioneerIndex;
    addLog(game, '⏰ 公開競標倒數結束，落槌成交！', 'auction');
    resolveAuction(game, winner, auction.currentBid);
    return true;
  }
  return false;
}

function checkHiddenRevealTimeout(game, now = Date.now()) {
  if (
    game.phase === 'HIDDEN_REVEAL' &&
    game.hiddenReveal &&
    game.hiddenReveal.expiresAt &&
    now >= game.hiddenReveal.expiresAt
  ) {
    addLog(game, '⏰ 暗標開標確認倒數 30 秒結束，自動進入下一步！', 'auction');
    finalizeHiddenReveal(game);
    return true;
  }
  return false;
}

function getArtistPayoutsForSeason(game, seasonIndex) {
  const payouts = [0, 0, 0, 0, 0];
  for (let i = 0; i < ARTISTS.length; i++) {
    if (game.seasonValues[seasonIndex][i] > 0) {
      let sum = 0;
      for (let s = 0; s <= seasonIndex; s++) {
        sum += game.seasonValues[s][i];
      }
      payouts[i] = sum;
    }
  }
  return payouts;
}

function settleSeason(game) {
  const seasonIdx = game.season - 1;
  const rankedArtists = ARTISTS.map((a) => ({
    artistIndex: a.index,
    name: `${a.name} (${a.zhName})`,
    count: game.seasonCounts[a.index],
  }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.artistIndex - b.artistIndex);

  const values = [0, 0, 0, 0, 0];
  rankedArtists.slice(0, 3).forEach((entry, rankIdx) => {
    values[entry.artistIndex] = TOP_BONUSES[rankIdx];
    entry.rank = rankIdx + 1;
    entry.bonus = TOP_BONUSES[rankIdx];
  });
  game.seasonValues[seasonIdx] = values;

  const payoutsPerArtist = getArtistPayoutsForSeason(game, seasonIdx);

  const playerPayouts = game.players.map((player) => {
    const countsByArtist = [0, 0, 0, 0, 0];
    let earned = 0;
    for (const card of player.purchased) {
      countsByArtist[card.artistIndex] += 1;
      earned += payoutsPerArtist[card.artistIndex];
    }
    player.money += earned;
    const soldCount = player.purchased.length;
    player.purchased = [];
    return {
      playerId: player.id,
      playerName: player.name,
      soldCount,
      countsByArtist,
      earned,
    };
  });

  game.lastSeasonReport = {
    season: game.season,
    ranking: rankedArtists,
    seasonBonuses: values,
    payoutsPerArtist,
    playerPayouts,
    fifthCardTrigger: game.fifthCardTrigger,
  };

  const topSummary = rankedArtists
    .slice(0, 3)
    .map((r) => `第${r.rank}名 ${r.name} (+$${r.bonus}，單張 $${payoutsPerArtist[r.artistIndex]})`)
    .join('；');
  addLog(game, `📊 第 ${game.season} 季結算：${topSummary || '無畫作出場'}`, 'season');

  game.activeAuction = null;
  game.doubleState = null;

  if (game.season >= 4) {
    game.phase = 'GAME_OVER';
    game.rankings = [...game.players]
      .sort((a, b) => b.money - a.money || b.totalPaintingsBought - a.totalPaintingsBought)
      .map((p, idx) => ({
        rank: idx + 1,
        id: p.id,
        name: p.name,
        isAI: p.isAI,
        money: p.money,
        totalPaintingsBought: p.totalPaintingsBought,
      }));
    addLog(game, `🏆 遊戲結束！冠軍是 ${game.rankings[0].name}（總資產 $${game.rankings[0].money}）！`, 'season');
  } else {
    game.phase = 'SEASON_SETTLEMENT';
  }
}

function startNextSeason(game) {
  if (game.phase !== 'SEASON_SETTLEMENT') {
    throw new Error('目前不在季末結算階段');
  }
  if (game.season >= 4) {
    throw new Error('遊戲已經完成 4 個季節');
  }

  game.season += 1;
  game.seasonCounts = [0, 0, 0, 0, 0];
  game.fifthCardTrigger = null;
  game.lastAuctionSummary = null;
  game.hiddenReveal = null;
  dealForSeason(game);

  const nextIdx = findNextPlayerWithCards(game, game.lastFifthCardPlayerIndex);
  if (nextIdx === -1) {
    addLog(game, `第 ${game.season} 季無人持有手牌，直接結算！`, 'season');
    settleSeason(game);
    return;
  }

  game.turnPlayerIndex = nextIdx;
  game.phase = 'PLAY_CARD';
  const dealCnt = DEAL_COUNTS[game.players.length][game.season - 1];
  addLog(
    game,
    `第 ${game.season} 季開始！每人補充 ${dealCnt} 張牌，由 ${game.players[nextIdx].name} 先手出牌。`,
    'season'
  );
}

function getArtistCumulativeValues(game) {
  return ARTISTS.map((a) => {
    let total = 0;
    for (let s = 0; s < game.season; s++) {
      total += game.seasonValues[s][a.index];
    }
    return total;
  });
}

function getSanitizedState(game, viewerPlayerId) {
  const isGameOver = game.phase === 'GAME_OVER';
  const players = game.players.map((p) => {
    const isSelf = p.id === viewerPlayerId;
    return {
      id: p.id,
      name: p.name,
      isAI: p.isAI,
      avatarIndex: p.avatarIndex ?? null,
      seatIndex: p.seatIndex,
      money: isSelf || isGameOver ? p.money : null,
      hand: isSelf || isGameOver ? p.hand : null,
      handCount: p.hand.length,
      purchased: p.purchased,
      totalPaintingsBought: p.totalPaintingsBought,
    };
  });

  let activeAuction = null;
  if (game.activeAuction) {
    const a = game.activeAuction;
    activeAuction = {
      cards: a.cards,
      auctionType: a.auctionType,
      auctioneerIndex: a.auctioneerIndex,
      coAuctioneerIndex: a.coAuctioneerIndex,
      currentBid: a.currentBid,
      highestBidderIndex: a.highestBidderIndex,
      askingPlayerIndex: a.askingPlayerIndex,
      askedCount: a.askedCount,
      passedPlayers: a.passedPlayers,
      onceAroundBids: a.onceAroundBids || {},
      hiddenSubmittedIndexes: Object.keys(a.hiddenBids).map(Number),
      myHiddenBid:
        viewerPlayerId != null
          ? (() => {
              const viewerIdx = game.players.findIndex((p) => p.id === viewerPlayerId);
              return viewerIdx !== -1 && Object.prototype.hasOwnProperty.call(a.hiddenBids, viewerIdx)
                ? a.hiddenBids[viewerIdx]
                : null;
            })()
          : null,
      fixedPrice: a.fixedPrice,
      openExpiresAt: a.openExpiresAt,
      openDurationMs: a.openDurationMs || null,
    };
  }

  return {
    artists: ARTISTS,
    season: game.season,
    deckRemaining: game.deck.length,
    turnPlayerIndex: game.turnPlayerIndex,
    seasonCounts: game.seasonCounts,
    seasonValues: game.seasonValues,
    cumulativeValues: getArtistCumulativeValues(game),
    phase: game.phase,
    aiDifficulty: game.aiDifficulty || 'master',
    players,
    activeAuction,
    doubleState: game.doubleState,
    fifthCardTrigger: game.fifthCardTrigger,
    hiddenReveal: game.hiddenReveal,
    lastAuctionSummary: game.lastAuctionSummary,
    lastSeasonReport: game.lastSeasonReport,
    rankings: game.rankings,
    logs: game.logs,
  };
}

module.exports = {
  ARTISTS,
  AUCTION_TYPES,
  AUCTION_LABELS,
  DEAL_COUNTS,
  TOP_BONUSES,
  createDeck,
  createGame,
  playCard,
  respondDouble,
  placeBid,
  submitHiddenBid,
  setFixedPrice,
  buyFixedPrice,
  confirmHiddenReveal,
  checkOpenAuctionTimeout,
  checkHiddenRevealTimeout,
  settleSeason,
  startNextSeason,
  getArtistPayoutsForSeason,
  getSanitizedState,
};
