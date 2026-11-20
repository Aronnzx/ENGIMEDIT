// Fase 4: progetto di esempio, ritrova i video, dashboard (rinomina, duplica, elimina e annulla), impostazioni, aiuto, legali, 404, tema, lingua
import { launch, BASE, check, MEDIA, TMP } from './helpers.mjs';
const { browser, page, ctx, errors } = await launch();
await ctx.addInitScript(() => { localStorage.setItem('engimedit:tourDone', 'true'); });
// 1) progetto di esempio
await page.goto(BASE + '#progetti');
await page.click('.dash-hero >> text=Prova il progetto di esempio');
await page.waitForSelector('dialog.modal >> text=Preparazione delle clip di esempio');
await page.waitForFunction(() => App.view && App.view.editor && App.view.editor.clips.length === 3, null, { timeout: 60000 });
const names = await page.evaluate(() => App.view.editor.clips.map((c) => App.view.editor.project.assets[c.assetId].name));
check(names.join() === 'Alba.mp4,Città.mp4,Onde.mp4', 'progetto di esempio: 3 clip generate e in timeline (' + names.join(', ') + ')');
await page.waitForFunction(() => document.querySelectorAll('.lib-item:not(.loading)').length === 3 && Object.keys(App.view.editor.project.assets).every((id) => Media.get(id).audioState === 'ready'), null, { timeout: 30000 });
check(true, 'clip di esempio con audio decodificato');
await page.waitForTimeout(1500);
await page.screenshot({ path: 'test-results/13-sample-project.png' });
const pid = await page.evaluate(() => App.view.editor.project.id);
// 2) ritrova i video: si cancellano i file dal browser e si riapre il progetto
await page.evaluate(async () => { for (const id of Object.keys(App.view.editor.project.assets)) await DB.del('media', id); });
const sampleFiles = await page.evaluate(async () => {
  // si recuperano i file generati per poterli "riselezionare" come farebbe l'utente
  const out = [];
  for (const id of Object.keys(App.view.editor.project.assets)) { const e = Media.get(id); const buf = new Uint8Array(await e.blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192)); out.push({ name: App.view.editor.project.assets[id].name, b64: btoa(s) }); }
  return out;
});
const fs = await import('node:fs');
const RL = TMP + '/engimedit-relink/';
fs.mkdirSync(RL, { recursive: true });
for (const f of sampleFiles) fs.writeFileSync(RL + f.name, Buffer.from(f.b64, 'base64'));
await page.goto(BASE + '#progetti'); await page.waitForSelector('.proj-card:not(.new)');
await page.goto(BASE + '#editor-' + pid);
await page.waitForSelector('dialog.modal >> text=Ritrova i tuoi video', { timeout: 10000 });
check(true, 'riapertura senza file: compare "Ritrova i tuoi video"');
check((await page.$$('.lib-item.missing')).length === 3, 'libreria: 3 video segnati da ritrovare');
await page.screenshot({ path: 'test-results/14-relink.png' });
const asFile = (path, name) => ({ name, mimeType: 'video/mp4', buffer: fs.readFileSync(path) });
await page.setInputFiles('dialog.modal input[type=file]', [asFile(RL + 'Alba.mp4', 'Alba.mp4'), asFile(RL + 'Città.mp4', 'Città.mp4'), asFile(MEDIA + 'Muto.mp4', 'Muto.mp4')]);
await page.waitForFunction(() => document.querySelectorAll('dialog.modal .badge.ok').length === 2, null, { timeout: 20000 });
check(true, 'due file riconosciuti e ricollegati');
check(await page.isVisible('.toast >> text=non corrisponde'), 'file sbagliato: messaggio chiaro');
await page.setInputFiles('dialog.modal input[type=file]', [asFile(RL + 'Onde.mp4', 'Onde.mp4')]);
await page.waitForFunction(() => document.querySelectorAll('dialog.modal .badge.ok').length === 3, null, { timeout: 20000 });
check((await page.textContent('dialog.modal .modal-foot')).includes('Fatto'), 'tutti ricollegati: pulsante Fatto');
await page.click('dialog.modal >> text=Fatto');
await page.waitForTimeout(800);
check((await page.$$('.lib-item.missing')).length === 0, 'libreria completa dopo il ricollegamento');
const pix = await page.evaluate(() => { const c = document.querySelector('.stage-frame canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 400) s += d[i] + d[i + 1] + d[i + 2]; return s; });
check(pix > 1000, 'anteprima di nuovo visibile');
// 3) dashboard: rinomina, duplica, elimina e annulla
await page.goto(BASE + '#progetti'); await page.waitForSelector('.proj-card:not(.new)');
await page.click('.proj-card:not(.new) .more');
await page.click('.menu >> text=Rinomina');
await page.fill('dialog.modal input', 'Esempio rinominato'); await page.keyboard.press('Enter');
await page.waitForSelector('.proj-card >> text=Esempio rinominato');
check(true, 'rinomina dalla dashboard');
await page.click('.proj-card:not(.new) .more'); await page.click('.menu >> text=Duplica');
await page.waitForSelector('.proj-card >> text=Esempio rinominato (copia)');
check((await page.$$('.proj-card:not(.new)')).length === 2, 'duplica crea una copia');
await page.screenshot({ path: 'test-results/15-dashboard.png' });
const card = await page.$('.proj-card:has-text("(copia)")');
await (await card.$('.more')).click(); await page.click('.menu >> text=Elimina');
await page.click('dialog.modal >> text=Elimina progetto');
await page.waitForTimeout(300);
check((await page.$$('.proj-card:not(.new)')).length === 1, 'elimina con conferma');
await page.click('.toast >> text=Annulla');
await page.waitForTimeout(500);
check((await page.$$('.proj-card:not(.new)')).length === 2, 'annulla eliminazione ripristina il progetto');
// 4) impostazioni: tema e lingua
await page.click('.sidebar >> text=Impostazioni');
await page.waitForSelector('.settings-sec');
await page.waitForTimeout(500);
await page.screenshot({ path: 'test-results/16-settings.png', fullPage: true });
await page.click('.seg >> text=Chiaro');
check((await page.getAttribute('html', 'data-ui')) === 'light', 'tema chiaro applicato');
await page.screenshot({ path: 'test-results/17-settings-light.png' });
await page.goto(BASE + '#progetti'); await page.waitForSelector('.proj-card');
await page.screenshot({ path: 'test-results/18-dashboard-light.png' });
await page.goto(BASE + '#editor-' + pid); await page.waitForSelector('.clip'); await page.waitForTimeout(1200);
await page.screenshot({ path: 'test-results/19-editor-light.png' });
await page.goto(BASE + '#impostazioni'); await page.waitForSelector('.settings-sec');
await page.click('.seg >> text=Scuro');
await page.selectOption('.settings-sec select', 'en');
await page.waitForSelector('h1 >> text=Settings');
check(true, 'lingua inglese applicata');
await page.goto(BASE + '#home'); await page.waitForSelector('.lp-hero');
check((await page.textContent('.lp-hero h1')).includes('Edit your first video'), 'landing in inglese');
await page.screenshot({ path: 'test-results/20-landing-en.png' });
await page.click('.lang-switch >> text=Italiano');
await page.waitForSelector('.lp-hero h1 >> text=Monta il tuo primo video');
check(true, 'ritorno all\'italiano dal footer');
// 5) aiuto, legali, 404
await page.goto(BASE + '#aiuto'); await page.waitForSelector('h1 >> text=Centro assistenza');
await page.click('.faq summary >> nth=0');
check(await page.isVisible('.faq details[open] p'), 'aiuto: le domande si aprono');
for (const [r, title] of [['privacy', 'Informativa sulla privacy'], ['termini', 'Termini di servizio'], ['cookie', 'Cookie e archiviazione locale']]) {
  await page.goto(BASE + '#' + r); await page.waitForSelector('h1 >> text=' + title);
  check(true, 'pagina ' + r);
}
await page.screenshot({ path: 'test-results/21-privacy.png' });
await page.goto(BASE + '#non-esiste'); await page.waitForSelector('.nf .code');
check(true, 'pagina 404');
await page.screenshot({ path: 'test-results/22-404.png' });
// 6) scorciatoie con ?
await page.goto(BASE + '#editor-' + pid); await page.waitForSelector('.clip');
await page.keyboard.press('?');
check(await page.isVisible('dialog.modal >> text=Scorciatoie da tastiera'), 'tasto ? apre le scorciatoie');
await page.keyboard.press('Escape');
console.log('ERRORI CONSOLE:', errors);
await browser.close();
