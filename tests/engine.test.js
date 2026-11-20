// Test unitari del motore: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');

const A = { id: 'a1', duration: 10 };
const B = { id: 'a2', duration: 6 };
const mk = () => [E.clipFromAsset(A, 'c1'), E.clipFromAsset(B, 'c2')];

test('layout e durata totale', () => {
  const clips = mk();
  assert.equal(E.total(clips), 16);
  const L = E.layout(clips);
  assert.deepEqual(L.map((x) => [x.start, x.end]), [[0, 10], [10, 16]]);
  assert.equal(E.startOf(clips, 'c2'), 10);
});

test('locate: dentro, al confine e oltre la fine', () => {
  const clips = mk();
  assert.equal(E.locate(clips, 0).index, 0);
  assert.equal(E.locate(clips, 9.99).index, 0);
  assert.equal(E.locate(clips, 10).index, 1);
  const end = E.locate(clips, 30);
  assert.equal(end.index, 1); assert.equal(end.atEnd, true);
  assert.equal(E.locate([], 1), null);
});

test('split al cursore crea due clip contigue', () => {
  const r = E.split(mk(), 4, 'c3');
  assert.equal(r.clips.length, 3);
  assert.deepEqual([r.clips[0].in, r.clips[0].out], [0, 4]);
  assert.deepEqual([r.clips[1].id, r.clips[1].in, r.clips[1].out], ['c3', 4, 10]);
  assert.equal(E.total(r.clips), 16);
});

test('split rifiutato vicino ai bordi o oltre la fine', () => {
  assert.equal(E.split(mk(), 0.05, 'x').error, 'edge');
  assert.equal(E.split(mk(), 9.95, 'x').error, 'edge');
  assert.equal(E.split(mk(), 20, 'x').error, 'no-clip');
});

test('split della seconda clip usa il tempo sorgente corretto', () => {
  const clips = E.trim(mk(), 'c2', 'in', 1, 6); // c2: 1..6 → dura 5
  const r = E.split(clips, 12, 'c4');            // 2 s dentro c2 → sorgente 3
  assert.equal(r.clips[1].out, 3);
  assert.equal(r.clips[2].in, 3);
});

test('trim con limiti e ripple', () => {
  let clips = E.trim(mk(), 'c1', 'in', 2, 10);
  assert.equal(clips[0].in, 2);
  assert.equal(E.total(clips), 14); // ripple: niente buchi
  clips = E.trim(clips, 'c1', 'out', 50, 10);
  assert.equal(clips, null, 'out già al massimo: nessuna modifica');
  clips = E.trim(mk(), 'c1', 'out', 0, 10);
  assert.equal(clips[0].out, 0.1, 'durata minima rispettata');
  clips = E.trim(mk(), 'c1', 'in', -5, 10);
  assert.equal(clips, null, 'in non può andare sotto zero');
});

test('remove con ripple', () => {
  const r = E.remove(mk(), ['c1']);
  assert.equal(r.length, 1); assert.equal(E.total(r), 6);
  assert.equal(E.remove(mk(), ['zz']), null);
});

test('duplicate inserisce la copia subito dopo', () => {
  let n = 0;
  const r = E.duplicate(mk(), ['c1'], () => 'd' + (++n));
  assert.deepEqual(r.clips.map((c) => c.id), ['c1', 'd1', 'c2']);
  assert.deepEqual(r.newIds, ['d1']);
});

test('move: riordino singolo e multiplo', () => {
  const three = [...mk(), E.clipFromAsset(A, 'c3')];
  assert.deepEqual(E.move(three, ['c1'], 3).map((c) => c.id), ['c2', 'c3', 'c1']);
  assert.deepEqual(E.move(three, ['c3'], 0).map((c) => c.id), ['c3', 'c1', 'c2']);
  assert.deepEqual(E.move(three, ['c1', 'c3'], 2).map((c) => c.id), ['c2', 'c1', 'c3']);
  assert.equal(E.move(three, ['c2'], 1), null, 'stessa posizione: nessuna modifica');
  assert.equal(E.move(three, ['c2'], 2), null, 'stessa posizione (dopo): nessuna modifica');
});

test('gapAt sceglie lo spazio più vicino', () => {
  const clips = mk();
  assert.equal(E.gapAt(clips, 1), 0);
  assert.equal(E.gapAt(clips, 6), 1);
  assert.equal(E.gapAt(clips, 14), 2);
});

test('patch modifica solo se cambia qualcosa', () => {
  const r = E.patch(mk(), ['c1'], { volume: 0.5 });
  assert.equal(r[0].volume, 0.5);
  assert.equal(E.patch(r, ['c1'], { volume: 0.5 }), null);
});

test('snap aggancia entro la soglia', () => {
  assert.equal(E.snap(4.96, [5, 10], 0.1), 5);
  assert.equal(E.snap(4.5, [5, 10], 0.1), 4.5);
});

test('cronologia: annulla e ripeti', () => {
  const H = E.createHistory();
  const s0 = { clips: mk() }; const s1 = { clips: E.remove(s0.clips, ['c1']) };
  H.push('Elimina', s0);
  assert.ok(H.canUndo());
  const u = H.undo(s1);
  assert.equal(u.state, s0); assert.ok(H.canRedo());
  const r = H.redo(s0);
  assert.equal(r.state, s1);
  H.push('Altro', s1);
  assert.equal(H.canRedo(), false, 'una nuova azione azzera i ripeti');
});

test('immutabilità: le operazioni non modificano l\'input', () => {
  const clips = mk(); const snap = JSON.stringify(clips);
  E.split(clips, 3, 'x'); E.trim(clips, 'c1', 'in', 2, 10); E.remove(clips, ['c1']);
  E.duplicate(clips, ['c1'], () => 'y'); E.move(clips, ['c1'], 2); E.patch(clips, ['c1'], { muted: true });
  assert.equal(JSON.stringify(clips), snap);
});

test('migrate ripara progetti incompleti e rimuove clip orfane', () => {
  const p = E.migrate({ id: 'p', name: '', assets: { a1: A }, tracks: [{ id: 'v1', clips: [{ id: 'c', assetId: 'a1', in: 0, out: 3 }, { id: 'o', assetId: 'nope', in: 0, out: 1 }] }] });
  assert.equal(p.format, '16:9');
  assert.equal(p.tracks[0].clips.length, 1);
  assert.equal(p.tracks[0].clips[0].volume, 1);
  assert.equal(p.name, 'Progetto');
});

test('toCloud esclude la miniatura', () => {
  const p = E.newProject('X', 'p1', 1); p.thumb = 'data:...';
  assert.equal('thumb' in E.toCloud(p), false);
});

/* ---------------- Schema 2: multitraccia, attributi, migrazione ---------------- */
const IMG = { id: 'i1', kind: 'image', duration: 5, width: 100, height: 100 };
const SND = { id: 's1', kind: 'audio', duration: 20 };
const free = (id, start, len) => ({ ...E.clipFromAsset(IMG, id), start, out: len });

test('migrate da schema 1 a 2: tre tracce, impostazioni e nessuna perdita di dati', () => {
  const old = { id: 'p', name: 'Vecchio', schema: 1, format: '9:16', assets: { a1: { id: 'a1', duration: 10 } }, settings: { snapping: false },
    tracks: [{ id: 'v1', kind: 'video', clips: [{ id: 'c', assetId: 'a1', in: 1, out: 4, volume: 0.5, muted: true, speed: 1, fit: 'fill', ox: 0.3, oy: -0.2 }] }] };
  const p = E.migrate(old);
  assert.equal(p.schema, E.SCHEMA);
  assert.deepEqual(p.tracks.map((t) => t.id), ['v1', 'v2', 'a1']);
  const c = p.tracks[0].clips[0];
  assert.deepEqual([c.in, c.out, c.volume, c.muted, c.fit, c.ox, c.oy], [1, 4, 0.5, true, 'fill', 0.3, -0.2]);
  assert.equal(p.assets.a1.kind, 'video');
  assert.equal(p.settings.snapping, false, 'impostazione esistente conservata');
  assert.equal(p.settings.scaling, 'fit'); assert.equal(p.settings.imageDur, 5); assert.equal(p.settings.blanking, 'none');
  assert.deepEqual(p.markers, []);
  assert.deepEqual(E.migrate(p), p, 'migrare due volte non cambia nulla');
});

test('migrate scarta valori non validi e clip incompatibili con la traccia', () => {
  const p = E.migrate({ id: 'p', name: 'x', assets: { i1: IMG, s1: SND },
    tracks: [{ id: 'v1', clips: [{ id: 'a', assetId: 's1', in: 0, out: 2 }] }, { id: 'v2', clips: [{ id: 't', kind: 'text', in: 0, out: 3, start: 2, comp: { blend: 'boh', opacity: 0.5 } }] }, { id: 'a1', clips: [{ id: 'b', assetId: 's1', in: 0, out: 2, start: 1, audio: { eq: 'x', fadeIn: 1 } }] }],
    markers: [{ t: 3, color: 'nope' }, { t: 'x' }] });
  assert.equal(p.tracks[0].clips.length, 0, 'un file audio non può stare in V1');
  assert.equal(p.tracks[1].clips[0].comp.blend, 'normal');
  assert.equal(p.tracks[1].clips[0].comp.opacity, 0.5);
  assert.equal(p.tracks[2].clips[0].audio.eq, 'neutral');
  assert.equal(p.tracks[2].clips[0].audio.fadeIn, 1);
  assert.equal(p.markers.length, 1); assert.equal(p.markers[0].color, 'violet');
});

test('tracce libere: inserimento senza sovrapposizioni, spostamento e totale', () => {
  let v2 = E.insertFree([], free('x', 0, 3));
  v2 = E.insertFree(v2, free('y', 1, 2));
  assert.deepEqual(v2.map((c) => [c.id, c.start]), [['x', 0], ['y', 3]], 'y spinta dopo x');
  assert.equal(E.freeTotal(v2), 5);
  assert.equal(E.moveFree(v2, ['y'], -1), null, 'sovrapposizione rifiutata');
  const m = E.moveFree(v2, ['y'], 2);
  assert.equal(m.find((c) => c.id === 'y').start, 5);
  assert.equal(E.freeAt(m, 5.5).clip.id, 'y');
  assert.equal(E.freeAt(m, 4), null);
  assert.equal(E.projectTotal([{ id: 'v1', clips: mk() }, { id: 'v2', clips: m }]), 16);
  assert.equal(E.projectTotal([{ id: 'v1', clips: [] }, { id: 'a1', clips: [{ ...E.clipFromAsset(SND, 'a'), start: 30 }] }]), 50);
});

test('tracce libere: taglio con limiti dei vicini, divisione e slip', () => {
  const clips = [{ ...E.clipFromAsset(SND, 'a'), start: 0, in: 2, out: 6 }, { ...E.clipFromAsset(SND, 'b'), start: 6, in: 0, out: 4 }];
  const t1 = E.trimFree(clips, 'a', 'out', 15, 20);
  assert.equal(t1[0].out, 8, 'si ferma all\'inizio della clip successiva');
  assert.equal(E.trimFree(clips, 'a', 'in', 0, 20), null, 'in limitato dal bordo sinistro della timeline');
  const t2 = E.trimFree([{ ...clips[0], start: 1 }], 'a', 'in', 0, 20);
  assert.deepEqual([t2[0].in, t2[0].start], [1, 0], 'si allunga a sinistra solo fino a 0');
  const t3 = E.trimFree(clips, 'b', 'in', 1, 20);
  assert.deepEqual([t3[1].in, t3[1].start, E.endOf(t3[1])], [1, 7, 10], 'il bordo destro resta fermo');
  const s = E.splitFree(clips, 'b', 8, 'c');
  assert.deepEqual(s.clips.map((c) => [c.id, c.start, c.in, c.out]), [['a', 0, 2, 6], ['b', 6, 0, 2], ['c', 8, 2, 4]]);
  const sl = E.slip(clips, 'a', 10, 20);
  assert.deepEqual([sl[0].in, sl[0].out, E.dur(sl[0])], [10, 14, 4], 'slip mantiene la durata');
  assert.equal(E.slip(clips, 'a', 30, 20)[0].out, 20, 'slip limitato alla fine della sorgente');
});

test('patch dei gruppi unisce i valori e conserva i predefiniti', () => {
  const r = E.patch(mk(), ['c1'], { tf: { rot: 90 } });
  assert.equal(r[0].tf.rot, 90); assert.equal(r[0].tf.zx, 1);
  assert.equal(E.patch(r, ['c1'], { tf: { rot: 90 } }), null);
  assert.equal(E.patch(mk(), ['c1'], { color: { sat: 0 } }), null, 'valore uguale al predefinito: nessuna modifica');
  assert.equal(E.colorOn(r[0]), false);
  const c = E.patch(mk(), ['c1'], { color: { sat: 0.5 } });
  assert.equal(E.colorOn(c[0]), true);
});

test('copia e incolla attributi per gruppi', () => {
  const src = { ...E.clipFromAsset(A, 's'), speed: 2, volume: 0.3, tf: { ...E.DEF.tf, rot: 45 }, color: { ...E.DEF.color, gain: 0.4 } };
  const attrs = E.pickAttrs(src);
  const r = E.pasteAttrs(mk(), ['c1', 'c2'], attrs, ['transform', 'color']);
  assert.equal(r[0].tf.rot, 45); assert.equal(r[1].color.gain, 0.4);
  assert.equal(r[0].speed, 1, 'velocità non scelta: invariata'); assert.equal(r[0].volume, 1);
  const r2 = E.pasteAttrs(mk(), ['c1'], attrs, ['speed', 'volume'], () => true);
  assert.equal(r2[0].speed, 2); assert.equal(r2[0].volume, 0.3);
  assert.equal(E.pasteAttrs(mk(), ['c1'], E.pickAttrs(mk()[0]), ['transform']), null, 'stessi valori: nessuna modifica');
});

test('dissolvenze audio e zoom dinamico', () => {
  const c = { ...E.clipFromAsset(A, 'c'), volume: 0.8, audio: { fadeIn: 2, fadeOut: 4, eq: 'voice' } };
  assert.equal(E.gainAt(c, 0), 0); assert.equal(E.gainAt(c, 1), 0.4); assert.equal(E.gainAt(c, 5), 0.8); assert.equal(E.gainAt(c, 10), 0);
  assert.deepEqual(E.gainPoints(c), [0, 2, 6, 10]);
  const z = { ...E.clipFromAsset(A, 'z'), dz: { mode: 'in', amt: 0.2 } };
  assert.equal(E.dzScale(z, 0), 1); assert.equal(E.dzScale(z, 10), 1.2); assert.equal(E.dzScale({ ...z, dz: { mode: 'out', amt: 0.2 } }, 10), 1);
  assert.equal(E.dzScale(mk()[0], 5), 1);
});
