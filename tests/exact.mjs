// Verifica fotogramma per fotogramma: ogni fotogramma esportato deve essere quello esatto della sorgente.
// I video contatore hanno luminosità = 4 × numero del fotogramma.
import { launch, BASE, check, MEDIA, TMP } from './helpers.mjs';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const { browser, page, ctx, errors } = await launch();
await ctx.addInitScript(() => { localStorage.setItem('engimedit:tourDone', 'true'); });
await page.goto(BASE + '#progetti');
await page.click('.dash-hero >> text=Nuovo progetto');
await page.waitForSelector('.ed');
const dir = MEDIA;
const files = ['Conta30.mp4', 'Conta25.mp4', 'Conta30.webm', 'Paesaggio.mp4'];
await page.setInputFiles('.ed-lib input[type=file]', files.map((f) => dir + f));
await page.waitForFunction((n) => document.querySelectorAll('.lib-item:not(.loading)').length === n, files.length, { timeout: 30000 });
// timeline: Conta30 [1.0,2.5) | Conta25 [0.52,2.0) | Conta30.webm [0.5,1.5) | Conta30 [3.0,4.0) a velocità 1
const res = await page.evaluate(async () => {
  const e = App.view.editor;
  const by = (n) => Object.values(e.project.assets).find((a) => a.name === n).id;
  const mk = (n, a, b) => ({ ...Engine.clipFromAsset(e.project.assets[by(n)], uid('c')), in: a, out: b });
  const clips = [mk('Conta30.mp4', 1.0, 2.5), mk('Conta25.mp4', 0.52, 2.0), mk('Conta30.webm', 0.5, 1.5), mk('Conta30.mp4', 3.0, 4.0)];
  e.commit('x', () => ({ clips }));
  const out = {};
  out.prep = await Promise.all(clips.map((c) => Demux.prepare(c.assetId).then((r) => !!r)));
  const plan = await Exporter.plan(640, 480, 30, 4e6, false);
  const t0 = performance.now();
  const r = await Exporter.run({ clips, assets: e.project.assets, W: 640, H: 480, fps: 30, vbr: 4e6, plan }, { stage() {}, progress() {}, signal: new AbortController().signal });
  out.secs = (performance.now() - t0) / 1000;
  out.layout = Engine.layout(clips).map((x) => [x.start, x.end, x.clip.in]);
  const buf = new Uint8Array(await r.blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192));
  out.b64 = btoa(s);
  return out;
});
writeFileSync(TMP + '/engimedit-exact.mp4', Buffer.from(res.b64, 'base64'));
console.log('     decodifica diretta per clip:', res.prep, ' tempo:', res.secs.toFixed(1), 's per', res.layout.at(-1)[1], 's di video');
const raw = spawnSync('ffmpeg', ['-v', 'error', '-i', TMP + '/engimedit-exact.mp4', '-vf', 'crop=8:8:316:236,scale=1:1', '-vsync', '0', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 26 }).stdout;
const got = [...raw].map((x) => Math.round(x / 4));
// atteso: per ogni fotogramma k, il fotogramma sorgente con pts ≤ s_k
const fpsOf = [30, 25, 30, 30];
const exp = [];
const N = Math.ceil(res.layout.at(-1)[1] * 30 - 1e-6);
for (let k = 0; k < N; k++) {
  const tt = k / 30;
  let i = res.layout.findIndex(([a, b]) => tt < b - 1e-6); if (i < 0) i = res.layout.length - 1;
  const [a, , inn] = res.layout[i];
  const s = inn + (tt - a);
  exp.push(Math.floor(s * fpsOf[i] + 1e-4) % 64);
}
const bad = []; got.forEach((v, k) => { if (v !== exp[k]) bad.push([k, exp[k], v]); });
console.log('     fotogrammi:', got.length, 'attesi:', exp.length, 'differenze:', bad.length, bad.slice(0, 12));
const segs = res.layout.map(([a, b]) => [Math.ceil(a * 30 - 1e-6), Math.ceil(b * 30 - 1e-6)]);
const badIn = (j) => bad.filter(([k]) => k >= segs[j][0] && k < segs[j][1]).length;
check(got.length === exp.length, 'numero di fotogrammi corretto');
check(badIn(0) === 0, 'MP4 30 fps con B-frame: tutti i fotogrammi esatti');
check(badIn(1) === 0, 'MP4 25 fps convertito a 30 fps: tutti i fotogrammi esatti');
check(badIn(3) === 0, 'seconda parte dello stesso file: tutti i fotogrammi esatti');
console.log(`     WebM (cattura in riproduzione): ${badIn(2)} fotogrammi non esatti su ${segs[2][1] - segs[2][0]}`);
check(bad.length <= badIn(2), 'nessun errore ai confini tra le clip');
console.log('ERRORI CONSOLE:', errors);
await browser.close();
