const engine = require('./gameEngine');

function estimateArtistValues(game) {
  const seasonIdx = game.season - 1;
  const scores = engine.ARTISTS.map((a) => {
    const played = game.seasonCounts[a.index];
    let hist = 0;
    for (let s = 0; s < seasonIdx; s++) {
      hist += game.seasonValues[s][a.index];
    }
    return {
      artistIndex: a.index,
      played,
      hist,
      score: played + (played > 0 ? 0.2 : 0) + (4 - a.index) * 0.02,
    };
  });

  const ranked = [...scores]
    .filter((s) => s.played > 0 || game.season === 1)
    .sort((a, b) => b.score - a.score || a.artistIndex - b.artistIndex);

  const projectedBonus = [0, 0, 0, 0, 0];
  ranked.slice(0, 3).forEach((entry, rankIdx) => {
    projectedBonus[entry.artistIndex] = engine.TOP_BONUSES[rankIdx];
  });

  return scores.map((s) => {
    const bonus = projectedBonus[s.artistIndex];
    if (bonus === 0) {
      // Give a small speculative floor early in the season
      return s.played === 0 ? 8 : Math.min(12, Math.floor((s.hist + 10) * 0.25));
    }
    const confidence = s.played >= 3 ? 1.0 : s.played >= 1 ? 0.85 : 0.6;
    return Math.round((s.hist + bonus) * confidence);
  });
}

function getLotValue(game, cards) {
  const vals = estimateArtistValues(game);
  return cards.reduce((sum, c) => sum + (vals[c.artistIndex] || 10), 0);
}

function chooseCardToPlay(game, botIndex) {
  const bot = game.players[botIndex];
  const vals = estimateArtistValues(game);
  const myPurchasedCounts = [0, 0, 0, 0, 0];
  const oppPurchasedCounts = [0, 0, 0, 0, 0];

  game.players.forEach((p, idx) => {
    for (const c of p.purchased) {
      if (idx === botIndex) myPurchasedCounts[c.artistIndex] += 1;
      else oppPurchasedCounts[c.artistIndex] += 1;
    }
  });

  let bestCard = bot.hand[0];
  let bestScore = -Infinity;

  for (const card of bot.hand) {
    const aIdx = card.artistIndex;
    const countOnBoard = game.seasonCounts[aIdx];
    let score = vals[aIdx];

    if (countOnBoard === 4) {
      // 5th card trigger! Good if opponents hold more or we don't lose much
      const diff = oppPurchasedCounts[aIdx] - myPurchasedCounts[aIdx];
      score += diff * 18 + 5;
    } else {
      // Prefer boosting artists we already bought or have multiple copies of
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

function performBotStep(game) {
  if (game.phase === 'PLAY_CARD') {
    const bot = game.players[game.turnPlayerIndex];
    if (!bot || !bot.isAI || bot.hand.length === 0) return false;
    const card = chooseCardToPlay(game, game.turnPlayerIndex);
    engine.playCard(game, game.turnPlayerIndex, card.id);
    return true;
  }

  if (game.phase === 'DOUBLE_OFFER' && game.doubleState) {
    const askIdx = game.doubleState.askingPlayerIndex;
    const bot = game.players[askIdx];
    if (!bot || !bot.isAI) return false;

    const primary = game.doubleState.primaryCard;
    const matching = bot.hand.filter(
      (c) => c.artistIndex === primary.artistIndex && c.auctionType !== 'double'
    );

    if (matching.length > 0) {
      const countOnBoard = game.seasonCounts[primary.artistIndex];
      const myOwn = bot.purchased.filter((c) => c.artistIndex === primary.artistIndex).length;
      // Don't accidentally bust the 5th card if we own paintings of that artist and opponents don't
      if (countOnBoard === 4 && myOwn > 0) {
        engine.respondDouble(game, askIdx, { pass: true });
      } else {
        engine.respondDouble(game, askIdx, { cardId: matching[0].id });
      }
    } else {
      engine.respondDouble(game, askIdx, { pass: true });
    }
    return true;
  }

  if (game.phase === 'AUCTION' && game.activeAuction) {
    const a = game.activeAuction;
    const lotVal = getLotValue(game, a.cards);

    if (a.auctionType === 'open') {
      const candidateIdx = game.players.findIndex(
        (p, idx) => p.isAI && idx !== a.highestBidderIndex && !a.passedPlayers.includes(idx)
      );
      if (candidateIdx === -1) return false;

      const bot = game.players[candidateIdx];
      const isAuctioneer = candidateIdx === a.auctioneerIndex || candidateIdx === a.coAuctioneerIndex;

      // Never outbid nothing when we are the auctioneer (we get it free if everyone passes)
      if (isAuctioneer && a.highestBidderIndex === null) {
        engine.placeBid(game, candidateIdx, { pass: true });
        return true;
      }

      const ratio = isAuctioneer ? 0.65 : 0.72 + (candidateIdx % 3) * 0.04;
      const maxWilling = Math.min(bot.money, Math.floor(lotVal * ratio));
      const step = lotVal >= 40 ? 5 : 2;
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

      const isAuctioneer = askIdx === a.auctioneerIndex || askIdx === a.coAuctioneerIndex;
      if (isAuctioneer && a.highestBidderIndex === null) {
        engine.placeBid(game, askIdx, { pass: true });
        return true;
      }

      const maxWilling = Math.min(bot.money, Math.floor(lotVal * (isAuctioneer ? 0.68 : 0.74)));
      const nextBid = Math.min(maxWilling, a.currentBid + (a.currentBid === 0 ? Math.max(1, Math.floor(lotVal * 0.35)) : 3));

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
      const isAuctioneer = candidateIdx === a.auctioneerIndex;
      const factor = isAuctioneer ? 0.45 + Math.random() * 0.15 : 0.55 + Math.random() * 0.22;
      const bid = Math.max(0, Math.min(bot.money, Math.floor(lotVal * factor)));
      engine.submitHiddenBid(game, candidateIdx, bid);
      return true;
    }

    if (a.auctionType === 'fixed_price') {
      if (a.fixedPrice === null) {
        const aucBot = game.players[a.auctioneerIndex];
        if (!aucBot || !aucBot.isAI) return false;
        const price =
          aucBot.money === 0
            ? 0
            : Math.max(1, Math.min(aucBot.money, Math.floor(lotVal * (0.68 + Math.random() * 0.14))));
        engine.setFixedPrice(game, a.auctioneerIndex, price);
        return true;
      }

      const askIdx = a.askingPlayerIndex;
      const bot = game.players[askIdx];
      if (!bot || !bot.isAI) return false;

      const maxWilling = Math.floor(lotVal * 0.8);
      const shouldBuy = bot.money >= a.fixedPrice && a.fixedPrice <= maxWilling;
      engine.buyFixedPrice(game, askIdx, shouldBuy);
      return true;
    }
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
  estimateArtistValues,
  getLotValue,
  performBotStep,
};
