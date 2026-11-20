// Fase 2: montaggio completo (aggiungi, trascina, dividi, taglia, annulla, riordina, elimina, riproduci, formato) + persistenza
import { launch, BASE, check, MEDIA, TMP } from './helpers.mjs';
const { browser, page, errors, ctx } = await launch();
await ctx.addInitScript(() => { localStorage.setItem('engimedit:tourDone', 'true'); });
const ed = () => page.evaluate(() => { const e = App.view.editor; return { n: e.clips.length, total: e.total, t: e.t, durs: e.clips.map((c) => Math.round(Engine.dur(c) * 100) / 100), assets: e.clips.map((c) => e.project.assets[c.assetId].name), sel: [...e.sel].length, fmt: e.project.format, fit: e.clips.map((c) => c.fit) }; });
const clipBox = async (i) => (await page.$$('.clip'))[i].boundingBox();
await page.goto(BASE + '#progetti');
await page.click('.dash-hero >> text=Nuovo progetto');
await page.waitForSelector('.ed');
const dir = MEDIA;
await page.setInputFiles('.ed-lib input[type=file]', [dir + 'Paesaggio.mp4', dir + 'Verticale.mp4', dir + 'Barre.webm']);
await page.waitForFunction(() => document.querySelectorAll('.lib-item').length === 3 && !document.querySelector('.lib-item.loading'), null, { timeout: 30000 });
// 1) aggiungi con il pulsante +
const items = await page.$$('.lib-item');
await items[0].hover();
await (await items[0].$('.la .btn-primary')).click();
await page.waitForTimeout(400);
let s = await ed();
check(s.n === 1 && s.total === 6, 'pulsante + aggiunge la clip (6 s)');
check(await page.textContent('.transport .tc').then((x) => x.includes('0:06.00')), 'durata totale mostrata 0:06.00');
// 2) trascina dalla libreria alla timeline
const src = await (await page.$$('.lib-item'))[1].boundingBox(); const tlTrack = await page.$('.tl-track').then((e) => e.boundingBox()); const tlBody = await page.$('.tl-scroll').then((e) => e.boundingBox());
const tl = { x: tlBody.x, width: tlBody.width, y: tlTrack.y, height: tlTrack.height };
await page.mouse.move(src.x + 40, src.y + 20); await page.mouse.down();
await page.mouse.move(src.x + 100, src.y + 100, { steps: 5 });
await page.mouse.move(tl.x + tl.width - 60, tl.y + tl.height / 2, { steps: 10 });
check(await page.isVisible('.drag-ghost'), 'trascinamento: fantasma visibile');
await page.mouse.up();
await page.waitForTimeout(300);
s = await ed();
check(s.n === 2 && s.total === 11 && s.assets[1] === 'Verticale.mp4', 'trascinamento in timeline aggiunge in coda');
// 3) clic sulla clip a 3 s e divisione con S
await page.evaluate(() => App.view.editor.zoomFit());
let b0 = await clipBox(0);
const pps = await page.evaluate(() => App.view.editor.pps);
await page.mouse.click(b0.x + 3 * pps, b0.y + b0.height / 2);
await page.waitForTimeout(200);
s = await ed();
check(Math.abs(s.t - 3) < 0.05, `clic sulla clip sposta il cursore (t=${s.t.toFixed(2)})`);
await page.keyboard.press('s');
await page.waitForTimeout(200);
s = await ed();
check(s.n === 3 && s.durs[0] === 3 && s.durs[1] === 3, `S divide al cursore ${JSON.stringify(s.durs)}`);
await page.screenshot({ path: 'test-results/06-split.png' });
// 4) taglio: maniglia destra della clip 2 a sinistra di 1 s
let b1 = await clipBox(1);
await page.mouse.move(b1.x + b1.width - 4, b1.y + b1.height / 2);
await page.mouse.down();
await page.mouse.move(b1.x + b1.width - 4 - pps * 1, b1.y + b1.height / 2, { steps: 8 });
check(await page.isVisible('.trim-tip'), 'taglio: etichetta durata visibile');
await page.mouse.up();
await page.waitForTimeout(200);
s = await ed();
check(Math.abs(s.durs[1] - 2) < 0.05 && Math.abs(s.total - 10) < 0.05, `taglio fine clip: ${s.durs[1]} s, totale ${s.total}`);
// 5) annulla / ripeti
await page.keyboard.press('Control+z'); await page.waitForTimeout(150);
s = await ed(); check(s.durs[1] === 3 && s.total === 11, 'Ctrl+Z annulla il taglio');
await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(150);
s = await ed(); check(Math.abs(s.durs[1] - 2) < 0.05, 'Ctrl+Shift+Z ripete il taglio');
// taglio dell'inizio con la maniglia sinistra
b0 = await clipBox(0);
await page.mouse.move(b0.x + 4, b0.y + b0.height / 2); await page.mouse.down();
await page.mouse.move(b0.x + 4 + pps * 0.5, b0.y + b0.height / 2, { steps: 6 }); await page.mouse.up();
await page.waitForTimeout(200);
s = await ed(); check(Math.abs(s.durs[0] - 2.5) < 0.06, `taglio inizio clip: ${s.durs[0]} s`);
// 6) riordino: trascina l'ultima clip all'inizio
const b2 = await clipBox(2); b0 = await clipBox(0);
await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2); await page.mouse.down();
await page.mouse.move(b2.x + b2.width / 2 - 30, b2.y + 10, { steps: 4 });
await page.mouse.move(b0.x + 5, b0.y + b0.height / 2, { steps: 12 });
check(await page.isVisible('.insert-mark'), 'riordino: indicatore di inserimento');
await page.mouse.up(); await page.waitForTimeout(200);
s = await ed(); check(s.assets[0] === 'Verticale.mp4', `riordino: ${s.assets.join(', ')}`);
// Alt+→ sposta la clip selezionata
await page.keyboard.press('Alt+ArrowRight'); await page.waitForTimeout(150);
s = await ed(); check(s.assets[1] === 'Verticale.mp4', 'Alt+→ sposta la clip a destra');
// 7) duplica ed elimina con annulla dal toast
await page.keyboard.press('Control+d'); await page.waitForTimeout(150);
s = await ed(); check(s.n === 4 && s.assets[2] === 'Verticale.mp4', 'Ctrl+D duplica subito dopo');
await page.keyboard.press('Delete'); await page.waitForTimeout(150);
s = await ed(); check(s.n === 3, 'Canc elimina la clip (ripple)');
await page.click('.toast button:has-text("Annulla")'); await page.waitForTimeout(150);
s = await ed(); check(s.n === 4, 'Annulla dal toast ripristina la clip');
await page.keyboard.press('Delete'); await page.waitForTimeout(150);
// 8) menu contestuale
const bx = await clipBox(0);
await page.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2, { button: 'right' });
check(await page.isVisible('.menu >> text=Dividi al cursore'), 'menu contestuale con le azioni');
await page.keyboard.press('Escape');
// 9) riproduzione
await page.keyboard.press('Home');
await page.click('.btn-play');
await page.waitForTimeout(1800);
s = await ed(); check(s.t > 1.0, `riproduzione: il tempo avanza (${s.t.toFixed(2)} s)`);
const pix = await page.evaluate(() => { const c = document.querySelector('.stage-frame canvas'); const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height).data; let sum = 0; for (let i = 0; i < d.length; i += 400) sum += d[i] + d[i + 1] + d[i + 2]; return sum; });
check(pix > 1000, 'anteprima: il canvas mostra immagini (non nero)');
await page.screenshot({ path: 'test-results/07-playing.png' });
await page.keyboard.press(' '); await page.waitForTimeout(200);
check(!(await page.evaluate(() => App.view.editor.player.playing)), 'Spazio mette in pausa');
// attraversamento dei confini tra clip
await page.evaluate(() => App.view.editor.seek(Engine.layout(App.view.editor.clips)[0].end - 0.4));
await page.click('.btn-play'); await page.waitForTimeout(1300);
s = await ed(); check(s.t > (await page.evaluate(() => Engine.layout(App.view.editor.clips)[0].end)) + 0.3, 'riproduzione attraversa il cambio clip');
await page.keyboard.press(' ');
// 10) formato 9:16 e Riempi
await page.click('[data-f="9:16"]'); await page.waitForTimeout(300);
const fr = await page.$('.stage-frame').then((e) => e.boundingBox());
check(fr.height > fr.width * 1.6, 'formato 9:16: anteprima verticale');
s = await ed(); const iL = s.assets.indexOf('Paesaggio.mp4');
const bL = await clipBox(iL); await page.mouse.click(bL.x + bL.width / 2, bL.y + bL.height / 2);
await page.click('.ed-props >> text=Riempi'); await page.waitForTimeout(200);
s = await ed(); check(s.fit[iL] === 'fill', 'Riempi applicato alla clip');
await page.screenshot({ path: 'test-results/08-vertical-fill.png' });
// 11) zoom e aggancio
const p0 = await page.evaluate(() => App.view.editor.pps);
await page.keyboard.press('+'); const p1 = await page.evaluate(() => App.view.editor.pps);
check(p1 > p0, 'zoom con +');
await page.click('[data-tip="Mostra tutto"]');
await page.click('.tl-bar >> text=Aggancio');
check((await page.getAttribute('.tl-bar [aria-pressed]', 'aria-pressed')) === 'false', 'aggancio disattivabile');
// 12) cronologia
await page.click('[aria-label="Cronologia"]');
check(await page.isVisible('.menu >> text=Stato attuale'), 'menu cronologia');
await page.keyboard.press('Escape');
// 13) rinomina e salvataggio
await page.fill('.pname', 'Gita al mare'); await page.keyboard.press('Enter');
await page.waitForTimeout(1200);
check((await page.textContent('.save-state')).includes('Salvato'), 'stato: salvato');
const before = await ed();
// 14) ricarica: persistenza di progetto e video
await page.reload();
await page.waitForSelector('.clip');
await page.waitForFunction(() => App.view && App.view.editor && App.view.editor.clips.length && document.querySelectorAll('.lib-item:not(.loading)').length === 3, null, { timeout: 20000 });
s = await ed();
check(JSON.stringify(s.durs) === JSON.stringify(before.durs) && s.fmt === '9:16' && s.assets.join() === before.assets.join(), 'dopo il ricaricamento la timeline è identica');
check((await page.inputValue('.pname')) === 'Gita al mare', 'nome del progetto salvato');
await page.waitForTimeout(800);
const pix2 = await page.evaluate(() => { const c = document.querySelector('.stage-frame canvas'); const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height).data; let sum = 0; for (let i = 0; i < d.length; i += 400) sum += d[i] + d[i + 1] + d[i + 2]; return sum; });
check(pix2 > 1000, 'dopo il ricaricamento i video sono letti dal browser');
await page.goto(BASE + '#progetti'); await page.waitForSelector('.proj-card:not(.new)');
check(await page.isVisible('.proj-card >> text=Gita al mare'), 'dashboard: progetto in elenco');
await page.screenshot({ path: 'test-results/09-dashboard.png' });
console.log('ERRORI CONSOLE:', errors);
await browser.close();
