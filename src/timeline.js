'use strict';
/* =========================================================================
   timeline.js — timeline multitraccia dell'editor (metodi di Editor).
   Tracce: V2 (sovrapposizione), V1 (sequenza con ripple), A1 (audio).
   Strumenti: A Puntatore, B Lametta, T Slip, N Aggancio, M Marker.
   ========================================================================= */
const LABEL_VAR = { red: 'var(--danger)', amber: 'var(--warning)', green: 'var(--success)', violet: 'var(--accent)', lilac: 'var(--accent-2)', grey: 'var(--text-3)' };
const LANES = ['v2', 'v1', 'a1'];

Object.assign(Editor.prototype, {
  /* ======================= Costruzione ======================= */
  buildTimeline() {
    const btn = (name, label, key, fn, tour) => h('button', { class: 'btn btn-ghost btn-sm', 'aria-label': label, 'data-tip': label, 'data-key': key, 'data-tour': tour, onclick: fn }, ic(name), h('span', { class: 'lbl' }, label.split(' ')[0]));
    // strumenti (radio): Puntatore, Lametta, Slip
    this.toolSeg = h('div', { class: 'group tools', role: 'radiogroup', 'aria-label': t('tool.group') });
    for (const [k, iconName, key] of [['pointer', 'pointer', 'A'], ['blade', 'blade', 'B'], ['slip', 'slip', 'T']]) {
      const b = h('button', { class: 'btn btn-ghost btn-icon btn-sm', role: 'radio', 'aria-checked': String(this.tool === k), 'data-tool': k, 'aria-label': t('tool.' + k), 'data-tip': t('tool.' + k + 'Tip'), 'data-key': key, html: icon(iconName) });
      b.addEventListener('click', () => this.setTool(k));
      this.toolSeg.appendChild(b);
    }
    this.toolSeg.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      const ks = ['pointer', 'blade', 'slip']; const i = ks.indexOf(this.tool);
      const n = ks[(i + (e.key === 'ArrowRight' ? 1 : 2)) % 3]; this.setTool(n); $(`[data-tool="${n}"]`, this.toolSeg).focus();
    });
    this.splitBtn = btn('scissors', t('ed.split'), 'S', () => this.split(), 'split');
    this.delBtn = btn('trash', t('ed.delete'), t('key.del'), () => this.deleteSel());
    this.dupBtn = btn('copy', t('ed.duplicate'), `${MOD} D`, () => this.duplicateSel());
    this.snapBtn = h('button', { class: 'btn btn-ghost btn-sm', 'aria-pressed': 'true', 'data-tip': t('ed.snapTip'), 'data-key': 'N', onclick: () => this.toggleSnap() }, ic('magnet'), h('span', null, t('ed.snap')));
    const mkBtn = h('button', { class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': t('mk.add'), 'data-tip': t('mk.add'), 'data-key': 'M', html: icon('flag'), onclick: () => this.addMarker() });
    const textBtn = btn('type', t('ed.addText'), null, () => this.addSynthetic('text'));
    const adjBtn = btn('adjust', t('ed.addAdjust'), null, () => this.addSynthetic('adjust'));
    this.zoomRange = h('input', { type: 'range', class: 'range', min: 0, max: 100, step: 0.5, 'aria-label': t('ed.zoom') });
    this.zoomRange.addEventListener('input', () => this.setZoom(this.sliderToPps(+this.zoomRange.value)));
    const zb = (name, label, key, fn) => h('button', { class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': label, 'data-tip': label, 'data-key': key, html: icon(name), onclick: fn });
    const bar = h('div', { class: 'tl-bar' },
      this.toolSeg,
      h('div', { class: 'group' }, this.splitBtn, this.delBtn, this.dupBtn),
      h('div', { class: 'group' }, this.snapBtn, mkBtn),
      h('div', { class: 'group' }, textBtn, adjBtn),
      this.tipSlot = h('div', { class: 'tip-slot' }),
      h('div', { class: 'zoom' }, zb('zoomOut', t('ed.zoomOut'), '−', () => this.zoomBy(1 / 1.4)), this.zoomRange, zb('zoomIn', t('ed.zoomIn'), '+', () => this.zoomBy(1.4))),
      zb('fit', t('ed.zoomFit'), null, () => this.zoomFit()));
    this.rulerCanvas = h('canvas', { 'aria-hidden': 'true' });
    this.ruler = h('div', { class: 'tl-ruler', 'aria-label': t('ed.ruler') }, this.rulerCanvas);
    this.tlEmpty = h('div', { class: 'tl-empty' }, t('ed.tlEmpty'));
    // V1 per prima nel DOM: ordine di tabulazione e lettori di schermo partono dalla traccia principale
    this.tracks = {};
    const mkLane = (id, label) => h('div', { class: 'tl-track lane-' + id, role: 'list', 'aria-label': label, 'data-lane': id }, h('div', { class: 'lane' }));
    this.tracks.v1 = mkLane('v1', t('ed.track')); this.tracks.v1.appendChild(this.tlEmpty);
    this.tracks.v2 = mkLane('v2', t('lane.v2'));
    this.tracks.a1 = mkLane('a1', t('lane.a1'));
    this.track = this.tracks.v1;
    this.lanesEl = h('div', { class: 'tl-lanes' }, this.tracks.v1, this.tracks.v2, this.tracks.a1);
    this.markersEl = h('div', { class: 'tl-markers' });
    this.playhead = h('div', { class: 'playhead' }, h('div', { class: 'knob', role: 'slider', tabindex: '-1', 'aria-label': t('ed.playhead') }));
    this.insertMark = h('div', { class: 'insert-mark hidden' });
    this.bladeLine = h('div', { class: 'blade-line hidden', 'aria-hidden': 'true' });
    this.tlInner = h('div', { class: 'tl-inner' }, this.ruler, this.lanesEl, this.markersEl, this.playhead, this.insertMark, this.bladeLine);
    this.tlScroll = h('div', { class: 'tl-scroll', 'data-tool': this.tool }, this.tlInner);
    const head = (id, iconName, title) => h('div', { class: 'th th-' + id, title }, ic(iconName), h('b', null, id.toUpperCase()));
    const heads = h('div', { class: 'tl-heads', 'aria-hidden': 'true' }, h('div', { class: 'th th-ruler' }, ic('clock')), head('v2', 'layers', t('lane.v2')), head('v1', 'film', t('ed.track')), head('a1', 'music', t('lane.a1')));
    this.tlBody = h('div', { class: 'tl-body' }, heads, this.tlScroll);
    this.tlScroll.addEventListener('scroll', () => this.onTlScroll(), { passive: true });
    this.tlScroll.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.tlScroll.addEventListener('pointerdown', (e) => this.onTlPointerDown(e));
    this.tlScroll.addEventListener('pointermove', (e) => this.onTlHover(e));
    this.tlScroll.addEventListener('pointerleave', () => this.bladeLine.classList.add('hidden'));
    this.tlScroll.addEventListener('contextmenu', (e) => this.onTlContext(e));
    return h('section', { class: 'pane ed-tl', 'data-tour': 'timeline', 'aria-label': t('ed.timeline') }, bar, this.tlBody);
  },

  /* ======================= Strumenti ======================= */
  setTool(k) {
    if (this.tool === k) return;
    this.tool = k;
    this.renderTools();
    this.bladeLine.classList.add('hidden');
    Toast.show(t('tool.on', { name: t('tool.' + k) }), { duration: 1500 });
  },
  renderTools() {
    if (!this.toolSeg) return;
    for (const b of this.toolSeg.children) b.setAttribute('aria-checked', String(b.dataset.tool === this.tool));
    this.tlScroll.dataset.tool = this.tool;
  },
  renderSnap() {
    this.snapBtn.setAttribute('aria-pressed', String(this.settings.snapping));
    this.snapBtn.classList.toggle('is-active', this.settings.snapping);
  },
  toggleSnap() {
    this.project.settings = { ...this.project.settings, snapping: !this.project.settings.snapping };
    this.renderSnap();
    Toast.show(this.project.settings.snapping ? t('ed.snapOn') : t('ed.snapOff'), { duration: 2000 });
    this.markDirty();
  },

  /* ======================= Zoom e coordinate ======================= */
  sliderToPps(v) { const mn = this.minPps(); return mn * Math.pow(MAX_PPS / mn, v / 100); },
  ppsToSlider(p) { const mn = this.minPps(); return (Math.log(p / mn) / Math.log(MAX_PPS / mn)) * 100; },
  fitPps() { const w = this.tlScroll.clientWidth - TL_PAD * 2 - 40; return this.total > 0 ? clamp(w / this.total, 0.5, MAX_PPS) : 60; },
  minPps() { return Math.max(0.5, Math.min(this.fitPps(), 20)); },
  setZoom(pps, anchorX) {
    const sc = this.tlScroll;
    const ax = anchorX !== undefined ? anchorX : clamp(TL_PAD + this.t * this.pps - sc.scrollLeft, 0, sc.clientWidth);
    const tAnchor = (ax + sc.scrollLeft - TL_PAD) / this.pps;
    this.pps = clamp(pps, this.minPps(), MAX_PPS);
    this.renderTimeline();
    sc.scrollLeft = Math.max(0, TL_PAD + tAnchor * this.pps - ax);
    this.drawRuler(); this.drawStrips();
  },
  zoomBy(f) { this.setZoom(this.pps * f); },
  zoomFit() { this.pps = this.fitPps(); this.renderTimeline(); this.tlScroll.scrollLeft = 0; this.drawRuler(); this.drawStrips(); },
  onWheel(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const r = this.tlScroll.getBoundingClientRect();
      this.setZoom(this.pps * Math.pow(1.0018, -e.deltaY), e.clientX - r.left);
    } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.shiftKey) {
      e.preventDefault();
      this.tlScroll.scrollLeft += e.deltaY;
    }
  },
  onTlScroll() { cancelAnimationFrame(this._scrollRaf); this._scrollRaf = requestAnimationFrame(() => { this.drawRuler(); this.drawStrips(); }); },
  xOf(t) { return TL_PAD + t * this.pps; },
  tOfClientX(cx) { const r = this.tlScroll.getBoundingClientRect(); return (cx - r.left + this.tlScroll.scrollLeft - TL_PAD) / this.pps; },
  laneOfEl(el) { const tr = el && el.closest && el.closest('.tl-track'); return tr ? tr.dataset.lane : null; },
  /** Traccia sotto la coordinata verticale (la più vicina). */
  laneAt(cy) {
    let best = 'v1'; let bd = Infinity;
    for (const id of LANES) { const r = this.tracks[id].getBoundingClientRect(); const d = cy < r.top ? r.top - cy : cy > r.bottom ? cy - r.bottom : 0; if (d < bd) { bd = d; best = id; } }
    return best;
  },

  /* ======================= Disegno ======================= */
  clipName(c) {
    const k = Engine.kindOf(c);
    if (k === 'text') return (Engine.g(c, 'text').content || '').split('\n')[0] || t('clip.text');
    if (k === 'adjust') return t('clip.adjust');
    const a = this.assetOf(c); return a ? a.name : '';
  },
  /** Posizioni di tutte le clip: id → { lane, start, end, clip, index }. */
  layoutAll() {
    const m = new Map();
    Engine.layout(this.clips).forEach(({ clip, start, end }, index) => m.set(clip.id, { lane: 'v1', start, end, clip, index }));
    for (const lane of ['v2', 'a1']) this.trackClips(lane).forEach((clip, index) => m.set(clip.id, { lane, start: clip.start || 0, end: Engine.endOf(clip), clip, index }));
    return m;
  },
  renderTimeline(soft) {
    if (!this.tlScroll) return;
    const sc = this.tlScroll;
    if (soft && this._lastW === sc.clientWidth) return;
    this._lastW = sc.clientWidth;
    const total = this.total;
    this.tlInner.style.width = Math.max(sc.clientWidth, TL_PAD * 2 + total * this.pps + 240) + 'px';
    this.zoomRange.value = String(this.ppsToSlider(this.pps));
    this.zoomRange.style.setProperty('--p', this.zoomRange.value + '%');
    this.tlEmpty.classList.toggle('hidden', this.clips.length > 0);
    const keep = new Set();
    const all = this.layoutAll();
    const n1 = this.clips.length;
    for (const [id, info] of all) {
      keep.add(id);
      const { clip, start, end, lane, index } = info;
      let ref = this.clipEls.get(id);
      if (ref && ref.lane !== lane) { ref.el.remove(); ref = null; }
      if (!ref) { ref = this.makeClipEl(clip, lane); this.clipEls.set(id, ref); this.tracks[lane].appendChild(ref.el); }
      ref.clip = clip; ref.start = start;
      const kind = this.kindOfClip(clip);
      ref.el.className = 'clip k-' + kind + (this.sel.has(id) ? ' sel' : '') + (clip.disabled ? ' disabled' : '');
      ref.el.style.left = this.xOf(start) + 'px';
      ref.el.style.width = Math.max(4, (end - start) * this.pps) + 'px';
      const e = clip.assetId ? Media.get(clip.assetId) : null;
      ref.el.classList.toggle('missing', !!(e && e.status === 'missing'));
      if (clip.label) { ref.el.dataset.label = clip.label; ref.el.style.setProperty('--lbl', LABEL_VAR[clip.label]); } else { delete ref.el.dataset.label; ref.el.style.removeProperty('--lbl'); }
      const name = this.clipName(clip);
      ref.name.textContent = name;
      ref.dur.textContent = fmtDur(end - start) + ((clip.speed || 1) !== 1 ? ' · ' + fmtSpeed(clip.speed) : '');
      ref.mute.classList.toggle('hidden', !clip.muted || kind === 'image' || kind === 'text' || kind === 'adjust');
      ref.fx.classList.toggle('hidden', !(Engine.colorOn(clip) || Engine.fxOn(clip)));
      const parts = [];
      if (lane === 'v1') parts.push(t('clip.label', { i: index + 1, n: n1, name, dur: fmtDur(end - start) }));
      else parts.push(t('clip.labelLane', { lane: lane.toUpperCase(), name, dur: fmtDur(end - start), at: fmtTime(start) }));
      if (this.sel.has(id)) parts.push(t('clip.selected'));
      if (clip.muted && (kind === 'video' || kind === 'audio')) parts.push(t('clip.muted'));
      if (clip.disabled) parts.push(t('clip.disabled'));
      ref.el.setAttribute('aria-label', parts.join(', '));
      ref.el.setAttribute('aria-selected', String(this.sel.has(id)));
      this.renderClipMarkers(ref);
      ref.drawn = null;
    }
    for (const [id, ref] of this.clipEls) if (!keep.has(id)) { ref.el.remove(); this.clipEls.delete(id); }
    // ordine DOM = ordine timeline (navigazione da tastiera coerente)
    for (const [id, info] of all) { const ref = this.clipEls.get(id); if (ref && ref.el.parentNode === this.tracks[info.lane]) this.tracks[info.lane].appendChild(ref.el); }
    this.renderMarkers();
    this.updatePlayhead();
    this.drawRuler();
    this.drawStrips();
  },
  makeClipEl(clip, lane) {
    const strip = h('canvas', { class: 'strip' });
    const name = h('span'); const dur = h('em'); const mute = ic('mute'); const fx = ic('palette');
    const marks = h('div', { class: 'cmks' });
    const el = h('div', { class: 'clip', tabindex: '0', role: 'listitem', 'data-clip': clip.id },
      strip, marks, h('div', { class: 'cl-label' }, mute, fx, name, dur), h('div', { class: 'h l', 'data-h': 'in', 'aria-hidden': 'true' }), h('div', { class: 'h r', 'data-h': 'out', 'aria-hidden': 'true' }));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const r = el.getBoundingClientRect(); if (!this.sel.has(el.dataset.clip)) this.select([el.dataset.clip]); this.clipMenu(r.left + 20, r.top + 20, el); }
      if (e.key === 'Enter') { e.preventDefault(); this.select([el.dataset.clip]); this.seek(this.startOfClip(el.dataset.clip)); }
    });
    return { el, strip, name, dur, mute, fx, marks, clip, lane };
  },
  /** Marker della clip (in tempo sorgente: seguono la clip quando la sposti). */
  renderClipMarkers(ref) {
    const c = ref.clip; const list = Array.isArray(c.markers) ? c.markers : [];
    const sig = list.map((m) => `${m.id}:${m.at}:${m.color}`).join() + `|${c.in}|${c.out}|${c.speed}|${this.pps}`;
    if (ref.mkSig === sig) return;
    ref.mkSig = sig;
    ref.marks.textContent = '';
    for (const m of list) {
      if (m.at < c.in - 1e-6 || m.at > c.out + 1e-6) continue;
      const x = ((m.at - c.in) / (c.speed || 1)) * this.pps;
      const b = h('button', { class: 'cmk', style: { left: x + 'px', '--mk': LABEL_VAR[m.color] }, 'aria-label': t('mk.clipLabel', { t: fmtTime(m.at) }), 'data-tip': t('mk.clipLabel', { t: fmtTime(m.at) }), tabindex: '-1' });
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => { e.stopPropagation(); this.seek(this.startOfClip(c.id) + (m.at - c.in) / (c.speed || 1)); });
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); this.markerMenu({ clipId: c.id, id: m.id }, e.clientX, e.clientY); });
      ref.marks.appendChild(b);
    }
  },
  /** Marker della timeline sul righello. */
  renderMarkers() {
    this.markersEl.textContent = '';
    for (const m of this.project.markers || []) {
      const b = h('button', { class: 'mk', style: { left: this.xOf(m.t) + 'px', '--mk': LABEL_VAR[m.color] }, 'aria-label': t('mk.label', { t: fmtTime(m.t), name: m.name || t('label.' + m.color) }), 'data-tip': m.name || t('mk.label', { t: fmtTime(m.t), name: t('label.' + m.color) }) });
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', () => { if (this.player.playing) this.player.pause(); this.seek(m.t); });
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); this.markerMenu({ id: m.id }, e.clientX, e.clientY); });
      b.addEventListener('keydown', (e) => { if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10') || e.key === 'Delete') { e.preventDefault(); e.stopPropagation(); if (e.key === 'Delete') this.removeMarker({ id: m.id }); else { const r = b.getBoundingClientRect(); this.markerMenu({ id: m.id }, r.left, r.bottom + 4, b); } } });
      this.markersEl.appendChild(b);
    }
  },
  /** Disegna miniature e forma d'onda solo nella parte visibile di ogni clip. */
  drawStrips() {
    if (!this.tlScroll) return;
    const sc = this.tlScroll; const vx0 = sc.scrollLeft - 100; const vx1 = sc.scrollLeft + sc.clientWidth + 100;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const ref of this.clipEls.values()) {
      const c = ref.clip; const st = ref.start;
      if (st === undefined) continue;
      const H = ref.el.clientHeight;
      const x0 = this.xOf(st); const w = Engine.dur(c) * this.pps;
      const a = Math.max(x0, vx0); const b = Math.min(x0 + w, vx1);
      if (b <= a || H <= 0) { ref.strip.style.display = 'none'; continue; }
      const segL = a - x0; const segW = b - a;
      const kind = this.kindOfClip(c);
      const e = c.assetId ? Media.get(c.assetId) : null;
      const au = Engine.g(c, 'audio');
      const key = `${segL|0}|${segW|0}|${H}|${this.pps}|${c.in}|${c.out}|${c.speed}|${c.muted}|${c.volume}|${au.fadeIn}|${au.fadeOut}|${ref.lane}|${e ? e.thumbs.length : 0}|${e && e.peaks ? 1 : 0}`;
      ref.strip.style.display = 'block';
      if (ref.drawn === key) continue;
      ref.drawn = key;
      const cv = ref.strip;
      cv.style.left = segL + 'px'; cv.style.width = segW + 'px'; cv.style.height = H + 'px';
      cv.width = Math.max(1, Math.round(segW * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, segW, H);
      if (!e || kind === 'text' || kind === 'adjust') continue;
      const audioLane = ref.lane === 'a1';
      const hasWave = e.peaks && e.peaks.length && kind !== 'image';
      const thH = audioLane ? 0 : hasWave ? Math.round(H * 0.64) : H;
      const sp = c.speed || 1;
      if (!audioLane && e.thumbs.length) {
        const th0 = e.thumbs[0]; const tw = Math.max(24, (thH * th0.width) / th0.height);
        const startTile = Math.floor(segL / tw);
        for (let x = startTile * tw - segL; x < segW; x += tw) {
          const local = (segL + x + tw / 2) / this.pps;
          const srcT = c.in + local * sp;
          let bi = 0; let bd = Infinity;
          for (let i = 0; i < e.thumbTimes.length; i++) { const d = Math.abs(e.thumbTimes[i] - srcT); if (d < bd) { bd = d; bi = i; } }
          const img = e.thumbs[bi] || th0;
          g.globalAlpha = 0.92; g.drawImage(img, x, 0, tw, thH); g.globalAlpha = 1;
        }
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, segW, 22);
      }
      if (hasWave) {
        const top = audioLane ? 18 : thH;
        g.fillStyle = audioLane ? 'rgba(4,20,14,0.35)' : 'rgba(10,6,28,0.55)'; g.fillRect(0, top, segW, H - top);
        const mid = top + (H - top) / 2; const amp = (H - top) / 2 - 3;
        g.fillStyle = c.muted ? 'rgba(255,255,255,0.25)' : audioLane ? 'rgba(225,255,240,0.92)' : 'rgba(225,215,255,0.9)';
        const pps2 = e.pps || 100;
        for (let x = 0; x < segW; x += 2) {
          const t0 = c.in + ((segL + x) / this.pps) * sp; const t1 = c.in + ((segL + x + 2) / this.pps) * sp;
          const i0 = Math.floor(t0 * pps2); const i1 = Math.max(i0 + 1, Math.ceil(t1 * pps2));
          let m = 0; for (let i = i0; i < i1 && i < e.peaks.length; i++) if (e.peaks[i] > m) m = e.peaks[i];
          const lt = (segL + x) / this.pps;
          const hh = Math.max(1, Math.min(1, m * Engine.gainAt(c, lt)) * amp);
          g.fillRect(x, mid - hh, 1.4, hh * 2);
        }
        // dissolvenze: rampe visibili sulla forma d'onda
        const D = Engine.dur(c);
        const ramp = (from, to, up) => {
          const xa = from * this.pps - segL; const xb = to * this.pps - segL;
          if (xb < 0 || xa > segW) return;
          g.fillStyle = 'rgba(0,0,0,0.38)'; g.beginPath();
          if (up) { g.moveTo(xa, top); g.lineTo(xb, top); g.lineTo(xa, H); } else { g.moveTo(xa, top); g.lineTo(xb, top); g.lineTo(xb, H); }
          g.closePath(); g.fill();
          g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1.5; g.beginPath();
          if (up) { g.moveTo(xa, H); g.lineTo(xb, top); } else { g.moveTo(xa, top); g.lineTo(xb, H); }
          g.stroke();
        };
        if (au.fadeIn > 0) ramp(0, Math.min(D, au.fadeIn), true);
        if (au.fadeOut > 0) ramp(Math.max(0, D - au.fadeOut), D, false);
      }
    }
  },
  drawRuler() {
    const sc = this.tlScroll; const cv = this.rulerCanvas;
    const w = sc.clientWidth; const hh = 30; const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.style.left = sc.scrollLeft + 'px'; cv.style.width = w + 'px';
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = hh * dpr; }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hh);
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];
    const major = steps.find((s) => s * this.pps >= 84) || 1200;
    const minor = major * this.pps / 5 >= 10 ? major / 5 : major / 2;
    const css = getComputedStyle(this.root);
    g.strokeStyle = css.getPropertyValue('--ruler-tick').trim() || '#888';
    g.fillStyle = css.getPropertyValue('--text-3').trim() || '#888';
    g.font = `600 11px ${css.fontFamily}`;
    const t0 = Math.max(0, (sc.scrollLeft - TL_PAD) / this.pps); const t1 = (sc.scrollLeft + w - TL_PAD) / this.pps;
    g.beginPath();
    for (let tt = Math.floor(t0 / minor) * minor; tt <= t1 + minor; tt += minor) {
      const x = TL_PAD + tt * this.pps - sc.scrollLeft;
      const isMajor = Math.abs(tt / major - Math.round(tt / major)) < 1e-6;
      g.moveTo(Math.round(x) + 0.5, isMajor ? 14 : 22); g.lineTo(Math.round(x) + 0.5, 30);
      if (isMajor) g.fillText(major < 1 ? fmtTime(Math.round(tt * 10) / 10).replace(/0$/, '') : fmtTime(Math.round(tt), false), x + 4, 11);
    }
    g.stroke();
  },
  updatePlayhead() {
    if (!this.playhead) return;
    this.playhead.style.left = this.xOf(this.t) + 'px';
    const knob = this.playhead.firstChild;
    knob.setAttribute('aria-valuenow', String(Math.round(this.t * 100) / 100));
    knob.setAttribute('aria-valuetext', fmtTime(this.t));
  },
  followPlayhead() {
    if (!this.player || !this.player.playing) return;
    const sc = this.tlScroll; const x = this.xOf(this.t);
    if (x > sc.scrollLeft + sc.clientWidth - 30 || x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - sc.clientWidth * 0.15);
  },

  /* ======================= Selezione e aggancio ======================= */
  select(ids) { this.sel = new Set(ids); this.renderTimeline(); this.renderProps(); this.renderHistoryButtons(); },
  /** Tempi dei marker (timeline e clip) in secondi di timeline. */
  markerTimes() {
    const out = (this.project.markers || []).map((m) => m.t);
    for (const info of this.layoutAll().values()) {
      const c = info.clip; if (!Array.isArray(c.markers)) continue;
      for (const m of c.markers) if (m.at >= c.in - 1e-6 && m.at <= c.out + 1e-6) out.push(info.start + (m.at - c.in) / (c.speed || 1));
    }
    return out;
  },
  /** Bersagli dell'aggancio: bordi delle clip di tutte le tracce e marker (esclusi gli id indicati). */
  edgeTimes(skip) {
    const sk = skip instanceof Set ? skip : new Set(skip || []);
    const s = [0];
    for (const info of this.layoutAll().values()) { if (sk.has(info.clip.id)) continue; s.push(info.start, info.end); }
    return s.concat(this.markerTimes());
  },
  snapT(tt, skip, withHead = true, px = SNAP_PX) {
    if (!this.settings.snapping) return tt;
    const tg = this.edgeTimes(skip); if (withHead) tg.push(this.t);
    return Engine.snap(tt, tg, px / this.pps);
  },

  /* ======================= Interazioni ======================= */
  onTlPointerDown(e) {
    if (e.button !== 0) return;
    if (e.target.closest('.mk, .cmk')) return;
    const handle = e.target.closest('.h');
    const clipEl = e.target.closest('.clip');
    if (clipEl && this.tool === 'blade') return this.bladeAt(e, clipEl.dataset.clip);
    if (handle && clipEl) return this.startTrim(e, clipEl.dataset.clip, handle.dataset.h);
    if (clipEl && this.tool === 'slip') return this.startSlip(e, clipEl.dataset.clip);
    if (clipEl) return this.startClipPress(e, clipEl.dataset.clip);
    // righello, cursore o spazio vuoto: sposta il cursore
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey && this.sel.size && !e.target.closest('.tl-ruler') && !e.target.closest('.knob')) this.select([]);
    this.startScrub(e);
  },
  /** Lametta: linea di taglio che segue il mouse sopra le clip. */
  onTlHover(e) {
    if (this.tool !== 'blade' || e.buttons) { if (this.tool !== 'blade') this.bladeLine.classList.add('hidden'); return; }
    const clipEl = e.target.closest && e.target.closest('.clip');
    if (!clipEl) { this.bladeLine.classList.add('hidden'); return; }
    const tt = this.snapT(this.tOfClientX(e.clientX), null, true, SNAP_PX * 0.7);
    const lr = clipEl.getBoundingClientRect(); const ir = this.tlInner.getBoundingClientRect();
    Object.assign(this.bladeLine.style, { left: this.xOf(tt) + 'px', top: (lr.top - ir.top) + 'px', height: lr.height + 'px' });
    this.bladeLine.classList.remove('hidden');
  },
  bladeAt(e, id) {
    if (this.player.playing) this.player.pause();
    const tt = this.snapT(this.tOfClientX(e.clientX), null, true, SNAP_PX * 0.7);
    if (this.splitClipAt(id, tt)) { this.bladeLine.classList.add('hidden'); Tips.show(this.tipSlot, 'blade', t('tip.blade')); }
  },
  startScrub(e) {
    if (!this.hasClips()) return;
    if (this.player.playing) this.player.pause();
    const move = (ev) => {
      let tt = clamp(this.tOfClientX(ev.clientX), 0, this.total);
      if (this.settings.snapping && !ev.altKey) tt = Engine.snap(tt, this.edgeTimes(), SNAP_PX / this.pps);
      this.autoScroll(ev.clientX);
      this.seek(tt);
    };
    move(e);
    this.capture(e, move, () => {});
  },
  capture(e, onMove, onUp) {
    const target = this.tlScroll;
    try { target.setPointerCapture(e.pointerId); } catch {}
    const mv = (ev) => onMove(ev);
    const up = (ev) => { target.removeEventListener('pointermove', mv); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up); try { target.releasePointerCapture(e.pointerId); } catch {} onUp(ev); };
    target.addEventListener('pointermove', mv); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up);
  },
  autoScroll(cx) {
    const r = this.tlScroll.getBoundingClientRect();
    if (cx > r.right - 40) this.tlScroll.scrollLeft += 18; else if (cx < r.left + 40) this.tlScroll.scrollLeft -= 18;
  },
  /** Clic e trascinamento di una clip: V1 si riordina, V2/A1 si spostano nel tempo. */
  startClipPress(e, id) {
    const sx = e.clientX; const sy = e.clientY;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    let dragging = false;
    const ref = this.clipEls.get(id);
    const f = this.findClip(id);
    if (!ref || !f) return;
    ref.el.focus({ preventScroll: true });
    const free = f.lane !== 'v1';
    let fm = null; // stato dello spostamento libero
    const onMove = (ev) => {
      if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 5) {
        dragging = true;
        if (!this.sel.has(id)) this.select([id]);
        if (this.player.playing) this.player.pause();
        if (free) {
          const ids = this.trackClips(f.lane).filter((c) => this.sel.has(c.id)).map((c) => c.id);
          fm = { ids, starts: new Map(ids.map((x) => [x, this.findClip(x).clip.start || 0])), delta: 0, ok: true };
          for (const x of ids) this.clipEls.get(x).el.classList.add('moving');
        } else {
          const ids = this.clips.filter((c) => this.sel.has(c.id));
          const label = ids.length > 1 ? t('ed.clipsN', { n: ids.length }) : this.clipName(ids[0]);
          this.ghost = h('div', { class: 'drag-ghost', style: { width: clamp(ids.reduce((s, c) => s + Engine.dur(c), 0) * this.pps, 70, 280) + 'px' } }, label);
          document.body.appendChild(this.ghost);
          for (const c of ids) this.clipEls.get(c.id).el.classList.add('dragging');
        }
      }
      if (!dragging) return;
      this.autoScroll(ev.clientX);
      if (free) {
        const arr = this.trackClips(f.lane);
        let delta = (ev.clientX - sx) / this.pps;
        const minStart = Math.min(...fm.starts.values());
        delta = Math.max(delta, -minStart);
        if (this.settings.snapping && !ev.altKey) {
          const c = f.clip; const s0 = fm.starts.get(id) + delta; const e0 = s0 + Engine.dur(c);
          const tg = this.edgeTimes(fm.ids); tg.push(this.t);
          const ss = Engine.snap(s0, tg, SNAP_PX / this.pps); const se = Engine.snap(e0, tg, SNAP_PX / this.pps);
          if (ss !== s0 && (se === e0 || Math.abs(ss - s0) <= Math.abs(se - e0))) delta += ss - s0; else if (se !== e0) delta += se - e0;
          delta = Math.max(delta, -minStart);
        }
        fm.delta = delta;
        fm.ok = Math.abs(delta) < 1e-6 || !!Engine.moveFree(arr, fm.ids, delta);
        for (const x of fm.ids) { const r2 = this.clipEls.get(x); r2.el.style.left = this.xOf(fm.starts.get(x) + delta) + 'px'; r2.el.classList.toggle('invalid', !fm.ok); }
        this.showTimeTip(this.xOf(fm.starts.get(id) + delta), fmtTime(fm.starts.get(id) + delta));
      } else {
        this.ghost.style.left = ev.clientX + 12 + 'px'; this.ghost.style.top = ev.clientY - 28 + 'px';
        this.showGap(Engine.gapAt(this.clips, this.tOfClientX(ev.clientX)));
      }
    };
    const onUp = (ev) => {
      if (dragging && free) {
        this.hideTimeTip();
        for (const x of fm.ids) { const r2 = this.clipEls.get(x); if (r2) r2.el.classList.remove('moving', 'invalid'); }
        const key = TRACK_KEY[f.lane];
        const ok = fm.ok && this.commit(fm.ids.length > 1 ? t('h.moveMany', { n: fm.ids.length }) : t('h.move'), (s) => { const n = Engine.moveFree(s[key], fm.ids, fm.delta); return n ? { [key]: n } : null; });
        if (!ok) { this.renderTimeline(); if (!fm.ok) Toast.show(t('ed.noRoom'), { duration: 2500 }); }
      } else if (dragging) {
        const gap = Engine.gapAt(this.clips, this.tOfClientX(ev.clientX));
        this.ghost.remove(); this.ghost = null; this.insertMark.classList.add('hidden');
        for (const r of this.clipEls.values()) r.el.classList.remove('dragging');
        const ids = this.clips.filter((c) => this.sel.has(c.id)).map((c) => c.id);
        const ok = this.commit(ids.length > 1 ? t('h.moveMany', { n: ids.length }) : t('h.move'), (s) => { const n = Engine.move(s.clips, ids, gap); return n ? { clips: n } : null; });
        if (ok) this.seek(Engine.startOf(this.clips, ids[0]));
      } else if (additive) {
        const s = new Set(this.sel); if (s.has(id)) s.delete(id); else s.add(id); this.select([...s]);
      } else {
        this.select([id]);
        let tt = clamp(this.tOfClientX(ev.clientX), 0, this.total);
        if (this.settings.snapping) tt = Engine.snap(tt, this.edgeTimes(), (SNAP_PX * 0.6) / this.pps);
        if (this.player.playing) this.player.pause();
        this.seek(Math.round(tt * 30) / 30);
      }
    };
    this.capture(e, onMove, onUp);
  },
  showTimeTip(x, text) {
    if (!this._timeTip) { this._timeTip = h('div', { class: 'trim-tip tnum' }); this.tlInner.appendChild(this._timeTip); }
    this._timeTip.style.left = x + 'px'; this._timeTip.style.top = '8px'; this._timeTip.textContent = text;
  },
  hideTimeTip() { if (this._timeTip) { this._timeTip.remove(); this._timeTip = null; } },
  showGap(gap) {
    const L = Engine.layout(this.clips);
    const tt = gap < L.length ? L[gap].start : this.v1Total;
    this.insertMark.style.left = this.xOf(tt) + 'px';
    this.insertMark.classList.remove('hidden');
  },
  /** Bersaglio di un rilascio: traccia, spazio di V1 o istante (V2/A1). kind = tipo di file, se noto. */
  dropTarget(cx, cy, kind) {
    const r = this.tlBody.getBoundingClientRect();
    if (!(cx >= r.left && cx <= r.right && cy >= r.top - 20 && cy <= r.bottom)) return null;
    let lane = this.laneAt(cy);
    if (kind === 'audio') lane = 'a1';
    else if (kind === 'image' && lane === 'a1') lane = 'v1';
    else if (kind === 'video' && lane === 'v2') lane = 'v1';
    let time = Math.max(0, this.tOfClientX(cx));
    if (lane !== 'v1') time = this.snapT(time, null, true);
    const gap = lane === 'v1' ? (this.clips.length ? Engine.gapAt(this.clips, time) : 0) : undefined;
    return { lane, time, gap };
  },
  showDropMark(tg) {
    for (const id of LANES) this.tracks[id].classList.toggle('over', id === tg.lane);
    if (tg.lane === 'v1') { if (this.clips.length) this.showGap(tg.gap); else this.insertMark.classList.add('hidden'); }
    else { this.insertMark.style.left = this.xOf(tg.time) + 'px'; this.insertMark.classList.remove('hidden'); }
  },
  clearDropMark() { for (const id of LANES) this.tracks[id].classList.remove('over'); this.tlEmpty.classList.remove('over'); this.insertMark.classList.add('hidden'); },
  /** Taglio dei bordi: V1 con ripple, V2/A1 senza invadere le clip vicine. */
  startTrim(e, id, side) {
    const f = this.findClip(id);
    if (!f) return;
    const c = f.clip; const free = f.lane !== 'v1';
    const assetDur = this.srcDur(c);
    if (this.player.playing) this.player.pause();
    if (!this.sel.has(id) || this.sel.size > 1) this.select([id]);
    const ref = this.clipEls.get(id);
    const start = this.startOfClip(id);
    const sp = c.speed || 1;
    const lim = free ? Engine.freeTrimLimits(this.trackClips(f.lane), c, side, assetDur) : Engine.trimLimits(c, side, assetDur);
    const tip = h('div', { class: 'trim-tip tnum' });
    this.tlInner.appendChild(tip);
    ref.el.classList.add('trimming');
    let val = side === 'in' ? c.in : c.out;
    const sx = e.clientX;
    const preview = f.lane === 'v1' && this.kindOfClip(c) === 'video';
    const onMove = (ev) => {
      const dt = (ev.clientX - sx) / this.pps;
      val = clamp((side === 'in' ? c.in : c.out) + dt * sp, lim.min, lim.max);
      if (this.settings.snapping && !ev.altKey) {
        // V1 si sposta in ripple: per il bordo d'ingresso conta solo il cursore
        const edgeT = side === 'in' && !free ? start : start + (val - c.in) / sp;
        const tg = free || side === 'out' ? this.edgeTimes([id]).concat(this.t) : [this.t];
        const sn = Engine.snap(edgeT, tg, SNAP_PX / this.pps);
        if (sn !== edgeT) val = clamp(c.in + (sn - start) * sp, lim.min, lim.max);
        else if (side === 'in' && !free && Math.abs(start + (val - c.in) / sp - this.t) * this.pps < SNAP_PX) val = clamp(c.in + (this.t - start) * sp, lim.min, lim.max);
      }
      val = r4(val);
      let left; let right;
      if (side === 'in') { left = free ? start + (val - c.in) / sp : start + (val - c.in) / sp; right = start + (c.out - c.in) / sp; }
      else { left = start; right = start + (val - c.in) / sp; }
      ref.el.style.left = this.xOf(left) + 'px';
      ref.el.style.width = Math.max(4, (right - left) * this.pps) + 'px';
      tip.style.left = this.xOf(side === 'in' ? left : right) + 'px';
      tip.style.top = '8px';
      tip.textContent = t('ed.trimTip', { d: fmtDur((side === 'in' ? c.out - val : val - c.in) / sp) });
      this.autoScroll(ev.clientX);
      if (preview) this.player.renderSource(c, side === 'in' ? val : Math.max(c.in, val - 1 / 30));
    };
    const onUp = () => {
      tip.remove(); ref.el.classList.remove('trimming');
      const key = TRACK_KEY[f.lane];
      const fn = free ? Engine.trimFree : Engine.trim;
      const changed = this.commit(t('h.trim'), (s) => { const n = fn(s[key], id, side, val, assetDur); return n ? { [key]: n } : null; });
      if (!changed) { this.renderTimeline(); this.player.renderAt(this.t); }
      else if (!free) {
        const st = Engine.startOf(this.clips, id);
        if (side === 'in') this.seek(st); else this.seek(Math.max(st, st + Engine.dur(this.clips.find((x) => x.id === id)) - 1 / 30));
        Tips.show(this.tipSlot, 'reorder', t('tip.reorder'));
      }
    };
    this.capture(e, onMove, onUp);
  },
  /** Slip (T): sposta la parte di sorgente usata, la durata in timeline resta uguale. */
  startSlip(e, id) {
    const f = this.findClip(id);
    if (!f) return;
    const c = f.clip;
    if (!this.hasSource(c)) { Toast.show(t('slip.na'), { duration: 2500 }); return; }
    const assetDur = this.srcDur(c); const len = c.out - c.in; const sp = c.speed || 1;
    if (len >= assetDur - 1e-3) { Toast.show(t('slip.full'), { duration: 3000 }); return; }
    if (this.player.playing) this.player.pause();
    if (!this.sel.has(id) || this.sel.size > 1) this.select([id]);
    const ref = this.clipEls.get(id);
    ref.el.classList.add('slipping');
    const tip = h('div', { class: 'trim-tip tnum' }); this.tlInner.appendChild(tip);
    const sx = e.clientX; let val = c.in;
    const preview = f.lane === 'v1' && this.kindOfClip(c) === 'video';
    const onMove = (ev) => {
      val = r4(clamp(c.in - ((ev.clientX - sx) / this.pps) * sp, 0, assetDur - len));
      tip.style.left = ref.el.style.left; tip.style.top = '8px';
      tip.textContent = t('slip.tip', { a: fmtTime(val), b: fmtTime(val + len) });
      ref.clip = { ...c, in: val, out: val + len }; ref.drawn = null; this.drawStrips();
      if (preview) this.player.renderSource(ref.clip, val);
    };
    const onUp = () => {
      tip.remove(); ref.el.classList.remove('slipping');
      const key = TRACK_KEY[f.lane];
      const ok = this.commit(t('h.slip'), (s) => { const n = Engine.slip(s[key], id, val, assetDur); return n ? { [key]: n } : null; });
      if (!ok) { ref.clip = c; this.renderTimeline(); this.player.renderAt(this.t); }
    };
    this.capture(e, onMove, onUp);
  },
  onTlContext(e) {
    const clipEl = e.target.closest('.clip');
    e.preventDefault();
    if (!clipEl) return;
    const id = clipEl.dataset.clip;
    if (!this.sel.has(id)) this.select([id]);
    this.clipMenu(e.clientX, e.clientY, clipEl);
  },
  clipMenu(x, y, focusEl) {
    const sel = this.selected();
    const one = sel.length === 1;
    const f = one ? sel[0] : null; const c = f ? f.clip : null;
    const st = c ? this.startOfClip(c.id) : 0;
    const headIn = c && this.t - st > Engine.MIN_CLIP && st + Engine.dur(c) - this.t > Engine.MIN_CLIP;
    const idx = f && f.lane === 'v1' ? f.index : -1;
    const audible = sel.filter(({ clip }) => this.hasSource(clip));
    const muted = audible.length && audible.every(({ clip }) => clip.muted);
    const disabled = sel.every(({ clip }) => clip.disabled);
    Menu.open([
      { icon: 'scissors', label: t('ed.split'), key: 'S', run: () => this.split() },
      { icon: 'copy', label: t('ed.duplicate'), key: `${MOD}+D`, run: () => this.duplicateSel() },
      { icon: 'trash', label: t('ed.delete'), key: t('key.del'), danger: true, run: () => this.deleteSel() },
      '-',
      { icon: 'chevLeft', label: t('ed.trimStart'), disabled: !headIn, run: () => this.trimToHead('in') },
      { icon: 'stepFwd', label: t('ed.trimEnd'), disabled: !headIn, run: () => this.trimToHead('out') },
      f && f.lane === 'v1' ? '-' : null,
      f && f.lane === 'v1' ? { icon: 'arrowLeft', label: t('ed.moveLeft'), key: 'Alt+←', disabled: idx <= 0, run: () => this.moveSel(-1) } : null,
      f && f.lane === 'v1' ? { icon: 'arrowRight', label: t('ed.moveRight'), key: 'Alt+→', disabled: idx >= this.clips.length - 1, run: () => this.moveSel(1) } : null,
      '-',
      { icon: 'tag', label: t('label.menu'), run: () => this.labelMenu(x, y, focusEl) },
      { icon: disabled ? 'eye' : 'eyeOff', label: disabled ? t('ed.enable') : t('ed.disable'), key: 'D', run: () => this.toggleDisabled() },
      audible.length ? { icon: muted ? 'volume' : 'mute', label: muted ? t('ed.unmute') : t('ed.mute'), run: () => this.commitSel(muted ? t('h.unmute') : t('h.mute'), (cl) => (this.hasSource(cl) ? { muted: !muted } : null)) } : null,
      audible.length ? { icon: 'gauge', label: t('speed.menu'), key: `${MOD}+R`, run: () => this.openSpeedMenu(x, y) } : null,
      { icon: 'flag', label: t('mk.add'), key: 'M', run: () => this.addMarker() },
      '-',
      { icon: 'clipboard', label: t('attr.copy'), key: `${MOD}+C`, disabled: !one, run: () => this.copyAttrs() },
      { icon: 'paste', label: t('attr.paste'), key: 'Alt+V', disabled: !this.attrClip, run: () => this.openPasteAttrs() },
    ].filter(Boolean).filter((it, i, arr) => !(it === '-' && (arr[i - 1] === '-' || i === 0))), x, y, { returnFocus: focusEl });
  },
  labelMenu(x, y, focusEl) {
    const cur = this.selected().map(({ clip }) => clip.label);
    Menu.open([
      ...Engine.LABELS.map((k) => ({ swatch: LABEL_VAR[k], icon: cur.every((v) => v === k) ? 'check' : null, label: t('label.' + k), run: () => this.setLabel(k) })),
      '-',
      { icon: 'x', label: t('label.none'), run: () => this.setLabel(null) },
    ], x, y, { returnFocus: focusEl });
  },

  /* ======================= Marker ======================= */
  /** M: marker sulla clip selezionata (se il cursore è sopra) oppure sulla timeline. */
  addMarker() {
    const sel = this.selected();
    const tt = Math.round(this.t * 30) / 30;
    if (sel.length === 1) {
      const { lane, clip } = sel[0]; const st = this.startOfClip(clip.id);
      if (tt >= st - 1e-6 && tt <= st + Engine.dur(clip) + 1e-6) {
        const at = r4(Engine.sourceTime(clip, Math.max(0, tt - st)));
        const list = Array.isArray(clip.markers) ? clip.markers : [];
        if (list.some((m) => Math.abs(m.at - at) < 1 / 60)) { Toast.show(t('mk.exists'), { duration: 2000 }); return; }
        const key = TRACK_KEY[lane];
        this.commit(t('h.marker'), (s) => ({ [key]: Engine.patch(s[key], [clip.id], { markers: list.concat({ id: uid('m'), at, color: 'violet', name: '' }).sort((a, b) => a.at - b.at) }) }));
        Toast.show(t('mk.addedClip', { t: fmtTime(tt) }), { type: 'ok', duration: 2000 });
        return;
      }
    }
    const list = this.project.markers || [];
    if (list.some((m) => Math.abs(m.t - tt) < 1 / 60)) { Toast.show(t('mk.exists'), { duration: 2000 }); return; }
    this.commit(t('h.marker'), (s) => ({ markers: s.markers.concat({ id: uid('m'), t: tt, color: 'violet', name: '' }).sort((a, b) => a.t - b.t) }));
    Toast.show(t('mk.added', { t: fmtTime(tt) }), { type: 'ok', duration: 2000 });
  },
  /** ref = { id } (timeline) oppure { clipId, id } (clip). */
  updateMarker(ref, fields) {
    if (ref.clipId) {
      const f = this.findClip(ref.clipId); if (!f) return;
      const key = TRACK_KEY[f.lane];
      const list = (f.clip.markers || []).filter((m) => !fields.deleted || m.id !== ref.id).map((m) => (m.id === ref.id ? { ...m, ...fields } : m));
      this.commit(fields.deleted ? t('h.markerDel') : t('h.markerEdit'), (s) => ({ [key]: Engine.patch(s[key], [ref.clipId], { markers: list }) }));
    } else {
      this.commit(fields.deleted ? t('h.markerDel') : t('h.markerEdit'), (s) => ({ markers: s.markers.filter((m) => !(fields.deleted && m.id === ref.id)).map((m) => (m.id === ref.id ? { ...m, ...fields } : m)) }));
    }
  },
  removeMarker(ref) { this.updateMarker(ref, { deleted: true }); Toast.show(t('mk.removed'), { action: () => this.undo(), actionLabel: t('ed.undo'), duration: 4000 }); },
  markerMenu(ref, x, y, focusEl) {
    const list = ref.clipId ? ((this.findClip(ref.clipId) || {}).clip || {}).markers || [] : this.project.markers || [];
    const m = list.find((k) => k.id === ref.id); if (!m) return;
    Menu.open([
      ...Engine.LABELS.map((k) => ({ swatch: LABEL_VAR[k], icon: m.color === k ? 'check' : null, label: t('label.' + k), run: () => this.updateMarker(ref, { color: k }) })),
      '-',
      { icon: 'edit', label: t('mk.rename'), run: async () => { const v = await promptDialog({ title: t('mk.renameT'), label: t('mk.name'), value: m.name || '', confirm: t('dash.renameOk') }); if (v !== null) this.updateMarker(ref, { name: v }); } },
      { icon: 'trash', label: t('mk.delete'), danger: true, run: () => this.removeMarker(ref) },
    ], x, y, { returnFocus: focusEl });
  },
  jumpMarker(dir) {
    const times = [...new Set(this.markerTimes().map((x) => Math.round(x * 1000) / 1000))].sort((a, b) => a - b);
    if (!times.length) { Toast.show(t('mk.none'), { duration: 2000 }); return; }
    const tt = dir > 0 ? times.find((x) => x > this.t + 1e-3) : [...times].reverse().find((x) => x < this.t - 1e-3);
    if (tt !== undefined) { if (this.player.playing) this.player.pause(); this.seek(tt); }
  },

  /* ======================= Trascinamento dalla libreria ======================= */
  startLibDrag(e, a) {
    const ent = Media.get(a.id);
    if (!ent || ent.status !== 'ready') return;
    const kind = a.kind || 'video';
    const sx = e.clientX; const sy = e.clientY; let dragging = false;
    e.preventDefault(); // evita la selezione del testo durante il trascinamento
    let tg = null;
    const move = (ev) => {
      if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 5) {
        dragging = true;
        this.ghost = h('div', { class: 'drag-ghost k-' + kind, style: { width: '180px' } }, a.name);
        document.body.appendChild(this.ghost);
      }
      if (!dragging) return;
      this.ghost.style.left = ev.clientX + 12 + 'px'; this.ghost.style.top = ev.clientY - 28 + 'px';
      tg = this.dropTarget(ev.clientX, ev.clientY, kind);
      if (tg) {
        this.autoScroll(ev.clientX);
        if (tg.lane === 'v1' && !this.clips.length) this.tlEmpty.classList.add('over');
        this.showDropMark(tg);
      } else this.clearDropMark();
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      if (!dragging) return;
      this.ghost.remove(); this.ghost = null; this.clearDropMark();
      tg = ev.type === 'pointerup' ? this.dropTarget(ev.clientX, ev.clientY, kind) : null;
      if (!tg) return;
      if (tg.lane === 'v1') this.addToTimeline([a.id], tg.gap);
      else this.addToTimeline([a.id], null, { lane: tg.lane, time: tg.time });
    };
    // ascolto sulla finestra: l'elemento della libreria può essere aggiornato durante il trascinamento
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  },
});
