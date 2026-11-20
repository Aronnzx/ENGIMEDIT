'use strict';
/* =========================================================================
   sample.js — tre clip di esempio generate al momento nel browser:
   animazioni originali + accordi sintetizzati. Liberamente distribuibili.
   ========================================================================= */
const Samples = {
  W: 1280, H: 720, FPS: 30, DUR: 5,

  scenes() {
    return [
      { key: 'sample.n1', draw: (g, t) => this.dawn(g, t), chord: [261.63, 329.63, 392.0, 523.25] },
      { key: 'sample.n2', draw: (g, t) => this.city(g, t), chord: [220.0, 261.63, 329.63, 440.0] },
      { key: 'sample.n3', draw: (g, t) => this.waves(g, t), chord: [174.61, 220.0, 261.63, 349.23] },
    ];
  },

  /* ---------------- scene ---------------- */
  label(g, n, title, t) {
    const { W, H } = this;
    g.fillStyle = 'rgba(8,5,22,0.55)';
    this.round(g, 40, 40, 74, 74, 18); g.fill();
    g.fillStyle = '#fff'; g.font = '800 46px "Plus Jakarta Sans", system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), 77, 79);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.font = '800 64px "Plus Jakarta Sans", system-ui, sans-serif';
    g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 18;
    g.fillText(title, 44, H - 70); g.shadowBlur = 0;
    // barra del tempo della clip: aiuta a vedere tagli e divisioni
    const p = t / this.DUR;
    g.fillStyle = 'rgba(255,255,255,0.25)'; this.round(g, 44, H - 46, W - 88, 8, 4); g.fill();
    g.fillStyle = '#fff'; this.round(g, 44, H - 46, Math.max(8, (W - 88) * p), 8, 4); g.fill();
    g.font = '700 30px "Plus Jakarta Sans", system-ui, sans-serif'; g.textAlign = 'right';
    g.fillText(t.toFixed(1).replace('.', I18N.lang === 'it' ? ',' : '.') + ' s', W - 44, 92);
    g.textAlign = 'left';
  },
  round(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); },
  dawn(g, t) {
    const { W, H } = this; const p = t / this.DUR;
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, `hsl(${262 - p * 30}, 60%, ${16 + p * 14}%)`);
    sky.addColorStop(0.6, `hsl(${300 - p * 40}, 70%, ${40 + p * 12}%)`);
    sky.addColorStop(1, `hsl(${22 + p * 8}, 90%, ${58 + p * 6}%)`);
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    const sy = H * 0.78 - p * H * 0.38;
    const glow = g.createRadialGradient(W * 0.62, sy, 10, W * 0.62, sy, 260);
    glow.addColorStop(0, 'rgba(255,220,150,0.9)'); glow.addColorStop(1, 'rgba(255,160,120,0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffe2a8'; g.beginPath(); g.arc(W * 0.62, sy, 70, 0, Math.PI * 2); g.fill();
    const hills = [['#3b2370', 0.74, 60, 0.004], ['#26164d', 0.82, 45, 0.006], ['#150c2e', 0.9, 30, 0.009]];
    for (const [col, base, amp, f] of hills) {
      g.fillStyle = col; g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 16) g.lineTo(x, H * base - Math.sin(x * f + base * 9) * amp - Math.cos(x * f * 0.5) * amp * 0.5);
      g.lineTo(W, H); g.closePath(); g.fill();
    }
    this.label(g, 1, t_('sample.n1'), t);
  },
  city(g, t) {
    const { W, H } = this;
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#07051a'); sky.addColorStop(1, '#3a1f7a');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 70; i++) { const x = (i * 97.3) % W; const y = (i * 53.7) % (H * 0.5); g.fillStyle = `rgba(255,255,255,${0.3 + 0.5 * Math.abs(Math.sin(t * 2 + i))})`; g.fillRect(x, y, 2, 2); }
    let x = -20; let i = 0;
    while (x < W) {
      const bw = 70 + ((i * 37) % 80); const bh = 180 + ((i * 71) % 300);
      g.fillStyle = i % 2 ? '#1c1240' : '#24185a'; g.fillRect(x, H - bh, bw, bh);
      for (let wy = H - bh + 18; wy < H - 30; wy += 26) for (let wx = x + 10; wx < x + bw - 12; wx += 18) {
        const on = Math.sin(wx * 0.37 + wy * 0.11 + Math.floor(t * 2 + i) * 1.7) > 0.15;
        g.fillStyle = on ? 'rgba(255,214,140,0.9)' : 'rgba(120,100,200,0.25)'; g.fillRect(wx, wy, 8, 12);
      }
      x += bw + 6; i++;
    }
    g.fillStyle = '#0b0820'; g.fillRect(0, H - 34, W, 34);
    for (let c = 0; c < 4; c++) {
      const cx = ((t * 260 + c * 360) % (W + 200)) - 100;
      g.fillStyle = c % 2 ? '#ff5c8a' : '#8bd3ff';
      g.shadowColor = g.fillStyle; g.shadowBlur = 16; g.fillRect(cx, H - 24, 36, 8); g.shadowBlur = 0;
    }
    this.label(g, 2, t_('sample.n2'), t);
  },
  waves(g, t) {
    const { W, H } = this;
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0f3d5e'); bg.addColorStop(1, '#4b2fc2');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const layers = [['rgba(139,108,255,0.55)', 0.45, 34, 0.010, 1.4], ['rgba(80,200,230,0.55)', 0.58, 28, 0.013, -1.9], ['rgba(167,139,250,0.7)', 0.7, 22, 0.017, 2.6], ['rgba(20,12,60,0.85)', 0.84, 16, 0.02, -3.1]];
    for (const [col, base, amp, f, sp] of layers) {
      g.fillStyle = col; g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 12) g.lineTo(x, H * base + Math.sin(x * f + t * sp) * amp + Math.sin(x * f * 2.3 - t * sp * 0.7) * amp * 0.4);
      g.lineTo(W, H); g.closePath(); g.fill();
    }
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 3; g.beginPath();
    g.arc(W * 0.78, H * 0.26, 46 + Math.sin(t * 3) * 4, 0, Math.PI * 2); g.stroke();
    this.label(g, 3, t_('sample.n3'), t);
  },

  /** Accordo arpeggiato: impulsi regolari ben visibili nella forma d'onda. */
  async audio(chord) {
    const sr = 48000; const len = this.DUR * sr;
    const oc = new OfflineAudioContext(2, len, sr);
    const master = oc.createGain(); master.gain.value = 0.5; master.connect(oc.destination);
    const pad = oc.createGain(); pad.gain.value = 0.05; pad.connect(master);
    for (const f of chord.slice(0, 3)) { const o = oc.createOscillator(); o.type = 'sine'; o.frequency.value = f / 2; o.connect(pad); o.start(0); o.stop(this.DUR); }
    const step = 0.25;
    for (let i = 0; i * step < this.DUR - 0.05; i++) {
      const at = i * step; const f = chord[i % chord.length] * (i % 8 >= 4 ? 2 : 1);
      const o = oc.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = oc.createGain(); g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(i % 4 === 0 ? 0.55 : 0.3, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + step * 0.95);
      const pan = oc.createStereoPanner(); pan.pan.value = Math.sin(i) * 0.4;
      o.connect(g); g.connect(pan); pan.connect(master); o.start(at); o.stop(at + step);
    }
    return oc.startRendering();
  },

  /** Genera i file. onProgress(0..1). Restituisce un array di File. */
  async generate(onProgress) {
    const scenes = this.scenes();
    const v = document.createElement('video');
    const playsAvc = v.canPlayType('video/mp4; codecs="avc1.42E01F"') !== '';
    const playsVp9 = v.canPlayType('video/mp4; codecs="vp09.00.10.08"') !== '';
    let vcodec = null;
    if (window.Mp4Muxer && window.VideoEncoder) {
      const vbr = 2500000;
      if (playsAvc) vcodec = await Exporter.pickVideo(this.W, this.H, this.FPS, vbr, false);
      if (!vcodec && playsVp9) {
        try { const s = await VideoEncoder.isConfigSupported({ codec: 'vp09.00.10.08', width: this.W, height: this.H, bitrate: vbr, framerate: this.FPS }); if (s.supported) vcodec = 'vp09.00.10.08'; } catch {}
      }
    }
    const acodec = vcodec ? await Exporter.pickAudio() : null;
    const files = [];
    for (let s = 0; s < scenes.length; s++) {
      const sc = scenes[s];
      const name = t(sc.key);
      const prog = (f) => onProgress && onProgress((s + f) / scenes.length);
      const audio = await this.audio(sc.chord);
      let blob; let ext;
      if (vcodec && acodec) { blob = await this.encodeFast(sc, audio, vcodec, acodec, prog); ext = 'mp4'; }
      else { const r = await this.encodeRealtime(sc, audio, prog); blob = r.blob; ext = r.ext; }
      files.push(new File([blob], `${name}.${ext}`, { type: blob.type || `video/${ext}`, lastModified: Date.now() }));
    }
    onProgress && onProgress(1);
    return files;
  },
  async encodeFast(sc, audio, vcodec, acodec, prog) {
    const { W, H, FPS, DUR } = this;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { alpha: false });
    const w = new MP4Writer({ W, H, fps: FPS, vcodec, vbr: 2500000, acodec });
    const N = DUR * FPS;
    for (let i = 0; i < N; i++) {
      sc.draw(g, i / FPS);
      w.addFrame(c);
      await w.drain(6);
      if (i % 15 === 0) prog(i / N * 0.95);
    }
    await w.addAudio(audio);
    return w.finish();
  },
  async encodeRealtime(sc, audio, prog) {
    const { W, H, FPS, DUR } = this;
    const types = [['video/mp4;codecs=avc1,mp4a.40.2', 'mp4'], ['video/webm;codecs=vp9,opus', 'webm'], ['video/webm;codecs=vp8,opus', 'webm'], ['video/webm', 'webm'], ['video/mp4', 'mp4']];
    const pick = types.find(([m]) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
    if (!pick) throw new Error('no-encoder');
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { alpha: false });
    sc.draw(g, 0);
    const ac = Media.audioCtx();
    if (ac.state === 'suspended') await ac.resume().catch(() => {});
    const dest = ac.createMediaStreamDestination();
    const src = ac.createBufferSource(); src.buffer = audio; src.connect(dest);
    const vs = c.captureStream(FPS);
    const rec = new MediaRecorder(new MediaStream([...vs.getVideoTracks(), ...dest.stream.getAudioTracks()]), { mimeType: pick[0], videoBitsPerSecond: 2500000 });
    const chunks = []; rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise((r) => { rec.onstop = r; });
    rec.start(250);
    const t0 = ac.currentTime + 0.05; src.start(t0);
    await new Promise((resolve) => {
      const loop = () => {
        const tt = ac.currentTime - t0;
        if (tt >= DUR) return resolve();
        sc.draw(g, Math.max(0, tt)); prog(Math.max(0, tt) / DUR);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    rec.stop(); await stopped;
    vs.getTracks().forEach((tr) => tr.stop());
    return { blob: new Blob(chunks, { type: pick[0].split(';')[0] }), ext: pick[1] };
  },
};
