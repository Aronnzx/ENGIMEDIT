'use strict';
/* =========================================================================
   engine.js — motore della timeline, indipendente dall'interfaccia.
   Tre tracce:
   • V1 "sequenza con ripple automatico": le clip sono sempre una dopo
     l'altra, senza buchi. Le posizioni si ricavano dall'ordine.
   • V2 (sovrapposizione: immagini, titoli, livelli di regolazione) e
     A1 (audio): posizionamento libero, ogni clip ha il proprio `start`
     e le clip della stessa traccia non si sovrappongono.
   Tutte le funzioni sono pure: non modificano mai gli array ricevuti.
   ========================================================================= */
const Engine = (() => {
  const SCHEMA = 2;
  const MIN_CLIP = 0.1;           // durata minima di una clip (secondi)
  const FREE_MAX = 3600;          // durata massima di immagini, titoli e livelli (secondi)
  const FORMATS = {
    '16:9': { w: 16, h: 9 },
    '9:16': { w: 9, h: 16 },
    '1:1': { w: 1, h: 1 },
    '4:5': { w: 4, h: 5 },
  };
  const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];
  const LABELS = ['red', 'amber', 'green', 'violet', 'lilac', 'grey'];
  const BLANKING = { none: 0, '1.33': 4 / 3, '1.85': 1.85, '2.39': 2.39 };
  const EQ_PRESETS = ['neutral', 'voice', 'music', 'lowcut'];
  const BLENDS = ['normal', 'screen', 'multiply', 'overlay'];
  const rr = (x) => Math.round(x * 1e4) / 1e4;
  const clampN = (v, a, b, d) => (typeof v === 'number' && isFinite(v) ? Math.min(b, Math.max(a, v)) : d);

  /* ---------------- Valori predefiniti delle proprietà di una clip ---------- */
  const DEF = {
    tf: { zx: 1, zy: 1, link: true, x: 0, y: 0, rot: 0, flipH: false, flipV: false },
    crop: { l: 0, r: 0, t: 0, b: 0 },
    dz: { mode: 'off', amt: 0.2 },
    comp: { opacity: 1, blend: 'normal' },
    color: { lift: 0, gamma: 0, gain: 0, contrast: 0, sat: 0, temp: 0 },
    fx: { blur: 0, grain: 0, vignette: 0 },
    audio: { fadeIn: 0, fadeOut: 0, eq: 'neutral' },
    text: { content: 'Titolo', size: 0.09, color: '#ffffff', bg: false, bold: true, align: 'center' },
  };
  const GROUPS = Object.keys(DEF);
  /** Proprietà di gruppo con i valori predefiniti (le clip salvate possono non averle). */
  function g(c, k) { return c && c[k] ? { ...DEF[k], ...c[k] } : { ...DEF[k] }; }
  function isNeutral(c, k) { const v = g(c, k); return Object.keys(DEF[k]).every((x) => v[x] === DEF[k][x]); }
  function colorOn(c) { return !isNeutral(c, 'color'); }
  function fxOn(c) { return !isNeutral(c, 'fx'); }

  /** Tipo di clip: media (video o immagine da file), text, adjust. */
  function kindOf(c) { return c.kind || 'media'; }

  /** Durata in timeline di una clip (tiene conto della velocità). */
  function dur(c) { return rr((c.out - c.in) / (c.speed || 1)); }

  /** Posizioni calcolate di V1: [{clip, start, end}] */
  function layout(clips) {
    let t = 0;
    return clips.map((clip) => { const start = t; t = rr(t + dur(clip)); return { clip, start, end: t }; });
  }
  function total(clips) { let t = 0; for (const c of clips) t = rr(t + dur(c)); return t; }
  function startOf(clips, id) { let t = 0; for (const c of clips) { if (c.id === id) return t; t = rr(t + dur(c)); } return -1; }

  /** Trova la clip al tempo t. Oltre la fine restituisce l'ultima clip (fine inclusa). */
  function locate(clips, t) {
    if (!clips.length) return null;
    let s = 0;
    for (let i = 0; i < clips.length; i++) {
      const d = dur(clips[i]);
      const e = rr(s + d);
      if (t < e - 1e-6) return { index: i, clip: clips[i], start: s, end: e, local: Math.max(0, rr(t - s)) };
      s = e;
    }
    const i = clips.length - 1;
    const c = clips[i];
    return { index: i, clip: c, start: rr(s - dur(c)), end: s, local: dur(c), atEnd: true };
  }

  /** Tempo nella sorgente corrispondente al tempo t della timeline. */
  function sourceTime(clip, local) { return rr(clip.in + local * (clip.speed || 1)); }

  /** Divide la clip sotto il tempo t. Restituisce {clips, leftId, rightId} oppure {error}. */
  function split(clips, t, newId) {
    const loc = locate(clips, t);
    if (!loc || loc.atEnd) return { error: 'no-clip' };
    const c = loc.clip;
    const d = dur(c);
    if (loc.local < MIN_CLIP || d - loc.local < MIN_CLIP) return { error: 'edge' };
    const cut = sourceTime(c, loc.local);
    const left = { ...c, out: cut };
    const right = { ...c, id: newId, in: cut };
    const next = clips.slice();
    next.splice(loc.index, 1, left, right);
    return { clips: next, leftId: c.id, rightId: newId };
  }

  /** Limiti validi per il taglio di un lato. assetDur = durata del file sorgente. */
  function trimLimits(clip, side, assetDur) {
    const sp = clip.speed || 1;
    if (side === 'in') return { min: 0, max: rr(clip.out - MIN_CLIP * sp) };
    return { min: rr(clip.in + MIN_CLIP * sp), max: rr(assetDur) };
  }
  /** Imposta il punto d'ingresso (side='in') o d'uscita (side='out') entro i limiti. */
  function trim(clips, id, side, value, assetDur) {
    const i = clips.findIndex((c) => c.id === id);
    if (i < 0) return null;
    const c = clips[i];
    const lim = trimLimits(c, side, assetDur);
    const v = rr(Math.min(lim.max, Math.max(lim.min, value)));
    if ((side === 'in' && v === c.in) || (side === 'out' && v === c.out)) return null;
    const next = clips.slice();
    next[i] = side === 'in' ? { ...c, in: v } : { ...c, out: v };
    return next;
  }

  function remove(clips, ids) {
    const set = ids instanceof Set ? ids : new Set(ids);
    const next = clips.filter((c) => !set.has(c.id));
    return next.length === clips.length ? null : next;
  }

  /** Duplica le clip indicate subito dopo ciascun originale. */
  function duplicate(clips, ids, makeId) {
    const set = ids instanceof Set ? ids : new Set(ids);
    const next = []; const newIds = [];
    for (const c of clips) {
      next.push(c);
      if (set.has(c.id)) { const id = makeId(); newIds.push(id); next.push({ ...c, id }); }
    }
    return newIds.length ? { clips: next, newIds } : null;
  }

  /**
   * Sposta il blocco delle clip selezionate (nell'ordine attuale) nello spazio
   * di inserimento `gap` (0..n, riferito all'array originale).
   */
  function move(clips, ids, gap) {
    const set = ids instanceof Set ? ids : new Set(ids);
    const moving = []; const rest = [];
    let before = 0;
    clips.forEach((c, i) => {
      if (set.has(c.id)) { moving.push(c); if (i < gap) before++; }
      else rest.push(c);
    });
    if (!moving.length) return null;
    const at = Math.max(0, Math.min(rest.length, gap - before));
    const next = rest.slice(0, at).concat(moving, rest.slice(at));
    for (let i = 0; i < next.length; i++) if (next[i] !== clips[i]) return next;
    return null; // ordine invariato
  }

  function insert(clips, newClips, gap) {
    const at = Math.max(0, Math.min(clips.length, gap));
    return clips.slice(0, at).concat(newClips, clips.slice(at));
  }

  /**
   * Modifica le clip indicate. I campi-gruppo (tf, crop, color...) passati come
   * oggetto vengono UNITI ai valori esistenti: patch(c, ids, {tf: {rot: 90}}).
   */
  function patch(clips, ids, fields) {
    const set = ids instanceof Set ? ids : new Set(ids);
    let changed = false;
    const next = clips.map((c) => {
      if (!set.has(c.id)) return c;
      const n = { ...c };
      let ch = false;
      for (const k of Object.keys(fields)) {
        const v = fields[k];
        if (GROUPS.includes(k) && v && typeof v === 'object') {
          const cur = g(c, k);
          const merged = { ...cur, ...v };
          if (Object.keys(merged).some((x) => merged[x] !== cur[x])) { n[k] = merged; ch = true; }
        } else if (c[k] !== v) { n[k] = v; ch = true; }
      }
      if (!ch) return c;
      changed = true;
      return n;
    });
    return changed ? next : null;
  }

  /** Nuova clip da un file della libreria. `opts.fit` = regola di ridimensionamento predefinita. */
  function clipFromAsset(asset, id, opts = {}) {
    const d = asset.kind === 'image' ? (opts.imageDur || 5) : asset.duration;
    const c = { id, assetId: asset.id, in: 0, out: rr(d), volume: 1, muted: false, speed: 1, fit: opts.fit === 'fill' ? 'fill' : 'fit', ox: 0, oy: 0 };
    if (opts.start !== undefined) c.start = rr(Math.max(0, opts.start));
    return c;
  }
  /** Titolo o livello di regolazione (traccia V2). */
  function clipSynthetic(kind, id, start, length, text) {
    const c = { id, kind, in: 0, out: rr(length), start: rr(Math.max(0, start)), speed: 1, fit: 'fit', ox: 0, oy: 0, volume: 1, muted: true };
    if (kind === 'text') c.text = { ...DEF.text, content: text || DEF.text.content };
    return c;
  }

  /** Aggancio magnetico: restituisce il bersaglio più vicino entro la soglia, altrimenti il valore. */
  function snap(value, targets, threshold) {
    let best = value; let bd = threshold;
    for (const tg of targets) { const d = Math.abs(tg - value); if (d <= bd) { bd = d; best = tg; } }
    return best;
  }

  /** Spazio d'inserimento (0..n) più vicino al tempo t. */
  function gapAt(clips, t) {
    const L = layout(clips);
    for (let i = 0; i < L.length; i++) { const mid = (L[i].start + L[i].end) / 2; if (t < mid) return i; }
    return L.length;
  }

  /* ---------------- Tracce libere (V2, A1) ---------------- */
  function endOf(c) { return rr((c.start || 0) + dur(c)); }
  function freeSorted(clips) { return clips.slice().sort((a, b) => (a.start || 0) - (b.start || 0)); }
  function freeTotal(clips) { let m = 0; for (const c of clips) m = Math.max(m, endOf(c)); return rr(m); }
  /** Clip della traccia libera che copre il tempo t (se c'è). */
  function freeAt(clips, t) {
    for (const c of clips) { const s = c.start || 0; if (t >= s - 1e-6 && t < endOf(c) - 1e-6) return { clip: c, start: s, end: endOf(c), local: Math.max(0, rr(t - s)) }; }
    return null;
  }
  /**
   * Inizio valido più vicino a `want` per una clip lunga `d`, senza sovrapporsi
   * alle altre clip della traccia (escluse quelle in `skip`).
   */
  function fitFree(clips, skip, want, d) {
    const sk = skip instanceof Set ? skip : new Set(skip || []);
    const others = freeSorted(clips.filter((c) => !sk.has(c.id))).map((c) => [c.start || 0, endOf(c)]);
    const ok = (s) => s >= -1e-6 && others.every(([a, b]) => s + d <= a + 1e-6 || s >= b - 1e-6);
    want = Math.max(0, want);
    if (ok(want)) return rr(want);
    const cands = [0];
    for (const [a, b] of others) { cands.push(b, a - d); }
    let best = null; let bd = Infinity;
    for (const s of cands) if (ok(s) && Math.abs(s - want) < bd) { bd = Math.abs(s - want); best = s; }
    return rr(best === null ? (others.length ? others[others.length - 1][1] : 0) : best);
  }
  /** Inserisce una clip libera nel primo spazio valido vicino al suo `start`. */
  function insertFree(clips, clip) {
    const s = fitFree(clips, [], clip.start || 0, dur(clip));
    return freeSorted(clips.concat({ ...clip, start: s }));
  }
  /** Sposta le clip libere indicate di `delta` secondi (tutte insieme), se c'è spazio. */
  function moveFree(clips, ids, delta) {
    const set = ids instanceof Set ? ids : new Set(ids);
    const moving = clips.filter((c) => set.has(c.id));
    if (!moving.length || Math.abs(delta) < 1e-6) return null;
    const minStart = Math.min(...moving.map((c) => c.start || 0));
    if (minStart + delta < 0) delta = -minStart;
    const others = clips.filter((c) => !set.has(c.id));
    for (const m of moving) {
      const s = (m.start || 0) + delta; const e = s + dur(m);
      if (others.some((o) => s < endOf(o) - 1e-6 && e > (o.start || 0) + 1e-6)) return null;
    }
    if (Math.abs(delta) < 1e-6) return null;
    return freeSorted(clips.map((c) => (set.has(c.id) ? { ...c, start: rr((c.start || 0) + delta) } : c)));
  }
  /** Imposta l'inizio di una clip libera (si ferma prima di sovrapporsi). */
  function placeFree(clips, id, start) {
    const c = clips.find((x) => x.id === id);
    if (!c) return null;
    const s = fitFree(clips, [id], start, dur(c));
    if (Math.abs(s - (c.start || 0)) < 1e-6) return null;
    return freeSorted(clips.map((x) => (x.id === id ? { ...x, start: s } : x)));
  }
  /** Limiti di taglio per una clip libera: sorgente e clip vicine. */
  function freeTrimLimits(clips, c, side, assetDur) {
    const sp = c.speed || 1; const s = c.start || 0; const e = endOf(c);
    let prevEnd = 0; let nextStart = Infinity;
    for (const o of clips) { if (o.id === c.id) continue; if (endOf(o) <= s + 1e-6) prevEnd = Math.max(prevEnd, endOf(o)); if ((o.start || 0) >= e - 1e-6) nextStart = Math.min(nextStart, o.start || 0); }
    if (side === 'in') {
      const minIn = Math.max(0, c.in - (s - prevEnd) * sp);
      return { min: rr(minIn), max: rr(c.out - MIN_CLIP * sp) };
    }
    const maxOut = Math.min(assetDur, c.out + (nextStart - e) * sp);
    return { min: rr(c.in + MIN_CLIP * sp), max: rr(maxOut) };
  }
  /** Taglio di una clip libera: il lato opposto resta fermo nella timeline. */
  function trimFree(clips, id, side, value, assetDur) {
    const i = clips.findIndex((c) => c.id === id);
    if (i < 0) return null;
    const c = clips[i]; const sp = c.speed || 1;
    const lim = freeTrimLimits(clips, c, side, assetDur);
    const v = rr(Math.min(lim.max, Math.max(lim.min, value)));
    if ((side === 'in' && v === c.in) || (side === 'out' && v === c.out)) return null;
    const next = clips.slice();
    next[i] = side === 'in' ? { ...c, in: v, start: rr((c.start || 0) + (v - c.in) / sp) } : { ...c, out: v };
    return next;
  }
  /** Divide una clip libera al tempo t della timeline. */
  function splitFree(clips, id, t, newId) {
    const c = clips.find((x) => x.id === id);
    if (!c) return { error: 'no-clip' };
    const s = c.start || 0; const local = t - s; const d = dur(c);
    if (local < MIN_CLIP || d - local < MIN_CLIP) return { error: 'edge' };
    const cut = sourceTime(c, local);
    const left = { ...c, out: cut };
    const right = { ...c, id: newId, in: cut, start: rr(t) };
    return { clips: freeSorted(clips.filter((x) => x.id !== id).concat(left, right)), leftId: id, rightId: newId };
  }
  /** Duplica clip libere subito dopo l'originale (nel primo spazio libero). */
  function duplicateFree(clips, ids, makeId) {
    const set = ids instanceof Set ? ids : new Set(ids);
    let next = clips; const newIds = [];
    for (const c of clips) if (set.has(c.id)) { const id = makeId(); newIds.push(id); next = insertFree(next, { ...c, id, start: endOf(c) }); }
    return newIds.length ? { clips: next, newIds } : null;
  }
  /** Slip: sposta la finestra in/out mantenendo la durata in timeline. */
  function slip(clips, id, newIn, assetDur) {
    const i = clips.findIndex((c) => c.id === id);
    if (i < 0) return null;
    const c = clips[i]; const len = c.out - c.in;
    const v = rr(Math.min(Math.max(0, assetDur - len), Math.max(0, newIn)));
    if (Math.abs(v - c.in) < 1e-6) return null;
    const next = clips.slice();
    next[i] = { ...c, in: v, out: rr(v + len) };
    return next;
  }

  /** Durata totale del progetto (la traccia più lunga). */
  function projectTotal(tracks) {
    const tr = Array.isArray(tracks) ? tracks : (tracks && tracks.tracks) || [];
    let m = 0;
    for (const t of tr) m = Math.max(m, t.id === 'v1' || t.kind === 'video' ? total(t.clips) : freeTotal(t.clips));
    return rr(m);
  }
  function track(p, id) { return (p.tracks || []).find((t) => t.id === id) || { id, clips: [] }; }

  /** Avanzamento dello zoom dinamico (0..1) con andamento morbido. */
  function dzScale(c, local) {
    const d = g(c, 'dz');
    if (d.mode === 'off') return 1;
    const D = Math.max(1e-3, dur(c));
    const p = Math.min(1, Math.max(0, local / D));
    const e = p * p * (3 - 2 * p);
    return d.mode === 'in' ? 1 + d.amt * e : 1 + d.amt * (1 - e);
  }

  /** Guadagno della clip (volume + dissolvenze) all'istante locale l. */
  function gainAt(c, l) {
    const a = g(c, 'audio'); const D = dur(c); const v = c.volume === undefined ? 1 : c.volume;
    let f = 1;
    if (a.fadeIn > 0 && l < a.fadeIn) f = Math.min(f, Math.max(0, l / a.fadeIn));
    if (a.fadeOut > 0 && l > D - a.fadeOut) f = Math.min(f, Math.max(0, (D - l) / a.fadeOut));
    return v * f;
  }
  /** Punti di variazione del guadagno (per programmare rampe lineari esatte). */
  function gainPoints(c) {
    const a = g(c, 'audio'); const D = dur(c);
    const fi = Math.min(a.fadeIn, D); const fo = Math.min(a.fadeOut, D);
    const pts = new Set([0, D]);
    if (fi > 0) pts.add(fi);
    if (fo > 0) pts.add(Math.max(0, D - fo));
    if (fi > 0 && fo > 0 && fi + fo > D) pts.add(D * fi / (fi + fo)); // incrocio delle due rampe
    return [...pts].sort((x, y) => x - y);
  }

  /* ---------------- Copia e incolla attributi ---------------- */
  const ATTR = {
    transform: ['tf', 'fit', 'ox', 'oy', 'dz'],
    crop: ['crop'],
    color: ['color'],
    fx: ['fx'],
    composite: ['comp'],
    speed: ['speed'],
    volume: ['volume', 'muted', 'audio'],
  };
  const ATTR_KEYS = [...new Set(Object.values(ATTR).flat())];
  function pickAttrs(c) {
    const o = {};
    for (const k of ATTR_KEYS) { if (GROUPS.includes(k)) o[k] = g(c, k); else if (c[k] !== undefined) o[k] = c[k]; }
    return o;
  }
  /** Incolla gli attributi scelti; `canSpeed(c)` dice se la velocità si può cambiare su quella clip. */
  function pasteAttrs(clips, ids, attrs, groups, canSpeed) {
    const set = ids instanceof Set ? ids : new Set(ids);
    let changed = false;
    const next = clips.map((c) => {
      if (!set.has(c.id)) return c;
      const n = { ...c };
      for (const gname of groups) for (const k of ATTR[gname] || []) {
        if (attrs[k] === undefined) continue;
        if (k === 'speed' && canSpeed && !canSpeed(c)) continue;
        if (GROUPS.includes(k)) { if (JSON.stringify(g(c, k)) !== JSON.stringify({ ...DEF[k], ...attrs[k] })) n[k] = { ...DEF[k], ...attrs[k] }; }
        else n[k] = attrs[k];
      }
      if (JSON.stringify(n) === JSON.stringify(c)) return c;
      changed = true;
      return n;
    });
    return changed ? next : null;
  }

  /* ---------------- Cronologia annulla / ripeti (snapshot immutabili) ------- */
  function createHistory(limit = 300) {
    let past = []; let future = [];
    return {
      push(label, before) { past.push({ label, state: before }); if (past.length > limit) past.shift(); future = []; },
      undo(current) { const e = past.pop(); if (!e) return null; future.push({ label: e.label, state: current }); return e; },
      redo(current) { const e = future.pop(); if (!e) return null; past.push({ label: e.label, state: current }); return e; },
      canUndo() { return past.length > 0; },
      canRedo() { return future.length > 0; },
      list() { return { past: past.map((e) => e.label), future: future.map((e) => e.label).reverse() }; },
      clear() { past = []; future = []; },
    };
  }

  /* ---------------- Modello progetto: creazione, migrazione, cloud ---------- */
  function emptyTracks() {
    return [{ id: 'v1', kind: 'video', clips: [] }, { id: 'v2', kind: 'overlay', clips: [] }, { id: 'a1', kind: 'audio', clips: [] }];
  }
  function defaultSettings() { return { snapping: true, scaling: 'fit', imageDur: 5, blanking: 'none' }; }
  function newProject(name, id, now) {
    return {
      id, name, schema: SCHEMA, createdAt: now, updatedAt: now,
      format: '16:9', fps: 30,
      assets: {},                                   // id → metadati MediaAsset
      tracks: emptyTracks(),
      markers: [],
      settings: defaultSettings(),
    };
  }
  function cleanGroup(k, v) {
    if (!v || typeof v !== 'object') return undefined;
    const d = DEF[k]; const o = {};
    for (const key of Object.keys(d)) {
      const x = v[key]; const dv = d[key];
      if (typeof dv === 'number') o[key] = clampN(x, -1e6, 1e6, dv);
      else if (typeof dv === 'boolean') o[key] = typeof x === 'boolean' ? x : dv;
      else o[key] = typeof x === 'string' ? x.slice(0, 2000) : dv;
    }
    if (k === 'dz' && !['off', 'in', 'out'].includes(o.mode)) o.mode = 'off';
    if (k === 'comp' && !BLENDS.includes(o.blend)) o.blend = 'normal';
    if (k === 'audio' && !EQ_PRESETS.includes(o.eq)) o.eq = 'neutral';
    return o;
  }
  function cleanClip(c, free) {
    const out = { volume: 1, muted: false, speed: 1, fit: 'fit', ox: 0, oy: 0, ...c };
    if (!SPEEDS.includes(out.speed)) out.speed = clampN(out.speed, 0.25, 4, 1);
    if (typeof out.in !== 'number' || !isFinite(out.in)) out.in = 0;
    if (typeof out.out !== 'number' || !isFinite(out.out) || out.out <= out.in) out.out = rr(out.in + 1);
    if (free) out.start = clampN(out.start, 0, 1e6, 0); else delete out.start;
    if (out.label && !LABELS.includes(out.label)) delete out.label;
    out.disabled = !!out.disabled;
    for (const k of GROUPS) { if (out[k] !== undefined) { const v = cleanGroup(k, out[k]); if (v) out[k] = v; else delete out[k]; } }
    if (Array.isArray(out.markers)) out.markers = out.markers.filter((m) => m && typeof m.at === 'number').map((m) => ({ id: String(m.id || 'm' + Math.random().toString(36).slice(2, 8)), at: m.at, color: LABELS.includes(m.color) ? m.color : 'violet', name: typeof m.name === 'string' ? m.name.slice(0, 80) : '' }));
    else delete out.markers;
    return out;
  }
  /** Migra un progetto letto da archivio/cloud/file alla versione corrente dello schema. */
  function migrate(p) {
    if (!p || typeof p !== 'object') return null;
    const out = { ...p };
    if (!out.schema) out.schema = 1;
    if (!FORMATS[out.format]) out.format = '16:9';
    if (!out.fps) out.fps = 30;
    if (!out.assets || typeof out.assets !== 'object') out.assets = {};
    const assets = {};
    for (const [k, a] of Object.entries(out.assets)) {
      if (!a || typeof a !== 'object') continue;
      assets[k] = { ...a, id: a.id || k, kind: ['video', 'image', 'audio'].includes(a.kind) ? a.kind : 'video' };
    }
    out.assets = assets;
    const old = Array.isArray(out.tracks) ? out.tracks : [];
    const pick = (id, i) => old.find((t) => t && t.id === id) || (i === 0 ? old[0] : null) || null;
    const v1 = pick('v1', 0); const v2 = pick('v2', 1); const a1 = pick('a1', 2);
    const okMedia = (c) => c && out.assets[c.assetId];
    const okFree = (c) => c && (c.kind === 'text' || c.kind === 'adjust' || okMedia(c));
    out.tracks = [
      { id: 'v1', kind: 'video', clips: ((v1 && v1.clips) || []).filter((c) => okMedia(c) && out.assets[c.assetId].kind !== 'audio').map((c) => cleanClip({ ...c, kind: undefined }, false)) },
      { id: 'v2', kind: 'overlay', clips: freeSorted(((v2 && v2.clips) || []).filter((c) => okFree(c) && (!c.assetId || out.assets[c.assetId].kind === 'image')).map((c) => cleanClip(c, true))) },
      { id: 'a1', kind: 'audio', clips: freeSorted(((a1 && a1.clips) || []).filter((c) => okMedia(c) && out.assets[c.assetId].kind !== 'image').map((c) => cleanClip({ ...c, kind: undefined }, true))) },
    ];
    for (const tr of out.tracks) for (const c of tr.clips) if (c.kind === undefined) delete c.kind;
    out.markers = Array.isArray(out.markers) ? out.markers.filter((m) => m && typeof m.t === 'number' && isFinite(m.t)).map((m) => ({
      id: String(m.id || 'm' + Math.random().toString(36).slice(2, 8)), t: Math.max(0, m.t), color: LABELS.includes(m.color) ? m.color : 'violet', name: typeof m.name === 'string' ? m.name.slice(0, 80) : '',
    })) : [];
    const s = { ...defaultSettings(), ...(out.settings || {}) };
    s.snapping = s.snapping !== false;
    if (!['fit', 'fill'].includes(s.scaling)) s.scaling = 'fit';
    s.imageDur = clampN(s.imageDur, 0.5, 600, 5);
    if (!(s.blanking in BLANKING)) s.blanking = 'none';
    out.settings = s;
    if (typeof out.name !== 'string' || !out.name.trim()) out.name = 'Progetto';
    out.name = out.name.slice(0, 80);
    out.schema = SCHEMA;
    return out;
  }
  /** Versione per il cloud: solo metadati, mai file video o miniature. */
  function toCloud(p) {
    const { thumb, ...rest } = p; // eslint-disable-line no-unused-vars
    return JSON.parse(JSON.stringify(rest));
  }

  return {
    SCHEMA, MIN_CLIP, FREE_MAX, FORMATS, SPEEDS, LABELS, BLANKING, EQ_PRESETS, BLENDS, DEF, ATTR,
    g, isNeutral, colorOn, fxOn, kindOf,
    dur, layout, total, startOf, locate, sourceTime, split, trimLimits, trim, remove, duplicate, move, insert, patch, clipFromAsset, clipSynthetic, snap, gapAt,
    endOf, freeTotal, freeAt, fitFree, insertFree, moveFree, placeFree, freeTrimLimits, trimFree, splitFree, duplicateFree, slip, projectTotal, track,
    dzScale, gainAt, gainPoints, pickAttrs, pasteAttrs,
    createHistory, emptyTracks, defaultSettings, newProject, migrate, toCloud,
  };
})();
if (typeof module !== 'undefined') module.exports = Engine;
