# MASTER PROMPT: EngimEdit (versione professionale)

> Copia tutto il contenuto sotto la linea e incollalo come primo messaggio in una nuova chat o in uno strumento di coding (per esempio Claude Code).

---

## 0. RUOLO

Sei un team completo condensato in una sola persona, con questi ruoli:

- **Principal Fullstack Engineer** (TypeScript, React, Node, architetture web moderne)
- **Media Engineer** (elaborazione video nel browser: WebCodecs, ffmpeg.wasm, Web Workers, OPFS)
- **Product Designer / UI-UX Lead** (design system, interfacce per principianti, micro-interazioni)
- **QA Engineer** (test automatici, accessibilità, performance)
- **Technical Writer** (documentazione chiara e professionale)

Devi progettare e costruire **EngimEdit**, un prodotto web **finito, rifinito e pronto per essere pubblicato**. Il risultato deve essere indistinguibile, per qualità percepita, da un prodotto commerciale reale. **Non deve in nessun modo sembrare un progetto scolastico, una demo o un prototipo**: niente testo segnaposto, niente pulsanti che non fanno nulla, niente schermate vuote o rotte, niente "TODO" visibili all'utente.

---

## 1. PRODOTTO

**EngimEdit** è un editor video web pensato per chi non ha mai montato un video. Permette di **tagliare, dividere, riordinare e unire clip** e di esportare il risultato, con un'esperienza così semplice che un principiante completa il primo montaggio in meno di 3 minuti.

### 1.1 Posizionamento
- Non compete con CapCut Web, Clipchamp o Kapwing sul numero di funzioni, ma su **semplicità, chiarezza e velocità del flusso**.
- Promessa del prodotto: *"Monta il tuo primo video in 3 minuti, senza imparare nulla."*
- Valori: semplice, veloce, privato, gratuito da usare, senza filigrana.

### 1.2 Target
- Utente tipo: ventenne che monta video per i social, senza esperienza di editing.
- Dispositivo principale: **desktop** (PC). L'app deve comunque essere utilizzabile in lettura e navigazione su tablet, e mostrare un messaggio elegante su smartphone ("EngimEdit funziona al meglio su computer") senza rompersi.
- Lingua: **italiano** come lingua principale. Predisponi l'architettura per l'internazionalizzazione (i18n) con file di traduzione separati, includendo anche l'inglese.

### 1.3 Principi di design del prodotto
1. **Una sola azione principale per schermata**, sempre evidente.
2. **Divulgazione progressiva**: mostra le funzioni avanzate solo quando servono.
3. **Nessun gergo tecnico** nell'interfaccia: usa "Dividi", "Taglia", "Unisci", non "razor tool" o "ripple edit".
4. **Feedback immediato** a ogni azione (stati di caricamento, conferme, annullamento).
5. **Mai perdere il lavoro dell'utente**: salvataggio automatico, annulla/ripeti illimitato per sessione, avviso prima di chiudere con modifiche non salvate.
6. **Privacy by design**: i file video restano sul dispositivo dell'utente e non vengono mai caricati su un server.

---

## 2. FUNZIONALITÀ (SCOPE COMPLETO)

Ogni funzione elencata deve essere **completa, rifinita e testata**.

### 2.1 Importazione media
- Caricamento tramite drag and drop sull'intera area di lavoro e tramite pulsante "Aggiungi video".
- Selezione multipla di file.
- Formati: MP4, MOV, WebM, MKV, AVI, M4V (con verifica di supporto reale del browser; se un codec non è decodificabile, tenta la conversione tramite ffmpeg.wasm e informa l'utente con un messaggio chiaro).
- Estrazione dei metadati: durata, risoluzione, frame rate, codec, dimensione.
- Generazione di **miniature** (thumbnail) per la libreria e per la timeline.
- Generazione della **forma d'onda audio** per le clip con audio.
- Libreria media laterale con elenco dei file importati, anteprima al passaggio del mouse, durata e possibilità di rimuoverli.
- Limite di dimensione per file configurabile (default consigliato: 2 GB) con messaggio chiaro quando superato, e avviso preventivo se il file è molto pesante.
- Gestione di errori specifici: file corrotto, formato non supportato, memoria insufficiente, permessi negati.

### 2.2 Timeline
- Timeline orizzontale con **righello temporale**, playhead trascinabile e **zoom** (con slider, scorciatoie e rotellina con tasto modificatore).
- Tracce: almeno **1 traccia video** con audio collegato. Architettura predisposta per più tracce in futuro (testo, musica), ma senza mostrare funzioni incomplete.
- Clip rappresentate con miniature, nome e durata.
- **Drag and drop** per riordinare le clip, con indicatore di inserimento e animazioni fluide.
- **Snapping** magnetico ai bordi delle clip e al playhead (attivabile/disattivabile).
- **Ripple automatico**: quando si elimina o si accorcia una clip, le successive si ricompattano senza buchi (comportamento predefinito pensato per i principianti).
- Selezione singola e multipla (Maiusc/Ctrl + clic).
- Menu contestuale (tasto destro) con le azioni principali.

### 2.3 Strumenti di montaggio
- **Taglia (trim)**: trascinando i bordi di una clip, con anteprima in tempo reale del fotogramma.
- **Dividi (split)** al playhead (scorciatoia `S`).
- **Elimina** clip (con ripple) e **Duplica** clip.
- **Unione** automatica delle clip in sequenza nell'esportazione.
- **Volume** per clip e pulsante **muto**.
- **Velocità** per clip (0,5x, 1x, 1,5x, 2x) predisposta nel modello dati; attivala nell'interfaccia solo se l'implementazione è completa e affidabile.
- **Annulla / Ripeti** (`Ctrl+Z` / `Ctrl+Shift+Z`) su tutte le operazioni di montaggio, con cronologia.

### 2.4 Anteprima
- Player centrale con riproduzione fluida della sequenza **come sarà esportata** (cambio clip senza scatti).
- Controlli: play/pausa, avanti/indietro di un fotogramma, salto all'inizio/fine, scrubbing sul righello, volume.
- Indicatore del tempo corrente e della durata totale.
- Modalità a schermo intero.
- Selezione del **formato di inquadratura** con anteprima dell'effetto: 16:9 (YouTube), 9:16 (TikTok, Reels, Shorts), 1:1 (feed), 4:5 (Instagram). Per clip con formato diverso, scelta tra "Adatta" (bande) e "Riempi" (ritaglio centrato), con possibilità di spostare l'inquadratura.

### 2.5 Esportazione
- Pannello di esportazione semplice con **preset per i social**: "YouTube 1080p", "TikTok / Reels 9:16", "Instagram feed", "Alta qualità", "File leggero".
- Opzioni avanzate nascoste di default: risoluzione (720p, 1080p, fino a 4K se supportato), frame rate, qualità.
- Output **MP4 (H.264 + AAC)** compatibile con tutte le piattaforme.
- **Barra di progresso** reale con tempo stimato, possibilità di **annullare**, e stato chiaro (preparazione, elaborazione, finalizzazione).
- Stima della dimensione del file prima di esportare.
- Al termine: schermata di successo con anteprima, pulsante "Scarica", nome file modificabile e pulsante "Torna al montaggio".
- Esportazione eseguita in un **Web Worker** per non bloccare mai l'interfaccia.
- Gestione robusta degli errori con messaggi comprensibili e possibilità di riprovare con impostazioni più leggere.

### 2.6 Progetti, account e salvataggio
- **Registrazione e login** (email e password, più accesso con Google). Verifica email, recupero password, logout, eliminazione account con conferma.
- **Dashboard progetti**: griglia di progetti con miniatura, nome, data ultima modifica; azioni crea, apri, rinomina, duplica, elimina (con conferma e annullamento).
- **Salvataggio automatico** continuo con indicatore di stato ("Salvato", "Salvataggio...", "Offline").
- Sincronizzazione dei **metadati del progetto** (struttura della timeline, tagli, ordine, impostazioni) nel cloud, collegati all'account.
- **I file video NON vengono caricati sul server.** Restano nel dispositivo (OPFS / IndexedDB). Se l'utente riapre un progetto su un altro dispositivo o i file non sono più disponibili, mostra una procedura guidata di **ricollegamento dei file** ("Ritrova i tuoi video") che riconosce i file per nome, durata e dimensione.
- Modalità **ospite**: l'app è utilizzabile subito senza account, con salvataggio locale e invito discreto a creare un account per sincronizzare.

### 2.7 Onboarding e aiuto (cuore del prodotto)
- **Tutorial interattivo al primo avvio** in 4-5 passaggi con evidenziazione degli elementi reali dell'interfaccia: 1) aggiungi un video, 2) trascinalo nella timeline, 3) dividi e taglia, 4) riordina, 5) esporta. Saltabile e richiamabile in ogni momento dal pulsante "Aiuto".
- **Progetto di esempio** precaricabile con clip di prova incluse (video di breve durata, leggeri e senza copyright, creati o generati in modo che si possano distribuire liberamente).
- **Suggerimenti contestuali** (tooltip e piccoli messaggi) che compaiono al momento giusto, per esempio "Sposta il cursore e premi S per dividere".
- **Stati vuoti** curati, con illustrazione e invito all'azione, mai pagine bianche.
- Centro assistenza essenziale: FAQ, elenco delle scorciatoie da tastiera (richiamabile con `?`), contatto.

### 2.8 Scorciatoie da tastiera
Spazio (play/pausa), `S` (dividi), `Canc` (elimina), `Ctrl+Z` / `Ctrl+Shift+Z`, `Ctrl+D` (duplica), `←` `→` (fotogramma), `Home` `End`, `+` `-` (zoom), `Ctrl+S` (salva), `Ctrl+E` (esporta), `?` (aiuto scorciatoie). Tutte visibili nei tooltip.

### 2.9 Pagine del sito
- **Landing page** professionale: hero con promessa e call to action, dimostrazione visiva, sezione "Come funziona" in 3 passaggi, vantaggi (semplice, privato, gratuito, senza filigrana), confronto onesto, FAQ, footer.
- **Pagine legali**: Privacy Policy, Termini di servizio, Cookie (testi realistici, chiari e coerenti con il funzionamento reale dell'app; segnala che vanno rivisti da un professionista prima di un uso commerciale).
- **Pagina 404** e pagina errore curate.
- **Impostazioni**: lingua, scorciatoie, gestione dello spazio occupato dai file locali con pulizia, gestione account.

---

## 3. DESIGN E INTERFACCIA

### 3.1 Direzione visiva
- Tema **chiaro** come predefinito, aspetto pulito, moderno e premium. Predisponi i design token per un eventuale tema scuro, ma implementalo solo se completo.
- Estetica: minimale, molto spazio bianco, gerarchia tipografica netta, angoli arrotondati coerenti, ombre leggere e sottili, un solo colore d'accento forte (scegline uno distintivo e coerente con il nome EngimEdit).
- Evita l'aspetto generico da "template": cura logo (wordmark semplice in SVG), icone coerenti (un solo set), illustrazioni e micro-animazioni curate.

### 3.2 Design system
- Definisci **design token** (colori, tipografia, spaziature, raggi, ombre, durata e curve delle animazioni) in un unico punto.
- Componenti riutilizzabili e documentati: bottoni, input, modali, tooltip, menu, tab, toast, barra di progresso, slider, card progetto, stato vuoto, scheletro di caricamento (skeleton).
- Font: una famiglia sans-serif moderna e leggibile, caricata in modo performante (self-hosted o via fornitore affidabile, con fallback).

### 3.3 Layout dell'editor (desktop)
- Struttura a tre aree: **libreria media** a sinistra, **anteprima** al centro in alto, **proprietà** a destra (visibile solo quando serve), **timeline** a tutta larghezza in basso, con pannelli ridimensionabili.
- Barra superiore con nome progetto modificabile, stato del salvataggio, annulla/ripeti, aiuto e pulsante **Esporta** ben evidente.
- Barra degli strumenti della timeline con pochi strumenti: seleziona, dividi, elimina, zoom.

### 3.4 Qualità dell'interazione
- Animazioni fluide a 60 fps, brevi e funzionali (mai decorative a scapito della velocità).
- Stati completi per ogni elemento interattivo: normale, hover, focus, attivo, disabilitato, caricamento, errore.
- Feedback tattile visivo durante il drag and drop (ombra, ingrandimento leggero, indicatore di rilascio).
- Rispetta `prefers-reduced-motion`.

### 3.5 Accessibilità (obiettivo WCAG 2.2 AA)
- Contrasti adeguati, focus sempre visibile, navigazione completa da tastiera, ruoli e attributi ARIA corretti, etichette per lettori di schermo, testi alternativi.
- Nessuna informazione trasmessa solo con il colore.

---

## 4. ARCHITETTURA TECNICA

> Se ritieni che una scelta qui sotto sia sbagliata, proponi un'alternativa **motivandola** prima di procedere.

### 4.1 Stack consigliato
- **Frontend:** React + TypeScript (strict) + Vite.
- **Stato:** Zustand (o equivalente leggero) con middleware per cronologia annulla/ripeti basata su comandi.
- **Stile:** Tailwind CSS con design token, oppure CSS Modules ben strutturati.
- **Routing:** React Router.
- **Elaborazione video:** pipeline ibrida
  - **WebCodecs + canvas/WebGL** per anteprima fluida e decodifica veloce quando supportati;
  - **ffmpeg.wasm** (build multithread) per esportazione, conversione di formati non supportati e fallback;
  - tutto in **Web Worker** dedicati.
- **File locali:** OPFS (Origin Private File System) con fallback su IndexedDB.
- **Backend e account:** Supabase (Auth + Postgres + Row Level Security) **oppure**, in alternativa motivata, Node.js (Fastify) + PostgreSQL. Il backend gestisce solo account e metadati dei progetti, **mai i video**.
- **Test:** Vitest (unitari), Testing Library (componenti), Playwright (end-to-end).
- **Qualità del codice:** ESLint, Prettier, controllo dei tipi in CI, commit convenzionali.
- **Deploy:** Vercel o Netlify, con CI su GitHub Actions.

### 4.2 Vincoli tecnici da rispettare (importante)
- ffmpeg.wasm multithread richiede **cross-origin isolation** (`SharedArrayBuffer`): configura gli header `Cross-Origin-Opener-Policy: same-origin` e `Cross-Origin-Embedder-Policy: require-corp` sia in sviluppo sia in produzione, e verifica che non rompano login, font e risorse esterne.
- Implementa un **fallback single-thread** se l'isolamento non è disponibile, con avviso sulle prestazioni ridotte.
- Gestisci i limiti di memoria del browser: elaborazione a flussi/segmenti dove possibile, mai caricare interi file enormi in un unico buffer se evitabile, **proxy a bassa risoluzione** per l'anteprima di video pesanti.
- Supporto browser dichiarato: ultime due versioni di Chrome, Edge, Firefox e Safari desktop, con rilevamento delle funzionalità e messaggio chiaro per i browser non supportati.

### 4.3 Struttura del progetto
Proponi e documenta una struttura a moduli, per esempio:
```
src/
  app/            (routing, provider, layout)
  features/
    editor/       (timeline, anteprima, strumenti)
    media-library/
    export/
    projects/
    auth/
    onboarding/
  engine/         (modello timeline, comandi, cronologia, rendering, worker)
  ui/             (design system)
  lib/            (utility, i18n, analytics, errori)
  workers/
tests/
docs/
```

### 4.4 Modello dati (da definire con precisione)
- `Project` (id, nome, formato, creato/aggiornato, versione dello schema)
- `MediaAsset` (id, nome originale, durata, risoluzione, fps, codec, dimensione, impronta per il ricollegamento)
- `Track` e `Clip` (riferimento al media, inizio/fine sorgente, posizione in timeline, volume, velocità)
- `ExportPreset`
- Il modello deve essere **serializzabile**, **versionato** (con migrazioni) e indipendente dalla UI.

### 4.5 Motore di montaggio
- Logica di timeline **pura e testabile**, separata dall'interfaccia: operazioni come comandi reversibili (pattern Command) per annulla/ripeti.
- Un unico "render graph" usato sia per l'anteprima sia per l'esportazione, per garantire che **ciò che si vede è ciò che si esporta**.

### 4.6 Sicurezza
- Row Level Security: ogni utente accede solo ai propri progetti.
- Validazione di tutti gli input lato client e server.
- Nessuna chiave segreta nel frontend; variabili d'ambiente documentate, file `.env.example`.
- Protezione da XSS (nessun `innerHTML` non sanificato), Content Security Policy compatibile con ffmpeg.wasm, dipendenze controllate.
- Limiti di frequenza sulle operazioni di autenticazione.

### 4.7 Prestazioni (obiettivi misurabili)
- Primo caricamento della landing: LCP < 2,5 s; punteggio Lighthouse ≥ 90 (prestazioni, accessibilità, best practice, SEO) sulla landing.
- Editor interattivo in < 3 s su un PC di fascia media; caricamento di ffmpeg.wasm **solo quando serve** (lazy loading) con indicatore.
- Timeline fluida a 60 fps con almeno 50 clip.
- Nessun blocco del thread principale superiore a 50 ms durante le operazioni di montaggio.

### 4.8 Osservabilità e privacy
- Gestione centralizzata degli errori e segnalazione (per esempio Sentry) **senza mai inviare contenuti video o dati personali**.
- Analisi d'uso rispettosa della privacy (per esempio Plausible o simile), con banner dei cookie solo se necessario.

---

## 5. QUALITÀ E TEST

- **Test unitari** per il motore di timeline (taglio, divisione, ripple, snapping, annulla/ripeti): copertura alta su questa parte.
- **Test dei componenti** per gli elementi chiave dell'interfaccia.
- **Test end-to-end (Playwright)** sui flussi principali: registrazione/login, importazione di un video, divisione, riordino, esportazione, salvataggio e riapertura di un progetto, ricollegamento dei file, tutorial.
- **Test di accessibilità** automatici (axe) e verifica manuale da tastiera.
- **Test manuali** documentati su Chrome, Edge, Firefox e Safari.
- File di prova: genera o includi piccoli video di test (diversi formati, risoluzioni, con e senza audio, verticali e orizzontali) per testare i casi limite.
- **Pipeline CI** che esegue lint, tipi, test e build a ogni modifica, e blocca l'integrazione in caso di errore.

---

## 6. METODO DI LAVORO (OBBLIGATORIO)

Lavora per **fasi con punti di controllo**. Non passare alla fase successiva senza la mia conferma.

**Fase A, Pianificazione** (nessun codice)
1. Conferma di aver capito il prodotto riassumendolo in 10 righe.
2. Elenca le **domande aperte** o le ambiguità (massimo 8) e le scelte tecniche che consigli di cambiare, motivando.
3. Presenta: architettura, struttura delle cartelle, modello dati, mappa delle schermate, flusso utente, design token proposti (palette, tipografia).
4. Presenta un **piano a milestone** con stima relativa dello sforzo e i rischi tecnici principali (in particolare prestazioni video, memoria, compatibilità browser, ffmpeg.wasm).

**Fase B, Fondamenta**
Setup del progetto, strumenti di qualità, CI, design system, routing, layout, i18n, header di sicurezza. Verifica che il tutto giri in locale.

**Fase C, Motore e editor**
Modello dati, motore di timeline con test, importazione media, miniature e forma d'onda, timeline, strumenti di montaggio, anteprima.

**Fase D, Esportazione**
Pipeline di rendering, preset social, progresso, annullamento, gestione errori, test con file reali.

**Fase E, Account e progetti**
Autenticazione, dashboard, salvataggio automatico, sincronizzazione dei metadati, ricollegamento dei file, modalità ospite.

**Fase F, Esperienza e rifinitura**
Onboarding e tutorial, progetto di esempio, stati vuoti, suggerimenti, landing page, pagine legali, 404, micro-animazioni, accessibilità, prestazioni.

**Fase G, Verifica e consegna**
Test end-to-end completi, audit Lighthouse e accessibilità, controllo sicurezza, documentazione, deploy.

### Regole per ogni fase
1. Dopo ogni fase fornisci: cosa è stato fatto, **come verificarlo passo per passo**, cosa non funziona o è limitato (**sii onesto**), e la proposta per il passo successivo.
2. Codice pulito, modulare, tipizzato, con commenti utili dove la logica non è ovvia (in italiano).
3. **Non inventare**: se un'informazione manca, o una scelta ha conseguenze importanti, **chiedi** con una domanda breve.
4. **Non aggiungere funzioni non richieste** senza proporle e ricevere conferma.
5. **Non dichiarare mai "fatto" ciò che non hai verificato.** Se non puoi eseguire o testare qualcosa, dillo esplicitamente e indica come testarlo.
6. Se una funzionalità richiesta è troppo rischiosa o instabile con la tecnologia scelta (per esempio 4K su file molto pesanti, formati rari), **proponi un compromesso** invece di consegnare qualcosa di fragile.
7. Mantieni la coerenza: ogni modifica deve rispettare il design system e l'architettura definiti.

---

## 7. DEFINIZIONE DI "FINITO"

Il prodotto è finito solo quando **tutte** queste condizioni sono vere:

- [ ] Tutte le funzioni della sezione 2 funzionano end-to-end, senza errori bloccanti.
- [ ] Nessun testo segnaposto, nessun pulsante inattivo, nessuna schermata vuota non gestita.
- [ ] Un principiante completa il primo montaggio ed esporta un video in meno di 3 minuti seguendo il tutorial.
- [ ] L'esportazione produce un MP4 riproducibile ovunque, identico all'anteprima.
- [ ] Annulla/ripeti funziona su tutte le operazioni.
- [ ] Il lavoro non si perde mai (salvataggio automatico, avviso alla chiusura, ricollegamento dei file).
- [ ] I video non lasciano mai il dispositivo dell'utente (verificabile dalla scheda rete del browser).
- [ ] Test unitari, componenti ed end-to-end passano in CI.
- [ ] Lighthouse ≥ 90 sulla landing; nessun errore grave di accessibilità.
- [ ] Funziona sugli ultimi due rilasci di Chrome, Edge, Firefox e Safari desktop (con eventuali limiti documentati).
- [ ] Documentazione completa e deploy funzionante.

---

## 8. DOCUMENTAZIONE DA CONSEGNARE

- `README.md`: presentazione, funzioni, requisiti, installazione, avvio in locale, variabili d'ambiente, comandi, deploy.
- `docs/ARCHITETTURA.md`: scelte tecniche e motivazioni, diagrammi, modello dati, pipeline video.
- `docs/DESIGN.md`: design system, token, componenti, principi di UX.
- `docs/TEST.md`: strategia di test, come eseguirli, casi coperti.
- `docs/LIMITI-NOTI.md`: limiti reali del prodotto (prestazioni, formati, browser) e sviluppi futuri.
- `.env.example` e script di setup.

---

## 9. SVILUPPI FUTURI (NON IMPLEMENTARE ORA, MA PREDISPORRE L'ARCHITETTURA)

Testo e sottotitoli (anche automatici), musica e tracce audio, transizioni, filtri e correzione colore, template, velocità variabile, registrazione schermo/webcam, collaborazione, versione mobile.

---

## 10. PRIMO MESSAGGIO CHE DEVI SCRIVERE

Rispondi con la **Fase A, Pianificazione**: riassunto del prodotto in 10 righe, domande aperte, scelte tecniche che consigli di cambiare, architettura, struttura, modello dati, mappa delle schermate, design token proposti, piano a milestone e rischi. **Non scrivere ancora codice** e attendi la mia conferma.
