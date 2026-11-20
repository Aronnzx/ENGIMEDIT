'use strict';
/* =========================================================================
   lib.js — utility condivise: DOM sicuro, formattazione, icone, IndexedDB,
   impostazioni locali, piattaforma (capability del visualizzatore).
   ========================================================================= */

/** Crea un elemento DOM. I testi passano sempre da textContent (niente XSS). */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
      else if (k === 'html') el.innerHTML = v; // usato solo con costanti interne (icone)
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  appendKids(el, children);
  return el;
}
function appendKids(el, kids) {
  for (const c of kids) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) appendKids(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const nextFrame = () => new Promise((res) => requestAnimationFrame(() => res()));

function uid(prefix = '') {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return prefix + Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}
function debounce(fn, ms) {
  let tm = null;
  const d = (...args) => { clearTimeout(tm); tm = setTimeout(() => { tm = null; fn(...args); }, ms); };
  d.flush = (...args) => { if (tm) { clearTimeout(tm); tm = null; fn(...args); } };
  d.cancel = () => { clearTimeout(tm); tm = null; };
  d.pending = () => tm !== null;
  return d;
}

/** Tempo in formato m:ss.cc (o h:mm:ss) — usato in timeline e anteprima. */
function fmtTime(sec, withFrac = true) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const cs = Math.floor((sec * 100) % 100 + 1e-6);
  const s = Math.floor(sec + 1e-6) % 60;
  const m = Math.floor(sec / 60 + 1e-9) % 60;
  const hh = Math.floor(sec / 3600 + 1e-9);
  const p2 = (n) => String(n).padStart(2, '0');
  const base = hh > 0 ? `${hh}:${p2(m)}:${p2(s)}` : `${m}:${p2(s)}`;
  return withFrac ? `${base}.${p2(cs)}` : base;
}
function fmtDur(sec) {
  if (!isFinite(sec)) return '—';
  if (sec < 60) return (Math.round(sec * 10) / 10).toLocaleString(I18N.locale()) + ' s';
  return fmtTime(sec, false);
}
function fmtBytes(b) {
  if (!isFinite(b) || b <= 0) return '0 MB';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return (b >= 100 || i < 2 ? Math.round(b) : Math.round(b * 10) / 10).toLocaleString(I18N.locale()) + ' ' + u[i];
}
function fmtDate(ts) {
  const d = new Date(ts); const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString(I18N.locale(), { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return t('date.today', { time });
  if (d.toDateString() === y.toDateString()) return t('date.yesterday', { time });
  return d.toLocaleDateString(I18N.locale(), { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
function isTyping(e) {
  const el = e.target;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || el.isContentEditable) return true;
  if (tag === 'INPUT') return !['range', 'checkbox', 'radio', 'button'].includes(el.type);
  if (tag === 'SELECT') return true;
  return false;
}
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? '⌘' : 'Ctrl';

/* ---------------------------------------------------------------------------
   Icone (un solo set, tratto 2px, 24×24). Costanti interne, mai input utente.
--------------------------------------------------------------------------- */
const ICONS = {
  logo: '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 2.8 28 9.6v12.8L16 29.2 4 22.4V9.6L16 2.8Z" stroke="url(#eg-grad)" stroke-width="2.4" stroke-linejoin="round"/><path d="M4.6 9.9 16 16.4l11.4-6.5M16 16.4v12.4" stroke="url(#eg-grad)" stroke-width="2.4" stroke-linejoin="round"/></svg>',
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.3l2 2.2h8.7A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-12Z"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none"/>',
  toStart: '<path d="M6 5v14M19 5 9 12l10 7V5Z"/>',
  toEnd: '<path d="M18 5v14M5 5l10 7-10 7V5Z"/>',
  stepBack: '<path d="m15 18-6-6 6-6"/>',
  stepFwd: '<path d="m9 18 6-6-6-6"/>',
  volume: '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  mute: '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m22 9-6 6M16 9l6 6"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M8 11h6"/>',
  fit: '<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/><path d="M8 12h8"/>',
  magnet: '<path d="M6 3v8a6 6 0 0 0 12 0V3"/><path d="M6 7h4M14 7h4M10 3v8a2 2 0 0 0 4 0V3"/>',
  pointer: '<path d="m4 3 7 17 2.5-7.5L21 10 4 3Z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.8-2.5 2.3-2.5 3.8M12 17.2h.01"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 18v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alert: '<path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4.5M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6h.01"/>',
  cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.6 1.5A3.8 3.8 0 0 1 17.5 18.5H7Z"/>',
  cloudOk: '<path d="M7 18.5a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.6 1.5A3.8 3.8 0 0 1 17.5 18.5H7Z"/><path d="m9.5 13.5 2 2 3.5-3.7"/>',
  cloudOff: '<path d="m3 3 18 18"/><path d="M8.5 8.4A4.5 4.5 0 0 0 7 18.5h10.5M19.9 16.6A3.8 3.8 0 0 0 18.1 11 6 6 0 0 0 10.9 6"/>',
  device: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  chevLeft: '<path d="m15 18-6-6 6-6"/>',
  arrowLeft: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  lock: '<rect x="4" y="10.5" width="16" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8S10.5 3.5 8 4.5 9 8 12 8Zm0 0s1.5-4.5 4-3.5S15 8 12 8Z"/>',
  noMark: '<path d="M12 3s6 6.4 6 11a6 6 0 0 1-9.9 4.6M7 13.6C6.3 9.8 12 3 12 3"/><path d="m3 3 18 18"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  move: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14"/>',
  frame: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  wave: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  hdd: '<path d="M22 12H2M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6l3.5-7Z"/><path d="M6 16h.01M10 16h.01"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  youtube: '<rect x="2.5" y="5.5" width="19" height="13" rx="3.5"/><path d="m10 9.2 5 2.8-5 2.8V9.2Z"/>',
  vertical: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/>',
  square: '<rect x="4" y="4" width="16" height="16" rx="2.5"/>',
  portrait: '<rect x="5" y="3" width="14" height="18" rx="2.5"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z"/>',
  feather: '<path d="M20.2 12.2A6 6 0 0 0 11.8 3.8L5 10.6V19h8.4l6.8-6.8Z"/><path d="M16 8 2 22M17.5 15H9"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.7-4.3L3 9M3 4v5h5M4 13a8 8 0 0 0 14.7 4.3L21 15M21 20v-5h-5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  blade: '<path d="M4 20 15 9M14 4l6 6-3 3-6-6 3-3Z"/><path d="M4 20h5"/>',
  slip: '<path d="M4 6v12M20 6v12"/><path d="M8 12h8M10 9l-3 3 3 3M14 9l3 3-3 3"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  type: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  adjust: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" opacity=".5"/>',
  camera: '<path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z"/><circle cx="12" cy="12.5" r="3.5"/>',
  compare: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 3v18"/><path d="M12 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-7Z" fill="currentColor" stroke="none" opacity=".35"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.9-.6-1.3-.6-2.1 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.7 17 3 12 3Z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10.5" cy="7.2" r="1.2" fill="currentColor"/><circle cx="15" cy="7.5" r="1.2" fill="currentColor"/>',
  gauge: '<path d="M4.5 18a9 9 0 1 1 15 0"/><path d="m12 13 4-5"/><circle cx="12" cy="13" r="1.4" fill="currentColor"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Z"/><circle cx="8" cy="8" r="1.5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="m3 3 18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.1 3.9M6.3 6.3C3.6 8 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.7-1.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  clipboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6"/>',
  paste: '<rect x="5" y="4" width="12" height="17" rx="2"/><path d="M8 4V3h6v1"/><path d="M14 13h7M18 10l3 3-3 3"/>',
  flipH: '<path d="M12 3v18"/><path d="M8 7 3 12l5 5V7ZM16 7l5 5-5 5V7Z"/>',
  flipV: '<path d="M3 12h18"/><path d="M7 8l5-5 5 5H7ZM7 16l5 5 5-5H7Z"/>',
};
/** Restituisce una stringa SVG per l'icona richiesta. */
function icon(name, cls = '') {
  if (name === 'logo') return ICONS.logo;
  const body = ICONS[name] || ICONS.info;
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
function ic(name, cls) { const s = document.createElement('span'); s.innerHTML = icon(name, cls); return s.firstChild; }
function logoEl(href) {
  const a = h('a', { class: 'logo', href: href || '#home', 'aria-label': 'EngimEdit' });
  a.innerHTML = ICONS.logo + '<span>ENGIMEDIT</span>';
  return a;
}

/* ---------------------------------------------------------------------------
   Impostazioni locali (piccole preferenze, localStorage protetto da try/catch)
--------------------------------------------------------------------------- */
const Prefs = {
  _mem: {},
  get(k, d) {
    try { const v = localStorage.getItem('engimedit:' + k); return v === null ? (k in this._mem ? this._mem[k] : d) : JSON.parse(v); }
    catch { return k in this._mem ? this._mem[k] : d; }
  },
  set(k, v) {
    this._mem[k] = v;
    try { localStorage.setItem('engimedit:' + k, JSON.stringify(v)); } catch { /* memoria piena o non disponibile: resta in RAM */ }
  },
  del(k) { delete this._mem[k]; try { localStorage.removeItem('engimedit:' + k); } catch {} },
};

/* ---------------------------------------------------------------------------
   IndexedDB: progetti, file video (Blob), dati derivati (miniature, forma d'onda)
--------------------------------------------------------------------------- */
const DB = {
  _p: null,
  open() {
    if (this._p) return this._p;
    this._p = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('no-idb'));
      const req = indexedDB.open('engimedit', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('derived')) db.createObjectStore('derived', { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => reject(req.error || new Error('idb-open'));
      req.onblocked = () => reject(new Error('idb-blocked'));
    });
    this._p.catch(() => { this._p = null; });
    return this._p;
  },
  async _tx(store, mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      let result;
      const tx = db.transaction(store, mode);
      const st = tx.objectStore(store);
      const r = fn(st);
      if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('idb-tx'));
      tx.onabort = () => reject(tx.error || new Error('idb-abort'));
    });
  },
  get(store, key) { return this._tx(store, 'readonly', (s) => s.get(key)); },
  put(store, val) { return this._tx(store, 'readwrite', (s) => s.put(val)); },
  del(store, key) { return this._tx(store, 'readwrite', (s) => s.delete(key)); },
  all(store) { return this._tx(store, 'readonly', (s) => s.getAll()); },
  keys(store) { return this._tx(store, 'readonly', (s) => s.getAllKeys()); },
  clear(store) { return this._tx(store, 'readwrite', (s) => s.clear()); },
};

/* ---------------------------------------------------------------------------
   Piattaforma: capability del visualizzatore claude.ai (db, user, downloads).
   Ogni capability può mancare: l'app funziona sempre in modalità ospite.
--------------------------------------------------------------------------- */
const Platform = {
  async use(name) {
    try {
      if (!window.claude || typeof window.claude.use !== 'function') return null;
      return await window.claude.use(name);
    } catch { return null; }
  },
};

/** Salva un file sul computer: capability "downloads" se presente, altrimenti link classico. */
async function saveFile(filename, blob) {
  const dl = await Platform.use('downloads');
  if (dl) {
    try { await dl.save({ filename, data: blob }); return 'saved'; }
    catch (e) {
      const code = e && e.code;
      if (code === 'declined') return 'declined';
      if (code === 'rate_limited') throw Object.assign(new Error('rate'), { code });
      if (code === 'too_large') throw Object.assign(new Error('too_large'), { code });
      if (!['unavailable', 'not_granted', 'capability_disabled', 'capability_removed'].includes(code)) throw e;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: { display: 'none' } });
  // con una finestra modale aperta il resto della pagina è inerte: il link va dentro la finestra
  (document.querySelector('dialog[open]') || document.body).appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return 'saved';
}

/** Diagnostica degli errori: raccolta locale, mai inviata altrove. */
const ErrLog = {
  items: [],
  add(where, err) {
    const msg = (err && (err.message || err.name)) || String(err);
    this.items.push({ at: new Date().toISOString(), where, msg: String(msg).slice(0, 300) });
    if (this.items.length > 40) this.items.shift();
    console.warn('[EngimEdit]', where, err);
  },
};
window.addEventListener('error', (e) => ErrLog.add('window', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => ErrLog.add('promise', e.reason));
