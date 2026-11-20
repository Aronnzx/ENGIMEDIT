// Fase 3: esportazione reale e verifica del file con ffprobe/ffmpeg
import { launch, BASE, check, MEDIA, TMP } from './helpers.mjs';
import { spawnSync } from 'node:child_process';
// ffmpeg/ffprobe con argomenti separati: nessuna shell, funziona anche con spazi nei percorsi
const run = (cmd, args) => { const r = spawnSync(cmd, args, { maxBuffer: 1 << 26 }); if (r.error) throw r.error; return r; };
const { browser, page, errors, ctx } = await launch();
await ctx.addInitScript(() => { localStorage.setItem('engimedit:tourDone', 'true'); });
await page.goto(BASE + '#progetti');
await page.click('.dash-hero >> text=Nuovo progetto');
await page.waitForSelector('.ed');
await page.fill('.pname', 'Prova esportazione'); await page.keyboard.press('Enter');
const dir = MEDIA;
await page.setInputFiles('.ed-lib input[type=file]', [dir + 'Paesaggio.mp4', dir + 'Barre.webm', dir + 'Muto.mp4', dir + 'Contatore.mp4']);
await page.waitForFunction(() => document.querySelectorAll('.lib-item').length === 4 && !document.querySelector('.lib-item.loading'), null, { timeout: 30000 });
// timeline: Paesaggio 1..5 (4 s), Barre (4 s, audio disattivato), Muto (3 s) => 11 s
await page.evaluate(async () => {
  const e = App.view.editor; const ids = Object.values(e.project.assets).sort((a, b) => a.addedAt - b.addedAt).map((a) => a.id);
  e.addToTimeline(ids);
  const c0 = e.clips[0].id; const c1 = e.clips[1].id;
  e.commit('t', (s) => ({ clips: Engine.trim(Engine.trim(s.clips, c0, 'in', 1, 6), c0, 'out', 5, 6) }));
  e.commit('m', (s) => ({ clips: Engine.patch(s.clips, [c1], { muted: true }) }));
  // il contatore (fotogramma N = luminosità 4N) va per ultimo, dalla sorgente 1,0 a 2,0
  const c3 = e.clips[3].id;
  e.commit('c', (s) => ({ clips: Engine.trim(Engine.trim(s.clips, c3, 'in', 1, 4), c3, 'out', 2, 4) }));
});
const total = await page.evaluate(() => App.view.editor.total);
check(Math.abs(total - 12.008) < 0.01, `timeline pronta (${total} s)`);
await page.keyboard.press('Control+e');
await page.waitForSelector('dialog.modal .presets');
await page.waitForFunction(() => !document.querySelector('dialog.modal .modal-foot .btn-primary').disabled, null, { timeout: 10000 });
await page.screenshot({ path: 'test-results/10-export-config.png' });
const summary = await page.textContent('dialog.modal .sum-line');
console.log('     riepilogo:', summary);
check(summary.includes('1920×1080') && summary.includes('MP4 (H.264'), 'preset YouTube 1080p con MP4 H.264');
await page.click('dialog.modal .preset >> text=File leggero');
await page.waitForFunction(() => document.querySelector('dialog.modal .sum-line').textContent.includes('1280×720'));
const t0 = Date.now();
await page.click('dialog.modal .modal-foot .btn-primary');
await page.waitForSelector('dialog.modal .stages');
await page.waitForTimeout(2500);
await page.screenshot({ path: 'test-results/11-export-progress.png' });
await page.waitForSelector('dialog.modal .result-video', { timeout: 90000 });
const secs = (Date.now() - t0) / 1000;
check(true, `esportazione completata in ${secs.toFixed(1)} s`);
await page.screenshot({ path: 'test-results/12-export-done.png' });
const [download] = await Promise.all([page.waitForEvent('download'), page.click('dialog.modal .modal-foot button.btn-primary:has-text("Scarica")')]);
const out = TMP + '/engimedit-export-test.mp4';
await download.saveAs(out);
check(download.suggestedFilename() === 'Prova esportazione.mp4', `nome file: ${download.suggestedFilename()}`);
const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', out]).stdout.toString());
const v = probe.streams.find((s) => s.codec_type === 'video'); const a = probe.streams.find((s) => s.codec_type === 'audio');
console.log('     ffprobe:', v.codec_name, v.profile, v.width + 'x' + v.height, v.r_frame_rate, 'audio:', a && a.codec_name, 'durata:', probe.format.duration, 'frames:', v.nb_frames);
check(v.codec_name === 'h264' && v.width === 1280 && v.height === 720, 'video H.264 1280×720');
check(a && ['aac', 'opus'].includes(a.codec_name), 'traccia audio presente (' + (a && a.codec_name) + ')');
check(Math.abs(parseFloat(probe.format.duration) - total) < 0.15, `durata ${probe.format.duration} ≈ ${total.toFixed(2)}`);
check(parseInt(v.nb_frames) === Math.ceil(total * 30 - 1e-6), `numero fotogrammi ${v.nb_frames} = ${Math.ceil(total * 30 - 1e-6)}`);
// contenuto: confronto PSNR con la sorgente nei punti chiave
const A = TMP + '/engimedit-a.png'; const B = TMP + '/engimedit-b.png';
const psnr = (ts, srcFile, srcT) => {
  run('ffmpeg', ['-v', 'error', '-y', '-ss', String(ts), '-i', out, '-frames:v', '1', A]);
  run('ffmpeg', ['-v', 'error', '-y', '-ss', String(srcT), '-i', dir + srcFile, '-frames:v', '1', '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2', B]);
  const m = /average:([0-9.]+|inf)/.exec(run('ffmpeg', ['-v', 'info', '-i', A, '-i', B, '-lavfi', 'psnr', '-f', 'null', '-']).stderr.toString());
  return m ? parseFloat(m[1] === 'inf' ? '99' : m[1]) : 0;
};
const p1 = psnr(1.0, 'Paesaggio.mp4', 2.0); const p2 = psnr(6.0, 'Barre.webm', 2.0); const p3 = psnr(9.5, 'Muto.mp4', 1.5);
console.log('     PSNR:', p1, p2, p3);
const st3 = Math.ceil(11.008 * 30 - 1e-6);
const raw = run('ffmpeg', ['-v', 'error', '-i', out, '-vf', `select='gte(n\\,${st3})',crop=4:4:638:358,scale=1:1`, '-vsync', '0', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']).stdout;
const seq = [...raw].map((x) => Math.round(x / 4));
const exp = seq.map((_, i) => Math.floor((1 + ((st3 + i) / 30 - 11.008)) * 30 + 1e-4));
console.log('     contatore:', seq.join(','));
check(seq.length === 30 && seq.every((x, i) => x === exp[i]), 'contatore: ogni fotogramma esportato è quello esatto della sorgente');
check(p1 > 22 && p2 > 22 && p3 > 22, 'i fotogrammi esportati corrispondono alle sorgenti giuste, nell\'ordine giusto');
// audio: udibile nel primo segmento, muto dove disattivato e dove manca
const vol = (a0, d) => { const m = /mean_volume: (-?[0-9.]+|-inf)/.exec(run('ffmpeg', ['-v', 'info', '-ss', String(a0), '-t', String(d), '-i', out, '-af', 'volumedetect', '-vn', '-f', 'null', '-']).stderr.toString()); return m ? parseFloat(m[1]) : -Infinity; };
const v1 = vol(0.5, 3); const v2 = vol(4.5, 3); const v3 = vol(8.5, 2);
console.log('     volume medio (dB):', v1, v2, v3);
check(v1 > -40, 'audio udibile nella prima clip');
check(v2 < -70 || !isFinite(v2), 'clip con audio disattivato: silenzio');
check(v3 < -70 || !isFinite(v3), 'clip senza audio: silenzio');
// annullamento di un'esportazione
await page.click('dialog.modal >> text=Torna al montaggio');
await page.keyboard.press('Control+e');
await page.waitForFunction(() => document.querySelector('dialog.modal .modal-foot .btn-primary') && !document.querySelector('dialog.modal .modal-foot .btn-primary').disabled, null, { timeout: 10000 });
await page.click('dialog.modal .preset >> text=TikTok e Reels');
await page.waitForFunction(() => document.querySelector('dialog.modal .modal-foot .btn-primary').textContent.includes('Passa a 9:16'));
check(true, 'preset verticale propone il cambio formato');
await page.click('dialog.modal .modal-foot .btn-primary');
await page.waitForSelector('dialog.modal .stages');
check((await page.evaluate(() => App.view.editor.project.format)) === '9:16', 'formato del progetto passato a 9:16 prima dell\'esportazione');
await page.waitForTimeout(1500);
await page.click('dialog.modal >> text=Annulla esportazione');
await page.waitForSelector('dialog.modal .presets', { timeout: 10000 });
check(true, 'esportazione annullata: si torna alle impostazioni');
await page.keyboard.press('Escape');
await page.keyboard.press('Control+z'); await page.waitForTimeout(200);
check((await page.evaluate(() => App.view.editor.project.format)) === '16:9', 'Ctrl+Z riporta il formato a 16:9');
console.log('ERRORI CONSOLE:', errors);
await browser.close();
