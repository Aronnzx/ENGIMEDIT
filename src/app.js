'use strict';
/* =========================================================================
   app.js — avvio e navigazione. Rotte: #home, #progetti, #editor-<id>,
   #impostazioni, #aiuto, #privacy, #termini, #cookie (altro → 404).
   ========================================================================= */
const App = {
  view: null,
  sampleFor: null,
  routeToken: 0,
  storageOk: true,

  async start() {
    Theme.init();
    I18N.init();
    Tooltip.init();
    Toast.init();
    this.root = document.getElementById('app');
    try { await DB.open(); } catch (e) { this.storageOk = false; ErrLog.add('idb', e); }
    window.addEventListener('hashchange', () => this.route());
    // Se l'ambiente blocca la lettura dei video locali (blob:), lo diciamo chiaramente una volta sola
    let cspWarned = false;
    document.addEventListener('securitypolicyviolation', (e) => {
      if (cspWarned || !/^blob/.test(e.blockedURI || '') || !/media|default/.test(e.violatedDirective || '')) return;
      cspWarned = true;
      ErrLog.add('csp', new Error(e.violatedDirective + ' ' + e.blockedURI));
      Toast.show(t('app.cspMedia'), { type: 'err', duration: 0 });
    });
    this.route();
    if (this.storageOk) Store.purgePending();
    else Toast.show(t('app.noStorage'), { type: 'err', duration: 0 });
    Cloud.init().catch((e) => { ErrLog.add('cloud', e); Cloud.set('guest'); });
  },

  async route() {
    const tok = ++this.routeToken;
    const name = decodeURIComponent(location.hash.slice(1)) || 'home';
    Menu.close(); Tooltip.hide(); Tour.end(true); Tips.hide();
    if (Toast.region) Toast.region.textContent = ''; // i messaggi riguardano la schermata precedente
    for (const d of $$('dialog[open]')) { try { d.close(); } catch {} d.remove(); }
    if (this.view && this.view.destroy) {
      const old = this.view; this.view = null;
      try { await old.destroy(); } catch (e) { ErrLog.add('destroy', e); }
    }
    if (tok !== this.routeToken) return;
    this.root.textContent = '';
    document.documentElement.classList.toggle('is-editor', name.startsWith('editor-'));
    let v; let title;
    if (name === 'home') { v = LandingView(); title = t('title.home'); }
    else if (name === 'progetti') { v = DashboardView(); title = t('title.projects'); }
    else if (name === 'impostazioni') { v = SettingsView(); title = t('title.settings'); }
    else if (name === 'aiuto') { v = HelpView(); title = t('title.help'); }
    else if (['privacy', 'termini', 'cookie'].includes(name)) { v = LegalView(name); title = t('title.' + name); }
    else if (/^editor-[a-z0-9]+$/.test(name)) { v = EditorView(name.slice(7)); title = t('title.editor'); }
    else { v = NotFoundView(); title = t('title.nf'); }
    this.view = v;
    this.root.appendChild(v.el);
    document.title = title;
    window.scrollTo(0, 0);
    const main = document.getElementById('main');
    if (main && name !== 'home') main.focus({ preventScroll: true });
    if (v.mount) v.mount();
  },
};

function EditorView(id) {
  const el = h('div', { style: { height: '100%' } });
  const ed = new Editor(el, id);
  return {
    el,
    mount() { ed.mount().catch((e) => { ErrLog.add('editor-mount', e); Toast.show(t('ed.openFail'), { type: 'err', duration: 8000 }); }); },
    destroy() { return ed.destroy(); },
    editor: ed,
  };
}

document.addEventListener('DOMContentLoaded', () => App.start());
