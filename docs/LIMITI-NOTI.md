# Limiti noti e sviluppi futuri

## Limiti del prodotto

**Formati e codec**
- Su Chrome per Linux il browser non sa creare audio AAC: l'audio esportato è in **Opus** dentro l'MP4. YouTube, i browser e VLC lo leggono; alcuni lettori Apple (QuickTime, app Foto) no. Su Chrome ed Edge per Windows e macOS l'audio esce in AAC. L'app avvisa prima dell'esportazione.
- I video **HEVC (H.265)** dell'iPhone si aprono solo se il browser li decodifica, cosa che dipende da sistema e hardware. Altrimenti l'app spiega come convertirli o come impostare la fotocamera su "Più compatibile". La conversione automatica con ffmpeg.wasm non c'è (vedi sotto).
- **MKV e AVI** funzionano solo se il browser li legge. In caso contrario c'è un messaggio con l'invito a convertire in MP4.
- La **decodifica esatta e veloce** in esportazione vale per MP4/MOV con video H.264, quindi per la maggior parte dei video di telefoni, fotocamere e PC. Gli altri formati (WebM, HEVC, AV1, MP4 frammentati) vengono catturati durante la riproduzione. Nei test è risultata esatta, ma è legata al tempo reale e, su un computer molto lento, può rallentare per recuperare i fotogrammi saltati.

**Prestazioni e memoria**
- L'audio di ogni file viene decodificato per intero in memoria, per la forma d'onda e per un'anteprima identica all'esportazione: circa 23 MB per minuto. Oltre 1,4 GB per file l'audio non viene elaborato e la clip risulta muta, con un avviso.
- Il limite per file è 2 GB. Sopra i 700 MB l'importazione avvisa che servirà più tempo.
- La **qualità anteprima** (1/2, 1/4) riduce la risoluzione della tela di anteprima e il lavoro di composizione e colore, ma il browser decodifica comunque il video alla risoluzione originale: con video 4K su computer molto modesti può servire anche chiudere altre schede.
- Correzione colore ed effetti usano WebGL. Senza WebGL lo stesso calcolo avviene sulla CPU: il risultato è uguale, ma l'anteprima è più lenta. La grana usa celle relative all'altezza del fotogramma: tra un'anteprima a bassa risoluzione e un file 4K la grana ha lo stesso aspetto, non gli stessi pixel.

**Montaggio**
- C'è **una sola traccia di sovrapposizione (V2)** e **una sola traccia audio aggiuntiva (A1)**; nella stessa traccia le clip non si sovrappongono. Le transizioni (dissolvenze incrociate video) non ci sono ancora.
- I **titoli** usano il carattere Plus Jakarta Sans caricato da Google Fonts; senza rete il browser usa un carattere di sistema, sia in anteprima sia in esportazione.
- La velocità cambia anche l'intonazione dell'audio (come un nastro), non c'è la correzione del tono.
- Le impostazioni del progetto (regola di ridimensionamento predefinita, durata delle immagini) e l'aggancio sono preferenze e non entrano nella cronologia; *Applica a tutte le clip* invece è annullabile.
- L'esportazione si mette in pausa se la scheda non è visibile e riprende al ritorno.

**Browser e dispositivi**
- I test automatici sono stati eseguiti solo con **Chromium**. Nell'ambiente di prova headless il controllo "contatore" della fase 3 (cattura in riproduzione di un MP4 senza perdite, che il decodificatore WebCodecs di quella build non accetta) segnala due fotogrammi ripetuti all'inizio della clip: succedeva già prima di questa versione ed è legato ai tempi del browser senza schermo.
- Firefox, Safari ed Edge non sono stati provati. Senza WebCodecs l'esportazione ripiega su MediaRecorder, in tempo reale e talvolta in formato WebM.
- Su telefono si possono vedere landing e progetti, ma non montare: è una scelta di progetto.

**Account**
- L'account è quello di **claude.ai**: aprendo l'app da claude.ai con il proprio account, i progetti (solo i metadati) si sincronizzano. Fuori da claude.ai l'app funziona in modalità ospite, tutta in locale.
- Mancano registrazione con email e password, accesso con Google, verifica email e recupero password, perché nell'ambiente di pubblicazione non c'è un server di autenticazione. "Eliminazione account" equivale a *Elimina i progetti dal tuo account* più *Elimina tutti i dati locali* nelle Impostazioni.

**Contenuti da completare prima di un uso pubblico**
- `CONTACT_EMAIL` in `src/views.js` (`supporto@engimedit.it`) è un indirizzo di esempio da sostituire.
- Privacy, termini e cookie vanno rivisti da un professionista.

## Differenze rispetto al master prompt

| Master prompt | Realizzato | Motivo |
|---|---|---|
| React + TypeScript + Vite, React Router | JavaScript moderno senza framework, router su hash, un solo file HTML | L'app è pubblicata come pagina unica autosufficiente in claude.ai; nessuna compilazione TypeScript nell'ambiente di lavoro |
| ffmpeg.wasm per esportazione, conversioni e fallback | WebCodecs + mp4-muxer; nessuna conversione dei formati illeggibili | La pagina pubblicata non può caricare ffmpeg.wasm né i worker da altri siti e non ha l'isolamento cross-origin; WebCodecs è più veloce e già nel browser |
| Esportazione in Web Worker | Codifica e decodifica WebCodecs, che lavorano già fuori dal thread principale; la composizione dei fotogrammi resta sul thread principale | I worker caricati da blob non sono garantiti nell'ambiente pubblicato |
| OPFS con ripiego su IndexedDB | Solo IndexedDB | Supportato ovunque e sufficiente per file fino a 2 GB |
| Supabase (Auth + Postgres + RLS) | Capability `db` e `user` di claude.ai, spazio privato per utente | Nessun backend esterno disponibile; i video restano comunque solo in locale |
| Vitest, Testing Library, Playwright | `node:test` per i test unitari, Playwright per gli end-to-end (94 controlli) | Nessuna dipendenza in più per i test unitari |
| `.env.example` | Non presente | L'app non usa variabili d'ambiente né chiavi |
| Lighthouse ≥ 90 e audit di accessibilità | Non eseguiti | Strumenti non disponibili nell'ambiente di sviluppo: sono il primo passo consigliato |
| Velocità della clip predisposta nel modello | Velocità 0,25×–4× nell'Inspector e con Ctrl+R | Anteprima ed esportazione verificate dai test a 2× |

## Sviluppi futuri

Il primo blocco serve a completare il prodotto attuale:
1. Audit Lighthouse e axe e prove su Firefox, Safari ed Edge.
2. Proxy veri (file a bassa risoluzione generati all'importazione) per i video 4K.
3. Decodifica esatta anche per WebM (VP8/VP9) con un lettore EBML.
4. Account con email e Google, se l'app viene pubblicata fuori da claude.ai con un proprio backend.

Poi: transizioni, più tracce V e A, keyframe sulle proprietà, ruote colore e curve, sottotitoli automatici, correzione del tono con la velocità, template, registrazione di schermo e webcam, collaborazione, versione mobile.
