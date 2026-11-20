# Test

I risultati completi dell'ultima esecuzione sono in [`risultati-test.txt`](risultati-test.txt). I test sono stati eseguiti con Chromium (Playwright) e Node 22.

## Come eseguirli

```bash
npm install
npx playwright install chromium
npm test              # test unitari
npm run test:e2e      # test end-to-end: richiedono ffmpeg e ffprobe nel PATH
```

I test end-to-end avviano da soli un piccolo server su `dist/`. Per provarli contro un altro indirizzo si imposta `ENGIMEDIT_URL`, ad esempio `ENGIMEDIT_URL=https://.../index.html npm run test:e2e`.

## Video di prova (`testmedia/`)

Sono generati con ffmpeg (`npm run media`), quindi non hanno diritti di terzi.

| File | Scopo |
|---|---|
| `Paesaggio.mp4` | 1280×720, 30 fps, H.264 con B-frame e audio AAC |
| `Verticale.mp4` | 720×1280, per i formati verticali |
| `Barre.webm` | VP9 + Opus a 25 fps, per la via di esportazione alternativa |
| `Muto.mp4` | senza traccia audio |
| `Contatore.mp4`, `Conta30.mp4`, `Conta25.mp4`, `Conta30.webm` | **video contatore**: la luminosità di ogni fotogramma vale 4 × il suo numero, così si può verificare l'esportazione fotogramma per fotogramma |
| `Foto.png`, `Musica.mp3`, `Voce.wav` | immagine e audio per Media Pool, traccia V2 e traccia A1 |
| `Rotto.mp4`, `appunti.txt` | file danneggiato e file che non è un video |

## Cosa viene verificato

**Test unitari (`tests/engine.test.js`, 23 test).** Riguardano il motore di montaggio senza interfaccia: posizioni e durate, divisione (anche vicino ai bordi e sulla seconda clip), taglio con limiti e ripple, eliminazione, duplicazione, riordino singolo e multiplo, aggancio, annulla/ripeti, immutabilità dei dati, esclusione della miniatura dal cloud. Per lo schema 2: migrazione da schema 1 senza perdita di dati (e idempotente), scarto dei valori non validi, tracce libere (inserimento senza sovrapposizioni, spostamento, taglio limitato dai vicini, divisione, slip), unione dei gruppi di proprietà, copia/incolla attributi per gruppi, dissolvenze e zoom dinamico.

**Fase 1, `e2e1`: pagine e importazione.** Landing, dashboard vuota e tutorial (avanti, indietro, salta). Importazione di 6 file insieme: i 4 validi entrano in libreria, il file danneggiato e il file di testo ricevono un messaggio chiaro. Vengono controllati anche i metadati letti (risoluzione, fps) e il badge "Senza audio".

**Fase 2, `e2e2`: montaggio completo (32 controlli).**
- Aggiunta con + e con trascinamento; clic sulla clip che sposta il cursore; divisione con S.
- Taglio della fine e dell'inizio trascinando i bordi; Ctrl+Z e Ctrl+Maiusc+Z.
- Riordino con indicatore di inserimento, Alt+→, Ctrl+D, Canc e "Annulla" dal messaggio, menu col tasto destro.
- Riproduzione, con controllo che l'anteprima mostri davvero immagini e che passi correttamente da una clip all'altra.
- Formato 9:16 e Riempi, zoom, aggancio, cronologia, rinomina.
- Ricaricamento della pagina: timeline, formato e video identici.

**`exact`: esportazione fotogramma per fotogramma.** I video contatore vengono esportati con tagli che non cadono su fotogrammi interi, a 30 fps da sorgenti a 30 e 25 fps, con B-frame e con un WebM. Risultato: **150 fotogrammi su 150 esatti**, compresi i confini tra le clip. Per i file MP4 l'esportazione è più veloce del tempo reale: circa 2 secondi per 5 secondi di video.

**Fase 3, `e2e3`: esportazione dall'interfaccia (17 controlli).** Il percorso è: preset, file leggero, avanzamento, risultato e download con il nome scelto. Il file viene poi analizzato con ffprobe e ffmpeg:
- codec H.264, risoluzione, traccia audio, durata;
- numero di fotogrammi esatto (361);
- confronto PSNR con le sorgenti nei punti chiave;
- video contatore esatto fotogramma per fotogramma;
- audio udibile dove deve, silenzio nella clip con audio disattivato e in quella senza audio.

Infine vengono provati il preset verticale con cambio di formato, l'annullamento dell'esportazione e il ritorno al formato con Ctrl+Z.

**Fase 4, `e2e4`: tutto il resto (23 controlli).**
- Progetto di esempio generato nel browser.
- "Ritrova i tuoi video": i file vengono cancellati dal browser, poi ricollegati; un file sbagliato riceve un messaggio chiaro.
- Dashboard: rinomina, duplica, elimina e annulla.
- Tema chiaro, lingua inglese e ritorno all'italiano.
- Aiuto, pagine privacy, termini e cookie, pagina 404, tasto `?`.

**Fase 5, `e2e5`: dispositivi e tastiera.** Su telefono: landing senza scorrimento laterale e messaggio nell'editor senza tutorial sovrapposto. Su tablet: uso solo da tastiera (Invio per aggiungere, Maiusc+F10 per il menu, ritorno del focus, focus visibile).

**Fase 6, `e2e6`: workflow stile DaVinci Resolve (57 controlli).**
- Media Pool: importazione di immagini e audio, cartelle rapide *Tutti / Clip / Immagini / Audio*.
- Multitraccia: video in V1, immagine trascinata in V2, musica in A1 al cursore; durata del progetto = traccia più lunga; spostamento libero in A1 con aggancio.
- Strumenti: Lametta (linea di taglio e taglio al clic), Puntatore, Slip (durata invariata, annullabile), Aggancio con N.
- Marker sulla timeline e sulla clip, salto al clic e con Maiusc+↓, marker come bersagli dell'aggancio; etichetta colore; D disattiva/riattiva.
- Inspector: zoom, rotazione, capovolgi (annullabili passo per passo), slider trascinato = una sola voce di cronologia, zoom dinamico, ritaglio, colore, vignettatura; Prima/Dopo con Maiusc+D misurato sui pixel; Copia (Ctrl+C) e Incolla attributi (Alt+V) con scelta dei gruppi; velocità 2× con Ctrl+R e ritorno a 1×.
- Titolo in V2 con testo, opacità e fusione Scolora; dissolvenze e preset EQ in A1.
- Anteprima: bande nere 2.39:1 misurate sui pixel, qualità 1/2 (tela dimezzata), Cattura fotogramma PNG 1920×1080.
- **Parità anteprima/esportazione**: tre fotogrammi del file esportato confrontati con l'anteprima alla stessa risoluzione (PSNR ≈ 29, 29 e 65 dB: la differenza residua è la compressione H.264), durata del file uguale a quella del progetto, musica di A1 presente dopo la fine di V1, dissolvenze presenti nel mix.
- Impostazioni progetto, backup `.json`, importazione con nome univoco, migrazione di un progetto schema 1 salvato in IndexedDB, ricerca e ordinamento dei progetti, interfaccia in inglese.

**Fase 7, `e2e7`: immagini, velocità e clip disattivate.** V1 con immagine, video a 2× e immagine disattivata: riproduzione senza blocchi (lettore a 2×), fotogramma nero sulla clip disattivata, esportazione con il numero di fotogrammi esatto e contenuto corretto; ricollegamento di video, immagine e audio.

## Difetti trovati dai test e corretti

1. L'anteprima restava ferma circa 4 secondi quando si passava a un video diverso: un seek in sospeso aspettava un evento che non arrivava più.
2. I messaggi in basso coprivano la timeline e bloccavano i clic: nell'editor ora compaiono in alto.
3. I suggerimenti coprivano le clip: ora stanno nella barra della timeline.
4. La libreria veniva ridisegnata per intero durante l'uso (hover e trascinamento interrotti): ora si aggiorna solo l'elemento cambiato.
5. Il trascinamento dalla libreria si perdeva se l'elemento veniva aggiornato a metà gesto.
6. Il pulsante Scarica non funzionava con la finestra di esportazione aperta.
7. I seek cadevano a volte sul fotogramma precedente per arrotondamenti dei decimali.
8. Con il computer sotto sforzo, l'esportazione tramite riproduzione saltava fotogrammi: introdotta la decodifica diretta per MP4/MOV e il recupero dei fotogrammi saltati per gli altri formati.
9. Un fotogramma ai confini tra le clip veniva assegnato alla clip successiva, mentre l'anteprima mostra la precedente.
10. Dopo una rinomina confermata con Invio, il menu del progetto si riapriva da solo.
11. Su telefono il tutorial poteva comparire sopra il messaggio "funziona al meglio su computer".
12. Le proprietà CSS personalizzate (`--mk`, `--sw`) passate a `h()` venivano ignorate: marker ed etichette erano trasparenti. Ora `h()` usa `setProperty` per le variabili CSS.
13. Gli slider dell'Inspector potevano finire sotto le schede fisse durante lo scorrimento: aggiunto `scroll-padding-top`.
14. Con i pannelli laterali aperti su schermi da 1024 px la barra di riproduzione andava a capo: anteprima resa compatta con le container query.

## Cosa i test non coprono

- **Firefox, Safari ed Edge:** i test usano solo Chromium.
- **L'ambiente pubblicato in claude.ai:** sincronizzazione con l'account, conferma dei download, permessi sui video locali.
- **Hardware reale:** decodifica e codifica hardware, computer lenti, file molto grandi (oltre 100 MB) o molto lunghi.
- **Audit automatici** di accessibilità (axe) e prestazioni (Lighthouse).
