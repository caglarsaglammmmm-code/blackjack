// Arayüz: motorun ürettiği olayları sırayla canlandırır. Görünen toplamlar ve
// bakiye motorun son durumundan değil, canlandırılan kartlardan hesaplanır;
// böylece ekran hiçbir zaman animasyonun önüne geçmez.

import { BlackjackGame, RULES, handValue } from './game.js';
import { recommend } from './strategy.js';
import { applyResults, loadProgress, saveProgress } from './storage.js';
import { SoundBoard } from './audio.js';
import { GoldParticles, countTo, dealIn, flip, hideBanner, hideToast, liftCard, moveTo, pressEffect, pulseGlow, pulseNumber, run, setAnimationSpeed, shake, showBanner, showToast, sinkCard, tick, wait, wobble } from './animations.js';

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
