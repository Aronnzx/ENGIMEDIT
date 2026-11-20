'use strict';
/* =========================================================================
   exportui.js — finestra di esportazione e procedura "Ritrova i tuoi video"
   ========================================================================= */
const ExportDialog = {
  open(ed) {
    const fmtToPreset = { '16:9': 'youtube', '9:16': 'reels', '4:5': 'insta' };
    const st = {
      preset: fmtToPreset[ed.project.format] || 'hq',
      res: 1080, fps: 30, quality: 'high', format: ed.project.format,
      plan: null, planKey: '', running: false, result: null, ctrl: null,
    };
    const applyPreset = (id) => {
      const p = Exporter.PRESETS.find((x) => x.id === id);
      st.preset = id;
      st.format = p.format || ed.project.format;
      st.res = p.res === 'max' ? Exporter.maxRes(ed.project) : p.res;
      st.fps = p.fps; st.quality = p.quality;
    };
    applyPreset(st.preset);

    const m = modal({ title: t('exp.title'), desc: t('exp.desc'), wide: true, label: 'ex', onClose: () => cleanup() });
    let unloadGuard = null;
    const cleanup = () => {
      if (st.ctrl) st.ctrl.abort();
      if (st.url) URL.revokeObjectURL(st.url);
      if (unloadGuard) window.removeEventListener('beforeunload', unloadGuard);
    };

    /* ---------- passo 1: impostazioni ---------- */
    const showConfig = () => {
      m.setClosable(true);
      m.head.querySelector('h2').textContent = t('exp.title');
      const desc = m.head.querySelector('p'); if (desc) desc.textContent = t('exp.desc');
      m.body.textContent = ''; m.foot.textContent = '';
      const missing = ed.project.tracks.some((tr) => tr.clips.some((c) => c.assetId && (() => { const e = Media.get(c.assetId); return !e || e.status !== 'ready'; })()));
      const prevCanvas = h('canvas', { 'aria-label': t('exp.previewAlt'), role: 'img' });
      const prevBox = h('div', { class: 'exp-prev' }, prevCanvas);
      const summary = h('div', { class: 'sum-line' });
      const notices = h('div', { style: { display: 'grid', gap: '10px' } });
      const presets = h('div', { class: 'presets', role: 'radiogroup', 'aria-label': t('exp.presets') });
      const resSel = h('select', { class: 'select', 'aria-label': t('exp.res') });
      const fpsSel = h('select', { class: 'select', 'aria-label': t('exp.fps') });
      const qSel = h('select', { class: 'select', 'aria-label': t('exp.quality') });
      for (const r of [720, 1080, 1440, 2160]) resSel.appendChild(h('option', { value: r }, r === 2160 ? '2160p (4K)' : r + 'p'));
      for (const f of [24, 25, 30, 50, 60]) fpsSel.appendChild(h('option', { value: f }, f + ' fps'));
      for (const q of ['low', 'medium', 'high', 'max']) qSel.appendChild(h('option', { value: q }, t('exp.q.' + q)));
      const adv = h('details', { class: 'adv' }, h('summary', null, t('exp.advanced')),
        h('div', { class: 'grid3' },
          h('label', { class: 'field' }, h('span', { class: 'label' }, t('exp.res')), resSel),
          h('label', { class: 'field' }, h('span', { class: 'label' }, t('exp.fps')), fpsSel),
          h('label', { class: 'field' }, h('span', { class: 'label' }, t('exp.quality')), qSel)));
      const go = h('button', { class: 'btn btn-primary', onclick: () => start() }, ic('download'), t('exp.start'));
      m.foot.append(h('button', { class: 'btn btn-ghost', onclick: () => m.close() }, t('common.cancel')), go);

      const renderPresets = () => {
        presets.textContent = '';
        for (const p of Exporter.PRESETS) {
          const f = p.format || ed.project.format;
          const res = p.res === 'max' ? Exporter.maxRes(ed.project) : p.res;
          const d = Exporter.dims(f, res);
          const b = h('button', { class: 'preset', role: 'radio', 'aria-checked': String(st.preset === p.id) },
            h('span', { class: 'pi' }, ic(p.icon), st.preset === p.id ? h('span', { class: 'badge' }, t('exp.chosen')) : null),
            h('b', null, t('exp.p.' + p.id)), h('span', null, `${f}, ${d.w}×${d.h}`));
          b.addEventListener('click', () => { applyPreset(p.id); syncAdv(); renderPresets(); update(); });
          presets.appendChild(b);
        }
      };
      const syncAdv = () => { resSel.value = String(st.res); fpsSel.value = String(st.fps); qSel.value = st.quality; };
      const onAdv = () => { st.res = +resSel.value; st.fps = +fpsSel.value; st.quality = qSel.value; st.preset = 'custom'; renderPresets(); update(); };
      resSel.addEventListener('change', onAdv); fpsSel.addEventListener('change', onAdv); qSel.addEventListener('change', onAdv);
      syncAdv();

      const drawPreview = () => {
        const f = Engine.FORMATS[st.format];
        const W = f.w >= f.h ? 220 : Math.round((220 * f.w) / f.h); const H = f.w >= f.h ? Math.round((220 * f.h) / f.w) : 220;
        prevCanvas.width = W * 2; prevCanvas.height = H * 2; prevCanvas.style.width = W + 'px'; prevCanvas.style.height = H + 'px';
        const g = prevCanvas.getContext('2d');
        // stesso formato del progetto: l'anteprima composta (colore, titoli, bande nere) così com'è
        if (st.format === ed.project.format) { g.fillStyle = '#000'; g.fillRect(0, 0, W * 2, H * 2); g.drawImage(ed.canvas, 0, 0, W * 2, H * 2); return; }
        const loc = Engine.locate(ed.clips, ed.t);
        if (!loc) return;
        const p = ed.player.vp[ed.player.active];
        if (p.assetId === loc.clip.assetId && p.el.readyState >= 2) drawFrame(g, W * 2, H * 2, p.el, p.el.videoWidth, p.el.videoHeight, loc.clip);
        else { const e = Media.get(loc.clip.assetId); const th = e && (e.image || e.thumbs[0]); drawFrame(g, W * 2, H * 2, th, th && th.width, th && th.height, loc.clip); }
      };
      const update = async () => {
        const d = Exporter.dims(st.format, st.res);
        const vbr = Exporter.bitrate(d.w, d.h, st.fps, st.quality);
        const needAudio = Exporter.needsAudio(ed.project) || ed.project.tracks.some((tr) => tr.clips.some((c) => { const e = c.assetId ? Media.get(c.assetId) : null; return e && e.audioState === 'pending' && !c.muted; }));
        const key = `${d.w}x${d.h}@${st.fps}:${vbr}:${needAudio}`;
        drawPreview();
        summary.textContent = '';
        const item = (k, v) => h('span', null, k + ' ', h('b', { class: 'tnum' }, v));
        summary.append(item(t('exp.sumFormat'), st.format), item(t('exp.sumRes'), `${d.w}×${d.h}`), item(t('exp.sumDur'), fmtDur(ed.total)), item(t('exp.sumSize'), '≈ ' + fmtBytes(Exporter.estimateSize(ed.total, vbr, needAudio))));
        go.disabled = true;
        if (st.planKey !== key) { st.planKey = key; st.plan = null; st.plan = await Exporter.plan(d.w, d.h, st.fps, vbr, needAudio); }
        if (st.planKey !== key) return;
        notices.textContent = '';
        if (missing) {
          notices.appendChild(h('div', { class: 'notice err' }, ic('link'), h('div', null, t('exp.missing'), h('div', null, h('button', { class: 'btn btn-sm btn-outline', style: { marginTop: '8px' }, onclick: () => { m.close(); ed.openRelink(); } }, t('relink.cta'))))));
        }
        if (!st.plan) notices.appendChild(h('div', { class: 'notice err' }, ic('alert'), h('div', null, t('exp.unsupported'))));
        else {
          summary.append(item(t('exp.sumFile'), st.plan.label));
          if (st.format !== ed.project.format) notices.appendChild(h('div', { class: 'notice' }, ic('info'), h('div', null, t('exp.formatChange', { from: ed.project.format, to: st.format }))));
          if (st.plan.opusWarn) notices.appendChild(h('div', { class: 'notice' }, ic('info'), h('div', null, t('exp.opus'))));
          if (st.plan.realtime) notices.appendChild(h('div', { class: 'notice' }, ic('clock'), h('div', null, t('exp.realtime', { d: fmtDur(ed.total) }))));
        }
        go.disabled = !st.plan || missing;
        go.lastChild.textContent = st.format !== ed.project.format ? t('exp.startFormat', { f: st.format }) : t('exp.start');
      };
      renderPresets();
      m.body.append(h('div', { class: 'exp-grid' }, h('div', { style: { display: 'grid', gap: '12px' } }, prevBox, summary), h('div', { style: { display: 'grid', gap: '14px', alignContent: 'start' } }, presets, notices, adv)));
      update();
      setTimeout(() => { const c = presets.querySelector('[aria-checked="true"]'); if (c) c.focus(); }, 40);
    };

    /* ---------- passo 2: avanzamento ---------- */
    const start = async () => {
      if (st.running || !st.plan) return;
      if (st.format !== ed.project.format) ed.setFormat(st.format);
      const d = Exporter.dims(st.format, st.res);
      const vbr = Exporter.bitrate(d.w, d.h, st.fps, st.quality);
      st.running = true; st.ctrl = new AbortController();
      m.setClosable(false);
      unloadGuard = (e) => { e.preventDefault(); e.returnValue = ''; };
      window.addEventListener('beforeunload', unloadGuard);
      m.head.querySelector('h2').textContent = t('exp.running');
      const desc = m.head.querySelector('p'); if (desc) desc.textContent = t('exp.keepOpen');
      m.body.textContent = ''; m.foot.textContent = '';
      const names = ['prepare', 'video', 'audio', 'final'];
      const rows = names.map((n) => h('div', null, h('span', { html: icon('clock') }), t('exp.stage.' + n)));
      const bar = h('span'); const pct = h('b', { class: 'tnum' }, '0%'); const eta = h('span', { class: 'muted tnum' });
      const paused = h('div', { class: 'notice warn hidden' }, ic('alert'), h('div', null, t('exp.paused')));
      m.body.append(h('div', { class: 'stages' }, rows), h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, bar), h('div', { class: 'sum-line' }, pct, eta), paused);
      const cancel = h('button', { class: 'btn btn-outline', onclick: () => { st.ctrl.abort(); } }, t('exp.cancel'));
      m.foot.append(cancel);
      let cur = -1;
      const setStage = (name) => {
        const i = names.indexOf(name);
        rows.forEach((r, j) => {
          r.className = j < i ? 'done' : j === i ? 'on' : '';
          r.firstChild.innerHTML = j < i ? icon('checkCircle') : j === i ? '<span class="spinner" style="width:16px;height:16px"></span>' : icon('clock');
        });
        cur = i;
        if (name === 'final' || name === 'audio') { bar.style.width = name === 'final' ? '99%' : '96%'; }
      };
      const progress = (f, info) => {
        const p = Math.min(95, Math.round(f * 95));
        bar.style.width = p + '%'; bar.parentElement.setAttribute('aria-valuenow', String(p));
        pct.textContent = p + '%';
        eta.textContent = info && info.eta != null && isFinite(info.eta) ? t('exp.eta', { s: fmtDur(Math.max(1, Math.round(info.eta))) }) : '';
      };
      try {
        const res = await Exporter.run({ project: ed.project, clips: ed.clips, assets: ed.project.assets, W: d.w, H: d.h, fps: st.fps, vbr, plan: st.plan }, { stage: setStage, progress, signal: st.ctrl.signal, paused: (v) => paused.classList.toggle('hidden', !v) });
        if (st.ctrl.signal.aborted) throw new ExportAbort();
        st.result = res;
        showDone();
      } catch (e) {
        if (e && e.code === 'abort') { Toast.show(t('exp.aborted'), { duration: 3000 }); st.running = false; showConfig(); }
        else { ErrLog.add('export', e); showError(e); }
      } finally {
        st.running = false; st.ctrl = null;
        window.removeEventListener('beforeunload', unloadGuard); unloadGuard = null;
        m.setClosable(true);
      }
    };

    /* ---------- passo 3: fatto ---------- */
    const showDone = () => {
      const r = st.result;
      m.head.querySelector('h2').textContent = t('exp.doneTitle');
      const desc = m.head.querySelector('p'); if (desc) desc.textContent = t('exp.doneDesc');
      m.body.textContent = ''; m.foot.textContent = '';
      if (st.url) URL.revokeObjectURL(st.url);
      st.url = URL.createObjectURL(r.blob);
      const vid = h('video', { class: 'result-video', controls: true, src: st.url, playsinline: true, 'aria-label': t('exp.resultAlt') });
      const safe = (ed.project.name || 'video').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'video';
      const name = h('input', { class: 'input', value: safe, maxlength: 100, 'aria-label': t('exp.fileName') });
      const ext = h('span', { class: 'badge' }, '.' + r.ext);
      m.body.append(vid,
        h('label', { class: 'field' }, h('span', { class: 'label' }, t('exp.fileName')), h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, name, ext)),
        h('div', { class: 'sum-line' }, h('span', null, h('b', null, r.label)), h('span', { class: 'tnum' }, `${r.W}×${r.H}`), h('span', { class: 'tnum' }, fmtBytes(r.blob.size)), h('span', { class: 'tnum' }, fmtDur(r.duration))));
      const dl = h('button', { class: 'btn btn-primary' }, ic('download'), t('exp.download'));
      dl.addEventListener('click', async () => {
        const base = name.value.replace(/[\\/:*?"<>|]+/g, ' ').trim();
        if (!base) { name.setAttribute('aria-invalid', 'true'); name.focus(); return; }
        name.removeAttribute('aria-invalid');
        dl.disabled = true;
        try {
          const res = await saveFile(`${base}.${r.ext}`, r.blob);
          if (res === 'saved') Toast.show(t('exp.saved'), { type: 'ok' });
        } catch (e) {
          Toast.show(e && e.code === 'rate_limited' ? t('exp.rate') : t('exp.saveFail'), { type: 'err', duration: 6000 });
        } finally { dl.disabled = false; }
      });
      m.foot.append(h('button', { class: 'btn btn-ghost', onclick: () => m.close() }, t('exp.back')), dl);
      setTimeout(() => dl.focus(), 30);
    };

    /* ---------- errore ---------- */
    const showError = (e) => {
      m.head.querySelector('h2').textContent = t('exp.errTitle');
      const desc = m.head.querySelector('p'); if (desc) desc.textContent = '';
      m.body.textContent = ''; m.foot.textContent = '';
      const mem = e instanceof RangeError || /memory|allocation/i.test((e && e.message) || '');
      m.body.append(h('div', { class: 'notice err' }, ic('alert'), h('div', null, mem ? t('exp.errMem') : t('exp.errGeneric'))));
      m.foot.append(h('button', { class: 'btn btn-ghost', onclick: () => m.close() }, t('exp.back')),
        h('button', { class: 'btn btn-primary', onclick: () => { applyPreset('light'); st.planKey = ''; showConfig(); } }, ic('feather'), t('exp.retryLight')));
    };

    showConfig();
  },
};

const RelinkDialog = {
  open(ed) {
    const missing = () => ed.missingAssets();
    if (!missing().length) { Toast.show(t('relink.none'), { type: 'ok', duration: 2500 }); return; }
    const input = h('input', { type: 'file', multiple: true, accept: MEDIA_ACCEPT, class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true' });
    const list = h('div', { style: { display: 'grid', gap: '8px' } });
    const all = Object.values(ed.project.assets).filter((a) => { const e = Media.get(a.id); return e && e.status === 'missing'; });
    const done = new Set();
    const render = () => {
      list.textContent = '';
      for (const a of all) {
        const ok = done.has(a.id);
        list.appendChild(h('div', { class: 'notice' + (ok ? '' : ' warn') }, ic(ok ? 'checkCircle' : 'film'),
          h('div', { style: { minWidth: 0 } }, h('b', { style: { display: 'block', wordBreak: 'break-word' } }, a.name), h('span', { class: 'hint' }, (a.kind === 'image' ? `${a.width}×${a.height}` : fmtDur(a.duration)) + `, ${fmtBytes(a.size)}`)),
          h('span', { class: 'badge ' + (ok ? 'ok' : 'warn'), style: { marginLeft: 'auto' } }, ok ? t('relink.ok') : t('relink.todo'))));
      }
      pick.classList.toggle('hidden', all.every((a) => done.has(a.id)));
      fin.textContent = all.every((a) => done.has(a.id)) ? t('relink.done') : t('relink.later');
    };
    const pick = h('button', { class: 'btn btn-primary', onclick: () => input.click() }, ic('search'), t('relink.pick'));
    const fin = h('button', { class: 'btn btn-ghost', onclick: () => m.close() }, t('relink.later'));
    input.addEventListener('change', async () => {
      const files = [...input.files]; input.value = '';
      pick.disabled = true;
      let matched = 0;
      for (const f of files) {
        try {
          let best = null; let bs = 0;
          for (const a of all) {
            if (done.has(a.id)) continue;
            const sc = await Media.matchScore(a, f);
            if (sc > bs) { bs = sc; best = a; }
          }
          if (best && bs >= 3) { await Media.relink(best, f); done.add(best.id); matched++; render(); }
          else Toast.show(t('relink.noMatch', { name: f.name }), { type: 'err', duration: 6000 });
        } catch (e) {
          ErrLog.add('relink', e);
          Toast.show(e instanceof MediaError2 ? Media.errorText(e, f.name) : t('relink.noMatch', { name: f.name }), { type: 'err', duration: 7000 });
        }
      }
      pick.disabled = false;
      if (matched) { ed.renderLib(); ed.renderTimeline(); ed.player.invalidate(); }
      render();
    });
    const m = modal({
      title: t('relink.title'), desc: t('relink.desc'), label: 'rl',
      body: h('div', { style: { display: 'grid', gap: '12px' } }, list, h('p', { class: 'hint' }, t('relink.how')), input),
      foot: [fin, pick],
    });
    render();
  },
};
