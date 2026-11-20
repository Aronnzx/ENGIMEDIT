'use strict';
/* =========================================================================
   render.js — composizione dei fotogrammi e catena audio, CONDIVISE da
   anteprima (Player) ed esportazione (Exporter): ciò che vedi e senti è
   esattamente ciò che esporti.
   • Livelli: V1 (sequenza principale) → V2 (immagini, titoli, livelli di
     regolazione) → bande nere di uscita (output blanking).
   • Trasformazioni, ritaglio e zoom dinamico con il contesto 2D.
   • Correzione colore ed effetti (sfocatura, grana, vignettatura) con un
     piccolo motore WebGL; se WebGL manca, stessa matematica sulla CPU.
   • Audio: dissolvenze e preset EQ/dinamica con Biquad e Compressor.
   ========================================================================= */

/* ---------------- Correzione colore ed effetti (WebGL) ---------------- */
const GL_VS = 'attribute vec2 p;varying vec2 uv;void main(){uv=p*0.5+0.5;gl_Position=vec4(p,0.0,1.0);}';
const GL_BLUR = `precision mediump float;varying vec2 uv;uniform sampler2D t;uniform vec2 dir;uniform float w[7];
void main(){vec4 c=texture2D(t,uv)*w[0];
for(int i=1;i<7;i++){float f=float(i);c+=(texture2D(t,uv+dir*f)+texture2D(t,uv-dir*f))*w[i];}
gl_FragColor=c;}`;
const GL_GRADE = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 uv;uniform sampler2D t;uniform float lift,gam,gain,con,sat,temp,vig,grain,seed,cell;uniform vec2 res;
float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*0.1031+seed*0.0137);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
void main(){vec4 s=texture2D(t,uv);float a=s.a;if(a<=0.0){gl_FragColor=vec4(0.0);return;}
vec3 c=s.rgb/a;
c=c*gain+lift*(1.0-c);c=clamp(c,0.0,1.0);c=pow(c,vec3(gam));
c=(c-0.5)*con+0.5;float l=dot(c,vec3(0.2126,0.7152,0.0722));c=mix(vec3(l),c,sat);
c+=vec3(temp*0.08,temp*0.015,-temp*0.08);
vec2 asp=vec2(res.x/res.y,1.0);float r=length((uv-0.5)*asp)/length(asp*0.5);
c*=1.0-vig*smoothstep(0.35,1.05,r);
c+=(hash(floor(gl_FragCoord.xy/cell))-0.5)*grain*0.35;
c=clamp(c,0.0,1.0);gl_FragColor=vec4(c*a,a);}`;

/** Parametri numerici dello shader a partire da colore ed effetti della clip. */
function gradeParams(color, fx, bypassColor) {
  const c = bypassColor ? Engine.DEF.color : color;
  return {
    lift: c.lift * 0.25, gam: Math.pow(2, -c.gamma), gain: 1 + c.gain, con: 1 + c.contrast, sat: 1 + c.sat, temp: c.temp,
    vig: fx.vignette, grain: fx.grain, blur: fx.blur,
  };
}

class Grader {
  constructor() { this.cv = document.createElement('canvas'); this.gl = null; this.failed = false; }
  _init() {
    if (this.gl) return true;
    if (this.failed) return false;
    let gl = null;
    try { gl = this.cv.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false, alpha: true, depth: false, stencil: false }); } catch { gl = null; }
    if (!gl) { this.failed = true; return false; }
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader'); return s; };
    const prog = (fs) => {
      const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, GL_VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link');
      const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(p, name); }
      return { p, u };
    };
    try {
      this.pBlur = prog(GL_BLUR); this.pGrade = prog(GL_GRADE);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const tex = () => { const tx = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tx); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); return tx; };
      this.tSrc = tex(); this.tA = tex(); this.tB = tex();
      this.fA = gl.createFramebuffer(); this.fB = gl.createFramebuffer();
      this.size = [0, 0];
      this.cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.gl = null; this.failed = false; });
    } catch (e) { ErrLog.add('webgl', e); this.failed = true; return false; }
    this.gl = gl;
    return true;
  }
  _resize(W, H) {
    const gl = this.gl;
    if (this.size[0] === W && this.size[1] === H) return;
    this.cv.width = W; this.cv.height = H; this.size = [W, H];
    for (const [tx, fb] of [[this.tA, this.fA], [this.tB, this.fB]]) {
      gl.bindTexture(gl.TEXTURE_2D, tx);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tx, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  /** Applica colore ed effetti a `src` (canvas W×H). Restituisce il canvas risultato. */
  apply(src, W, H, P, seed) {
    if (!this._init()) return Grader.cpu(src, W, H, P, seed);
    const gl = this.gl;
    if (gl.isContextLost()) { this.gl = null; return Grader.cpu(src, W, H, P, seed); }
    this._resize(W, H);
    gl.viewport(0, 0, W, H);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tSrc);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    let input = this.tSrc;
    const radius = P.blur * 0.03 * H;          // sfocatura proporzionale all'altezza: uguale a ogni risoluzione
    if (radius >= 0.5) {
      const step = radius / 6;
      const sigma = 2.6; const w = []; let sum = 0;
      for (let i = 0; i < 7; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); w.push(v); sum += i ? 2 * v : v; }
      const wn = new Float32Array(w.map((v) => v / sum));
      gl.useProgram(this.pBlur.p);
      gl.uniform1fv(this.pBlur.u.w, wn); gl.uniform1i(this.pBlur.u.t, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fA); gl.bindTexture(gl.TEXTURE_2D, input);
      gl.uniform2f(this.pBlur.u.dir, step / W, 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fB); gl.bindTexture(gl.TEXTURE_2D, this.tA);
      gl.uniform2f(this.pBlur.u.dir, 0, step / H); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      input = this.tB;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.pGrade.p);
    const u = this.pGrade.u;
    gl.uniform1i(u.t, 0); gl.bindTexture(gl.TEXTURE_2D, input);
    for (const k of ['lift', 'gam', 'gain', 'con', 'sat', 'temp', 'vig', 'grain']) gl.uniform1f(u[k], P[k]);
    gl.uniform1f(u.seed, seed % 997); gl.uniform1f(u.cell, Math.max(1, H / 720)); gl.uniform2f(u.res, W, H);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.cv;
  }
  /** Stessa matematica dello shader, sulla CPU (browser senza WebGL). */
  static cpu(src, W, H, P, seed) {
    const cv = Grader._cpuCv || (Grader._cpuCv = document.createElement('canvas'));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.clearRect(0, 0, W, H);
    const radius = P.blur * 0.03 * H;
    if (radius >= 0.5 && 'filter' in g) g.filter = `blur(${(radius / 2.2).toFixed(2)}px)`;
    g.drawImage(src, 0, 0); g.filter = 'none';
    const img = g.getImageData(0, 0, W, H); const d = img.data;
    const ar = W / H; const norm = Math.hypot(ar * 0.5, 0.5); const cell = Math.max(1, H / 720);
    const sstep = (a, b, x) => { const t2 = Math.min(1, Math.max(0, (x - a) / (b - a))); return t2 * t2 * (3 - 2 * t2); };
    const hash = (x, y) => { let h2 = Math.imul((x | 0) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 374761393), 2246822519); h2 ^= h2 >>> 13; h2 = Math.imul(h2, 3266489917); h2 ^= h2 >>> 16; return (h2 >>> 0) / 4294967296; };
    for (let y = 0; y < H; y++) {
      const v = 1 - (y + 0.5) / H;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4; const a = d[i + 3] / 255; if (a <= 0) continue;
        let r = d[i] / 255 / a; let gg = d[i + 1] / 255 / a; let b = d[i + 2] / 255 / a;
        const f = (c) => Math.pow(Math.min(1, Math.max(0, c * P.gain + P.lift * (1 - c))), P.gam);
        r = (f(r) - 0.5) * P.con + 0.5; gg = (f(gg) - 0.5) * P.con + 0.5; b = (f(b) - 0.5) * P.con + 0.5;
        const l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
        r = l + (r - l) * P.sat; gg = l + (gg - l) * P.sat; b = l + (b - l) * P.sat;
        r += P.temp * 0.08; gg += P.temp * 0.015; b -= P.temp * 0.08;
        const u = (x + 0.5) / W;
        const rad = Math.hypot((u - 0.5) * ar, v - 0.5) / norm; const vg = 1 - P.vig * sstep(0.35, 1.05, rad);
        const n = P.grain ? (hash(Math.floor(x / cell), Math.floor((H - 1 - y) / cell)) - 0.5) * P.grain * 0.35 : 0;
        d[i] = Math.min(1, Math.max(0, r * vg + n)) * a * 255; d[i + 1] = Math.min(1, Math.max(0, gg * vg + n)) * a * 255; d[i + 2] = Math.min(1, Math.max(0, b * vg + n)) * a * 255;
      }
    }
    g.putImageData(img, 0, 0);
    return cv;
  }
}

/* ---------------- Composizione dei fotogrammi ---------------- */
const BLEND_OP = { normal: 'source-over', screen: 'screen', multiply: 'multiply', overlay: 'overlay' };

const Render = {
  /** Contesto di rendering: tele temporanee e motore colore. Uno per Player e uno per esportazione. */
  context() {
    const mk = () => document.createElement('canvas');
    return { grader: new Grader(), layer: mk(), base: mk(), adj: mk(), texts: new Map() };
  },
  _fit(cv, W, H) { if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; } const g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, W, H); return g; },

  /** Testo di un titolo come immagine, con dimensioni relative all'altezza del fotogramma. */
  textSource(rc, clip, W, H) {
    const tx = Engine.g(clip, 'text');
    const key = `${W}x${H}|${tx.content}|${tx.size}|${tx.color}|${tx.bg}|${tx.bold}|${tx.align}`;
    const hit = rc.texts.get(clip.id);
    if (hit && hit.key === key) return hit;
    const px = Math.max(4, tx.size * H);
    const font = `${tx.bold ? 800 : 500} ${px.toFixed(1)}px "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", sans-serif`;
    const lines = String(tx.content || ' ').split('\n').slice(0, 12);
    const meas = document.createElement('canvas').getContext('2d'); meas.font = font;
    const lw = lines.map((l) => meas.measureText(l || ' ').width);
    const pad = px * 0.38; const lh = px * 1.22;
    const cw = Math.ceil(Math.max(...lw, px) + pad * 2); const ch = Math.ceil(lh * lines.length + pad * 2 - (lh - px) * 0.5);
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const g = cv.getContext('2d');
    if (tx.bg) { g.fillStyle = 'rgba(8, 5, 22, 0.62)'; const r = Math.min(px * 0.3, ch / 2); g.beginPath(); if (g.roundRect) g.roundRect(0, 0, cw, ch, r); else g.rect(0, 0, cw, ch); g.fill(); }
    g.font = font; g.fillStyle = tx.color; g.textBaseline = 'middle';
    g.textAlign = tx.align === 'left' ? 'left' : tx.align === 'right' ? 'right' : 'center';
    const x = tx.align === 'left' ? pad : tx.align === 'right' ? cw - pad : cw / 2;
    if (!tx.bg) { g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = px * 0.12; g.shadowOffsetY = px * 0.03; }
    lines.forEach((l, i) => g.fillText(l, x, pad + lh * i + px * 0.55));
    const res = { key, src: cv, sw: cw, sh: ch };
    rc.texts.set(clip.id, res);
    if (rc.texts.size > 40) rc.texts.delete(rc.texts.keys().next().value);
    return res;
  },

  /**
   * Disegna una sorgente con inquadratura (Adatta/Riempi), trasformazione,
   * ritaglio e zoom dinamico. mode 'native' = dimensioni già nel fotogramma (titoli).
   */
  place(g, W, H, clip, src, sw, sh, local, mode) {
    if (!src || !sw || !sh) return;
    const tf = Engine.g(clip, 'tf'); const cr = Engine.g(clip, 'crop');
    const m = Engine.dzScale(clip, local);
    const fill = clip.fit === 'fill';
    const s = mode === 'native' ? 1 : (fill ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh));
    const dw = sw * s; const dh = sh * s;
    let cx = W / 2; let cy = H / 2;
    if (fill && mode !== 'native') { cx -= ((clip.ox || 0) * (dw - W)) / 2; cy -= ((clip.oy || 0) * (dh - H)) / 2; }
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    const neutral = m === 1 && Engine.isNeutral(clip, 'tf') && Engine.isNeutral(clip, 'crop');
    try {
      if (neutral) { g.drawImage(src, cx - dw / 2, cy - dh / 2, dw, dh); return; }
      const l = clamp(cr.l, 0, 0.98); const r = clamp(cr.r, 0, 0.98 - l); const tp = clamp(cr.t, 0, 0.98); const b = clamp(cr.b, 0, 0.98 - tp);
      g.save();
      g.translate(cx + tf.x * W, cy + tf.y * H);
      if (tf.rot) g.rotate((tf.rot * Math.PI) / 180);
      const zx = tf.zx * m; const zy = (tf.link ? tf.zx : tf.zy) * m;
      g.scale(zx * (tf.flipH ? -1 : 1), zy * (tf.flipV ? -1 : 1));
      g.drawImage(src, l * sw, tp * sh, sw * (1 - l - r), sh * (1 - tp - b), -dw / 2 + l * dw, -dh / 2 + tp * dh, dw * (1 - l - r), dh * (1 - tp - b));
      g.restore();
    } catch { /* fotogramma non ancora disponibile */ }
  },

  /** Un livello completo: posizionamento → colore/effetti → fusione sul fotogramma. */
  layer(ctx, W, H, clip, src, sw, sh, local, o, opts) {
    const grade = (!o.bypass && Engine.colorOn(clip)) || Engine.fxOn(clip);
    const comp = opts.comp ? Engine.g(clip, 'comp') : Engine.DEF.comp;
    const direct = !grade && comp.opacity >= 0.999 && comp.blend === 'normal';
    if (direct) { this.place(ctx, W, H, clip, src, sw, sh, local, opts.mode); return; }
    const lg = this._fit(o.rc.layer, W, H);
    this.place(lg, W, H, clip, src, sw, sh, local, opts.mode);
    let out = o.rc.layer;
    if (grade) out = o.rc.grader.apply(o.rc.layer, W, H, gradeParams(Engine.g(clip, 'color'), Engine.g(clip, 'fx'), o.bypass), o.seed);
    ctx.save();
    ctx.globalAlpha = clamp(comp.opacity, 0, 1);
    ctx.globalCompositeOperation = BLEND_OP[comp.blend] || 'source-over';
    ctx.drawImage(out, 0, 0, W, H);
    ctx.restore();
  },

  /** Livello di regolazione: trasforma e corregge tutto ciò che c'è sotto. */
  adjust(ctx, W, H, clip, local, o) {
    const grade = (!o.bypass && Engine.colorOn(clip)) || Engine.fxOn(clip);
    const moved = Engine.dzScale(clip, local) !== 1 || !Engine.isNeutral(clip, 'tf') || !Engine.isNeutral(clip, 'crop');
    if (!grade && !moved) return;
    const bg = this._fit(o.rc.base, W, H); bg.drawImage(ctx.canvas, 0, 0, W, H);
    const lg = this._fit(o.rc.layer, W, H);
    lg.fillStyle = '#000'; lg.fillRect(0, 0, W, H);
    this.place(lg, W, H, { ...clip, fit: 'fit' }, o.rc.base, W, H, local, 'fit');
    const out = grade ? o.rc.grader.apply(o.rc.layer, W, H, gradeParams(Engine.g(clip, 'color'), Engine.g(clip, 'fx'), o.bypass), o.seed) : o.rc.layer;
    const comp = Engine.g(clip, 'comp');
    ctx.save();
    ctx.globalAlpha = clamp(comp.opacity, 0, 1);
    ctx.globalCompositeOperation = BLEND_OP[comp.blend] || 'source-over';
    ctx.drawImage(out, 0, 0, W, H);
    ctx.restore();
  },

  /** Bande nere di uscita per un rapporto cinema (0 = nessuna). */
  blanking(ctx, W, H, ratio) {
    if (!ratio) return;
    const R = W / H;
    ctx.fillStyle = '#000';
    if (R > ratio + 1e-3) { const bw = Math.round((W - H * ratio) / 2); if (bw > 0) { ctx.fillRect(0, 0, bw, H); ctx.fillRect(W - bw, 0, bw, H); } }
    else if (R < ratio - 1e-3) { const bh = Math.round((H - W / ratio) / 2); if (bh > 0) { ctx.fillRect(0, 0, W, bh); ctx.fillRect(0, H - bh, W, bh); } }
  },

  /**
   * Compone il fotogramma al tempo t.
   * o = { t, project:{tracks, settings}, v1:{clip, local, src, sw, sh}|null, rc, bypass }
   */
  frame(ctx, W, H, o) {
    o.seed = Math.floor((o.t || 0) * 24 + 1e-6);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const v1 = o.v1;
    if (v1 && v1.src && !v1.clip.disabled) this.layer(ctx, W, H, v1.clip, v1.src, v1.sw, v1.sh, v1.local, o, { comp: false });
    const v2 = Engine.track(o.project, 'v2').clips;
    const hit = v2.length ? Engine.freeAt(v2, o.t) : null;
    if (hit && !hit.clip.disabled) {
      const c = hit.clip; const k = Engine.kindOf(c);
      if (k === 'adjust') this.adjust(ctx, W, H, c, hit.local, o);
      else if (k === 'text') { const s = this.textSource(o.rc, c, W, H); this.layer(ctx, W, H, c, s.src, s.sw, s.sh, hit.local, o, { comp: true, mode: 'native' }); }
      else { const e = Media.get(c.assetId); if (e && e.image) this.layer(ctx, W, H, c, e.image, e.image.width, e.image.height, hit.local, o, { comp: true }); }
    }
    const s = o.project.settings || {};
    this.blanking(ctx, W, H, Engine.BLANKING[s.blanking] || 0);
    ctx.restore();
  },
};

/* ---------------- Audio: dissolvenze e preset EQ / dinamica ---------------- */
const AudioFX = {
  /** Catena di equalizzazione e dinamica del preset; restituisce il nodo d'ingresso. */
  chain(ac, preset, dest) {
    const bq = (type, f, gain, q) => { const n = ac.createBiquadFilter(); n.type = type; n.frequency.value = f; if (gain !== undefined) n.gain.value = gain; if (q !== undefined) n.Q.value = q; return n; };
    const comp = (th, ratio, knee, at, rel) => { const n = ac.createDynamicsCompressor(); n.threshold.value = th; n.ratio.value = ratio; n.knee.value = knee; n.attack.value = at; n.release.value = rel; return n; };
    const gain = (v) => { const n = ac.createGain(); n.gain.value = v; return n; };
    let nodes;
    if (preset === 'voice') nodes = [bq('highpass', 90, undefined, 0.71), bq('peaking', 3000, 4, 1), bq('highshelf', 9000, 2), comp(-22, 3, 6, 0.005, 0.15), gain(1.25)];
    else if (preset === 'music') nodes = [bq('lowshelf', 150, 1.5), bq('peaking', 2500, -5, 0.8), comp(-26, 2, 10, 0.02, 0.3), gain(0.85)];
    else if (preset === 'lowcut') nodes = [bq('highpass', 140, undefined, 0.71), bq('lowshelf', 250, -4)];
    else return dest;
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    nodes[nodes.length - 1].connect(dest);
    return nodes[0];
  },
  /** Clip con audio, con il loro inizio in timeline: V1 (sequenza) + A1 (libera). */
  items(project) {
    const out = [];
    for (const { clip, start } of Engine.layout(Engine.track(project, 'v1').clips)) out.push({ clip, start });
    for (const clip of Engine.track(project, 'a1').clips) out.push({ clip, start: clip.start || 0 });
    return out.filter(({ clip }) => { const e = Media.get(clip.assetId); return e && e.audio && !clip.muted && !clip.disabled && clip.volume > 0; });
  },
  /**
   * Programma l'audio a partire dal tempo t0 della timeline; `base` è l'istante
   * del contesto audio che corrisponde a t0. Uguale in anteprima ed esportazione.
   */
  schedule(ac, dest, project, t0, base) {
    const sources = [];
    for (const { clip: c, start } of this.items(project)) {
      const e = Media.get(c.assetId);
      const D = Engine.dur(c); const sp = c.speed || 1;
      if (start + D <= t0 + 1e-4) continue;
      const l0 = Math.max(0, t0 - start);
      const off = c.in + l0 * sp;
      if (off >= e.audio.duration || c.out - off <= 0) continue;
      const when = base + Math.max(0, start - t0);
      const src = ac.createBufferSource(); src.buffer = e.audio; src.playbackRate.value = sp;
      const gn = ac.createGain();
      gn.gain.setValueAtTime(Engine.gainAt(c, l0), when);
      for (const p of Engine.gainPoints(c)) if (p > l0 + 1e-6) gn.gain.linearRampToValueAtTime(Engine.gainAt(c, p), when + (p - l0));
      src.connect(gn); gn.connect(this.chain(ac, Engine.g(c, 'audio').eq, dest));
      src.start(when, off, c.out - off);
      sources.push(src);
    }
    return sources;
  },
};
