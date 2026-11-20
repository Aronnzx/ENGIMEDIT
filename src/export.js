'use strict';
/* =========================================================================
   export.js — esportazione della sequenza.
   Percorso principale: WebCodecs (H.264 + AAC/Opus) + mp4-muxer → file MP4.
   I fotogrammi V1 arrivano dalla decodifica diretta (demux.js) o dalla
   cattura in riproduzione e vengono composti con Render.frame (V2, colore,
   effetti, bande nere), come nell'anteprima. L'audio (V1 + A1, dissolvenze,
   EQ) viene mixato con OfflineAudioContext tramite AudioFX.schedule, la
   stessa funzione dell'anteprima. Ripiego: MediaRecorder in tempo reale.
   ========================================================================= */
class ExportAbort extends Error { constructor() { super('abort'); this.code = 'abort'; } }

/** Scrittore MP4: encoder video/audio + muxer. Riutilizzato anche per le clip di esempio. */
class MP4Writer {
  constructor({ W, H, fps, vcodec, vbr, acodec }) {
    this.W = W; this.H = H; this.fps = fps; this.err = null;
    const vfamily = vcodec.startsWith('avc') ? 'avc' : vcodec.startsWith('vp09') ? 'vp9' : 'av1';
    this.muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: vfamily, width: W, height: H, frameRate: fps },
      audio: acodec ? { codec: acodec.name, numberOfChannels: 2, sampleRate: 48000 } : undefined,
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });
    this.ve = new VideoEncoder({
      output: (chunk, meta) => { try { this.muxer.addVideoChunk(chunk, meta); } catch (e) { this.err = e; } },
      error: (e) => { this.err = e; },
    });
    const cfg = { codec: vcodec, width: W, height: H, bitrate: vbr, framerate: fps, latencyMode: 'quality' };
    if (vfamily === 'avc') cfg.avc = { format: 'avc' };
    this.ve.configure(cfg);
    this.acodec = acodec;
    this.k = 0;
  }
  check() { if (this.err) throw this.err; }
  addFrame(source) {
    this.check();
    const ts = Math.round((this.k * 1e6) / this.fps);
    const frame = new VideoFrame(source, { timestamp: ts, duration: Math.round(1e6 / this.fps) });
    this.ve.encode(frame, { keyFrame: this.k % (this.fps * 2) === 0 });
    frame.close();
    this.k++;
  }
  get queue() { return this.ve.encodeQueueSize; }
  async drain(max = 8) { while (this.ve.encodeQueueSize > max) { this.check(); await sleep(3); } this.check(); }
  async addAudio(buf, signal) {
    if (!this.acodec || !buf) return;
    const ae = new AudioEncoder({
      output: (chunk, meta) => { try { this.muxer.addAudioChunk(chunk, meta); } catch (e) { this.err = e; } },
      error: (e) => { this.err = e; },
    });
    ae.configure({ codec: this.acodec.codec, sampleRate: 48000, numberOfChannels: 2, bitrate: this.acodec.br });
    const L = buf.getChannelData(0); const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    const step = 4800;
    for (let i = 0; i < buf.length; i += step) {
      if (signal && signal.aborted) { try { ae.close(); } catch {} throw new ExportAbort(); }
      const n = Math.min(step, buf.length - i);
      const data = new Float32Array(n * 2);
      data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i * 1e6) / 48000), data });
      ae.encode(ad); ad.close();
      if (ae.encodeQueueSize > 40) await sleep(1);
      this.check();
    }
    await ae.flush(); ae.close();
    this.check();
  }
  async finish() {
    await this.ve.flush(); this.check();
    try { this.ve.close(); } catch {}
    this.muxer.finalize();
    return new Blob([this.muxer.target.buffer], { type: 'video/mp4' });
  }
  abort() { try { this.ve.close(); } catch {} }
}

const Exporter = {
  /* Preset per i social. format null = formato del progetto. res = lato corto. */
  PRESETS: [
    { id: 'youtube', icon: 'youtube', format: '16:9', res: 1080, fps: 30, quality: 'high' },
    { id: 'reels', icon: 'vertical', format: '9:16', res: 1080, fps: 30, quality: 'high' },
    { id: 'insta', icon: 'portrait', format: '4:5', res: 1080, fps: 30, quality: 'high' },
    { id: 'hq', icon: 'star', format: null, res: 'max', fps: 30, quality: 'max' },
    { id: 'light', icon: 'feather', format: null, res: 720, fps: 30, quality: 'low' },
  ],
  QUALITY_BPP: { low: 0.045, medium: 0.07, high: 0.1, max: 0.16 },

  dims(format, res) {
    const f = Engine.FORMATS[format] || Engine.FORMATS['16:9'];
    const even = (x) => Math.max(2, Math.round(x / 2) * 2);
    if (f.w >= f.h) return { w: even((res * f.w) / f.h), h: even(res) };
    return { w: even(res), h: even((res * f.h) / f.w) };
  },
  /** Risoluzione massima sensata: quella delle sorgenti usate, tra 1080 e 2160. */
  maxRes(project) {
    let m = 0;
    for (const c of project.tracks[0].clips) { const a = project.assets[c.assetId]; if (a) m = Math.max(m, Math.min(a.width, a.height)); }
    return Math.max(1080, Math.min(2160, m || 1080));
  },
  bitrate(w, h, fps, quality) { return Math.round(Math.max(1.2e6, Math.min(60e6, w * h * fps * (this.QUALITY_BPP[quality] || 0.1)))); },
  level(w, h, fps) {
    const mbs = Math.ceil(w / 16) * Math.ceil(h / 16); const mbps = mbs * fps;
    const L = [[0x1f, 108000, 3600], [0x28, 245760, 8192], [0x2a, 522240, 8704], [0x32, 589824, 22080], [0x33, 983040, 36864], [0x34, 2073600, 36864], [0x3c, 4177920, 139264]];
    for (const [lv, rate, size] of L) if (mbps <= rate && mbs <= size) return lv.toString(16).padStart(2, '0');
    return '3c';
  },
  async pickAudio() {
    if (!window.AudioEncoder || !window.AudioData) return null;
    for (const [codec, name, br] of [['mp4a.40.2', 'aac', 160000], ['opus', 'opus', 128000]]) {
      try { const s = await AudioEncoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: br }); if (s.supported) return { codec, name, br }; } catch {}
    }
    return null;
  },
  async pickVideo(w, h, fps, vbr, allowVp9) {
    if (!window.VideoEncoder || !window.VideoFrame) return null;
    const L = this.level(w, h, fps);
    const list = [`avc1.6400${L}`, `avc1.4d00${L}`, `avc1.42e0${L}`, `avc1.4200${L}`];
    if (allowVp9) list.push('vp09.00.40.08');
    for (const codec of list) {
      try {
        const cfg = { codec, width: w, height: h, bitrate: vbr, framerate: fps };
        if (codec.startsWith('avc')) cfg.avc = { format: 'avc' };
        const s = await VideoEncoder.isConfigSupported(cfg);
        if (s.supported) return codec;
      } catch {}
    }
    return null;
  },
  /** Decide come esportare con il browser attuale. */
  async plan(w, h, fps, vbr, needAudio) {
    const vcodec = await this.pickVideo(w, h, fps, vbr, false);
    const acodec = needAudio ? await this.pickAudio() : null;
    if (vcodec && (acodec || !needAudio) && window.Mp4Muxer) {
      const a = acodec ? (acodec.name === 'aac' ? ' + AAC' : ' + Opus') : '';
      return { mode: 'webcodecs', vcodec, acodec, ext: 'mp4', mime: 'video/mp4', label: `MP4 (H.264${a})`, opusWarn: !!(acodec && acodec.name === 'opus') };
    }
    if (window.MediaRecorder && HTMLCanvasElement.prototype.captureStream) {
      const opts = [['video/mp4;codecs=avc1,mp4a.40.2', 'mp4', 'MP4 (H.264 + AAC)'], ['video/mp4', 'mp4', 'MP4'], ['video/webm;codecs=vp9,opus', 'webm', 'WebM (VP9 + Opus)'], ['video/webm;codecs=vp8,opus', 'webm', 'WebM (VP8 + Opus)'], ['video/webm', 'webm', 'WebM']];
      for (const [mime, ext, label] of opts) if (MediaRecorder.isTypeSupported(mime)) return { mode: 'recorder', mime, ext, label, realtime: true };
    }
    return null;
  },
  /** Progetto normalizzato: accetta anche il vecchio formato {clips, assets}. */
  projectOf(job) {
    if (job.project) return job.project;
    return { tracks: [{ id: 'v1', kind: 'video', clips: job.clips || [] }], settings: {}, assets: job.assets || {} };
  },
  needsAudio(p) {
    const project = Array.isArray(p) ? { tracks: [{ id: 'v1', clips: p }] } : p;
    return AudioFX.items(project).length > 0;
  },
  estimateSize(seconds, vbr, hasAudio) { return Math.round(((vbr + (hasAudio ? 160000 : 0)) * seconds) / 8 * 1.03); },

  /** Mix audio dell'intero progetto (stessa programmazione dell'anteprima). */
  async renderMix(project) {
    if (Array.isArray(project)) project = { tracks: [{ id: 'v1', clips: project }] };
    const total = Engine.projectTotal(project);
    const len = Math.max(1, Math.ceil(total * 48000));
    const oc = new OfflineAudioContext(2, len, 48000);
    AudioFX.schedule(oc, oc.destination, project, 0, 0);
    return oc.startRendering();
  },
  assetIds(project) { const s = new Set(); for (const tr of project.tracks) for (const c of tr.clips) if (c.assetId) s.add(c.assetId); return [...s]; },

  /**
   * Esegue l'esportazione.
   * job: { clips, W, H, fps, vbr, plan }
   * hooks: { stage(name), progress(frac, info), signal }
   */
  async run(job, hooks) {
    if (job.plan.mode === 'recorder') return this.runRecorder(job, hooks);
    return this.runWebCodecs(job, hooks);
  },

  async runWebCodecs(job, hooks) {
    const { W, H, fps, vbr, plan } = job;
    const project = this.projectOf(job);
    const clips = Engine.track(project, 'v1').clips;
    const signal = hooks.signal;
    const total = Engine.projectTotal(project);
    const N = Math.max(1, Math.ceil(total * fps - 1e-6));
    hooks.stage('prepare');
    await Media.waitAudio(this.assetIds(project));
    const mix = plan.acodec ? await this.renderMix(project) : null;
    if (signal.aborted) throw new ExportAbort();
    const writer = new MP4Writer({ W, H, fps, vcodec: plan.vcodec, vbr, acodec: plan.acodec });
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d', { alpha: false });
    const rc = Render.context();
    /** Compone il fotogramma k (stessa funzione dell'anteprima). */
    const painter = (clip, start) => (k, src, sw, sh) => Render.frame(g, W, H, { t: k / fps, project, v1: src ? { clip, local: Math.max(0, k / fps - start), src, sw, sh } : null, rc, bypass: false });
    /** Fotogrammi senza sorgente video (immagini, clip disattivate, oltre la fine di V1). */
    const still = async (k0, k1, paint, src, sw, sh) => {
      for (let k = k0; k < k1; k++) {
        if (signal.aborted) throw new ExportAbort();
        while (paused) await sleep(200);
        paint(k, src, sw, sh); writer.addFrame(canvas);
        if (k % 3 === 0) report();
        await writer.drain(6);
      }
    };
    const players = new Map();
    const t0 = performance.now();
    let paused = false;
    const onVis = () => { paused = document.hidden; hooks.paused && hooks.paused(paused); };
    document.addEventListener('visibilitychange', onVis);
    const report = () => {
      const frac = writer.k / N;
      const el = (performance.now() - t0) / 1000;
      hooks.progress(frac, { eta: frac > 0.02 ? el / frac - el : null });
    };
    try {
      hooks.stage('video');
      let kEnd = 0;
      for (const { clip, start, end } of Engine.layout(clips)) {
        // il fotogramma k appartiene alla clip che contiene l'istante k/fps (come nell'anteprima)
        const k0 = Math.ceil(start * fps - 1e-6); const k1 = Math.min(N, Math.ceil(end * fps - 1e-6));
        kEnd = Math.max(kEnd, k1);
        if (k1 <= k0) continue;
        const paint = painter(clip, start);
        const ent = Media.get(clip.assetId);
        if (clip.disabled || !ent) { await still(k0, k1, paint, null); continue; }
        if (ent.image) { await still(k0, k1, paint, ent.image, ent.image.width, ent.image.height); continue; }
        // 1) decodifica diretta e esatta (MP4/MOV H.264)
        let kk = k0;
        const idx = await Demux.prepare(clip.assetId);
        if (idx) kk = await Demux.decodeClip({ idx, clip, start, k0, k1, fps, writer, g, paint, signal, report });
        if (kk >= k1) continue;
        // 2) altri formati (o decodifica non riuscita): cattura durante la riproduzione
        let v = players.get(clip.assetId);
        if (!v) {
          v = makeVideoEl(); v.src = Media.get(clip.assetId).url;
          await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('load')); setTimeout(res, 8000); });
          players.set(clip.assetId, v);
        }
        const assets = project.assets || job.assets || {};
        await this.captureClip({ v, clip, start, k0: kk, k1, fps, writer, g, paint, signal, report, isPaused: () => paused, srcFps: (assets[clip.assetId] && assets[clip.assetId].fps) || null });
      }
      // dopo la fine di V1 (titoli, immagini in V2 o musica in A1 più lunghi)
      if (kEnd < N) await still(kEnd, N, painter(null, 0), null);
      if (signal.aborted) throw new ExportAbort();
      hooks.stage('audio');
      if (mix) await writer.addAudio(mix, signal);
      hooks.stage('final');
      const blob = await writer.finish();
      return { blob, ext: 'mp4', mime: 'video/mp4', label: plan.label, duration: total, W, H };
    } catch (e) {
      writer.abort();
      throw e;
    } finally {
      document.removeEventListener('visibilitychange', onVis);
      for (const v of players.values()) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch {} v.remove(); }
    }
  },

  /**
   * Cattura i fotogrammi [k0, k1) di una clip.
   * La sorgente viene riprodotta e ogni fotogramma presentato (requestVideoFrameCallback)
   * viene composto sul canvas. Se il browser salta dei fotogrammi (computer sotto sforzo),
   * quelli mancanti vengono recuperati con un seek esatto e la velocità viene ridotta.
   */
  async captureClip({ v, clip, start, k0, k1, fps, writer, g, paint, signal, report, isPaused, srcFps }) {
    const sp = clip.speed || 1;
    const lastSrc = Math.max(clip.in, clip.out - 0.0005);
    const sAt = (k) => Math.min(lastSrc, Math.max(clip.in, clip.in + (k / fps - start) * sp));
    // l'ultimo fotogramma sorgente viene tenuto da parte: ogni fotogramma d'uscita viene poi
    // composto al proprio istante (zoom dinamico, titoli e grana cambiano nel tempo)
    const hold = document.createElement('canvas');
    const draw = () => {
      if (!v.videoWidth) return;
      if (hold.width !== v.videoWidth || hold.height !== v.videoHeight) { hold.width = v.videoWidth; hold.height = v.videoHeight; }
      try { hold.getContext('2d').drawImage(v, 0, 0); } catch { /* fotogramma non disponibile */ }
    };
    const fd = 1 / (srcFps && srcFps > 1 ? srcFps : 30);   // durata di un fotogramma sorgente
    let k = k0;
    let drawnT = sAt(k0);                                    // tempo del fotogramma presente nel canvas
    const emit = () => { paint(k, hold.width ? hold : null, hold.width, hold.height); writer.addFrame(g.canvas); k++; if (k % 3 === 0) report(); };
    await Media.seek(v, sAt(k0));
    draw();
    /** Fotogrammi esatti tramite seek fino al tempo `until` (escluso). */
    const exactUntil = async (until) => {
      while (k < k1 && sAt(k) + 1e-3 < until) {
        if (signal.aborted) throw new ExportAbort();
        while (isPaused()) await sleep(200);
        const s = sAt(k);
        if (s >= drawnT + fd * 0.999) { await Media.seek(v, s); draw(); drawnT = s; }
        emit();
        await writer.drain(6);
      }
    };
    const canCapture = 'requestVideoFrameCallback' in HTMLVideoElement.prototype && k1 - k0 > 4;
    if (!canCapture) { await exactUntil(Infinity); report(); return; }
    let rate = 1;
    let fallback = false;
    let rewindK = -1; let skips = 0;
    await new Promise((resolve, reject) => {
      let done = false; let last = performance.now(); let wasPaused = false; let busy = false;
      const finish = (err) => {
        if (done) return; done = true;
        clearInterval(wd); v.onended = null; v.pause();
        if (err) reject(err); else resolve();
      };
      const resume = () => {
        if (done) return;
        v.playbackRate = rate * sp;
        v.requestVideoFrameCallback(onFrame);
        if (!isPaused()) v.play().catch(() => {});
        last = performance.now();
      };
      const onFrame = (now, meta) => {
        if (done || busy) return;
        try {
          if (signal.aborted) return finish(new ExportAbort());
          const m = meta.mediaTime;
          last = performance.now();
          const skipped = m - drawnT > fd * 1.5 && k < k1 && sAt(k) + 1e-3 < m;
          if (skipped) {
            // il browser ha saltato dei fotogrammi: si emettono quelli coperti dal fotogramma già
            // nel canvas; poi si torna al primo mancante e si riparte più lentamente. Se il salto si
            // ripete nello stesso punto, i fotogrammi mancanti si prendono uno per uno con seek esatti.
            v.pause(); busy = true; skips++;
            while (k < k1 && sAt(k) + 1e-3 < m && sAt(k) < drawnT + fd * 0.999) emit();
            if (k >= k1) return finish();
            rate = Math.max(0.35, rate * 0.75);
            if (k !== rewindK) {
              rewindK = k;
              const target = sAt(k);
              Media.seek(v, target).then(() => { draw(); drawnT = target; busy = false; resume(); }, finish);
            } else {
              exactUntil(m).then(async () => {
                await Media.seek(v, m); draw(); drawnT = m; busy = false;
                if (k >= k1 || m >= clip.out - 1e-3) { while (k < k1) emit(); return finish(); }
                resume();
              }).catch(finish);
            }
            return;
          }
          while (k < k1 && sAt(k) + 1e-3 < m) emit();
          draw(); drawnT = m;
          if (k >= k1 || m >= clip.out - 1e-3) { while (k < k1) emit(); return finish(); }
          if (writer.queue > 24) {
            v.pause(); busy = true;
            writer.drain(4).then(() => { busy = false; resume(); }, finish);
            return;
          }
          v.requestVideoFrameCallback(onFrame);
        } catch (e) { finish(e); }
      };
      v.onended = () => { if (busy) return; try { while (k < k1) emit(); finish(); } catch (e) { finish(e); } };
      const wd = setInterval(() => {
        if (done || busy) return;
        if (signal.aborted) return finish(new ExportAbort());
        if (isPaused()) { if (!v.paused) v.pause(); wasPaused = true; last = performance.now(); return; }
        if (wasPaused) { wasPaused = false; resume(); return; }
        if (performance.now() - last > 4000) { fallback = true; finish(); }
      }, 250);
      resume();
    });
    v.playbackRate = 1;
    if (fallback && k < k1) await exactUntil(Infinity);
    report();
  },

  /** Ripiego: registrazione in tempo reale con MediaRecorder. */
  async runRecorder(job, hooks) {
    const { W, H, fps, vbr, plan } = job;
    const project = this.projectOf(job);
    const total = Engine.projectTotal(project);
    hooks.stage('prepare');
    await Media.waitAudio(this.assetIds(project));
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ac = Media.audioCtx();
    if (ac.state === 'suspended') await ac.resume().catch(() => {});
    const dest = ac.createMediaStreamDestination();
    let ended; const endP = new Promise((r) => { ended = r; });
    const player = new Player({ canvas, getProject: () => project, audioOut: dest, onTime: (t) => hooks.progress(t / total, { eta: total - t }), onEnd: () => ended() });
    const vs = canvas.captureStream(fps);
    const stream = new MediaStream([...vs.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(stream, { mimeType: plan.mime, videoBitsPerSecond: vbr, audioBitsPerSecond: 160000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopP = new Promise((r) => { rec.onstop = r; });
    const onAbort = () => { player.pause(true); ended(); };
    hooks.signal.addEventListener('abort', onAbort);
    try {
      player.t = 0;
      await player.renderAt(0);
      hooks.stage('video');
      rec.start(500);
      await player.play();
      await endP;
      rec.stop();
      await stopP;
      if (hooks.signal.aborted) throw new ExportAbort();
      hooks.stage('final');
      const blob = new Blob(chunks, { type: plan.mime.split(';')[0] });
      return { blob, ext: plan.ext, mime: plan.mime, label: plan.label, duration: total, W, H };
    } finally {
      hooks.signal.removeEventListener('abort', onAbort);
      try { if (rec.state !== 'inactive') rec.stop(); } catch {}
      player.destroy();
      vs.getTracks().forEach((tr) => tr.stop());
    }
  },
};
