// localStorage kalıcılığı. Depolama kapalıysa (gizli sekme vb.) oyun bellekte
// çalışmaya devam eder.

import { RULES } from './game.js';

const KEY = 'asil-blackjack-v1';

export const DEFAULT_SETTINGS = Object.freeze({
  sound: true,
  vibration: true,
  speed: 'normal', // normal | fast
  hints: true,
});

export function defaultStats() {
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
export function applyResults(stats, results, balance) {
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

export function loadProgress() {
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

export function saveProgress(progress) {
  try {
    globalThis.localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // Depolama yoksa ilerleme yalnızca bu oturumda kalır.
  }
}
