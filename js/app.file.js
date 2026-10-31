// Üretilmiş dosya, elle düzenlemeyin. Kaynak: js/*.js (npm run bundle)
(function () {
'use strict';
// --- game.js ---
// Blackjack kural motoru. DOM'a dokunmaz; her hamle arayüzün sırayla
// canlandıracağı bir olay listesi döndürür. Tüm durum düz JSON'dur, böylece
// oyun el ortasında kaydedilip geri yüklenebilir.

const RULES = Object.freeze({
  decks: 6,
  penetration: 0.75,
  cutJitter: 6, // kesme kartı, %75 civarında +/- bu kadar kart oynar
  minBet: 10,
  maxBet: 5000,
  maxHands: 4,
  startBalance: 5000,
});

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['S', 'H', 'D', 'C'];

function cardValue(rank) {
  if (rank === 'A') return 11;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return Number(rank);
}

// total: en iyi toplam. soft: bir As hâlâ 11 olarak sayılıyorsa true.
function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += cardValue(card.rank);
    if (card.rank === 'A') aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0, bust: total > 21 };
}

function isNatural(cards) {
  return cards.length === 2 && handValue(cards).total === 21;
}

function createShoe(decks = RULES.decks) {
  const cards = [];
  let id = 0;
  for (let d = 0; d < decks; d += 1) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({ id: id++, rank, suit });
      }
    }
  }
  return cards;
}

// Fisher-Yates. rng, [0, 1) aralığında sayı döndürür.
function shuffle(cards, rng) {
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function secureRandom() {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0] / 2 ** 32;
}

function newHand(cards, bet, fromSplit = false) {
  return { cards, bet, fromSplit, splitAces: false, doubled: false, done: false, status: 'playing' };
}

class BlackjackGame {
  // state verilirse kayıttan devam edilir.
  constructor({ balance = RULES.startBalance, rng = secureRandom, state = null } = {}) {
    this.rng = rng;
    if (state) {
      this.state = state;
      return;
    }
    this.state = {
      balance,
      phase: 'betting', // betting | insurance | player | settled
      shoe: [],
      pos: 0,
      cutAt: 0,
      cutReached: false,
      dealerCards: [],
      holeHidden: false,
      hands: [],
      active: 0,
      insuranceBet: 0,
      insuranceDecided: false,
      results: null,
    };
    this.reshuffle();
  }

  get phase() { return this.state.phase; }
  get balance() { return this.state.balance; }
  get hands() { return this.state.hands; }
  get activeIndex() { return this.state.active; }
  get activeHand() { return this.state.hands[this.state.active]; }
  get dealerCards() { return this.state.dealerCards; }
  get holeHidden() { return this.state.holeHidden; }
  get dealerUp() { return this.state.dealerCards[0]; }
  get cutReached() { return this.state.cutReached; }
  get insuranceCost() { return this.state.hands[0] ? this.state.hands[0].bet / 2 : 0; }

  // Görünen krupiye kartları: kapalı kart gizliyse yalnızca açık kart sayılır.
  get dealerVisibleCards() {
    return this.state.holeHidden ? this.state.dealerCards.slice(0, 1) : this.state.dealerCards;
  }

  toJSON() {
    return this.state;
  }

  reshuffle() {
    const s = this.state;
    s.shoe = shuffle(createShoe(RULES.decks), this.rng);
    const jitter = Math.floor(this.rng() * (RULES.cutJitter * 2 + 1)) - RULES.cutJitter;
    s.cutAt = Math.round(s.shoe.length * RULES.penetration) + jitter;
    s.pos = 1; // yakma kartı
    s.cutReached = false;
  }

  // Testler ve doğrulama için ayakkabının üstüne belirli kartlar koyar.
  stack(ranks) {
    const s = this.state;
    ranks.forEach((rank, i) => {
      const spec = typeof rank === 'string' ? { rank, suit: 'S' } : rank;
      s.shoe[s.pos + i] = { id: 100000 + s.pos + i, rank: spec.rank, suit: spec.suit };
    });
  }

  canBet(bet) {
    return Number.isInteger(bet) && bet >= RULES.minBet && bet <= RULES.maxBet && bet <= this.state.balance;
  }

  // Bakiye en küçük bahsin altındaysa oyun biter (teslim sonrası 5 kalabilir).
  get isBroke() {
    return this.state.phase === 'betting' && this.state.balance < RULES.minBet;
  }

  availableActions() {
    const none = { hit: false, stand: false, double: false, split: false, surrender: false };
    const s = this.state;
    if (s.phase !== 'player') return none;
    const hand = this.activeHand;
    const firstTwo = hand.cards.length === 2;
    const samePair = firstTwo && cardValue(hand.cards[0].rank) === cardValue(hand.cards[1].rank);
    return {
      hit: true,
      stand: true,
      double: firstTwo && s.balance >= hand.bet,
      split: samePair && !hand.splitAces && s.hands.length < RULES.maxHands && s.balance >= hand.bet,
      surrender: firstTwo && s.hands.length === 1 && !hand.fromSplit,
    };
  }

  draw(events) {
    const s = this.state;
    const card = s.shoe[s.pos];
    s.pos += 1;
    if (!s.cutReached && s.pos >= s.cutAt) {
      s.cutReached = true;
      events.push({ type: 'cutCard' });
    }
    return card;
  }

  dealTo(handIndex, events) {
    const card = this.draw(events);
    this.state.hands[handIndex].cards.push(card);
    events.push({ type: 'deal', to: 'player', hand: handIndex, card });
    return card;
  }

  dealToDealer(faceDown, events) {
    const card = this.draw(events);
    this.state.dealerCards.push(card);
    events.push({ type: 'deal', to: 'dealer', card, faceDown });
  }

  deal(bet) {
    const s = this.state;
    if (s.phase !== 'betting') throw new Error('Bahis aşamasında değil');
    if (!this.canBet(bet)) throw new Error('Geçersiz bahis');
    const events = [];
    s.balance -= bet;
    s.hands = [newHand([], bet)];
    s.dealerCards = [];
    s.holeHidden = true;
    s.active = 0;
    s.insuranceBet = 0;
    s.insuranceDecided = false;
    s.results = null;

    this.dealTo(0, events);
    this.dealToDealer(false, events);
    this.dealTo(0, events);
    this.dealToDealer(true, events);

    if (this.dealerUp.rank === 'A') {
      s.phase = 'insurance';
      events.push({ type: 'insuranceOffer' });
      return events;
    }
    this.afterInsurance(events);
    return events;
  }

  canInsure() {
    return this.state.phase === 'insurance' && this.state.balance >= this.insuranceCost;
  }

  // Sigorta kararı. Elinde blackjack olan için bu aynı zamanda "eşit para"dır:
  // sonuç her durumda bahsin 1 katı kazançtır.
  insurance(take) {
    const s = this.state;
    if (s.phase !== 'insurance') throw new Error('Sigorta aşamasında değil');
    if (take && !this.canInsure()) throw new Error('Bakiye yetersiz');
    const events = [];
    if (take) {
      s.insuranceBet = this.insuranceCost;
      s.balance -= s.insuranceBet;
      events.push({ type: 'insuranceTaken', amount: s.insuranceBet });
    }
    s.insuranceDecided = true;
    this.afterInsurance(events);
    return events;
  }

  afterInsurance(events) {
    const s = this.state;
    const up = cardValue(this.dealerUp.rank);
    if (up >= 10) {
      const dealerBlackjack = isNatural(s.dealerCards);
      events.push({ type: 'peek', blackjack: dealerBlackjack });
      if (dealerBlackjack) {
        this.reveal(events);
        this.settle(events);
        return;
      }
    }
    if (isNatural(s.hands[0].cards)) {
      this.reveal(events);
      this.settle(events);
      return;
    }
    s.phase = 'player';
    events.push({ type: 'turn', hand: 0 });
  }

  reveal(events) {
    const s = this.state;
    if (!s.holeHidden) return;
    s.holeHidden = false;
    events.push({ type: 'reveal', card: s.dealerCards[1] });
  }

  requireAction(name) {
    if (!this.availableActions()[name]) throw new Error(`Geçersiz hamle: ${name}`);
  }

  hit() {
    this.requireAction('hit');
    const events = [];
    const index = this.state.active;
    this.dealTo(index, events);
    this.afterCard(index, events);
    return events;
  }

  stand() {
    this.requireAction('stand');
    const events = [];
    this.finishHand(events);
    return events;
  }

  double() {
    this.requireAction('double');
    const s = this.state;
    const events = [];
    const index = s.active;
    const hand = s.hands[index];
    s.balance -= hand.bet;
    hand.bet *= 2;
    hand.doubled = true;
    events.push({ type: 'double', hand: index, bet: hand.bet });
    this.dealTo(index, events);
    if (handValue(hand.cards).bust) {
      hand.status = 'bust';
      events.push({ type: 'bust', hand: index });
    }
    this.finishHand(events);
    return events;
  }

  split() {
    this.requireAction('split');
    const s = this.state;
    const events = [];
    const index = s.active;
    const hand = s.hands[index];
    const aces = hand.cards[0].rank === 'A';
    const moved = hand.cards.pop();
    const second = newHand([moved], hand.bet, true);
    hand.fromSplit = true;
    s.balance -= hand.bet;
    s.hands.splice(index + 1, 0, second);
    events.push({ type: 'split', hand: index, card: moved });

    if (aces) {
      // Split Asların her birine yalnızca bir kart verilir, yeniden split yok.
      for (const i of [index, index + 1]) {
        s.hands[i].splitAces = true;
        s.hands[i].done = true;
        this.dealTo(i, events);
      }
      this.advance(events);
      return events;
    }
    this.dealTo(index, events);
    if (handValue(hand.cards).total === 21) {
      this.finishHand(events);
    } else {
      events.push({ type: 'turn', hand: index });
    }
    return events;
  }

  surrender() {
    this.requireAction('surrender');
    const events = [];
    const index = this.state.active;
    this.state.hands[index].status = 'surrender';
    events.push({ type: 'surrender', hand: index });
    this.finishHand(events);
    return events;
  }

  afterCard(index, events) {
    const hand = this.state.hands[index];
    const { total, bust } = handValue(hand.cards);
    if (bust) {
      hand.status = 'bust';
      events.push({ type: 'bust', hand: index });
      this.finishHand(events);
    } else if (total === 21) {
      this.finishHand(events);
    }
  }

  finishHand(events) {
    this.activeHand.done = true;
    this.advance(events);
  }

  // Sıradaki oynanabilir ele geçer; split elinin ikinci kartı sırası gelince verilir.
  advance(events) {
    const s = this.state;
    for (let i = s.active + 1; i < s.hands.length; i += 1) {
      const hand = s.hands[i];
      if (hand.done) continue;
      s.active = i;
      if (hand.cards.length === 1) {
        this.dealTo(i, events);
        if (handValue(hand.cards).total === 21) {
          hand.done = true;
          continue;
        }
      }
      events.push({ type: 'turn', hand: i });
      return;
    }
    this.playDealer(events);
  }

  playDealer(events) {
    const s = this.state;
    s.phase = 'dealer';
    this.reveal(events);
    const live = s.hands.some((hand) => hand.status === 'playing');
    if (live) {
      // Krupiye soft 17 dahil 17'de durur.
      while (handValue(s.dealerCards).total < 17) {
        this.dealToDealer(false, events);
      }
      if (handValue(s.dealerCards).bust) events.push({ type: 'dealerBust' });
    }
    this.settle(events);
  }

  settle(events) {
    const s = this.state;
    const dealer = handValue(s.dealerCards);
    const dealerNatural = isNatural(s.dealerCards);
    const results = s.hands.map((hand, index) => {
      const outcome = this.outcomeOf(hand, dealer, dealerNatural);
      const multiplier = { blackjack: 2.5, win: 2, push: 1, surrender: 0.5, lose: 0, bust: 0 }[outcome];
      const returned = hand.bet * multiplier;
      return { hand: index, outcome, bet: hand.bet, returned, net: returned - hand.bet };
    });
    let net = results.reduce((sum, result) => sum + result.net, 0);
    let returned = results.reduce((sum, result) => sum + result.returned, 0);
    let insurance = null;
    if (s.insuranceBet > 0) {
      const won = dealerNatural;
      const payout = won ? s.insuranceBet * 3 : 0; // 2:1 + yatırılan
      insurance = { bet: s.insuranceBet, won, returned: payout, net: payout - s.insuranceBet };
      net += insurance.net;
      returned += payout;
    }
    s.balance += returned;
    s.phase = 'settled';
    s.results = { hands: results, insurance, net, returned };
    events.push({ type: 'settle', results: s.results, balance: s.balance });
  }

  outcomeOf(hand, dealer, dealerNatural) {
    if (hand.status === 'surrender') return 'surrender';
    if (hand.status === 'bust') return 'bust';
    const natural = isNatural(hand.cards) && !hand.fromSplit;
    if (natural) return dealerNatural ? 'push' : 'blackjack';
    if (dealerNatural) return 'lose';
    const { total } = handValue(hand.cards);
    if (dealer.bust || total > dealer.total) return 'win';
    return total === dealer.total ? 'push' : 'lose';
  }

  // Sonuçtan bahis aşamasına döner; kesme kartı çıktıysa burada karıştırılır.
  nextRound() {
    const s = this.state;
    if (s.phase !== 'settled') throw new Error('El bitmedi');
    const events = [];
    s.phase = 'betting';
    s.hands = [];
    s.dealerCards = [];
    s.holeHidden = false;
    s.active = 0;
    s.insuranceBet = 0;
    s.results = null;
    if (s.cutReached) {
      this.reshuffle();
      events.push({ type: 'shuffle' });
    }
    return events;
  }

  restart() {
    this.state.balance = RULES.startBalance;
    this.state.phase = 'betting';
    this.state.hands = [];
    this.state.dealerCards = [];
    this.state.holeHidden = false;
    this.state.results = null;
    this.reshuffle();
  }
}

// --- strategy.js ---
// Temel strateji: 4-8 deste, krupiye soft 17'de durur, split sonrası double,
// late surrender, peek. Sütunlar krupiye açık kartı: 2 3 4 5 6 7 8 9 10 A.
// H kart, S dur, D double (yoksa kart), d double (yoksa dur), P split,
// R surrender (yoksa kart).


const HARD = {
  5: 'HHHHHHHHHH', 6: 'HHHHHHHHHH', 7: 'HHHHHHHHHH', 8: 'HHHHHHHHHH',
  9: 'HDDDDHHHHH',
  10: 'DDDDDDDDHH',
  11: 'DDDDDDDDDH',
  12: 'HHSSSHHHHH',
  13: 'SSSSSHHHHH',
  14: 'SSSSSHHHHH',
  15: 'SSSSSHHHRH',
  16: 'SSSSSHHRRR',
  17: 'SSSSSSSSSS',
};

const SOFT = {
  12: 'HHHHHHHHHH', // A,A split edilemiyorsa
  13: 'HHHDDHHHHH',
  14: 'HHHDDHHHHH',
  15: 'HHDDDHHHHH',
  16: 'HHDDDHHHHH',
  17: 'HDDDDHHHHH',
  18: 'SddddSSHHH',
  19: 'SSSSSSSSSS',
};

// Çift değerine göre. 5,5 ve 10,10 burada yok: sert toplam olarak oynanır.
const PAIRS = {
  2: 'PPPPPPHHHH',
  3: 'PPPPPPHHHH',
  4: 'HHHPPHHHHH',
  6: 'PPPPPHHHHH',
  7: 'PPPPPPHHHH',
  8: 'PPPPPPPPPP',
  9: 'PPPPPSPPSS',
  11: 'PPPPPPPPPP',
};

function column(dealerRank) {
  const value = cardValue(dealerRank);
  return value === 11 ? 9 : value - 2;
}

// Mevcut seçeneklere göre tek bir hamle döndürür.
function recommend({ cards, dealerRank, canDouble, canSplit, canSurrender }) {
  const col = column(dealerRank);
  const { total, soft } = handValue(cards);

  if (canSplit && cards.length === 2 && cardValue(cards[0].rank) === cardValue(cards[1].rank)) {
    const row = PAIRS[cardValue(cards[0].rank)];
    if (row && row[col] === 'P') return 'split';
  }

  const code = soft
    ? SOFT[Math.min(Math.max(total, 12), 19)][col]
    : HARD[Math.min(Math.max(total, 5), 17)][col];

  switch (code) {
    case 'D': return canDouble ? 'double' : 'hit';
    case 'd': return canDouble ? 'double' : 'stand';
    case 'R': return canSurrender ? 'surrender' : 'hit';
    case 'S': return 'stand';
    default: return 'hit';
  }
}

// --- storage.js ---
// localStorage kalıcılığı. Depolama kapalıysa (gizli sekme vb.) oyun bellekte
// çalışmaya devam eder.


const KEY = 'asil-blackjack-v1';

const DEFAULT_SETTINGS = Object.freeze({
  sound: true,
  vibration: true,
  speed: 'normal', // normal | fast
  hints: true,
});

function defaultStats() {
  return {
    hands: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    blackjacks: 0,
    highestBalance: RULES.startBalance,
    biggestWin: 0,
  };
}

// Bölünen her el ayrı sayılır. Teslim kayıp, blackjack kazanç sayılır.
function applyResults(stats, results, balance) {
  const next = { ...stats };
  for (const { outcome } of results.hands) {
    next.hands += 1;
    if (outcome === 'win' || outcome === 'blackjack') next.wins += 1;
    else if (outcome === 'push') next.pushes += 1;
    else next.losses += 1;
    if (outcome === 'blackjack') next.blackjacks += 1;
  }
  next.highestBalance = Math.max(next.highestBalance, balance);
  next.biggestWin = Math.max(next.biggestWin, results.net);
  return next;
}

function loadProgress() {
  const base = { game: null, stats: defaultStats(), settings: { ...DEFAULT_SETTINGS }, lastBet: 0 };
  try {
    const saved = JSON.parse(globalThis.localStorage.getItem(KEY));
    if (!saved) return base;
    return {
      game: saved.game ?? null,
      stats: { ...base.stats, ...saved.stats },
      settings: { ...base.settings, ...saved.settings },
      lastBet: saved.lastBet ?? 0,
    };
  } catch {
    return base;
  }
}

function saveProgress(progress) {
  try {
    globalThis.localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // Depolama yoksa ilerleme yalnızca bu oturumda kalır.
  }
}

// --- audio.js ---
// Web Audio ile üretilen ince sesler ve titreşim. Harici dosya yok.

class SoundBoard {
  constructor() {
    this.enabled = true;
    this.vibration = true;
    this.ctx = null;
    this.noise = null;
  }

  // Tarayıcılar sesi yalnızca kullanıcı dokunuşundan sonra başlatır.
  unlock() {
    const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioCtx) return;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      const length = this.ctx.sampleRate * 0.5;
      this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  ready() {
    return this.enabled && this.ctx && this.ctx.state === 'running';
  }

  tone(freq, { at = 0, length = 0.2, gain = 0.15, type = 'sine', slide = 0 } = {}) {
    const t = this.ctx.currentTime + at;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + length);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(amp).connect(this.master);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  hiss({ at = 0, length = 0.07, gain = 0.2, freq = 2400, q = 0.9 } = {}) {
    const t = this.ctx.currentTime + at;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    src.connect(filter).connect(amp).connect(this.master);
    src.start(t, Math.random() * 0.4, length + 0.02);
  }

  card() {
    if (!this.ready()) return;
    this.hiss({ length: 0.075, gain: 0.26, freq: 2100 });
    this.hiss({ at: 0.03, length: 0.03, gain: 0.12, freq: 900 });
  }

  flip() {
    if (!this.ready()) return;
    this.hiss({ length: 0.12, gain: 0.2, freq: 1500, q: 0.6 });
  }

  chip() {
    if (!this.ready()) return;
    this.tone(3100, { length: 0.05, gain: 0.07 });
    this.tone(4300, { at: 0.012, length: 0.06, gain: 0.05 });
    this.hiss({ length: 0.03, gain: 0.08, freq: 5200 });
  }

  tap() {
    if (!this.ready()) return;
    this.tone(1100, { length: 0.035, gain: 0.03 });
  }

  win() {
    if (!this.ready()) return;
    [659, 880, 1109].forEach((freq, i) => this.tone(freq, { at: i * 0.09, length: 0.42, gain: 0.08 }));
  }

  blackjack() {
    if (!this.ready()) return;
    [523, 659, 784, 1047, 1319].forEach((freq, i) => {
      this.tone(freq, { at: i * 0.085, length: 0.8, gain: 0.08 });
      this.tone(freq * 2, { at: i * 0.085, length: 0.4, gain: 0.02 });
    });
  }

  push() {
    if (!this.ready()) return;
    this.tone(587, { length: 0.26, gain: 0.05 });
    this.tone(587, { at: 0.12, length: 0.28, gain: 0.04 });
  }

  lose() {
    if (!this.ready()) return;
    this.tone(196, { length: 0.5, gain: 0.1, slide: 0.72 });
    this.tone(147, { at: 0.05, length: 0.55, gain: 0.06, slide: 0.8 });
  }

  bust() {
    if (!this.ready()) return;
    this.tone(120, { length: 0.3, gain: 0.16, slide: 0.6 });
    this.hiss({ length: 0.14, gain: 0.1, freq: 500 });
  }

  shuffle() {
    if (!this.ready()) return;
    for (let i = 0; i < 16; i += 1) {
      this.hiss({ at: i * 0.05, length: 0.035, gain: 0.1 + (i % 3) * 0.03, freq: 1800 + i * 90 });
    }
  }

  buzz(pattern) {
    if (this.vibration && typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch {
        // Bazı tarayıcılar kullanıcı etkileşimi olmadan reddeder.
      }
    }
  }
}

// --- animations.js ---
// Animasyon yardımcıları: yalnızca transform ve opacity canlandırılır.

const SPEEDS = { normal: 1, fast: 0.55 };
let speedFactor = 1;
const motionQuery = globalThis.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;

const reducedMotion = () => Boolean(motionQuery && motionQuery.matches);
const setAnimationSpeed = (name) => { speedFactor = SPEEDS[name] ?? 1; };
const scaled = (ms) => (reducedMotion() ? 0 : ms * speedFactor);
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, scaled(ms)); });

const EASE_OUT = 'cubic-bezier(.22,.8,.24,1)';

function run(el, keyframes, ms, options = {}) {
  const duration = scaled(ms);
  if (duration <= 0 || !el.animate) return Promise.resolve();
  const delay = scaled(options.delay ?? 0);
  const animation = el.animate(keyframes, { easing: EASE_OUT, ...options, delay, duration });
  return animation.finished.then(() => {}, () => {});
}

// Son durumu stile yazar, oraya önceki konumdan kayar.
function moveTo(el, transform, ms, options = {}) {
  const from = options.from ?? el.style.transform;
  el.style.transform = transform;
  if (!from || from === transform) return Promise.resolve();
  return run(el, [{ transform: from }, { transform }], ms, options);
}

// Kart ayakkabıdan kayar, hedefi az geçer, dönerek toparlanır ve küçük bir sekmeyle oturur.
function dealIn(el, from, to, ms = 470) {
  el.style.transform = to;
  return run(el, [
    { transform: from, opacity: 0.85, easing: 'cubic-bezier(.2,.7,.3,1)' },
    { transform: `translate(0,7px) rotate(4deg) ${to}`, opacity: 1, offset: 0.68, easing: 'ease-out' },
    { transform: `translate(0,-9px) rotate(-1.2deg) ${to}`, offset: 0.85, easing: 'ease-in' },
    { transform: to },
  ], ms, { easing: 'linear' });
}

function flip(inner, ms = 540) {
  inner.style.transform = 'rotateY(0deg)';
  return run(inner, [
    { transform: 'rotateY(180deg) scale(1)' },
    { transform: 'rotateY(90deg) scale(1.16) rotateZ(-2deg)', offset: 0.5 },
    { transform: 'rotateY(-10deg) scale(1.05)', offset: 0.8 },
    { transform: 'rotateY(0deg) scale(1)' },
  ], ms, { easing: 'ease-in-out' });
}

// Ayrı scale özelliği, rozetin konum transform'una dokunmaz.
function tick(el) {
  return run(el, [{ scale: 0.7, opacity: 0.3 }, { scale: 1.22, offset: 0.6 }, { scale: 1, opacity: 1 }], 320);
}

function shake(el) {
  const base = el.style.transform;
  if (!base || reducedMotion()) return Promise.resolve();
  const at = (x, r) => ({ transform: `translate(${x}px,0) rotate(${r}deg) ${base}` });
  return run(el, [at(0, 0), at(-4, -0.8), at(4, 0.8), at(-3, -0.5), at(2, 0.3), at(0, 0)], 340, { easing: 'linear' });
}

function wobble(el) {
  const base = el.style.transform || 'translate(0,0)';
  return run(el, [
    { transform: `${base} rotate(0deg)`, scale: '1 1' },
    { transform: `${base} rotate(-4deg)`, scale: '1.14 .86', offset: 0.22 },
    { transform: `${base} rotate(3deg)`, scale: '.95 1.08', offset: 0.5 },
    { transform: `${base} rotate(-1deg)`, scale: '1.02 .98', offset: 0.76 },
    { transform: `${base} rotate(0deg)`, scale: '1 1' },
  ], 380);
}

// Basılan yerden yayılan altın halka ve küçük esneme.
function pressEffect(button, x, y) {
  run(button, [{ scale: 1 }, { scale: 0.94, offset: 0.35 }, { scale: 1.03, offset: 0.72 }, { scale: 1 }], 260);
  if (reducedMotion()) return;
  const ring = document.createElement('span');
  ring.className = 'btn-ring';
  ring.style.setProperty('--x', `${x}px`);
  ring.style.setProperty('--y', `${y}px`);
  button.appendChild(ring);
  run(ring, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(26)', opacity: 0 }], 520).then(() => ring.remove());
}

// Bakiye değişirken sayı nefes alır.
function pulseNumber(el) {
  return run(el, [{ scale: 1 }, { scale: 1.2, offset: 0.3 }, { scale: 1 }], 620);
}

// Kazanan kartlar zıplar, kaybedenler aşağı çöker.
const liftCard = (el, delay) => run(el, [{ translate: '0 0' }, { translate: '0 -14px', offset: 0.45 }, { translate: '0 2px', offset: 0.78 }, { translate: '0 0' }], 520, { delay });
const sinkCard = (el) => run(el, [{ translate: '0 0' }, { translate: '0 7px', offset: 0.5 }, { translate: '0 0' }], 460);

// Sayıyı akıcı biçimde hedefe götürür.
function countTo(el, from, to, format, ms = 860) {
  const duration = scaled(ms);
  if (duration <= 0 || from === to) {
    el.textContent = format(to);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - t) ** 3;
    el.textContent = format(Math.round(from + (to - from) * eased));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function showBanner(el, { title, detail, big = false, bad = false, hold = 0 }) {
  el.querySelector('strong').textContent = title;
  el.querySelector('span').textContent = detail ?? '';
  el.classList.toggle('big', big);
  el.classList.toggle('bad', bad);
  el.style.opacity = hold ? '0' : '1';
  const keyframes = hold
    ? [
      { opacity: 0, transform: 'scale(.86)' },
      { opacity: 1, transform: 'scale(1)', offset: 0.22 },
      { opacity: 1, transform: 'scale(1)', offset: 0.8 },
      { opacity: 0, transform: 'scale(1.02)' },
    ]
    : [{ opacity: 0, transform: 'scale(.66)' }, { opacity: 1, transform: 'scale(1.09)', offset: 0.62 }, { opacity: 1, transform: 'scale(1)' }];
  if (reducedMotion()) {
    if (hold) {
      el.style.opacity = '1';
      setTimeout(() => { el.style.opacity = '0'; }, 900);
    }
    return Promise.resolve();
  }
  return run(el, keyframes, hold || 540);
}

function hideBanner(el) {
  if (el.style.opacity === '0' || !el.style.opacity) return;
  el.style.opacity = '0';
  run(el, [{ opacity: 1 }, { opacity: 0 }], 200);
}

function pulseGlow(el) {
  if (reducedMotion()) return;
  run(el, [{ opacity: 0 }, { opacity: 1, offset: 0.28 }, { opacity: 0 }], 1700);
}

function showToast(el, text, hold = 2000) {
  el.textContent = text;
  // Metin okuyabilmek için bu süre animasyon hızından etkilenmez.
  if (!el.animate || reducedMotion()) {
    el.style.opacity = '1';
    clearTimeout(el.hideTimer);
    el.hideTimer = setTimeout(() => { el.style.opacity = '0'; }, hold);
    return;
  }
  hideToast(el);
  el.current = el.animate([
    { opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.88 }, { opacity: 0 },
  ], { duration: hold, easing: 'linear' });
}

// Sonuç yazısı gelince açık mesaj kapanır, ikisi üst üste binmez.
function hideToast(el) {
  if (el.current) el.current.cancel();
  el.current = null;
  clearTimeout(el.hideTimer);
  el.style.opacity = '0';
}

// Altın parçacıklar. Arka plan tozu tek kanvasta, kıvılcımlar üst kanvasta.
class GoldParticles {
  constructor(dustCanvas, fxCanvas) {
    this.dust = dustCanvas;
    this.fx = fxCanvas;
    this.dustCtx = dustCanvas.getContext('2d');
    this.fxCtx = fxCanvas.getContext('2d');
    this.motes = [];
    this.sparks = [];
    this.running = false;
    this.last = 0;
    this.dustClock = 0;
    this.resize();
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.running = false;
      else this.start();
    });
    this.setDensity(24);
    this.start();
  }

  resize() {
    this.ratio = Math.min(devicePixelRatio || 1, 2);
    this.w = innerWidth;
    this.h = innerHeight;
    for (const canvas of [this.dust, this.fx]) {
      canvas.width = this.w * this.ratio;
      canvas.height = this.h * this.ratio;
    }
    this.dustCtx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    this.fxCtx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    if (reducedMotion()) this.drawDust(0);
  }

  // Açılış ekranında daha yoğun, masada daha seyrek toz.
  setDensity(count) {
    while (this.motes.length < count) this.motes.push(this.mote(true));
    this.motes.length = count;
  }

  mote(anywhere) {
    return {
      x: Math.random() * this.w,
      y: anywhere ? Math.random() * this.h : this.h + 6,
      r: 0.5 + Math.random() * 1.1,
      vx: (Math.random() - 0.5) * 3,
      vy: -(1.5 + Math.random() * 4),
      phase: Math.random() * 6.28,
      rate: 0.3 + Math.random() * 0.6,
    };
  }

  start() {
    if (this.running || reducedMotion()) {
      if (reducedMotion()) this.drawDust(0);
      return;
    }
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((now) => this.frame(now));
  }

  frame(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    // Toz çok yavaş olduğundan yarım kare hızı yeterlidir, pil dostudur.
    this.dustClock += dt;
    if (this.dustClock >= 1 / 30) {
      this.drawDust(this.dustClock);
      this.dustClock = 0;
    }
    if (this.sparks.length > 0) this.drawSparks(dt);
    requestAnimationFrame((time) => this.frame(time));
  }

  drawDust(dt) {
    const ctx = this.dustCtx;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = '#e6c878';
    for (let i = 0; i < this.motes.length; i += 1) {
      const m = this.motes[i];
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.phase += m.rate * dt;
      if (m.y < -6) this.motes[i] = this.mote(false);
      ctx.globalAlpha = 0.12 + 0.2 * (0.5 + 0.5 * Math.sin(m.phase));
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, 6.283);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  burst(x, y, count = 90) {
    if (reducedMotion()) return;
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * 6.283;
      const speed = 50 + Math.random() * 280;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 90,
        life: 0,
        ttl: 0.8 + Math.random() * 1.1,
        r: 0.7 + Math.random() * 1.9,
        hot: Math.random() < 0.45,
      });
    }
    this.start();
  }

  drawSparks(dt) {
    const ctx = this.fxCtx;
    ctx.clearRect(0, 0, this.w, this.h);
    this.sparks = this.sparks.filter((s) => s.life < s.ttl);
    for (const s of this.sparks) {
      s.life += dt;
      s.vy += 170 * dt;
      s.vx *= 0.985;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const fade = 1 - s.life / s.ttl;
      ctx.globalAlpha = Math.max(0, fade);
      ctx.fillStyle = s.hot ? '#f4e2a8' : '#c9a24b';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * (0.5 + fade / 2), 0, 6.283);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (this.sparks.length === 0) ctx.clearRect(0, 0, this.w, this.h);
  }
}

// --- ui.js ---
// Arayüz: motorun ürettiği olayları sırayla canlandırır. Görünen toplamlar ve
// bakiye motorun son durumundan değil, canlandırılan kartlardan hesaplanır;
// böylece ekran hiçbir zaman animasyonun önüne geçmez.


const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const CHIPS = [10, 50, 100, 500, 1000];
// Fişler renkle değil, şerit sayısı ve altın tonuyla ayrışır.
const CHIP_STYLE = {
  10: { stripes: 2, color: '#c9a24b', opacity: 0.55 },
  50: { stripes: 3, color: '#c9a24b', opacity: 0.72 },
  100: { stripes: 4, color: '#c9a24b', opacity: 0.9 },
  500: { stripes: 6, color: '#c9a24b', opacity: 1 },
  1000: { stripes: 8, color: '#e6c878', opacity: 1 },
};
const SUIT_NAMES = { S: 'Maça', H: 'Kupa', D: 'Karo', C: 'Sinek' };
const MOVE_NAMES = { hit: 'Kart çek', stand: 'Dur', double: 'Double', split: 'Split', surrender: 'Teslim ol' };
const HAND_SCALE = [1, 0.82, 0.68, 0.6];
const OUTCOME_NOTE = {
  blackjack: 'BLACKJACK', win: 'KAZANDI', push: 'BERABER', lose: 'KAYBETTİ', bust: 'BUST', surrender: 'TESLİM',
};

const L = 36;
const R = 64;
const PIPS = {
  2: [[50, 19], [50, 81, 1]],
  3: [[50, 19], [50, 50], [50, 81, 1]],
  4: [[L, 19], [R, 19], [L, 81, 1], [R, 81, 1]],
  5: [[L, 19], [R, 19], [50, 50], [L, 81, 1], [R, 81, 1]],
  6: [[L, 19], [R, 19], [L, 50], [R, 50], [L, 81, 1], [R, 81, 1]],
  7: [[L, 19], [R, 19], [50, 34], [L, 50], [R, 50], [L, 81, 1], [R, 81, 1]],
  8: [[L, 19], [R, 19], [50, 34], [L, 50], [R, 50], [50, 66, 1], [L, 81, 1], [R, 81, 1]],
  9: [[L, 18], [R, 18], [L, 39], [R, 39], [50, 50], [L, 61, 1], [R, 61, 1], [L, 82, 1], [R, 82, 1]],
  10: [[L, 18], [R, 18], [50, 28], [L, 39], [R, 39], [L, 61, 1], [R, 61, 1], [50, 72, 1], [L, 82, 1], [R, 82, 1]],
};

const money = (value) => value.toLocaleString('tr-TR');
const signed = (value) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${money(Math.abs(value))}`;
const suitIcon = (suit, cls = '') => `<svg class="${cls}" aria-hidden="true"><use href="#suit-${suit}"/></svg>`;

function chipHTML(value) {
  const { stripes, color, opacity } = CHIP_STYLE[value];
  const r = 41;
  const circumference = 2 * Math.PI * r;
  const dash = circumference / stripes / 2;
  const label = value >= 1000 ? `${value / 1000}K` : value;
  return `<svg viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="49" fill="#0b0b0d" stroke="${color}" stroke-opacity="${opacity}" stroke-width="1.5"/>
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="11"
      stroke-dasharray="${dash} ${dash}" stroke-dashoffset="${dash / 2}"/>
    <circle cx="50" cy="50" r="31" fill="#141417" stroke="${color}" stroke-opacity="${opacity}" stroke-width="1"/>
    <text class="chip-text" x="50" y="51">${label}</text>
  </svg>`;
}

function makeChip(value) {
  const el = document.createElement('span');
  el.className = 'chip';
  el.innerHTML = chipHTML(value);
  return el;
}

function chipBreakdown(amount) {
  const chips = [];
  let rest = amount;
  for (const value of [...CHIPS].reverse()) {
    while (rest >= value) {
      chips.push(value);
      rest -= value;
    }
  }
  return chips.reverse();
}

function makeCard(card, faceDown) {
  const el = document.createElement('div');
  const red = card.suit === 'H' || card.suit === 'D';
  const isCourt = 'JQK'.includes(card.rank);
  let center;
  if (card.rank === 'A') {
    center = suitIcon(card.suit, 'ace-pip');
  } else if (isCourt) {
    center = `<div class="court">${suitIcon(card.suit)}<span>${card.rank}</span>${suitIcon(card.suit, 'down')}</div>`;
  } else {
    const pips = PIPS[card.rank].map(([x, y, down]) => (
      `<svg class="${down ? 'down' : ''}" style="left:${x}%;top:${y}%" aria-hidden="true"><use href="#suit-${card.suit}"/></svg>`
    ));
    center = `<div class="pips">${pips.join('')}</div>`;
  }
  const index = (cls) => `<div class="index ${cls} ${card.rank === '10' ? 'ten' : ''}"><b>${card.rank}</b>${suitIcon(card.suit)}</div>`;
  el.className = 'card';
  el.innerHTML = `<div class="card-inner">
    <div class="face front ${red ? 'red' : ''}">${index('')}${center}${index('flip')}</div>
    <div class="face back"></div>
  </div>`;
  el.inner = el.firstElementChild;
  el.inner.style.transform = faceDown ? 'rotateY(180deg)' : 'rotateY(0deg)';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', faceDown ? 'Kapalı kart' : `${SUIT_NAMES[card.suit]} ${card.rank}`);
  return el;
}

// Oyuncu kararını verirken soft el iki değerle gösterilir; krupiye ve biten
// eller için tek değer yeter.
function totalText(cards, final = false) {
  const { total, soft } = handValue(cards);
  if (!final && soft && total < 21) return `${total - 10}/${total}`;
  return String(total);
}

class App {
  constructor() {
    const progress = loadProgress();
    this.stats = progress.stats;
    this.settings = progress.settings;
    this.lastBet = progress.lastBet;
    this.returnTo = 'menu';
    this.sound = new SoundBoard();
    this.game = new BlackjackGame({ state: progress.game });
    this.pendingBet = 0;
    this.busy = false;
    this.dealerView = [];
    this.handViews = [];
    this.spot = { stack: null };

    this.table = $('#table');
    this.layer = $('#layer');
    this.banner = $('#banner');
    this.toast = $('#toast');
    this.balanceEl = $('#balance');
    this.dealerTotal = $('#dealer-total');
    this.shownBalance = this.game.balance;

    this.particles = new GoldParticles($('#dust'), $('#fx'));
    this.buildChips();
    this.bindEvents();
    this.applySettings();
    this.boot();
  }

  /* ---------- Başlangıç ---------- */

  boot() {
    if (this.game.phase === 'settled') {
      this.game.nextRound(); // Sonuç zaten bakiyeye işlendi.
      this.persist();
    }
    this.go('menu');
    this.renderSavedRound();
    this.setBalance(this.game.balance, false);
    this.refreshControls();
    this.refreshPlayLabel();
    addEventListener('resize', () => this.layoutAll(0));
    this.playIntro();
  }

  // İmza her açılışta gösterilir. Süre okunabilsin diye animasyon hızına bağlı değildir.
  async playIntro() {
    const intro = $('#intro');
    const menu = $('#screen-menu');
    const font = document.fonts ? document.fonts.load('italic 400 28px "Playfair Display"', 'Çağlar') : null;
    await Promise.race([font, new Promise((done) => { setTimeout(done, 500); })]).catch(() => {});
    intro.classList.add('play');
    await new Promise((done) => { setTimeout(done, 3300); });
    intro.classList.add('out');
    menu.classList.remove('pre');
    menu.classList.add('enter');
    this.checkBroke();
    setTimeout(() => intro.remove(), 950);
  }

  renderSavedRound() {
    const { game } = this;
    if (game.phase === 'betting') return;
    game.dealerCards.forEach((card, i) => {
      this.addDealerCardView(card, i === 1 && game.holeHidden);
    });
    game.hands.forEach((hand) => {
      const view = this.addHandView(hand.bet);
      hand.cards.forEach((card) => this.addCardView(view, card));
      this.updateHandTotal(view, false);
      if (hand.status !== 'playing') {
        view.finished = true;
        view.tag.classList.add('lost');
        for (const card of view.cards) card.el.classList.add('bust-card');
      }
    });
    this.layoutAll(0);
    this.updateDealerTotal(false);
    this.setActiveHand(game.activeIndex);
    $('#bet-spot').classList.add('dim');
  }

  persist() {
    saveProgress({
      game: this.game.toJSON(),
      stats: this.stats,
      settings: this.settings,
      lastBet: this.lastBet,
    });
  }

  refreshPlayLabel() {
    $('#btn-play-label').textContent = this.game.phase === 'betting' ? 'Oyna' : 'Devam Et';
  }

  /* ---------- Bağlantılar ---------- */

  bindEvents() {
    document.addEventListener('pointerdown', () => this.sound.unlock(), { capture: true });
    // Çift dokunma ve kıstırma yakınlaştırmasını engelle.
    document.addEventListener('dblclick', (event) => event.preventDefault());
    document.addEventListener('gesturestart', (event) => event.preventDefault());
    let lastTouch = 0;
    document.addEventListener('touchend', (event) => {
      const now = Date.now();
      if (now - lastTouch < 300 && !event.target.closest('button, input, label')) event.preventDefault();
      lastTouch = now;
    }, { passive: false });

    document.addEventListener('pointerdown', (event) => {
      const button = event.target.closest('.btn:not(:disabled)');
      if (!button) return;
      const rect = button.getBoundingClientRect();
      pressEffect(button, event.clientX - rect.left, event.clientY - rect.top);
    });

    for (const button of $$('[data-nav]')) {
      button.addEventListener('click', () => {
        this.sound.tap();
        this.returnTo = 'menu';
        this.go(button.dataset.nav);
      });
    }
    for (const button of $$('[data-back]')) {
      button.addEventListener('click', () => {
        this.sound.tap();
        this.go(this.returnTo);
      });
    }
    $('#btn-menu').addEventListener('click', () => this.openSheet());
    $('#sheet').addEventListener('click', (event) => {
      if (event.target.id === 'sheet') this.closeSheet();
    });
    $('#sheet-hint').addEventListener('click', () => {
      this.closeSheet();
      this.showHint();
    });
    $('#sheet-home').addEventListener('click', () => {
      this.closeSheet();
      this.refreshPlayLabel();
      this.go('menu');
    });
    for (const button of $$('[data-sheet-nav]')) {
      button.addEventListener('click', () => {
        this.closeSheet();
        this.returnTo = 'table';
        this.go(button.dataset.sheetNav);
      });
    }

    $('#chips').addEventListener('click', (event) => {
      const button = event.target.closest('.chip-btn');
      if (button) this.addChip(Number(button.dataset.value), button);
    });
    $('#btn-clear').addEventListener('click', () => this.clearBet());
    $('#btn-rebet').addEventListener('click', () => this.rebet());
    $('#btn-deal').addEventListener('click', () => this.startDeal());

    for (const button of $$('[data-move]')) {
      button.addEventListener('click', () => this.move(button.dataset.move));
    }
    $('#btn-ins-yes').addEventListener('click', () => this.decideInsurance(true));
    $('#btn-ins-no').addEventListener('click', () => this.decideInsurance(false));
    $('#btn-next').addEventListener('click', () => this.newRound());
    $('#btn-repeat').addEventListener('click', () => this.repeatRound());
    $('#btn-restart').addEventListener('click', () => this.restart());

    for (const key of ['sound', 'vibration', 'hints']) {
      $(`#set-${key}`).addEventListener('change', (event) => {
        this.settings[key] = event.target.checked;
        this.applySettings();
        this.persist();
      });
    }
    for (const button of $$('[data-speed]')) {
      button.addEventListener('click', () => {
        this.settings.speed = button.dataset.speed;
        this.applySettings();
        this.persist();
      });
    }
  }

  applySettings() {
    const { settings, sound } = this;
    sound.enabled = settings.sound;
    sound.vibration = settings.vibration;
    setAnimationSpeed(settings.speed);
    $('#set-sound').checked = settings.sound;
    $('#set-vibration').checked = settings.vibration;
    $('#set-hints').checked = settings.hints;
    for (const button of $$('[data-speed]')) {
      button.classList.toggle('on', button.dataset.speed === settings.speed);
    }
  }

  openSheet() {
    this.sound.tap();
    const hintable = !this.busy && this.settings.hints && ['player', 'insurance'].includes(this.game.phase);
    $('#sheet-hint').hidden = !hintable;
    $('#sheet').classList.add('active');
  }

  closeSheet() {
    $('#sheet').classList.remove('active');
  }

  go(name) {
    if (name === 'stats') this.renderStats();
    this.particles.setDensity({ menu: 52, table: 14 }[name] ?? 22);
    for (const screen of $$('.screen')) {
      screen.classList.toggle('active', screen.id === `screen-${name}`);
    }
    if (name === 'table') requestAnimationFrame(() => this.layoutAll(0));
  }

  renderStats() {
    const { hands, wins, losses, pushes, blackjacks, highestBalance, biggestWin } = this.stats;
    const percent = (value) => (hands ? `%${((value / hands) * 100).toFixed(1).replace('.', ',')}` : '–');
    $('#stats-body').innerHTML = `
      <div class="stat-hero">
        <div><b>${percent(wins)}</b><span>Kazanma</span></div>
        <div><b>${percent(losses)}</b><span>Kaybetme</span></div>
        <div><b>${percent(pushes)}</b><span>Beraberlik</span></div>
      </div>
      <div class="stat-row"><span>Oynanan el</span><b>${money(hands)}</b></div>
      <div class="stat-row"><span>Kazanılan</span><b>${money(wins)}</b></div>
      <div class="stat-row"><span>Kaybedilen</span><b>${money(losses)}</b></div>
      <div class="stat-row"><span>Beraberlik</span><b>${money(pushes)}</b></div>
      <div class="stat-row"><span>Blackjack sayısı</span><b>${money(blackjacks)}</b></div>
      <div class="stat-row"><span>En yüksek bakiye</span><b>${money(highestBalance)}</b></div>
      <div class="stat-row"><span>En büyük el kazancı</span><b>${money(biggestWin)}</b></div>
      <p class="page-note">Split edilen her el ayrı sayılır. Teslim kayıp olarak sayılır.</p>`;
  }

  /* ---------- Görünüm modeli ---------- */

  point(el) {
    const base = this.table.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    return {
      x: rect.left - base.left + rect.width / 2,
      y: rect.top - base.top + rect.height / 2,
      top: rect.top - base.top,
      bottom: rect.bottom - base.top,
      width: rect.width,
    };
  }

  cardSize() {
    const probe = $('#card-probe');
    return { w: probe.offsetWidth, h: probe.offsetHeight };
  }

  shoeTransform() {
    const shoe = this.point($('#shoe'));
    const { w } = this.cardSize();
    return `translate(${shoe.x - w * 0.22}px,${shoe.top}px) rotate(14deg) scale(.42)`;
  }

  addDealerCardView(card, faceDown) {
    const el = makeCard(card, faceDown);
    const view = { card, el, faceDown, tilt: Math.random() * 1.6 - 0.8 };
    this.layer.appendChild(el);
    this.dealerView.push(view);
    return view;
  }

  addCardView(handView, card) {
    const el = makeCard(card, false);
    const view = { card, el, tilt: Math.random() * 2 - 1 };
    this.layer.appendChild(el);
    handView.cards.push(view);
    return view;
  }

  addHandView(bet, stack = null, index = this.handViews.length) {
    const tag = document.createElement('span');
    tag.className = 'total';
    tag.hidden = true;
    const note = document.createElement('span');
    note.className = 'hand-note';
    note.hidden = true;
    const view = { cards: [], bet, tag, note, stack: stack ?? this.makeStack(bet) };
    this.layer.append(tag, note);
    this.handViews.splice(index, 0, view);
    return view;
  }

  makeStack(amount) {
    const stack = document.createElement('div');
    stack.className = 'stack';
    this.layer.appendChild(stack);
    this.fillStack(stack, amount);
    return stack;
  }

  fillStack(stack, amount) {
    stack.textContent = '';
    if (amount <= 0) return;
    const chips = chipBreakdown(amount);
    const shown = chips.slice(-9);
    shown.forEach((value, i) => {
      const chip = makeChip(value);
      chip.style.transform = `translateY(${-i * 4}px)`;
      stack.appendChild(chip);
    });
    const label = document.createElement('span');
    label.className = 'stack-amount';
    label.textContent = money(amount);
    stack.appendChild(label);
  }

  /* ---------- Yerleşim ---------- */

  layoutDealer(ms) {
    const { w } = this.cardSize();
    const zone = this.point($('#dealer-zone'));
    const count = this.dealerView.length;
    const room = zone.width - 110;
    const dx = count > 1 ? Math.min(w * 0.6, (room - w) / (count - 1)) : 0;
    const left = zone.x - (w + dx * (count - 1)) / 2;
    const y = zone.top + 6;
    return Promise.all(this.dealerView.map((view, i) => {
      view.target = `translate(${left + dx * i}px,${y}px) rotate(${view.tilt}deg)`;
      return view.fresh ? null : moveTo(view.el, view.target, ms);
    }));
  }

  layoutHands(ms) {
    const { w, h } = this.cardSize();
    const zone = this.point($('#player-zone'));
    const count = this.handViews.length;
    if (count === 0) return Promise.resolve();
    const scale = HAND_SCALE[count - 1];
    const cardW = w * scale;
    const cardH = h * scale;
    const slot = (zone.width - 8) / count;
    const chipSize = this.chipSize();
    const stackScale = count === 1 ? 1 : 0.74;
    const stackY = zone.bottom - chipSize - (count === 1 ? 10 : 24);
    const cardsTop = zone.top + (count === 1 ? 10 : 2);
    const tagRoom = 28;
    const moves = [];

    this.handViews.forEach((view, i) => {
      const cx = 4 + slot * (i + 0.5);
      const cards = view.cards.length;
      const stepMax = (count === 1 ? zone.width - 24 - cardW : slot - 6 - cardW) / Math.max(1, cards - 1);
      const dx = cards > 1 ? Math.min(count === 1 ? cardW * 0.6 : cardW * 0.34, stepMax) : 0;
      const roomY = stackY - tagRoom - cardsTop - cardH;
      const dy = count > 1 && cards > 1 ? Math.max(0, Math.min(cardH * 0.17, roomY / (cards - 1))) : 0;
      const left = cx - (cardW + dx * (cards - 1)) / 2;

      view.cards.forEach((card, c) => {
        card.target = `translate(${left + dx * c}px,${cardsTop + dy * c}px) rotate(${card.tilt}deg) scale(${scale})`;
        if (!card.fresh) moves.push(moveTo(card.el, card.target, ms));
      });

      const bottom = cardsTop + cardH + dy * Math.max(0, cards - 1);
      view.tag.style.left = `${cx}px`;
      view.tag.style.top = `${bottom + 5}px`;
      view.tag.style.transform = 'translateX(-50%)';
      view.note.style.left = `${cx}px`;
      view.note.style.top = `${bottom + 31}px`;
      view.note.style.transform = 'translateX(-50%)';

      view.stack.classList.toggle('compact', count > 1);
      moves.push(moveTo(view.stack, `translate(${cx - chipSize / 2}px,${stackY}px) scale(${stackScale})`, ms));
    });
    return Promise.all(moves);
  }

  layoutAll(ms) {
    if (this.handViews.length === 0 && this.spot.stack) this.placeSpotStack(ms);
    return Promise.all([this.layoutDealer(ms), this.layoutHands(ms)]);
  }

  chipSize() {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chip')) || 44;
  }

  placeSpotStack(ms) {
    const zone = this.point($('#player-zone'));
    const size = this.chipSize();
    return moveTo(this.spot.stack, `translate(${zone.x - size / 2}px,${zone.bottom - size - 10}px)`, ms);
  }

  /* ---------- Bakiye ---------- */

  setBalance(value, animate = true) {
    const from = this.shownBalance;
    this.shownBalance = value;
    if (animate) {
      countTo(this.balanceEl, from, value, money);
      if (from !== value) pulseNumber(this.balanceEl);
    } else {
      this.balanceEl.textContent = money(value);
    }
  }

  /* ---------- Bahis ---------- */

  buildChips() {
    const box = $('#chips');
    for (const value of CHIPS) {
      const button = document.createElement('button');
      button.className = 'chip-btn chip';
      button.dataset.value = value;
      button.setAttribute('aria-label', `${value} fiş`);
      button.innerHTML = chipHTML(value);
      box.appendChild(button);
    }
  }

  betCeiling() {
    return Math.min(this.game.balance, RULES.maxBet);
  }

  addChip(value, source) {
    if (this.busy || this.game.phase !== 'betting') return;
    if (this.pendingBet + value > this.betCeiling()) return;
    this.pendingBet += value;
    this.sound.buzz(8);
    this.setBalance(this.game.balance - this.pendingBet, false);
    this.refreshControls();
    const stack = this.ensureSpotStack();
    const target = this.point(stack);
    const start = this.point(source);
    this.flyChip(value, start, { x: target.x, y: target.y - 26 }, 360).then(() => {
      // Fiş havadayken el dağıtılmış olabilir; yığın artık masaya aittir.
      if (this.spot.stack === stack) this.fillStack(stack, this.pendingBet);
      this.sound.chip();
      wobble(stack);
    });
  }

  ensureSpotStack() {
    if (!this.spot.stack) {
      this.spot.stack = this.makeStack(0);
      this.placeSpotStack(0);
    }
    return this.spot.stack;
  }

  setPendingBet(amount) {
    this.pendingBet = amount;
    this.setBalance(this.game.balance - amount, false);
    const stack = this.ensureSpotStack();
    this.fillStack(stack, amount);
    this.refreshControls();
  }

  clearBet() {
    if (this.busy) return;
    this.sound.tap();
    this.setPendingBet(0);
  }

  rebet() {
    if (this.busy || !this.game.canBet(this.lastBet)) return;
    this.sound.chip();
    this.setPendingBet(this.lastBet);
    wobble(this.spot.stack);
  }

  async flyChip(value, from, to, ms, delay = 0) {
    const chip = makeChip(value);
    const size = this.chipSize();
    chip.style.width = `${size}px`;
    chip.style.height = `${size}px`;
    const place = (point) => `translate(${point.x - size / 2}px,${point.y - size / 2}px)`;
    chip.style.transform = place(to);
    this.layer.appendChild(chip);
    const lift = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 74 };
    await run(chip, [
      { transform: `${place(from)} rotate(0deg) scale(1.05)`, opacity: 0.9 },
      { transform: `${place(lift)} rotate(200deg) scale(1.28)`, opacity: 1, offset: 0.55 },
      { transform: `${place(to)} rotate(360deg) scale(1)`, opacity: 1 },
    ], ms, { delay, fill: 'backwards' });
    chip.remove();
  }

  flyChips(amount, from, to, ms = 420) {
    const chips = chipBreakdown(amount).slice(-6);
    return Promise.all(chips.map((value, i) => this.flyChip(value, from, to, ms, i * 75)));
  }

  /* ---------- Kontroller ---------- */

  showPanel(name) {
    for (const panel of $$('.panel')) {
      panel.classList.toggle('active', panel.id === `panel-${name}`);
    }
  }

  refreshControls() {
    const { game, busy } = this;
    const phase = game.phase;
    if (phase === 'betting') this.showPanel('bet');
    else if (phase === 'insurance') this.showPanel('insurance');
    else if (phase === 'settled') this.showPanel('result');
    else this.showPanel('play');
    for (const panel of $$('.panel')) panel.classList.toggle('locked', busy);

    if (phase === 'betting') {
      const ceiling = this.betCeiling();
      for (const button of $$('.chip-btn')) {
        button.disabled = this.pendingBet + Number(button.dataset.value) > ceiling;
      }
      // Yalnızca o anda işe yarayan bahis düğmeleri görünür.
      const hasBet = this.pendingBet > 0;
      const rebet = $('#btn-rebet');
      $('#btn-clear').hidden = busy || !hasBet;
      $('#btn-deal').hidden = busy || !hasBet;
      $('#btn-deal').disabled = !game.canBet(this.pendingBet);
      rebet.hidden = busy || hasBet || !game.canBet(this.lastBet);
      rebet.textContent = `Önceki · ${money(this.lastBet)}`;
    }

    const actions = game.availableActions();
    for (const button of $$('[data-move]')) {
      const move = button.dataset.move;
      button.disabled = busy || !actions[move];
      if (phase === 'player' && !busy) button.hidden = !actions[move];
      button.classList.remove('suggested');
    }

    if (phase === 'insurance') {
      const natural = handValue(game.hands[0].cards).total === 21;
      const cost = money(game.insuranceCost);
      $('#insurance-text').innerHTML = natural
        ? `<b>Eşit para</b> alırsan kazancın kesin. Bedel ${cost}.`
        : `<b>Sigorta</b> ister misin? Bedel ${cost}, 2:1 öder.`;
      const yes = $('#btn-ins-yes');
      yes.textContent = natural ? 'Eşit Para' : 'Sigorta';
      yes.disabled = busy || !game.canInsure();
      $('#btn-ins-no').disabled = busy;
    }

    if (phase === 'settled') {
      $('#btn-next').disabled = busy;
      const repeat = $('#btn-repeat');
      repeat.textContent = this.lastBet ? `Tekrarla · ${money(this.lastBet)}` : 'Tekrarla';
      repeat.disabled = busy || !this.lastBet || this.lastBet > game.balance;
    }
  }

  showHint() {
    const { game } = this;
    if (game.phase === 'insurance') {
      showToast(this.toast, 'Temel strateji: sigorta alma.', 2400);
      $('#btn-ins-no').classList.add('suggested');
      setTimeout(() => $('#btn-ins-no').classList.remove('suggested'), 3300);
      return;
    }
    if (game.phase !== 'player') return;
    const actions = game.availableActions();
    const move = recommend({
      cards: game.activeHand.cards,
      dealerRank: game.dealerUp.rank,
      canDouble: actions.double,
      canSplit: actions.split,
      canSurrender: actions.surrender,
    });
    showToast(this.toast, `Temel strateji: ${MOVE_NAMES[move]}`, 2400);
    for (const button of $$('[data-move]')) {
      button.classList.toggle('suggested', button.dataset.move === move);
    }
  }

  /* ---------- Akış ---------- */

  async perform(action) {
    if (this.busy) return;
    this.busy = true;
    this.refreshControls();
    try {
      const events = action();
      this.recordIfSettled(events);
      this.persist();
      await this.play(events);
    } finally {
      this.busy = false;
      this.refreshControls();
    }
  }

  recordIfSettled(events) {
    const settle = events.find((event) => event.type === 'settle');
    if (settle) this.stats = applyResults(this.stats, settle.results, settle.balance);
  }

  startDeal() {
    const bet = this.pendingBet;
    if (this.busy || !this.game.canBet(bet)) return;
    hideBanner(this.banner);
    $('#bet-spot').classList.add('dim');
    this.lastBet = bet;
    this.pendingBet = 0;
    const stack = this.ensureSpotStack();
    this.fillStack(stack, bet);
    this.spot.stack = null;
    this.addHandView(bet, stack);
    this.perform(() => this.game.deal(bet));
  }

  move(name) {
    if (this.busy) return;
    this.sound.buzz(6);
    this.perform(() => this.game[name]());
  }

  decideInsurance(take) {
    if (this.busy) return;
    this.sound.buzz(6);
    this.perform(() => this.game.insurance(take));
  }

  async newRound(rebetAmount = 0) {
    if (this.busy) return;
    this.busy = true;
    this.refreshControls();
    hideBanner(this.banner);
    const events = this.game.nextRound();
    this.persist();
    await this.clearTable();
    await this.play(events);
    $('#bet-spot').classList.remove('dim');
    this.busy = false;
    this.setBalance(this.game.balance, false);
    if (this.checkBroke()) {
      this.refreshControls();
      return;
    }
    if (rebetAmount && this.game.canBet(rebetAmount)) {
      this.setPendingBet(rebetAmount);
      this.startDeal();
      return;
    }
    this.refreshControls();
  }

  repeatRound() {
    this.newRound(this.lastBet);
  }

  checkBroke() {
    const broke = this.game.isBroke;
    $('#dialog-broke').classList.toggle('active', broke);
    return broke;
  }

  restart() {
    this.game.restart();
    this.persist();
    this.setPendingBet(0);
    this.setBalance(this.game.balance, true);
    this.checkBroke();
    this.refreshControls();
  }

  async clearTable() {
    const { w, h } = this.cardSize();
    const views = [...this.dealerView, ...this.handViews.flatMap((hand) => hand.cards)];
    const middle = this.table.clientWidth / 2 - w * 0.4;
    const top = this.table.clientHeight * 0.42 - h * 0.4;
    for (const hand of this.handViews) {
      hand.tag.remove();
      hand.note.remove();
      hand.stack.remove();
    }
    this.dealerTotal.hidden = true;
    // Kartlar ortada toplanır, sonra deste hâlinde yana süpürülür.
    await Promise.all(views.map(({ el }, i) => {
      const pile = `translate(${middle + (i % 5) * 1.5}px,${top - i}px) rotate(${-6 + (i % 3) * 3}deg) scale(.8)`;
      const gone = `translate(${-w * 1.5}px,${top + 26}px) rotate(-26deg) scale(.62)`;
      return run(el, [
        { transform: el.style.transform, opacity: 1, easing: 'cubic-bezier(.3,.7,.3,1)' },
        { transform: pile, opacity: 1, offset: 0.5 },
        { transform: pile, opacity: 1, offset: 0.62, easing: 'cubic-bezier(.5,0,.8,.5)' },
        { transform: gone, opacity: 0 },
      ], 680, { delay: i * 22, fill: 'both', easing: 'linear' });
    }));
    views.forEach(({ el }) => el.remove());
    this.dealerView = [];
    this.handViews = [];
  }

  /* ---------- Olay oynatma ---------- */

  async play(events) {
    for (const event of events) {
      await this.playEvent(event);
    }
  }

  playEvent(event) {
    switch (event.type) {
      case 'deal': return this.onDeal(event);
      case 'reveal': return this.onReveal();
      case 'peek': return this.onPeek();
      case 'turn': return this.onTurn(event);
      case 'split': return this.onSplit(event);
      case 'double': return this.onDouble(event);
      case 'bust': return this.onBust(event);
      case 'surrender': return this.onSurrender(event);
      case 'insuranceTaken': return this.onInsurance(event);
      case 'dealerBust': return this.onDealerBust();
      case 'settle': return this.onSettle(event);
      case 'shuffle': return this.onShuffle();
      case 'cutCard':
        showToast(this.toast, 'Kesme kartı çıktı', 1800);
        return undefined;
      case 'insuranceOffer':
        return wait(120);
      default:
        return undefined;
    }
  }

  async onDeal({ to, hand, card, faceDown }) {
    const owner = to === 'dealer' ? null : this.handViews[hand];
    const view = owner ? this.addCardView(owner, card) : this.addDealerCardView(card, faceDown);
    view.el.inner.style.transform = 'rotateY(180deg)';
    view.fresh = true;
    this.layoutAll(240); // yandaki kartlar yeni karta yer açar
    view.fresh = false;

    this.sound.card();
    this.sound.buzz(5);
    const motion = dealIn(view.el, this.shoeTransform(), view.target);
    const turned = faceDown ? null : flip(view.el.inner, 400);
    await wait(320);
    if (owner) this.updateHandTotal(owner, true);
    else this.updateDealerTotal(true);
    await Promise.all([motion, turned]);
    await wait(90); // kartlar arasındaki ritim
  }

  updateDealerTotal(animate) {
    const hidden = this.dealerView.filter((view) => !view.faceDown).map((view) => view.card);
    this.dealerTotal.hidden = hidden.length === 0;
    if (hidden.length === 0) return;
    this.dealerTotal.textContent = totalText(hidden, true);
    this.dealerTotal.classList.toggle('lost', handValue(hidden).bust);
    if (animate) tick(this.dealerTotal);
  }

  updateHandTotal(view, animate) {
    const cards = view.cards.map((item) => item.card);
    view.tag.hidden = cards.length === 0;
    if (cards.length === 0) return;
    view.tag.textContent = totalText(cards, view.finished);
    if (animate) tick(view.tag);
  }

  setActiveHand(index) {
    const multi = this.handViews.length > 1;
    this.handViews.forEach((view, i) => {
      const active = i === index;
      view.tag.classList.toggle('active', active);
      for (const card of view.cards) {
        card.el.classList.toggle('dim-card', multi && !active && !view.finished);
      }
    });
  }

  async onReveal() {
    const view = this.dealerView[1];
    if (!view || !view.faceDown) return;
    this.setActiveHand(-1);
    view.faceDown = false;
    view.el.setAttribute('aria-label', `${SUIT_NAMES[view.card.suit]} ${view.card.rank}`);
    this.sound.flip();
    await flip(view.el.inner);
    this.updateDealerTotal(true);
    await wait(220);
  }

  async onPeek() {
    const view = this.dealerView[1];
    if (!view) return;
    const base = view.el.style.transform;
    await run(view.el, [
      { transform: base },
      { transform: `${base} translateY(-7px) rotate(-3deg)`, offset: 0.4 },
      { transform: `${base} translateY(-7px) rotate(-3deg)`, offset: 0.6 },
      { transform: base },
    ], 620);
  }

  async onTurn({ hand }) {
    this.setActiveHand(hand);
    if (this.handViews.length > 1) await wait(100);
  }

  async onSplit({ hand }) {
    const view = this.handViews[hand];
    const moved = view.cards.pop();
    this.setBalance(this.shownBalance - view.bet, true);
    const stackStart = this.point(view.stack);
    const next = this.addHandView(view.bet, null, hand + 1);
    next.cards.push(moved);
    next.stack.style.transform = view.stack.style.transform;
    this.sound.chip();
    this.sound.card();
    await Promise.all([
      this.flyChips(view.bet, this.balancePoint(), stackStart, 280),
      this.layoutHands(320),
    ]);
    this.updateHandTotal(view, true);
    this.updateHandTotal(next, true);
    this.setActiveHand(hand);
  }

  balancePoint() {
    const base = this.table.getBoundingClientRect();
    const rect = this.balanceEl.getBoundingClientRect();
    return { x: rect.left + rect.width / 2 - base.left, y: rect.top + rect.height / 2 - base.top };
  }

  dealerPoint() {
    const { x, top } = this.point($('#dealer-zone'));
    return { x, y: top + 26 };
  }

  stackPoint(view) {
    const point = this.point(view.stack);
    return { x: point.x, y: point.y };
  }

  async onDouble({ hand, bet }) {
    const view = this.handViews[hand];
    const added = bet / 2;
    view.bet = bet;
    this.setBalance(this.shownBalance - added, true);
    this.sound.chip();
    await this.flyChips(added, this.balancePoint(), this.stackPoint(view), 280);
    this.fillStack(view.stack, bet);
    wobble(view.stack);
  }

  async onBust({ hand }) {
    const view = this.handViews[hand];
    this.sound.bust();
    this.sound.buzz([20, 40, 20]);
    view.finished = true;
    view.tag.classList.add('lost');
    this.updateHandTotal(view, false);
    await Promise.all(view.cards.map((card) => shake(card.el)));
    for (const card of view.cards) card.el.classList.add('bust-card');
    if (this.handViews.length === 1) {
      hideToast(this.toast);
      await showBanner(this.banner, { title: 'BUST', bad: true });
    } else {
      this.setNote(view, 'BUST', true);
      await wait(260);
    }
  }

  setNote(view, text, bad) {
    view.note.textContent = text;
    view.note.classList.toggle('bad', bad);
    view.note.hidden = false;
    run(view.note, [{ opacity: 0 }, { opacity: 1 }], 280);
  }

  async onSurrender({ hand }) {
    const view = this.handViews[hand];
    view.finished = true;
    for (const card of view.cards) card.el.classList.add('bust-card');
    await wait(160);
  }

  async onInsurance({ amount }) {
    this.setBalance(this.shownBalance - amount, true);
    this.sound.chip();
    await this.flyChips(amount, this.balancePoint(), this.stackPoint(this.handViews[0]), 260);
  }

  async onDealerBust() {
    this.dealerTotal.classList.add('lost');
    await Promise.all(this.dealerView.map((view) => shake(view.el)));
    this.sound.bust();
    for (const view of this.dealerView) view.el.classList.add('bust-card');
    await wait(120);
  }

  async onSettle({ results, balance }) {
    this.setActiveHand(-1);
    for (const view of this.handViews) {
      view.finished = true;
      this.updateHandTotal(view, false);
      for (const card of view.cards) card.el.classList.remove('dim-card');
    }
    const flights = [];
    const multi = this.handViews.length > 1;
    results.hands.forEach((result, i) => {
      const view = this.handViews[i];
      const point = this.stackPoint(view);
      const lostAll = result.outcome === 'lose' || result.outcome === 'bust';
      if (lostAll) {
        this.fillStack(view.stack, 0);
        flights.push(this.flyChips(result.bet, point, this.dealerPoint(), 420));
      } else if (result.outcome === 'surrender') {
        this.fillStack(view.stack, result.returned);
        flights.push(this.flyChips(result.bet / 2, point, this.dealerPoint(), 420));
      } else if (result.net > 0) {
        flights.push(this.flyChips(result.net, this.dealerPoint(), point, 460).then(() => {
          this.fillStack(view.stack, result.returned);
          wobble(view.stack);
        }));
      }
      if (lostAll) {
        view.tag.classList.add('lost');
        if (result.outcome === 'lose') {
          for (const card of view.cards) {
            card.el.classList.add('bust-card');
            sinkCard(card.el);
          }
        }
      }
      if (result.outcome === 'win' || result.outcome === 'blackjack') {
        view.tag.classList.add('good');
        tick(view.tag);
        view.cards.forEach((card, c) => liftCard(card.el, c * 70));
      }
      if (multi && result.outcome !== 'bust') {
        this.setNote(view, OUTCOME_NOTE[result.outcome], result.net < 0);
      }
    });

    this.announce(results);
    await Promise.all(flights);
    await wait(240);

    // Kalan fişler bakiyeye döner.
    const home = this.balancePoint();
    const returns = this.handViews.map((view, i) => {
      const amount = results.hands[i].returned;
      if (amount <= 0) return null;
      const point = this.stackPoint(view);
      this.fillStack(view.stack, 0);
      return this.flyChips(amount, point, home, 380);
    });
    this.setBalance(balance, true);
    await Promise.all(returns);
  }

  announce(results) {
    const { hands, net, insurance } = results;
    const single = hands.length === 1 ? hands[0] : null;
    const extra = insurance ? ' · sigorta dahil' : '';
    const detail = `${net === 0 ? 'Bahis iade' : signed(net)}${extra}`;
    const dealerNatural = this.dealerView.length === 2 && handValue(this.dealerView.map((v) => v.card)).total === 21;
    hideToast(this.toast);

    if (single && single.outcome === 'blackjack') {
      const rect = this.banner.getBoundingClientRect();
      this.particles.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, 120);
      pulseGlow($('#edge-glow'));
      this.sound.blackjack();
      this.sound.buzz([15, 50, 15, 50, 30]);
      showBanner(this.banner, { title: 'BLACKJACK', detail, big: true });
      return;
    }
    if (net > 0) {
      const rect = this.banner.getBoundingClientRect();
      this.particles.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, 44);
      this.sound.win();
      this.sound.buzz(20);
      showBanner(this.banner, { title: 'KAZANDIN', detail });
    } else if (net === 0 && !(insurance && !hands.some((h) => h.outcome === 'push'))) {
      this.sound.push();
      showBanner(this.banner, { title: 'BERABERLİK', detail });
    } else if (net === 0) {
      this.sound.push();
      showBanner(this.banner, { title: 'SİGORTA ÖDEDİ', detail });
    } else if (single && single.outcome === 'surrender') {
      this.sound.lose();
      showBanner(this.banner, { title: 'TESLİM', detail, bad: true });
    } else {
      const title = dealerNatural ? 'KRUPİYE BLACKJACK' : 'KAYBETTİN';
      if (single && single.outcome === 'bust') {
        this.banner.querySelector('span').textContent = detail; // BUST yazısı zaten ekranda
        return;
      }
      this.sound.lose();
      showBanner(this.banner, { title, detail, bad: true });
    }
  }

  async onShuffle() {
    const stage = $('#shuffle-stage');
    const { w, h } = this.cardSize();
    const blank = { rank: 'A', suit: 'S' };
    const cards = [];
    this.sound.shuffle();
    for (let i = 0; i < 12; i += 1) {
      const el = makeCard(blank, true);
      el.style.marginLeft = `${-w / 2}px`;
      el.style.marginTop = `${-h / 2}px`;
      el.style.zIndex = i;
      stage.appendChild(el);
      cards.push(el);
    }
    // Kartlar sahnenin %42 yüksekliğindeki noktadan ayakkabıya gider.
    const shoe = this.point($('#shoe'));
    const stageBox = this.point(stage);
    const originY = this.table.clientHeight * 0.42;
    const end = `translate(${shoe.x - stageBox.x}px,${shoe.y - originY}px) rotate(12deg) scale(.42)`;
    await Promise.all(cards.map((el, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      const open = `translate(${side * w * 0.62}px,${-i}px) rotate(${side * 5}deg)`;
      return run(el, [
        { transform: 'translate(0,20px) scale(.9)', opacity: 0 },
        { transform: open, opacity: 1, offset: 0.22 },
        { transform: open, offset: 0.42 + i * 0.012 },
        { transform: `translate(0,${-i * 0.7}px)`, offset: 0.62 + i * 0.008 },
        { transform: `translate(0,${-i * 0.7}px)`, offset: 0.82 },
        { transform: end, opacity: 0.2 },
      ], 1500, { easing: 'ease-in-out', fill: 'both' });
    }));
    stage.textContent = '';
  }
}

function start() {
  const app = new App();
  globalThis.blackjackApp = app; // tarayıcı testleri için
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();

})();
