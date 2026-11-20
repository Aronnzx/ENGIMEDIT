'use strict';
/* =========================================================================
   inspector.js — Inspector dell'editor (metodi di Editor): schede Video,
   Colore, Effetti e Audio; Incolla attributi; Impostazioni progetto.
   Ogni controllo passa da liveSel/endLive (trascinamento) o commitSel
   (valore digitato): tutto è annullabile.
   ========================================================================= */
const INSP_TABS = [['video', 'film'], ['color', 'palette'], ['fx', 'sparkle'], ['audio', 'wave']];

Object.assign(Editor.prototype, {
  /* ======================= Struttura ======================= */
  isVisual(lane) { return lane === 'v1' || lane === 'v2'; },
  canAudio(c) { return this.hasSource(c); },
  inspTabsFor(sel) {
    const tabs = [];
    if (sel.some(({ lane }) => this.isVisual(lane))) tabs.push('video', 'color', 'fx');
    if (sel.some(({ clip }) => this.canAudio(clip))) tabs.push('audio');
    return tabs;
  },
  /** Prima clip selezionata a cui si applica la scheda. */
  firstFor(tab) {
    const sel = this.selected();
    const ok = (x) => (tab === 'audio' ? this.canAudio(x.clip) : this.isVisual(x.lane));
    const f = sel.find(ok) || sel[0];
    return f ? this.findClip(f.clip.id).clip : null;
  },
  /** Campi applicati solo alle clip visive / con audio. */
  vis(fields) { return (c, lane) => (this.isVisual(lane) ? (typeof fields === 'function' ? fields(c, lane) : fields) : null); },
  aud(fields) { return (c) => (this.canAudio(c) ? (typeof fields === 'function' ? fields(c) : fields) : null); },
  inspSig(sel) {
    return [this.inspTab, ...sel.map(({ lane, clip }) => {
      const a = this.assetOf(clip); const e = clip.assetId ? Media.get(clip.assetId) : null;
      const tf = Engine.g(clip, 'tf');
      return [clip.id, lane, this.kindOfClip(clip), clip.fit, tf.link, Engine.g(clip, 'dz').mode, a ? `${a.width}x${a.height}` : '', e ? e.audioState : '', clip.speed, this.project.format, clip.in, clip.out, clip.start, this.clipName(clip), !!this.attrClip].join(':');
    })].join('|');
  },

  /* ======================= Rendering ======================= */
  renderProps(soft) {
    const sel = this.selected();
    this.ed.classList.toggle('no-props', !sel.length);
    if (!sel.length) { this.propsBody.textContent = ''; this._propsSig = null; return; }
    const tabs = this.inspTabsFor(sel);
    if (!tabs.includes(this.inspTab)) this.inspTab = tabs[0];
    const sig = this.inspSig(sel);
    if (this._propsSig === sig && this._propSync) { this.syncPropValues(); return; }
    if (soft && this._propsSig === sig) return;
    const scroll = this.propsBody.scrollTop;
    const focusKey = document.activeElement && this.propsBody.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    this._propsSig = sig;
    this._propSync = [];
    this.propsBody.textContent = '';
    const row = (k, v) => h('div', { class: 'props-row' }, h('span', null, k), h('span', { class: 'v tnum' }, v));
    // intestazione: informazioni sulla clip
    if (sel.length === 1) {
      const { lane, clip: c, index } = sel[0]; const a = this.assetOf(c) || {};
      const kind = this.kindOfClip(c);
      this.propsTitle.lastChild.textContent = lane === 'v1' ? t('ed.clipN', { n: index + 1 }) : t('insp.laneClip', { lane: lane.toUpperCase() });
      const nm = this.clipName(c);
      const info = h('div', { class: 'props-sec' }, h('div', { class: 'insp-name' }, h('span', { class: 'badge' }, t('pool.kind.' + kind)), nm !== t('pool.kind.' + kind) ? h('b', null, nm) : null),
        row(t('props.dur'), fmtDur(Engine.dur(c))));
      if (this.hasSource(c)) info.append(row(t('props.part'), `${fmtTime(c.in)} – ${fmtTime(c.out)}`));
      if (lane !== 'v1') info.append(row(t('props.start'), fmtTime(c.start || 0)));
      if (a.width) info.append(row(t('props.src'), `${a.width}×${a.height}`));
      this.propsBody.append(info);
    } else {
      this.propsTitle.lastChild.textContent = t('ed.clipsN', { n: sel.length });
      this.propsBody.append(h('div', { class: 'props-sec' }, row(t('props.selected'), String(sel.length)), row(t('props.totDur'), fmtDur(sel.reduce((s, x) => s + Engine.dur(x.clip), 0)))));
    }
    // schede
    const tabList = h('div', { class: 'insp-tabs', role: 'tablist', 'aria-label': t('insp.tabs') });
    const panel = h('div', { class: 'insp-panel', role: 'tabpanel', id: 'insp-panel', 'aria-labelledby': 'insp-tab-' + this.inspTab });
    for (const [k, iconName] of INSP_TABS) {
      if (!tabs.includes(k)) continue;
      const b = h('button', { role: 'tab', id: 'insp-tab-' + k, 'aria-selected': String(k === this.inspTab), 'aria-controls': 'insp-panel', tabindex: k === this.inspTab ? '0' : '-1', 'data-key': 'tab-' + k }, ic(iconName), h('span', null, t('insp.tab.' + k)));
      b.addEventListener('click', () => { this.inspTab = k; Prefs.set('inspTab', k); this.renderProps(); const nb = $(`#insp-tab-${k}`, this.propsBody); if (nb) nb.focus(); });
      tabList.appendChild(b);
    }
    tabList.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      const i = tabs.indexOf(this.inspTab);
      const n = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1] : tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      this.inspTab = n; Prefs.set('inspTab', n); this.renderProps(); const nb = $(`#insp-tab-${n}`, this.propsBody); if (nb) nb.focus();
    });
    this.propsBody.append(tabList, panel);
    if (this.inspTab === 'video') this.inspVideo(panel, sel);
    else if (this.inspTab === 'color') this.inspColor(panel, sel);
    else if (this.inspTab === 'fx') this.inspFx(panel, sel);
    else this.inspAudio(panel, sel);
    this.inspClip(sel);
    this.propsBody.scrollTop = scroll;
    if (focusKey) { const el = $(`[data-key="${focusKey}"]`, this.propsBody); if (el) el.focus({ preventScroll: true }); }
  },
  syncPropValues() { for (const fn of this._propSync || []) { try { fn(); } catch (e) { ErrLog.add('insp-sync', e); } } },

  /* ======================= Controlli ======================= */
  sec(title, kids, onReset, resetLabel) {
    const head = h('div', { class: 'sec-head' }, h('h3', null, title));
    if (onReset) head.appendChild(h('button', { class: 'btn btn-ghost btn-icon btn-xs', 'aria-label': resetLabel || t('insp.resetSec', { name: title }), 'data-tip': resetLabel || t('insp.reset'), html: icon('refresh'), onclick: onReset }));
    return h('div', { class: 'props-sec' }, head, kids);
  },
  /**
   * Slider con campo numerico e ripristino.
   * o = { key, label, tab, get(c)→valore UI, set(v)→campi, min, max, step, unit, def, hist }
   */
  slider(o) {
    const id = 'f-' + o.key;
    const range = h('input', { type: 'range', class: 'range', id, min: o.min, max: o.max, step: o.step || 1, 'aria-label': o.label, 'data-key': o.key });
    const num = h('input', { type: 'number', class: 'input num tnum', min: o.numMin !== undefined ? o.numMin : o.min, max: o.numMax !== undefined ? o.numMax : o.max, step: o.step || 1, 'aria-label': `${o.label} (${o.unit || ''})`.replace(' ()', ''), 'data-key': o.key + '-n' });
    const unit = h('span', { class: 'unit', 'aria-hidden': 'true' }, o.unit || '');
    const reset = h('button', { class: 'btn btn-ghost btn-icon btn-xs', 'aria-label': t('insp.resetX', { name: o.label }), 'data-tip': t('insp.reset'), html: icon('refresh') });
    const rnd = (v) => Math.round(v / (o.step || 1)) * (o.step || 1);
    const paint = (v) => {
      v = +(+v).toFixed(4);
      if (document.activeElement !== range) range.value = String(v);
      if (document.activeElement !== num) num.value = String(+rnd(v).toFixed(3));
      range.style.setProperty('--p', ((clamp(v, o.min, o.max) - o.min) / (o.max - o.min)) * 100 + '%');
      reset.classList.toggle('invisible', Math.abs(v - o.def) < 1e-9);
    };
    const sync = () => { const c = this.firstFor(o.tab); if (c) paint(o.get(c)); };
    range.addEventListener('input', () => { const v = +range.value; paint(v); this.liveSel(o.set(v)); });
    range.addEventListener('change', () => this.endLive(o.hist));
    num.addEventListener('change', () => {
      const v = parseFloat(String(num.value).replace(',', '.'));
      if (!isFinite(v)) { sync(); return; }
      this.commitSel(o.hist, o.set(clamp(v, o.numMin !== undefined ? o.numMin : o.min, o.numMax !== undefined ? o.numMax : o.max)));
      sync();
    });
    num.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); num.blur(); } });
    reset.addEventListener('click', () => { this.commitSel(o.hist, o.set(o.def)); sync(); });
    const lab = h('label', { for: id, 'data-tip': o.tip || null }, o.label);
    lab.addEventListener('dblclick', () => { this.commitSel(o.hist, o.set(o.def)); sync(); });
    this._propSync.push(sync);
    sync();
    return h('div', { class: 'ctl' }, h('div', { class: 'ctl-head' }, lab, h('span', { class: 'ctl-val' }, num, unit), reset), range);
  },
  switchCtl(key, label, get, onChange) {
    const inp = h('input', { type: 'checkbox', 'data-key': key });
    const sync = () => { const v = get(); if (inp.checked !== v) inp.checked = v; };
    inp.addEventListener('change', () => onChange(inp.checked));
    this._propSync.push(sync); sync();
    return h('label', { class: 'switch' }, inp, h('span', { class: 'track' }), label);
  },
  segCtl(key, label, options, get, onPick) {
    const seg = h('div', { class: 'seg seg-full', role: 'radiogroup', 'aria-label': label });
    options.forEach(([v, l, tip]) => {
      const b = h('button', { role: 'radio', 'aria-checked': 'false', 'data-v': String(v), 'data-key': key + '-' + v, 'data-tip': tip || null }, l);
      b.addEventListener('click', () => onPick(v));
      seg.appendChild(b);
    });
    seg.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      const vals = options.map((x) => String(x[0])); const i = vals.indexOf(String(get()));
      const n = options[(i + (e.key === 'ArrowRight' ? 1 : vals.length - 1)) % vals.length][0];
      onPick(n); setTimeout(() => { const b = $(`[data-key="${key}-${n}"]`, this.propsBody); if (b) b.focus(); }, 0);
    });
    const sync = () => { const cur = String(get()); for (const b of seg.children) b.setAttribute('aria-checked', String(b.dataset.v === cur)); };
    this._propSync.push(sync); sync();
    return seg;
  },

  /* ======================= Scheda Video ======================= */
  inspVideo(panel, sel) {
    const one = sel.length === 1 ? sel[0] : null;
    const tab = 'video';
    const first = () => this.firstFor(tab);
    const kinds = new Set(sel.filter((x) => this.isVisual(x.lane)).map((x) => this.kindOfClip(x.clip)));
    const isText = kinds.size === 1 && kinds.has('text');
    // Testo
    if (isText) this.inspText(panel);
    // Inquadratura (Adatta / Riempi): come prima, per una clip video o immagine
    if (one && this.isVisual(one.lane) && ['video', 'image'].includes(this.kindOfClip(one.clip))) {
      const c = one.clip; const a = this.assetOf(c);
      const f = Engine.FORMATS[this.project.format];
      const mismatch = a && a.width && Math.abs(a.width / a.height - f.w / f.h) > 0.02;
      const kids = [];
      if (!mismatch) kids.push(h('p', { class: 'hint' }, t('props.sameFormat')));
      else {
        kids.push(this.segCtl('fit', t('props.framing'), [['fit', t('props.fit'), t('props.fitTip')], ['fill', t('props.fill'), t('props.fillTip')]], () => (this.findClip(c.id) || one).clip.fit, (v) => this.commitSel(t('h.framing'), { fit: v }, [c.id])));
        if (c.fit === 'fill') {
          const rng = this.panRange(c);
          kids.push(h('p', { class: 'hint' }, t('props.panHint')));
          if (rng && rng.x > 0.005) kids.push(this.slider({ key: 'ox', tab, label: t('props.panX'), min: -100, max: 100, step: 1, unit: '%', def: 0, hist: t('h.pan'), get: () => Math.round(((this.findClip(c.id) || one).clip.ox || 0) * 100), set: (v) => this.vis({ ox: v / 100 }) }));
          if (rng && rng.y > 0.005) kids.push(this.slider({ key: 'oy', tab, label: t('props.panY'), min: -100, max: 100, step: 1, unit: '%', def: 0, hist: t('h.pan'), get: () => Math.round(((this.findClip(c.id) || one).clip.oy || 0) * 100), set: (v) => this.vis({ oy: v / 100 }) }));
        }
      }
      panel.append(this.sec(t('props.framing'), kids));
    }
    // Trasforma
    const tf = (c) => Engine.g(c, 'tf');
    const linked = tf(first()).link;
    const flipBtn = (key, iconName, label, short) => {
      const b = h('button', { class: 'btn btn-sm btn-outline', 'aria-pressed': 'false', 'data-key': 'flip-' + key, 'aria-label': label, 'data-tip': label }, ic(iconName), h('span', null, short));
      b.addEventListener('click', () => { const v = !tf(first())[key]; this.commitSel(t('h.transform'), this.vis({ tf: { [key]: v } })); });
      this._propSync.push(() => { const on = !!tf(first())[key]; b.setAttribute('aria-pressed', String(on)); b.classList.toggle('is-active', on); });
      return b;
    };
    const tfKids = [
      this.slider({ key: 'zx', tab, label: linked ? t('tf.zoom') : t('tf.zoomX'), min: 10, max: 400, numMax: 1000, step: 1, unit: '%', def: 100, hist: t('h.transform'), get: (c) => Math.round(tf(c).zx * 100), set: (v) => this.vis({ tf: { zx: v / 100 } }) }),
    ];
    if (!linked) tfKids.push(this.slider({ key: 'zy', tab, label: t('tf.zoomY'), min: 10, max: 400, numMax: 1000, step: 1, unit: '%', def: 100, hist: t('h.transform'), get: (c) => Math.round(tf(c).zy * 100), set: (v) => this.vis({ tf: { zy: v / 100 } }) }));
    tfKids.push(this.switchCtl('tf-link', t('tf.link'), () => tf(first()).link, (on) => this.commitSel(t('h.transform'), this.vis((c) => ({ tf: { link: on, zy: tf(c).zx } })))));
    tfKids.push(
      this.slider({ key: 'tx', tab, label: t('tf.posX'), min: -100, max: 100, numMin: -300, numMax: 300, step: 0.5, unit: '%', def: 0, hist: t('h.transform'), get: (c) => tf(c).x * 100, set: (v) => this.vis({ tf: { x: v / 100 } }) }),
      this.slider({ key: 'ty', tab, label: t('tf.posY'), min: -100, max: 100, numMin: -300, numMax: 300, step: 0.5, unit: '%', def: 0, hist: t('h.transform'), get: (c) => tf(c).y * 100, set: (v) => this.vis({ tf: { y: v / 100 } }) }),
      this.slider({ key: 'rot', tab, label: t('tf.rot'), min: -180, max: 180, step: 0.5, unit: '°', def: 0, hist: t('h.transform'), get: (c) => tf(c).rot, set: (v) => this.vis({ tf: { rot: v } }) }),
      h('div', { class: 'btn-row' }, flipBtn('flipH', 'flipH', t('tf.flipH'), t('tf.flipHs')), flipBtn('flipV', 'flipV', t('tf.flipV'), t('tf.flipVs'))));
    panel.append(this.sec(t('tf.title'), tfKids, () => this.commitSel(t('h.transformReset'), this.vis({ tf: { ...Engine.DEF.tf } })), t('tf.reset')));
    // Ritaglio
    const cr = (c) => Engine.g(c, 'crop');
    const crop = (k, label) => this.slider({ key: 'crop-' + k, tab, label, min: 0, max: 50, step: 0.5, unit: '%', def: 0, hist: t('h.crop'), get: (c) => cr(c)[k] * 100, set: (v) => this.vis({ crop: { [k]: v / 100 } }) });
    panel.append(this.sec(t('crop.title'), [crop('l', t('crop.l')), crop('r', t('crop.r')), crop('t', t('crop.t')), crop('b', t('crop.b'))], () => this.commitSel(t('h.crop'), this.vis({ crop: { ...Engine.DEF.crop } })), t('crop.reset')));
    // Zoom dinamico
    const dz = (c) => Engine.g(c, 'dz');
    const dzOn = dz(first()).mode !== 'off';
    const dzKids = [this.switchCtl('dz-on', t('dz.on'), () => dz(first()).mode !== 'off', (on) => this.commitSel(t('h.dz'), this.vis({ dz: { mode: on ? 'in' : 'off' } })))];
    if (dzOn) {
      dzKids.push(this.segCtl('dz-mode', t('dz.mode'), [['in', t('dz.in')], ['out', t('dz.out')]], () => dz(first()).mode, (v) => this.commitSel(t('h.dz'), this.vis({ dz: { mode: v } }))));
      dzKids.push(this.slider({ key: 'dz-amt', tab, label: t('dz.amt'), min: 5, max: 60, step: 1, unit: '%', def: 20, hist: t('h.dz'), get: (c) => Math.round(dz(c).amt * 100), set: (v) => this.vis({ dz: { amt: v / 100 } }) }));
    }
    dzKids.push(h('p', { class: 'hint' }, t('dz.hint')));
    panel.append(this.sec(t('dz.title'), dzKids));
    // Composito (V2)
    if (sel.some((x) => x.lane === 'v2')) {
      const cp = (c) => Engine.g(c, 'comp');
      const blendSel = h('select', { class: 'select', 'aria-label': t('comp.blend'), 'data-key': 'comp-blend' });
      for (const b of Engine.BLENDS) blendSel.appendChild(h('option', { value: b }, t('blend.' + b)));
      blendSel.addEventListener('change', () => this.commitSel(t('h.comp'), (c, lane) => (lane === 'v2' ? { comp: { blend: blendSel.value } } : null)));
      this._propSync.push(() => { const c = this.selected().find((x) => x.lane === 'v2'); if (c) blendSel.value = cp(c.clip).blend; });
      panel.append(this.sec(t('comp.title'), [
        this.slider({ key: 'opacity', tab, label: t('comp.opacity'), min: 0, max: 100, step: 1, unit: '%', def: 100, hist: t('h.comp'), get: (c) => Math.round(cp(c).opacity * 100), set: (v) => (c, lane) => (lane === 'v2' ? { comp: { opacity: v / 100 } } : null) }),
        h('label', { class: 'field' }, h('span', { class: 'label' }, t('comp.blend')), blendSel),
      ], () => this.commitSel(t('h.comp'), (c, lane) => (lane === 'v2' ? { comp: { ...Engine.DEF.comp } } : null)), t('comp.reset')));
    }
    // Velocità
    if (sel.some((x) => this.isVisual(x.lane) && this.hasSource(x.clip))) panel.append(this.speedSec());
  },
  speedSec() {
    const cur = () => { const f = this.selected().find((x) => this.hasSource(x.clip)); return f ? f.clip.speed || 1 : 1; };
    const seg = this.segCtl('speed', t('speed.title'), Engine.SPEEDS.map((sp) => [sp, fmtSpeed(sp)]), cur, (v) => this.setSpeed(v));
    seg.classList.add('seg-wrap');
    return this.sec(t('speed.title'), [seg, h('p', { class: 'hint' }, t('speed.hint', { k: `${MOD}+R` }))]);
  },
  inspText(panel) {
    const tx = (c) => Engine.g(c, 'text');
    const first = () => this.firstFor('video');
    const area = h('textarea', { class: 'input text-area', rows: 3, maxlength: 400, 'aria-label': t('text.content'), 'data-key': 'text-content' });
    area.value = tx(first()).content;
    area.addEventListener('input', () => this.liveSel((c) => (Engine.kindOf(c) === 'text' ? { text: { content: area.value } } : null)));
    area.addEventListener('change', () => this.endLive(t('h.text')));
    area.addEventListener('blur', () => this.endLive(t('h.text')));
    this._propSync.push(() => { if (document.activeElement !== area) area.value = tx(first()).content; });
    const color = h('input', { type: 'color', class: 'color-in', 'aria-label': t('text.color'), 'data-key': 'text-color' });
    color.addEventListener('input', () => this.liveSel((c) => (Engine.kindOf(c) === 'text' ? { text: { color: color.value } } : null)));
    color.addEventListener('change', () => this.endLive(t('h.text')));
    this._propSync.push(() => { color.value = tx(first()).color; });
    const onlyText = (f) => (c) => (Engine.kindOf(c) === 'text' ? f : null);
    panel.append(this.sec(t('text.title'), [
      h('label', { class: 'field' }, h('span', { class: 'label' }, t('text.content')), area),
      this.slider({ key: 'text-size', tab: 'video', label: t('text.size'), min: 2, max: 30, step: 0.5, unit: '%', def: 9, hist: t('h.text'), get: (c) => tx(c).size * 100, set: (v) => onlyText({ text: { size: v / 100 } }) }),
      h('div', { class: 'ctl-inline' }, h('label', { class: 'field' }, h('span', { class: 'label' }, t('text.color')), color),
        h('div', { class: 'field' }, h('span', { class: 'label' }, t('text.align')), this.segCtl('text-align', t('text.align'), [['left', t('text.left')], ['center', t('text.center')], ['right', t('text.right')]], () => tx(first()).align, (v) => this.commitSel(t('h.text'), onlyText({ text: { align: v } }))))),
      this.switchCtl('text-bold', t('text.bold'), () => tx(first()).bold, (on) => this.commitSel(t('h.text'), onlyText({ text: { bold: on } }))),
      this.switchCtl('text-bg', t('text.bg'), () => tx(first()).bg, (on) => this.commitSel(t('h.text'), onlyText({ text: { bg: on } }))),
    ]));
  },

  /* ======================= Scheda Colore ======================= */
  inspColor(panel) {
    const tab = 'color';
    const col = (c) => Engine.g(c, 'color');
    const s = (k, label, tip) => this.slider({ key: 'col-' + k, tab, label, tip, min: -100, max: 100, step: 1, unit: '', def: 0, hist: t('h.color'), get: (c) => Math.round(col(c)[k] * 100), set: (v) => this.vis({ color: { [k]: v / 100 } }) });
    const cmp = h('button', { class: 'btn btn-sm btn-outline full', 'aria-pressed': 'false', 'data-key': 'cmp' }, ic('compare'), h('span', null, t('stage.compare')), h('span', { class: 'kbd' }, '⇧ D'));
    cmp.addEventListener('click', () => this.toggleCompare());
    this._cmpSync = () => { if (!document.body.contains(cmp)) return; cmp.setAttribute('aria-pressed', String(this.player.bypass)); cmp.classList.toggle('is-active', this.player.bypass); };
    this._propSync.push(this._cmpSync);
    panel.append(this.sec(t('col.wheels'), [s('lift', t('col.lift'), t('col.liftTip')), s('gamma', t('col.gamma'), t('col.gammaTip')), s('gain', t('col.gain'), t('col.gainTip'))]));
    panel.append(this.sec(t('col.basic'), [s('contrast', t('col.contrast')), s('sat', t('col.sat')), s('temp', t('col.temp'), t('col.tempTip'))]));
    panel.append(h('div', { class: 'props-sec' }, cmp, h('button', { class: 'btn btn-sm btn-ghost full', onclick: () => this.commitSel(t('h.colorReset'), this.vis({ color: { ...Engine.DEF.color } })) }, ic('refresh'), t('col.reset')),
      h('p', { class: 'hint' }, t('col.hint'))));
    this._cmpSync();
  },

  /* ======================= Scheda Effetti ======================= */
  inspFx(panel) {
    const tab = 'fx';
    const fx = (c) => Engine.g(c, 'fx');
    const s = (k, label, tip) => this.slider({ key: 'fx-' + k, tab, label, tip, min: 0, max: 100, step: 1, unit: '%', def: 0, hist: t('h.fx'), get: (c) => Math.round(fx(c)[k] * 100), set: (v) => this.vis({ fx: { [k]: v / 100 } }) });
    panel.append(this.sec(t('fx.title'), [s('blur', t('fx.blur')), s('grain', t('fx.grain'), t('fx.grainTip')), s('vignette', t('fx.vignette'))], () => this.commitSel(t('h.fx'), this.vis({ fx: { ...Engine.DEF.fx } })), t('fx.reset')));
    if (this.selected().some((x) => Engine.kindOf(x.clip) === 'adjust')) panel.append(h('p', { class: 'hint pad' }, t('fx.adjustHint')));
  },

  /* ======================= Scheda Audio ======================= */
  inspAudio(panel, sel) {
    const tab = 'audio';
    const aud = sel.filter(({ clip }) => this.canAudio(clip));
    const first = () => this.firstFor(tab);
    const au = (c) => Engine.g(c, 'audio');
    const maxFade = Math.min(10, Math.max(0.1, Math.min(...aud.map(({ clip }) => Engine.dur(clip)))));
    // compatibilità: riferimenti usati dai test e dal resto dell'editor
    this.clipVol = null; this.muteSw = null;
    const vol = this.slider({ key: 'volume', tab, label: t('props.volume'), min: 0, max: 200, step: 1, unit: '%', def: 100, hist: t('h.volume'), get: (c) => Math.round((c.volume === undefined ? 1 : c.volume) * 100), set: (v) => this.aud({ volume: v / 100 }) });
    this.clipVol = $('input[type=range]', vol);
    const mute = this.switchCtl('mute', t('props.mute'), () => aud.every(({ clip }) => (this.findClip(clip.id) || { clip }).clip.muted), (on) => this.commitSel(on ? t('h.mute') : t('h.unmute'), this.aud({ muted: on })));
    this.muteSw = $('input', mute);
    const notes = [];
    for (const { clip } of aud) { const e = Media.get(clip.assetId); if (e && e.audioState === 'none') { notes.push(t('props.noAudio')); break; } if (e && (e.audioState === 'error' || e.audioState === 'toolarge')) { notes.push(t('props.audioErr')); break; } }
    panel.append(this.sec(t('props.audio'), [vol, mute, notes.length ? h('p', { class: 'hint' }, notes[0]) : null]));
    panel.append(this.sec(t('fade.title'), [
      this.slider({ key: 'fade-in', tab, label: t('fade.in'), min: 0, max: Math.round(maxFade * 10) / 10, step: 0.1, unit: 's', def: 0, hist: t('h.fade'), get: (c) => au(c).fadeIn, set: (v) => this.aud((c) => ({ audio: { fadeIn: Math.min(v, Engine.dur(c)) } })) }),
      this.slider({ key: 'fade-out', tab, label: t('fade.out'), min: 0, max: Math.round(maxFade * 10) / 10, step: 0.1, unit: 's', def: 0, hist: t('h.fade'), get: (c) => au(c).fadeOut, set: (v) => this.aud((c) => ({ audio: { fadeOut: Math.min(v, Engine.dur(c)) } })) }),
    ], () => this.commitSel(t('h.fade'), this.aud({ audio: { fadeIn: 0, fadeOut: 0 } })), t('fade.reset')));
    const eq = h('select', { class: 'select', 'aria-label': t('eq.title'), 'data-key': 'eq' });
    for (const k of Engine.EQ_PRESETS) eq.appendChild(h('option', { value: k }, t('eq.' + k)));
    eq.addEventListener('change', () => this.commitSel(t('h.eq'), this.aud({ audio: { eq: eq.value } })));
    const eqHint = h('p', { class: 'hint' });
    this._propSync.push(() => { const c = first(); if (c) { eq.value = au(c).eq; eqHint.textContent = t('eq.hint.' + au(c).eq); } });
    panel.append(this.sec(t('eq.title'), [eq, eqHint]));
    if (aud.some((x) => x.lane === 'a1')) panel.append(this.speedSec());
    this.syncPropValues();
  },

  /* ======================= Clip: etichetta, stato, azioni ======================= */
  inspClip(sel) {
    const one = sel.length === 1;
    const sw = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': t('label.menu') });
    const cur = () => { const ls = this.selected().map((x) => x.clip.label || ''); return ls.every((v) => v === ls[0]) ? ls[0] : '?'; };
    for (const k of ['', ...Engine.LABELS]) {
      const b = h('button', { role: 'radio', class: 'sw' + (k ? '' : ' none'), style: k ? { '--sw': LABEL_VAR[k] } : null, 'aria-label': k ? t('label.' + k) : t('label.none'), 'data-tip': k ? t('label.' + k) : t('label.none'), 'data-key': 'lbl-' + (k || 'none') }, k ? null : ic('x'));
      b.addEventListener('click', () => this.setLabel(k || null));
      sw.appendChild(b);
    }
    this._propSync.push(() => { const c = cur(); for (const b of sw.children) b.setAttribute('aria-checked', String((b.dataset.key === 'lbl-none' && c === '') || b.dataset.key === 'lbl-' + c)); });
    const dis = this.switchCtl('disabled', t('ed.disableSw'), () => this.selected().every((x) => x.clip.disabled), () => this.toggleDisabled());
    const act = h('div', { class: 'props-actions' },
      one ? h('button', { class: 'btn btn-sm', onclick: () => this.split() }, ic('scissors'), t('ed.splitShort')) : null,
      h('button', { class: 'btn btn-sm', onclick: () => this.duplicateSel() }, ic('copy'), t('ed.duplicate')),
      one ? h('button', { class: 'btn btn-sm', onclick: () => this.copyAttrs() }, ic('clipboard'), t('attr.copyShort')) : null,
      h('button', { class: 'btn btn-sm', disabled: !this.attrClip, onclick: () => this.openPasteAttrs() }, ic('paste'), t('attr.pasteShort')),
      h('button', { class: 'btn btn-sm btn-outline full', style: { color: 'var(--danger)' }, onclick: () => this.deleteSel() }, ic('trash'), sel.length > 1 ? t('ed.deleteN', { n: sel.length }) : t('ed.delete')));
    this.propsBody.append(h('div', { class: 'props-sec' }, h('h3', null, t('props.clip')), h('div', { class: 'field' }, h('span', { class: 'label' }, t('label.menu')), sw), dis),
      h('div', { class: 'props-sec' }, h('h3', null, t('props.actions')), act));
    this.syncPropValues();
  },

  /* ======================= Incolla attributi (Alt+V) ======================= */
  openPasteAttrs() {
    if (!this.attrClip) { Toast.show(t('attr.empty'), { duration: 3000 }); return; }
    if (!this.sel.size) { Toast.show(t('ed.selectFirst'), { duration: 2500 }); return; }
    const defaults = { transform: true, crop: true, color: true, fx: true, composite: true, speed: false, volume: false };
    const boxes = Object.keys(Engine.ATTR).map((g) => {
      const inp = h('input', { type: 'checkbox', checked: defaults[g], 'data-g': g });
      return h('label', { class: 'check' }, inp, h('span', null, h('b', null, t('attr.g.' + g)), h('small', null, t('attr.d.' + g))));
    });
    const all = h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { const v = !boxes.every((b) => $('input', b).checked); for (const b of boxes) $('input', b).checked = v; } }, t('attr.toggleAll'));
    const go = h('button', { class: 'btn btn-primary' }, ic('paste'), t('attr.apply'));
    const m = modal({
      title: t('attr.title'), label: 'pa', desc: t('attr.desc', { name: this.attrClip.name, n: this.sel.size }),
      body: h('div', { class: 'attr-grid' }, boxes, all),
      foot: [h('button', { class: 'btn btn-ghost', onclick: () => m.close() }, t('common.cancel')), go],
    });
    go.addEventListener('click', () => {
      const groups = boxes.map((b) => $('input', b)).filter((i) => i.checked).map((i) => i.dataset.g);
      m.close();
      if (!groups.length) return;
      const attrs = this.attrClip.attrs;
      const ok = this.commit(t('h.paste'), (s) => {
        const out = {};
        for (const lane of ['v1', 'v2', 'a1']) {
          const key = TRACK_KEY[lane];
          const ids = new Set(s[key].filter((c) => this.sel.has(c.id)).map((c) => c.id));
          if (!ids.size) continue;
          // gruppi sensati per traccia: niente trasformazioni sull'audio, niente volume sui titoli
          const gs = groups.filter((g) => (lane === 'a1' ? ['speed', 'volume'].includes(g) : g !== 'composite' || lane === 'v2'));
          const canSpeed = (c) => this.hasSource(c) && (lane === 'v1' || Math.abs(Engine.fitFree(s[key], [c.id], c.start || 0, (c.out - c.in) / (attrs.speed || 1)) - (c.start || 0)) < 1e-6);
          const n = Engine.pasteAttrs(s[key], ids, attrs, gs, canSpeed);
          if (n) out[key] = n;
        }
        return Object.keys(out).length ? out : null;
      });
      Toast.show(ok ? t('attr.pasted', { n: this.sel.size }) : t('attr.nothing'), { type: ok ? 'ok' : 'info', duration: 2500 });
    });
    setTimeout(() => go.focus(), 30);
  },

  /* ======================= Impostazioni progetto ======================= */
  openProjectSettings() {
    const s = this.settings;
    const scaleSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': t('pset.scaling') });
    const paintSeg = () => { for (const b of scaleSeg.children) b.setAttribute('aria-checked', String(b.dataset.v === this.settings.scaling)); };
    for (const [v, l] of [['fit', t('pset.fit')], ['fill', t('pset.fill')]]) {
      const b = h('button', { role: 'radio', 'data-v': v }, l);
      b.addEventListener('click', () => { this.project.settings = { ...this.settings, scaling: v }; this.markDirty(); paintSeg(); });
      scaleSeg.appendChild(b);
    }
    paintSeg();
    const dur = h('input', { type: 'number', class: 'input num-wide', min: 0.5, max: 600, step: 0.5, value: s.imageDur, 'aria-label': t('pset.imageDur') });
    dur.addEventListener('change', () => { const v = clamp(parseFloat(String(dur.value).replace(',', '.')) || 5, 0.5, 600); dur.value = String(v); this.project.settings = { ...this.settings, imageDur: v }; this.markDirty(); });
    const apply = h('button', { class: 'btn btn-sm btn-outline' }, ic('check'), t('pset.applyAll'));
    apply.addEventListener('click', () => {
      const v = this.settings.scaling;
      const ok = this.commit(t('h.scaling'), (st) => {
        const out = {};
        for (const key of ['clips', 'v2']) { const n = Engine.patch(st[key], st[key].filter((c) => Engine.kindOf(c) === 'media').map((c) => c.id), { fit: v }); if (n) out[key] = n; }
        return Object.keys(out).length ? out : null;
      });
      Toast.show(ok ? t('pset.applied') : t('pset.same'), { type: ok ? 'ok' : 'info', duration: 2500 });
    });
    const row = (title, hint, ctl) => h('div', { class: 'set-row' }, h('div', null, h('b', null, title), h('span', null, hint)), ctl);
    const m = modal({
      title: t('pset.title'), label: 'ps', desc: t('pset.desc'),
      body: h('div', { class: 'set-list' },
        row(t('pset.scaling'), t('pset.scalingHint'), h('div', { class: 'set-ctl' }, scaleSeg, apply)),
        row(t('pset.imageDur'), t('pset.imageDurHint'), h('div', { class: 'set-ctl' }, dur, h('span', { class: 'muted' }, 's'))),
        row(t('pset.fps'), t('pset.fpsHint'), h('span', { class: 'badge' }, `${this.project.fps || 30} fps`))),
      foot: h('button', { class: 'btn btn-primary', onclick: () => m.close() }, t('common.done')),
    });
  },
});
