'use strict';
/* =========================================================================
   views.js — schermate fuori dall'editor
   ========================================================================= */
const CONTACT_EMAIL = 'supporto@engimedit.it'; // indirizzo di assistenza: da sostituire con quello reale

/* ---------------- Barra laterale comune ---------------- */
function sidebar(active) {
  const item = (href, iconName, label, key) => {
    const a = h('a', { class: 'nav-item', href: '#' + href, 'aria-current': key === active ? 'page' : null });
    a.appendChild(ic(iconName)); a.appendChild(h('span', { class: 'lbl' }, label));
    return a;
  };
  const acct = h('div', { class: 'acct' });
  const paint = () => {
    acct.textContent = '';
    const guest = !Cloud.active();
    const nm = guest ? t('acct.guest') : (Cloud.name || t('acct.you'));
    const status = Cloud.state === 'on' ? [t('acct.synced'), 'on'] : Cloud.state === 'syncing' || Cloud.state === 'init' ? [t('acct.syncing'), ''] : Cloud.state === 'offline' ? [t('acct.offline'), 'warn'] : [t('acct.local'), ''];
    acct.append(h('div', { class: 'avatar', 'aria-hidden': 'true' }, (nm.trim()[0] || 'E').toUpperCase()),
      h('div', { class: 'who' }, h('b', null, nm), h('span', null, h('i', { class: 'dot ' + status[1] }), status[0])));
  };
  paint();
  const off = Cloud.on(paint);
  const el = h('nav', { class: 'sidebar', 'aria-label': t('nav.main') }, logoEl('#home'),
    item('progetti', 'folder', t('nav.projects'), 'projects'),
    item('aiuto', 'help', t('nav.help'), 'help'),
    item('impostazioni', 'settings', t('nav.settings'), 'settings'),
    h('div', { class: 'grow' }), h('div', { class: 'sep' }), acct);
  el._off = off;
  return el;
}
function shellView(active, buildMain) {
  const root = h('div', { class: 'shell' });
  const side = sidebar(active);
  const main = h('main', { class: 'main', id: 'main', tabindex: '-1' });
  const inner = h('div', { class: 'main-in' });
  main.appendChild(inner);
  root.append(side, main);
  const api = buildMain(inner) || {};
  return { el: root, destroy() { side._off && side._off(); api.destroy && api.destroy(); } };
}

/* ---------------- Landing ---------------- */
function LandingView() {
  const scrollTo = (id) => { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); };
  const navBtn = (id, label) => h('a', { href: '#home', onclick: (e) => { e.preventDefault(); scrollTo(id); } }, label);
  const check = () => h('span', { class: 'y' }, ic('check'), t('cmp.yes'));
  const no = (txt) => h('span', { class: 'n' }, ic('x'), txt || t('cmp.no'));
  const part = (txt) => h('span', null, txt);
  const rows = [
    ['cmp.r1', check(), part(t('cmp.r1b')), part(t('cmp.r1c'))],
    ['cmp.r2', check(), no(), no()],
    ['cmp.r3', check(), part(t('cmp.r3b')), check()],
    ['cmp.r4', check(), no(t('cmp.r4b')), check()],
    ['cmp.r5', check(), check(), check()],
    ['cmp.r6', check(), check(), check()],
    ['cmp.r7', check(), check(), part(t('cmp.r7c'))],
  ];
  const faqs = [1, 2, 3, 4, 5, 6].map((i) => h('details', null, h('summary', null, t('faq.q' + i), ic('chevDown')), h('p', null, t('faq.a' + i))));
  const langBtns = h('div', { class: 'lang-switch' }, ['it', 'en'].map((l) => h('button', { class: 'btn btn-ghost btn-sm', 'aria-pressed': String(I18N.lang === l), onclick: () => { I18N.set(l); App.route(); } }, l === 'it' ? 'Italiano' : 'English')));
  const el = h('div', { class: 'lp' },
    h('header', { class: 'lp-nav' }, h('div', { class: 'in' }, logoEl('#home'),
      h('nav', { 'aria-label': t('nav.landing') }, navBtn('come', t('lp.navHow')), navBtn('vantaggi', t('lp.navWhy')), navBtn('confronto', t('lp.navCmp')), navBtn('domande', t('lp.navFaq'))),
      h('a', { class: 'btn btn-primary', href: '#progetti' }, t('lp.open')))),
    h('main', { id: 'main', tabindex: '-1' },
      h('div', { class: 'lp-wrap' },
        h('section', { class: 'lp-hero' },
          h('div', null,
            h('h1', null, t('lp.h1a'), h('span', { class: 'grad' }, t('lp.h1b'))),
            h('p', { class: 'sub' }, t('lp.sub')),
            h('div', { class: 'cta' }, h('a', { class: 'btn btn-primary btn-lg', href: '#progetti' }, t('lp.cta')), h('button', { class: 'btn btn-outline btn-lg', onclick: () => scrollTo('come') }, t('lp.cta2'))),
            h('div', { class: 'facts' }, h('span', null, ic('lock'), t('lp.f1')), h('span', null, ic('noMark'), t('lp.f2')), h('span', null, ic('gift'), t('lp.f3')))),
          h('div', { class: 'hero-art', html: Art.hero() })),
        h('section', { class: 'lp-section', id: 'come' },
          h('h2', null, t('lp.howTitle')), h('p', { class: 'lead' }, t('lp.howLead')),
          h('ol', { class: 'steps' },
            h('li', null, h('h3', null, t('lp.s1t')), h('p', null, t('lp.s1'))),
            h('li', null, h('h3', null, t('lp.s2t')), h('p', null, t('lp.s2a'), h('span', { class: 'kbd' }, 'S'), t('lp.s2b'))),
            h('li', null, h('h3', null, t('lp.s3t')), h('p', null, t('lp.s3'))))),
        h('section', { class: 'lp-section', id: 'vantaggi' },
          h('h2', null, t('lp.whyTitle')),
          h('div', { class: 'benefits' },
            [['bolt', 'b1'], ['lock', 'b2'], ['gift', 'b3'], ['noMark', 'b4']].map(([icn, k]) => h('div', null, h('div', { class: 'ic' }, ic(icn)), h('div', null, h('h3', null, t('lp.' + k + 't')), h('p', null, t('lp.' + k))))))),
        h('section', { class: 'lp-section', id: 'confronto' },
          h('h2', null, t('lp.cmpTitle')), h('p', { class: 'lead' }, t('lp.cmpLead')),
          h('div', { class: 'cmp-wrap' }, h('table', { class: 'cmp' },
            h('thead', null, h('tr', null, h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, t('cmp.feature'))), h('th', { scope: 'col', class: 'me' }, 'EngimEdit'), h('th', { scope: 'col' }, t('cmp.pro')), h('th', { scope: 'col' }, t('cmp.online')))),
            h('tbody', null, rows.map(([k, a, b, c]) => h('tr', null, h('th', { scope: 'row' }, t(k)), h('td', { class: 'me' }, a), h('td', null, b), h('td', null, c))))))),
        h('section', { class: 'lp-section', id: 'domande' }, h('h2', null, t('lp.faqTitle')), h('div', { class: 'faq' }, faqs)),
        h('div', { class: 'lp-final' }, h('div', null, h('h2', null, t('lp.finalT')), h('p', null, t('lp.final'))), h('a', { class: 'btn btn-lg', href: '#progetti' }, t('lp.cta'))))),
    h('footer', { class: 'lp-foot' }, h('div', { class: 'lp-wrap' }, h('div', { class: 'in' }, logoEl('#home'), h('span', null, t('lp.copy', { y: new Date().getFullYear() })),
      h('nav', { 'aria-label': t('nav.footer') }, h('a', { href: '#privacy' }, t('legal.privacy')), h('a', { href: '#termini' }, t('legal.terms')), h('a', { href: '#cookie' }, t('legal.cookie')), h('a', { href: '#aiuto' }, t('nav.help'))), langBtns))));
  return { el };
}

/* ---------------- Dashboard progetti ---------------- */
function DashboardView() {
  return shellView('projects', (inner) => {
    let destroyed = false;
    const pendingDeletes = new Map();
    const grid = h('div');
    const notice = h('div');
    const count = h('span', { class: 'badge' });
    // Project Manager: ricerca, ordinamento, importazione di un backup
    let query = '';
    let sortBy = Prefs.get('projSort', 'updated');
    const search = h('input', { class: 'input', type: 'search', placeholder: t('dash.search'), 'aria-label': t('dash.search'), maxlength: 80 });
    search.addEventListener('input', debounce(() => { query = search.value.trim().toLowerCase(); render(); }, 150));
    const sortSel = h('select', { class: 'select', 'aria-label': t('dash.sort') });
    for (const k of ['updated', 'created', 'name', 'duration']) sortSel.appendChild(h('option', { value: k }, t('dash.sort.' + k)));
    sortSel.value = sortBy;
    sortSel.addEventListener('change', () => { sortBy = sortSel.value; Prefs.set('projSort', sortBy); render(); });
    const importInput = h('input', { type: 'file', accept: '.json,application/json', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true' });
    importInput.addEventListener('change', async () => {
      const f = importInput.files[0]; importInput.value = '';
      if (!f) return;
      try {
        const p = await Store.importProject(f);
        Toast.show(t('dash.imported', { name: p.name }), { type: 'ok', duration: 6000, actionLabel: t('dash.open'), action: () => { location.hash = 'editor-' + p.id; } });
        render();
      } catch (e) {
        if (!e || !e.code) ErrLog.add('import-json', e);
        Toast.show(e && e.code === 'too-big' ? t('dash.importBig') : t('dash.importBad', { name: f.name }), { type: 'err', duration: 7000 });
      }
    });
    const importBtn = h('button', { class: 'btn btn-outline', onclick: () => importInput.click(), 'data-tip': t('dash.importTip') }, ic('upload'), t('dash.import'));
    const tools = h('div', { class: 'dash-tools', role: 'search' }, h('label', { class: 'search-field' }, ic('search'), search), h('label', { class: 'sort-field' }, h('span', { class: 'sr-only' }, t('dash.sort')), sortSel), importBtn, importInput);
    const name = Cloud.active() && Cloud.name ? Cloud.name.split(' ')[0] : '';
    inner.append(
      h('section', { class: 'dash-hero' },
        h('div', null,
          h('h1', null, name ? t('dash.hiName', { name }) : t('dash.hi'), h('br'), h('span', { class: 'grad' }, t('dash.hi2'))),
          h('p', null, t('dash.sub')),
          h('div', { class: 'cta' }, h('button', { class: 'btn btn-primary btn-lg', onclick: () => newProject() }, ic('plus'), t('dash.new')), h('button', { class: 'btn btn-outline btn-lg', onclick: () => sampleProject() }, ic('sparkle'), t('dash.sample')))),
        h('div', { class: 'art', html: Art.dash() })),
      notice,
      h('div', { class: 'section-head' }, h('h2', null, ic('folder'), t('dash.mine'), count), tools),
      grid);

    const paintNotice = () => {
      notice.textContent = '';
      if (Cloud.state === 'guest' || Cloud.state === 'readonly') notice.appendChild(h('div', { class: 'notice', style: { marginTop: '18px' } }, ic('device'), h('div', null, t(Cloud.state === 'readonly' ? 'dash.readonly' : 'dash.guest'))));
      if (Cloud.state === 'offline') notice.appendChild(h('div', { class: 'notice warn', style: { marginTop: '18px' } }, ic('cloudOff'), h('div', null, t('dash.offline'))));
    };
    const newProject = async () => {
      try { const p = await Store.create(await Store.uniqueName(t('proj.untitled'))); location.hash = 'editor-' + p.id; }
      catch (e) { ErrLog.add('create', e); Toast.show(t('dash.createFail'), { type: 'err' }); }
    };
    const sampleProject = async () => {
      try { const p = await Store.create(await Store.uniqueName(t('proj.sample'))); App.sampleFor = p.id; location.hash = 'editor-' + p.id; }
      catch (e) { ErrLog.add('create', e); Toast.show(t('dash.createFail'), { type: 'err' }); }
    };
    const exportJson = async (p) => {
      try { const res = await ProjectFile.download(p); if (res === 'saved') Toast.show(t('proj.exported'), { type: 'ok', duration: 2500 }); }
      catch (e) { ErrLog.add('export-json', e); Toast.show(t('proj.exportFail'), { type: 'err' }); }
    };
    const card = (p) => {
      const clips = p.tracks.reduce((a, tr) => a.concat(tr.clips), []);
      const dur = Engine.projectTotal(p);
      const thumb = h('div', { class: 'thumb' });
      if (p.thumb) thumb.appendChild(h('img', { src: p.thumb, alt: '' }));
      else thumb.appendChild(h('div', { class: 'ph', 'aria-hidden': 'true' }, (p.name.trim()[0] || 'E').toUpperCase()));
      thumb.appendChild(h('span', { class: 'badge fmt' }, p.format));
      const more = h('button', { class: 'btn btn-ghost btn-icon btn-sm more', 'aria-label': t('dash.more', { name: p.name }), 'aria-haspopup': 'menu', html: icon('more') });
      more.addEventListener('click', () => Menu.fromButton(more, [
        { icon: 'film', label: t('dash.open'), run: () => { location.hash = 'editor-' + p.id; } },
        { icon: 'edit', label: t('dash.rename'), run: () => rename(p) },
        { icon: 'copy', label: t('dash.duplicate'), run: () => duplicate(p) },
        { icon: 'download', label: t('proj.exportJson'), run: () => exportJson(p) },
        '-',
        { icon: 'trash', label: t('dash.delete'), danger: true, run: () => remove(p) },
      ]));
      const meta = clips.length ? t('dash.meta', { n: clips.length, d: fmtTime(dur, false) }) : t('dash.metaEmpty');
      return h('article', { class: 'proj-card' },
        h('button', { class: 'open', onclick: () => { location.hash = 'editor-' + p.id; }, 'aria-label': t('dash.openName', { name: p.name }) }, thumb,
          h('div', { class: 'meta' }, h('b', null, p.name), h('span', null, `${t('dash.edited', { when: fmtDate(p.updatedAt) })}, ${meta}`))),
        more);
    };
    const render = async () => {
      let list = [];
      try { list = await Store.list(); } catch (e) { ErrLog.add('list', e); }
      if (destroyed) return;
      list = list.filter((p) => !pendingDeletes.has(p.id));
      const totalN = list.length;
      if (query) list = list.filter((p) => p.name.toLowerCase().includes(query));
      const cmp = {
        updated: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
        created: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
        name: (a, b) => a.name.localeCompare(b.name, I18N.locale(), { sensitivity: 'base', numeric: true }),
        duration: (a, b) => Engine.projectTotal(b) - Engine.projectTotal(a),
      }[sortBy] || (() => 0);
      list.sort(cmp);
      count.textContent = query ? `${list.length} / ${totalN}` : String(totalN);
      grid.textContent = '';
      paintNotice();
      if (query && !list.length && totalN) {
        grid.appendChild(h('div', { class: 'empty', style: { padding: '40px 20px' } }, h('span', { html: icon('search') }), h('h3', null, t('dash.noMatchT')), h('p', null, t('dash.noMatch', { q: search.value.trim() })),
          h('div', { class: 'actions' }, h('button', { class: 'btn btn-outline', onclick: () => { search.value = ''; query = ''; render(); search.focus(); } }, t('dash.clearSearch')))));
        return;
      }
      if (!list.length) {
        grid.appendChild(h('div', { class: 'empty', style: { padding: '48px 20px', border: '1.5px dashed var(--border-strong)', borderRadius: 'var(--r-xl)' } },
          h('span', { html: Art.folder() }), h('h3', null, t('dash.emptyT')), h('p', null, t('dash.empty')),
          h('div', { class: 'actions' }, h('button', { class: 'btn btn-primary', onclick: newProject }, ic('plus'), t('dash.new')), h('button', { class: 'btn btn-outline', onclick: sampleProject }, ic('sparkle'), t('dash.sample')), h('button', { class: 'btn btn-ghost', onclick: () => importInput.click() }, ic('upload'), t('dash.import')))));
        return;
      }
      const g = h('div', { class: 'proj-grid' }, h('button', { class: 'proj-card new', onclick: newProject }, ic('plus'), t('dash.new')), list.map(card));
      grid.appendChild(g);
    };
    const rename = async (p) => {
      const v = await promptDialog({ title: t('dash.renameT'), label: t('dash.nameLabel'), value: p.name, confirm: t('dash.renameOk') });
      if (!v) return;
      await Store.rename(p.id, v); Toast.show(t('dash.renamed'), { type: 'ok', duration: 2500 }); render();
    };
    const duplicate = async (p) => {
      const c = await Store.duplicate(p.id);
      if (c) { Toast.show(t('dash.duplicated', { name: c.name }), { type: 'ok', duration: 3000 }); render(); }
    };
    const remove = async (p) => {
      const ok = await confirmDialog({ title: t('dash.deleteT', { name: p.name }), body: t('dash.deleteText'), confirm: t('dash.deleteOk'), danger: true });
      if (!ok) return;
      await Store.softDelete(p.id);
      const tm = setTimeout(async () => { pendingDeletes.delete(p.id); await Store.finalizeDelete(p.id); }, 7500);
      pendingDeletes.set(p.id, tm);
      render();
      Toast.show(t('dash.deleted', { name: p.name }), { duration: 7000, actionLabel: t('ed.undo'), action: async () => { clearTimeout(tm); pendingDeletes.delete(p.id); await Store.restore(p.id); render(); } });
    };
    const offCloud = Cloud.on((s) => { if (s === 'on' || s === 'guest' || s === 'offline' || s === 'readonly') render(); });
    render();
    if (Cloud.db) Cloud.pull().then(() => !destroyed && render());
    Media.collectGarbage();
    return { destroy() { destroyed = true; offCloud(); for (const [id, tm] of pendingDeletes) { clearTimeout(tm); Store.finalizeDelete(id); } } };
  });
}

/* ---------------- Impostazioni ---------------- */
function SettingsView() {
  return shellView('settings', (inner) => {
    let destroyed = false;
    inner.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, t('set.title')), h('p', null, t('set.sub')))));
    // Lingua e tema
    const langSel = h('select', { class: 'select', style: { width: '200px' }, 'aria-label': t('set.lang') }, h('option', { value: 'it' }, 'Italiano'), h('option', { value: 'en' }, 'English'));
    langSel.value = I18N.lang;
    langSel.addEventListener('change', () => { I18N.set(langSel.value); App.route(); });
    const themeSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': t('set.theme') });
    for (const [v, l] of [['dark', t('set.dark')], ['light', t('set.light')], ['system', t('set.system')]]) {
      const b = h('button', { role: 'radio', 'aria-checked': String(Theme.pref() === v) }, l);
      b.addEventListener('click', () => { Theme.set(v); for (const x of themeSeg.children) x.setAttribute('aria-checked', String(x === b)); });
      themeSeg.appendChild(b);
    }
    inner.appendChild(h('section', { class: 'settings-sec' }, h('h2', null, t('set.look')),
      h('div', { class: 'row' }, h('div', null, h('b', null, t('set.lang')), h('span', null, t('set.langHint'))), langSel),
      h('div', { class: 'row' }, h('div', null, h('b', null, t('set.theme')), h('span', null, t('set.themeHint'))), themeSeg)));
    // Account
    const acct = h('section', { class: 'settings-sec' });
    const paintAcct = () => {
      acct.textContent = '';
      acct.appendChild(h('h2', null, t('set.account')));
      if (Cloud.active() || Cloud.state === 'readonly') {
        acct.append(h('div', { class: 'row' }, h('div', null, h('b', null, Cloud.name || t('acct.you')), h('span', null, t('set.acctOn'))),
          h('button', { class: 'btn btn-sm', onclick: async () => { const ok = await Cloud.pull(); Toast.show(ok ? t('set.synced') : t('set.syncFail'), { type: ok ? 'ok' : 'err' }); } }, ic('refresh'), t('set.syncNow'))),
          h('div', { class: 'row' }, h('div', null, h('b', null, t('set.cloudDel')), h('span', null, t('set.cloudDelHint'))),
            h('button', { class: 'btn btn-sm btn-outline', style: { color: 'var(--danger)' }, onclick: async () => {
              const ok = await confirmDialog({ title: t('set.cloudDelT'), body: t('set.cloudDelText'), confirm: t('set.cloudDelOk'), danger: true });
              if (!ok) return;
              try { const n = await Cloud.removeAll(); Toast.show(t('set.cloudDeleted', { n }), { type: 'ok' }); } catch { Toast.show(t('set.syncFail'), { type: 'err' }); }
            } }, ic('trash'), t('set.cloudDelOk'))));
      } else {
        acct.append(h('div', { class: 'notice' }, ic('device'), h('div', null, t('set.acctGuest'))));
      }
    };
    paintAcct();
    const offCloud = Cloud.on(paintAcct);
    inner.appendChild(acct);
    // Spazio sul dispositivo
    const store = h('section', { class: 'settings-sec' }, h('h2', null, t('set.storage')), h('div', { class: 'skeleton', style: { height: '60px' } }));
    inner.appendChild(store);
    const paintStore = async () => {
      let est = null; let projects = [];
      try { est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch {}
      try { projects = await Store.list(); } catch {}
      if (destroyed) return;
      store.textContent = '';
      store.appendChild(h('h2', null, t('set.storage')));
      if (est && est.quota) {
        const pct = Math.min(100, (est.usage / est.quota) * 100);
        store.append(h('div', { class: 'row' }, h('div', null, h('b', null, t('set.used', { u: fmtBytes(est.usage), q: fmtBytes(est.quota) })), h('span', null, t('set.storageHint')))),
          h('div', { class: 'store-bar', role: 'progressbar', 'aria-valuenow': String(Math.round(pct)), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': t('set.storage') }, h('span', { style: { width: Math.max(1, pct) + '%' } })));
      }
      if (projects.length) {
        store.appendChild(h('div', { style: { overflowX: 'auto' } }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, t('set.thProject')), h('th', null, t('set.thVideos')), h('th', null, t('set.thSize')))),
          h('tbody', null, projects.map((p) => h('tr', null, h('td', null, p.name), h('td', { class: 'tnum' }, String(Object.keys(p.assets).length)), h('td', { class: 'tnum' }, fmtBytes(Store.mediaSize(p)))))))));
      }
      store.append(
        h('div', { class: 'row' }, h('div', null, h('b', null, t('set.gc')), h('span', null, t('set.gcHint'))),
          h('button', { class: 'btn btn-sm', onclick: async () => { const freed = await Media.collectGarbage(); Toast.show(t('set.gcDone', { s: fmtBytes(freed) }), { type: 'ok' }); paintStore(); } }, ic('refresh'), t('set.gc'))),
        h('div', { class: 'row' }, h('div', null, h('b', null, t('set.wipe')), h('span', null, t('set.wipeHint'))),
          h('button', { class: 'btn btn-sm btn-danger', onclick: async () => {
            const ok = await confirmDialog({ title: t('set.wipeT'), body: t('set.wipeText'), confirm: t('set.wipeOk'), danger: true });
            if (!ok) return;
            try { await DB.clear('projects'); await DB.clear('media'); await DB.clear('derived'); Toast.show(t('set.wiped'), { type: 'ok' }); paintStore(); }
            catch { Toast.show(t('set.wipeFail'), { type: 'err' }); }
          } }, ic('trash'), t('set.wipeOk'))));
    };
    paintStore();
    // Tutorial e suggerimenti
    inner.appendChild(h('section', { class: 'settings-sec' }, h('h2', null, t('set.help')),
      h('div', { class: 'row' }, h('div', null, h('b', null, t('set.tour')), h('span', null, t('set.tourHint'))), h('button', { class: 'btn btn-sm', onclick: () => { Prefs.set('tourDone', false); Toast.show(t('set.tourReset'), { type: 'ok' }); } }, ic('sparkle'), t('set.tourBtn'))),
      h('div', { class: 'row' }, h('div', null, h('b', null, t('set.tips')), h('span', null, t('set.tipsHint'))), h('button', { class: 'btn btn-sm', onclick: () => { Tips.reset(); Toast.show(t('set.tipsReset'), { type: 'ok' }); } }, ic('refresh'), t('set.tipsBtn')))));
    inner.appendChild(h('section', { class: 'settings-sec' }, h('h2', null, t('sc.title')), shortcutsEl()));
    return { destroy() { destroyed = true; offCloud(); } };
  });
}

/* ---------------- Aiuto ---------------- */
function HelpView() {
  return shellView('help', (inner) => {
    inner.append(h('div', { class: 'page-head' }, h('div', null, h('h1', null, t('help.title')), h('p', null, t('help.sub')))));
    const faqs = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => h('details', null, h('summary', null, t('hfaq.q' + i), ic('chevDown')), h('p', null, t('hfaq.a' + i))));
    inner.appendChild(h('section', { class: 'settings-sec' }, h('h2', null, t('help.faq')), h('div', { class: 'faq', style: { marginTop: 0 } }, faqs)));
    inner.appendChild(h('section', { class: 'settings-sec' }, h('h2', null, t('sc.title')), h('p', { class: 'hint' }, t('sc.desc')), shortcutsEl()));
    const report = () => [
      'EngimEdit — report tecnico',
      `Data: ${new Date().toISOString()}`,
      `Browser: ${navigator.userAgent}`,
      `Lingua: ${I18N.lang}, tema: ${Theme.pref()}, account: ${Cloud.state}`,
      `WebCodecs: ${'VideoEncoder' in window ? 'sì' : 'no'}, AudioEncoder: ${'AudioEncoder' in window ? 'sì' : 'no'}, MediaRecorder: ${'MediaRecorder' in window ? 'sì' : 'no'}`,
      'Errori recenti:', ...ErrLog.items.map((e) => `- ${e.at} [${e.where}] ${e.msg}`),
    ].join('\n');
    const copy = h('button', { class: 'btn btn-sm', onclick: async () => {
      try { await navigator.clipboard.writeText(report()); Toast.show(t('help.copied'), { type: 'ok' }); }
      catch { await saveFile('engimedit-report.txt', new Blob([report()], { type: 'text/plain' })).catch(() => {}); }
    } }, ic('copy'), t('help.copy'));
    inner.appendChild(h('section', { class: 'settings-sec' }, h('h2', null, t('help.contact')),
      h('div', { class: 'row' }, h('div', null, h('b', null, t('help.write', { email: CONTACT_EMAIL })), h('span', null, t('help.reportHint'))), copy),
      h('p', { class: 'hint' }, t('help.privacy'))));
  });
}

/* ---------------- Pagine legali ---------------- */
function LegalView(kind) {
  const key = { privacy: 'privacy', termini: 'terms', cookie: 'cookie' }[kind];
  const doc = LEGAL[I18N.lang === 'en' ? 'en' : 'it'][key];
  const body = h('article', { class: 'doc' },
    h('a', { class: 'btn btn-ghost btn-sm back', href: '#home' }, ic('arrowLeft'), t('legal.back')),
    h('h1', null, doc.title), h('p', { class: 'upd' }, doc.updated),
    h('div', { class: 'notice', style: { marginBottom: '20px' } }, ic('info'), h('div', null, t('legal.review'))));
  for (const [title, ...paras] of doc.sections) {
    body.appendChild(h('h2', null, title));
    for (const p of paras) {
      if (Array.isArray(p)) body.appendChild(h('ul', null, p.map((li) => h('li', null, li))));
      else body.appendChild(h('p', null, p));
    }
  }
  const foot = h('footer', { class: 'lp-foot' }, h('div', { class: 'lp-wrap' }, h('div', { class: 'in' }, logoEl('#home'),
    h('nav', { 'aria-label': t('nav.footer') }, h('a', { href: '#privacy' }, t('legal.privacy')), h('a', { href: '#termini' }, t('legal.terms')), h('a', { href: '#cookie' }, t('legal.cookie'))))));
  return { el: h('div', { class: 'lp' }, h('main', { id: 'main', tabindex: '-1' }, body), foot) };
}

/* ---------------- 404 ---------------- */
function NotFoundView() {
  return { el: h('main', { class: 'nf', id: 'main', tabindex: '-1' }, h('div', null, h('div', { class: 'code', 'aria-hidden': 'true' }, '404'), h('h1', null, t('nf.title')), h('p', null, t('nf.text')),
    h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' } }, h('a', { class: 'btn btn-primary', href: '#progetti' }, t('nf.projects')), h('a', { class: 'btn btn-outline', href: '#home' }, t('nf.home'))))) };
}
