// Temel strateji: 4-8 deste, krupiye soft 17'de durur, split sonrası double,
// late surrender, peek. Sütunlar krupiye açık kartı: 2 3 4 5 6 7 8 9 10 A.
// H kart, S dur, D double (yoksa kart), d double (yoksa dur), P split,
// R surrender (yoksa kart).

import { cardValue, handValue } from './game.js';

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
export function recommend({ cards, dealerRank, canDouble, canSplit, canSurrender }) {
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
