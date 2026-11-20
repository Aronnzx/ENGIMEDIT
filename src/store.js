'use strict';
/* =========================================================================
   store.js — progetti salvati sul dispositivo (IndexedDB) e sincronizzazione
   dei soli METADATI con l'account claude.ai (capability "db", spazio privato
   data/users/<id>). I file video non vengono mai inviati.
   ========================================================================= */
const Cloud = {
  state: 'init',          // init | guest | on | syncing | offline | readonly
  name: '',
  uid: null,
  db: null,
  listeners: new Set(),
  queue: new Map(),        // id progetto → ultimo progetto da inviare
  busy: new Set(),
  lastError: null,

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  set(state) { this.state = state; for (const fn of this.listeners) { try { fn(state); } catch {} } },
  active() { return ['on', 'syncing', 'offline'].includes(this.state); },
  col() { return this.db.collection('data/users/' + this.uid); },
  docId(projectId) { return 'proj-' + projectId; },

  async init() {
    const [db, user] = await Promise.all([Platform.use('db'), Platform.use('user')]);
    if (!db || !user) { this.set('guest'); return; }
    try {
      this.uid = await user.id();
      this.name = (await user.name().catch(() => '')) || '';
    } catch { this.uid = null; }
    if (!this.uid) { this.set('guest'); return; }
    this.db = db;
    this.set('syncing');
    await this.pull();
  },

  /** Unisce i progetti del cloud con quelli locali (vince la modifica più recente). */
  async pull() {
    if (!this.db) return false;
    let snap;
    try {
      snap = await Promise.race([this.col().get(), sleep(12000).then(() => { throw Object.assign(new Error('timeout'), { code: 'unavailable' }); })]);
    } catch (e) { this.lastError = e; this.set(e && e.code === 'revoked' ? 'guest' : 'offline'); return false; }
    this.set('syncing');
    try {
      const local = new Map((await DB.all('projects')).map((p) => [p.id, p]));
      const remoteIds = new Set();
      for (const d of snap.docs) {
        if (!d.id.startsWith('proj-')) continue;
        const body = d.data() || {};
        const id = d.id.slice(5);
        remoteIds.add(id);
        const loc = local.get(id);
        if (body.deleted) {
          if (loc && !loc.deletedAt && (loc.updatedAt || 0) <= (body.updatedAt || 0)) await DB.del('projects', id);
          continue;
        }
        let remote = null;
        try { remote = Engine.migrate(JSON.parse(body.data)); } catch { remote = null; }
        if (!remote) continue;
        if (!loc || (remote.updatedAt || 0) > (loc.updatedAt || 0)) {
          if (loc && loc.thumb) remote.thumb = loc.thumb;
          remote.synced = true;
          await DB.put('projects', remote);
        }
      }
      // Progetti solo locali: li inviamo
      for (const p of local.values()) if (!remoteIds.has(p.id) && !p.deletedAt) this.push(p);
      this.set('on');
      return true;
    } catch (e) { ErrLog.add('cloud-pull', e); this.set('offline'); return false; }
  },

  push(project) {
    if (!this.db || this.state === 'readonly') return;
    this.queue.set(project.id, project);
    this._drain(project.id);
  },
  async _drain(id) {
    if (this.busy.has(id)) return;          // una scrittura per documento alla volta
    this.busy.add(id);
    try {
      while (this.queue.has(id)) {
        const p = this.queue.get(id); this.queue.delete(id);
        const data = JSON.stringify(Engine.toCloud(p));
        if (data.length > 240000) { this.lastError = new Error('too-large'); continue; }
        this.set('syncing');
        try {
          await this.col().doc(this.docId(id)).set({ v: 1, updatedAt: p.updatedAt, name: p.name.slice(0, 80), data });
          this.set('on');
        } catch (e) {
          this.lastError = e;
          if (e && e.code === 'invalid_argument') { this.set('readonly'); break; }
          if (e && e.code === 'revoked') { this.set('guest'); break; }
          this.set('offline');
          await sleep(4000 + Math.random() * 2000);
          if (!this.queue.has(id)) this.queue.set(id, p); // riprova con l'ultima versione
        }
      }
    } finally { this.busy.delete(id); }
  },
  async remove(id) {
    if (!this.db || this.state === 'readonly') return;
    this.queue.delete(id);
    try { await this.col().doc(this.docId(id)).set({ v: 1, deleted: true, updatedAt: Date.now() }); }
    catch (e) { this.lastError = e; }
  },
  async removeAll() {
    if (!this.db) return 0;
    const snap = await this.col().get();
    let n = 0;
    for (const d of snap.docs) if (d.id.startsWith('proj-')) { await this.col().doc(d.id).delete(); n++; }
    return n;
  },
};

const Store = {
  async list() {
    const all = await DB.all('projects');
    return all.filter((p) => !p.deletedAt).map((p) => Engine.migrate(p)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },
  async get(id) {
    const p = await DB.get('projects', id);
    return p && !p.deletedAt ? Engine.migrate(p) : null;
  },
  async save(p) {
    await DB.put('projects', p);
    Cloud.push(p);
  },
  async create(name) {
    const p = Engine.newProject(name, uid('p'), Date.now());
    await this.save(p);
    return p;
  },
  async uniqueName(base) {
    const names = new Set((await this.list()).map((p) => p.name));
    if (!names.has(base)) return base;
    for (let i = 2; i < 500; i++) { const n = `${base} ${i}`; if (!names.has(n)) return n; }
    return base;
  },
  async duplicate(id) {
    const src = await this.get(id);
    if (!src) return null;
    const now = Date.now();
    const copy = { ...JSON.parse(JSON.stringify(src)), id: uid('p'), name: await this.uniqueName(t('proj.copyOf', { name: src.name })), createdAt: now, updatedAt: now, synced: false };
    if (src.thumb) copy.thumb = src.thumb;
    await this.save(copy);
    return copy;
  },
  async rename(id, name) {
    const p = await this.get(id);
    if (!p) return;
    p.name = name.slice(0, 80); p.updatedAt = Date.now();
    await this.save(p);
  },
  /** Eliminazione in due tempi: subito nascosto, definitivo dopo il tempo per annullare. */
  async softDelete(id) {
    const p = await DB.get('projects', id);
    if (!p) return;
    p.deletedAt = Date.now();
    await DB.put('projects', p);
  },
  async restore(id) {
    const p = await DB.get('projects', id);
    if (!p) return;
    delete p.deletedAt;
    await DB.put('projects', p);
  },
  async finalizeDelete(id) {
    const p = await DB.get('projects', id);
    if (!p || !p.deletedAt) return;
    await DB.del('projects', id);
    await Cloud.remove(id);
    await Media.collectGarbage();
  },
  /** All'avvio completa le eliminazioni rimaste in sospeso. */
  async purgePending() {
    try {
      const all = await DB.all('projects');
      for (const p of all) if (p.deletedAt && Date.now() - p.deletedAt > 15000) { await DB.del('projects', p.id); await Cloud.remove(p.id); }
    } catch (e) { ErrLog.add('purge', e); }
  },
  mediaSize(p) { return Object.values(p.assets || {}).reduce((s, a) => s + (a.size || 0), 0); },
  /** Importa un backup .json come NUOVO progetto (nuovo id, nome univoco). I file si ricollegano all'apertura. */
  async importProject(file) {
    const p = await ProjectFile.parse(file);
    const now = Date.now();
    p.id = uid('p');
    p.name = await this.uniqueName(p.name);
    p.createdAt = p.createdAt || now; p.updatedAt = now; p.synced = false;
    delete p.deletedAt;
    await this.save(p);
    return p;
  },
};

/* ---------------------------------------------------------------------------
   Backup del progetto su disco (.json): struttura, tagli, effetti e marker.
   I file video, audio e immagine NON sono inclusi: si ricollegano all'apertura.
--------------------------------------------------------------------------- */
const ProjectFile = {
  MAX: 12 * 1024 * 1024,
  build(p) {
    return JSON.stringify({ app: 'EngimEdit', kind: 'project', schema: Engine.SCHEMA, exportedAt: new Date().toISOString(), project: Engine.toCloud(p), thumb: typeof p.thumb === 'string' && p.thumb.startsWith('data:image/') ? p.thumb : null }, null, 1);
  },
  fileName(p) { return ((p.name || 'progetto').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'progetto') + '.engimedit.json'; },
  download(p) { return saveFile(this.fileName(p), new Blob([this.build(p)], { type: 'application/json' })); },
  /** Legge e valida un backup. Errori: code = 'too-big' | 'invalid'. */
  async parse(file) {
    if (!file || file.size > this.MAX) throw Object.assign(new Error('too-big'), { code: 'too-big' });
    let obj;
    try { obj = JSON.parse(await file.text()); } catch { throw Object.assign(new Error('invalid'), { code: 'invalid' }); }
    const raw = obj && obj.app === 'EngimEdit' && obj.project ? obj.project : obj;
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tracks) || typeof raw.assets !== 'object') throw Object.assign(new Error('invalid'), { code: 'invalid' });
    const p = Engine.migrate(raw);
    if (!p) throw Object.assign(new Error('invalid'), { code: 'invalid' });
    if (obj.thumb && typeof obj.thumb === 'string' && obj.thumb.startsWith('data:image/') && obj.thumb.length < 400000) p.thumb = obj.thumb;
    return p;
  },
};
