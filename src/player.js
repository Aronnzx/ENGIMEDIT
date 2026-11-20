'use strict';
/* =========================================================================
   player.js — anteprima della sequenza "come sarà esportata".
   • Orologio principale: AudioContext (l'audio viene dai buffer decodificati,
     lo stesso usato nell'esportazione, con le stesse dissolvenze ed EQ).
   • Video V1: due lettori nascosti (A/B). Mentre uno suona, l'altro prepara
     la clip video successiva già posizionata: il cambio clip è senza scatti.
   • Ogni fotogramma viene composto con Render.frame (V1 + V2 + colore +
     effetti + bande nere), la stessa funzione dell'esportazione.
   ========================================================================= */

/** Disegna un fotogramma sorgente nel formato di uscita (Adatta / Riempi + inquadratura). Usato per miniature. */
function drawFrame(ctx, W, H, src, sw, sh, clip) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (!src || !sw || !sh) return;
  const fill = clip && clip.fit === 'fill';
  const s = fill ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
  const dw = sw * s; const dh = sh * s;
  let dx = (W - dw) / 2; let dy = (H - dh) / 2;
  if (fill) {
    dx -= ((clip.ox || 0) * (dw - W)) / 2;
    dy -= ((clip.oy || 0) * (dh - H)) / 2;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  try { ctx.drawImage(src, dx, dy, dw, dh); } catch { /* fotogramma non ancora disponibile */ }
}
function drawMissing(ctx, W, H, text) {
  ctx.fillStyle = '#120d24'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(167,139,250,0.35)'; ctx.lineWidth = Math.max(2, W / 300);
  ctx.setLineDash([10, 8]); ctx.strokeRect(W * 0.08, H * 0.08, W * 0.84, H * 0.84); ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(244,242,255,0.8)';
  ctx.font = `600 ${Math.round(Math.min(W, H) / 18)}px ${getComputedStyle(document.body).fontFamily}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2);
}

let VPOOL = null;
function videoPool() {
  if (!VPOOL) { VPOOL = h('div', { class: 'vpool', 'aria-hidden': 'true' }); document.body.appendChild(VPOOL); }
  return VPOOL;
}
function makeVideoEl() {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.disablePictureInPicture = true;
  v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
  videoPool().appendChild(v);
  return v;
}
/** La clip V1 mostra un'immagine fissa (nessun lettore video). */
function isImageClip(clip) { const e = Media.get(clip.assetId); return !!(e && e.image); }

class Player {
  /**
   * @param {object} o
   *  canvas        canvas di destinazione
   *  getProject    () => { tracks, settings, assets, format }
   *  onTime(t)     aggiornamento del tempo
   *  onState()     cambio di stato (play/pausa/attesa)
   *  onEnd()       fine della sequenza
   *  audioOut      nodo audio di destinazione (default: altoparlanti)
   */
  constructor(o) {
    Object.assign(this, o);
    if (!this.getProject && this.getClips) { const gc = this.getClips; this.getProject = () => ({ tracks: [{ id: 'v1', clips: gc() }], settings: {} }); }
    this.ctx2d = this.canvas.getContext('2d', { alpha: false });
    this.rc = Render.context();
    this.vp = [0, 1].map(() => ({ el: makeVideoEl(), assetId: null, seeking: false, target: 0, pending: null, preparedFor: null, loadP: null }));
    this.active = 0;
    this.t = 0;
    this.playing = false;
    this.waiting = false;
    this.bypass = false;          // Prima/Dopo: correzioni colore disattivate (solo anteprima)
    this.sources = [];
    this.token = 0;
    this.renderToken = 0;
    this.curClipId = null;
    const ac = Media.audioCtx();
    this.master = ac.createGain();
    this.master.connect(this.audioOut || ac.destination);
    this.volume = 1;
    this._tick = this._tick.bind(this);
  }
  destroy() {
    this.pause(true);
    for (const p of this.vp) { try { p.el.pause(); p.el.removeAttribute('src'); p.el.load(); } catch {} p.el.remove(); }
    try { this.master.disconnect(); } catch {}
  }
  setVolume(v) { this.volume = v; this.master.gain.value = v; }
  get W() { return this.canvas.width; }
  get H() { return this.canvas.height; }
  get v1() { return Engine.track(this.getProject(), 'v1').clips; }
  get total() { return Engine.projectTotal(this.getProject()); }
  /** Clip V1 al tempo t; null dopo la fine di V1 se il progetto continua (V2/A1 più lunghe). */
  _locate(t) {
    const clips = this.v1;
    const loc = Engine.locate(clips, t);
    if (!loc) return null;
    if (loc.atEnd && Engine.total(clips) < this.total - 1e-6) return null;
    return loc;
  }

  /* ---------------- lettori video ---------------- */
  _assign(p, assetId) {
    if (p.assetId === assetId && p.loadP) return p.loadP;
    const e = Media.get(assetId);
    p.assetId = assetId; p.preparedFor = null;
    if (!e || !e.url || e.image) { p.loadP = Promise.resolve(false); return p.loadP; }
    p.el.src = e.url;
    p.loadP = new Promise((res) => {
      const ok = () => { cleanup(); res(true); };
      const ko = () => { cleanup(); res(false); };
      const cleanup = () => { p.el.removeEventListener('loadeddata', ok); p.el.removeEventListener('error', ko); clearTimeout(tm); };
      p.el.addEventListener('loadeddata', ok); p.el.addEventListener('error', ko);
      const tm = setTimeout(ok, 6000);
    });
    return p.loadP;
  }
  /** Seek con logica "vince l'ultima richiesta". */
  _seek(p, time) {
    p.target = time;
    if (p.seeking) return p.pending;
    p.seeking = true;
    p.pending = (async () => {
      for (let guard = 0; guard < 20; guard++) {
        if (p.loadP) await p.loadP;          // attende la sorgente corrente
        const tg = p.target; const src = p.el.currentSrc;
        await Media.seek(p.el, tg);
        if (p.target === tg && p.el.currentSrc === src) break;
      }
      p.seeking = false;
    })();
    return p.pending;
  }

  /* ---------------- composizione ---------------- */
  /** Compone il fotogramma al tempo t con la sorgente V1 indicata (o nessuna). */
  _compose(t, loc, src, sw, sh, ctx = this.ctx2d, W = this.W, H = this.H) {
    Render.frame(ctx, W, H, { t, project: this.getProject(), v1: loc && src ? { clip: loc.clip, local: loc.local, src, sw, sh } : null, rc: this.rc, bypass: this.bypass });
  }
  _composeEl(t, loc, el) {
    if (el && el.readyState >= 2) this._compose(t, loc, el, el.videoWidth, el.videoHeight);
  }
  /** Sorgente da usare per una clip V1 già posizionata: immagine o lettore attivo. */
  _imageOf(clip) { const e = Media.get(clip.assetId); return e && e.image ? e.image : null; }

  /* ---------------- rendering a fermo ---------------- */
  /** Mostra il fotogramma al tempo t (in pausa). */
  async renderAt(t) {
    const tok = ++this.renderToken;
    const loc = this._locate(t);
    if (!loc) { if (!this.v1.length && !this.total) this._blank(); else this._compose(t, null); return; }
    const e = Media.get(loc.clip.assetId);
    if (!e || e.status === 'missing') { drawMissing(this.ctx2d, this.W, this.H, t_('preview.missing')); return; }
    if (e.status !== 'ready') { this._blank(); return; }
    if (e.image) { this._compose(t, loc, e.image, e.image.width, e.image.height); return; }
    const p = this.vp[this.active];
    const ok = await this._assign(p, loc.clip.assetId);
    if (tok !== this.renderToken) return;
    if (!ok) { drawMissing(this.ctx2d, this.W, this.H, t_('preview.unreadable')); return; }
    let src = Engine.sourceTime(loc.clip, loc.local);
    if (loc.atEnd) src = Math.max(loc.clip.in, src - 1 / 30);
    await this._seek(p, src);
    if (tok !== this.renderToken || this.playing) return;
    this._composeEl(t, loc, p.el);
  }
  /** Anteprima di un istante preciso di una sorgente V1 (durante taglio e slip). */
  async renderSource(clip, srcTime) {
    const tok = ++this.renderToken;
    const e = Media.get(clip.assetId);
    const local = Math.max(0, (srcTime - clip.in) / (clip.speed || 1));
    const start = Engine.startOf(this.v1, clip.id);
    const t = start >= 0 ? start + local : this.t;
    const loc = { clip, local };
    if (e && e.image) { this._compose(t, loc, e.image, e.image.width, e.image.height); return; }
    const p = this.vp[this.active];
    const ok = await this._assign(p, clip.assetId);
    if (!ok || tok !== this.renderToken) return;
    await this._seek(p, srcTime);
    if (tok !== this.renderToken || this.playing) return;
    this._composeEl(t, loc, p.el);
  }
  /** Disegna il fotogramma al tempo t su un'altra tela, a qualunque risoluzione (Cattura fotogramma). */
  async renderTo(canvas, t) {
    const g = canvas.getContext('2d', { alpha: false });
    const W = canvas.width; const H = canvas.height;
    const loc = this._locate(t);
    if (!loc) { this._compose(t, null, null, 0, 0, g, W, H); return; }
    const e = Media.get(loc.clip.assetId);
    if (e && e.image) { this._compose(t, loc, e.image, e.image.width, e.image.height, g, W, H); return; }
    const p = this.vp[this.active];
    await this._assign(p, loc.clip.assetId);
    let src = Engine.sourceTime(loc.clip, loc.local);
    if (loc.atEnd) src = Math.max(loc.clip.in, src - 1 / 30);
    await this._seek(p, src);
    const el = p.el;
    this._compose(t, loc, el.readyState >= 2 ? el : null, el.videoWidth, el.videoHeight, g, W, H);
  }
  redraw() { if (!this.playing) this.renderAt(this.t); }
  _blank() { this.ctx2d.fillStyle = '#000'; this.ctx2d.fillRect(0, 0, this.W, this.H); }

  /* ---------------- riproduzione ---------------- */
  async play() {
    if (this.playing || this.waiting) return;
    const project = this.getProject();
    const total = Engine.projectTotal(project);
    if (!total) return;
    const ac = Media.audioCtx();
    const resumeP = ac.state === 'suspended' ? ac.resume().catch(() => {}) : null; // nel gesto dell'utente
    if (this.t >= total - 0.02) this.t = 0;
    const tok = ++this.token;
    this.waiting = true; this.onState && this.onState();
    const ids = new Set(); for (const tr of project.tracks) for (const c of tr.clips) if (c.assetId) ids.add(c.assetId);
    await Media.waitAudio([...ids]);
    if (resumeP) await resumeP;
    if (tok !== this.token) return;
    const loc = this._locate(this.t);
    if (loc && !isImageClip(loc.clip)) {
      const p = this.vp[this.active];
      await this._assign(p, loc.clip.assetId);
      await this._seek(p, Engine.sourceTime(loc.clip, loc.local));
      if (tok !== this.token) return;
      p.el.playbackRate = loc.clip.speed || 1;
      try { await p.el.play(); } catch { /* il video potrebbe mancare: si continua con l'audio */ }
      if (tok !== this.token) { p.el.pause(); return; }
    }
    this.waiting = false;
    this.playing = true;
    this.clockCtx = ac.currentTime;
    this.clockT = this.t;
    this.curClipId = loc ? loc.clip.id : null;
    this._scheduleAudio(this.t);
    if (loc) this._preloadNext(loc.index);
    this.onState && this.onState();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this._tick);
  }
  /** Ferma la riproduzione. Il fotogramma mostrato resta quello corrente. */
  pause(silent) {
    this.token++;
    const was = this.playing || this.waiting;
    if (this.playing) this.t = this._now();
    this.playing = false; this.waiting = false;
    cancelAnimationFrame(this.raf);
    this._stopAudio();
    for (const p of this.vp) { try { p.el.pause(); p.el.playbackRate = 1; } catch {} }
    if (was && !silent) { this.onState && this.onState(); this.onTime && this.onTime(this.t); this.renderAt(this.t); }
  }
  toggle() { if (this.playing || this.waiting) this.pause(); else this.play(); }
  /** Sposta il cursore. Se in riproduzione, riparte dal nuovo punto. */
  seek(t) {
    this.t = Math.max(0, Math.min(this.total, t));
    if (this.playing) this._restart();
    else { this.onTime && this.onTime(this.t); this.renderAt(this.t); }
  }
  /** Da chiamare dopo una modifica della timeline. */
  invalidate() {
    const total = this.total;
    if (this.t > total) this.t = total;
    for (const p of this.vp) p.preparedFor = null;
    if (this.playing) this._restart(); else this.renderAt(this.t);
  }
  _restart() {
    const t = this.playing ? Math.min(this._now(), this.total) : this.t;
    this.pause(true);
    this.t = t;
    this.play();
  }
  _now() { return this.clockT + (Media.audioCtx().currentTime - this.clockCtx); }

  _scheduleAudio(t) {
    this._stopAudio();
    this.sources = AudioFX.schedule(Media.audioCtx(), this.master, this.getProject(), t, this.clockCtx);
  }
  _stopAudio() {
    for (const s of this.sources) { try { s.stop(); } catch {} try { s.disconnect(); } catch {} }
    this.sources = [];
  }
  /** Prepara sull'altro lettore la prossima clip VIDEO (le immagini non ne hanno bisogno). */
  _preloadNext(index) {
    const clips = this.v1;
    let next = null;
    for (let i = index + 1; i < clips.length; i++) if (!isImageClip(clips[i])) { next = clips[i]; break; }
    if (!next) return;
    const p = this.vp[1 - this.active];
    const e = Media.get(next.assetId);
    if (!e || e.status !== 'ready') return;
    if (p.preparedFor === next.id) return;
    p.el.pause();
    this._assign(p, next.assetId).then(() => this._seek(p, next.in)).then(() => { p.preparedFor = next.id; });
  }
  _switchTo(loc) {
    const other = this.vp[1 - this.active];
    const cur = this.vp[this.active];
    if (isImageClip(loc.clip)) {
      cur.el.pause();
    } else if (other.preparedFor === loc.clip.id && other.assetId === loc.clip.assetId) {
      this.active = 1 - this.active;
      cur.el.pause();
      other.el.playbackRate = loc.clip.speed || 1;
      other.el.play().catch(() => {});
    } else {
      // salto non previsto: riposiziona il lettore attivo
      const tok = this.token;
      cur.el.pause();
      this._assign(cur, loc.clip.assetId)
        .then(() => this._seek(cur, Engine.sourceTime(loc.clip, Math.max(0, this._now() - loc.start))))
        .then(() => { if (tok === this.token && this.playing) { cur.el.playbackRate = loc.clip.speed || 1; cur.el.play().catch(() => {}); } });
    }
    this.curClipId = loc.clip.id;
    this._preloadNext(loc.index);
  }
  _tick() {
    if (!this.playing) return;
    const total = this.total;
    const t = this._now();
    if (t >= total || !total) {
      this.pause(true);
      this.t = total;
      this.onTime && this.onTime(total);
      this.onState && this.onState();
      this.renderAt(total);
      this.onEnd && this.onEnd();
      return;
    }
    const loc = this._locate(t);
    if (!loc) {
      if (this.curClipId) { for (const p of this.vp) p.el.pause(); this.curClipId = null; }
      this._compose(t, null);
    } else {
      if (loc.clip.id !== this.curClipId) this._switchTo(loc);
      const e = Media.get(loc.clip.assetId);
      if (!e || e.status !== 'ready') {
        drawMissing(this.ctx2d, this.W, this.H, t_('preview.missing'));
      } else if (e.image) {
        this._compose(t, loc, e.image, e.image.width, e.image.height);
      } else {
        const p = this.vp[this.active];
        if (p.assetId === loc.clip.assetId && !p.seeking) {
          const sp = loc.clip.speed || 1;
          const expected = Engine.sourceTime(loc.clip, loc.local);
          const drift = p.el.currentTime - expected;
          if (Math.abs(drift) > 0.3 * Math.max(1, sp)) {
            this._seek(p, expected).then(() => { if (this.playing) p.el.play().catch(() => {}); });
          } else {
            if (p.el.paused && !p.el.ended) p.el.play().catch(() => {});
            const corr = Math.abs(drift) > 0.04 ? Math.max(0.9, Math.min(1.1, 1 - (drift / sp) * 0.8)) : 1;
            const rate = sp * corr;
            if (Math.abs(p.el.playbackRate - rate) > 0.009 * sp) p.el.playbackRate = rate;
          }
          this._composeEl(t, loc, p.el);
        }
      }
    }
    this.t = t;
    this.onTime && this.onTime(t);
    this.raf = requestAnimationFrame(this._tick);
  }
}
