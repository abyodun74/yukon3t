import type { FaqItems } from "../ids";

// Italian FAQ, part 1: Getting around, The Android app, Posts and media. Conventions as in src/lib/i18n/it: Italian,
// informal "tu"; names of buttons and screens exactly as the app shows them, in «»; product names
// (YuKon3t, Circles, Collab Boards, Muse) as they are.
export const it1 = {
  "who-join-yukon3t": {
    q: "Chi può unirsi a YuKon3t?",
    a: "Chiunque abbia 16 anni o più. Quando ti registri ti chiederemo la data di nascita. Se hai 16 o 17 anni, puoi usare YuKon3t solo con la partecipazione e il consenso di un genitore o di un tutore legale.",
  },
  "try-without-signing-up": {
    q: "Posso provare YuKon3t senza registrarmi?",
    a: "Quando la vista ospite è attiva, sì: la pagina yukon3t.com/try ha un pulsante «Esplora YuKon3t come ospite», senza e-mail e senza password. Un ospite vede le stesse cose che vede un nuovo membro: i post che i loro autori hanno lasciato per Tutti, i Circle pubblici e i loro canali pubblici, i video di Muse, le Collab Boards, Scopri e i profili delle persone (nome, foto profilo, bio, paese e i loro post per Tutti), insieme ai commenti, al numero di Mi piace e all'elenco di chi ha messo Mi piace a quei post. Un ospite non vede mai nulla che un nuovo membro non potrebbe vedere: né post limitati ai contatti, né Circle o canali privati, né messaggi, né Storie (sono per i contatti). Gli ospiti non possono pubblicare, commentare, mettere Mi piace né reagire, entrare in contatto, iscriversi, inviare messaggi, chiamare, unirsi né guardare una diretta, votare, rispondere agli eventi né segnalare nulla; toccando una qualsiasi di queste opzioni viene proposto di creare un account gratuito. Una visita come ospite dura al massimo 2 ore e poi termina da sola. Gli ospiti non compaiono mai nella ricerca, in Scopri, negli elenchi dei membri né in «chi è online», e nessuno viene avvisato che un ospite ha visto il suo profilo o i suoi post. Cosa conserva una visita come ospite è spiegato nell'Informativa sulla privacy.",
  },
  "where-find-everything": {
    q: "Dove trovo ogni cosa?",
    a: "Su un computer, la barra in alto ha i link a «Home», «Scopri», «Circles», «Collab Boards», «Muse», «Contatti», «Messaggi» e al tuo «Profilo». Su un telefono, le sei sezioni più usate («Home», «Circles», «Collab», «Muse», «Messaggi», «Profilo») sono in una barra di schede in basso, e «Contatti» è l'icona della persona nella barra in alto. Tocca il menu ☰ in alto a destra per andare a «Scopri», «Invita amici», «Impostazioni» e, se sei amministratore, agli strumenti di moderazione.",
  },
  "swipe-between-tabs-instead-tapping": {
    q: "Posso scorrere per cambiare scheda invece di toccare?",
    a: "Sì, su un telefono: scorri verso destra in qualsiasi punto dello schermo per avanzare tra Home → Circles → Collab → Muse → Messaggi → Profilo, e da lì di nuovo alla Home. Scorri verso sinistra per percorrere le stesse schede all'indietro, ricominciando dall'altro lato.",
  },
  "difference-between-home-discover-connections": {
    q: "Che differenza c'è tra Home, Scopri e Contatti?",
    a: "**Home** è il tuo feed: i post dei tuoi contatti e di tutte le persone che pubblicano in modo pubblico, compresi i post dei Circle pubblici. I post di un Circle privato restano in quel Circle e non compaiono mai qui. **Scopri** serve a trovare persone nuove per paese, lingua o interesse. **Contatti** è l'elenco dei tuoi contatti accettati, più le richieste in sospeso che hai inviato o ricevuto.",
  },
  "switch-between-light-dark-mode": {
    q: "Come passo dalla modalità chiara a quella scura?",
    a: "Usa il selettore del tema accanto a «Impostazioni» nella barra in alto (o nel menu ☰ sul telefono). Per impostazione predefinita segue le impostazioni del tuo dispositivo, ma puoi fissarlo su chiaro o scuro.",
  },
  "yukon3t-work-iphones-accessibility-settings": {
    q: "YuKon3t funziona con le impostazioni di accessibilità del mio iPhone?",
    a: "Sì. L'app per iPhone funziona con il Controllo vocale e rispetta la dimensione del testo del tuo iPhone: aumentala in Impostazioni → Accessibilità → Schermo e dimensione testo → Testo più grande e il testo di YuKon3t crescerà con lei, fino a poco più del doppio della sua dimensione normale. La barra in alto e la barra delle schede in basso crescono solo un po', così tutte le icone e le schede continuano a stare sullo schermo. L'app rispetta anche Riduci movimento, e la modalità scura segue il tuo dispositivo a meno che tu non la fissi.",
  },
  "megaphone-icon-next-bell": {
    q: "Cos'è l'icona del megafono accanto alla campanella?",
    a: "Sono le «Novità»: toccala per vedere l'elenco delle funzioni e dei miglioramenti che rilasciamo. Si illumina quando c'è qualcosa che non hai ancora visto, e appena viene pubblicata una novità ti arriva una vera notifica sul telefono, quindi non devi ricordarti di controllare. Ogni novità appare nella lingua in cui usi YuKon3t quando l'abbiamo scritta in quella lingua, altrimenti in inglese. La notifica sul telefono segue la stessa regola, nella lingua delle tue notifiche.",
  },
  "search-app": {
    q: "Come faccio a cercare nell'app?",
    a: "Tocca l'icona della lente accanto alla campanella delle notifiche. Un'unica casella di ricerca copre persone, Circle, chat di gruppo e collaborazioni insieme. Puoi filtrare i risultati per più rilevanti, più recenti, meno recenti, «attualità» (con attività nelle ultime due settimane) o per un paese specifico.",
  },
  "click-someones-name-almost-everywhere": {
    q: "Perché posso cliccare sul nome di qualcuno quasi ovunque?",
    a: "Qualsiasi nome o foto profilo che vedi (in una chat, in un commento, in un elenco di contatti, nell'elenco dei membri di un Circle, ecc.) porta direttamente al profilo di quella persona. Funziona così ovunque di proposito, così non devi mai cercare un pulsante «vedi profilo».",
  },
  "some-people-disappear-from-discover": {
    q: "Perché alcune persone spariscono da Scopri?",
    a: "Scopri mostra solo persone con cui non hai ancora avuto alcuna interazione di contatto: appena invii o ricevi una richiesta di contatto, quella persona smette di comparire nei risultati di Scopri (che sia ancora in sospeso o già accettata). Se una richiesta viene rifiutata, quella persona può tornare a comparire in Scopri per un nuovo tentativo. L'icona di ricerca in cima a Scopri continua a trovarla.",
  },
  "search-people-discover": {
    q: "Come trovo una persona specifica in Scopri e mi collego con lei?",
    a: "Tocca l'icona della lente in cima a Scopri e scrivi almeno due lettere del suo nome o del suo @utente. I risultati compaiono mentre scrivi, ognuno con un pulsante che mostra a che punto siete: «Collegati», «Richiesta inviata», «Accetta» (ti ha già chiesto di collegarvi) o «Contatti», oltre a «Messaggio». Qui si possono trovare solo le persone che compaiono in Scopri: account verificati che non hanno disattivato «Mostra il mio profilo in Scopri», e mai chi hai bloccato o chi ti ha bloccato. Una ricerca mostra al massimo 60 persone, quindi se non vedi chi cerchi, scrivi più parti del suo nome. Si cercano solo nomi e nomi utente; e-mail, numeri di telefono e date di compleanno non vengono mai cercati né mostrati.",
  },
  "new-member-alerts": {
    q: "Perché ho ricevuto una notifica che dice che qualcuno si è appena unito a YuKon3t?",
    a: "Quando qualcuno di nuovo finisce di configurare il profilo e ha verificato l'account, YuKon3t avvisa chi usa Scopri, così i nuovi arrivati trovano persone con cui entrare in contatto. Viene annunciato solo chi compare in Scopri: non chi ha disattivato «Mostra il mio profilo in Scopri», non chi ha i post visibili solo ai propri contatti, e mai chi hai bloccato o chi ti ha bloccato. Ogni persona viene annunciata una sola volta, poco dopo essersi unita. Il tuo telefono riceve al massimo uno di questi avvisi ogni 12 ore; quando si uniscono più persone, le tue notifiche le raggruppano in un'unica voce («Ada e altre 3 persone si sono appena unite a YuKon3t») che apre Scopri con le persone più nuove per prime. Per non riceverli più, deseleziona Nuovi membri in Impostazioni → Notifiche. Per non essere annunciato quando ti unisci, disattiva «Mostra il mio profilo in Scopri» in Impostazioni → Privacy subito dopo la registrazione.",
  },
  "home-split-into-sections-like": {
    q: "Perché la Home è divisa in sezioni come Lavoro, Intrattenimento, Politica e Sport?",
    a: "I post vengono raggruppati in base alla sezione del feed che il loro autore ha scelto quando li ha scritti (per impostazione predefinita, Generale), così è più facile vedere ciò che ti interessa. Mentre sei sulla pagina, ogni sezione aggiunge automaticamente in alto i nuovi post, di solito in pochi secondi e in circa mezzo minuto quando si pubblica molto insieme. Non serve aggiornare.",
  },
  "feed-muse-fresh-mix-latest": {
    q: "Perché l'ordine di Home e Muse cambia, e come vedo prima i più recenti?",
    a: "Per impostazione predefinita, la Home (ognuna delle sue sezioni) e Muse mostrano un nuovo mix ogni 15 minuti invece di andare rigorosamente dal più nuovo al più vecchio. I post e i video più nuovi hanno molte più probabilità di comparire in alto, ma compaiono anche quelli più vecchi dell'ultima settimana, così tornando più tardi vedi qualcosa di diverso. Ciò che è stato pubblicato dall'inizio del mix attuale e i tuoi post delle ultime 24 ore restano in alto, dal più nuovo al più vecchio. L'ordine non cambia mai mentre scorri: un nuovo mix compare solo quando apri o ricarichi la pagina. Il mix è calcolato solo in base al tuo account, al feed e all'ora, non a ciò che guardi, a cui metti mi piace o che riproduci, e per crearlo non viene registrato nulla di nuovo su di te. Per tornare a vedere prima i più recenti, attiva l'interruttore **«Più recenti»** in alto nella Home o in Muse. Vale per entrambi e resta memorizzato su quel dispositivo finché non lo disattivi.",
  },
  "update-the-app": {
    q: "Come aggiorno l'app e perché mi chiedono di aggiornarla?",
    a: "La maggior parte dei miglioramenti arriva da sola: l'app carica la versione più recente di YuKon3t ogni volta che la apri. Alcune modifiche richiedono una nuova versione dell'app stessa su Google Play o sull'App Store, e quando ne esce una potresti vedere un avviso di «Aggiornamento disponibile»: tocca **Aggiorna** per aprire lo store e poi tocca Aggiorna lì. «Non ora» nasconde l'avviso per 3 giorni. In rari casi, quando una versione precedente non può più funzionare bene, vedrai invece una schermata di «Aggiornamento necessario»; da lì puoi continuare ad aprire queste domande frequenti o uscire dall'account, e tutto torna a funzionare appena aggiorni. Puoi anche aggiornare quando vuoi: apri Google Play o l'App Store, cerca YuKon3t e tocca Aggiorna. Per inviare questi avvisi, la versione e il numero di build dell'app e la piattaforma del tuo telefono (Android o iPhone) vengono salvati insieme al suo token per le notifiche push.",
  },
  "links-open-in-app": {
    q: "I link si aprono nell'app di YuKon3t?",
    a: "Dentro l'app, sì. Nell'app di YuKon3t per Android o iPhone, toccando un link a una pagina di YuKon3t (yukon3t.com) in una chat, un post, un commento o una notifica, quella pagina si apre lì, nell'app. I link a qualsiasi altro sito web si aprono nel browser del tuo telefono. Sul sito web, un link di YuKon3t si apre nella stessa scheda e gli altri siti in una nuova scheda.\n\nTutti i link che YuKon3t crea perché tu li condivida (un post, una Muse, un Circle, una collaborazione, il link di una chat di gruppo o un link che copi tenendolo premuto) sono un vero indirizzo https://yukon3t.com, quindi funzionano ovunque tu li invii. Un link di YuKon3t che tocchi in un'altra app, come un SMS, WhatsApp o un'e-mail, per ora apre il sito web nel tuo browser: perché quei link si aprano direttamente nell'app serve una versione più recente dell'app, che non è ancora uscita.",
  },
  "app-opens-where-left-off": {
    q: "Perché l'app si apre dove l'avevo lasciata?",
    a: "Nell'app di YuKon3t per Android o iPhone, se passi a un'altra app e torni, ritorni alla stessa schermata: la chat, il profilo, il Circle o la pagina delle «Impostazioni» in cui eri, o il post che stavi scrivendo. I nuovi messaggi di una chat aperta si caricano appena torni e, se sei stato via 2 minuti o più, la schermata in cui ti trovi si aggiorna lì senza che tu perda ciò che stavi scrivendo. Se tocchi una notifica, l'app va a ciò di cui parla quella notifica. Se l'app era chiusa del tutto (l'hai chiusa scorrendola o il telefono l'ha chiusa per liberare memoria), parte dalla Home, come ogni nuovo avvio.\n\nLe chat nascoste restano protette: appena esci dall'app con una chat nascosta sullo schermo, si blocca e lo schermo viene coperto. Quando torni, ti viene chiesto il PIN e, appena lo scrivi, sei di nuovo nella chat. Se YuKon3t è stato aggiornato mentre eri via, l'app si ricarica sulla stessa pagina.",
  },
  "slow-connection-data-saver": {
    q: "YuKon3t funziona con una connessione lenta o instabile?",
    a: "Sì. Quando la tua connessione è lenta (3G, 4G o 5G con poco segnale, una rete Wi-Fi congestionata) o è attivo il risparmio dati del tuo telefono, YuKon3t si adatta da solo: i video del feed aspettano che tu tocchi riproduci invece di partire mentre scorri, Muse carica solo il video che stai guardando, il feed carica meno post alla volta e la sessione non viene registrata per le statistiche. Puoi anche sceglierlo tu in Impostazioni → **«Risparmio dati»**: «Automatico» (l'opzione predefinita), «Attivo» o «Disattivato». L'impostazione viene salvata solo su quel dispositivo.\n\nSe qualcosa non si carica, YuKon3t riprova da solo e intanto mostra un piccolo avviso «Connessione lenta. Nuovo tentativo…». Senza connessione vedrai un avviso, e ciò che non si è caricato riprende appena ti riconnetti. Alcune cose YuKon3t non le controlla e possono restare lente: il segnale del tuo operatore, i video incorporati da altri siti e la qualità di una chiamata con una connessione molto debole (le chiamate adattano da sole la qualità del video alla connessione).",
  },

  "app-opens-chrome-instead-full": {
    q: "L'app si apre in Chrome invece che a schermo intero. Come lo risolvo?",
    a: "Se hai toccato un link di YuKon3t in un'altra app (un SMS, WhatsApp, un'e-mail) e si è aperto yukon3t.com in Chrome, per ora è normale: i link toccati fuori dall'app aprono il sito web. Perché si aprano direttamente nell'app serve una versione più recente dell'app, che non è ancora uscita. Per usare l'app a schermo intero, aprila dalla sua icona nella schermata home o nell'elenco delle app. I link alle pagine di YuKon3t che tocchi dentro l'app si aprono già nell'app.",
  },
  "still-get-calls-phone-asleep": {
    q: "Mi arriveranno ancora le chiamate se il telefono è in standby o bloccato?",
    a: "Sì. Una chiamata in arrivo squilla e accende lo schermo sopra la schermata di blocco anche se il telefono è in standby o in una modalità di risparmio batteria (Doze), come una normale telefonata. Puoi accettarla o rifiutarla da quella stessa schermata, oppure toccarla per aprire l'app. Per questo YuKon3t ha bisogno del permesso per le notifiche attivo (Android lo chiede la prima volta che accedi). Se le chiamate non accendono il telefono, controlla Impostazioni → App → YuKon3t → Notifiche. Se hai effettuato l'accesso su più di un telefono, rispondere o rifiutare su uno smette di far squillare gli altri, compresi gli iPhone bloccati.",
  },
  "shows-up-notification-phone": {
    q: "Cosa arriva come notifica sul mio telefono?",
    a: "Chiamate in arrivo, chiamate perse (con il nome di chi ha chiamato), messaggi (comprese le risposte alla tua storia), Mi piace, commenti e condivisioni o ricondivisioni dei tuoi post e dei tuoi video di Muse, richieste di contatto, promemoria di eventi, qualcuno che avvia una diretta solo con te, una sessione ricorrente di una collaborazione che sta per iniziare e avvisi generali sulle nuove funzioni. Tutto questo arriva come vere notifiche sul tuo telefono (Android o iPhone) anche se l'app non è aperta, non solo sull'icona della campanella dentro l'app. Toccandone una (o una notifica dell'elenco dentro l'app) si apre esattamente ciò di cui parla: il post, la Muse, la storia, la chat, l'evento, il Circle, la diretta, la collaborazione o l'elenco dei Contatti (in una chiamata persa, il profilo di chi ha chiamato), anche se l'app era in background o si ricarica con una versione più recente all'apertura. Se nel frattempo è stato eliminato, o si trova in un Circle privato di cui non fai più parte, vedrai una pagina «non trovato». Aprire l'app (da una notifica, dalla sua icona o tornando da un'altra app) cancella automaticamente dal pannello delle notifiche tutte le notifiche di questo tipo. L'unica eccezione è una chiamata che sta squillando o una chiamata persa, che restano finché non ti occupi della chiamata. L'elenco delle notifiche dentro l'app funziona in un altro modo: una notifica viene segnata come letta quando la apri dall'elenco, quando tocchi la sua notifica sul telefono o quando apri ciò di cui parla (la conversazione, il post, la Muse, il Circle, ecc.). Le altre restano non lette, e l'indicatore rosso della campanella continua a contarle, fino ad allora o finché non tocchi «Segna tutto come letto».",
  },
  "turning-up-phones-volume-unmutes": {
    q: "Alzando il volume del telefono si attiva l'audio di un video del mio feed. È normale?",
    a: "Sì, è voluto. I video del feed condividono un'unica impostazione audio per tutta l'app (tocca l'icona dell'altoparlante di un video qualsiasi o alza il volume del telefono): attivando l'audio, si attiva per tutti i video del tuo feed, compresi quelli che vedrai dopo scorrendo, come nel feed di Instagram.",
  },

  post: {
    q: "Cosa posso pubblicare?",
    a: "Testo, foto e video dal tuo dispositivo o dalla fotocamera, un'immagine presa da un URL o un link incorporato di YouTube o Vimeo. Tocca le icone della fotocamera e della foto nell'editor: ognuna apre un piccolo menu con dispositivo, fotocamera o link, così c'è un pulsante per le foto e uno per i video invece di una fila di pulsanti separati.",
  },
  "which-video-formats-upload-everyone": {
    q: "Quali formati di video posso caricare? Tutti possono vederli?",
    a: "MP4, WebM e QuickTime (.mov, quello che registra un iPhone), fino a 2 GB. Un .mov viene ricodificato in background come un normale MP4 così si riproduce in tutti i browser, non solo in Safari. Di solito ci vogliono alcuni minuti e, finché non finisce, l'originale viene riprodotto per chi usa un browser compatibile. Se un video non può essere convertito, l'originale resta com'è.",
  },
  "was-photo-video-rejected": {
    q: "Perché la mia foto o il mio video è stato rifiutato, o perché è in revisione?",
    a: "Tutto ciò che si carica passa per un controllo automatico prima che lo veda qualcun altro, e i contenuti che violano le nostre [Linee guida della community](/legal/guidelines) (il caso più frequente è il materiale sessualmente esplicito) non vengono mai pubblicati. Quando il controllo segnala un post con foto o video, il post viene salvato ma resta nascosto a tutti tranne a te, e i nostri moderatori lo esaminano: lo pubblicano così com'era o lo eliminano. Vedrai un avviso che è in attesa di revisione e non serve ricaricarlo. Finché aspetta la revisione, il suo testo non si può modificare. Un post trattenuto che nessuno ha esaminato entro 14 giorni viene eliminato insieme alle sue foto o al suo video. Inoltre, poco dopo la pubblicazione, ogni video viene controllato per intero: un modello di IA del nostro fornitore di moderazione analizza fotogrammi presi da tutto il video. Se trova un problema, non è sicuro o non riesce a elaborare il video, il video resta nascosto allo stesso modo finché un moderatore non lo esamina, e non viene eliminato mentre aspetta. Ciò che rientra nelle categorie più gravi (come i contenuti sessuali che coinvolgono minori) viene rifiutato ed eliminato subito, e non viene mai conservato per la revisione. Se un caricamento non riesce per un problema da parte nostra, l'app lo indica e basta riprovare.",
  },
  "photo-video-upload-failed": {
    q: "La mia foto o il mio video non si è caricato. Cosa faccio?",
    a: "Se un post non può essere inviato, torna all'editor con il tuo testo, il tuo pubblico e gli allegati, un messaggio che spiega cosa non ha funzionato e un pulsante **Riprova**. «Riprova» ripete solo ciò che non è stato completato: una foto o un video già caricato non viene caricato di nuovo, e se il post potrebbe essere già stato pubblicato, riprovare non lo pubblica mai due volte. Se il messaggio dice che la foto o il video non può più essere letto, sceglilo di nuovo e tocca «Pubblica». Nell'editor delle storie, una foto o un video che non può essere pubblicato mostra un messaggio suo con il motivo e cosa provare (per esempio, una copia JPEG o PNG di una foto che non si apre). Sono supportate le registrazioni dello schermo dell'iPhone, i video .MP4 e le foto HEIC.\n\nQuando un caricamento non riesce, l'app ci invia una breve nota tecnica per aiutarci a trovare la causa: quale passaggio non è riuscito, il codice di errore, il tipo di file, le dimensioni o la durata approssimative e se eri su Android, iPhone o sul web. Non include mai il file, il suo nome o il suo contenuto.",
  },
  "delete-post-report-someone-elses": {
    q: "Come elimino un post o un commento, o segnalo il post di un'altra persona?",
    a: "Apri il menu «⋯» di qualsiasi post per eliminarlo (se è tuo) o segnalarlo (di chiunque sia). Le segnalazioni vanno nella nostra coda di moderazione e vengono esaminate; in entrambi i casi viene indicato il motivo. Eliminare un commento o una risposta, su un post, una Muse o una storia, chiede sempre di confermare prima («Eliminare questo commento?») e indica se le sue risposte verranno eliminate con lui. «Annulla» è l'opzione predefinita, e non viene eliminato nulla finché non tocchi «Elimina». Questo vale anche per i commenti che rimuovi dal tuo post o dalla tua Muse.",
  },
  "share-post": {
    q: "Come condivido un post?",
    a: "Tocca l'icona di condivisione di qualsiasi post per aprire un menu: copiare il link, condividere con il menu di condivisione del tuo dispositivo, aggiungerlo alla tua storia, condividerlo su Muse (solo post con video fino a 5 minuti), inviarlo direttamente a un amico come messaggio o condividerlo in un Circle. Condividendo con il dispositivo viene allegata, quando possibile, la foto o il video vero e proprio (non solo un link), con un piccolo logo yukon3t, così app come WhatsApp o Messaggi mostrano il post vero con il marchio del posto da cui proviene. In «Invia a un amico» puoi selezionare fino a 5 chat e inviarlo a tutte insieme; lo stesso vale condividendo una Muse, una storia o qualcosa che condividi da un'altra app. Le chat segrete non compaiono in quell'elenco: ciò che condividi non entra mai in una chat segreta, perché non può essere cifrato sul tuo telefono. L'icona di condivisione compare solo sui post condivisi con Tutti: un post Solo amici o Privato non può essere repostato, aggiunto alla storia di un'altra persona né condiviso su Muse o in un Circle.",
  },
  "share-photo-video-from-another": {
    q: "Posso condividere una foto o un video da un'altra app (Instagram, TikTok, WhatsApp, ecc.) direttamente su YuKon3t?",
    a: "Sì: nel menu di condivisione di quell'app (la tua galleria, o subito dopo aver fatto uno screenshot), scegli YuKon3t come destinazione. Si apre subito una piccola finestra con un'anteprima e un testo facoltativo che ti permette di aggiungerlo alla tua storia, pubblicarlo su Muse, pubblicarlo nel feed della tua Home, pubblicarlo in uno dei tuoi Circle o inviarlo a un massimo di 5 chat. Scegli un'opzione e viene pubblicato subito (dopo aver passato lo stesso controllo automatico dei contenuti e le stesse regole di quando pubblichi dall'app), senza altri tocchi né dover andare a parte nell'editor. Più foto o screenshot insieme diventano un unico album nella Home o in un Circle, e un messaggio per foto in una chat. L'elenco dei Circle mostra solo i Circle e i canali in cui puoi pubblicare; il proprietario e i co-admin di un Circle vedono lì anche i suoi canali privati. Funziona meglio quando l'altra app consegna il file vero della foto o del video. L'azione di condivisione di alcune app invia solo un link al proprio post (è una scelta di ciascuna app, non qualcosa che YuKon3t controlli; Instagram e TikTok, tra le altre, in genere consegnano il file solo a poche app partner). Quando succede e il link è di una piattaforma video riconosciuta (YouTube, Vimeo, TikTok, Instagram, Facebook, Dailymotion), YuKon3t ti offre comunque storia, Muse e feed: il video vero si riproduce lì, proprio come quando incolli uno di quei link direttamente nell'editor del feed, solo che è moderato da quella piattaforma e non da YuKon3t. Con qualsiasi altro link, YuKon3t te lo segnala e puoi comunque inviarlo a un amico dalla stessa finestra. Funziona nell'app per Android e su iPhone (YuKon3t 1.2 o successivo) con foto, screenshot, video e link. Su Android la finestra si apre subito. Su iPhone, dopo aver scelto YuKon3t nel menu di condivisione, ciò che hai condiviso viene salvato e compare «Salvato. Apri YuKon3t per scegliere dove condividerlo.». Apri YuKon3t e compare la stessa finestra, in cui scegli la destinazione: il feed della tua Home, un Circle di cui fai parte (i canali in cui puoi pubblicare), un messaggio a un amico, oppure la tua storia o Muse.",
  },
  "react-post-something-other-than": {
    q: "Posso reagire a un post con qualcosa che non sia un cuore?",
    a: "Sì. L'icona della faccina accanto al cuore su qualsiasi post (o su un messaggio) apre prima una fila rapida di reazioni comuni, più un «+» per aprire il selettore completo delle emoji se vuoi altro. Se scegli di nuovo la stessa emoji, viene rimossa, e se ne scegli un'altra, viene cambiata. Questo è indipendente dal pulsante del cuore o «Mi piace», quindi puoi mettere «Mi piace» a un post e aggiungergli anche una reazione con un'emoji. Il selettore completo (nei post, nei commenti e nelle chat) capisce anche termini di ricerca informali e non in inglese: scrivendo «pray», «amen»/«ameen»/«aameen» o «sad» compare una piccola fila «Suggerite» con emoji correlate, sopra i risultati normali.",
  },
  "change-emoji-look-throughout-app": {
    q: "Posso cambiare l'aspetto delle emoji in tutta l'app?",
    a: "Sì. In Impostazioni → «Stile delle emoji», scegli tra lo stile nativo, quello di Apple, di Google, di Facebook o di Twitter/X. Ciò che scegli si applica ovunque compaiano le emoji: reazioni, il selettore e i messaggi.",
  },
  "send-gif": {
    q: "Posso inviare una GIF?",
    a: "Sì. Il pulsante GIF (accanto al pulsante delle emoji) nell'editor dei post, in una chat o in una casella di commento apre un motore di ricerca. Scegline una per allegarla, come allegheresti una foto.",
  },
  "videos-feed-play-automatically-no": {
    q: "Perché i video del mio feed partono da soli e senza audio?",
    a: "I video del feed partono automaticamente in silenzio quando ci arrivi scorrendo e si mettono in pausa quando li superi. Tocca l'icona dell'altoparlante del video per attivare l'audio (vedi «Alzando il volume del telefono si attiva l'audio di un video del mio feed», qui sopra) o tocca il video per metterlo in pausa o riprenderlo. Nella Home, toccando un video breve (fino a 5 minuti) lo apri a schermo intero in Muse, con l'audio: continua a scorrere per vedere altre Muse e chiudilo o torna indietro per tornare allo stesso punto del tuo feed. Il pulsante di riproduzione del video lo mette comunque in pausa lì. Toccando un nome o un link in quella vista a schermo intero, prima si chiude e poi si apre la pagina, quindi tornando indietro da lì torni al tuo feed.",
  },
  "zoom-back-out-photo-without": {
    q: "Come tolgo lo zoom da una foto senza chiudere il visualizzatore?",
    a: "Tocca una volta la foto ingrandita (un tocco singolo, non doppio) per riportarla alla dimensione originale. Il doppio tocco continua a ingrandire e ridurre come sempre; questo aggiunge solo un modo più rapido per tornare alla dimensione normale senza uscire dal visualizzatore.",
  },
  "dictate-post": {
    q: "Posso dettare un post invece di scriverlo?",
    a: "Sì. Tocca l'icona del microfono nell'editor dei post (o nella casella dei messaggi di una chat) per registrare un breve audio; viene trascritto e compare nella casella di testo perché tu lo controlli e lo modifichi prima di pubblicare o inviare. Non è lo stesso del pulsante rotondo microfono/invia di una chat, che invia la registrazione così com'è come nota vocale: il microfono per la dettatura è accanto al pulsante delle emoji e produce sempre testo modificabile. Parla nella tua lingua: l'italiano, lo spagnolo, il francese, il portoghese, l'arabo e molte altre vengono riconosciute automaticamente, a prescindere dalla lingua in cui vedi l'app.",
  },
  "difference-between-connect-subscribe": {
    q: "Che differenza c'è tra Collegati e Iscriviti?",
    a: "**Collegati** è la solita richiesta di contatto reciproca: scegli perché vuoi collegarti (amicizia, scambio culturale, professionale, community o consigli di viaggio), l'altra persona deve accettare e questo abilita messaggi e chiamate tra voi. **Iscriviti** va in una sola direzione e non richiede approvazione: iscrivendoti a qualcuno, ricevi una notifica ogni volta che pubblica, aggiunge una storia, reposta qualcosa, va in diretta, conferma la partecipazione a un evento, carica una Muse, avvia una collaborazione o crea un Circle o ne entra a far parte. Puoi iscriverti a qualcuno senza averlo tra i contatti, e viceversa. L'eccezione è che accettare una richiesta di contatto iscrive automaticamente ciascuno all'altro, quindi non serve iscriverti anche a qualcuno con cui ti sei già collegato. In seguito puoi annullare l'iscrizione senza che questo influisca sul contatto in sé. Le due icone sono accanto all'icona di condivisione su tutti i post che vedi: nella Home, nel feed di un Circle, nei risultati di ricerca e nei post delle Collab Boards. I post di un Circle pubblico notificano i tuoi iscritti e i tuoi contatti come qualsiasi post pubblico. Quelli di un Circle privato sono solo per i suoi membri, quindi non notificano nessuno da fuori e non si possono repostare né condividere al di fuori.",
  },
  "see-who-im-subscribed-whos": {
    q: "Come vedo a chi sono iscritto o chi è iscritto a me?",
    a: "Apri il profilo di una persona qualsiasi, compreso il tuo, e tocca il numero di iscritti o di iscrizioni vicino al suo nome per vedere l'elenco completo. Da quegli elenchi puoi iscriverti a una persona qualsiasi o annullare l'iscrizione direttamente, non solo da un post.",
  },
  "people-you-may-know-discover": {
    q: "Cos'è «Persone che potresti conoscere» in Scopri?",
    a: "Una fila di suggerimenti vicino alla parte alta di Scopri, ordinata per contatti in comune: persone con cui non ti sei ancora collegato e che hanno contatti in comune con te, con il numero di contatti in comune. Sono solo suggerimenti: comparire lì non avvisa nessuno né fa nulla da solo; è semplicemente un modo più rapido per trovare persone che probabilmente conosci già rispetto a filtrare tutto l'elenco di Scopri. Compare solo quando hai già almeno un contatto.",
  },
  "long-post-get-cut-off": {
    q: "Perché un post lungo viene tagliato con un link «Mostra altro»?",
    a: "I post che superano una certa lunghezza vengono accorciati nei feed così che un solo post lungo non spinga tutto il resto verso il basso. Tocca «Mostra altro» per leggere il resto lì e «Mostra meno» per richiuderlo. Questo vale ovunque siano elencati dei post, e anche per il testo proprio di un repost. Non c'è un limite rilevante alla lunghezza di un post: scrivi tutto ciò che ti serve, chi lo legge potrà sempre espanderlo.",
  },
  "got-message-saying-new-version": {
    q: "Pubblicando mi è comparso un messaggio che dice che c'è una nuova versione dell'app e di aggiornare la pagina per continuare.",
    a: "Compare quando la tua scheda era aperta da prima che rilasciassimo un aggiornamento. Non è un problema di connessione, solo una pagina non aggiornata. Aggiorna la pagina e riprova: non si perde nulla di ciò che stavi per pubblicare riprovando.",
  },
  "there-way-see-older-posts": {
    q: "C'è un modo per vedere i post più vecchi in un profilo, in un Circle o nei risultati di ricerca?",
    a: "Sì. In tutto YuKon3t, gli elementi più vecchi si caricano da soli mentre scorri, che sia nella **Home**, nei post di un profilo, nel feed di un canale di un Circle, nei risultati di ricerca, nei Contatti o negli elenchi di iscritti e iscrizioni. Non c'è nulla da toccare. (A parte, la Home aggiunge in alto automaticamente i post appena pubblicati, di solito pochi secondi dopo la pubblicazione; è diverso dal caricare ciò che sta più indietro nel feed.)",
  },
} satisfies Partial<FaqItems>;
