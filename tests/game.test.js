import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BlackjackGame, RULES, createShoe, handValue, isNatural, shuffle,
} from '../js/game.js';
import { applyResults, defaultStats } from '../js/storage.js';

const c = (...ranks) => ranks.map((rank) => ({ rank, suit: 'S' }));

// Dağıtım sırası: oyuncu, krupiye (açık), oyuncu, krupiye (kapalı), sonrakiler.
function setup(cards, balance = 5000) {
  const game = new BlackjackGame({ balance });
  game.stack(cards);
  return game;
}

const typesOf = (events) => events.map((event) => event.type);

test('el değeri: temel toplamlar ve figürler', () => {
  assert.equal(handValue(c('2', '9')).total, 11);
  assert.equal(handValue(c('J', 'Q')).total, 20);
  assert.equal(handValue(c('K', '10', '5')).bust, true);
});

test('soft el: As 11 sayılır, gerekince 1e düşer', () => {
  assert.deepEqual(handValue(c('A', '6')), { total: 17, soft: true, bust: false });
  assert.deepEqual(handValue(c('A', '6', '10')), { total: 17, soft: false, bust: false });
  assert.deepEqual(handValue(c('A', 'A')), { total: 12, soft: true, bust: false });
  assert.deepEqual(handValue(c('A', 'A', '9')), { total: 21, soft: true, bust: false });
  assert.deepEqual(handValue(c('A', 'A', 'K', 'K')), { total: 22, soft: false, bust: true });
});

test('blackjack yalnızca iki kartlı 21dir', () => {
  assert.equal(isNatural(c('A', 'K')), true);
  assert.equal(isNatural(c('7', '7', '7')), false);
});

test('ayakkabı 312 kart, her karttan 6 adet; karıştırma kart kaybetmez', () => {
  const shoe = createShoe(6);
  assert.equal(shoe.length, 312);
  assert.equal(shoe.filter((card) => card.rank === 'A' && card.suit === 'S').length, 6);
  const shuffled = shuffle([...shoe], Math.random);
  assert.notDeepEqual(shuffled.map((x) => x.id), shoe.map((x) => x.id));
  assert.deepEqual(shuffled.map((x) => x.id).sort((a, b) => a - b), shoe.map((x) => x.id));
});

test('Fisher-Yates dağılımı tekdüzedir', () => {
  const counts = new Array(4).fill(0);
  const runs = 40000;
  for (let i = 0; i < runs; i += 1) {
    counts[shuffle([0, 1, 2, 3], Math.random).indexOf(0)] += 1;
  }
  for (const count of counts) assert.ok(Math.abs(count - runs / 4) < runs * 0.02);
});

test('bahis sınırları', () => {
  const game = new BlackjackGame({ balance: 100 });
  assert.equal(game.canBet(5), false);
  assert.equal(game.canBet(10), true);
  assert.equal(game.canBet(110), false);
  assert.equal(new BlackjackGame({ balance: 9000 }).canBet(5010), false);
  assert.throws(() => game.deal(5));
});

test('normal kazanç 1:1 öder', () => {
  const game = setup(['10', '10', '10', '7']);
  game.deal(100);
  const events = game.stand();
  assert.equal(game.balance, 5100);
  assert.equal(game.state.results.hands[0].outcome, 'win');
  assert.ok(typesOf(events).includes('reveal'));
});

test('kaybetme ve beraberlik', () => {
  const lose = setup(['10', '10', '7', '10']);
  lose.deal(100);
  lose.stand();
  assert.equal(lose.balance, 4900);

  const push = setup(['10', '10', '10', '10']);
  push.deal(100);
  push.stand();
  assert.equal(push.balance, 5000);
  assert.equal(push.state.results.hands[0].outcome, 'push');
});

test('blackjack 3:2 öder ve el hemen biter', () => {
  const game = setup(['A', '9', 'K', '7']);
  game.deal(100);
  assert.equal(game.phase, 'settled');
  assert.equal(game.balance, 5150);
  assert.equal(game.holeHidden, false);
  assert.equal(game.state.results.hands[0].outcome, 'blackjack');
});

test('10 açık kartta peek: krupiye blackjack ise el biter, oyuncu hamle yapamaz', () => {
  const game = setup(['10', 'K', '9', 'A']);
  const events = game.deal(100);
  assert.ok(typesOf(events).includes('peek'));
  assert.equal(game.phase, 'settled');
  assert.equal(game.balance, 4900);
});

test('peek: oyuncu ve krupiye blackjack ise push', () => {
  const game = setup(['A', 'K', 'K', 'A']);
  game.deal(100);
  assert.equal(game.state.results.hands[0].outcome, 'push');
  assert.equal(game.balance, 5000);
});

test('2-9 açık kartta peek yapılmaz', () => {
  const game = setup(['10', '9', '9', 'K']);
  const events = game.deal(100);
  assert.ok(!typesOf(events).includes('peek'));
  assert.equal(game.phase, 'player');
});

test('krupiye soft 17de durur', () => {
  const game = setup(['10', '6', '8', 'A']);
  game.deal(100); // krupiye 6 + A = soft 17
  game.stand();
  assert.equal(game.dealerCards.length, 2);
  assert.equal(game.balance, 5100);
});

test('krupiye 16da çeker, hard 17de durur, soft 18 geçer', () => {
  const game = setup(['10', '10', '8', '6', 'A', '9']);
  game.deal(100);
  game.stand();
  assert.equal(game.dealerCards.length, 3); // 10+6+A = hard 17
  assert.equal(handValue(game.dealerCards).total, 17);
});

test('krupiye soft 16da çeker', () => {
  const game = setup(['10', 'A', '9', '5', '2']);
  game.deal(100); // açık As: sigorta aşaması
  game.insurance(false);
  game.stand();
  assert.equal(handValue(game.dealerCards).total, 18);
});

test('bust: bahis gider, krupiye kart çekmez, sonra krupiye bust olsa da kayıp', () => {
  const game = setup(['10', '10', '6', '6', 'K', '10']);
  game.deal(100);
  const events = game.hit();
  assert.ok(typesOf(events).includes('bust'));
  assert.equal(game.dealerCards.length, 2);
  assert.equal(game.balance, 4900);
});

test('hit ile 21 olunca el otomatik durur', () => {
  const game = setup(['10', '10', '5', '7', '6']);
  game.deal(100);
  game.hit();
  assert.equal(game.phase, 'settled');
  assert.equal(game.balance, 5100);
});

test('double: bahis iki katı, tek kart, sonra otomatik durur', () => {
  const game = setup(['6', '10', '5', '7', '10']);
  game.deal(100);
  game.double();
  assert.equal(game.hands[0].cards.length, 3);
  assert.equal(game.phase, 'settled');
  assert.equal(game.balance, 5200);
});

test('double herhangi bir toplamda; üçüncü kartta yok; bakiye yetmezse pasif', () => {
  const game = setup(['10', '10', '9', '7', '2'], 300);
  game.deal(100);
  assert.equal(game.availableActions().double, true); // hard 19

  const low = setup(['6', '10', '5', '7'], 150);
  low.deal(100);
  assert.equal(low.availableActions().double, false);
  assert.throws(() => low.double());

  const third = setup(['2', '10', '3', '7', '4']);
  third.deal(100);
  third.hit();
  assert.equal(third.availableActions().double, false);
});

test('split: aynı değerli kartlar (10-K dahil), eşit ek bahis', () => {
  const game = setup(['10', '7', 'K', '10', '9', '8']);
  game.deal(100);
  assert.equal(game.availableActions().split, true);
  game.split();
  assert.equal(game.hands.length, 2);
  assert.equal(game.balance, 4800);
  assert.equal(game.hands[0].cards.length, 2);
  assert.equal(game.hands[1].cards.length, 1); // ikinci kart sırası gelince
  game.stand();
  assert.equal(game.hands[1].cards.length, 2);
});

test('split: farklı değer split edilemez, bakiye yetmezse pasif', () => {
  const game = setup(['9', '7', '10', '10']);
  game.deal(100);
  assert.equal(game.availableActions().split, false);

  const poor = setup(['8', '7', '8', '10'], 150);
  poor.deal(100);
  assert.equal(poor.availableActions().split, false);
});

test('split sonrası double serbest', () => {
  const game = setup(['8', '7', '8', '10', '3', '10', '10', '10']);
  game.deal(100);
  game.split();
  assert.equal(game.availableActions().double, true);
  game.double();
  assert.equal(game.hands[0].bet, 200);
  assert.equal(game.activeIndex, 1);
});

test('en fazla 4 el', () => {
  const game = setup(['8', '7', '8', '10', '8', '8', '8', '10', '10', '10', '10', '10']);
  game.deal(10);
  game.split();
  game.split();
  game.split();
  assert.equal(game.hands.length, 4);
  game.stand(); // el 1: 8+?
  assert.equal(game.activeIndex, 1);
  assert.equal(game.hands.length, 4);
  // Dördüncü elden sonra aynı değerli çift gelse de split olmaz.
  game.hands[1].cards = c('8', '8');
  assert.equal(game.availableActions().split, false);
});

test('split As: her birine bir kart, otomatik biter, hit/double yok', () => {
  const game = setup(['A', '7', 'A', '10', '5', '6']);
  game.deal(100);
  const events = game.split();
  assert.equal(game.phase, 'settled');
  assert.equal(game.hands[0].cards.length, 2);
  assert.equal(game.hands[1].cards.length, 2);
  assert.equal(typesOf(events).filter((type) => type === 'deal').length, 2);
});

test('split As + 10 blackjack sayılmaz, 21 olarak 1:1 öder', () => {
  const game = setup(['A', '7', 'A', '10', 'K', 'Q']);
  game.deal(100);
  game.split();
  const { hands } = game.state.results;
  assert.equal(hands[0].outcome, 'win');
  assert.equal(hands[0].net, 100);
  assert.equal(game.balance, 5200);
  assert.equal(hands.some((hand) => hand.outcome === 'blackjack'), false);
});

test('split 10 + As 21dir, blackjack değildir, 1:1 öder', () => {
  const game = setup(['10', '6', '10', '10', 'A', 'A', 'A']);
  game.deal(100);
  game.split(); // el 0: 10+A -> otomatik biter, el 1: 10+A
  assert.equal(game.phase, 'settled');
  assert.equal(handValue(game.dealerCards).total, 17);
  assert.equal(game.state.results.hands[0].outcome, 'win');
  assert.equal(game.balance, 5200);
});

test('split Asa As gelirse yeniden split yok', () => {
  const game = setup(['A', '7', 'A', '10', 'A', '2']);
  game.deal(100);
  game.split();
  assert.equal(game.hands.length, 2);
  assert.equal(game.phase, 'settled');
});

test('surrender: yarısı döner, krupiye çekmez, yalnızca ilk karar', () => {
  const game = setup(['10', '10', '6', '6']);
  game.deal(100);
  game.surrender();
  assert.equal(game.balance, 4950);
  assert.equal(game.dealerCards.length, 2);
  assert.equal(game.state.results.hands[0].outcome, 'surrender');

  const third = setup(['2', '10', '3', '7', '4']);
  third.deal(100);
  third.hit();
  assert.equal(third.availableActions().surrender, false);

  const split = setup(['8', '7', '8', '10', '3']);
  split.deal(100);
  split.split();
  assert.equal(split.availableActions().surrender, false);
});

test('sigorta: As açık kartta teklif edilir, 10da edilmez', () => {
  const ace = setup(['10', 'A', '9', '7']);
  assert.ok(typesOf(ace.deal(100)).includes('insuranceOffer'));
  assert.equal(ace.phase, 'insurance');

  const ten = setup(['10', 'K', '9', '7']);
  assert.ok(!typesOf(ten.deal(100)).includes('insuranceOffer'));
});

test('sigorta kazanır: bahsin yarısı 2:1 öder, net sıfır', () => {
  const game = setup(['10', 'A', '9', 'K']);
  game.deal(100);
  game.insurance(true);
  assert.equal(game.phase, 'settled');
  assert.equal(game.state.results.insurance.net, 100);
  assert.equal(game.balance, 5000);
});

test('sigorta kaybeder: yarım bahis gider, el sürer', () => {
  const game = setup(['10', 'A', '9', '7']);
  game.deal(100);
  game.insurance(true);
  assert.equal(game.phase, 'player');
  assert.equal(game.balance, 4850);
  game.stand(); // krupiye soft 18, oyuncu 19
  assert.equal(game.state.results.insurance.net, -50);
  assert.equal(game.balance, 5050);
});

test('sigorta reddedilir ve krupiye blackjack: bahis gider', () => {
  const game = setup(['10', 'A', '9', 'K']);
  game.deal(100);
  game.insurance(false);
  assert.equal(game.balance, 4900);
});

test('sigorta bakiye yetmezse alınamaz', () => {
  const game = setup(['10', 'A', '9', '7'], 120);
  game.deal(100);
  assert.equal(game.canInsure(), false);
  assert.throws(() => game.insurance(true));
  game.insurance(false);
  assert.equal(game.phase, 'player');
});

test('eşit para: blackjack + sigorta her durumda 1:1 kazandırır', () => {
  for (const hole of ['K', '7']) {
    const game = setup(['A', 'A', 'K', hole]);
    game.deal(100);
    game.insurance(true);
    assert.equal(game.balance, 5100, `kapalı kart ${hole}`);
  }
});

test('kesme kartı: %75 civarında çıkar, el bitince karıştırılır', () => {
  const game = new BlackjackGame();
  const { cutAt } = game.state;
  assert.ok(Math.abs(cutAt - 234) <= RULES.cutJitter);
  game.state.pos = cutAt - 1;
  game.stack(['10', '10', '9', '8']);
  const events = game.deal(10);
  assert.ok(typesOf(events).includes('cutCard'));
  assert.equal(game.cutReached, true);
  game.stand();
  assert.deepEqual(typesOf(game.nextRound()), ['shuffle']);
  assert.equal(game.state.pos, 1);
  assert.equal(game.cutReached, false);
});

test('kesme kartı çıkmadıysa karıştırma olmaz', () => {
  const game = setup(['10', '10', '9', '8']);
  game.deal(10);
  game.stand();
  assert.deepEqual(game.nextRound(), []);
});

test('bakiye min bahsin altına düşünce oyun biter (teslim 5 bırakabilir)', () => {
  const game = setup(['10', '10', '6', '10'], 10);
  game.deal(10);
  game.surrender();
  assert.equal(game.balance, 5);
  game.nextRound();
  assert.equal(game.isBroke, true);
  game.restart();
  assert.equal(game.balance, 5000);
  assert.equal(game.isBroke, false);
});

test('kayıttan devam: durum JSON ile aynen geri gelir', () => {
  const game = setup(['8', '7', '8', '10', '3', '10']);
  game.deal(100);
  game.split();
  const restored = new BlackjackGame({ state: JSON.parse(JSON.stringify(game)) });
  assert.equal(restored.phase, 'player');
  assert.equal(restored.hands.length, 2);
  assert.equal(restored.balance, game.balance);
  restored.stand();
  assert.equal(restored.activeIndex, 1);
});

test('istatistik: split elleri ayrı sayılır', () => {
  const stats = applyResults(defaultStats(), {
    net: 150,
    hands: [{ outcome: 'blackjack' }, { outcome: 'win' }, { outcome: 'push' }, { outcome: 'surrender' }],
  }, 6000);
  assert.deepEqual(
    [stats.hands, stats.wins, stats.pushes, stats.losses, stats.blackjacks, stats.highestBalance, stats.biggestWin],
    [4, 2, 1, 1, 1, 6000, 150],
  );
});

test('rastgele simülasyon: para korunur, geçersiz hamle oluşmaz', () => {
  const game = new BlackjackGame({ balance: 1e9 });
  for (let round = 0; round < 40000; round += 1) {
    const before = game.balance;
    game.deal(100);
    if (game.phase === 'insurance') game.insurance(Math.random() < 0.3);
    while (game.phase === 'player') {
      const moves = Object.entries(game.availableActions()).filter(([, on]) => on).map(([m]) => m);
      game[moves[Math.floor(Math.random() * moves.length)]]();
    }
    assert.equal(game.phase, 'settled');
    assert.equal(game.balance - before, game.state.results.net);
    assert.ok(handValue(game.dealerCards).total >= 17 || game.state.hands.every((h) => h.status !== 'playing')
      || game.state.results.hands.some((h) => h.outcome === 'blackjack'));
    assert.ok(game.hands.length <= RULES.maxHands);
    game.nextRound();
  }
});
