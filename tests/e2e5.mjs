// Fase 5: telefono, tablet, tastiera
import { launch, BASE, check, MEDIA, TMP } from './helpers.mjs';
{
  const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 }, ctx: { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } });
  await page.goto(BASE + '#home'); await page.waitForSelector('.lp-hero');
  const ov = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  check(ov, 'telefono: la landing non scorre di lato');
  await page.screenshot({ path: 'test-results/23-mobile-landing.png' });
  await page.goto(BASE + '#progetti'); await page.waitForSelector('.dash-hero');
  await page.screenshot({ path: 'test-results/24-mobile-dashboard.png' });
  await page.click('.dash-hero >> text=Nuovo progetto');
  await page.waitForSelector('.gate h1');
  check(await page.isVisible('text=EngimEdit funziona al meglio su computer'), 'telefono: messaggio elegante nell\'editor');
  await page.waitForTimeout(1200);
  check(!(await page.isVisible('.tour-pop')), 'telefono: niente tutorial sopra il messaggio');
  await page.screenshot({ path: 'test-results/25-mobile-editor.png' });
  console.log('ERRORI CONSOLE (telefono):', errors);
  await browser.close();
}
{
  const { browser, page, errors, ctx } = await launch({ viewport: { width: 1024, height: 768 } });
  await ctx.addInitScript(() => { localStorage.setItem('engimedit:tourDone', 'true'); });
  await page.goto(BASE + '#progetti'); await page.click('.dash-hero >> text=Nuovo progetto'); await page.waitForSelector('.ed');
  await page.setInputFiles('.ed-lib input[type=file]', [MEDIA + 'Paesaggio.mp4', MEDIA + 'Verticale.mp4']);
  await page.waitForFunction(() => document.querySelectorAll('.lib-item:not(.loading)').length === 2, null, { timeout: 30000 });
  // solo tastiera: Tab fino al primo video della libreria, Invio per aggiungerlo
  await page.focus('.lib-item');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  check((await page.evaluate(() => App.view.editor.clips.length)) === 1, 'tastiera: Invio sul video lo aggiunge alla timeline');
  await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.focus('.clip');
  await page.keyboard.press('Shift+F10');
  check(await page.isVisible('.menu[role=menu]'), 'tastiera: menu contestuale con Maiusc+F10');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape');
  check(await page.evaluate(() => document.activeElement.classList.contains('clip')), 'tastiera: il focus torna alla clip dopo il menu');
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow);
  check(outline && outline !== 'none', 'focus visibile sulla clip');
  await page.screenshot({ path: 'test-results/26-tablet-editor.png' });
  console.log('ERRORI CONSOLE (tablet):', errors);
  await browser.close();
}
