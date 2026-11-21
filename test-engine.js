const assert = require('assert');
const engine = require('./gameEngine');
const botEngine = require('./botEngine');

function makeCard(id, artistIndex, auctionType) {
  const a = engine.ARTISTS[artistIndex];
  return {
    id,
    artistIndex: a.index,
    artistId: a.id,
    artistName: `${a.name} (${a.zhName})`,
    color: a.color,
    style: a.style,
    auctionType,
    title: `Test ${id}`,
    artSeed: 1,
  };
}

function makeTestGame(numPlayers = 3) {
  const specs = Array.from({ length: numPlayers }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    isAI: false,
  }));
  return engine.createGame(specs);
}

console.log('1. Testing deck composition (70 cards: 12, 13, 14, 15, 16) & 70 unique card image paths...');
const fullDeck = engine.createDeck();
assert.strictEqual(fullDeck.length, 70, 'Total deck must have 70 cards');
const countsByArtist = [0, 0, 0, 0, 0];
const uniqueImages = new Set();
for (const c of fullDeck) {
  countsByArtist[c.artistIndex]++;
  uniqueImages.add(c.image);
  assert.ok(c.backdropImage && c.backdropImage.startsWith('/assets/artist_'), 'Each card must have backdropImage');
}
assert.deepStrictEqual(countsByArtist, [12, 13, 14, 15, 16]);
assert.strictEqual(uniqueImages.size, 70, 'All 70 cards must have unique image paths');

console.log('2. Testing deal counts for 3, 4, 5 players across seasons...');
for (const n of [3, 4, 5]) {
  const g = makeTestGame(n);
  const expectedS1 = engine.DEAL_COUNTS[n][0];
  g.players.forEach((p) => {
    assert.strictEqual(p.money, 100);
    assert.strictEqual(p.hand.length, expectedS1);
  });
}

console.log('3. Testing open auction & self-buy payment to bank...');
{
  const g = makeTestGame(3);
  const c1 = makeCard('c1', 0, 'open');
  g.players[0].hand = [c1, makeCard('c1b', 1, 'open')];
  g.players[1].hand = [makeCard('c2', 1, 'open')];
  g.players[2].hand = [makeCard('c3', 2, 'open')];

  engine.playCard(g, 0, 'c1');
  assert.strictEqual(g.phase, 'AUCTION');
  engine.placeBid(g, 1, { amount: 20 });
  engine.placeBid(g, 0, { amount: 25 }); // Auctioneer bids 25
  engine.placeBid(g, 1, { pass: true });
  engine.placeBid(g, 2, { pass: true });
  // P0 won own auction for 25 -> pays bank, so P0 money = 75, P1 = 100
  assert.strictEqual(g.players[0].money, 75);
  assert.strictEqual(g.players[1].money, 100);
  assert.strictEqual(g.players[0].purchased.length, 1);
  assert.strictEqual(g.turnPlayerIndex, 1);
}

console.log('4. Testing once-around auction...');
{
  const g = makeTestGame(3);
  const c1 = makeCard('oa1', 1, 'once_around');
  g.players[0].hand = [c1, makeCard('oa2', 2, 'open')];
  g.players[1].hand = [makeCard('oa3', 2, 'open')];
  g.players[2].hand = [makeCard('oa4', 2, 'open')];

  engine.playCard(g, 0, 'oa1');
  assert.strictEqual(g.activeAuction.askingPlayerIndex, 1);
  assert.deepStrictEqual(g.activeAuction.onceAroundBids, {});
  engine.placeBid(g, 1, { amount: 15 });
  assert.strictEqual(g.activeAuction.askingPlayerIndex, 2);
  assert.deepStrictEqual(g.activeAuction.onceAroundBids[1], { action: 'bid', amount: 15 });
  assert.deepStrictEqual(engine.getSanitizedState(g, g.players[0].id).activeAuction.onceAroundBids, {
    1: { action: 'bid', amount: 15 },
  });
  engine.placeBid(g, 2, { pass: true });
  assert.strictEqual(g.activeAuction.askingPlayerIndex, 0);
  assert.deepStrictEqual(g.activeAuction.onceAroundBids[2], { action: 'pass', amount: null });
  engine.placeBid(g, 0, { pass: true }); // P0 lets P1 win -> P1 pays P0 $15
  assert.strictEqual(g.players[1].money, 85);
  assert.strictEqual(g.players[0].money, 115);
  assert.strictEqual(g.players[1].purchased.length, 1);
}

console.log('5. Testing hidden bid, HIDDEN_REVEAL confirmation/30s timeout, & clockwise tie-breaker...');
{
  const g = makeTestGame(4);
  const c1 = makeCard('h1', 2, 'hidden');
  g.turnPlayerIndex = 1; // P1 is auctioneer
  g.players[1].hand = [c1, makeCard('h2', 0, 'open')];
  g.players[0].hand = [makeCard('h3', 0, 'open')];
  g.players[2].hand = [makeCard('h4', 0, 'open')];
  g.players[3].hand = [makeCard('h5', 0, 'open')];

  engine.playCard(g, 1, 'h1');
  // P0, P2, P3 all bid 30, P1 bids 10 -> clockwise from P1 is P2 -> P3 -> P0, so P2 must win!
  engine.submitHiddenBid(g, 0, 30);
  engine.submitHiddenBid(g, 1, 10);
  engine.submitHiddenBid(g, 2, 30);
  engine.submitHiddenBid(g, 3, 30);

  assert.strictEqual(g.lastAuctionSummary.winnerIndex, 2);
  assert.strictEqual(g.players[2].money, 70);
  assert.strictEqual(g.players[1].money, 130);
  assert.strictEqual(g.phase, 'HIDDEN_REVEAL');
  assert.ok(g.hiddenReveal);
  assert.strictEqual(g.hiddenReveal.revealedBids.length, 4);
  assert.strictEqual(engine.getSanitizedState(g, g.players[0].id).hiddenReveal.revealedBids.length, 4);

  // Must wait until all players confirm (duplicate confirmation does not advance)
  engine.confirmHiddenReveal(g, 0);
  engine.confirmHiddenReveal(g, 0);
  engine.confirmHiddenReveal(g, 1);
  engine.confirmHiddenReveal(g, 2);
  assert.strictEqual(g.phase, 'HIDDEN_REVEAL');
  engine.confirmHiddenReveal(g, 3);
  assert.strictEqual(g.phase, 'PLAY_CARD');
  assert.strictEqual(g.hiddenReveal, null);

  // Also test tie including auctioneer: auctioneer must win tie, plus 30s timeout auto-advance
  const c2 = makeCard('h6', 3, 'hidden');
  g.players[2].hand.push(c2);
  assert.strictEqual(g.turnPlayerIndex, 2);
  engine.playCard(g, 2, 'h6');
  engine.submitHiddenBid(g, 2, 25); // auctioneer
  engine.submitHiddenBid(g, 3, 25);
  engine.submitHiddenBid(g, 0, 20);
  engine.submitHiddenBid(g, 1, 0);
  assert.strictEqual(g.lastAuctionSummary.winnerIndex, 2);
  assert.strictEqual(g.players[2].money, 45); // paid 25 to bank
  assert.strictEqual(g.phase, 'HIDDEN_REVEAL');
  assert.strictEqual(engine.checkHiddenRevealTimeout(g, g.hiddenReveal.expiresAt - 1), false);
  assert.strictEqual(g.phase, 'HIDDEN_REVEAL');
  assert.strictEqual(engine.checkHiddenRevealTimeout(g, g.hiddenReveal.expiresAt), true);
  assert.strictEqual(g.phase, 'PLAY_CARD');
  assert.strictEqual(g.hiddenReveal, null);
}

console.log('6. Testing fixed_price mandatory self-buy...');
{
  const g = makeTestGame(3);
  const c1 = makeCard('fp1', 0, 'fixed_price');
  g.players[0].hand = [c1, makeCard('fp2', 1, 'open')];
  g.players[1].hand = [makeCard('fp3', 1, 'open')];
  g.players[2].hand = [makeCard('fp4', 1, 'open')];

  engine.playCard(g, 0, 'fp1');
  engine.setFixedPrice(g, 0, 40);
  engine.buyFixedPrice(g, 1, false);
  engine.buyFixedPrice(g, 2, false);
  // All others passed -> P0 forced to buy at 40 (paid to bank)
  assert.strictEqual(g.players[0].money, 60);
  assert.strictEqual(g.players[0].purchased.length, 1);
  assert.strictEqual(g.turnPlayerIndex, 1);
}

console.log('7. Testing double auction 50/50 split & co-auctioneer self-buy payment...');
{
  const g = makeTestGame(3);
  const d1 = makeCard('d1', 4, 'double');
  const d2 = makeCard('d2', 4, 'open');
  g.players[0].hand = [d1, makeCard('x1', 0, 'open')];
  g.players[1].hand = [d2, makeCard('x2', 0, 'open')];
  g.players[2].hand = [makeCard('x3', 0, 'open')];

  engine.playCard(g, 0, 'd1');
  assert.strictEqual(g.phase, 'DOUBLE_OFFER');
  engine.respondDouble(g, 0, { pass: true }); // P0 has no second card
  assert.strictEqual(g.doubleState.askingPlayerIndex, 1);
  engine.respondDouble(g, 1, { cardId: 'd2' }); // P1 becomes auctioneer, P0 is co-auctioneer

  assert.strictEqual(g.phase, 'AUCTION');
  assert.strictEqual(g.activeAuction.auctioneerIndex, 1);
  assert.strictEqual(g.activeAuction.coAuctioneerIndex, 0);

  // Case A: P2 buys for odd $25 -> P0 gets floor(25/2)=12, P1 gets ceil(25/2)=13
  engine.placeBid(g, 2, { amount: 25 });
  engine.placeBid(g, 0, { pass: true });
  engine.placeBid(g, 1, { pass: true });
  assert.strictEqual(g.players[2].money, 75);
  assert.strictEqual(g.players[0].money, 112);
  assert.strictEqual(g.players[1].money, 113);
  assert.strictEqual(g.players[2].purchased.length, 2);
  // Next turn must be after P1 (new auctioneer) -> P2!
  assert.strictEqual(g.turnPlayerIndex, 2);

  // Case B: Co-auctioneer (P1) wins own double auction for $21 -> pays $10 to P0, $11 to bank
  const d3 = makeCard('d3', 1, 'double');
  const d4 = makeCard('d4', 1, 'open');
  g.players[2].hand.push(d3);
  g.players[1].hand.push(d4);
  engine.playCard(g, 2, 'd3');
  engine.respondDouble(g, 2, { pass: true });
  engine.respondDouble(g, 0, { pass: true });
  engine.respondDouble(g, 1, { cardId: 'd4' }); // P1 is auctioneer, P2 is coAuctioneer
  engine.placeBid(g, 1, { amount: 21 });
  engine.placeBid(g, 0, { pass: true });
  engine.placeBid(g, 2, { pass: true });
  // P1 paid 21 total (113 - 21 = 92), P2 got floor(21/2)=10 (75 + 10 = 85)
  assert.strictEqual(g.players[1].money, 92);
  assert.strictEqual(g.players[2].money, 85);
}

console.log('8. Testing 5th card immediate termination, tie-breaking, and cumulative valuation...');
{
  const g = makeTestGame(3);
  // Season 1: Artist 0 has 3 cards, Artist 1 has 5 cards (triggers end!), Artist 2 has 3 cards, Artist 3 has 1 card
  // Tie between Artist 0 (3) and Artist 2 (3) -> Artist 0 (leftmost) gets 2nd (+20), Artist 2 gets 3rd (+10)
  g.seasonCounts = [3, 4, 3, 1, 0];
  g.players[0].purchased = [makeCard('p0_a0', 0, 'open'), makeCard('p0_a1', 1, 'open')];
  g.players[1].purchased = [makeCard('p1_a2', 2, 'open'), makeCard('p1_a3', 3, 'open')];
  g.players[2].hand = [makeCard('trigger5', 1, 'open'), makeCard('keep1', 0, 'open')];
  g.players[0].hand = [makeCard('keep2', 0, 'open')];
  g.players[1].hand = [makeCard('keep3', 0, 'open')];
  g.turnPlayerIndex = 2;

  engine.playCard(g, 2, 'trigger5'); // 5th card of Artist 1!
  assert.strictEqual(g.phase, 'SEASON_SETTLEMENT');
  // P2 did not get to buy trigger5
  assert.strictEqual(g.players[2].purchased.length, 0);
  // Season 1 bonuses: Artist 1 = 30, Artist 0 = 20, Artist 2 = 10, Artist 3 = 0
  assert.deepStrictEqual(g.seasonValues[0], [20, 30, 10, 0, 0]);
  // P0 earned 20 + 30 = 50 -> 150; P1 earned 10 + 0 = 10 -> 110
  assert.strictEqual(g.players[0].money, 150);
  assert.strictEqual(g.players[1].money, 110);
  assert.strictEqual(g.players[0].purchased.length, 0);

  // Start Season 2: next player after P2 (who played 5th card) must be P0!
  engine.startNextSeason(g);
  assert.strictEqual(g.season, 2);
  assert.strictEqual(g.turnPlayerIndex, 0);

  // Season 2: Artist 1 misses top 3! Payout for Artist 1 must be 0 even though it had 30 in S1!
  g.seasonCounts = [5, 1, 4, 3, 0]; // S2 ranking: A0(30), A2(20), A3(10); A1 gets 0!
  g.players[0].purchased = [makeCard('s2_a1', 1, 'open'), makeCard('s2_a0', 0, 'open')];
  engine.settleSeason(g);
  // A0 payout in S2 = S1(20) + S2(30) = 50; A1 payout in S2 = 0!
  assert.strictEqual(g.lastSeasonReport.payoutsPerArtist[0], 50);
  assert.strictEqual(g.lastSeasonReport.payoutsPerArtist[1], 0);
  assert.strictEqual(g.players[0].money, 200);
}

console.log('9. Testing hidden information sanitization...');
{
  const g = makeTestGame(3);
  const viewForP0 = engine.getSanitizedState(g, 'p0');
  assert.strictEqual(viewForP0.players[0].money, 100);
  assert.ok(Array.isArray(viewForP0.players[0].hand));
  assert.strictEqual(viewForP0.players[1].money, null);
  assert.strictEqual(viewForP0.players[1].hand, null);
  assert.strictEqual(viewForP0.players[1].handCount, 10);
}

console.log('10. Testing full 4-season simulated bot game...');
{
  const g = engine.createGame([
    { id: 'b0', name: 'Bot 0', isAI: true },
    { id: 'b1', name: 'Bot 1', isAI: true },
    { id: 'b2', name: 'Bot 2', isAI: true },
    { id: 'b3', name: 'Bot 3', isAI: true },
  ]);
  let guard = 0;
  while (g.phase !== 'GAME_OVER' && guard < 5000) {
    guard++;
    if (g.phase === 'SEASON_SETTLEMENT') {
      engine.startNextSeason(g);
    } else {
      const acted = botEngine.performBotStep(g);
      assert.ok(acted, `Bot must be able to act in phase ${g.phase}`);
    }
  }
  assert.strictEqual(g.phase, 'GAME_OVER');
  assert.strictEqual(g.season, 4);
  assert.strictEqual(g.rankings.length, 4);
  console.log(`   Simulated 4-player bot game completed in ${guard} steps! Winner: ${g.rankings[0].name} ($${g.rankings[0].money})`);
}

console.log('ALL TESTS PASSED!');
