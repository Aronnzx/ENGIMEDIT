// Build: unisce CSS, libreria mp4-muxer e moduli dell'app in un unico file HTML autosufficiente (dist/index.html).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Ordine di caricamento dei moduli (script classici, nessun bundler necessario)
const order = ['i18n', 'lib', 'engine', 'media', 'render', 'player', 'demux', 'export', 'sample', 'store', 'ui', 'editor', 'timeline', 'inspector', 'exportui', 'views', 'app'];
const app = order.map((n) => `/* ===== ${n}.js ===== */\n` + readFileSync(`src/${n}.js`, 'utf8').replace(/^'use strict';\n/, '')).join('\n');
const appFull = "'use strict';\n" + app.replace(/\nif \(typeof module !== 'undefined'\) module\.exports = Engine;\n/, '\n');
mkdirSync('dist', { recursive: true });
writeFileSync('dist/app.js', appFull);

// mp4-muxer (MIT) viene minificato con esbuild e incluso nel file
const local = process.platform === 'win32' ? 'node_modules/.bin/esbuild.cmd' : 'node_modules/.bin/esbuild';
const args = ['vendor/mp4-muxer.js', '--minify', '--outfile=dist/vendor.min.js', '--log-level=warning'];
if (existsSync(local)) execFileSync(local, args, { stdio: 'inherit', shell: process.platform === 'win32' });
else execFileSync('npx', ['--yes', 'esbuild@0.24.0', ...args], { stdio: 'inherit', shell: process.platform === 'win32' });
const vendor = readFileSync('dist/vendor.min.js', 'utf8').replace(/\n$/, '') + '\nwindow.Mp4Muxer = Mp4Muxer;';

const css = readFileSync('src/styles.css', 'utf8');
let html = readFileSync('src/index.html', 'utf8');
html = html.replace('/*__CSS__*/', () => css).replace('/*__VENDOR__*/', () => vendor).replace('/*__APP__*/', () => appFull);
if (/<\/script>/i.test(appFull)) throw new Error('Il codice contiene </script>: romperebbe il file HTML');
writeFileSync('dist/index.html', html);
console.log('dist/index.html', (html.length / 1024).toFixed(0) + ' KB');
