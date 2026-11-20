'use strict';
/* =========================================================================
   editor.js — schermata di montaggio: stato, cronologia, Media Pool,
   anteprima, comandi e tastiera. La timeline multitraccia è in
   timeline.js, l'Inspector in inspector.js (metodi della stessa classe).
   ========================================================================= */
const TL_PAD = 16;          // margine sinistro della timeline (px)
const SNAP_PX = 9;          // soglia di aggancio magnetico (px)
const MAX_PPS = 400;        // zoom massimo (pixel per secondo)
const TRACK_KEY = { v1: 'clips', v2: 'v2', a1: 'a1' };   // traccia → chiave nello stato annullabile

class Editor {
  constructor(root, projectId) {
    this.root = root;
    this.projectId = projectId;
    this.sel = new Set();
    this.history = Engine.createHistory();
    this.pps = 60;
    this.t = 0;
    this.clipEls = new Map();
    this.cleanups = [];
    this.live = null;
    this.saveState = 'saved';
    this.saveSoon = debounce(() => this.saveNow(), 700);
    this.destroyed = false;
    this.editCount = 0;
    this.tool = 'pointer';                     // pointer | blade | slip
    this.libFilter = Prefs.get('libFilter', 'all');
    this.inspTab = Prefs.get('inspTab', 'video');
    this.attrClip = null;                      // attributi copiati (Ctrl+C)
  }

  /* ======================= Ciclo di vita ======================= */
  async mount() {
    let p = null;
    try { p = await Store.get(this.projectId); } catch (e) { ErrLog.add('open', e); }
    if (this.destroyed) return;
    if (!p) { this.renderNotFound(); return; }
    this.project = p;
    this.build();
    this.loadLayout();
    this.player = new Player({
      canvas: this.canvas,
      getProject: () => this.project,
      onTime: (t) => { this.t = t; this.updatePlayhead(); this.updateTime(); this.followPlayhead(); },
      onState: () => this.updateTransport(),
    });
    this.player.setVolume(Prefs.get('previewVol', 1));
    this.renderAll();
    requestAnimationFrame(() => { this.layoutStage(); this.zoomFit(); this.player.renderAt(0); });
    this.listen(window, 'keydown', (e) => this.onKey(e));
    this.listen(window, 'beforeunload', (e) => { if (this.saveSoon.pending() || this.saving) { this.saveSoon.flush(); e.preventDefault(); e.returnValue = ''; } });
    this.listen(window, 'resize', () => { this.layoutStage(); this.renderTimeline(); });
    this.setupDrop();
    this.unsubMedia = Media.on((id) => this.onMediaUpdate(id));
    this.unsubCloud = Cloud.on(() => this.renderSaveState());
    await Media.loadProject(this.project);
    if (this.destroyed) return;
    this.renderLib(); this.renderTimeline(); this.player.renderAt(this.t);
    const missing = this.missingAssets();
    if (missing.length) setTimeout(() => !this.destroyed && this.openRelink(), 300);
    if (App.sampleFor === this.projectId) { App.sampleFor = null; this.loadSamples(); }
    else if (!Prefs.get('tourDone', false)) setTimeout(() => { if (!this.destroyed && getComputedStyle(this.ed).display !== 'none') this.startTour(); }, 600);
  }
  destroy() {
    this.destroyed = true;
    let flushed = Promise.resolve();
    if (this.saveSoon.pending()) { this.saveSoon.cancel(); flushed = this.saveNow(); }
    else if (this.savingP) flushed = this.savingP;
    for (const fn of this.cleanups) { try { fn(); } catch {} }
    if (this.unsubMedia) this.unsubMedia();
    if (this.unsubCloud) this.unsubCloud();
    if (this.player) this.player.destroy();
    if (this.ro) this.ro.disconnect();
    Tour.end(true); Tips.hide(); Menu.close();
    if (this.dropOverlay) this.dropOverlay.remove();
    Media.unloadAll();
    return flushed;
  }
  listen(target, type, fn, opts) { target.addEventListener(type, fn, opts); this.cleanups.push(() => target.removeEventListener(type, fn, opts)); }

  /* ======================= Stato e comandi ======================= */
  /** Clip della traccia V1 (sequenza principale). */
  get clips() { return this.project.tracks[0].clips; }
  get v2() { return Engine.track(this.project, 'v2').clips; }
  get a1() { return Engine.track(this.project, 'a1').clips; }
  trackClips(id) { return id === 'v1' ? this.clips : id === 'v2' ? this.v2 : this.a1; }
  /** Durata del progetto (la traccia più lunga). */
  get total() { return Engine.projectTotal(this.project); }
  get v1Total() { return Engine.total(this.clips); }
  get settings() { return this.project.settings; }
  hasClips() { return this.project.tracks.some((tr) => tr.clips.length > 0); }
  /** Clip con la sua traccia: { lane, clip, index }. */
  findClip(id) {
    for (const lane of ['v1', 'v2', 'a1']) { const arr = this.trackClips(lane); const i = arr.findIndex((c) => c.id === id); if (i >= 0) return { lane, clip: arr[i], index: i }; }
    return null;
  }
  selected() { return [...this.sel].map((id) => this.findClip(id)).filter(Boolean); }
  /** Inizio in timeline di una clip di qualsiasi traccia. */
  startOfClip(id) { const f = this.findClip(id); if (!f) return -1; return f.lane === 'v1' ? Engine.startOf(this.clips, id) : (f.clip.start || 0); }
  assetOf(c) { return c && c.assetId ? this.project.assets[c.assetId] : null; }
  kindOfClip(c) { const k = Engine.kindOf(c); if (k !== 'media') return k; const a = this.assetOf(c); return a ? a.kind || 'video' : 'video'; }
  /** La clip ha un file sorgente con durata (video o audio): si possono usare velocità e slip. */
  hasSource(c) { const k = this.kindOfClip(c); return k === 'video' || k === 'audio'; }
  srcDur(c) { const a = this.assetOf(c); const k = this.kindOfClip(c); return a && (k === 'video' || k === 'audio') ? a.duration : Engine.FREE_MAX; }

  snapshot() {
    return { clips: this.clips, v2: this.v2, a1: this.a1, markers: this.project.markers || [], format: this.project.format, assets: this.project.assets, blanking: this.settings.blanking };
  }
  applyState(s) {
    const assets = { ...this.project.assets, ...s.assets };
    const tr = this.project.tracks;
    this.project = {
      ...this.project, format: s.format, assets, markers: s.markers || [],
      settings: { ...this.settings, blanking: s.blanking || 'none' },
      tracks: [{ ...tr[0], clips: s.clips }, { ...(tr[1] || { id: 'v2', kind: 'overlay' }), clips: s.v2 || [] }, { ...(tr[2] || { id: 'a1', kind: 'audio' }), clips: s.a1 || [] }],
    };
  }
  /** Applica una modifica annullabile. fn(stato) → nuovo stato parziale oppure null. */
  commit(label, fn) {
    const before = this.snapshot();
    const res = fn(before);
    if (!res) return false;
    this.history.push(label, before);
    this.applyState({ ...before, ...res });
    this.afterChange(res.format !== undefined && res.format !== before.format);
    this.editCount++;
    return true;
  }
  afterChange(formatChanged) {
    for (const id of [...this.sel]) if (!this.findClip(id)) this.sel.delete(id);
    this.markDirty();
    if (formatChanged) this.layoutStage();
    this.renderTimeline(); this.renderProps(); this.renderHistoryButtons(); this.renderLibUsage(); this.renderStageInfo();
    this.player.invalidate();
    this.updateTransport();
    this.updateTime();
  }
  undo() {
    const e = this.history.undo(this.snapshot());
    if (!e) return;
    const fmt = this.project.format;
    this.applyState(e.state); this.afterChange(fmt !== this.project.format);
    Toast.show(t('ed.undone', { what: e.label }), { duration: 2200 });
  }
  redo() {
    const e = this.history.redo(this.snapshot());
    if (!e) return;
    const fmt = this.project.format;
    this.applyState(e.state); this.afterChange(fmt !== this.project.format);
    Toast.show(t('ed.redone', { what: e.label }), { duration: 2200 });
  }
  /* Modifiche "dal vivo" (slider, trascinamento inquadratura): una sola voce di cronologia */
  beginLive() { if (!this.live) this.live = this.snapshot(); }
  /** Applica uno stato parziale senza cronologia (accetta anche un array = clip V1). */
  setLive(partial) {
    const p = Array.isArray(partial) ? { clips: partial } : partial;
    this.applyState({ ...this.snapshot(), ...p });
    this.player.invalidate();
  }
  endLive(label) {
    if (!this.live) return;
    const before = this.live; this.live = null;
    const now = this.snapshot();
    if (['clips', 'v2', 'a1', 'markers', 'blanking'].every((k) => before[k] === now[k])) return;
    this.history.push(label, before);
    this.afterChange(false);
  }
  /** Modifica dei campi delle clip indicate su tutte le tracce: stato parziale o null. */
  patchIds(state, ids, fields) {
    const out = {};
    for (const lane of ['v1', 'v2', 'a1']) {
      const key = TRACK_KEY[lane];
      const f = typeof fields === 'function' ? null : fields;
      let arr = state[key];
      if (f) { const n = Engine.patch(arr, ids, f); if (n) out[key] = n; continue; }
      // fields(clip, lane) → campi per quella clip (o null)
      let changed = false;
      arr = arr.map((c) => {
        if (!ids.has(c.id)) return c;
        const ff = fields(c, lane); if (!ff) return c;
        const n = Engine.patch([c], [c.id], ff); if (!n) return c;
        changed = true; return n[0];
      });
      if (changed) out[key] = arr;
    }
    return Object.keys(out).length ? out : null;
  }
  /** Modifica annullabile delle clip selezionate. */
  commitSel(label, fields, ids = this.sel) {
    const set = ids instanceof Set ? ids : new Set(ids);
    return this.commit(label, (s) => this.patchIds(s, set, fields));
  }
  /** Modifica "dal vivo" delle clip selezionate (slider). */
  liveSel(fields) {
    this.beginLive();
    const p = this.patchIds(this.snapshot(), this.sel, fields);
    if (p) this.setLive(p);
  }

  markDirty() {
    this.project.updatedAt = Date.now();
    this.saveState = 'saving'; this.renderSaveState();
    this.saveSoon();
  }
  saveNow() {
    if (!this.project) return Promise.resolve();
    this.savingP = this._save();
    return this.savingP;
  }
  async _save() {
    this.saving = true;
    try {
      this.updateThumb();
      await Store.save(this.project);
      this.saveState = 'saved';
    } catch (e) {
      ErrLog.add('save', e);
      this.saveState = 'error';
      Toast.show(t('ed.saveFail'), { type: 'err', duration: 7000 });
    }
    this.saving = false;
    if (!this.destroyed) this.renderSaveState();
  }
  updateThumb() {
    const c = this.clips[0];
    const key = c ? `${c.assetId}|${c.in}|${c.fit}|${c.ox}|${c.oy}|${this.project.format}` : '';
    if (key === this.project.thumbKey) return;
    this.project.thumbKey = key;
    if (!c) { delete this.project.thumb; return; }
    const e = Media.get(c.assetId); const a = this.project.assets[c.assetId];
    if (!e || !e.thumbs.length || !a) return;
    const f = Engine.FORMATS[this.project.format];
    const W = 320; const H = Math.round((320 * f.h) / f.w);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const src = e.thumbs[0];
    drawFrame(cv.getContext('2d'), W, H, src, src.width, src.height, c);
    try { this.project.thumb = cv.toDataURL('image/jpeg', 0.72); } catch {}
  }

  /* ======================= Costruzione DOM ======================= */
  build() {
    this.root.textContent = '';
    const wrap = h('div', { class: 'ed-wrap' });
    this.ed = h('div', { class: 'ed no-props' });
    this.ed.append(this.buildTop(), this.buildLib(), h('div', { class: 'rz rz-l', role: 'separator', 'aria-orientation': 'vertical', tabindex: '0', 'aria-label': t('ed.resizeLib') }),
      this.buildCenter(), h('div', { class: 'rz rz-r', role: 'separator', 'aria-orientation': 'vertical', tabindex: '0', 'aria-label': t('ed.resizeProps') }), this.buildProps(),
      h('div', { class: 'rz rz-t', role: 'separator', 'aria-orientation': 'horizontal', tabindex: '0', 'aria-label': t('ed.resizeTl') }), this.buildTimeline());
    const gate = h('div', { class: 'gate' }, h('div', { class: 'in' }, h('span', { html: Art.dash().replace('<svg', '<svg class="big"') }), h('h1', null, t('gate.title')), h('p', null, t('gate.text')), h('a', { class: 'btn btn-primary', href: '#progetti' }, t('gate.back'))));
    wrap.append(this.ed, gate);
    this.root.appendChild(wrap);
    this.setupResizers();
  }

  buildTop() {
    this.nameInput = h('input', { class: 'pname', value: this.project.name, maxlength: 80, 'aria-label': t('ed.projName'), spellcheck: 'false' });
    this.nameInput.addEventListener('change', () => this.rename(this.nameInput.value));
    this.nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.nameInput.blur(); if (e.key === 'Escape') { this.nameInput.value = this.project.name; this.nameInput.blur(); } });
    this.saveEl = h('span', { class: 'save-state', role: 'status', 'aria-live': 'polite' });
    this.undoBtn = h('button', { class: 'btn btn-ghost btn-icon', 'data-tip': t('ed.undo'), 'data-key': `${MOD} Z`, 'aria-label': t('ed.undo'), html: icon('undo'), onclick: () => this.undo() });
    this.redoBtn = h('button', { class: 'btn btn-ghost btn-icon', 'data-tip': t('ed.redo'), 'data-key': `${MOD} ⇧ Z`, 'aria-label': t('ed.redo'), html: icon('redo'), onclick: () => this.redo() });
    this.histBtn = h('button', { class: 'btn btn-ghost btn-icon', 'data-tip': t('ed.history'), 'aria-label': t('ed.history'), 'aria-haspopup': 'menu', html: icon('history'), onclick: () => this.openHistory() });
    const setBtn = h('button', { class: 'btn btn-ghost btn-icon', 'data-tip': t('pset.title'), 'aria-label': t('pset.title'), 'aria-haspopup': 'dialog', html: icon('settings'), onclick: () => this.openProjectSettings() });
    const helpBtn = h('button', { class: 'btn btn-ghost btn-icon', 'data-tip': t('ed.help'), 'data-key': '?', 'aria-label': t('ed.help'), 'aria-haspopup': 'menu', html: icon('help') });
    helpBtn.addEventListener('click', () => Menu.fromButton(helpBtn, [
      { icon: 'sparkle', label: t('ed.tourAgain'), run: () => this.startTour() },
      { icon: 'keyboard', label: t('sc.title'), key: '?', run: () => openShortcuts() },
      { icon: 'film', label: t('ed.useSamples'), run: () => this.loadSamples() },
      '-',
      { icon: 'download', label: t('proj.exportJson'), run: () => this.exportProjectJson() },
      { icon: 'help', label: t('nav.help'), run: () => { location.hash = 'aiuto'; } },
    ]));
    this.exportBtn = h('button', { class: 'btn btn-primary btn-export', 'data-tour': 'export', 'data-tip': t('ed.export'), 'data-key': `${MOD} E`, onclick: () => this.openExport() }, ic('download'), t('ed.export'));
    const back = h('a', { class: 'btn btn-ghost btn-icon', href: '#progetti', 'data-tip': t('ed.backProjects'), 'aria-label': t('ed.backProjects'), html: icon('arrowLeft') });
    const logo = logoEl('#progetti');
    return h('header', { class: 'ed-top' }, back, logo, h('div', { class: 'vsep' }), this.nameInput, this.saveEl, h('div', { class: 'grow' }),
      this.undoBtn, this.redoBtn, this.histBtn, setBtn, helpBtn, h('div', { class: 'vsep' }), this.exportBtn);
  }

  buildLib() {
    this.fileInput = h('input', { type: 'file', multiple: true, accept: MEDIA_ACCEPT, class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true' });
    this.fileInput.addEventListener('change', () => { const f = [...this.fileInput.files]; this.fileInput.value = ''; this.importFiles(f); });
    this.libCount = h('span', { class: 'badge' }, '0');
    const addBtn = h('button', { class: 'btn btn-primary lib-add', 'data-tour': 'add', onclick: () => this.fileInput.click() }, ic('plus'), t('ed.addMedia'));
    this.libBanner = h('div');
    // cartelle rapide stile Media Pool
    this.libTabs = h('div', { class: 'seg lib-filter', role: 'radiogroup', 'aria-label': t('pool.filter') });
    for (const [k, iconName] of [['all', 'layers'], ['video', 'film'], ['image', 'image'], ['audio', 'music']]) {
      const b = h('button', { role: 'radio', 'aria-checked': String(this.libFilter === k), 'data-filter': k, 'data-tip': t('pool.tip.' + k) }, ic(iconName), h('span', null, t('pool.' + k)), h('small', { class: 'tnum' }, '0'));
      b.addEventListener('click', () => this.setLibFilter(k));
      this.libTabs.appendChild(b);
    }
    this.libTabs.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      const ks = ['all', 'video', 'image', 'audio']; const i = ks.indexOf(this.libFilter);
      const n = ks[(i + (e.key === 'ArrowRight' ? 1 : ks.length - 1)) % ks.length];
      this.setLibFilter(n); $(`[data-filter="${n}"]`, this.libTabs).focus();
    });
    this.libList = h('div', { class: 'lib-list', role: 'list', 'aria-label': t('ed.library') });
    this.libBody = h('div', { class: 'pane-body', 'data-tour': 'library' }, addBtn, this.fileInput, this.libTabs, this.libBanner, this.libList);
    return h('section', { class: 'pane ed-lib', 'aria-label': t('ed.library') },
      h('div', { class: 'pane-head' }, h('h2', null, ic('film'), t('ed.library')), this.libCount), this.libBody);
  }

  buildCenter() {
    this.formatSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': t('ed.format') });
    for (const [f, sub] of [['16:9', 'YouTube'], ['9:16', 'TikTok'], ['1:1', 'Feed'], ['4:5', 'Instagram']]) {
      const b = h('button', { role: 'radio', 'aria-checked': 'false', 'data-f': f, 'data-tip': t('ed.formatTip', { f, sub }) }, f, h('small', null, sub));
      b.addEventListener('click', () => this.setFormat(f));
      this.formatSeg.appendChild(b);
    }
    this.formatSeg.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      const fs = Object.keys(Engine.FORMATS); const i = fs.indexOf(this.project.format);
      const n = fs[(i + (e.key === 'ArrowRight' ? 1 : fs.length - 1)) % fs.length];
      this.setFormat(n); $(`[data-f="${n}"]`, this.formatSeg).focus();
    });
    // strumenti dell'anteprima: bande nere, qualità, prima/dopo, cattura fotogramma
    this.blankSel = h('select', { class: 'select select-sm', 'aria-label': t('stage.blanking'), 'data-tip': t('stage.blankingTip') });
    for (const k of Object.keys(Engine.BLANKING)) this.blankSel.appendChild(h('option', { value: k }, t('blank.' + k)));
    this.blankSel.addEventListener('change', () => this.setBlanking(this.blankSel.value));
    this.proxySel = h('select', { class: 'select select-sm', 'aria-label': t('stage.proxy'), 'data-tip': t('stage.proxyTip') });
    for (const [v, k] of [['1', 'full'], ['0.5', 'half'], ['0.25', 'quarter']]) this.proxySel.appendChild(h('option', { value: v }, t('proxy.' + k)));
    this.proxySel.value = String(Prefs.get('proxy', 1));
    this.proxySel.addEventListener('change', () => { Prefs.set('proxy', +this.proxySel.value); this.layoutStage(true); });
    this.cmpBtn = h('button', { class: 'btn btn-ghost btn-icon btn-sm', 'aria-pressed': 'false', 'aria-label': t('stage.compare'), 'data-tip': t('stage.compare'), 'data-key': '⇧ D', html: icon('compare'), onclick: () => this.toggleCompare() });
    const stillBtn = h('button', { class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': t('stage.still'), 'data-tip': t('stage.still'), html: icon('camera'), onclick: () => this.grabStill() });
    this.stageTools = h('div', { class: 'stage-tools' }, h('label', { class: 'mini-field' }, ic('crop'), this.blankSel), h('label', { class: 'mini-field' }, ic('bolt'), this.proxySel), this.cmpBtn, stillBtn);
    this.stageInfo = h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } });
    this.canvas = h('canvas', { width: 960, height: 540, role: 'img', 'aria-label': t('ed.preview') });
    this.stageEmpty = h('div', { class: 'stage-empty' });
    this.stageBusy = h('div', { class: 'stage-busy hidden' }, h('span', { class: 'spinner' }));
    this.cmpBadge = h('div', { class: 'stage-badge hidden', role: 'status' }, t('stage.before'));
    this.frame = h('div', { class: 'stage-frame' }, this.canvas, this.stageEmpty, this.stageBusy, this.cmpBadge);
    this.stage = h('div', { class: 'stage' }, this.frame);
    this.setupPan();
    this.timeEl = h('div', { class: 'tc tnum', 'aria-live': 'off' });
    this.playBtn = h('button', { class: 'btn btn-primary btn-play', 'aria-label': t('ed.play'), 'data-tip': t('ed.play'), 'data-key': t('key.space'), onclick: () => this.player.toggle() });
    const tb = (name, label, key, fn) => h('button', { class: 'btn btn-ghost btn-icon', 'aria-label': label, 'data-tip': label, 'data-key': key, html: icon(name), onclick: fn });
    this.volBtn = h('button', { class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': t('ed.previewVol'), 'data-tip': t('ed.previewMute'), onclick: () => this.togglePreviewMute() });
    this.volRange = h('input', { type: 'range', class: 'range', min: 0, max: 100, step: 1, 'aria-label': t('ed.previewVol') });
    this.volRange.addEventListener('input', () => { const v = +this.volRange.value / 100; this.player.setVolume(v); Prefs.set('previewVol', v); this.renderVol(); });
    const fsBtn = tb('maximize', t('ed.fullscreen'), 'F', () => this.toggleFullscreen());
    const transport = h('div', { class: 'transport' }, this.timeEl,
      h('div', { class: 'ctr' }, tb('toStart', t('ed.toStart'), 'Home', () => this.seek(0)), tb('stepBack', t('ed.frameBack'), '←', () => this.step(-1)), this.playBtn, tb('stepFwd', t('ed.frameFwd'), '→', () => this.step(1)), tb('toEnd', t('ed.toEnd'), 'End', () => this.seek(this.total))),
      h('div', { class: 'right' }, h('div', { class: 'vol' }, this.volBtn, this.volRange), fsBtn));
    const sec = h('section', { class: 'pane ed-center', 'aria-label': t('ed.preview') }, h('div', { class: 'stage-bar' }, this.formatSeg, this.stageTools, this.stageInfo), this.stage, transport);
    this.ro = new ResizeObserver(() => { this.layoutStage(); this.renderTimeline(true); });
    this.ro.observe(this.stage);
    return sec;
  }

  buildProps() {
    this.propsBody = h('div', { class: 'pane-body' });
    this.propsTitle = h('h2', null, ic('sliders'), t('ed.props'));
    const close = h('button', { class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': t('ed.closeProps'), 'data-tip': t('ed.closeProps'), html: icon('x'), onclick: () => this.select([]) });
    return h('aside', { class: 'pane ed-props', 'aria-label': t('ed.props') }, h('div', { class: 'pane-head' }, this.propsTitle, close), this.propsBody);
  }

  renderNotFound() {
    this.root.textContent = '';
    this.root.appendChild(h('div', { class: 'nf' }, h('div', null, h('span', { html: Art.folder() }), h('h1', null, t('ed.notFound')), h('p', null, t('ed.notFoundText')), h('a', { class: 'btn btn-primary', href: '#progetti' }, t('ed.backProjects')))));
  }

  /* ======================= Rendering ======================= */
  renderAll() {
    this.renderSaveState(); this.renderHistoryButtons(); this.renderLib(); this.renderStageInfo();
    this.renderProps(); this.renderTimeline(); this.updateTransport(); this.updateTime(); this.renderVol(); this.renderFormat(); this.renderTools();
  }
  renderSaveState() {
    if (!this.saveEl) return;
    let cls = ''; let iconName = 'cloudOk'; let text;
    if (this.saveState === 'saving') { iconName = 'refresh'; text = t('save.saving'); }
    else if (this.saveState === 'error') { cls = 'warn'; iconName = 'alert'; text = t('save.error'); }
    else if (Cloud.state === 'on') { cls = 'ok'; text = t('save.cloud'); }
    else if (Cloud.state === 'syncing') { iconName = 'cloud'; text = t('save.syncing'); }
    else if (Cloud.state === 'offline') { cls = 'warn'; iconName = 'cloudOff'; text = t('save.offline'); }
    else { cls = 'ok'; iconName = 'device'; text = t('save.local'); }
    this.saveEl.className = 'save-state ' + cls;
    this.saveEl.innerHTML = icon(iconName);
    this.saveEl.appendChild(document.createTextNode(text));
  }
  renderHistoryButtons() {
    this.undoBtn.disabled = !this.history.canUndo();
    this.redoBtn.disabled = !this.history.canRedo();
    this.histBtn.disabled = !this.history.canUndo() && !this.history.canRedo();
    const has = this.hasClips();
    this.exportBtn.disabled = !has;
    this.splitBtn.disabled = !has; this.delBtn.disabled = !this.sel.size; this.dupBtn.disabled = !this.sel.size;
  }
  openHistory() {
    const { past, future } = this.history.list();
    const items = [];
    future.forEach((label, i) => items.push({ icon: 'redo', label: t('ed.histRedo', { what: label }), run: () => { for (let k = future.length - i; k > 0; k--) this.redo(); } }));
    if (future.length) items.push('-');
    items.push({ icon: 'check', label: t('ed.histNow'), disabled: true });
    past.slice().reverse().slice(0, 25).forEach((label, i) => items.push({ icon: 'undo', label: t('ed.histUndo', { what: label }), run: () => { for (let k = 0; k <= i; k++) this.undo(); } }));
    Menu.fromButton(this.histBtn, items);
  }
  renderFormat() {
    for (const b of this.formatSeg.children) b.setAttribute('aria-checked', String(b.dataset.f === this.project.format));
    if (this.blankSel) this.blankSel.value = this.settings.blanking || 'none';
  }
  renderStageInfo() {
    this.renderFormat();
    this.stageEmpty.textContent = '';
    if (!this.hasClips()) {
      this.stageEmpty.appendChild(h('div', null, h('span', { html: icon('film') }), t('ed.stageEmpty')));
    }
  }

  /* ---------------- Media Pool ---------------- */
  missingAssets() { return Object.values(this.project.assets).filter((a) => { const e = Media.get(a.id); return e && e.status === 'missing'; }); }
  setLibFilter(k) {
    this.libFilter = k; Prefs.set('libFilter', k);
    for (const b of this.libTabs.children) b.setAttribute('aria-checked', String(b.dataset.filter === k));
    this.renderLib();
  }
  isUsed(id) { return this.project.tracks.some((tr) => tr.clips.some((c) => c.assetId === id)); }
  renderLib() {
    const all = Object.values(this.project.assets).sort((a, b) => a.addedAt - b.addedAt);
    const counts = { all: all.length, video: 0, image: 0, audio: 0 };
    for (const a of all) counts[a.kind || 'video']++;
    for (const b of this.libTabs.children) b.lastChild.textContent = String(counts[b.dataset.filter] || 0);
    const assets = this.libFilter === 'all' ? all : all.filter((a) => (a.kind || 'video') === this.libFilter);
    this.libCount.textContent = String(all.length);
    this.libCount.setAttribute('aria-label', t('ed.libCount', { n: all.length }));
    // avviso file da ritrovare
    this.libBanner.textContent = '';
    const miss = this.missingAssets();
    if (miss.length) {
      this.libBanner.appendChild(h('div', { class: 'notice warn', style: { marginTop: '12px' } }, ic('link'),
        h('div', null, h('b', null, t('relink.banner', { n: miss.length })), h('div', null, h('button', { class: 'btn btn-sm btn-outline', style: { marginTop: '8px' }, onclick: () => this.openRelink() }, t('relink.cta'))))));
    }
    if (!assets.length) {
      this.libEls = new Map();
      this.libList.textContent = '';
      if (!all.length) {
        this.libList.appendChild(h('div', { class: 'empty' }, h('span', { html: Art.film() }), h('h3', null, t('lib.emptyTitle')), h('p', null, t('lib.emptyText')),
          h('div', { class: 'actions' }, h('button', { class: 'btn btn-outline btn-sm', onclick: () => this.loadSamples() }, ic('sparkle'), t('ed.useSamples')))));
      } else this.libList.appendChild(h('p', { class: 'hint lib-none' }, t('pool.none.' + this.libFilter)));
      this.libList.appendChild(h('div', { class: 'lib-drop' }, t('lib.dropHint')));
      return;
    }
    // aggiornamento mirato: si ricrea solo l'elemento il cui stato è cambiato (hover e focus restano stabili)
    if (!this.libEls) this.libEls = new Map();
    for (const x of $$('.empty, .lib-none', this.libList)) x.remove();
    const focusedId = document.activeElement && document.activeElement.closest && document.activeElement.closest('.lib-item') ? document.activeElement.closest('.lib-item').dataset.asset : null;
    const keep = new Set();
    for (const a of assets) {
      keep.add(a.id);
      const e = Media.get(a.id) || { status: 'loading' };
      const sig = `${e.status}|${e.audioState}|${a.name}|${a.fps}|${a.kind}|${a.duration}`;
      let ref = this.libEls.get(a.id);
      if (!ref || ref.sig !== sig) {
        const el = this.libItem(a);
        if (ref) ref.el.replaceWith(el);
        ref = { el, sig, cv: $('canvas', el) };
        this.libEls.set(a.id, ref);
        if (focusedId === a.id) el.focus({ preventScroll: true });
      } else this.paintLibThumb(ref.cv, a, 0);
      this.libList.appendChild(ref.el);
    }
    for (const [id, ref] of this.libEls) if (!keep.has(id)) { ref.el.remove(); this.libEls.delete(id); }
    let drop = this.libList.querySelector('.lib-drop');
    if (!drop) drop = h('div', { class: 'lib-drop' }, t('lib.dropHint'));
    this.libList.appendChild(drop);
    this.renderLibUsage();
  }
  libItem(a) {
    const e = Media.get(a.id) || { status: 'loading', thumbs: [] };
    const kind = a.kind || 'video';
    const cv = h('canvas', { width: 160, height: 100 });
    this.paintLibThumb(cv, a, 0);
    const used = this.isUsed(a.id);
    const lt = h('div', { class: 'lt' }, cv, h('span', { class: 'kind', 'aria-hidden': 'true', html: icon(kind === 'image' ? 'image' : kind === 'audio' ? 'music' : 'film') }),
      kind === 'image' ? null : h('span', { class: 'dur tnum' }, fmtTime(a.duration, false)), used ? h('span', { class: 'used', 'aria-hidden': 'true', html: icon('check') }) : null);
    const meta = (kind === 'audio' ? [t('pool.kind.audio'), a.audioCodec, fmtBytes(a.size)] : kind === 'image' ? [t('pool.kind.image'), `${a.width}×${a.height}`, fmtBytes(a.size)] : [`${a.width}×${a.height}`, a.fps ? `${Math.round(a.fps * 100) / 100} fps` : null, fmtBytes(a.size)]).filter(Boolean).join(', ');
    let badge = null;
    if (e.status === 'loading') badge = h('span', { class: 'badge' }, h('span', { class: 'spinner', style: { width: '10px', height: '10px', borderWidth: '1.5px' } }), t('lib.preparing'));
    else if (e.status === 'missing') badge = h('span', { class: 'badge warn' }, t('lib.missing'));
    else if (kind === 'image') badge = null;
    else if (e.audioState === 'error') badge = h('span', { class: 'badge warn', title: t('lib.audioErrTip') }, t('lib.audioErr'));
    else if (e.audioState === 'toolarge') badge = h('span', { class: 'badge warn', title: t('lib.audioBigTip') }, t('lib.audioBig'));
    else if (e.audioState === 'none') badge = h('span', { class: 'badge' }, t('lib.noAudio'));
    const addB = h('button', { class: 'btn btn-sm btn-icon btn-primary', 'aria-label': t('lib.addTo', { name: a.name }), 'data-tip': t('lib.add'), html: icon('plus'), onclick: (ev) => { ev.stopPropagation(); this.addToTimeline([a.id]); } });
    const moreB = h('button', { class: 'btn btn-sm btn-icon btn-ghost', 'aria-label': t('lib.more', { name: a.name }), 'aria-haspopup': 'menu', html: icon('more') });
    moreB.addEventListener('click', (ev) => { ev.stopPropagation(); this.libMenu(a, moreB); });
    if (e.status !== 'ready') addB.disabled = true;
    const el = h('div', {
      class: 'lib-item k-' + kind + (e.status === 'loading' ? ' loading' : '') + (e.status === 'missing' ? ' missing' : ''), role: 'listitem', tabindex: '0', 'data-asset': a.id,
      'aria-label': t('lib.itemLabel.' + kind, { name: a.name, dur: fmtDur(a.duration) }),
    }, lt, h('div', { class: 'li' }, h('b', { title: a.name }, a.name), h('span', null, meta), badge), h('div', { class: 'la' }, addB, moreB));
    if (kind === 'video') {
      lt.addEventListener('pointermove', (ev) => { const r = lt.getBoundingClientRect(); this.paintLibThumb(cv, a, (ev.clientX - r.left) / r.width); });
      lt.addEventListener('pointerleave', () => this.paintLibThumb(cv, a, 0));
    }
    el.addEventListener('dblclick', () => { if (Media.get(a.id)?.status === 'ready') this.addToTimeline([a.id]); });
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && ev.target === el) { ev.preventDefault(); if (Media.get(a.id)?.status === 'ready') this.addToTimeline([a.id]); }
      if ((ev.key === 'ContextMenu' || (ev.shiftKey && ev.key === 'F10')) && ev.target === el) { ev.preventDefault(); this.libMenu(a, moreB); }
    });
    el.addEventListener('pointerdown', (ev) => { if (ev.button === 0 && !ev.target.closest('button')) this.startLibDrag(ev, a); });
    el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); this.libMenu(a, null, ev.clientX, ev.clientY); });
    return el;
  }
  paintLibThumb(cv, a, frac) {
    const e = Media.get(a.id);
    const g = cv.getContext('2d');
    g.fillStyle = '#0a0716'; g.fillRect(0, 0, cv.width, cv.height);
    if (!e) return;
    if ((a.kind || 'video') === 'audio') {
      if (!e.peaks) return;
      const css = getComputedStyle(this.root);
      g.fillStyle = css.getPropertyValue('--success').trim() || '#45dfa0';
      const n = cv.width; const mid = cv.height / 2;
      for (let x = 0; x < n; x += 2) {
        const i0 = Math.floor((x / n) * e.peaks.length); const i1 = Math.max(i0 + 1, Math.floor(((x + 2) / n) * e.peaks.length));
        let m = 0; for (let i = i0; i < i1 && i < e.peaks.length; i++) if (e.peaks[i] > m) m = e.peaks[i];
        const hh = Math.max(1, m * mid * 0.9); g.fillRect(x, mid - hh, 1.5, hh * 2);
      }
      return;
    }
    if (!e.thumbs.length) return;
    const i = Math.min(e.thumbs.length - 1, Math.max(0, Math.floor(frac * e.thumbs.length)));
    const src = e.thumbs[i];
    drawFrame(g, cv.width, cv.height, src, src.width, src.height, { fit: 'fill' });
  }
  renderLibUsage() {
    for (const el of $$('.lib-item', this.libList)) {
      const id = el.dataset.asset;
      const used = this.isUsed(id);
      const lt = $('.lt', el); const u = $('.used', lt);
      if (used && !u) lt.appendChild(h('span', { class: 'used', 'aria-hidden': 'true', html: icon('check') }));
      if (!used && u) u.remove();
    }
  }
  libMenu(a, btn, x, y) {
    const e = Media.get(a.id);
    const kind = a.kind || 'video';
    const ready = e && e.status === 'ready';
    const items = [
      { icon: 'plus', label: t('lib.add'), disabled: !ready, run: () => this.addToTimeline([a.id]) },
      kind === 'image' ? { icon: 'layers', label: t('lib.addV2'), disabled: !ready, run: () => this.addToTimeline([a.id], null, { lane: 'v2' }) } : null,
      kind === 'video' && e && e.audio ? { icon: 'music', label: t('lib.addA1'), disabled: !ready, run: () => this.addToTimeline([a.id], null, { lane: 'a1' }) } : null,
      { icon: 'info', label: t('lib.info'), run: () => this.assetInfo(a) },
      e && e.status === 'missing' ? { icon: 'link', label: t('relink.cta'), run: () => this.openRelink() } : null,
      '-',
      { icon: 'trash', label: t('lib.remove'), danger: true, run: () => this.removeAsset(a) },
    ].filter(Boolean);
    if (btn) Menu.fromButton(btn, items); else Menu.open(items, x, y);
  }
  assetInfo(a) {
    const e = Media.get(a.id) || {};
    const kind = a.kind || 'video';
    const row = (k, v) => h('div', { class: 'props-row' }, h('span', null, k), h('span', { class: 'v' }, v));
    const audio = e.audioState === 'ready' ? (a.audioCodec || t('info.yes')) : e.audioState === 'none' ? t('info.no') : e.audioState === 'pending' ? t('lib.preparing') : t('lib.audioErr');
    const rows = [row(t('info.kind'), t('pool.kind.' + kind))];
    if (kind !== 'image') rows.push(row(t('info.duration'), fmtDur(a.duration)));
    if (kind !== 'audio') rows.push(row(t('info.res'), `${a.width}×${a.height}`));
    if (kind === 'video') rows.push(row(t('info.fps'), a.fps ? `${a.fps} fps` : t('info.unknown')), row(t('info.codec'), a.codec || t('info.unknown')));
    if (kind === 'image') rows.push(row(t('info.codec'), a.codec || t('info.unknown')));
    if (kind !== 'image') rows.push(row(t('info.audio'), audio));
    rows.push(row(t('info.size'), fmtBytes(a.size)), row(t('info.where'), t('info.local')));
    const m = modal({
      title: a.name, label: 'ai', desc: t('info.desc'),
      body: h('div', null, rows),
      foot: h('button', { class: 'btn btn-primary', onclick: () => m.close() }, t('common.ok')),
    });
  }
  async removeAsset(a) {
    const uses = this.project.tracks.reduce((n, tr) => n + tr.clips.filter((c) => c.assetId === a.id).length, 0);
    const ok = await confirmDialog({
      title: t('lib.removeTitle', { name: a.name }),
      body: uses ? t('lib.removeUsed', { n: uses }) : t('lib.removeText'),
      confirm: t('lib.removeOk'), danger: true,
    });
    if (!ok) return;
    const before = this.snapshot();
    const assets = { ...this.project.assets }; delete assets[a.id];
    this.history.push(t('h.removeVideo'), before);
    const keep = (arr) => arr.filter((c) => c.assetId !== a.id);
    this.applyState({ ...before, clips: keep(before.clips), v2: keep(before.v2), a1: keep(before.a1), assets });
    this.project.assets = assets; // la rimozione dalla libreria è effettiva subito
    this.afterChange(false);
    this.renderLib();
  }

  /* ---------------- Importazione ---------------- */
  /** target: null (solo libreria), numero (spazio in V1) oppure { lane, gap, time }. */
  async importFiles(files, target = null) {
    const list = [...files].filter(Boolean);
    if (!list.length) return [];
    const heavy = list.filter((f) => f.size > HEAVY_FILE && f.size <= MAX_FILE);
    if (heavy.length) Toast.show(t('imp.heavy', { n: heavy.length }), { duration: 6000 });
    const added = [];
    for (const f of list) {
      let placeholder = null;
      try {
        const asset = await Media.importFile(f, { imageDur: this.settings.imageDur, onMeta: (meta) => { placeholder = meta.id; this.project.assets = { ...this.project.assets, [meta.id]: meta }; this.renderLib(); } });
        added.push(asset);
        this.markDirty();
      } catch (err) {
        if (placeholder) { const as = { ...this.project.assets }; delete as[placeholder]; this.project.assets = as; }
        if (!(err instanceof MediaError2)) ErrLog.add('import', err);
        Toast.show(Media.errorText(err instanceof MediaError2 ? err : new MediaError2('generic'), f.name), { type: 'err', duration: 9000 });
      }
      if (this.destroyed) return added;
      this.renderLib();
    }
    if (added.length) {
      if (target !== null) {
        const o = typeof target === 'number' ? { gap: target } : target;
        this.addToTimeline(added.map((a) => a.id), o.gap === undefined ? null : o.gap, o);
      } else {
        Toast.show(t('imp.done', { n: added.length }), { type: 'ok', duration: 3000 });
        if (!this.hasClips()) Tips.show(this.tipSlot, 'drag', t('tip.drag'));
      }
    }
    return added;
  }
  clipOpts(extra) { return { fit: this.settings.scaling, imageDur: this.settings.imageDur, ...extra }; }
  /**
   * Aggiunge file della libreria alla timeline. Video e immagini vanno in V1
   * (nello spazio `gap`, in coda se null), l'audio in A1 al cursore.
   * opts.lane: 'v2' (immagini sovrapposte) o 'a1' (audio di un video); opts.time: istante di rilascio.
   */
  addToTimeline(assetIds, gap = null, opts = {}) {
    const ready = assetIds.filter((id) => { const e = Media.get(id); return e && e.status === 'ready' && this.project.assets[id]; });
    if (!ready.length) return;
    const wasEmpty = !this.hasClips();
    const kindOf = (id) => this.project.assets[id].kind || 'video';
    const lane = opts.lane || 'v1';
    const toV1 = []; const toV2 = []; const toA1 = [];
    for (const id of ready) {
      const k = kindOf(id);
      if (k === 'audio' || (lane === 'a1' && k === 'video')) toA1.push(id);
      else if (lane === 'v2' && k === 'image') toV2.push(id);
      else toV1.push(id);
    }
    const t0 = opts.time !== undefined ? Math.max(0, opts.time) : this.t;
    const newV1 = toV1.map((id) => Engine.clipFromAsset(this.project.assets[id], uid('c'), this.clipOpts()));
    const at = gap === null ? this.clips.length : gap;
    let newIds = newV1.map((c) => c.id);
    this.commit(ready.length > 1 ? t('h.addMany', { n: ready.length }) : t('h.add'), (s) => {
      const res = {};
      if (newV1.length) res.clips = Engine.insert(s.clips, newV1, at);
      let v2 = s.v2; let a1 = s.a1; let tt = t0;
      for (const id of toV2) { const c = Engine.clipFromAsset(this.project.assets[id], uid('c'), this.clipOpts({ start: tt })); v2 = Engine.insertFree(v2, c); newIds.push(c.id); tt = Engine.endOf(v2.find((x) => x.id === c.id)); }
      tt = t0;
      for (const id of toA1) { const c = Engine.clipFromAsset(this.project.assets[id], uid('c'), this.clipOpts({ start: tt })); a1 = Engine.insertFree(a1, c); newIds.push(c.id); tt = Engine.endOf(a1.find((x) => x.id === c.id)); }
      if (v2 !== s.v2) res.v2 = v2;
      if (a1 !== s.a1) res.a1 = a1;
      return res;
    });
    this.sel = new Set(newIds);
    this.renderTimeline(); this.renderProps(); this.renderHistoryButtons();
    if (wasEmpty) { this.zoomFit(); this.seek(newV1.length ? 0 : this.t); }
    else if (newV1.length) this.seek(Engine.startOf(this.clips, newV1[0].id));
    else this.renderTimeline();
    Tips.hide();
    if (newV1.length) Tips.show(this.tipSlot, 'split', t('tip.split'));
    else if (toA1.length) Tips.show(this.tipSlot, 'audio', t('tip.audio'));
  }
  /** Titolo o livello di regolazione sulla traccia V2, al cursore. */
  addSynthetic(kind) {
    let id = null; let placed = this.t;
    const len = kind === 'text' ? 4 : 5;
    const ok = this.commit(kind === 'text' ? t('h.addText') : t('h.addAdjust'), (s) => {
      const c = Engine.clipSynthetic(kind, uid('c'), this.t, len, kind === 'text' ? t('text.default') : '');
      if (kind === 'text') c.tf = { ...Engine.DEF.tf, y: 0.3 };
      id = c.id;
      const v2 = Engine.insertFree(s.v2, c);
      placed = v2.find((x) => x.id === id).start;
      return { v2 };
    });
    if (!ok) return;
    if (Math.abs(placed - this.t) > 0.05) Toast.show(t('ed.placedAt', { t: fmtTime(placed) }), { duration: 4000 });
    if (this.total > 0 && this.pps * this.total < 40) this.zoomFit();
    this.select([id]);
    this.inspTab = kind === 'adjust' ? 'color' : 'video'; Prefs.set('inspTab', this.inspTab);
    this.renderProps();
    Toast.show(kind === 'text' ? t('ed.textAdded') : t('ed.adjustAdded'), { type: 'ok', duration: 2500 });
  }
  async loadSamples() {
    if (this.sampleBusy) return;
    this.sampleBusy = true;
    const bar = h('span'); const pct = h('span', { class: 'tnum' }, '0%');
    const m = modal({ title: t('sample.title'), label: 'sm', desc: t('sample.desc'), closable: false, body: h('div', { style: { display: 'grid', gap: '10px' } }, h('div', { class: 'progress' }, bar), h('div', { class: 'hint' }, pct)) });
    try {
      const files = await Samples.generate((f) => { bar.style.width = Math.round(f * 100) + '%'; pct.textContent = Math.round(f * 100) + '%'; });
      m.close();
      if (this.destroyed) return;
      const added = await this.importFiles(files, this.clips.length);
      if (added.length && !Prefs.get('tourDone', false)) setTimeout(() => !this.destroyed && this.startTour(1), 500);
    } catch (e) {
      ErrLog.add('samples', e);
      m.close();
      Toast.show(t('sample.fail'), { type: 'err', duration: 8000 });
    } finally { this.sampleBusy = false; }
  }
  onMediaUpdate(id) {
    if (this.destroyed || !this.project.assets[id]) return;
    clearTimeout(this._mediaT);
    this._mediaT = setTimeout(() => { if (this.destroyed) return; this.renderLib(); this.renderTimeline(); this.drawStrips(true); if (!this.player.playing) this.player.renderAt(this.t); }, 120);
  }

  /* ---------------- Formato e anteprima ---------------- */
  setFormat(f) {
    if (f === this.project.format) return;
    this.commit(t('h.format', { f }), () => ({ format: f }));
    this.renderFormat();
    const mismatch = this.clips.some((c) => { const a = this.project.assets[c.assetId]; return a && Math.abs(a.width / a.height - Engine.FORMATS[f].w / Engine.FORMATS[f].h) > 0.02 && c.fit !== 'fill'; });
    if (mismatch) Tips.show(this.tipSlot, 'fill', t('tip.fill'));
  }
  setBlanking(v) {
    if (v === this.settings.blanking) return;
    this.commit(t('h.blanking'), () => ({ blanking: v }));
    this.renderFormat();
  }
  layoutStage(force) {
    if (!this.stage || !this.project) return;
    const f = Engine.FORMATS[this.project.format];
    const r = this.stage.getBoundingClientRect();
    const availW = Math.max(60, r.width - 28); const availH = Math.max(60, r.height - 12);
    let w = availW; let hh = (w * f.h) / f.w;
    if (hh > availH) { hh = availH; w = (hh * f.w) / f.h; }
    this.frame.style.width = Math.floor(w) + 'px'; this.frame.style.height = Math.floor(hh) + 'px';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const proxy = Prefs.get('proxy', 1) || 1;               // qualità anteprima: non influisce sull'esportazione
    let cw = Math.round(w * dpr * proxy); let ch = Math.round(hh * dpr * proxy);
    const s = Math.min(1, 1920 / Math.max(cw, ch)); cw = Math.max(16, Math.round(cw * s)); ch = Math.max(16, Math.round(ch * s));
    if (this.canvas.width !== cw || this.canvas.height !== ch || force) { this.canvas.width = cw; this.canvas.height = ch; if (this.player) this.player.redraw(); }
  }
  updateTransport() {
    if (!this.player) return;
    const busy = this.player.waiting;
    this.playBtn.innerHTML = busy ? '<span class="spinner"></span>' : icon(this.player.playing ? 'pause' : 'play');
    const label = this.player.playing ? t('ed.pause') : t('ed.play');
    this.playBtn.setAttribute('aria-label', label); this.playBtn.dataset.tip = label;
    this.playBtn.disabled = !this.hasClips();
  }
  updateTime() {
    if (!this.timeEl) return;
    this.timeEl.textContent = '';
    this.timeEl.append(fmtTime(this.t), ' ', h('span', null, '/ ' + fmtTime(this.total)));
  }
  renderVol() {
    const v = this.player ? this.player.volume : 1;
    this.volRange.value = String(Math.round(v * 100));
    this.volRange.style.setProperty('--p', Math.round(v * 100) + '%');
    this.volBtn.innerHTML = icon(v === 0 ? 'mute' : 'volume');
  }
  togglePreviewMute() {
    const v = this.player.volume > 0 ? 0 : (this.lastVol || 1);
    if (this.player.volume > 0) this.lastVol = this.player.volume;
    this.player.setVolume(v); Prefs.set('previewVol', v); this.renderVol();
  }
  /** Prima / Dopo (Maiusc+D): disattiva temporaneamente le correzioni colore nell'anteprima. */
  toggleCompare() {
    this.player.bypass = !this.player.bypass;
    this.cmpBtn.setAttribute('aria-pressed', String(this.player.bypass));
    this.cmpBtn.classList.toggle('is-active', this.player.bypass);
    this.cmpBadge.classList.toggle('hidden', !this.player.bypass);
    this.player.redraw();
    Toast.show(this.player.bypass ? t('stage.beforeOn') : t('stage.beforeOff'), { duration: 1800 });
    if (this._cmpSync) this._cmpSync();
  }
  /** Cattura fotogramma: PNG alla risoluzione piena del progetto, con tutte le correzioni. */
  async grabStill() {
    if (!this.hasClips()) { Toast.show(t('exp.empty'), { duration: 3000 }); return; }
    if (this.player.playing) this.player.pause();
    const d = Exporter.dims(this.project.format, Exporter.maxRes(this.project));
    const cv = document.createElement('canvas'); cv.width = d.w; cv.height = d.h;
    const was = this.player.bypass; this.player.bypass = false;
    try {
      await this.player.renderTo(cv, this.t);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      if (!blob) throw new Error('png');
      const base = (this.project.name || 'still').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'still';
      const res = await saveFile(`${base} ${fmtTime(this.t).replace(/[:.]/g, '-')}.png`, blob);
      if (res === 'saved') Toast.show(t('stage.stillSaved', { w: d.w, h: d.h }), { type: 'ok', duration: 3000 });
    } catch (e) { ErrLog.add('still', e); Toast.show(t('stage.stillFail'), { type: 'err' }); }
    finally { this.player.bypass = was; this.player.redraw(); }
  }
  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await this.stage.requestFullscreen();
      setTimeout(() => this.layoutStage(), 120);
    } catch { Toast.show(t('ed.fsUnavailable'), { type: 'err' }); }
  }
  seek(t) { this.player.seek(Math.max(0, Math.min(this.total, t))); }
  step(dir, sec) {
    if (this.player.playing) this.player.pause();
    const d = sec || 1 / (this.project.fps || 30);
    const tt = Math.round((this.t + dir * d) * 30) / 30;
    this.seek(tt);
  }
  /** Clip V1 sotto il cursore: in modalità Riempi l'inquadratura si sposta trascinando. */
  setupPan() {
    let drag = null;
    const clipAtHead = () => { const loc = Engine.locate(this.clips, this.t); return loc && !loc.atEnd ? loc.clip : null; };
    this.frame.addEventListener('pointermove', () => {
      if (drag) return;
      const c = clipAtHead();
      this.frame.classList.toggle('pannable', !!(c && c.fit === 'fill' && this.panRange(c)));
    });
    this.frame.addEventListener('pointerdown', (e) => {
      const c = clipAtHead();
      if (!c || c.fit !== 'fill' || e.button !== 0) return;
      const rng = this.panRange(c);
      if (!rng) return;
      if (this.player.playing) this.player.pause();
      drag = { id: c.id, x: e.clientX, y: e.clientY, ox: c.ox || 0, oy: c.oy || 0, rng, rect: this.frame.getBoundingClientRect() };
      this.frame.setPointerCapture(e.pointerId); this.frame.classList.add('panning');
      this.beginLive();
    });
    this.frame.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const sx = drag.rect.width; const sy = drag.rect.height;
      // pixel dello schermo → valore di inquadratura (-1..1)
      const nx = drag.rng.x > 0 ? clamp(drag.ox - ((e.clientX - drag.x) / sx) * (2 / drag.rng.x), -1, 1) : 0;
      const ny = drag.rng.y > 0 ? clamp(drag.oy - ((e.clientY - drag.y) / sy) * (2 / drag.rng.y), -1, 1) : 0;
      const next = Engine.patch(this.clips, [drag.id], { ox: r4(nx), oy: r4(ny) });
      if (next) { this.setLive(next); this.renderProps(true); }
    });
    const end = () => { if (!drag) return; drag = null; this.frame.classList.remove('panning'); this.endLive(t('h.pan')); };
    this.frame.addEventListener('pointerup', end);
    this.frame.addEventListener('pointercancel', end);
  }
  /** Quanto la clip in modalità Riempi eccede il fotogramma (in frazioni del fotogramma). */
  panRange(c) {
    const a = this.project.assets[c.assetId]; if (!a || !a.width) return null;
    const f = Engine.FORMATS[this.project.format];
    const W = f.w; const H = f.h;
    const s = Math.max(W / a.width, H / a.height);
    const x = (a.width * s - W) / W; const y = (a.height * s - H) / H;
    return x > 0.005 || y > 0.005 ? { x, y } : null;
  }

  /* ---------------- Comandi di montaggio ---------------- */
  /** S: divide le clip selezionate sotto il cursore; se nessuna, la clip V1 al cursore. */
  split() {
    if (!this.hasClips()) return;
    if (this.player.playing) this.player.pause();
    const under = this.selected().filter(({ lane, clip }) => {
      const s = lane === 'v1' ? Engine.startOf(this.clips, clip.id) : clip.start || 0;
      return this.t > s + 1e-6 && this.t < s + Engine.dur(clip) - 1e-6 && lane !== 'v1';
    });
    if (under.length) { for (const u of under) this.splitClipAt(u.clip.id, this.t); return; }
    const res = Engine.split(this.clips, this.t, uid('c'));
    if (res.error) { Toast.show(res.error === 'edge' ? t('ed.splitEdge') : t('ed.splitNone'), { duration: 3500 }); return; }
    this.commit(t('h.split'), () => ({ clips: res.clips }));
    this.select([res.rightId]);
    Tips.show(this.tipSlot, 'trim', t('tip.trim'));
  }
  /** Divide una clip di qualsiasi traccia al tempo t (strumento Lametta). */
  splitClipAt(id, tt) {
    const f = this.findClip(id); if (!f) return false;
    const nid = uid('c');
    let res;
    if (f.lane === 'v1') {
      const st = Engine.startOf(this.clips, id);
      const local = tt - st;
      if (local < Engine.MIN_CLIP || Engine.dur(f.clip) - local < Engine.MIN_CLIP) { Toast.show(t('ed.splitEdge'), { duration: 2500 }); return false; }
      res = Engine.split(this.clips, tt, nid);
      if (res.error) return false;
      this.commit(t('h.split'), () => ({ clips: res.clips }));
    } else {
      res = Engine.splitFree(this.trackClips(f.lane), id, tt, nid);
      if (res.error) { Toast.show(t('ed.splitEdge'), { duration: 2500 }); return false; }
      this.commit(t('h.split'), () => ({ [TRACK_KEY[f.lane]]: res.clips }));
    }
    this.select([res.rightId]);
    return true;
  }
  deleteSel() {
    if (!this.sel.size) { Toast.show(t('ed.selectFirst'), { duration: 2500 }); return; }
    const n = this.sel.size;
    const first = this.clips.findIndex((c) => this.sel.has(c.id));
    const ok = this.commit(n > 1 ? t('h.deleteMany', { n }) : t('h.delete'), (s) => {
      const out = {};
      for (const key of ['clips', 'v2', 'a1']) { const r = Engine.remove(s[key], this.sel); if (r) out[key] = r; }
      return Object.keys(out).length ? out : null;
    });
    if (!ok) return;
    this.sel = new Set();
    const L = Engine.layout(this.clips);
    if (first >= 0 && L.length) this.seek(L[Math.min(first, L.length - 1)].start);
    this.renderTimeline(); this.renderProps(); this.renderHistoryButtons();
    Toast.show(n > 1 ? t('ed.deletedN', { n }) : t('ed.deleted'), { action: () => this.undo(), actionLabel: t('ed.undo'), duration: 5000 });
  }
  duplicateSel() {
    if (!this.sel.size) { Toast.show(t('ed.selectFirst'), { duration: 2500 }); return; }
    let newIds = [];
    this.commit(t('h.duplicate'), (s) => {
      const out = {};
      const r1 = Engine.duplicate(s.clips, this.sel, () => uid('c')); if (r1) { out.clips = r1.clips; newIds = newIds.concat(r1.newIds); }
      for (const key of ['v2', 'a1']) { const r = Engine.duplicateFree(s[key], this.sel, () => uid('c')); if (r) { out[key] = r.clips; newIds = newIds.concat(r.newIds); } }
      return Object.keys(out).length ? out : null;
    });
    if (newIds.length) this.select(newIds);
  }
  moveSel(dir) {
    if (this.sel.size !== 1) return;
    const id = [...this.sel][0];
    const f = this.findClip(id); if (!f) return;
    if (f.lane !== 'v1') {
      const step = dir * Math.max(1 / 30, 10 / this.pps);
      if (this.commit(t('h.move'), (s) => { const n = Engine.moveFree(s[TRACK_KEY[f.lane]], [id], step); return n ? { [TRACK_KEY[f.lane]]: n } : null; })) {
        const ref = this.clipEls.get(id); if (ref) ref.el.focus({ preventScroll: true });
      }
      return;
    }
    const i = this.clips.findIndex((c) => c.id === id);
    const gap = dir < 0 ? i - 1 : i + 2;
    if (gap < 0 || gap > this.clips.length) return;
    if (this.commit(t('h.move'), (s) => { const n = Engine.move(s.clips, [id], gap); return n ? { clips: n } : null; })) {
      this.seek(Engine.startOf(this.clips, id));
      const ref = this.clipEls.get(id); if (ref) ref.el.focus({ preventScroll: true });
    }
  }
  trimToHead(side) {
    const id = [...this.sel][0];
    const f = this.findClip(id); if (!f) return;
    const c = f.clip;
    const st = this.startOfClip(id);
    const v = Engine.sourceTime(c, this.t - st);
    const key = TRACK_KEY[f.lane];
    const fn = f.lane === 'v1' ? Engine.trim : Engine.trimFree;
    if (this.commit(t('h.trim'), (s) => { const n = fn(s[key], id, side, v, this.srcDur(c)); return n ? { [key]: n } : null; })) {
      this.seek(side === 'in' ? this.startOfClip(id) : this.t);
    }
  }
  /** D: attiva o disattiva le clip selezionate. */
  toggleDisabled() {
    const sel = this.selected();
    if (!sel.length) { Toast.show(t('ed.selectFirst'), { duration: 2500 }); return; }
    const off = !sel.every(({ clip }) => clip.disabled);
    this.commitSel(off ? t('h.disable') : t('h.enable'), { disabled: off });
    Toast.show(off ? t('ed.disabledN', { n: sel.length }) : t('ed.enabledN', { n: sel.length }), { duration: 2200 });
  }
  setLabel(color) { this.commitSel(t('h.label'), { label: color || undefined }); }
  /** Velocità delle clip selezionate (solo video e audio; in V2/A1 serve spazio libero). */
  setSpeed(sp) {
    const sel = this.selected().filter(({ clip }) => this.hasSource(clip));
    if (!sel.length) { Toast.show(t('speed.none'), { duration: 2500 }); return; }
    let blocked = 0;
    const ok = this.commit(t('h.speed', { s: sp }), (s) => {
      const out = {};
      for (const lane of ['v1', 'v2', 'a1']) {
        const key = TRACK_KEY[lane]; let arr = s[key];
        for (const { clip } of sel.filter((x) => x.lane === lane)) {
          if (lane !== 'v1') {
            const d = (clip.out - clip.in) / sp;
            if (Math.abs(Engine.fitFree(arr, [clip.id], clip.start || 0, d) - (clip.start || 0)) > 1e-6) { blocked++; continue; }
          }
          const n = Engine.patch(arr, [clip.id], { speed: sp }); if (n) arr = n;
        }
        if (arr !== s[key]) out[key] = arr;
      }
      return Object.keys(out).length ? out : null;
    });
    if (blocked) Toast.show(t('speed.blocked', { n: blocked }), { type: 'err', duration: 4000 });
    else if (ok) Toast.show(t('speed.done', { s: fmtSpeed(sp) }), { duration: 2000 });
  }
  openSpeedMenu(x, y) {
    const sel = this.selected().filter(({ clip }) => this.hasSource(clip));
    if (!sel.length) { Toast.show(t('speed.none'), { duration: 2500 }); return; }
    const cur = sel[0].clip.speed || 1;
    if (x === undefined) { const r = this.tlScroll.getBoundingClientRect(); x = r.left + 40; y = r.top + 10; }
    Menu.open(Engine.SPEEDS.map((sp) => ({ icon: sp === cur ? 'check' : 'gauge', label: fmtSpeed(sp), run: () => this.setSpeed(sp) })), x, y);
  }
  /** Ctrl+C: copia gli attributi della clip selezionata. */
  copyAttrs() {
    const sel = this.selected();
    if (sel.length !== 1) { Toast.show(t('attr.selectOne'), { duration: 2500 }); return; }
    const c = sel[0].clip;
    this.attrClip = { attrs: Engine.pickAttrs(c), name: this.clipName(c) };
    Toast.show(t('attr.copied', { name: this.attrClip.name }), { type: 'ok', duration: 2500 });
  }
  rename(name) {
    const v = name.trim().slice(0, 80);
    if (!v) { this.nameInput.value = this.project.name; return; }
    if (v === this.project.name) return;
    this.project.name = v; this.markDirty();
    Toast.show(t('ed.renamed'), { type: 'ok', duration: 2000 });
  }
  /** Backup del progetto (struttura, senza i file) in JSON. */
  async exportProjectJson() {
    this.saveSoon.flush();
    try { const res = await ProjectFile.download(this.project); if (res === 'saved') Toast.show(t('proj.exported'), { type: 'ok', duration: 2500 }); }
    catch (e) { ErrLog.add('export-json', e); Toast.show(t('proj.exportFail'), { type: 'err' }); }
  }

  /* ---------------- Tastiera ---------------- */
  onKey(e) {
    if (this.destroyed || !this.project) return;
    if (document.querySelector('dialog[open]') || Tour.active || Menu.cur) return;
    if (isTyping(e)) return;
    if (getComputedStyle(this.ed).display === 'none') return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key; const code = e.code;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (mod && !e.shiftKey && (k === 'z' || k === 'Z')) { handled(); this.undo(); return; }
    if (mod && ((e.shiftKey && (k === 'z' || k === 'Z')) || k === 'y' || k === 'Y')) { handled(); this.redo(); return; }
    if (mod && (k === 'd' || k === 'D')) { handled(); this.duplicateSel(); return; }
    if (mod && (k === 's' || k === 'S')) { handled(); this.saveSoon.cancel(); this.saveNow().then(() => Toast.show(t('ed.savedNow'), { type: 'ok', duration: 2000 })); return; }
    if (mod && (k === 'e' || k === 'E')) { handled(); this.openExport(); return; }
    if (mod && (k === 'a' || k === 'A')) { handled(); this.select(this.project.tracks.flatMap((tr) => tr.clips.map((c) => c.id))); return; }
    if (mod && !e.shiftKey && !e.altKey && code === 'KeyC') { if (window.getSelection && String(window.getSelection())) return; handled(); this.copyAttrs(); return; }
    if (mod && !e.shiftKey && code === 'KeyR') { handled(); this.openSpeedMenu(); return; }
    if (mod) return;
    if (e.altKey && code === 'KeyV') { handled(); this.openPasteAttrs(); return; }
    if (e.shiftKey && code === 'KeyD') { handled(); this.toggleCompare(); return; }
    const inKnobOrRange = e.target && e.target.type === 'range';
    if (e.altKey && !['ArrowLeft', 'ArrowRight'].includes(k)) return;
    switch (k) {
      case ' ': if (e.target.tagName === 'BUTTON') return; handled(); this.player.toggle(); break;
      case 's': case 'S': handled(); this.split(); break;
      case 'Delete': case 'Backspace': handled(); this.deleteSel(); break;
      case 'ArrowLeft': case 'ArrowRight': {
        if (inKnobOrRange || e.target.getAttribute('role') === 'radio' || e.target.getAttribute('role') === 'separator' || e.target.getAttribute('role') === 'tab') return;
        handled();
        const dir = k === 'ArrowLeft' ? -1 : 1;
        if (e.altKey) this.moveSel(dir); else this.step(dir, e.shiftKey ? 1 : 0);
        break;
      }
      case 'ArrowUp': case 'ArrowDown':
        if (!e.shiftKey || inKnobOrRange) return;
        handled(); this.jumpMarker(k === 'ArrowUp' ? -1 : 1); break;
      case 'Home': handled(); this.seek(0); break;
      case 'End': handled(); this.seek(this.total); break;
      case '+': case '=': handled(); this.zoomBy(1.4); break;
      case '-': case '_': handled(); this.zoomBy(1 / 1.4); break;
      case '?': handled(); openShortcuts(); break;
      case 'f': case 'F': handled(); this.toggleFullscreen(); break;
      case 'a': case 'A': handled(); this.setTool('pointer'); break;
      case 'b': case 'B': handled(); this.setTool('blade'); break;
      case 't': case 'T': handled(); this.setTool('slip'); break;
      case 'n': case 'N': handled(); this.toggleSnap(); break;
      case 'm': case 'M': handled(); this.addMarker(); break;
      case 'd': case 'D': handled(); this.toggleDisabled(); break;
      case 'Escape': if (this.tool !== 'pointer') { handled(); this.setTool('pointer'); } else if (this.sel.size) { handled(); this.select([]); } break;
      default:
    }
  }

  /* ---------------- Trascinamento dal computer ---------------- */
  setupDrop() {
    let depth = 0;
    const hasFiles = (ev) => ev.dataTransfer && [...ev.dataTransfer.types].includes('Files');
    this.listen(window, 'dragenter', (ev) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault(); depth++;
      if (!this.dropOverlay) {
        this.dropOverlay = h('div', { class: 'drop-overlay' }, h('div', null, h('span', { html: icon('upload') }), t('ed.dropHere'), h('p', { class: 'hint', style: { fontSize: '14px', fontWeight: 600, marginTop: '6px' } }, t('ed.dropHint'))));
        document.body.appendChild(this.dropOverlay);
      }
    });
    this.listen(window, 'dragover', (ev) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy';
      const tg = this.dropTarget(ev.clientX, ev.clientY, null);
      if (tg) this.showDropMark(tg); else this.insertMark.classList.add('hidden');
    });
    this.listen(window, 'dragleave', (ev) => { if (!hasFiles(ev)) return; depth = Math.max(0, depth - 1); if (!depth && this.dropOverlay) { this.dropOverlay.remove(); this.dropOverlay = null; this.insertMark.classList.add('hidden'); } });
    this.listen(window, 'drop', (ev) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault(); depth = 0;
      if (this.dropOverlay) { this.dropOverlay.remove(); this.dropOverlay = null; }
      this.insertMark.classList.add('hidden');
      const files = [...ev.dataTransfer.files];
      const tg = this.dropTarget(ev.clientX, ev.clientY, null);
      this.importFiles(files, tg ? { lane: tg.lane, gap: tg.lane === 'v1' ? tg.gap : undefined, time: tg.lane === 'v1' ? undefined : tg.time } : null);
    });
  }

  /* ---------------- Pannelli ridimensionabili ---------------- */
  loadLayout() {
    const l = Prefs.get('layout', {}) || {};
    if (l.lib) this.ed.style.setProperty('--lib-w', l.lib + 'px');
    if (l.props) this.ed.style.setProperty('--props-w', l.props + 'px');
    if (l.tl) this.ed.style.setProperty('--tl-h', l.tl + 'px');
    this.renderSnap();
  }
  setupResizers() {
    const conf = [['.rz-l', '--lib-w', 'lib', 220, 440, 'x', 1], ['.rz-r', '--props-w', 'props', 270, 460, 'x', -1], ['.rz-t', '--tl-h', 'tl', 250, 560, 'y', -1]];
    for (const [sel, prop, key, mn, mx, axis, sign] of conf) {
      const el = $(sel, this.ed);
      const cur = () => parseFloat(getComputedStyle(this.ed).getPropertyValue(prop)) || mn;
      const set = (v) => {
        const lim = key === 'tl' ? Math.min(mx, innerHeight - 300) : mx;
        v = clamp(Math.round(v), mn, Math.max(mn, lim));
        this.ed.style.setProperty(prop, v + 'px');
        const l = Prefs.get('layout', {}) || {}; l[key] = v; Prefs.set('layout', l);
        el.setAttribute('aria-valuenow', String(v));
        this.layoutStage(); this.renderTimeline();
      };
      el.setAttribute('aria-valuemin', String(mn)); el.setAttribute('aria-valuemax', String(mx));
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const start = axis === 'x' ? e.clientX : e.clientY; const base = cur();
        el.classList.add('active'); el.setPointerCapture(e.pointerId);
        const mv = (ev) => set(base + ((axis === 'x' ? ev.clientX : ev.clientY) - start) * sign);
        const up = () => { el.classList.remove('active'); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
        el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
      });
      el.addEventListener('keydown', (e) => {
        const d = { ArrowLeft: -16, ArrowRight: 16, ArrowUp: -16, ArrowDown: 16 }[e.key];
        if (d === undefined) return;
        e.preventDefault(); e.stopPropagation(); set(cur() + d * sign);
      });
    }
  }

  /* ---------------- Tutorial ---------------- */
  startTour(from = 0) {
    const steps = [
      { target: '[data-tour=add]', title: t('tour.s1t'), text: t('tour.s1'), action: !Object.keys(this.project.assets).length ? { label: t('ed.useSamples'), run: () => this.loadSamples() } : null },
      { target: () => $('.lib-item', this.libList) || $('[data-tour=library]'), title: t('tour.s2t'), text: t('tour.s2') },
      { target: '[data-tour=split]', title: t('tour.s3t'), text: t('tour.s3') },
      { target: '[data-tour=timeline]', title: t('tour.s4t'), text: t('tour.s4') },
      { target: '[data-tour=export]', title: t('tour.s5t'), text: t('tour.s5') },
    ];
    Tips.hide();
    Tour.start(steps, { onEnd: () => Prefs.set('tourDone', true) });
    for (let i = 0; i < from; i++) Tour.next();
  }

  /* ---------------- Esportazione e ricollegamento ---------------- */
  openExport() {
    if (!this.hasClips()) { Toast.show(t('exp.empty'), { duration: 3000 }); return; }
    if (this.player.playing) this.player.pause();
    ExportDialog.open(this);
  }
  openRelink() { RelinkDialog.open(this); }
}

/** Velocità leggibile: 0,25×, 1×, 1,5×… */
function fmtSpeed(sp) { return (Math.round(sp * 100) / 100).toLocaleString(I18N.locale()) + '×'; }
