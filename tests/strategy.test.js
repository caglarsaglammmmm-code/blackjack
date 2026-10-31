import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommend } from '../js/strategy.js';
import { BlackjackGame } from '../js/game.js';

const all = { canDouble: true, canSplit: true, canSurrender: true };
const play = (ranks, dealerRank, options = all) => recommend({
  cards: ranks.map((rank) => ({ rank })), dealerRank, ...options,
});

test('sert toplamlar', () => {
  assert.equal(play(['5', '3'], '6'), 'hit');
  assert.equal(play(['5', '4'], '3'), 'double');
  assert.equal(play(['5', '4'], '2'), 'hit');
  assert.equal(play(['6', '4'], '9'), 'double');
  assert.equal(play(['6', '4'], '10'), 'hit');
  assert.equal(play(['6', '5'], '10'), 'double');
  assert.equal(play(['6', '5'], 'A'), 'hit'); // S17: Asa karşı 11 double yok
  assert.equal(play(['10', '2'], '3'), 'hit');
  assert.equal(play(['10', '2'], '4'), 'stand');
  assert.equal(play(['10', '6'], '6'), 'stand');
  assert.equal(play(['10', '7'], 'A'), 'stand'); // S17: 17 teslim edilmez
});

test('late surrender tablosu', () => {
  assert.equal(play(['10', '6'], '9'), 'surrender');
  assert.equal(play(['10', '6'], 'K'), 'surrender');
  assert.equal(play(['10', '6'], 'A'), 'surrender');
  assert.equal(play(['10', '5'], '10'), 'surrender');
  assert.equal(play(['10', '5'], '9'), 'hit');
  assert.equal(play(['10', '5'], 'A'), 'hit');
  assert.equal(play(['10', '6'], '10', { ...all, canSurrender: false }), 'hit');
});

test('soft toplamlar', () => {
  assert.equal(play(['A', '2'], '5'), 'double');
  assert.equal(play(['A', '2'], '4'), 'hit');
  assert.equal(play(['A', '5'], '4'), 'double');
  assert.equal(play(['A', '6'], '3'), 'double');
  assert.equal(play(['A', '7'], '2'), 'stand');
  assert.equal(play(['A', '7'], '6'), 'double');
  assert.equal(play(['A', '7'], '6', { ...all, canDouble: false }), 'stand');
  assert.equal(play(['A', '7'], '8'), 'stand');
  assert.equal(play(['A', '7'], '9'), 'hit');
  assert.equal(play(['A', '8'], '6'), 'stand');
});

test('çiftler', () => {
  assert.equal(play(['A', 'A'], 'A'), 'split');
  assert.equal(play(['8', '8'], 'A'), 'split');
  assert.equal(play(['8', '8'], '10'), 'split');
  assert.equal(play(['10', 'K'], '6'), 'stand');
  assert.equal(play(['9', '9'], '7'), 'stand');
  assert.equal(play(['9', '9'], '8'), 'split');
  assert.equal(play(['5', '5'], '6'), 'double');
  assert.equal(play(['4', '4'], '5'), 'split');
  assert.equal(play(['4', '4'], '4'), 'hit');
  assert.equal(play(['2', '2'], '7'), 'split');
  assert.equal(play(['6', '6'], '7'), 'hit');
  assert.equal(play(['7', '7'], '7'), 'split');
});

test('split yoksa sert/soft tabloya düşer', () => {
  const noSplit = { ...all, canSplit: false };
  assert.equal(play(['8', '8'], '10', noSplit), 'surrender');
  assert.equal(play(['A', 'A'], '6', noSplit), 'hit');
});

test('uzun eller', () => {
  assert.equal(play(['2', '3', '4', '3'], '6', { canDouble: false, canSplit: false, canSurrender: false }), 'stand');
  assert.equal(play(['A', '2', '3'], '5', { canDouble: false, canSplit: false, canSurrender: false }), 'hit');
});

// Gerçek motorda temel stratejiyi oynatır. Bilinen ev avantajı (6D S17 DAS LS
// yaklaşık %0.3-0.45) tutuyorsa kurallar ve tablo birlikte doğru demektir.
test('simülasyon: temel strateji ev avantajı beklenen aralıkta', () => {
  const game = new BlackjackGame({ balance: 1e12 });
  const start = game.balance;
  const rounds = 400000;
  for (let i = 0; i < rounds; i += 1) {
    game.deal(10);
    if (game.phase === 'insurance') game.insurance(false);
    while (game.phase === 'player') {
      const actions = game.availableActions();
      const move = recommend({
        cards: game.activeHand.cards,
        dealerRank: game.dealerUp.rank,
        canDouble: actions.double,
        canSplit: actions.split,
        canSurrender: actions.surrender,
      });
      assert.ok(actions[move], move);
      game[move]();
    }
    game.nextRound();
  }
  const edge = (start - game.balance) / (rounds * 10);
  assert.ok(edge > -0.004 && edge < 0.011, `ev avantajı ${(edge * 100).toFixed(3)}%`);
  console.log(`  ev avantajı: ${(edge * 100).toFixed(3)}%`);
});
