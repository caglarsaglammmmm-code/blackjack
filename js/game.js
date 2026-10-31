// Blackjack kural motoru. DOM'a dokunmaz; her hamle arayüzün sırayla
// canlandıracağı bir olay listesi döndürür. Tüm durum düz JSON'dur, böylece
// oyun el ortasında kaydedilip geri yüklenebilir.

export const RULES = Object.freeze({
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

export function cardValue(rank) {
  if (rank === 'A') return 11;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return Number(rank);
}

// total: en iyi toplam. soft: bir As hâlâ 11 olarak sayılıyorsa true.
export function handValue(cards) {
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

export function isNatural(cards) {
  return cards.length === 2 && handValue(cards).total === 21;
}

export function createShoe(decks = RULES.decks) {
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
export function shuffle(cards, rng) {
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export function secureRandom() {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0] / 2 ** 32;
}

function newHand(cards, bet, fromSplit = false) {
  return { cards, bet, fromSplit, splitAces: false, doubled: false, done: false, status: 'playing' };
}

export class BlackjackGame {
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
