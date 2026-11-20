'use strict';
/* =========================================================================
   demux.js — lettura diretta dei campioni video da file MP4/MOV (H.264)
   e decodifica esatta con WebCodecs per l'esportazione.
   Ogni fotogramma esportato è quello giusto della sorgente, a qualunque
   velocità del computer; la composizione (V2, colore, effetti) avviene in
   Render.frame tramite la funzione `paint` ricevuta dall'esportazione. Per gli altri formati si usa la cattura in
   riproduzione (export.js → captureClip).
   ========================================================================= */
class BlobReader {
  constructor(blob) { this.blob = blob; this.ws = 0; this.buf = null; }
  async read(off, size) {
    if (!this.buf || off < this.ws || off + size > this.ws + this.buf.byteLength) {
      const len = Math.max(size, 4 * 1024 * 1024);
      this.buf = new Uint8Array(await this.blob.slice(off, Math.min(this.blob.size, off + len)).arrayBuffer());
      this.ws = off;
      if (this.buf.byteLength < size) throw new Error('short-read');
    }
    return this.buf.subarray(off - this.ws, off - this.ws + size);
  }
}

const Demux = {
  cache: new Map(),   // assetId → indice (o null se non utilizzabile)

  /** Indice dei campioni video di un file MP4/MOV, oppure null. */
  async mp4Index(blob) {
    const read = async (a, b) => new DataView(await blob.slice(a, b).arrayBuffer());
    let pos = 0; let moov = null; let fragmented = false; let guard = 0;
    while (pos + 8 <= blob.size && guard++ < 500) {
      const hd = await read(pos, Math.min(blob.size, pos + 16));
      let bs = hd.getUint32(0); let hl = 8;
      const type = String.fromCharCode(hd.getUint8(4), hd.getUint8(5), hd.getUint8(6), hd.getUint8(7));
      if (bs === 1 && hd.byteLength >= 16) { bs = Number(hd.getBigUint64(8)); hl = 16; } else if (bs === 0) bs = blob.size - pos;
      if (bs < 8) return null;
      if (type === 'moov') { if (bs > 128 * 1024 * 1024) return null; moov = await read(pos + hl, pos + bs); }
      if (type === 'moof') fragmented = true;
      pos += bs;
    }
    if (!moov || fragmented) return null;
    const dv = moov;
    const kids = (start, end) => {
      const out = []; let p = start;
      while (p + 8 <= end) {
        let s = dv.getUint32(p); let hl = 8;
        const t = String.fromCharCode(dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6), dv.getUint8(p + 7));
        if (s === 1) { s = Number(dv.getBigUint64(p + 8)); hl = 16; } else if (s === 0) s = end - p;
        if (s < 8 || p + s > end) break;
        out.push({ type: t, start: p + hl, end: p + s });
        p += s;
      }
      return out;
    };
    const child = (box, name) => kids(box.start, box.end).find((x) => x.type === name);
    const path = (box, names) => { let c = box; for (const n of names) { c = c && child(c, n); } return c || null; };
    const root = { start: 0, end: dv.byteLength };
    for (const trak of kids(0, dv.byteLength).filter((k) => k.type === 'trak')) {
      const hdlr = path(trak, ['mdia', 'hdlr']);
      if (!hdlr) continue;
      const handler = String.fromCharCode(...[0, 1, 2, 3].map((i) => dv.getUint8(hdlr.start + 8 + i)));
      if (handler !== 'vide') continue;
      const mdhd = path(trak, ['mdia', 'mdhd']);
      const stbl = path(trak, ['mdia', 'minf', 'stbl']);
      if (!mdhd || !stbl) return null;
      const timescale = dv.getUint8(mdhd.start) === 1 ? dv.getUint32(mdhd.start + 20) : dv.getUint32(mdhd.start + 12);
      // codifica: solo H.264 (avc1) con configurazione avcC
      const stsd = child(stbl, 'stsd');
      if (!stsd) return null;
      const entryStart = stsd.start + 8;
      const entryType = String.fromCharCode(...[4, 5, 6, 7].map((i) => dv.getUint8(entryStart + i)));
      if (entryType !== 'avc1') return null;
      const entryEnd = entryStart + dv.getUint32(entryStart);
      const width = dv.getUint16(entryStart + 8 + 24); const height = dv.getUint16(entryStart + 8 + 26);
      const avcC = kids(entryStart + 8 + 78, entryEnd).find((x) => x.type === 'avcC');
      if (!avcC) return null;
      const description = new Uint8Array(dv.buffer.slice(dv.byteOffset + avcC.start, dv.byteOffset + avcC.end));
      const hex = (n) => n.toString(16).padStart(2, '0');
      const codec = 'avc1.' + hex(description[1]) + hex(description[2]) + hex(description[3]);
      // tabelle dei campioni
      const stts = child(stbl, 'stts'); const ctts = child(stbl, 'ctts'); const stss = child(stbl, 'stss');
      const stsz = child(stbl, 'stsz'); const stsc = child(stbl, 'stsc'); const stco = child(stbl, 'stco') || child(stbl, 'co64');
      if (!stts || !stsz || !stsc || !stco) return null;
      const fixed = dv.getUint32(stsz.start + 4); const n = dv.getUint32(stsz.start + 8);
      if (!n) return null;
      const sizes = new Uint32Array(n);
      for (let i = 0; i < n; i++) sizes[i] = fixed || dv.getUint32(stsz.start + 12 + i * 4);
      const dts = new Float64Array(n); let t = 0; let si = 0;
      const sttsN = dv.getUint32(stts.start + 4);
      for (let e = 0; e < sttsN && si < n; e++) {
        const cnt = dv.getUint32(stts.start + 8 + e * 8); const d = dv.getUint32(stts.start + 12 + e * 8);
        for (let j = 0; j < cnt && si < n; j++) { dts[si++] = t; t += d; }
      }
      const comp = new Float64Array(n);
      if (ctts) {
        const v1 = dv.getUint8(ctts.start) === 1; const cN = dv.getUint32(ctts.start + 4); let ci = 0;
        for (let e = 0; e < cN && ci < n; e++) {
          const cnt = dv.getUint32(ctts.start + 8 + e * 8);
          const off = v1 ? dv.getInt32(ctts.start + 12 + e * 8) : dv.getUint32(ctts.start + 12 + e * 8);
          for (let j = 0; j < cnt && ci < n; j++) comp[ci++] = off;
        }
      }
      const key = new Uint8Array(n);
      if (stss) { const kN = dv.getUint32(stss.start + 4); for (let e = 0; e < kN; e++) { const idx = dv.getUint32(stss.start + 8 + e * 4) - 1; if (idx >= 0 && idx < n) key[idx] = 1; } }
      else key.fill(1);
      const co64 = stco.type === 'co64'; const chunkN = dv.getUint32(stco.start + 4);
      const chunkOff = (c) => (co64 ? Number(dv.getBigUint64(stco.start + 8 + c * 8)) : dv.getUint32(stco.start + 8 + c * 4));
      const offs = new Float64Array(n);
      const scN = dv.getUint32(stsc.start + 4); let sample = 0;
      for (let e = 0; e < scN; e++) {
        const first = dv.getUint32(stsc.start + 8 + e * 12) - 1; const per = dv.getUint32(stsc.start + 12 + e * 12);
        const nextFirst = e + 1 < scN ? dv.getUint32(stsc.start + 8 + (e + 1) * 12) - 1 : chunkN;
        for (let c = first; c < nextFirst && sample < n; c++) {
          let o = chunkOff(c);
          for (let j = 0; j < per && sample < n; j++) { offs[sample] = o; o += sizes[sample]; sample++; }
        }
      }
      // lista di montaggio (edit list): spostamento iniziale dovuto ai B-frame
      let mediaTime = 0;
      const elst = path(trak, ['edts', 'elst']);
      if (elst) {
        const v1 = dv.getUint8(elst.start) === 1; const eN = dv.getUint32(elst.start + 4);
        for (let e = 0; e < eN; e++) {
          const mt = v1 ? Number(dv.getBigInt64(elst.start + 8 + e * 20 + 8)) : dv.getInt32(elst.start + 8 + e * 12 + 4);
          if (mt >= 0) { mediaTime = mt; break; }
        }
      }
      const samples = new Array(n);
      for (let i = 0; i < n; i++) samples[i] = { off: offs[i], size: sizes[i], key: key[i] === 1, pts: (dts[i] + comp[i] - mediaTime) / timescale };
      void root;
      return { codec, description, width, height, samples };
    }
    return null;
  },

  /** Prepara (una volta per file) l'indice e verifica che il decoder lo supporti. */
  async prepare(assetId) {
    if (this.cache.has(assetId)) return this.cache.get(assetId);
    let res = null;
    try {
      const e = Media.get(assetId);
      if (e && e.blob && window.VideoDecoder && window.EncodedVideoChunk) {
        const idx = await this.mp4Index(e.blob);
        if (idx) {
          const cfg = { codec: idx.codec, codedWidth: idx.width, codedHeight: idx.height, description: idx.description };
          const sup = await VideoDecoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
          if (sup.supported) res = { ...idx, cfg, blob: e.blob };
        }
      }
    } catch (err) { ErrLog.add('demux', err); res = null; }
    this.cache.set(assetId, res);
    return res;
  },

  /**
   * Decodifica i fotogrammi necessari per [k0, k1) e li passa all'encoder.
   * Restituisce il numero del primo fotogramma non ancora emesso (k1 se completo).
   */
  async decodeClip({ idx, clip, start, k0, k1, fps, writer, g, paint, signal, report }) {
    const sp = clip.speed || 1;
    const lastSrc = Math.max(clip.in, clip.out - 0.0005);
    const sAt = (k) => Math.min(lastSrc, Math.max(clip.in, clip.in + (k / fps - start) * sp));
    const S = idx.samples;
    const t0 = sAt(k0); const tEnd = sAt(k1 - 1);
    let first = 0;
    for (let i = 0; i < S.length; i++) if (S[i].key && S[i].pts <= t0 + 1e-6) first = i;
    // si decodifica fino al primo fotogramma chiave dopo la fine, più un margine per il riordino
    let last = S.length;
    for (let i = first + 1; i < S.length; i++) if (S[i].key && S[i].pts > tEnd + 1e-6) { last = Math.min(S.length, i + 16); break; }
    let k = k0; let cur = null; let err = null;
    const emit = () => { paint(k, cur, cur.displayWidth, cur.displayHeight); writer.addFrame(g.canvas); k++; if (k % 3 === 0) report(); };
    const dec = new VideoDecoder({
      output: (frame) => {
        try {
          if (k >= k1 || err) { frame.close(); return; }
          const p = frame.timestamp / 1e6;
          while (cur && k < k1 && sAt(k) + 1e-4 < p) emit();
          if (cur) cur.close();
          cur = frame;
        } catch (e) { err = e; frame.close(); }
      },
      error: (e) => { err = e; },
    });
    const reader = new BlobReader(idx.blob);
    try {
      dec.configure(idx.cfg);
      for (let i = first; i < last; i++) {
        if (signal.aborted) throw new ExportAbort();
        if (err) throw err;
        if (k >= k1) break;
        while (dec.decodeQueueSize > 6 || writer.queue > 12) { if (err) throw err; writer.check(); await sleep(2); }
        const s = S[i];
        const data = await reader.read(s.off, s.size);
        dec.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: Math.round(s.pts * 1e6), data }));
      }
      if (k < k1) await dec.flush();
      if (err) throw err;
      if (cur) while (k < k1) { emit(); if (writer.queue > 24) await writer.drain(8); }
      return k;
    } catch (e) {
      if (e && e.code === 'abort') throw e;
      ErrLog.add('decode', e);
      return k;   // l'esportazione prosegue da qui con la cattura in riproduzione
    } finally {
      if (cur) { try { cur.close(); } catch {} }
      try { dec.close(); } catch {}
    }
  },
};
