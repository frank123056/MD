const engine = require('./gameEngine');

const DEFAULT_PROFILE = {
  aggression: 1.0,
  ownedBoost: 13,
  sniperWeight: 1.0,
  openStepScale: 1.0,
  contrarian: 0.02,
  fixedMarkup: 0.75,
};

const BOT_PROFILES = {
  '課金石油王 Bot': {
    aggression: 1.07,
    ownedBoost: 13,
    sniperWeight: 0.9,
    openStepScale: 1.5,
    contrarian: 0.04,
    fixedMarkup: 0.78,
  },
  '同人壁攤大手 Bot': {
    aggression: 0.96,
    ownedBoost: 15,
    sniperWeight: 1.15,
    openStepScale: 0.9,
    contrarian: 0.0,
    fixedMarkup: 0.76,
  },
  '秋葉原大王 Bot': {
    aggression: 1.01,
    ownedBoost: 12,
    sniperWeight: 1.05,
    openStepScale: 1.1,
    contrarian: 0.02,
    fixedMarkup: 0.74,
  },
  '傳說痛車主 Bot': {
    aggression: 1.03,
    ownedBoost: 11,
    sniperWeight: 1.25,
    openStepScale: 1.3,
    contrarian: 0.03,
    fixedMarkup: 0.72,
  },
  '全婆俠收藏家 Bot': {
    aggression: 0.98,
    ownedBoost: 16,
    sniperWeight: 0.95,
    openStepScale: 1.0,
    contrarian: 0.08,
    fixedMarkup: 0.75,
  },
};

function getBotProfile(player) {
  return (player && BOT_PROFILES[player.name]) || DEFAULT_PROFILE;
}

function getBotDifficulty(game, botIndex) {
  const player = game.players[botIndex];
  const diff = player?.aiDifficulty || game.aiDifficulty || 'master';
  return diff === 'standard' ? 'standard' : 'master';
}

function countArtists(cards) {
  const counts = [0, 0, 0, 0, 0];
  if (!Array.isArray(cards)) return counts;
  for (const c of cards) {
    if (c && Number.isInteger(c.artistIndex)) {
      counts[c.artistIndex] += 1;
    }
  }
  return counts;
}

/**
 * Simulate exact end-of-season payouts matching gameEngine.settleSeason rules.
 */
function simulateSeasonPayouts(game, extraCounts = [0, 0, 0, 0, 0]) {
  const seasonIdx = game.season - 1;
  const totalCounts = engine.ARTISTS.map(
    (a) => (game.seasonCounts[a.index] || 0) + (extraCounts[a.index] || 0)
  );
  const ranked = [...engine.ARTISTS].sort(
    (a, b) => totalCounts[b.index] - totalCounts[a.index] || a.index - b.index
  );

  const artistPayouts = [0, 0, 0, 0, 0];
  ranked.slice(0, 3).forEach((entry, rankIdx) => {
    if (totalCounts[entry.index] <= 0) return;
    let hist = 0;
    for (let s = 0; s < seasonIdx; s++) {
      hist += game.seasonValues[s][entry.index];
    }
    artistPayouts[entry.index] = hist + engine.TOP_BONUSES[rankIdx];
  });

  const playerEarnings = game.players.map((p) =>
    p.purchased.reduce((sum, c) => sum + artistPayouts[c.artistIndex], 0)
  );

  return { artistPayouts, playerEarnings };
}

/**
 * Estimate per-artist season resale values.
 * When viewerBotIndex is provided, incorporates that bot's private hand holdings.
 */
function estimateArtistValues(game, viewerBotIndex = null) {
  const seasonIdx = game.season - 1;
  const viewer = viewerBotIndex !== null ? game.players[viewerBotIndex] : null;
  const handCounts = viewer ? countArtists(viewer.hand) : [0, 0, 0, 0, 0];
  const hasDoublePair = [false, false, false, false, false];
  if (viewer && Array.isArray(viewer.hand)) {
    for (let i = 0; i < 5; i++) {
      if (handCounts[i] >= 2 && viewer.hand.some((c) => c.artistIndex === i && c.auctionType === 'double')) {
        hasDoublePair[i] = true;
      }
    }
  }

  const maxOnBoard = Math.max(...game.seasonCounts);
  const scores = engine.ARTISTS.map((a) => {
    const played = game.seasonCounts[a.index];
    let hist = 0;
    for (let s = 0; s < seasonIdx; s++) {
      hist += game.seasonValues[s][a.index];
    }
    const handCnt = handCounts[a.index];
    const score = viewer
      ? played +
        (played > 0 ? 0.25 : 0) +
        handCnt * 0.55 +
        (hasDoublePair[a.index] ? 0.4 : 0) +
        (4 - a.index) * 0.02
      : played + (played > 0 ? 0.2 : 0) + (4 - a.index) * 0.02;

    return {
      artistIndex: a.index,
      played,
      handCnt,
      hist,
      score,
    };
  });

  const ranked = [...scores]
    .filter((s) => s.played > 0 || s.handCnt > 0 || game.season === 1)
    .sort((a, b) => b.score - a.score || a.artistIndex - b.artistIndex);

  const projectedBonus = [0, 0, 0, 0, 0];
  ranked.slice(0, 3).forEach((entry, rankIdx) => {
    projectedBonus[entry.artistIndex] = engine.TOP_BONUSES[rankIdx];
  });

  return scores.map((s) => {
    const bonus = projectedBonus[s.artistIndex];
    if (bonus === 0) {
      if (viewer && maxOnBoard === 4 && s.played === 0 && s.handCnt === 0) {
        return 2;
      }
      return s.played === 0 ? 8 : Math.min(12, Math.floor((s.hist + 10) * 0.25));
    }

    let confidence;
    if (viewer) {
      const eff = s.played + s.handCnt * 0.7;
      if (s.played >= 3) confidence = 1.0;
      else if (eff >= 3) confidence = 0.94;
      else if (eff >= 1.5) confidence = 0.86;
      else if (eff > 0) confidence = 0.74;
      else confidence = 0.56;
    } else {
      confidence = s.played >= 3 ? 1.0 : s.played >= 1 ? 0.85 : 0.6;
    }

    return Math.round((s.hist + bonus) * confidence);
  });
}

function getLotValue(game, cards, viewerBotIndex = null) {
  const vals = estimateArtistValues(game, viewerBotIndex);
  return cards.reduce((sum, c) => sum + (vals[c.artistIndex] || 10), 0);
}

/**
 * Exact cash this bot receives if someone else wins the active auction at bidAmount.
 */
function computePassCashGain(auction, botIndex, bidAmount) {
  if (!auction || bidAmount <= 0) return 0;
  if (auction.coAuctioneerIndex === null) {
    return botIndex === auction.auctioneerIndex ? bidAmount : 0;
  }
  if (botIndex === auction.auctioneerIndex) {
    return Math.ceil(bidAmount / 2);
  }
  if (botIndex === auction.coAuctioneerIndex) {
    return Math.floor(bidAmount / 2);
  }
  return 0;
}

function computeBotLotValuation(game, botIndex, cards, profile) {
  const bot = game.players[botIndex];
  const baseVal = getLotValue(game, cards, botIndex);
  const auction = game.activeAuction;
  const isSoleAuctioneer = auction && auction.coAuctioneerIndex === null && botIndex === auction.auctioneerIndex;
  const handCounts = countArtists(bot.hand);
  const leadArtist = cards[0]?.artistIndex ?? 0;

  let val = baseVal;
  if (!isSoleAuctioneer && game.season < 4 && handCounts[leadArtist] > 0) {
    val += Math.min(4, Math.round(handCounts[leadArtist] * 1.5));
  }
  if ((game.seasonCounts[leadArtist] || 0) === 1 && handCounts[leadArtist] >= 2) {
    val += Math.round(profile.contrarian * 25);
  }
  if (bot.money < 25 && bot.hand.length >= 4) {
    val = Math.round(val * 0.9);
  }
  return val;
}

function getMaxProfitableBid(game, auction, botIndex, valuation, profile) {
  const bot = game.players[botIndex];
  const passGain = computePassCashGain(auction, botIndex, auction.currentBid);
  const isPartner = botIndex === auction.auctioneerIndex || botIndex === auction.coAuctioneerIndex;

  const ceiling = isPartner
    ? Math.floor(valuation - passGain - 2)
    : Math.floor(valuation * 0.82 * profile.aggression);

  return Math.max(0, Math.min(bot.money, ceiling));
}

function pickBestDoubleFollowUp(matching, botMoney) {
  const rankType = (t) => {
    if (t === 'open') return 4;
    if (t === 'once_around') return 3;
    if (t === 'hidden') return 2;
    if (t === 'fixed_price') return botMoney >= 6 ? 2 : 0;
    return 1;
  };
  return [...matching].sort((a, b) => rankType(b.auctionType) - rankType(a.auctionType))[0];
}

function chooseCardToPlay(game, botIndex) {
  const bot = game.players[botIndex];
  const difficulty = getBotDifficulty(game, botIndex);
  const profile = getBotProfile(bot);
  const vals = estimateArtistValues(game, difficulty === 'master' ? botIndex : null);

  const myPurchasedCounts = countArtists(bot.purchased);
  const oppPurchasedCounts = [0, 0, 0, 0, 0];
  game.players.forEach((p, idx) => {
    if (idx === botIndex) return;
    const cMap = countArtists(p.purchased);
    for (let i = 0; i < 5; i++) oppPurchasedCounts[i] += cMap[i];
  });

  if (difficulty === 'standard') {
    let bestCard = bot.hand[0];
    let bestScore = -Infinity;
    for (const card of bot.hand) {
      const aIdx = card.artistIndex;
      const countOnBoard = game.seasonCounts[aIdx];
      let score = vals[aIdx];
      if (countOnBoard === 4) {
        const diff = oppPurchasedCounts[aIdx] - myPurchasedCounts[aIdx];
        score += diff * 18 + 5;
      } else {
        const copiesInHand = bot.hand.filter((c) => c.artistIndex === aIdx).length;
        score += myPurchasedCounts[aIdx] * 12 + copiesInHand * 4;
        if (card.auctionType === 'double') score += 4;
      }
      score += Math.random() * 6;
      if (score > bestScore) {
        bestScore = score;
        bestCard = card;
      }
    }
    return bestCard;
  }

  const handCounts = countArtists(bot.hand);
  let bestCard = bot.hand[0];
  let bestScore = -Infinity;

  for (const card of bot.hand) {
    const aIdx = card.artistIndex;
    const countOnBoard = game.seasonCounts[aIdx];
    let score = vals[aIdx];

    if (countOnBoard === 4) {
      const extra = [0, 0, 0, 0, 0];
      extra[aIdx] = 1;
      const sim = simulateSeasonPayouts(game, extra);
      const myEarn = sim.playerEarnings[botIndex];
      const maxOppEarn = Math.max(
        0,
        ...sim.playerEarnings.filter((_, idx) => idx !== botIndex)
      );
      const leadSwing = myEarn - maxOppEarn;
      score += leadSwing * 1.4 * profile.sniperWeight - vals[aIdx] * 0.35;
      score += (oppPurchasedCounts[aIdx] - myPurchasedCounts[aIdx]) * 8;
      if (myEarn > maxOppEarn) score += 25;
      else if (maxOppEarn - myEarn >= 20) score -= 45;
    } else {
      score += myPurchasedCounts[aIdx] * profile.ownedBoost + (handCounts[aIdx] - 1) * 4;
      if (card.auctionType === 'double') {
        const hasFollowUp = bot.hand.some(
          (c) => c.id !== card.id && c.artistIndex === aIdx && c.auctionType !== 'double'
        );
        if (countOnBoard <= 2 && hasFollowUp) {
          score += 12;
        } else if (countOnBoard === 3 && hasFollowUp) {
          score -= 18;
        } else {
          score += 3;
        }
      } else if (card.auctionType === 'fixed_price' && bot.money < 5) {
        score -= 10;
      } else if (myPurchasedCounts[aIdx] >= 2 && card.auctionType !== 'fixed_price') {
        score += 3;
      }
    }

    score += Math.random() * 2.5;
    if (score > bestScore) {
      bestScore = score;
      bestCard = card;
    }
  }

  return bestCard;
}

function performDoubleOfferStep(game) {
  const askIdx = game.doubleState.askingPlayerIndex;
  const bot = game.players[askIdx];
  if (!bot || !bot.isAI) return false;

  const primary = game.doubleState.primaryCard;
  const aIdx = primary.artistIndex;
  const matching = bot.hand.filter((c) => c.artistIndex === aIdx && c.auctionType !== 'double');
  if (matching.length === 0) {
    engine.respondDouble(game, askIdx, { pass: true });
    return true;
  }

  const countOnBoard = game.seasonCounts[aIdx];
  const difficulty = getBotDifficulty(game, askIdx);

  if (difficulty === 'standard') {
    const myOwn = bot.purchased.filter((c) => c.artistIndex === aIdx).length;
    if (countOnBoard === 4 && myOwn > 0) {
      engine.respondDouble(game, askIdx, { pass: true });
    } else {
      engine.respondDouble(game, askIdx, { cardId: matching[0].id });
    }
    return true;
  }

  if (countOnBoard === 4) {
    const extra = [0, 0, 0, 0, 0];
    extra[aIdx] = 1;
    const sim = simulateSeasonPayouts(game, extra);
    const myEarn = sim.playerEarnings[askIdx];
    const maxOppEarn = Math.max(0, ...sim.playerEarnings.filter((_, idx) => idx !== askIdx));
    if (myEarn - maxOppEarn >= 15) {
      engine.respondDouble(game, askIdx, { cardId: matching[0].id });
    } else {
      engine.respondDouble(game, askIdx, { pass: true });
    }
    return true;
  }

  const isOwnDouble = askIdx === game.doubleState.originalAuctioneerIndex;
  if (isOwnDouble) {
    const chosen = pickBestDoubleFollowUp(matching, bot.money);
    engine.respondDouble(game, askIdx, { cardId: chosen.id });
    return true;
  }

  const vals = estimateArtistValues(game, askIdx);
  const myOwned = bot.purchased.filter((c) => c.artistIndex === aIdx).length;
  const myHandCnt = bot.hand.filter((c) => c.artistIndex === aIdx).length;
  const worthCoAuctioning = vals[aIdx] >= 15 || myOwned + myHandCnt >= 2 || bot.hand.length >= 6;
  if (worthCoAuctioning) {
    const chosen = pickBestDoubleFollowUp(matching, bot.money);
    engine.respondDouble(game, askIdx, { cardId: chosen.id });
  } else {
    engine.respondDouble(game, askIdx, { pass: true });
  }
  return true;
}

function performAuctionStep(game) {
  const a = game.activeAuction;
  const standardLotVal = getLotValue(game, a.cards, null);

  if (a.auctionType === 'open') {
    const candidateIdx = game.players.findIndex(
      (p, idx) => p.isAI && idx !== a.highestBidderIndex && !a.passedPlayers.includes(idx)
    );
    if (candidateIdx === -1) return false;

    const bot = game.players[candidateIdx];
    const difficulty = getBotDifficulty(game, candidateIdx);
    const isAuctioneer = candidateIdx === a.auctioneerIndex || candidateIdx === a.coAuctioneerIndex;

    if (isAuctioneer && a.highestBidderIndex === null) {
      engine.placeBid(game, candidateIdx, { pass: true });
      return true;
    }

    if (difficulty === 'standard') {
      const ratio = isAuctioneer ? 0.65 : 0.72 + (candidateIdx % 3) * 0.04;
      const maxWilling = Math.min(bot.money, Math.floor(standardLotVal * ratio));
      const step = standardLotVal >= 40 ? 5 : 2;
      const nextBid = Math.min(maxWilling, a.currentBid + step);
      if (nextBid > a.currentBid && nextBid <= bot.money) {
        engine.placeBid(game, candidateIdx, { amount: nextBid });
      } else {
        engine.placeBid(game, candidateIdx, { pass: true });
      }
      return true;
    }

    const profile = getBotProfile(bot);
    const valuation = computeBotLotValuation(game, candidateIdx, a.cards, profile);
    const maxWilling = getMaxProfitableBid(game, a, candidateIdx, valuation, profile);
    const baseStep = valuation >= 45 ? 4 : valuation >= 24 ? 2 : 1;
    const step = Math.max(1, Math.round(baseStep * profile.openStepScale));
    const nextBid = Math.min(maxWilling, a.currentBid + step);

    if (nextBid > a.currentBid && nextBid <= bot.money) {
      engine.placeBid(game, candidateIdx, { amount: nextBid });
    } else {
      engine.placeBid(game, candidateIdx, { pass: true });
    }
    return true;
  }

  if (a.auctionType === 'once_around') {
    const askIdx = a.askingPlayerIndex;
    const bot = game.players[askIdx];
    if (!bot || !bot.isAI) return false;

    const difficulty = getBotDifficulty(game, askIdx);
    const isAuctioneer = askIdx === a.auctioneerIndex || askIdx === a.coAuctioneerIndex;

    if (isAuctioneer && a.highestBidderIndex === null) {
      engine.placeBid(game, askIdx, { pass: true });
      return true;
    }

    if (difficulty === 'standard') {
      const maxWilling = Math.min(bot.money, Math.floor(standardLotVal * (isAuctioneer ? 0.68 : 0.74)));
      const nextBid = Math.min(
        maxWilling,
        a.currentBid + (a.currentBid === 0 ? Math.max(1, Math.floor(standardLotVal * 0.35)) : 3)
      );
      if (nextBid > a.currentBid && nextBid <= bot.money) {
        engine.placeBid(game, askIdx, { amount: nextBid });
      } else {
        engine.placeBid(game, askIdx, { pass: true });
      }
      return true;
    }

    const profile = getBotProfile(bot);
    const valuation = computeBotLotValuation(game, askIdx, a.cards, profile);
    const maxWilling = getMaxProfitableBid(game, a, askIdx, valuation, profile);
    const remainingAfter = game.players.length - 1 - a.askedCount;

    if (maxWilling <= a.currentBid || bot.money <= a.currentBid) {
      engine.placeBid(game, askIdx, { pass: true });
      return true;
    }

    let nextBid;
    if (remainingAfter === 0) {
      // Final bidder in once_around never needs to pay more than +1
      nextBid = a.currentBid + 1;
    } else if (remainingAfter === 1) {
      // Acting right before auctioneer: bid just past the auctioneer's ~50% break-even threshold
      const breakEvenClear = Math.ceil(valuation * 0.52);
      nextBid = Math.min(maxWilling, Math.max(a.currentBid + 1, breakEvenClear));
    } else {
      const jumpTarget = Math.round(maxWilling * Math.min(0.92, 0.72 * profile.aggression));
      nextBid = Math.min(maxWilling, Math.max(a.currentBid + 2, jumpTarget));
    }

    if (nextBid > a.currentBid && nextBid <= bot.money) {
      engine.placeBid(game, askIdx, { amount: nextBid });
    } else {
      engine.placeBid(game, askIdx, { pass: true });
    }
    return true;
  }

  if (a.auctionType === 'hidden') {
    const candidateIdx = game.players.findIndex(
      (p, idx) => p.isAI && !Object.prototype.hasOwnProperty.call(a.hiddenBids, idx)
    );
    if (candidateIdx === -1) return false;

    const bot = game.players[candidateIdx];
    const difficulty = getBotDifficulty(game, candidateIdx);
    const isAuctioneer = candidateIdx === a.auctioneerIndex;

    if (difficulty === 'standard') {
      const factor = isAuctioneer ? 0.45 + Math.random() * 0.15 : 0.55 + Math.random() * 0.22;
      const bid = Math.max(0, Math.min(bot.money, Math.floor(standardLotVal * factor)));
      engine.submitHiddenBid(game, candidateIdx, bid);
      return true;
    }

    const profile = getBotProfile(bot);
    const valuation = computeBotLotValuation(game, candidateIdx, a.cards, profile);
    const isSoleAuctioneer = a.coAuctioneerIndex === null && isAuctioneer;

    let rawBid;
    if (isSoleAuctioneer) {
      const reserveFactor = 0.35 + Math.random() * 0.11;
      rawBid = Math.floor(valuation * reserveFactor);
    } else if (candidateIdx === a.auctioneerIndex || candidateIdx === a.coAuctioneerIndex) {
      const factor = 0.42 + Math.random() * 0.12;
      rawBid = Math.floor(valuation * factor);
    } else {
      const buyerFactor = (0.58 + Math.random() * 0.18) * profile.aggression;
      rawBid = Math.floor(valuation * buyerFactor) + (valuation >= 12 ? 1 : 0);
      rawBid = Math.min(rawBid, Math.floor(valuation * 0.84));
    }

    const bid = Math.max(0, Math.min(bot.money, rawBid));
    engine.submitHiddenBid(game, candidateIdx, bid);
    return true;
  }

  if (a.auctionType === 'fixed_price') {
    if (a.fixedPrice === null) {
      const aucBot = game.players[a.auctioneerIndex];
      if (!aucBot || !aucBot.isAI) return false;

      const difficulty = getBotDifficulty(game, a.auctioneerIndex);
      if (difficulty === 'standard') {
        const price =
          aucBot.money === 0
            ? 0
            : Math.max(1, Math.min(aucBot.money, Math.floor(standardLotVal * (0.68 + Math.random() * 0.14))));
        engine.setFixedPrice(game, a.auctioneerIndex, price);
        return true;
      }

      const profile = getBotProfile(aucBot);
      const valuation = computeBotLotValuation(game, a.auctioneerIndex, a.cards, profile);
      const safeCap = Math.max(1, valuation - 2);
      const target = Math.round(valuation * (profile.fixedMarkup + (Math.random() * 0.08 - 0.03)));
      const price =
        aucBot.money === 0
          ? 0
          : Math.max(1, Math.min(aucBot.money, safeCap, target));
      engine.setFixedPrice(game, a.auctioneerIndex, price);
      return true;
    }

    const askIdx = a.askingPlayerIndex;
    const bot = game.players[askIdx];
    if (!bot || !bot.isAI) return false;

    const difficulty = getBotDifficulty(game, askIdx);
    if (difficulty === 'standard') {
      const maxWilling = Math.floor(standardLotVal * 0.8);
      const shouldBuy = bot.money >= a.fixedPrice && a.fixedPrice <= maxWilling;
      engine.buyFixedPrice(game, askIdx, shouldBuy);
      return true;
    }

    const profile = getBotProfile(bot);
    const valuation = computeBotLotValuation(game, askIdx, a.cards, profile);
    const passGain = computePassCashGain(a, askIdx, a.fixedPrice);
    const maxWilling =
      askIdx === a.coAuctioneerIndex
        ? Math.floor(valuation - passGain - 2)
        : Math.floor(valuation * 0.82 * profile.aggression);
    const shouldBuy = bot.money >= a.fixedPrice && a.fixedPrice <= maxWilling;
    engine.buyFixedPrice(game, askIdx, shouldBuy);
    return true;
  }

  return false;
}

function performBotStep(game) {
  if (game.phase === 'PLAY_CARD') {
    const bot = game.players[game.turnPlayerIndex];
    if (!bot || !bot.isAI || bot.hand.length === 0) return false;
    const card = chooseCardToPlay(game, game.turnPlayerIndex);
    engine.playCard(game, game.turnPlayerIndex, card.id);
    return true;
  }

  if (game.phase === 'DOUBLE_OFFER' && game.doubleState) {
    return performDoubleOfferStep(game);
  }

  if (game.phase === 'AUCTION' && game.activeAuction) {
    return performAuctionStep(game);
  }

  if (game.phase === 'HIDDEN_REVEAL' && game.hiddenReveal) {
    const confirmed = game.hiddenReveal.confirmedPlayerIndexes;
    const unconfirmedBot = game.players.findIndex((p, idx) => p.isAI && !confirmed.includes(idx));
    if (unconfirmedBot !== -1) {
      engine.confirmHiddenReveal(game, unconfirmedBot);
      return true;
    }
    return false;
  }

  return false;
}

module.exports = {
  BOT_PROFILES,
  getBotProfile,
  simulateSeasonPayouts,
  estimateArtistValues,
  getLotValue,
  computePassCashGain,
  chooseCardToPlay,
  performBotStep,
};
