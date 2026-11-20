'use strict';
/* =========================================================================
   ui.js — componenti del design system
   ========================================================================= */

/* ---------------- Tema ---------------- */
const Theme = {
  pref() { return Prefs.get('theme', 'dark'); },
  apply(pref = this.pref()) {
    const root = document.documentElement;
    let eff = pref;
    if (pref === 'system') {
      const host = root.getAttribute('data-theme');
      eff = host === 'dark' || host === 'light' ? host : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }
    root.setAttribute('data-ui', eff);
  },
  set(pref) { Prefs.set('theme', pref); this.apply(pref); },
  init() {
    this.apply();
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.apply()); } catch {}
    new MutationObserver(() => { if (this.pref() === 'system') this.apply(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  },
};

/* ---------------- Tooltip (hover e focus da tastiera) ---------------- */
const Tooltip = {
  el: null, timer: null, cur: null,
  init() {
    this.el = h('div', { class: 'tooltip', role: 'tooltip' });
    document.body.appendChild(this.el);
    const show = (target, delay) => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.show(target), delay);
    };
    document.addEventListener('pointerover', (e) => {
      const tg = e.target.closest && e.target.closest('[data-tip]');
      if (tg && tg !== this.cur && e.pointerType !== 'touch') show(tg, 450);
      if (!tg) this.hide();
    });
    document.addEventListener('focusin', (e) => {
      const tg = e.target.closest && e.target.closest('[data-tip]');
      if (tg && tg.matches(':focus-visible')) show(tg, 150); else this.hide();
    });
    document.addEventListener('pointerdown', () => this.hide(), true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.hide(); });
    window.addEventListener('scroll', () => this.hide(), true);
  },
  show(target) {
    if (!document.body.contains(target)) return;
    this.cur = target;
    this.el.textContent = '';
    this.el.appendChild(document.createTextNode(target.dataset.tip));
    if (target.dataset.key) for (const k of target.dataset.key.split(' ')) this.el.appendChild(h('span', { class: 'kbd' }, k));
    const r = target.getBoundingClientRect();
    this.el.classList.add('show');
    const tw = this.el.offsetWidth; const th = this.el.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2; let y = r.bottom + 8;
    if (y + th > innerHeight - 8) y = r.top - th - 8;
    x = clamp(x, 8, innerWidth - tw - 8);
    this.el.style.left = x + 'px'; this.el.style.top = y + 'px';
  },
  hide() { clearTimeout(this.timer); this.cur = null; if (this.el) this.el.classList.remove('show'); },
};

/* ---------------- Toast ---------------- */
const Toast = {
  region: null,
  init() { this.region = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(this.region); },
  show(msg, { type = 'info', action, actionLabel, duration = 4500 } = {}) {
    const ic2 = ic(type === 'err' ? 'alert' : type === 'ok' ? 'checkCircle' : 'info', 't-ic');
    const el = h('div', { class: 'toast ' + type }, ic2, h('div', { class: 't-msg' }, msg));
    let closed = false;
    const close = () => { if (closed) return; closed = true; el.remove(); };
    if (action) el.appendChild(h('button', { class: 'btn btn-sm btn-outline', onclick: () => { close(); action(); } }, actionLabel));
    el.appendChild(h('button', { class: 'btn btn-sm btn-ghost btn-icon', 'aria-label': t('common.close'), onclick: close, html: icon('x') }));
    this.region.appendChild(el);
    while (this.region.children.length > 4) this.region.firstChild.remove();
    if (duration) setTimeout(close, duration);
    return { close, el };
  },
};

/* ---------------- Modale (dialog nativo: focus, Esc, top layer) ---------------- */
function modal({ title, desc, body, foot, wide, onClose, closable = true, label }) {
  const dlg = h('dialog', { class: 'modal' + (wide ? ' wide' : ''), 'aria-labelledby': 'mh-' + (label || 'x') });
  const head = h('div', { class: 'modal-head' },
    h('div', null, h('h2', { id: 'mh-' + (label || 'x') }, title), desc ? h('p', null, desc) : null),
    closable ? h('button', { class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': t('common.close'), onclick: () => api.close(), html: icon('x') }) : null);
  const bodyEl = h('div', { class: 'modal-body' }); if (body) appendKids(bodyEl, [body]);
  const footEl = h('div', { class: 'modal-foot' }); if (foot) appendKids(footEl, [foot]);
  dlg.append(head, bodyEl, footEl);
  document.body.appendChild(dlg);
  let closed = false;
  const api = {
    el: dlg, body: bodyEl, foot: footEl, head,
    close(val) {
      if (closed) return; closed = true;
      try { dlg.close(); } catch {}
      dlg.remove();
      onClose && onClose(val);
    },
    setClosable(v) { closable = v; },
  };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (closable) api.close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg && closable) api.close(); });
  dlg.showModal();
  return api;
}
function confirmDialog({ title, body, confirm, danger, cancel }) {
  return new Promise((resolve) => {
    let res = false;
    const m = modal({
      title, label: 'cf', body: body ? h('p', { class: 'muted', style: { color: 'var(--text-2)' } }, body) : null,
      foot: [
        h('button', { class: 'btn btn-ghost', onclick: () => m.close() }, cancel || t('common.cancel')),
        h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), onclick: () => { res = true; m.close(); } }, confirm),
      ],
      onClose: () => resolve(res),
    });
    setTimeout(() => m.foot.lastChild.focus(), 30);
  });
}
function promptDialog({ title, label, value, confirm, max = 80 }) {
  return new Promise((resolve) => {
    let res = null;
    const input = h('input', { class: 'input', value: value || '', maxlength: max, 'aria-label': label });
    const submit = () => { const v = input.value.trim(); if (!v) { input.setAttribute('aria-invalid', 'true'); input.focus(); return; } res = v; m.close(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    const m = modal({
      title, label: 'pr', body: h('label', { class: 'field' }, h('span', { class: 'label' }, label), input),
      foot: [h('button', { class: 'btn btn-ghost', onclick: () => m.close() }, t('common.cancel')), h('button', { class: 'btn btn-primary', onclick: submit }, confirm)],
      onClose: () => resolve(res),
    });
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

/* ---------------- Menu (contestuale e a tendina) ---------------- */
const Menu = {
  cur: null,
  open(items, x, y, { returnFocus } = {}) {
    this.close();
    const menu = h('div', { class: 'menu', role: 'menu' });
    for (const it of items) {
      if (it === '-') { menu.appendChild(h('hr')); continue; }
      const b = h('button', { role: 'menuitem', class: it.danger ? 'danger' : '', 'aria-disabled': it.disabled ? 'true' : null, tabindex: '-1' });
      if (it.swatch) b.appendChild(h('span', { class: 'swatch', style: { '--sw': it.swatch }, 'aria-hidden': 'true' }));
      if (it.icon) b.appendChild(ic(it.icon));
      else if (it.swatch) b.appendChild(h('span', { class: 'menu-ic-gap', 'aria-hidden': 'true' }));
      b.appendChild(h('span', null, it.label));
      if (it.key) b.appendChild(h('span', { class: 'kbd' }, it.key));
      b.addEventListener('click', () => { if (it.disabled) return; this.close(); it.run && it.run(); });
      menu.appendChild(b);
    }
    document.body.appendChild(menu);
    const mw = menu.offsetWidth; const mh = menu.offsetHeight;
    menu.style.left = clamp(x, 8, innerWidth - mw - 8) + 'px';
    menu.style.top = (y + mh > innerHeight - 8 ? Math.max(8, y - mh) : y) + 'px';
    const btns = $$('[role=menuitem]', menu);
    const focusable = btns.filter((b) => b.getAttribute('aria-disabled') !== 'true');
    (focusable[0] || btns[0]).focus();
    const onKey = (e) => {
      const i = focusable.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); focusable[(i + 1) % focusable.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); focusable[(i - 1 + focusable.length) % focusable.length].focus(); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); this.close(); }
      e.stopPropagation();
    };
    const onDown = (e) => { if (!menu.contains(e.target)) this.close(); };
    menu.addEventListener('keydown', onKey);
    setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
    this.cur = { menu, onDown, returnFocus };
  },
  close() {
    if (!this.cur) return;
    const { menu, onDown, returnFocus } = this.cur;
    document.removeEventListener('pointerdown', onDown, true);
    menu.remove();
    this.cur = null;
    if (returnFocus && document.body.contains(returnFocus)) returnFocus.focus({ focusVisible: true });
  },
  fromButton(btn, items) { const r = btn.getBoundingClientRect(); this.open(items, r.left, r.bottom + 6, { returnFocus: btn }); },
};

/* ---------------- Illustrazioni (SVG interni) ---------------- */
const Art = {
  film: () => `<svg class="art" viewBox="0 0 120 96" fill="none" aria-hidden="true"><ellipse cx="60" cy="84" rx="44" ry="7" fill="url(#eg-glow)" opacity=".7"/><path d="M60 8 98 30v36L60 88 22 66V30L60 8Z" fill="var(--surface-2)" stroke="url(#eg-grad)" stroke-width="2.5" stroke-linejoin="round"/><path d="M22.8 30.5 60 52l37.2-21.5M60 52v36" stroke="url(#eg-grad)" stroke-width="2.5" stroke-linejoin="round"/><path d="m53 33 13 7.5-13 7.5V33Z" fill="#a78bfa"/><path d="M30 44v14M36 47v14M84 47v14M90 44v14" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" opacity=".6"/></svg>`,
  timeline: () => `<svg class="art" viewBox="0 0 120 96" fill="none" aria-hidden="true"><rect x="10" y="30" width="100" height="40" rx="9" fill="var(--surface-2)" stroke="var(--border-strong)" stroke-dasharray="5 5"/><rect x="18" y="38" width="30" height="24" rx="5" fill="url(#eg-grad)" opacity=".9"/><rect x="52" y="38" width="22" height="24" rx="5" fill="url(#eg-grad)" opacity=".55"/><path d="M84 50h16M92 42v16" stroke="#a78bfa" stroke-width="2.5" stroke-linecap="round"/><path d="M60 14v66" stroke="#fff" stroke-width="2"/><rect x="55" y="10" width="10" height="9" rx="2.5" fill="#7b5cff"/></svg>`,
  folder: () => `<svg class="art" viewBox="0 0 120 96" fill="none" aria-hidden="true"><ellipse cx="60" cy="86" rx="40" ry="6" fill="url(#eg-glow)" opacity=".6"/><path d="M18 24a5 5 0 0 1 5-5h22l7 8h45a5 5 0 0 1 5 5v42a5 5 0 0 1-5 5H23a5 5 0 0 1-5-5V24Z" fill="var(--surface-2)" stroke="url(#eg-grad)" stroke-width="2.5"/><path d="m54 42 14 8-14 8V42Z" fill="#a78bfa"/></svg>`,
  hero: () => `<svg viewBox="0 0 560 500" fill="none" role="img" aria-label="${t('lp.heroAlt')}">
    <defs>
      <linearGradient id="h-sky" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#2a1660"/><stop offset=".55" stop-color="#8b3fd0"/><stop offset="1" stop-color="#ff9a6b"/></linearGradient>
      <linearGradient id="h-plat" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#2a2152"/><stop offset="1" stop-color="#140f2c"/></linearGradient>
      <filter id="h-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
    </defs>
    <path d="M280 300 520 400 280 492 40 400Z" fill="#7b5cff" opacity=".45" filter="url(#h-blur)"/>
    <path d="M280 296 512 392 280 482 48 392Z" fill="url(#h-plat)" stroke="#a78bfa" stroke-width="2"/>
    <path d="M48 392v14l232 90 232-90v-14L280 482Z" fill="#110c26"/>
    <path d="M48 406 280 496 512 406" stroke="#8b6cff" stroke-width="3" opacity=".9"/>
    <g transform="translate(70 66)">
      <rect x="0" y="0" width="420" height="250" rx="20" fill="#120d26" stroke="rgba(167,139,250,.45)" stroke-width="2"/>
      <rect x="14" y="14" width="392" height="168" rx="12" fill="url(#h-sky)"/>
      <circle cx="270" cy="112" r="30" fill="#ffe0a3"/>
      <path d="M14 150c50-22 90-24 140-8s110 8 150-10 70-10 102 4v34a12 12 0 0 1-12 12H26a12 12 0 0 1-12-12Z" fill="#2b1866"/>
      <path d="M14 166c60-14 120-6 170 4s130-2 222-12v12a12 12 0 0 1-12 12H26a12 12 0 0 1-12-12Z" fill="#170d3a"/>
      <rect x="14" y="196" width="392" height="40" rx="9" fill="#1c1640"/>
      <rect x="20" y="202" width="118" height="28" rx="6" fill="#7b5cff"/>
      <rect x="142" y="202" width="74" height="28" rx="6" fill="#5d3fd6"/>
      <rect x="220" y="202" width="132" height="28" rx="6" fill="#7b5cff"/>
      <rect x="356" y="202" width="44" height="28" rx="6" fill="#4b2fc2"/>
      <path d="M26 222h10M40 214v12M46 218v6M52 212v14M58 216v8M64 213v12M70 218v5M76 214v11M82 219v4" stroke="#fff" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"/>
      <g class="ph"><path d="M100 190v52" stroke="#fff" stroke-width="2.5"/><rect x="94" y="186" width="12" height="9" rx="3" fill="#fff"/></g>
    </g>
    <g transform="translate(408 274)"><rect width="108" height="44" rx="14" fill="#1c1640" stroke="rgba(167,139,250,.5)"/><path d="m22 14 10 8-10 8V14Z" fill="#a78bfa"/><text x="42" y="28" fill="#f4f2ff" font-family="Plus Jakarta Sans, system-ui, sans-serif" font-size="14" font-weight="700">0:42.10</text></g>
    <g transform="translate(36 246)"><rect width="96" height="40" rx="13" fill="#1c1640" stroke="rgba(167,139,250,.5)"/><g stroke="#a78bfa" stroke-width="2" stroke-linecap="round" fill="none"><circle cx="22" cy="14" r="4"/><circle cx="22" cy="27" r="4"/><path d="m36 10-11 14M30 22l6 8"/></g><text x="44" y="25" fill="#f4f2ff" font-family="Plus Jakarta Sans, system-ui, sans-serif" font-size="13" font-weight="700">S</text></g>
  </svg>`,
  dash: () => `<svg viewBox="0 0 320 220" fill="none" aria-hidden="true"><path d="M160 120 290 175 160 215 30 175Z" fill="#7b5cff" opacity=".35" filter="url(#eg-soft)"/><path d="M160 118 282 170 160 208 38 170Z" fill="var(--surface-3)" stroke="#a78bfa" stroke-width="1.5"/><path d="M160 22 238 66v84l-78 44-78-44V66l78-44Z" fill="var(--surface-2)" stroke="url(#eg-grad)" stroke-width="3" stroke-linejoin="round"/><path d="M83 67 160 111l77-44M160 111v83" stroke="url(#eg-grad)" stroke-width="3" stroke-linejoin="round"/><path d="m146 62 26 15-26 15V62Z" fill="#a78bfa"/><path d="M100 104v26M110 110v26M210 110v26M220 104v26" stroke="#a78bfa" stroke-width="3" stroke-linecap="round" opacity=".55"/></svg>`,
};

/* ---------------- Suggerimenti contestuali (una sola volta ciascuno) ---------------- */
const Tips = {
  cur: null,
  done(key) { return (Prefs.get('tips', {}) || {})[key]; },
  mark(key) { const d = Prefs.get('tips', {}) || {}; d[key] = 1; Prefs.set('tips', d); },
  reset() { Prefs.set('tips', {}); },
  show(container, key, text) {
    if (!container || this.done(key) || this.cur || Tour.active) return;
    this.mark(key);
    const el = h('div', { class: 'tip-bubble', role: 'status' }, ic('sparkle'), h('p', null, text),
      h('button', { class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': t('common.close'), onclick: () => this.hide(), html: icon('x') }));
    container.appendChild(el);
    this.cur = el;
    this.timer = setTimeout(() => this.hide(), 9000);
  },
  hide() { clearTimeout(this.timer); if (this.cur) this.cur.remove(); this.cur = null; },
};

/* ---------------- Tutorial interattivo sugli elementi reali ---------------- */
const Tour = {
  active: false,
  start(steps, { onEnd } = {}) {
    this.end(true);
    this.active = true;
    this.steps = steps; this.i = 0; this.onEnd = onEnd;
    this.shade = h('div', { class: 'tour-shade', 'aria-hidden': 'true' });
    this.spot = h('div', { class: 'tour-spot' });
    this.pop = h('div', { class: 'tour-pop', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tour-h' });
    document.body.append(this.shade, this.spot, this.pop);
    this._onResize = () => this.place();
    this._onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.end(); } };
    window.addEventListener('resize', this._onResize);
    document.addEventListener('keydown', this._onKey, true);
    this.render();
  },
  render() {
    const s = this.steps[this.i];
    const n = this.steps.length;
    this.pop.textContent = '';
    const dots = h('div', { class: 'dots', 'aria-hidden': 'true' }, this.steps.map((_, j) => h('i', { class: j === this.i ? 'on' : '' })));
    const next = h('button', { class: 'btn btn-primary btn-sm', onclick: () => this.next() }, this.i === n - 1 ? t('tour.finish') : t('tour.next'));
    const foot = h('div', { class: 'foot' }, dots, h('div', { class: 'grow' }),
      this.i > 0 ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => this.prev() }, t('tour.back')) : h('button', { class: 'btn btn-ghost btn-sm', onclick: () => this.end() }, t('tour.skip')),
      next);
    const extra = s.action ? h('button', { class: 'btn btn-outline btn-sm', style: { marginTop: '12px' }, onclick: () => { const a = s.action; this.end(); a.run(); } }, s.action.label) : null;
    this.pop.append(h('div', { class: 'step' }, t('tour.step', { i: this.i + 1, n })), h('h3', { id: 'tour-h' }, s.title), h('p', null, s.text), extra, foot);
    this.place();
    setTimeout(() => next.focus(), 20);
  },
  place() {
    if (!this.active) return;
    const s = this.steps[this.i];
    const tg = typeof s.target === 'function' ? s.target() : $(s.target);
    const pw = this.pop.offsetWidth; const ph = this.pop.offsetHeight;
    if (!tg) {
      Object.assign(this.spot.style, { left: innerWidth / 2 + 'px', top: innerHeight / 2 + 'px', width: '0px', height: '0px' });
      Object.assign(this.pop.style, { left: (innerWidth - pw) / 2 + 'px', top: (innerHeight - ph) / 2 + 'px' });
      return;
    }
    const r = tg.getBoundingClientRect(); const pad = 6;
    Object.assign(this.spot.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    let x; let y;
    const space = { right: innerWidth - r.right, left: r.left, below: innerHeight - r.bottom, above: r.top };
    if (space.right > pw + 24) { x = r.right + 18; y = r.top; }
    else if (space.below > ph + 24) { x = r.left; y = r.bottom + 18; }
    else if (space.above > ph + 24) { x = r.left; y = r.top - ph - 18; }
    else if (space.left > pw + 24) { x = r.left - pw - 18; y = r.top; }
    else { x = (innerWidth - pw) / 2; y = innerHeight - ph - 24; }
    Object.assign(this.pop.style, { left: clamp(x, 12, innerWidth - pw - 12) + 'px', top: clamp(y, 12, innerHeight - ph - 12) + 'px' });
  },
  next() { if (this.i < this.steps.length - 1) { this.i++; this.render(); } else this.end(); },
  prev() { if (this.i > 0) { this.i--; this.render(); } },
  end(silent) {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('keydown', this._onKey, true);
    this.shade.remove(); this.spot.remove(); this.pop.remove();
    if (!silent && this.onEnd) this.onEnd();
  },
};

/* ---------------- Elenco scorciatoie ---------------- */
function shortcutList() {
  return [
    ['sc.g.play'],
    ['sc.play', ['Spazio']], ['sc.frame', ['←', '→']], ['sc.second', ['⇧', '←/→']], ['sc.startEnd', ['Home', 'End']], ['sc.full', ['F']],
    ['sc.compare', ['⇧', 'D']],
    ['sc.g.tools'],
    ['sc.pointer', ['A']], ['sc.blade', ['B']], ['sc.slip', ['T']], ['sc.snap', ['N']], ['sc.marker', ['M']], ['sc.markerJump', ['⇧', '↑/↓']],
    ['sc.g.edit'],
    ['sc.split', ['S']], ['sc.delete', ['Canc']], ['sc.dup', [MOD, 'D']], ['sc.disable', ['D']], ['sc.move', ['Alt', '←/→']], ['sc.selAll', [MOD, 'A']],
    ['sc.speed', [MOD, 'R']], ['sc.copyAttr', [MOD, 'C']], ['sc.pasteAttr', ['Alt', 'V']],
    ['sc.g.project'],
    ['sc.undo', [MOD, 'Z']], ['sc.redo', [MOD, '⇧', 'Z']], ['sc.zoom', ['+', '−']], ['sc.save', [MOD, 'S']], ['sc.export', [MOD, 'E']], ['sc.help', ['?']],
  ].map(([k, keys]) => (keys ? { label: t(k), keys: keys.map((x) => (x === 'Spazio' ? t('key.space') : x === 'Canc' ? t('key.del') : x)) } : { group: t(k) }));
}
function shortcutsEl() {
  return h('div', { class: 'short-list' }, shortcutList().map((s) => (s.group ? h('h3', { class: 'short-group' }, s.group) : h('div', null, h('span', null, s.label), h('span', { class: 'keys' }, s.keys.map((k) => h('span', { class: 'kbd' }, k)))))));
}
function openShortcuts() {
  const m = modal({ title: t('sc.title'), desc: t('sc.desc'), body: shortcutsEl(), wide: true, label: 'sc', foot: h('button', { class: 'btn btn-primary', onclick: () => m.close() }, t('common.ok')) });
}
