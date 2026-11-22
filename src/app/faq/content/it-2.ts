import type { FaqItems } from "../ids";

// Italian FAQ, part 2: Going Live, Stories, Muse, Ambient.
export const it2 = {
  "start-join-live-stream": {
    q: "Come avvio una diretta o mi unisco a una?",
    a: "Tocca «Vai in diretta» sopra il feed della Home, dai un titolo e scegli chi può vederla: **Tutti** o uno dei tuoi Circle o sub-Circle. Una diretta per Tutti o per un Circle pubblico compare in due modi nella Home finché dura: come avatar nella fascia «In diretta ora» e come scheda completa più in basso nel feed stesso, che riproduce la diretta in tempo reale, con chi trasmette, il numero di spettatori in quel momento e i pulsanti «Guarda», «Unisciti come ospite» e «Unisciti come co-host». Toccando uno qualsiasi di questi entri direttamente nella diretta con quell'opzione già scelta, senza schermate intermedie. Il video di quella scheda parte solo quando ci arrivi davvero scorrendo, quindi passarci oltre scendendo nel feed non ti conta come spettatore; fermarti sì. Le dirette di un Circle compaiono anche in una sezione «In diretta ora» in cima alla pagina di quel Circle.",
  },
  "who-see-live-stream-start": {
    q: "Chi può vedere una diretta che avvio per un Circle?",
    a: "Dipende dalla privacy del Circle. Una diretta per un Circle **pubblico** (o per Tutti) compare nella fascia «In diretta ora» della Home e chiunque può guardarla. Una diretta per un Circle o sub-Circle **privato** la vedono solo i membri di quel Circle: non compare mai nella Home né altrove nell'app, e la sua pagina, la sua chat e le sue registrazioni sono chiuse a chi non è membro, anche con il link. In entrambi i casi, scegliere un Circle o sub-Circle in «chi può vederla» definisce anche a chi *viene notificata*: tutti i membri di quel Circle o sub-Circle ricevono una notifica appena la diretta inizia, la avvii il proprietario o qualsiasi altro membro, e non l'insieme dei tuoi iscritti, nemmeno se il Circle è pubblico. Una diretta avviata per **Tutti**, invece, viene annunciata ai tuoi iscritti, come qualsiasi altro post pubblico. I membri trovano la diretta di un Circle anche nella sezione «In diretta ora» della pagina del Circle.",
  },
  "start-live-stream-just-one": {
    q: "Posso avviare una diretta con una sola persona in particolare?",
    a: "Sì. Scegli il suo nome in «Una persona specifica», nell'elenco di chi può vederla, quando avvii una diretta (lì compaiono solo i tuoi contatti). Quella diretta è privata tra voi due: non compare mai nella Home, nella pagina di un Circle né altrove, e solo quella persona (oltre a te) può vederla o unirsi; non possono i tuoi iscritti né i tuoi altri contatti. Quella persona riceve una notifica appena inizia, come con una chiamata.",
  },
  "live-only-people-i-pick": {
    q: "Posso andare in diretta solo per le persone che scelgo?",
    a: "Sì. In «In diretta con» scegli le persone (fino a 10). Appena scegli qualcuno, «Chi può vederla» passa automaticamente a **Solo le persone che ho scelto**. La diretta compare allora nella Home solo di quelle persone (e nella tua), loro ricevono una notifica nella loro lingua e nessun altro può trovarla, aprirla o entrarci, nemmeno con il link. I tuoi iscritti non ricevono alcun avviso.\n\nSe preferisci che chiunque possa guardarla, rimetti «Chi può vederla» su «Tutti» (o scegli un Circle): le persone che hai scelto vengono semplicemente invitate sul palco. Se togli tutte le persone scelte, torna su «Tutti».\n\nDurante la diretta, chi trasmette e i co-host possono invitare altre persone, e ogni persona invitata può guardarla anche lei (fino a 50 persone in tutto). Annullare un invito non ancora accettato toglie l'accesso; chi è già sul palco resta finché non esce. Rifiutare l'invito sul palco o lasciarlo scadere non toglie l'accesso: si può continuare a guardare. La pubblicazione automatica della registrazione non è disponibile per queste dirette. Se nessuna delle persone scelte può essere invitata, la diretta non parte e te lo diciamo; se solo alcune possono, parte e ti dice quante non è stato possibile invitare. Chi si vede annullare l'invito vede che la diretta non è più disponibile.",
  },
  "difference-between-watching-joining-guest": {
    q: "Che differenza c'è tra guardare, unirsi come ospite e unirsi come co-host?",
    a: "**Guardare** è solo osservare: senza accesso a fotocamera e microfono. Sia **ospite** sia **co-host** portano la tua fotocamera e il tuo microfono sul palco, in una vista a schermo diviso accanto a chi trasmette (co-host è pensato per chi aiuta a condurre e ospite per chi passa per un momento, ma funzionano allo stesso modo). I posti sul palco sono 10 in tutto, condivisi tra ospiti e co-host, oltre a chi trasmette. Una diretta ha anche un limite di quante persone possono guardarla contemporaneamente: se è al completo, vedrai un messaggio che lo indica e potrai riprovare fra un po'. Guardi una diretta alla volta: quando inizi a guardarne un'altra, esci da quella che stavi guardando. Con fino a 4 persone sul palco oltre a chi trasmette, il video è alla massima qualità; oltre, i riquadri diventano più piccoli e la qualità del video si abbassa automaticamente perché tutto resti fluido.",
  },
  "invite-people-on-stage-live": {
    q: "Posso invitare altre persone ad andare in diretta con me?",
    a: "Sì. Quando tocchi «Vai in diretta», in «In diretta con» puoi cercare persone per nome o @nomeutente e sceglierne fino a 10; ognuna compare come un'etichetta che puoi togliere prima di iniziare. Durante la diretta, chi trasmette e i co-host (nessun altro) possono invitare altre persone con il pulsante «Invita persone».\n\nLa ricerca mostra solo i tuoi collegamenti e le persone visibili nella ricerca persone, mai qualcuno che hai bloccato o che ti ha bloccato, e un invito non allarga mai chi può guardare: in una diretta per un Circle privato puoi invitare solo i suoi membri, e in una diretta con una persona specifica solo quella persona. L'eccezione è una diretta per «Solo le persone che ho scelto»: lì è proprio l'invito a permettere di guardarla.\n\nOgni persona invitata riceve una notifica nella sua lingua e, aprendo la diretta, può scegliere «Sali sul palco» o «Non ora». Se accetta, sale direttamente sul palco come ospite, senza un'altra approvazione, purché ci sia posto (fino a 10 oltre a chi trasmette). Gli inviti scadono dopo 15 minuti o quando la diretta finisce, e chi trasmette o un co-host può annullarli. Chi risponde «Non ora» non può essere invitato di nuovo a quella diretta; la stessa persona può essere invitata al massimo due volte per diretta, e c'è un limite di inviti all'ora.",
  },
  "host-mute-guest-co-host": {
    q: "Chi trasmette può silenziare un ospite o un co-host?",
    a: "Sì. Chi trasmette può toccare l'icona del microfono nel riquadro video di qualsiasi ospite o co-host per silenziare o riattivare il suo microfono per tutti quelli che stanno guardando, non solo sul suo dispositivo. Questo controllo è esclusivo di chi trasmette (un co-host non ce l'ha, anche se per il resto condivide i suoi permessi di trasmissione) e non compare mai nel tuo riquadro. Un ospite o co-host silenziato può riattivare il microfono da solo se vuole tornare a parlare: serve a risolvere in fretta il rumore di fondo o quando più persone parlano insieme, non è un blocco definitivo.",
  },
  "record-go-live-stream-take": {
    q: "Posso registrare una diretta o fare uno screenshot?",
    a: "Chi trasmette e i co-host possono toccare «Registra» per avviare una registrazione nel cloud. Quando si ferma, compare in un elenco di registrazioni della diretta con un link di download. Chiunque sia nella diretta può toccare «Screenshot» per salvare un fotogramma; il tuo browser ti chiederà di confermare cosa catturare, perché è così che funziona una cattura di video in diretta nei browser.",
  },
  "recording-stream-posted-automatically": {
    q: "Si può pubblicare automaticamente una registrazione della mia diretta?",
    a: "Sì. Se sei tu a trasmettere, tocca «Registra e pubblica» (il pulsante di registrazione con una piccola icona di casa) invece di «Registra» e basta, e quella registrazione verrà pubblicata per te quando finisce di essere elaborata: nel feed della Home se la diretta è per «Tutti», o nello stesso Circle se l'hai limitata a uno. Dopo non c'è nulla da caricare. Non è istantaneo: passa esattamente per lo stesso controllo automatico di qualsiasi altro video che pubblichi, quindi dagli qualche minuto; se il controllo rileva un problema, ti avvisiamo invece di pubblicarla. Il pulsante che hai toccato resta fissato per quella registrazione, quindi avviane una nuova se cambi idea. Questa opzione non viene offerta in una diretta che hai avviato con una sola persona in particolare: quella diretta è privata tra voi due e un post non ha un'impostazione equivalente. Lo stesso vale per una diretta per «Solo le persone che ho scelto».",
  },
  "did-live-stream-end-its": {
    q: "Perché la mia diretta è terminata da sola?",
    a: "Una diretta termina automaticamente quando chi trasmette e tutti i co-host sono rimasti assenti per 30 minuti di fila (cioè non c'è più nessuno attivo con permessi da host). È una misura di pulizia perché una diretta abbandonata non resti «live» all'infinito. Una diretta appena creata ha sempre un margine di 30 minuti, qualunque cosa succeda, così non termina mai prima che qualcuno abbia avuto una reale occasione di unirsi.",
  },
  "people-comment-during-live-stream": {
    q: "Si può commentare durante una diretta?",
    a: "Sì. Sopra la diretta c'è una casella «Scrivi qualcosa...»; chiunque la stia guardando può scrivere un commento e tutti gli altri lo vedono comparire sopra in tempo reale.",
  },
  "keep-using-app-during-call": {
    q: "Posso continuare a usare l'app durante una chiamata o una diretta?",
    a: "Sì. Tocca l'icona per ridurre a icona (in alto a destra in una chiamata, in basso a destra in una diretta) per ridurla a un piccolo riquadro video ancorato a un angolo mentre navighi nel resto dell'app. La chiamata o la diretta resta in corso tutto il tempo; tocca l'icona di espansione del riquadro per tornare a schermo intero, oppure la sua icona di riaggancio per terminarla senza espanderla prima.",
  },

  story: {
    q: "Cos'è una storia?",
    a: "Una foto, un breve video (fino a 2 minuti) o un testo scritto o incollato che compare sul tuo profilo e scompare automaticamente dopo 24 ore. Tocca il «+» sulla tua foto profilo («La tua storia» nella Home, o sul tuo profilo) e scegli «Storia» per aggiungerne una; quello stesso «+» offre anche «Post» e «Muse». Chiunque possa vedere il tuo profilo può vedere la tua storia finché è attiva. Nell'editor delle storie, «Carica dal dispositivo» ti permette di scegliere una foto o un video, compresa una registrazione dello schermo dell'iPhone.",
  },
  "post-text-only-story": {
    q: "Posso pubblicare una storia solo di testo?",
    a: "Sì. Quando aggiungi una storia, passa alla scheda «Testo» invece di scegliere una foto o un video. Scrivi o incolla ciò che vuoi dire, scegli un colore di sfondo e pubblicala. Internamente diventa un'immagine, quindi funziona esattamente come qualsiasi altra storia (scade dopo 24 ore e ammette reazioni, risposte e commenti). Può avere fino a 2000 caratteri. Se è lungo, l'immagine mostra solo l'inizio e il testo completo compare sotto con «Mostra altro». Per pubblicare più storie di testo insieme, tocca «Aggiungine un'altra» (fino a 10); ognuna viene condivisa come storia separata, nell'ordine in cui le hai create.",
  },
  "post-more-than-one-story": {
    q: "Posso pubblicare più di una storia nello stesso giorno?",
    a: "Sì. Il piccolo «+» sull'anello della tua storia (sia nella Home sia sul tuo profilo) c'è sempre: toccalo e scegli «Storia» per continuare ad aggiungerne senza limite. Quando hai una storia attiva, toccando l'anello stesso vedi quelle che hai già.",
  },
  "move-between-different-peoples-stories": {
    q: "Come passo dalle storie di una persona a quelle di un'altra?",
    a: "Mentre guardi una storia, tocca il lato destro dello schermo per avanzare tra le storie di quella stessa persona, o il lato sinistro per tornare indietro. Per saltare alle storie di un'altra persona, scorri verso sinistra (persona successiva) o verso destra (persona precedente) in qualsiasi punto dello schermo: scorrere cambia sempre persona, a prescindere da quale delle sue storie stai guardando.",
  },
  "close-story": {
    q: "Come chiudo una Storia?",
    a: "Tocca la X in alto in qualsiasi Storia o scorri verso il basso su di essa (basta un gesto rapido). Su Android, anche il pulsante Indietro o il gesto per tornare indietro la chiudono, e su un computer il tasto Esc. Se c'è qualcosa aperto sopra la Storia (i commenti, l'elenco di chi l'ha vista, la conferma di eliminazione, il foglio di condivisione o il selettore delle emoji), Indietro o Esc chiude prima quello e la Storia resta aperta. Toccando il nome della persona o un link dentro una Storia, questa si chiude e si apre quella pagina; tornando indietro da lì, torni dove eri prima di aprire la Storia. Dopo l'ultima Storia, il visualizzatore si chiude da solo.",
  },
  "people-react-reply-comment-story": {
    q: "Si può reagire, rispondere o commentare la mia storia?",
    a: "Sì, tutte e tre le cose, e sono diverse: **reagire** è un'emoji rapida (vedrai chi ha reagito aprendo la tua storia); **rispondere** invia un messaggio diretto privato e funziona solo tra persone che sono già contatti, come i messaggi normali; **commentare** pubblica un commento pubblico che può vedere chiunque stia guardando la storia, visibile dall'icona dei commenti accanto alle reazioni, e ricevi una notifica quando qualcuno commenta la tua. C'è anche un'icona di **condivisione** accanto ai commenti su qualsiasi storia: chiunque possa vedere la storia, non solo chi l'ha pubblicata, può toccarla per inoltrarla a uno dei suoi messaggi diretti o a una chat di gruppo. Chi la riceve vede la vera storia nella chat e può toccarla per aprirla a schermo intero, con la stessa vista della fila delle storie, invece di un semplice messaggio di testo su di essa. Le persone con cui condividi una storia ricevono una notifica, come per un messaggio normale.",
  },
  "like-story": {
    q: "Posso mettere Mi piace a una storia, e chi lo vede?",
    a: "Sì. Tocca il cuore accanto alla casella di risposta nella storia di chiunque per mettere Mi piace; toccalo di nuovo per toglierlo. Solo chi ha pubblicato la storia può vedere quanti Mi piace ha e a chi è piaciuta: quando apri la tua storia, il cuore accanto al numero di visualizzazioni mostra quanti sono, e l'elenco di chi l'ha vista segna con un cuore tutte le persone a cui è piaciuta. Sulla tua storia non c'è un cuore da toccare. Nessun altro vede il numero né a chi è piaciuta, e nessuno vede il tuo Mi piace. La persona riceve una sola notifica la prima volta che metti Mi piace a una storia (rimetterlo più tardi non ne invia un'altra). Puoi mettere Mi piace solo a una storia che riesci a vedere, e i Mi piace spariscono con la storia dopo 24 ore. Mettere Mi piace è diverso dal reagire con un'emoji.",
  },

  "muse-2": {
    q: "Cos'è Muse?",
    a: "Una scheda dedicata a video brevi, divertenti e creativi: a schermo intero, uno alla volta; scorri verso il basso per vedere il successivo e verso l'alto per il precedente (un normale feed a scorrimento, non un gesto di swipe). A differenza di una storia, una Muse non scade dopo 24 ore e, a differenza del feed della tua Home, non è limitata ai tuoi contatti: tutte le Muse sono visibili a tutte le persone di YuKon3t. È un feed per scoprire, non solo di contatti.",
  },
  "post-muse": {
    q: "Come pubblico una Muse?",
    a: "Apri il tuo profilo e tocca «Pubblica una Muse», oppure tocca il «+» sulla tua foto profilo (nella Home o sul tuo profilo) e scegli «Muse». Scegli un video (fino a 5 minuti), aggiungi un testo se vuoi e pubblicalo. Tutto qui, senza altre schermate. Un video più lungo (di più di un minuto, circa) passa per un ulteriore controllo automatico di sicurezza prima di essere visibile agli altri, e può volerci un po' più che con una clip breve. Prima di pubblicare puoi anche scegliere «Audio personale» per allegare un file audio a parte che sostituisce del tutto l'audio del video (l'idea di «aggiungi un suono» di TikTok). Scegli «Audio originale» (l'opzione predefinita) per mantenere l'audio del video.",
  },
  "delete-muse-after-ive-posted": {
    q: "Posso eliminare una Muse dopo averla pubblicata?",
    a: "Sì. Apri la Muse nel feed di Muse e tocca l'icona del cestino vicino alla parte alta (visibile solo sulle tue Muse); poi toccala di nuovo per confermare. Viene eliminata subito e in modo permanente, per te e per tutti gli altri.",
  },
  "share-reshare-follow-muse": {
    q: "Posso condividere, ricondividere o seguire qualcuno su Muse?",
    a: "Sì, tutte e tre le opzioni sono accanto ai pulsanti dei commenti e dei Mi piace di ogni Muse. L'icona di condivisione apre un pannello: condividila nella tua **Home**, aggiungila alla tua **storia** (per Muse fino a 2 minuti), inviala a un amico o a un gruppo, usa il menu di condivisione del tuo dispositivo o copia il link. Home, storia, amici e il menu di condivisione del dispositivo inviano il video vero, non solo un link. L'icona di ricondivisione (una freccia circolare) mette il video nella tua Home con un solo tocco: dà credito a chi l'ha creato, gli invia una notifica e, se la tocchi di nuovo, lo toglie. «Iscriviti», accanto al nome di chi l'ha creato, serve a seguire quella persona e sapere dei suoi prossimi post. Niente di tutto questo richiede di avere prima quella persona tra i tuoi contatti, come mettere Mi piace o commentare.",
  },
  "share-post-muse": {
    q: "Posso condividere un post su Muse?",
    a: "Sì. Qualsiasi post con un video (fino a 5 minuti) si può condividere su Muse: apri il menu di condivisione di quel post e tocca «Condividi su Muse». Diventa una nuova Muse a tuo nome, che dà credito all'originale con un link «Vedi il post originale»; chi ha pubblicato l'originale riceve una notifica e viene contato come una condivisione, come condividendolo nella tua storia o in un Circle. I post senza video (testo, foto, link, contenuti incorporati, GIF) non si possono condividere su Muse: non esiste un formato di Muse senza video.",
  },
  "muse-feed-copy-same-likes": {
    q: "Quando una Muse e un post dello stesso video condividono un solo contatore di Mi piace?",
    a: "La tua Muse e la tua copia di essa nel feed condividono un solo contatore di Mi piace: quando ricondividi la tua Muse nella Home, o condividi su Muse il tuo post con video, i due mostrano lo stesso numero, quello delle persone distinte a cui è piaciuto uno dei due, senza contare nessuno due volte. Se metti Mi piace a uno, compare anche sull'altro (dove puoi vederlo), e se lo togli, si toglie da entrambi. Una copia fatta da un'altra persona (quando ricondivide la tua Muse o crea una Muse dal tuo post) ha il suo contatore: i Mi piace che riceve restano lì, e quelli del tuo restano al tuo. Una Muse ha un pulsante a cuore per mettere Mi piace; una reazione con emoji che avevi lasciato prima su una Muse continua a contare come tuo Mi piace (il cuore appare pieno), e toccando il cuore viene tolta. Chi ha pubblicato riceve una notifica solo la prima volta che metti Mi piace a una delle sue due copie. I repost normali di un post contano già i loro Mi piace sul post originale.",
  },
  "view-count-muse-mean": {
    q: "Cosa significa il numero di visualizzazioni di una Muse?",
    a: "L'icona dell'occhio sotto il testo conta quante volte è stata vista quella Muse, comprese le volte che l'hai vista tu. È un totale cumulativo, non un numero di spettatori unici.",
  },
  "muse-play-sound": {
    q: "Muse si riproduce con l'audio?",
    a: "Sì. Muse inizia a riprodursi con l'audio attivo appena si apre; tocca l'icona dell'altoparlante vicino alla parte alta dello schermo per silenziarla, e resterà in silenzio quando passi alla Muse successiva. Alcuni browser non riproducono l'audio finché non tocchi la pagina una volta. Se il tuo fa così, il video si riproduce in silenzio con l'avviso «Tocca per attivare l'audio», e il tuo tocco successivo attiva l'audio.",
  },
  "react-comment-muse": {
    q: "Posso mettere Mi piace o commentare una Muse?",
    a: "Sì. Tocca il cuore a destra per mettere Mi piace a una Muse (diventa rosso; toccalo di nuovo per toglierlo), e il numero sotto indica a quante persone è piaciuta. Una reazione con emoji che avevi lasciato su una Muse prima che arrivasse il cuore continua a contare come tuo Mi piace. Le emoji e le GIF sono nei commenti: la casella dei commenti ha una fila di emoji rapide, un selettore completo di emoji e una ricerca di GIF.\n\nTieni premuto su un video di Muse per metterlo in pausa finché lo tieni premuto, oppure toccalo per metterlo in pausa: una barra in basso mostra allora a che punto è il video e la sua durata totale (per esempio, 0:12 / 0:45). Trascina lungo la barra per saltare a un altro momento; il video prosegue da lì se era in riproduzione. Con una tastiera, la barra si può mettere a fuoco e spostare con le frecce (5 secondi alla volta). La barra non compare nei video incorporati da un altro sito (YouTube, TikTok e simili), il cui lettore ha i propri controlli.\n\nTocca l'icona dei commenti: il video continua a riprodursi in una piccola scheda arrotondata in alto mentre i commenti occupano la parte bassa dello schermo. Tocca il video, trascina verso il basso la barra in cima ai commenti o torna indietro per tornare al video a schermo intero. Chi ha creato la Muse, chi ha scritto il commento o un amministratore possono rimuovere qualsiasi commento.",
  },
  "muse-comment-replies-likes-gifs": {
    q: "Come funzionano le risposte, i Mi piace, le emoji e le GIF nei commenti di una Muse?",
    a: "Tocca **Rispondi** sotto un commento per rispondergli: la casella mostra «In risposta a» con il nome della persona e inizia con il suo @utente (puoi annullare la risposta). Le risposte compaiono sotto il commento a cui rispondono, su un solo livello: se rispondi a una risposta, la tua si aggiunge allo stesso thread e menziona con @ la persona a cui hai risposto. Tocca «Vedi risposte» per aprire un thread e «Nascondi le risposte» per chiuderlo. Tocca il cuore accanto a un commento o a una risposta per mettere Mi piace; il numero accanto indica a quante persone è piaciuto.\n\nAccanto alla casella dei commenti, il pulsante delle emoji apre un selettore completo di emoji al posto della tastiera, e il pulsante GIF apre una ricerca di GIF (le GIF arrivano da GIPHY). Un commento o una risposta può essere testo, una GIF o entrambi. Le emoji che hai usato di recente compaiono per prime e vengono salvate solo sul tuo dispositivo. La persona a cui hai risposto riceve una notifica, e chi ha creato la Muse riceve una notifica per ogni nuovo commento o risposta, mai due per lo stesso.\n\nPuoi eliminare i tuoi commenti e le tue risposte, e chi ha creato la Muse può eliminare qualsiasi commento o risposta sulla sua Muse; eliminando un commento vengono eliminate anche le sue risposte. I commenti e le risposte di account che hai bloccato (o che ti hanno bloccato) o che non sono più attivi non vengono mostrati, e non viene pubblicato il testo che il nostro controllo automatico segnala. I commenti di una Muse non si possono modificare; per segnalarne uno, segnala la persona che l'ha scritto.",
  },
  "need-keep-scrolling-see-theres": {
    q: "Devo continuare a scorrere per sapere se ce ne sono altre?",
    a: "No. Muse carica il gruppo successivo di video in background quando ti avvicini alla fine di quelli già caricati, quindi lo scorrimento sembra continuo.",
  },

  "ambient-2": {
    q: "Cos'è Ambient?",
    a: "Impostazioni → «Ambient» ti permette di scegliere un piccolo Inner Circle (fino a 8 persone che sono già tuoi contatti) e condividere «momenti» in foto, informali, che solo loro possono vedere, invece di un post pubblico più elaborato. Un momento scompare dopo 48 ore.",
  },
  "who-see-ambient-moments": {
    q: "Chi può vedere i miei momenti di Ambient?",
    a: "Solo le persone che hanno aggiunto *te* al proprio Inner Circle. Nessun altro, e non compaiono mai sul tuo profilo pubblico, nel feed né in Scopri. Aggiungere qualcuno al tuo Inner Circle va in una sola direzione, come iscriversi: quella persona non ha bisogno di aggiungerti perché tu veda i suoi. Inoltre, devono essere ancora in contatto con te: se uno dei due blocca l'altro o non siete più in contatto, i tuoi momenti smettono di essere mostrati a quella persona (e bloccando, ciascuno esce dall'Inner Circle dell'altro).",
  },
  "there-lock-screen-watch-widget": {
    q: "C'è un widget per la schermata di blocco o per lo smartwatch?",
    a: "Non ancora. Serve un vero sviluppo nativo per ogni piattaforma. Nel frattempo, Impostazioni → «Ambient» mostra dentro l'app un'anteprima di come sarebbe il tuo feed Ambient, e puoi già generare un token di accesso per i widget, per quando ne esisterà uno.",
  },
} satisfies Partial<FaqItems>;
