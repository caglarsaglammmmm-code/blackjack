// Animasyon yardımcıları: yalnızca transform ve opacity canlandırılır.

const SPEEDS = { normal: 1, fast: 0.55 };
let speedFactor = 1;
const motionQuery = globalThis.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;

export const reducedMotion = () => Boolean(motionQuery && motionQuery.matches);
export const setAnimationSpeed = (name) => { speedFactor = SPEEDS[name] ?? 1; };
export const scaled = (ms) => (reducedMotion() ? 0 : ms * speedFactor);
export const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, scaled(ms)); });

export const EASE_OUT = 'cubic-bezier(.22,.8,.24,1)';
const EASE_LAND = 'cubic-bezier(.18,.9,.3,1.08)';

export function run(el, keyframes, ms, options = {}) {
  const duration = scaled(ms);
  if (duration <= 0 || !el.animate) return Promise.resolve();
  const delay = scaled(options.delay ?? 0);
  const animation = el.animate(keyframes, { easing: EASE_OUT, ...options, delay, duration });
  return animation.finished.then(() => {}, () => {});
}

// Son durumu stile yazar, oraya önceki konumdan kayar.
export function moveTo(el, transform, ms, options = {}) {
  const from = options.from ?? el.style.transform;
  el.style.transform = transform;
  if (!from || from === transform) return Promise.resolve();
  return run(el, [{ transform: from }, { transform }], ms, options);
}

export function flip(inner, ms = 420) {
  inner.style.transform = 'rotateY(0deg)';
  return run(inner, [
    { transform: 'rotateY(180deg) scale(1)' },
    { transform: 'rotateY(90deg) scale(1.08)', offset: 0.5 },
    { transform: 'rotateY(0deg) scale(1)' },
  ], ms, { easing: 'ease-in-out' });
}

// Ayrı scale özelliği, rozetin konum transform'una dokunmaz.
export function tick(el) {
  return run(el, [{ scale: 0.8, opacity: 0.4 }, { scale: 1.12, offset: 0.6 }, { scale: 1, opacity: 1 }], 260);
}

export function shake(el) {
  const base = el.style.transform;
  if (!base || reducedMotion()) return Promise.resolve();
  const at = (x, r) => ({ transform: `translate(${x}px,0) rotate(${r}deg) ${base}` });
  return run(el, [at(0, 0), at(-4, -0.8), at(4, 0.8), at(-3, -0.5), at(2, 0.3), at(0, 0)], 340, { easing: 'linear' });
}

export function wobble(el) {
  const base = el.style.transform || 'translate(0,0)';
  return run(el, [
    { transform: `${base} rotate(0deg)` },
    { transform: `${base} rotate(-3deg)` },
    { transform: `${base} rotate(2deg)` },
    { transform: `${base} rotate(-1deg)` },
    { transform: `${base} rotate(0deg)` },
  ], 300);
}

// Sayıyı akıcı biçimde hedefe götürür.
export function countTo(el, from, to, format, ms = 620) {
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

export function showBanner(el, { title, detail, big = false, bad = false, hold = 0 }) {
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
    : [{ opacity: 0, transform: 'scale(.86)' }, { opacity: 1, transform: 'scale(1)' }];
  if (reducedMotion()) {
    if (hold) {
      el.style.opacity = '1';
      setTimeout(() => { el.style.opacity = '0'; }, 900);
    }
    return Promise.resolve();
  }
  return run(el, keyframes, hold || 420);
}

export function hideBanner(el) {
  if (el.style.opacity === '0' || !el.style.opacity) return;
  el.style.opacity = '0';
  run(el, [{ opacity: 1 }, { opacity: 0 }], 200);
}

export function pulseGlow(el) {
  if (reducedMotion()) return;
  run(el, [{ opacity: 0 }, { opacity: 1, offset: 0.28 }, { opacity: 0 }], 1700);
}

export function showToast(el, text, hold = 2000) {
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
export function hideToast(el) {
  if (el.current) el.current.cancel();
  el.current = null;
  clearTimeout(el.hideTimer);
  el.style.opacity = '0';
}

// Kartın yere otururken kullandığı yumuşak iniş.
export const landing = { easing: EASE_LAND };

// Altın parçacıklar. Arka plan tozu tek kanvasta, kıvılcımlar üst kanvasta.
export class GoldParticles {
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
    for (let i = 0; i < 24; i += 1) this.motes.push(this.mote(true));
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
