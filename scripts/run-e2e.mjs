// Esegue tutte le fasi dei test end-to-end in sequenza e riassume il risultato.
import { spawnSync } from 'node:child_process';
const fasi = ['e2e1', 'e2e2', 'exact', 'e2e3', 'e2e4', 'e2e5', 'e2e6', 'e2e7'];
let ok = 0; let ko = 0;
for (const f of fasi) {
  console.log(`\n=== ${f} ===`);
  const r = spawnSync(process.execPath, [`tests/${f}.mjs`], { encoding: 'utf8' });
  process.stdout.write(r.stdout); if (r.status !== 0) process.stdout.write(r.stderr);
  ok += (r.stdout.match(/^ {2}ok /gm) || []).length;
  if (r.status !== 0) ko++;
}
console.log(`\nControlli superati: ${ok}. Fasi fallite: ${ko}.`);
process.exit(ko ? 1 : 0);
