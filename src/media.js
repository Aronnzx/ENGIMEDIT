'use strict';
/* =========================================================================
   media.js — tutto ciò che riguarda i file dell'utente: video, immagini e
   audio (Media Pool). I file restano sul dispositivo (IndexedDB). Nessun upload.
   ========================================================================= */
const MAX_FILE = 2 * 1024 ** 3;          // limite per file (2 GB)
const HEAVY_FILE = 700 * 1024 ** 2;      // oltre questa soglia avvisa che servirà più tempo
const MAX_AUDIO_DECODE = 1.4 * 1024 ** 3; // oltre, l'audio non viene elaborato (memoria)
const VIDEO_EXT = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', 'ogv', '3gp'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp'];
const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'ogg', 'oga', 'aac', 'flac', 'opus', 'weba'];
const MAX_IMAGE_SIDE = 4096;              // le immagini più grandi vengono ridotte in memoria (non il file)
const MEDIA_ACCEPT = 'video/*,image/png,image/jpeg,image/webp,audio/*,.mp4,.mov,.webm,.mkv,.avi,.m4v,.png,.jpg,.jpeg,.webp,.mp3,.wav,.m4a,.ogg,.aac,.flac,.opus';
const PEAKS_PER_SEC = 100;

class MediaError2 extends Error {
  constructor(code, extra = {}) { super(code); this.code = code; Object.assign(this, extra); }
}

const Media = {
  rt: new Map(),              // assetId → stato runtime
  listeners: new Set(),
  _ctx: null,
  _audioQueue: Promise.resolve(),

  audioCtx() {
    if (!this._ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this._ctx = new AC({ latencyHint: 'interactive' });
    }
    return this._ctx;
  },
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit(assetId) { for (const fn of this.listeners) { try { fn(assetId); } catch (e) { ErrLog.add('media-listener', e); } } },
  get(id) { return this.rt.get(id); },
  entry(id) {
    let e = this.rt.get(id);
    if (!e) {
      e = { id, status: 'loading', url: null, blob: null, image: null, audio: null, audioState: 'pending', thumbs: [], thumbTimes: [], peaks: null, pps: PEAKS_PER_SEC, error: null, waiters: [] };
      this.rt.set(id, e);
    }
    return e;
  },
  unloadAll() {
    for (const e of this.rt.values()) { if (e.url) URL.revokeObjectURL(e.url); if (e.image && e.image.close) { try { e.image.close(); } catch {} } }
    this.rt.clear();
    Demux.cache.clear();
  },

  /* ---------------- Controlli preliminari ---------------- */
  ext(name) { const m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; },
  looksLikeVideo(file) { return this.classify(file) === 'video'; },
  /** Tipo di file per il Media Pool: video, image, audio oppure null. */
  classify(file) {
    const x = this.ext(file.name); const ty = file.type || '';
    if (IMAGE_EXT.includes(x) || /^image\/(png|jpe?g|webp)$/.test(ty)) return 'image';
    if (AUDIO_EXT.includes(x) || ty.startsWith('audio/')) return 'audio';
    if (VIDEO_EXT.includes(x) || ty.startsWith('video/')) return 'video';
    return null;
  },

  /** Legge il tipo di contenitore dai primi byte. */
  async sniff(blob) {
    try {
      const b = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
      const s = String.fromCharCode(...b.slice(4, 8));
      if (s === 'ftyp' || s === 'moov' || s === 'mdat' || s === 'wide' || s === 'free') return 'mp4';
      if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'mkv';
      if (String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'AVI ') return 'avi';
      if (String.fromCharCode(...b.slice(0, 4)) === 'OggS') return 'ogg';
      return 'unknown';
    } catch (e) { throw new MediaError2('read'); }
  },

  /** Analisi leggera dei box MP4/MOV: codec, fps e presenza dell'audio. */
  async parseMp4(blob) {
    const read = async (a, b) => new DataView(await blob.slice(a, b).arrayBuffer());
    let pos = 0; let moov = null; const size = blob.size; let guard = 0;
    while (pos + 8 <= size && guard++ < 200) {
      const hd = await read(pos, Math.min(size, pos + 16));
      let bs = hd.getUint32(0); const type = String.fromCharCode(hd.getUint8(4), hd.getUint8(5), hd.getUint8(6), hd.getUint8(7));
      let hl = 8;
      if (bs === 1 && hd.byteLength >= 16) { bs = Number(hd.getBigUint64(8)); hl = 16; } else if (bs === 0) bs = size - pos;
      if (bs < 8) return null;
      if (type === 'moov') { if (bs > 96 * 1024 * 1024) return null; moov = await read(pos + hl, pos + bs); break; }
      pos += bs;
    }
    if (!moov) return null;
    const kids = (dv, start, end) => {
      const out = []; let p = start;
      while (p + 8 <= end) {
        let s = dv.getUint32(p); const t = String.fromCharCode(dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6), dv.getUint8(p + 7));
        let hl = 8;
        if (s === 1) { s = Number(dv.getBigUint64(p + 8)); hl = 16; } else if (s === 0) s = end - p;
        if (s < 8 || p + s > end) break;
        out.push({ type: t, start: p + hl, end: p + s });
        p += s;
      }
      return out;
    };
    const find = (dv, box, path) => {
      let cur = box;
      for (const name of path) { const k = kids(dv, cur.start, cur.end).find((x) => x.type === name); if (!k) return null; cur = k; }
      return cur;
    };
    const res = { video: null, audio: null };
    for (const trak of kids(moov, 0, moov.byteLength).filter((k) => k.type === 'trak')) {
      const hdlr = find(moov, trak, ['mdia', 'hdlr']);
      const mdhd = find(moov, trak, ['mdia', 'mdhd']);
      const stbl = find(moov, trak, ['mdia', 'minf', 'stbl']);
      if (!hdlr || !mdhd || !stbl) continue;
      const handler = String.fromCharCode(...[0, 1, 2, 3].map((i) => moov.getUint8(hdlr.start + 8 + i)));
      const ver = moov.getUint8(mdhd.start);
      const timescale = ver === 1 ? moov.getUint32(mdhd.start + 20) : moov.getUint32(mdhd.start + 12);
      const stsd = kids(moov, stbl.start, stbl.end).find((x) => x.type === 'stsd');
      let codec = null;
      if (stsd && stsd.end - stsd.start >= 16) codec = String.fromCharCode(...[0, 1, 2, 3].map((i) => moov.getUint8(stsd.start + 12 + i)));
      if (handler === 'vide' && !res.video) {
        let fps = null;
        const stts = kids(moov, stbl.start, stbl.end).find((x) => x.type === 'stts');
        if (stts && timescale) {
          const n = moov.getUint32(stts.start + 4); let frames = 0; let ticks = 0;
          for (let i = 0; i < Math.min(n, 5000); i++) {
            const c = moov.getUint32(stts.start + 8 + i * 8); const d = moov.getUint32(stts.start + 12 + i * 8);
            frames += c; ticks += c * d;
          }
          if (ticks > 0) fps = Math.round((frames * timescale / ticks) * 100) / 100;
        }
        res.video = { codec, fps };
      } else if (handler === 'soun' && !res.audio) {
        res.audio = { codec };
      }
    }
    return res;
  },
  codecName(fourcc) {
    const map = { avc1: 'H.264', avc3: 'H.264', hvc1: 'HEVC (H.265)', hev1: 'HEVC (H.265)', vp09: 'VP9', av01: 'AV1', mp4v: 'MPEG-4', 'mp4a': 'AAC', Opus: 'Opus', opus: 'Opus', ac_3: 'AC-3', 'ac-3': 'AC-3', 'ec-3': 'E-AC-3', apcn: 'ProRes', apch: 'ProRes', apcs: 'ProRes', ap4h: 'ProRes', jpeg: 'Motion JPEG' };
    return fourcc ? (map[fourcc] || fourcc.trim()) : null;
  },

  /** Carica i metadati con un elemento video (verifica reale del supporto del browser). */
  probe(url) {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.muted = true; v.preload = 'metadata'; v.playsInline = true;
      const done = (fn, arg) => { clearTimeout(tm); v.removeAttribute('src'); try { v.load(); } catch {} fn(arg); };
      const tm = setTimeout(() => done(reject, new MediaError2('timeout')), 20000);
      v.onloadedmetadata = () => {
        const info = { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
        // Alcuni file (WebM da registrazione) riportano durata Infinity: forziamo il calcolo
        if (!isFinite(info.duration)) {
          v.currentTime = 1e9;
          v.ontimeupdate = () => { v.ontimeupdate = null; info.duration = v.duration; done(resolve, info); };
          return;
        }
        done(resolve, info);
      };
      v.onerror = () => {
        const code = v.error ? v.error.code : 0;
        done(reject, new MediaError2(code === 3 ? 'corrupt' : 'unsupported'));
      };
      v.src = url;
    });
  },

  /** Durata di un file audio con un elemento <audio>. */
  probeAudio(url) {
    return new Promise((resolve, reject) => {
      const a = document.createElement('audio'); a.preload = 'metadata';
      const done = (fn, arg) => { clearTimeout(tm); a.removeAttribute('src'); try { a.load(); } catch {} fn(arg); };
      const tm = setTimeout(() => done(reject, new MediaError2('timeout')), 20000);
      a.onloadedmetadata = () => {
        if (!isFinite(a.duration)) { a.currentTime = 1e9; a.ontimeupdate = () => { a.ontimeupdate = null; done(resolve, { duration: a.duration }); }; return; }
        done(resolve, { duration: a.duration });
      };
      a.onerror = () => done(reject, new MediaError2(a.error && a.error.code === 3 ? 'corrupt' : 'unsupported'));
      a.src = url;
    });
  },
  /** Decodifica un'immagine (ridotta se enorme) e ne restituisce bitmap e dimensioni originali. */
  async decodeImage(blob) {
    let bmp;
    try { bmp = await createImageBitmap(blob); } catch { throw new MediaError2('corrupt'); }
    const W = bmp.width; const H = bmp.height;
    if (!W || !H) throw new MediaError2('corrupt');
    const big = Math.max(W, H);
    if (big > MAX_IMAGE_SIDE) {
      const k = MAX_IMAGE_SIDE / big;
      try { const small = await createImageBitmap(bmp, { resizeWidth: Math.round(W * k), resizeHeight: Math.round(H * k), resizeQuality: 'high' }); bmp.close(); bmp = small; } catch { /* resta a piena risoluzione */ }
    }
    return { bmp, W, H };
  },
  /** Miniatura di un'immagine (stesso formato delle miniature video). */
  imageThumb(bmp) {
    const th = 90; const tw = Math.round(Math.max(40, Math.min(200, (th * bmp.width) / bmp.height)));
    const c = document.createElement('canvas'); c.width = tw; c.height = th;
    c.getContext('2d').drawImage(bmp, 0, 0, tw, th);
    return c;
  },

  /** Attende la fine di un seek. Si chiude anche se la sorgente cambia o va in errore. */
  seek(v, time) {
    return new Promise((resolve) => {
      let done = false;
      const fin = () => {
        if (done) return; done = true;
        clearTimeout(tm);
        v.removeEventListener('seeked', fin); v.removeEventListener('emptied', fin); v.removeEventListener('error', fin); v.removeEventListener('loadedmetadata', go);
        resolve();
      };
      const go = () => {
        if (done) return;
        // +0,4 ms: evita di cadere sul fotogramma precedente per arrotondamenti dei decimali
        const target = Math.max(0, Math.min(time + 0.0004, (v.duration || time) - 0.001));
        if (Math.abs(v.currentTime - target) < 1e-4 && v.readyState >= 2 && !v.seeking) return fin();
        v.addEventListener('seeked', fin);
        v.currentTime = target;
      };
      v.addEventListener('emptied', fin); v.addEventListener('error', fin);
      const tm = setTimeout(fin, 4000);
      if (v.readyState >= 1) go(); else v.addEventListener('loadedmetadata', go);
    });
  },

  /* ---------------- Importazione ---------------- */
  /**
   * Importa un file nella libreria del progetto. Restituisce i metadati dell'asset.
   * Le fasi lente (miniature complete, audio) proseguono in background.
   */
  async importFile(file, { onMeta, imageDur = 5 } = {}) {
    const kind = this.classify(file);
    if (!kind) throw new MediaError2('not-video', { name: file.name });
    if (file.size > MAX_FILE) throw new MediaError2('too-big', { name: file.name });
    if (file.size === 0) throw new MediaError2('corrupt', { name: file.name });
    if (kind === 'image') return this.importImage(file, { onMeta, imageDur });
    if (kind === 'audio') return this.importAudio(file, { onMeta });
    const container = await this.sniff(file);
    let parsed = null;
    if (container === 'mp4') { try { parsed = await this.parseMp4(file); } catch (e) { parsed = null; } }
    const id = uid('a');
    const e = this.entry(id);
    e.blob = file; e.url = URL.createObjectURL(file);
    let info;
    try { info = await this.probe(e.url); }
    catch (err) {
      URL.revokeObjectURL(e.url); this.rt.delete(id);
      err.name2 = file.name; err.codec = parsed && parsed.video ? this.codecName(parsed.video.codec) : null; err.container = container;
      throw err;
    }
    if (!info.width || !info.height) { URL.revokeObjectURL(e.url); this.rt.delete(id); return this.importAudio(file, { onMeta, parsed }); } // solo audio
    if (!isFinite(info.duration) || info.duration < 0.1) { URL.revokeObjectURL(e.url); this.rt.delete(id); throw new MediaError2('corrupt', { name: file.name }); }
    const asset = {
      id, kind: 'video', name: file.name.slice(0, 160), size: file.size, type: file.type || '', container,
      duration: r4(info.duration), width: info.width, height: info.height,
      fps: parsed && parsed.video ? parsed.video.fps : null,
      codec: parsed && parsed.video ? this.codecName(parsed.video.codec) : (container === 'mkv' ? 'WebM / Matroska' : null),
      audioCodec: parsed && parsed.audio ? this.codecName(parsed.audio.codec) : null,
      hasAudio: parsed ? !!parsed.audio : null,
      addedAt: Date.now(),
    };
    if (onMeta) onMeta(asset);
    await this.store(id, file, asset);
    // Prima miniatura subito, il resto in background
    await this.makeThumbs(asset, 1);
    e.status = 'ready';
    this.emit(id);
    this.processInBackground(asset);
    return asset;
  },

  /** Archivia il file sul dispositivo. */
  async store(id, file, asset) {
    try { await DB.put('media', { id, blob: file, name: asset.name, size: file.size, addedAt: asset.addedAt }); }
    catch (err) {
      const e = this.rt.get(id); if (e && e.url) URL.revokeObjectURL(e.url); this.rt.delete(id);
      const q = err && (err.name === 'QuotaExceededError' || /quota/i.test(err.message || ''));
      throw new MediaError2(q ? 'quota' : 'store', { name: file.name });
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  },
  /** Immagine fissa (PNG, JPG, WebP): durata predefinita modificabile, nessun audio. */
  async importImage(file, { onMeta, imageDur = 5 } = {}) {
    const { bmp, W, H } = await this.decodeImage(file).catch((err) => { throw Object.assign(err, { name2: file.name }); });
    const id = uid('a');
    const e = this.entry(id);
    e.blob = file; e.url = URL.createObjectURL(file); e.image = bmp; e.audioState = 'none';
    const x = this.ext(file.name);
    const asset = { id, kind: 'image', name: file.name.slice(0, 160), size: file.size, type: file.type || '', container: x, duration: imageDur, width: W, height: H, fps: null, codec: (x === 'jpg' ? 'jpeg' : x).toUpperCase(), audioCodec: null, hasAudio: false, addedAt: Date.now() };
    if (onMeta) onMeta(asset);
    await this.store(id, file, asset);
    e.thumbs = [this.imageThumb(bmp)]; e.thumbTimes = [0];
    e.status = 'ready';
    this.emit(id);
    this.saveDerived(id);
    return asset;
  },
  /** File solo audio (MP3, WAV, M4A, OGG, AAC): musica e voce per la traccia A1. */
  async importAudio(file, { onMeta, parsed } = {}) {
    const id = uid('a');
    const e = this.entry(id);
    e.blob = file; e.url = URL.createObjectURL(file);
    let info;
    try { info = await this.probeAudio(e.url); }
    catch (err) { URL.revokeObjectURL(e.url); this.rt.delete(id); err.name2 = file.name; err.container = this.ext(file.name) || 'unknown'; throw err; }
    if (!isFinite(info.duration) || info.duration < 0.1) { URL.revokeObjectURL(e.url); this.rt.delete(id); throw new MediaError2('corrupt', { name: file.name }); }
    const x = this.ext(file.name);
    const asset = { id, kind: 'audio', name: file.name.slice(0, 160), size: file.size, type: file.type || '', container: x, duration: r4(info.duration), width: 0, height: 0, fps: null, codec: null, audioCodec: parsed && parsed.audio ? this.codecName(parsed.audio.codec) : (x ? x.toUpperCase() : null), hasAudio: true, addedAt: Date.now() };
    if (onMeta) onMeta(asset);
    await this.store(id, file, asset);
    e.status = 'ready';
    this.emit(id);
    this.processInBackground(asset);
    return asset;
  },

  /** Genera miniature, forma d'onda e audio decodificato; salva i dati derivati. */
  processInBackground(asset) {
    const e = this.entry(asset.id);
    // prima l'audio (serve per riprodurre ed esportare), poi le miniature complete
    e.audioP = this.decodeAudio(asset);
    e.bg = (async () => {
      await e.audioP;
      if (asset.kind !== 'audio') { try { await this.makeThumbs(asset, Math.max(1, Math.min(60, Math.ceil(asset.duration)))); } catch (err) { ErrLog.add('thumbs', err); } }
      await this.saveDerived(asset.id);
    })();
    return e.bg;
  },

  async makeThumbs(asset, count) {
    const e = this.entry(asset.id);
    if (e.thumbs.length >= count) return;
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = e.url;
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('thumb-load')); setTimeout(res, 8000); });
    const ar = asset.width / asset.height;
    const th = 90; const tw = Math.round(Math.max(40, Math.min(200, th * ar)));
    const D = asset.duration;
    const times = count === 1 ? [Math.min(0.2, D / 2)] : Array.from({ length: count }, (_, i) => Math.min(D - 0.05, (i + 0.5) * D / count));
    const thumbs = []; const tt = [];
    for (const time of times) {
      await this.seek(v, time);
      const c = document.createElement('canvas'); c.width = tw; c.height = th;
      const g = c.getContext('2d');
      try { g.drawImage(v, 0, 0, tw, th); } catch { g.fillStyle = '#222'; g.fillRect(0, 0, tw, th); }
      thumbs.push(c); tt.push(time);
      if (count > 1 && thumbs.length % 8 === 0) { e.thumbs = thumbs.slice(); e.thumbTimes = tt.slice(); this.emit(asset.id); await sleep(0); }
    }
    v.removeAttribute('src'); try { v.load(); } catch {}
    e.thumbs = thumbs; e.thumbTimes = tt;
    this.emit(asset.id);
  },

  /** Decodifica l'audio in sequenza (una alla volta per contenere la memoria). */
  decodeAudio(asset) {
    const e = this.entry(asset.id);
    const job = async () => {
      if (e.audioState === 'ready' || e.audioState === 'none') return;
      if (asset.hasAudio === false) { e.audioState = 'none'; this.emit(asset.id); return; }
      if (!e.blob) return;
      if (asset.size > MAX_AUDIO_DECODE) { e.audioState = 'toolarge'; this.emit(asset.id); return; }
      try {
        const buf = await e.blob.arrayBuffer();
        const audio = await this.audioCtx().decodeAudioData(buf);
        e.audio = audio; e.audioState = 'ready';
        if (!e.peaks) e.peaks = this.computePeaks(audio, asset.duration);
      } catch (err) {
        // Nessuna traccia audio oppure codec audio non decodificabile
        e.audioState = asset.hasAudio ? 'error' : 'none';
        if (err instanceof RangeError) e.audioState = 'toolarge';
      }
      this.emit(asset.id);
    };
    this._audioQueue = this._audioQueue.then(job, job);
    return this._audioQueue;
  },
  /** Attende che l'audio delle clip sia pronto (per riprodurre ed esportare in modo fedele). */
  async waitAudio(ids) {
    const pend = [];
    for (const id of ids) {
      const e = this.rt.get(id);
      if (e && e.status === 'ready' && e.audioState === 'pending' && e.audioP) pend.push(e.audioP);
    }
    if (pend.length) await Promise.all(pend.map((p) => Promise.resolve(p).catch(() => {})));
  },
  computePeaks(audio, duration) {
    const n = Math.max(1, Math.ceil(duration * PEAKS_PER_SEC));
    const out = new Float32Array(n);
    const chs = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
    const sr = audio.sampleRate; const per = sr / PEAKS_PER_SEC;
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * per); const b = Math.min(chs[0].length, Math.floor((i + 1) * per));
      let m = 0;
      for (const ch of chs) for (let j = a; j < b; j += 4) { const v = Math.abs(ch[j]); if (v > m) m = v; }
      out[i] = m;
    }
    return out;
  },
  async saveDerived(id) {
    const e = this.rt.get(id); if (!e) return;
    try {
      const blobs = await Promise.all(e.thumbs.map((c) => (c.toBlob ? new Promise((r) => c.toBlob(r, 'image/jpeg', 0.72)) : null)));
      await DB.put('derived', { id, thumbs: blobs.filter(Boolean), thumbTimes: e.thumbTimes, peaks: e.peaks, pps: e.pps, audioState: e.audioState === 'ready' ? 'ready' : e.audioState });
    } catch (err) { ErrLog.add('derived', err); }
  },

  /** Prepara gli asset di un progetto aperto: file dal dispositivo, miniature e forma d'onda in cache. */
  async loadProject(project) {
    const ids = Object.keys(project.assets);
    await Promise.all(ids.map(async (id) => {
      const asset = project.assets[id];
      const e = this.entry(id);
      if (e.status === 'ready' && e.url) return;
      let rec = null;
      try { rec = await DB.get('media', id); } catch (err) { ErrLog.add('load-media', err); }
      if (!rec || !rec.blob) { e.status = 'missing'; this.emit(id); return; }
      e.blob = rec.blob; e.url = URL.createObjectURL(rec.blob);
      if (asset.kind === 'image') {
        try { const { bmp } = await this.decodeImage(rec.blob); e.image = bmp; e.thumbs = [this.imageThumb(bmp)]; e.thumbTimes = [0]; e.status = 'ready'; }
        catch { e.status = 'missing'; }
        e.audioState = 'none';
        this.emit(id);
        return;
      }
      let der = null;
      try { der = await DB.get('derived', id); } catch {}
      if (der && der.thumbs && der.thumbs.length) {
        try {
          e.thumbs = await Promise.all(der.thumbs.map((b) => createImageBitmap(b)));
          e.thumbTimes = der.thumbTimes || [];
        } catch { e.thumbs = []; }
      }
      if (der && der.peaks) e.peaks = der.peaks;
      if (der && der.audioState === 'none') e.audioState = 'none';
      e.status = 'ready';
      this.emit(id);
      if (!e.thumbs.length && asset.kind !== 'audio') { try { await this.makeThumbs(asset, 1); } catch {} }
      // completa ciò che manca in background (prima l'audio)
      const needThumbs = asset.kind !== 'audio' && e.thumbs.length < Math.min(60, Math.ceil(asset.duration));
      e.audioP = this.decodeAudio(asset);
      e.bg = (async () => {
        await e.audioP;
        if (needThumbs) { try { await this.makeThumbs(asset, Math.max(1, Math.min(60, Math.ceil(asset.duration)))); } catch {} }
        if (needThumbs || !der || !der.peaks) await this.saveDerived(id);
      })();
    }));
  },

  /** Verifica che un file selezionato corrisponda a un asset mancante (nome, dimensione, durata). */
  async matchScore(asset, file) {
    let score = 0;
    if (file.size === asset.size) score += 2;
    if (file.name === asset.name) score += 1;
    if (score === 0) return 0;
    try {
      if (asset.kind === 'image') {
        const { bmp, W, H } = await this.decodeImage(file); bmp.close();
        if (W === asset.width && H === asset.height) score += 2; else return 0;
        return score;
      }
      const url = URL.createObjectURL(file);
      const info = await (asset.kind === 'audio' ? this.probeAudio(url) : this.probe(url)).finally(() => URL.revokeObjectURL(url));
      if (Math.abs(info.duration - asset.duration) < 0.2) score += 2; else return 0;
    } catch { return 0; }
    return score;
  },
  /** Ricollega un file a un asset esistente (stesso id, i tagli restano validi). */
  async relink(asset, file) {
    try { await DB.put('media', { id: asset.id, blob: file, name: file.name, size: file.size, addedAt: Date.now() }); }
    catch (err) {
      const q = err && (err.name === 'QuotaExceededError' || /quota/i.test(err.message || ''));
      throw new MediaError2(q ? 'quota' : 'store', { name: file.name });
    }
    const e = this.entry(asset.id);
    if (e.url) URL.revokeObjectURL(e.url);
    Demux.cache.delete(asset.id);
    e.blob = file; e.url = URL.createObjectURL(file); e.status = 'ready'; e.audioState = 'pending'; e.audio = null;
    if (asset.kind === 'image') {
      const { bmp } = await this.decodeImage(file); e.image = bmp; e.thumbs = [this.imageThumb(bmp)]; e.thumbTimes = [0]; e.audioState = 'none';
      this.emit(asset.id); this.saveDerived(asset.id); return;
    }
    if (asset.kind !== 'audio') { try { await this.makeThumbs(asset, 1); } catch {} }
    this.emit(asset.id);
    this.processInBackground(asset);
  },

  /** Rimuove i file non più usati da nessun progetto locale. */
  async collectGarbage() {
    try {
      const projects = await DB.all('projects');
      const used = new Set();
      for (const p of projects) for (const id of Object.keys(p.assets || {})) used.add(id);
      const keys = await DB.keys('media');
      let freed = 0;
      for (const k of keys) if (!used.has(k)) {
        const rec = await DB.get('media', k); freed += (rec && rec.size) || 0;
        await DB.del('media', k); await DB.del('derived', k).catch(() => {});
      }
      const dkeys = await DB.keys('derived');
      for (const k of dkeys) if (!used.has(k)) await DB.del('derived', k).catch(() => {});
      return freed;
    } catch (err) { ErrLog.add('gc', err); return 0; }
  },

  /** Messaggio chiaro per ogni errore d'importazione. */
  errorText(err, name) {
    const n = name || err.name2 || err.name || '';
    switch (err.code) {
      case 'not-video': return t('err.notMedia', { name: n });
      case 'too-big': return t('err.tooBig', { name: n, max: fmtBytes(MAX_FILE) });
      case 'unsupported':
        if (err.container === 'unknown') return t('err.corrupt', { name: n });
        if (err.codec && /HEVC/.test(err.codec)) return t('err.hevc', { name: n });
        if (err.container === 'avi' || err.container === 'mkv') return t('err.container', { name: n, fmt: err.container.toUpperCase() });
        return t('err.unsupported', { name: n });
      case 'corrupt': return t('err.corrupt', { name: n });
      case 'no-video': return t('err.noVideo', { name: n });
      case 'quota': return t('err.quota', { name: n });
      case 'read': return t('err.read', { name: n });
      case 'timeout': return t('err.timeout', { name: n });
      default: return t('err.generic', { name: n });
    }
  },
};
