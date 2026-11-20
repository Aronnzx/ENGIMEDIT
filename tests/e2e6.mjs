// Fase 6: workflow stile DaVinci Resolve — Media Pool, multitraccia, strumenti, marker, Inspector,
// colore, effetti, audio, anteprima (bande nere, proxy, prima/dopo, cattura) e parità anteprima/esportazione.
import { launch, BASE, check, MEDIA, TMP } from './helpers.mjs';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
const run = (cmd, args) => { const r = spawnSync(cmd, args, { maxBuffer: 1 << 27 }); if (r.error) throw r.error; return r; };
const { browser, page, errors, ctx } = await launch();
await ctx.addInitScript(() => { localStorage.setItem('engimedit:tourDone', 'true'); localStorage.setItem('engimedit:tips', JSON.stringify({ drag: 1, split: 1, trim: 1, reorder: 1, fill: 1, audio: 1, blade: 1 })); });
const ed = (fn, arg) => page.evaluate(fn, arg);
const state = () => ed(() => { const e = App.view.editor; return { v1: e.clips.map((c) => ({ id: c.id, in: c.in, out: c.out, d: Engine.dur(c), sp: c.speed, dis: !!c.disabled, label: c.label || null, tf: Engine.g(c, 'tf'), col: Engine.g(c, 'color'), mk: (c.markers || []).length })), v2: e.v2.map((c) => ({ id: c.id, kind: c.kind || 'media', start: c.start, d: Engine.dur(c), comp: Engine.g(c, 'comp') })), a1: e.a1.map((c) => ({ id: c.id, start: c.start, d: Engine.dur(c), au: Engine.g(c, 'audio') })), markers: e.project.markers.length, total: e.total, t: e.t, sel: [...e.sel] }; });

await page.goto(BASE + '#progetti');
await page.click('.dash-hero >> text=Nuovo progetto');
await page.waitForSelector('.ed');
await page.fill('.pname', 'Workflow pro'); await page.keyboard.press('Enter');

/* ---------- 1) Media Pool: video, immagini, audio e cartelle rapide ---------- */
await page.setInputFiles('.ed-lib input[type=file]', [MEDIA + 'Paesaggio.mp4', MEDIA + 'Foto.png', MEDIA + 'Musica.mp3', MEDIA + 'Verticale.mp4']);
await page.waitForFunction(() => document.querySelectorAll('.lib-item').length === 4 && !document.querySelector('.lib-item.loading'), null, { timeout: 30000 });
await page.waitForFunction(() => Object.values(App.view.editor.project.assets).every((a) => a.kind === 'image' || Media.get(a.id).audioState !== 'pending'), null, { timeout: 30000 });
const kinds = await ed(() => Object.values(App.view.editor.project.assets).map((a) => `${a.name}:${a.kind}:${a.duration}`));
check(kinds.includes('Foto.png:image:5') && kinds.some((k) => k.startsWith('Musica.mp3:audio:8')), 'importa immagini (5 s predefiniti) e file solo audio: ' + kinds.join(', '));
const counts = await page.$$eval('.lib-filter button small', (els) => els.map((e) => e.textContent).join(','));
check(counts === '4,2,1,1', `cartelle rapide Tutti/Clip/Immagini/Audio: ${counts}`);
await page.click('.lib-filter >> text=Immagini');
check((await page.$$('.lib-item')).length === 1, 'filtro Immagini mostra solo le immagini');
await page.click('.lib-filter >> text=Audio');
check((await page.$$eval('.lib-item b', (els) => els.map((e) => e.textContent))).join() === 'Musica.mp3', 'filtro Audio mostra solo l\'audio');
await page.click('.lib-filter >> text=Tutti');

/* ---------- 2) Multitraccia: V1, V2 (immagine), A1 (musica) ---------- */
// video in V1 con il pulsante +; audio con Invio (finisce in A1 al cursore)
const item = (name) => page.locator('.lib-item', { hasText: name });
await item('Paesaggio.mp4').hover(); await item('Paesaggio.mp4').locator('.la .btn-primary').click();
await page.waitForTimeout(200);
await ed(() => App.view.editor.seek(1));
await item('Musica.mp3').focus(); await page.keyboard.press('Enter');
await page.waitForTimeout(200);
// immagine trascinata sulla traccia V2 a circa 2 s
await ed(() => App.view.editor.zoomFit());
const pps = await ed(() => App.view.editor.pps);
const lib = await item('Foto.png').boundingBox(); const v2box = await page.locator('.tl-track.lane-v2').boundingBox(); const sc = await page.locator('.tl-scroll').boundingBox();
await page.mouse.move(lib.x + 30, lib.y + 20); await page.mouse.down();
await page.mouse.move(lib.x + 120, lib.y + 120, { steps: 5 });
await page.mouse.move(sc.x + 16 + pps * 2, v2box.y + v2box.height / 2, { steps: 12 });
check(await page.isVisible('.tl-track.lane-v2.over'), 'trascinamento: la traccia V2 si evidenzia');
await page.mouse.up(); await page.waitForTimeout(300);
let s = await state();
check(s.v1.length === 1 && s.v2.length === 1 && s.a1.length === 1, `tracce: V1=${s.v1.length} V2=${s.v2.length} A1=${s.a1.length}`);
check(Math.abs(s.v2[0].start - 2) < 0.15 && s.v2[0].d === 5, `immagine in V2 a ${s.v2[0].start.toFixed(2)} s, durata 5 s`);
check(s.a1[0].start === 1 && Math.abs(s.a1[0].d - 8) < 0.05, `musica in A1 dal cursore (${s.a1[0].start} s)`);
check(Math.abs(s.total - 9) < 0.05, `durata del progetto = traccia più lunga (${s.total} s)`);
// V2 e A1: spostamento libero senza sovrapposizioni
const a1el = await page.locator('.tl-track.lane-a1 .clip').boundingBox();
await page.mouse.move(a1el.x + a1el.width / 2, a1el.y + a1el.height / 2); await page.mouse.down();
await page.mouse.move(a1el.x + a1el.width / 2 - pps * 1.6, a1el.y + a1el.height / 2, { steps: 10 }); await page.mouse.up();
await page.waitForTimeout(200);
s = await state();
check(s.a1[0].start === 0, `A1: spostamento libero con aggancio all'inizio (${s.a1[0].start})`);

/* ---------- 3) Strumenti: Lametta (B), Puntatore (A), Slip (T), Aggancio (N) ---------- */
await page.keyboard.press('b');
check((await page.getAttribute('[data-tool="blade"]', 'aria-checked')) === 'true', 'B attiva la Lametta');
await ed(() => App.view.editor.select([]));
const v1el = await page.locator('.tl-track.lane-v1 .clip').first().boundingBox();
await page.mouse.move(v1el.x + pps * 4, v1el.y + v1el.height / 2);
check(await page.isVisible('.blade-line'), 'Lametta: linea di taglio al passaggio del mouse');
await page.mouse.click(v1el.x + pps * 4, v1el.y + v1el.height / 2);
await page.waitForTimeout(200);
s = await state();
check(s.v1.length === 2 && Math.abs(s.v1[0].d - 4) < 0.06, `Lametta taglia al clic: ${s.v1.map((c) => c.d).join(' + ')}`);
await page.keyboard.press('a');
check((await page.getAttribute('[data-tool="pointer"]', 'aria-checked')) === 'true', 'A torna al Puntatore');
// slip sulla prima metà (0..4 di 6 s): trascinando a sinistra si vede una parte successiva
await page.keyboard.press('t');
const totBefore = (await state()).total;
const c0 = await page.locator('.tl-track.lane-v1 .clip').first().boundingBox();
await page.mouse.move(c0.x + c0.width / 2, c0.y + c0.height / 2); await page.mouse.down();
await page.mouse.move(c0.x + c0.width / 2 - pps * 1, c0.y + c0.height / 2, { steps: 8 });
check(await page.isVisible('.trim-tip'), 'Slip: indicazione della parte usata');
await page.mouse.up(); await page.waitForTimeout(200);
s = await state();
check(Math.abs(s.v1[0].in - 1) < 0.06 && Math.abs(s.v1[0].d - 4) < 0.01 && Math.abs(s.total - totBefore) < 0.01, `Slip sposta in/out (${s.v1[0].in}–${s.v1[0].out}) e la durata resta ${s.v1[0].d} s`);
await page.keyboard.press('Control+z'); await page.waitForTimeout(150);
s = await state(); check(s.v1[0].in === 0, 'Ctrl+Z annulla lo slip');
await page.keyboard.press('a');
const snapBefore = await ed(() => App.view.editor.settings.snapping);
await page.keyboard.press('n');
check((await ed(() => App.view.editor.settings.snapping)) === !snapBefore, 'N attiva/disattiva l\'aggancio');
await page.keyboard.press('n');

/* ---------- 4) Marker (M), etichette, disattiva (D), copia/incolla attributi ---------- */
await ed(() => { App.view.editor.select([]); App.view.editor.seek(3); });
await page.keyboard.press('m');
await page.waitForTimeout(100);
await ed(() => App.view.editor.seek(0));
await page.click('.mk'); await page.waitForTimeout(150);
check(Math.abs((await state()).t - 3) < 0.02, 'marker sulla timeline: il clic porta il cursore al marker');
await page.keyboard.press('Shift+ArrowDown'); // nessun marker successivo: resta
await ed(() => App.view.editor.seek(0)); await page.keyboard.press('Shift+ArrowDown'); await page.waitForTimeout(100);
check(Math.abs((await state()).t - 3) < 0.02, 'Maiusc+↓ salta al marker successivo');
const firstId = (await state()).v1[0].id;
await ed((id) => { App.view.editor.select([id]); App.view.editor.seek(1); }, firstId);
await page.keyboard.press('m'); await page.waitForTimeout(100);
s = await state();
check(s.markers === 1 && s.v1[0].mk === 1 && (await page.$$('.cmk')).length === 1, 'M con una clip selezionata aggiunge un marker alla clip');
// aggancio ai marker: lo scrub vicino al marker si aggancia
check((await ed(() => App.view.editor.edgeTimes().some((x) => Math.abs(x - 3) < 1e-6))), 'i marker sono bersagli dell\'aggancio magnetico');
// etichetta colore dal menu contestuale
const cbox = await page.locator('.tl-track.lane-v1 .clip').first().boundingBox();
await page.mouse.click(cbox.x + 20, cbox.y + cbox.height / 2, { button: 'right' });
await page.click('.menu >> text=Etichetta colore'); await page.click('.menu >> text=Verde');
s = await state(); check(s.v1[0].label === 'green' && (await page.$$('.clip[data-label="green"]')).length === 1, 'etichetta colore dal menu contestuale');
await page.keyboard.press('d'); await page.waitForTimeout(100);
s = await state(); check(s.v1[0].dis && (await page.$$('.clip.disabled')).length === 1, 'D disattiva la clip');
await page.keyboard.press('d'); await page.waitForTimeout(100);
s = await state(); check(!s.v1[0].dis, 'D la riattiva');

/* ---------- 5) Inspector: trasformazione, ritaglio, zoom dinamico, colore, effetti ---------- */
await ed((id) => App.view.editor.select([id]), firstId);
await page.click('#insp-tab-video');
await page.fill('[data-key="zx-n"]', '150'); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
await page.fill('[data-key="rot-n"]', '12'); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
await page.click('[data-key="flip-flipH"]'); await page.waitForTimeout(100);
s = await state();
check(s.v1[0].tf.zx === 1.5 && s.v1[0].tf.rot === 12 && s.v1[0].tf.flipH, 'Transform: zoom 150%, rotazione 12°, capovolgi orizzontale');
await page.keyboard.press('Control+z'); await page.waitForTimeout(100);
check(!(await state()).v1[0].tf.flipH, 'Ctrl+Z annulla un passo della trasformazione');
// slider trascinato: una sola voce di cronologia
await page.locator('[data-key="tx"]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
const zr = await page.locator('[data-key="tx"]').boundingBox();
const hist0 = await ed(() => App.view.editor.history.list().past.length);
await page.mouse.move(zr.x + zr.width / 2, zr.y + zr.height / 2); await page.mouse.down(); await page.mouse.move(zr.x + zr.width * 0.75, zr.y + zr.height / 2, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(150);
check((await ed(() => App.view.editor.history.list().past.length)) === hist0 + 1 && (await state()).v1[0].tf.x > 0.2, 'slider: trascinamento = una sola voce annullabile');
await page.click('text=Animazione dall’inizio alla fine della clip');
check((await ed((id) => Engine.g(App.view.editor.findClip(id).clip, 'dz').mode, firstId)) === 'in', 'Zoom dinamico attivato (Zoom in)');
await page.fill('[data-key="crop-l-n"]', '10'); await page.keyboard.press('Enter');
check((await ed((id) => Engine.g(App.view.editor.findClip(id).clip, 'crop').l, firstId)) === 0.1, 'Ritaglio sinistro 10%');
await page.click('#insp-tab-color');
await page.fill('[data-key="col-sat-n"]', '-100'); await page.keyboard.press('Enter');
await page.fill('[data-key="col-gain-n"]', '20'); await page.keyboard.press('Enter');
s = await state(); check(s.v1[0].col.sat === -1 && s.v1[0].col.gain === 0.2, 'Colore: saturazione −100, luci +20');
await page.click('#insp-tab-fx');
await page.fill('[data-key="fx-vignette-n"]', '60'); await page.keyboard.press('Enter');
check((await ed((id) => Engine.g(App.view.editor.findClip(id).clip, 'fx').vignette, firstId)) === 0.6, 'Effetti: vignettatura 60%');
// prima/dopo: la saturazione −100 rende grigio il fotogramma; Maiusc+D mostra l'originale a colori
await ed(() => App.view.editor.seek(1.5)); await page.waitForTimeout(500);
const satAt = () => ed(() => { const c = document.querySelector('.stage-frame canvas'); const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height).data; let s = 0; let n = 0; for (let i = 0; i < d.length; i += 4 * 97) { const mx = Math.max(d[i], d[i + 1], d[i + 2]); const mn = Math.min(d[i], d[i + 1], d[i + 2]); s += mx - mn; n++; } return s / n; });
const satGraded = await satAt();
await page.keyboard.press('Shift+D'); await page.waitForTimeout(400);
const satBefore = await satAt();
check(satGraded < 6 && satBefore > 30 && await page.isVisible('.stage-badge'), `Prima/Dopo (Maiusc+D): ${satGraded.toFixed(1)} → ${satBefore.toFixed(1)}`);
await page.keyboard.press('Shift+D'); await page.waitForTimeout(200);
// copia attributi (Ctrl+C) e incolla (Alt+V) con scelta dei gruppi
await page.keyboard.press('Control+c');
const second = (await state()).v1[1].id;
await ed((id) => App.view.editor.select([id]), second);
await page.keyboard.press('Alt+v');
await page.waitForSelector('dialog.modal >> text=Incolla attributi');
await page.uncheck('dialog [data-g="transform"]'); await page.uncheck('dialog [data-g="crop"]');
await page.click('dialog .modal-foot >> text=Applica'); await page.waitForTimeout(150);
s = await state();
check(s.v1[1].col.sat === -1 && s.v1[1].tf.zx === 1 && (await ed((id) => Engine.g(App.view.editor.findClip(id).clip, 'fx').vignette, second)) === 0.6, 'Incolla attributi: colore ed effetti sì, trasformazione no');

/* ---------- 6) Velocità (Ctrl+R) ---------- */
await page.keyboard.press('Control+r');
await page.click('.menu >> text=2×'); await page.waitForTimeout(150);
s = await state();
check(s.v1[1].sp === 2 && Math.abs(s.v1[1].d - 1) < 0.01, `Ctrl+R → 2×: la clip dura ${s.v1[1].d} s`);
await page.click('#insp-tab-video');
check(await page.isVisible('.ed-props >> text=Velocità'), 'Inspector: sezione Velocità');
await page.click('.ed-props [data-key="speed-1"]'); await page.waitForTimeout(100);
check((await state()).v1[1].sp === 1, 'velocità 1× dall\'Inspector');

/* ---------- 7) Titoli, livello di regolazione e composito ---------- */
await ed(() => App.view.editor.seek(6.5));
await page.click('.tl-bar >> text=Titolo'); await page.waitForTimeout(150);
await page.fill('[data-key="text-content"]', 'Ciao EngimEdit'); await page.locator('[data-key="text-content"]').blur();
await page.waitForTimeout(150);
s = await state();
const text = s.v2.find((c) => c.kind === 'text');
check(text && Math.abs(text.start - 7) < 0.01, `titolo in V2 nel primo spazio libero (${text && text.start} s)`);
check((await page.textContent('.tl-track.lane-v2')).includes('Ciao EngimEdit'), 'il titolo mostra il testo sulla timeline');
await page.fill('[data-key="opacity-n"]', '80'); await page.keyboard.press('Enter');
await page.selectOption('[data-key="comp-blend"]', 'screen');
s = await state(); const tx2 = s.v2.find((c) => c.kind === 'text');
check(tx2.comp.opacity === 0.8 && tx2.comp.blend === 'screen', 'Composito: opacità 80% e fusione Scolora');

/* ---------- 8) Audio: dissolvenze e preset EQ ---------- */
await ed((id) => App.view.editor.select([id]), s.a1[0].id);
check(await page.isVisible('#insp-tab-audio'), 'A1: Inspector con la scheda Audio');
await page.fill('[data-key="fade-in-n"]', '1.5'); await page.keyboard.press('Enter');
await page.fill('[data-key="fade-out-n"]', '2'); await page.keyboard.press('Enter');
await page.selectOption('[data-key="eq"]', 'music');
s = await state();
check(s.a1[0].au.fadeIn === 1.5 && s.a1[0].au.fadeOut === 2 && s.a1[0].au.eq === 'music', 'dissolvenze 1,5 s / 2 s e preset Musica di sottofondo');

/* ---------- 9) Anteprima: bande nere, qualità proxy, cattura fotogramma ---------- */
await page.selectOption('.stage-tools select >> nth=0', '2.39');
await ed(() => App.view.editor.seek(2.5)); await page.waitForTimeout(500);
const bars = await ed(() => { const c = document.querySelector('.stage-frame canvas'); const g = c.getContext('2d'); const row = (y) => { const d = g.getImageData(0, y, c.width, 1).data; let m = 0; for (let i = 0; i < d.length; i += 4) m = Math.max(m, d[i], d[i + 1], d[i + 2]); return m; }; return [row(2), row(Math.round(c.height / 2))]; });
check(bars[0] === 0 && bars[1] > 30, `bande nere 2.39:1 nell'anteprima (bordo ${bars[0]}, centro ${bars[1]})`);
const w1 = await ed(() => document.querySelector('.stage-frame canvas').width);
await page.selectOption('.stage-tools select >> nth=1', '0.5'); await page.waitForTimeout(200);
const w2 = await ed(() => document.querySelector('.stage-frame canvas').width);
check(Math.abs(w2 - w1 / 2) <= 1, `qualità anteprima 1/2: ${w1} → ${w2} px`);
await page.selectOption('.stage-tools select >> nth=1', '1');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[aria-label="Cattura fotogramma (PNG)"]')]);
const still = TMP + '/engimedit-still.png'; await dl.saveAs(still);
const dim = run('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', still]).stdout.toString().trim();
check(dl.suggestedFilename().endsWith('.png') && dim === '1920,1080', `cattura fotogramma: PNG ${dim}`);

/* ---------- 10) Parità anteprima / esportazione ---------- */
await page.waitForTimeout(1300);
const out = await ed(async () => {
  const e = App.view.editor;
  const W = 640; const H = 360; const fps = 30;
  const plan = await Exporter.plan(W, H, fps, 3e6, true);
  const r = await Exporter.run({ project: e.project, W, H, fps, vbr: 3e6, plan }, { stage() {}, progress() {}, signal: new AbortController().signal });
  const buf = new Uint8Array(await r.blob.arrayBuffer()); let s2 = ''; for (let i = 0; i < buf.length; i += 8192) s2 += String.fromCharCode(...buf.subarray(i, i + 8192));
  // fotogrammi dell'anteprima alla stessa risoluzione, stessi istanti
  const shots = {};
  for (const tt of [2.5, 4.5, 7.5]) { const cv = document.createElement('canvas'); cv.width = W; cv.height = H; await e.player.renderTo(cv, tt); const d = cv.getContext('2d').getImageData(0, 0, W, H).data; let s3 = ''; for (let i = 0; i < d.length; i += 8192) s3 += String.fromCharCode(...d.subarray(i, i + 8192)); shots[tt] = btoa(s3); }
  return { b64: btoa(s2), total: e.total, shots };
});
const mp4 = TMP + '/engimedit-pro.mp4'; writeFileSync(mp4, Buffer.from(out.b64, 'base64'));
const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', mp4]).stdout.toString());
check(Math.abs(parseFloat(probe.format.duration) - out.total) < 0.15, `esportazione: durata ${probe.format.duration} = progetto ${out.total} (A1 oltre la fine di V1)`);
const psnrs = [];
for (const tt of [2.5, 4.5, 7.5]) {
  const raw = run('ffmpeg', ['-v', 'error', '-ss', String(tt + 0.5 / 30), '-i', mp4, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']).stdout;
  const prev = Buffer.from(out.shots[tt], 'base64');
  let se = 0; let n = 0;
  for (let i = 0; i < Math.min(raw.length, prev.length); i += 4) for (let k = 0; k < 3; k++) { const d = raw[i + k] - prev[i + k]; se += d * d; n++; }
  psnrs.push(10 * Math.log10((255 * 255) / Math.max(1e-9, se / n)));
}
console.log('     PSNR anteprima/esportazione:', psnrs.map((x) => x.toFixed(1)).join(', '));
check(psnrs.every((x) => x > 24), 'WYSIWYG: il file esportato coincide con l\'anteprima (colore, trasformazioni, V2, bande nere, grana)');
const vol = (a0, d) => { const m = /mean_volume: (-?[0-9.]+|-inf)/.exec(run('ffmpeg', ['-v', 'info', '-ss', String(a0), '-t', String(d), '-i', mp4, '-af', 'volumedetect', '-vn', '-f', 'null', '-']).stderr.toString()); return m ? parseFloat(m[1]) : -Infinity; };
const vMusic = vol(6.2, 0.3);
check(vMusic > -40, `la musica di A1 si sente dopo la fine di V1 (${vMusic} dB)`);
// mix audio (stessa programmazione dell'anteprima): dissolvenze della sola musica
const rms = await ed(async () => {
  const e = App.view.editor;
  const p2 = { ...e.project, tracks: e.project.tracks.map((tr) => (tr.id === 'v1' ? { ...tr, clips: tr.clips.map((c) => ({ ...c, muted: true })) } : tr)) };
  const buf = await Exporter.renderMix(p2); const d = buf.getChannelData(0);
  const r = (a, b) => { let s4 = 0; const i0 = Math.round(a * 48000); const i1 = Math.round(b * 48000); for (let i = i0; i < i1; i++) s4 += d[i] * d[i]; return Math.sqrt(s4 / (i1 - i0)); };
  return [r(0, 0.1), r(0.7, 0.8), r(3, 3.5), r(7.85, 7.95), r(8.2, 8.5)];
});
console.log('     RMS musica (0 / 0,75 / 3 / 7,9 / 8,3 s):', rms.map((x) => x.toFixed(4)).join(' '));
check(rms[0] < rms[1] * 0.3 && rms[1] < rms[2] * 0.75 && rms[3] < rms[2] * 0.15 && rms[4] < 1e-4, 'dissolvenze in entrata e in uscita nel mix esportato');

/* ---------- 11) Impostazioni progetto, backup .json e migrazione ---------- */
await page.click('[aria-label="Impostazioni progetto"]');
await page.click('dialog >> text=Riempi fotogramma');
await page.click('dialog >> text=Fatto');
check((await ed(() => App.view.editor.settings.scaling)) === 'fill', 'impostazioni progetto: regola predefinita Riempi fotogramma');
await page.keyboard.press('Control+s'); await page.waitForTimeout(600);
await page.goto(BASE + '#progetti'); await page.waitForSelector('.proj-card:not(.new)');
// backup su disco
await page.locator('.proj-card', { hasText: 'Workflow pro' }).locator('.more').click();
const [jdl] = await Promise.all([page.waitForEvent('download'), page.click('.menu >> text=Esporta progetto (.json)')]);
const jpath = TMP + '/engimedit-backup.json'; await jdl.saveAs(jpath);
const backup = JSON.parse(readFileSync(jpath, 'utf8'));
check(backup.app === 'EngimEdit' && backup.project.tracks.length === 3 && backup.project.markers.length === 1, 'esporta progetto: backup .json con tracce e marker');
// progetto schema 1 salvato da una versione precedente
await ed(async () => { await DB.put('projects', { id: 'pold1', name: 'Vecchio progetto', schema: 1, createdAt: 1, updatedAt: 2, format: '16:9', fps: 30, assets: { a1: { id: 'a1', name: 'x.mp4', duration: 4, width: 640, height: 360, size: 1 } }, tracks: [{ id: 'v1', kind: 'video', clips: [{ id: 'c1', assetId: 'a1', in: 0, out: 3, volume: 1, muted: false, speed: 1, fit: 'fit', ox: 0, oy: 0 }] }], settings: { snapping: true } }); });
await page.setInputFiles('.dash-tools input[type=file]', jpath);
await page.waitForSelector('.toast.ok >> text=importato');
await page.waitForTimeout(300);
const names = await page.$$eval('.proj-card:not(.new) .meta b', (els) => els.map((e) => e.textContent));
check(names.includes('Workflow pro 2') && names.includes('Vecchio progetto'), 'importa progetto: copia con nome univoco; progetto schema 1 in elenco');
// ricerca e ordinamento
await page.fill('.dash-tools input[type=search]', 'vecchio'); await page.waitForTimeout(300);
check((await page.$$('.proj-card:not(.new)')).length === 1, 'ricerca tra i progetti');
await page.fill('.dash-tools input[type=search]', ''); await page.waitForTimeout(300);
await page.selectOption('.dash-tools select', 'name'); await page.waitForTimeout(400);
const sorted = await page.$$eval('.proj-card:not(.new) .meta b', (els) => els.map((e) => e.textContent));
check(sorted.join('|') === [...sorted].sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base', numeric: true })).join('|'), 'ordinamento per nome: ' + sorted.join(', '));
await page.locator('.proj-card', { hasText: 'Vecchio progetto' }).locator('button.open').click();
await page.waitForSelector('.ed');
await page.waitForTimeout(800);
const mig = await ed(() => { const p = App.view.editor.project; return { schema: p.schema, tracks: p.tracks.map((t) => t.id).join(), n: p.tracks[0].clips.length, total: App.view.editor.total }; });
check(mig.schema === 2 && mig.tracks === 'v1,v2,a1' && mig.n === 1 && mig.total === 3, `migrazione schema 1 → 2 senza perdita (${JSON.stringify(mig)})`);
await page.keyboard.press('Escape');
for (const d of await page.$$('dialog[open]')) await d.evaluate((x) => x.close());

/* ---------- 12) Inglese ---------- */
await page.evaluate(() => { I18N.set('en'); App.route(); });
await page.waitForSelector('.ed');
check(await page.isVisible('.tl-bar >> text=Snapping') && await page.isVisible('.lib-filter >> text=Images'), 'interfaccia in inglese (strumenti e Media Pool)');
await page.evaluate(() => { I18N.set('it'); });
await page.screenshot({ path: 'test-results/30-workflow-pro.png' });
// avvisi di prestazioni del driver grafico software e delle letture di pixel fatte dal test: non sono errori dell'app
const real = errors.filter((x) => !/GL Driver Message|willReadFrequently/.test(x));
console.log('ERRORI CONSOLE:', real);
check(!real.length, 'nessun errore in console');
await browser.close();
