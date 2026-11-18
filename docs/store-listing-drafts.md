# Store listing drafts (App Store + Google Play)

Drafts only: nothing here is live until the owner pastes it into App Store Connect / Play Console. Every claim was
checked against the app and the FAQ (src/app/faq) on 2026-11-18. Rules followed:

- No ratings, user counts, awards, "best", "#1" or price claims; no competitor names (in text or keywords); no
  "alternative to ..." phrasing.
- "Verified" means what the app does: every account confirms an email address or phone number before messaging. It
  is not ID verification, so the text never says "ID-verified" or "real identity".
- Not mentioned because they are not available to everyone: gifts and challenges (admins only), paid features (none
  exist), ad booking (web only, hidden in the iOS app), links opening the installed app from other apps (needs a
  native release).
- Swahili: Google Play supports it (sw); App Store Connect has no Swahili localization, so Swahili is Play only.
- Lengths were counted in characters (`docs/store-listing-drafts.md` is checked by
  `src/lib/store-listing-drafts.test.ts`). Limits: App Store name 30, subtitle 30, keywords 100 (comma-separated,
  no spaces, no app name, no competitor names), promotional text 170, description 4000; Google Play title 30,
  short description 80, full description 4000.
- Translations were written for this draft, not by native speakers. Have each one read by a native speaker before
  publishing (Arabic and Hindi in particular).

Suggested App Store Connect localizations: English (U.S.) en-US, Spanish (Spain) es-ES and Spanish (Mexico) es-MX
(same text), French fr-FR, Portuguese (Brazil) pt-BR, Arabic ar-SA, German de-DE, Italian it, Hindi hi.
Google Play: en-US, es-ES, es-419, fr-FR, pt-BR, ar, de-DE, it-IT, hi-IN, sw.

---

## English (en-US)

App Store name (max 30):
```text
YuKon3t: Friends Worldwide
```

App Store subtitle (max 30):
```text
Cultures, Circles and Live
```

App Store keywords (max 100):
```text
friends,culture,diaspora,community,stories,shortvideo,livestream,chat,groups,penpal,language,abroad
```

App Store promotional text (max 170):
```text
Make friends across cultures and the diaspora. Share Stories, watch Muse videos, join private Circles and go live with up to 10 guests.
```

Google Play title (max 30):
```text
YuKon3t: Friends Worldwide
```

Google Play short description (max 80):
```text
Make friends across cultures: Stories, Muse videos, private Circles and Live.
```

Description (App Store) / full description (Google Play) (max 4000):
```text
YuKon3t helps you stay close to friends and family across borders, and meet people who share your interests, your language or your culture.

FRIENDS ACROSS CULTURES AND THE DIASPORA
Find people by country, language or interest, and say what you're here for: friendship, cultural exchange, community, professional ties or travel tips.

STORIES WITH HEARTS
Share photos and videos that disappear after 24 hours. Friends can reply or tap the heart, and only you see who liked your Story.

MUSE SHORT VIDEOS
A full-screen feed of short, funny and creative videos that everyone on YuKon3t can watch, like and comment on.

PRIVATE CIRCLES AND COLLAB BOARDS
Start a free Circle for a hobby, a cause or a culture, and keep it invite-only if you like. Collab Boards bring people together across countries for skill swaps, study groups and projects.

GO LIVE WITH UP TO 10 GUESTS
Stream live, invite up to 10 people onto the stage with you, and choose who can watch, down to only the people you pick.

CHAT, CALLS AND SHARED SHOPPING LISTS
Message one-to-one or in groups, make voice and video calls, and send a shopping list everyone in the chat can tick off and add to as it happens.

BIRTHDAY AND HOLIDAY REMINDERS
Get a reminder on the birthdays your friends choose to share, and a note on public holidays in your country. You can turn holiday reminders off in Settings.

NINE LANGUAGES
Use YuKon3t in English, Spanish, French, Portuguese, Arabic, German, Italian, Hindi or Swahili, and switch whenever you like.

A SAFER COMMUNITY
Every account confirms an email address or phone number before it can send messages. Posts, photos and videos are checked against our Community Guidelines, you can report or block anyone, and every action taken on an account comes with a stated reason and a way to appeal.

YOUR DATA STAYS YOURS
Download a copy of your data or delete your account from Settings, free.

YuKon3t is for people aged 16 and over.
```

---

## Spanish (es-ES / es-MX / es-419)

App Store name (max 30):
```text
YuKon3t: Amigos del mundo
```

App Store subtitle (max 30):
```text
Culturas, Circles y directos
```

App Store keywords (max 100):
```text
amigos,cultura,diáspora,comunidad,historias,videos,directo,chat,grupos,idiomas,extranjero,amistad
```

App Store promotional text (max 170):
```text
Haz amigos de otras culturas y de la diáspora. Comparte historias, mira vídeos de Muse, únete a Circles privados y emite en directo con hasta 10 invitados.
```

Google Play title (max 30):
```text
YuKon3t: Amigos del mundo
```

Google Play short description (max 80):
```text
Amigos de otras culturas: historias, vídeos Muse, Circles privados y directos.
```

Description (App Store) / full description (Google Play) (max 4000):
```text
YuKon3t te ayuda a mantenerte cerca de amigos y familia al otro lado de la frontera, y a conocer a personas que comparten tus intereses, tu idioma o tu cultura.

AMIGOS DE OTRAS CULTURAS Y DE LA DIÁSPORA
Encuentra personas por país, idioma o interés, y di qué buscas: amistad, intercambio cultural, comunidad, contactos profesionales o consejos de viaje.

HISTORIAS CON CORAZONES
Comparte fotos y vídeos que desaparecen a las 24 horas. Tus amigos pueden responder o tocar el corazón, y solo tú ves a quién le ha gustado tu historia.

VÍDEOS CORTOS EN MUSE
Un feed a pantalla completa de vídeos cortos, divertidos y creativos que todo el mundo en YuKon3t puede ver, marcar con me gusta y comentar.

CIRCLES PRIVADOS Y COLLAB BOARDS
Crea gratis un Circle para una afición, una causa o una cultura, y hazlo solo por invitación si quieres. Los Collab Boards reúnen a personas de distintos países para intercambiar habilidades, estudiar en grupo o sacar adelante proyectos.

DIRECTOS CON HASTA 10 INVITADOS
Emite en directo, invita a hasta 10 personas a subir al escenario contigo y elige quién puede verlo, incluso solo las personas que tú elijas.

CHAT, LLAMADAS Y LISTAS DE LA COMPRA
Escribe en privado o en grupo, haz llamadas de voz y vídeo, y envía una lista de la compra que todos en el chat pueden marcar y ampliar al momento.

CUMPLEAÑOS Y FESTIVOS
Recibe un recordatorio en los cumpleaños que tus amigos deciden compartir y un aviso en los festivos de tu país, que puedes desactivar en Ajustes.

NUEVE IDIOMAS
Usa YuKon3t en inglés, español, francés, portugués, árabe, alemán, italiano, hindi o suajili, y cambia cuando quieras.

UNA COMUNIDAD MÁS SEGURA
Cada cuenta confirma un email o un número de teléfono antes de poder enviar mensajes. Las publicaciones, fotos y vídeos se revisan según nuestras Normas de la comunidad, puedes denunciar o bloquear a cualquiera, y cada medida sobre una cuenta incluye el motivo y una vía de apelación.

Descarga una copia de tus datos o elimina tu cuenta desde Ajustes, gratis. YuKon3t es para mayores de 16 años.
```

---

## French (fr-FR)

App Store name (max 30):
```text
YuKon3t : amis du monde
```

App Store subtitle (max 30):
```text
Cultures, Circles et lives
```

App Store keywords (max 100):
```text
amis,culture,diaspora,communauté,stories,vidéos,direct,chat,groupes,langues,expatrié,amitié
```

App Store promotional text (max 170):
```text
Faites-vous des amis d'autres cultures et de la diaspora. Partagez des stories, regardez Muse, rejoignez des Circles privés et lancez un live avec 10 invités.
```

Google Play title (max 30):
```text
YuKon3t : amis du monde
```

Google Play short description (max 80):
```text
Des amis de toutes cultures : stories, vidéos Muse, Circles privés et lives.
```

Description (App Store) / full description (Google Play) (max 4000):
```text
YuKon3t vous aide à rester proche de vos amis et de votre famille par-delà les frontières, et à rencontrer des personnes qui partagent vos centres d'intérêt, votre langue ou votre culture.

DES AMIS DE TOUTES CULTURES ET DE LA DIASPORA
Trouvez des personnes par pays, langue ou centre d'intérêt, et dites ce que vous cherchez : amitié, échange culturel, communauté, contacts professionnels ou conseils de voyage.

DES STORIES AVEC DES CŒURS
Partagez des photos et des vidéos qui disparaissent après 24 heures. Vos amis peuvent répondre ou toucher le cœur, et vous seul voyez qui a aimé votre story.

LES VIDÉOS COURTES DE MUSE
Un fil plein écran de vidéos courtes, drôles et créatives que tout le monde sur YuKon3t peut regarder, aimer et commenter.

CIRCLES PRIVÉS ET COLLAB BOARDS
Créez gratuitement un Circle autour d'un loisir, d'une cause ou d'une culture, et réservez-le aux invités si vous le souhaitez. Les Collab Boards réunissent des personnes de différents pays pour échanger des compétences, étudier ensemble ou mener des projets.

DES LIVES AVEC JUSQU'À 10 INVITÉS
Diffusez en direct, invitez jusqu'à 10 personnes sur scène avec vous et choisissez qui peut regarder, jusqu'à seulement les personnes que vous désignez.

MESSAGES, APPELS ET LISTES DE COURSES
Écrivez en privé ou en groupe, passez des appels audio et vidéo, et envoyez une liste de courses que chacun dans la conversation peut cocher et compléter en direct.

ANNIVERSAIRES ET JOURS FÉRIÉS
Recevez un rappel pour les anniversaires que vos amis choisissent de partager, et un mot les jours fériés de votre pays, désactivable dans les Paramètres.

NEUF LANGUES
Utilisez YuKon3t en anglais, espagnol, français, portugais, arabe, allemand, italien, hindi ou swahili, et changez quand vous voulez.

UNE COMMUNAUTÉ PLUS SÛRE
Chaque compte confirme une adresse e-mail ou un numéro de téléphone avant de pouvoir envoyer des messages. Les publications, photos et vidéos sont vérifiées selon nos Règles de la communauté, vous pouvez signaler ou bloquer n'importe qui, et chaque mesure prise sur un compte est motivée et peut faire l'objet d'un recours.

Téléchargez une copie de vos données ou supprimez votre compte depuis les Paramètres, gratuitement. YuKon3t est réservé aux personnes de 16 ans et plus.
```

---

## Portuguese (pt-BR)

App Store name (max 30):
```text
YuKon3t: Amigos pelo mundo
```

App Store subtitle (max 30):
```text
Culturas, Circles e lives
```

App Store keywords (max 100):
```text
amigos,cultura,diáspora,comunidade,stories,vídeos,aovivo,chat,grupos,idiomas,exterior,amizade
```

App Store promotional text (max 170):
```text
Faça amigos de outras culturas e da diáspora. Compartilhe stories, assista a vídeos do Muse, entre em Circles privados e faça lives com até 10 convidados.
```

Google Play title (max 30):
```text
YuKon3t: Amigos pelo mundo
```

Google Play short description (max 80):
```text
Amigos de outras culturas: stories, vídeos Muse, Circles privados e lives.
```

Description (App Store) / full description (Google Play) (max 4000):
```text
O YuKon3t ajuda você a ficar perto de amigos e família do outro lado da fronteira e a conhecer pessoas que compartilham seus interesses, seu idioma ou sua cultura.

AMIGOS DE OUTRAS CULTURAS E DA DIÁSPORA
Encontre pessoas por país, idioma ou interesse e diga o que você procura: amizade, intercâmbio cultural, comunidade, contatos profissionais ou dicas de viagem.

STORIES COM CORAÇÕES
Compartilhe fotos e vídeos que somem depois de 24 horas. Seus amigos podem responder ou tocar no coração, e só você vê quem curtiu seu story.

VÍDEOS CURTOS NO MUSE
Um feed em tela cheia de vídeos curtos, engraçados e criativos que todo mundo no YuKon3t pode assistir, curtir e comentar.

CIRCLES PRIVADOS E COLLAB BOARDS
Crie de graça um Circle para um hobby, uma causa ou uma cultura e deixe-o só para convidados, se quiser. Os Collab Boards reúnem pessoas de vários países para trocar habilidades, estudar em grupo e tocar projetos.

LIVES COM ATÉ 10 CONVIDADOS
Transmita ao vivo, convide até 10 pessoas para o palco com você e escolha quem pode assistir, até mesmo só as pessoas que você selecionar.

CHAT, CHAMADAS E LISTAS DE COMPRAS
Converse em particular ou em grupo, faça chamadas de voz e vídeo e envie uma lista de compras que todos no chat podem marcar e completar na hora.

ANIVERSÁRIOS E FERIADOS
Receba um lembrete nos aniversários que seus amigos escolhem compartilhar e um aviso nos feriados do seu país, que você pode desativar em Configurações.

NOVE IDIOMAS
Use o YuKon3t em inglês, espanhol, francês, português, árabe, alemão, italiano, hindi ou suaíli e troque quando quiser.

UMA COMUNIDADE MAIS SEGURA
Toda conta confirma um e-mail ou número de telefone antes de poder enviar mensagens. Posts, fotos e vídeos são verificados segundo as nossas Diretrizes da comunidade, você pode denunciar ou bloquear qualquer pessoa, e toda medida tomada sobre uma conta vem com o motivo e uma forma de recorrer.

Baixe uma cópia dos seus dados ou exclua sua conta em Configurações, de graça. O YuKon3t é para maiores de 16 anos.
```

---

## Arabic (ar-SA / ar)

App Store name (max 30):
```text
YuKon3t: أصدقاء حول العالم
```

App Store subtitle (max 30):
```text
ثقافات وCircles وبث مباشر
```

App Store keywords (max 100):
```text
أصدقاء,ثقافة,مغتربين,مجتمع,قصص,فيديو,بث,دردشة,مجموعات,لغات,تعارف,صداقة
```

App Store promotional text (max 170):
```text
كوّن صداقات مع أشخاص من ثقافات أخرى ومن المغتربين. شارك القصص وشاهد فيديوهات Muse وانضم إلى Circles خاصة وابدأ بثًا مباشرًا مع ما يصل إلى 10 ضيوف.
```

Google Play title (max 30):
```text
YuKon3t: أصدقاء حول العالم
```

Google Play short description (max 80):
```text
أصدقاء من ثقافات أخرى: قصص وفيديوهات Muse وCircles خاصة وبث مباشر.
```

Description (App Store) / full description (Google Play) (max 4000):
```text
يساعدك YuKon3t على البقاء قريبًا من أصدقائك وعائلتك عبر الحدود، والتعرّف إلى أشخاص يشاركونك اهتماماتك أو لغتك أو ثقافتك.

أصدقاء من ثقافات مختلفة ومن المغتربين
ابحث عن أشخاص حسب البلد أو اللغة أو الاهتمام، وقل ما الذي جئت من أجله: صداقة أو تبادل ثقافي أو مجتمع أو علاقات مهنية أو نصائح سفر.

قصص مع قلوب
شارك صورًا وفيديوهات تختفي بعد 24 ساعة. يمكن لأصدقائك الرد أو الضغط على القلب، وأنت وحدك ترى من أعجبته قصتك.

فيديوهات Muse القصيرة
خلاصة بملء الشاشة من الفيديوهات القصيرة والمضحكة والمبدعة، يمكن لكل من على YuKon3t مشاهدتها والإعجاب بها والتعليق عليها.

Circles خاصة وCollab Boards
أنشئ مجانًا Circle لهواية أو قضية أو ثقافة، واجعله بالدعوة فقط إن أردت. وتجمع Collab Boards أشخاصًا من بلدان مختلفة لتبادل المهارات والدراسة الجماعية والمشاريع.

بث مباشر مع ما يصل إلى 10 ضيوف
ابدأ بثًا مباشرًا، وادعُ ما يصل إلى 10 أشخاص إلى المنصة معك، واختر من يمكنه المشاهدة، حتى لو كانوا فقط من تختارهم بنفسك.

دردشة ومكالمات وقوائم تسوّق
راسل الآخرين فرديًا أو في مجموعات، وأجرِ مكالمات صوتية ومرئية، وأرسل قائمة تسوّق يمكن لكل من في الدردشة تحديد عناصرها والإضافة إليها فورًا.

أعياد الميلاد والعطلات
تلقَّ تذكيرًا بأعياد الميلاد التي يختار أصدقاؤك مشاركتها، وتنبيهًا في العطلات الرسمية في بلدك، ويمكنك إيقافه من الإعدادات.

تسع لغات
استخدم YuKon3t بالإنجليزية أو الإسبانية أو الفرنسية أو البرتغالية أو العربية أو الألمانية أو الإيطالية أو الهندية أو السواحيلية، وغيّر اللغة متى شئت.

مجتمع أكثر أمانًا
يؤكّد كل حساب بريدًا إلكترونيًا أو رقم هاتف قبل أن يتمكن من إرسال الرسائل. تُراجَع المنشورات والصور والفيديوهات وفق إرشادات المجتمع، ويمكنك الإبلاغ عن أي شخص أو حظره، وكل إجراء يُتخذ بحق حساب يأتي مع سببه وطريقة للاعتراض.

نزّل نسخة من بياناتك أو احذف حسابك من الإعدادات مجانًا. YuKon3t مخصص لمن هم في سن 16 عامًا فأكثر.
```

---

## German (de-DE)

App Store name (max 30):
```text
YuKon3t: Freunde weltweit
```

App Store subtitle (max 30):
```text
Kulturen, Circles und Live
```

App Store keywords (max 100):
```text
freunde,kultur,diaspora,community,storys,videos,livestream,chat,gruppen,sprachen,brieffreunde
```

App Store promotional text (max 170):
```text
Finde Freunde aus anderen Kulturen und der Diaspora. Teile Storys, schau Muse-Videos, tritt privaten Circles bei und geh mit bis zu 10 Gästen live.
```

Google Play title (max 30):
```text
YuKon3t: Freunde weltweit
```

Google Play short description (max 80):
```text
Freunde aus aller Welt: Storys, Muse-Videos, private Circles und Livestreams.
```

Description (App Store) / full description (Google Play) (max 4000):
```text
Mit YuKon3t bleibst du Freunden und Familie über Grenzen hinweg nah und lernst Menschen kennen, die deine Interessen, deine Sprache oder deine Kultur teilen.

FREUNDE AUS ANDEREN KULTUREN UND DER DIASPORA
Finde Menschen nach Land, Sprache oder Interesse und sag, wofür du hier bist: Freundschaft, kultureller Austausch, Community, berufliche Kontakte oder Reisetipps.

STORYS MIT HERZEN
Teile Fotos und Videos, die nach 24 Stunden verschwinden. Freunde können antworten oder auf das Herz tippen, und nur du siehst, wem deine Story gefällt.

KURZE VIDEOS AUF MUSE
Ein Vollbild-Feed mit kurzen, lustigen und kreativen Videos, die alle auf YuKon3t ansehen, liken und kommentieren können.

PRIVATE CIRCLES UND COLLAB BOARDS
Gründe kostenlos einen Circle für ein Hobby, ein Anliegen oder eine Kultur und mach ihn auf Wunsch nur auf Einladung zugänglich. Collab Boards bringen Menschen aus verschiedenen Ländern für Wissensaustausch, Lerngruppen und Projekte zusammen.

LIVE MIT BIS ZU 10 GÄSTEN
Geh live, lade bis zu 10 Personen zu dir auf die Bühne ein und bestimme, wer zusehen darf, bis hin zu nur den Leuten, die du auswählst.

CHAT, ANRUFE UND EINKAUFSLISTEN
Schreib einzeln oder in Gruppen, führe Sprach- und Videoanrufe und schick eine Einkaufsliste, die alle im Chat sofort abhaken und ergänzen können.

GEBURTSTAGE UND FEIERTAGE
Lass dich an die Geburtstage erinnern, die deine Freunde teilen, und an gesetzliche Feiertage in deinem Land, was du in den Einstellungen ausschalten kannst.

NEUN SPRACHEN
Nutze YuKon3t auf Englisch, Spanisch, Französisch, Portugiesisch, Arabisch, Deutsch, Italienisch, Hindi oder Swahili und wechsle, wann du willst.

EINE SICHERERE COMMUNITY
Jedes Konto bestätigt eine E-Mail-Adresse oder Telefonnummer, bevor es Nachrichten senden kann. Beiträge, Fotos und Videos werden anhand unserer Community-Richtlinien geprüft, du kannst jede Person melden oder blockieren, und jede Maßnahme gegen ein Konto kommt mit Begründung und Einspruchsmöglichkeit.

Lade eine Kopie deiner Daten herunter oder lösche dein Konto in den Einstellungen, kostenlos. YuKon3t ist für Menschen ab 16 Jahren.
```

---

## Italian (it)

App Store name (max 30):
```text
YuKon3t: Amici nel mondo
```

App Store subtitle (max 30):
```text
Culture, Circles e dirette
```

App Store keywords (max 100):
```text
amici,cultura,diaspora,comunità,storie,video,diretta,chat,gruppi,lingue,estero,amicizia
```

App Store promotional text (max 170):
```text
Fai amicizia con persone di altre culture e della diaspora. Condividi storie, guarda i video di Muse, entra nei Circles privati e vai in diretta con 10 ospiti.
```

Google Play title (max 30):
```text
YuKon3t: Amici nel mondo
```

Google Play short description (max 80):
```text
Amici di altre culture: storie, video Muse, Circles privati e dirette.
```

Description (App Store) / full description (Google Play) (max 4000):
```text
YuKon3t ti aiuta a restare vicino ad amici e familiari oltre i confini e a conoscere persone che condividono i tuoi interessi, la tua lingua o la tua cultura.

AMICI DI ALTRE CULTURE E DELLA DIASPORA
Trova persone per paese, lingua o interesse e di' cosa cerchi: amicizia, scambio culturale, comunità, contatti professionali o consigli di viaggio.

STORIE CON I CUORI
Condividi foto e video che spariscono dopo 24 ore. Gli amici possono rispondere o toccare il cuore, e solo tu vedi a chi è piaciuta la tua storia.

VIDEO BREVI SU MUSE
Un feed a schermo intero di video brevi, divertenti e creativi che chiunque su YuKon3t può guardare, apprezzare e commentare.

CIRCLES PRIVATI E COLLAB BOARDS
Crea gratis un Circle per un hobby, una causa o una cultura, e rendilo solo su invito se vuoi. I Collab Boards riuniscono persone di paesi diversi per scambiarsi competenze, studiare in gruppo e portare avanti progetti.

DIRETTE CON FINO A 10 OSPITI
Trasmetti in diretta, invita fino a 10 persone sul palco con te e scegli chi può guardare, anche solo le persone che selezioni tu.

CHAT, CHIAMATE E LISTE DELLA SPESA
Scrivi in privato o in gruppo, fai chiamate vocali e video e invia una lista della spesa che tutti nella chat possono spuntare e completare all'istante.

COMPLEANNI E FESTIVITÀ
Ricevi un promemoria per i compleanni che i tuoi amici scelgono di condividere e un avviso nei giorni festivi del tuo paese, che puoi disattivare nelle Impostazioni.

NOVE LINGUE
Usa YuKon3t in inglese, spagnolo, francese, portoghese, arabo, tedesco, italiano, hindi o swahili, e cambia quando vuoi.

UNA COMUNITÀ PIÙ SICURA
Ogni account conferma un indirizzo email o un numero di telefono prima di poter inviare messaggi. Post, foto e video vengono controllati secondo le nostre Linee guida della community, puoi segnalare o bloccare chiunque, e ogni provvedimento su un account indica il motivo e come fare ricorso.

Scarica una copia dei tuoi dati o elimina il tuo account dalle Impostazioni, gratis. YuKon3t è per chi ha almeno 16 anni.
```

---

## Hindi (hi / hi-IN)

App Store name (max 30):
```text
YuKon3t: दुनिया भर के दोस्त
```

App Store subtitle (max 30):
```text
संस्कृतियाँ, Circles और लाइव
```

App Store keywords (max 100):
```text
दोस्त,संस्कृति,प्रवासी,समुदाय,स्टोरी,वीडियो,लाइव,चैट,ग्रुप,भाषा,विदेश,दोस्ती
```

App Store promotional text (max 170):
```text
दूसरी संस्कृतियों और प्रवासी समुदाय में दोस्त बनाएँ। स्टोरी शेयर करें, Muse वीडियो देखें, निजी Circles से जुड़ें और 10 मेहमानों तक के साथ लाइव जाएँ।
```

Google Play title (max 30):
```text
YuKon3t: दुनिया भर के दोस्त
```

Google Play short description (max 80):
```text
दूसरी संस्कृतियों के दोस्त: स्टोरी, Muse वीडियो, निजी Circles और लाइव।
```

Description (App Store) / full description (Google Play) (max 4000):
```text
YuKon3t आपको सरहदों के पार दोस्तों और परिवार से जुड़े रहने में मदद करता है, और ऐसे लोगों से मिलवाता है जो आपकी रुचियाँ, आपकी भाषा या आपकी संस्कृति साझा करते हैं।

दूसरी संस्कृतियों और प्रवासी समुदाय के दोस्त
देश, भाषा या रुचि के आधार पर लोगों को खोजें, और बताएँ कि आप यहाँ किसलिए हैं: दोस्ती, सांस्कृतिक आदान-प्रदान, समुदाय, पेशेवर संपर्क या यात्रा के सुझाव।

दिल वाली स्टोरी
ऐसी फ़ोटो और वीडियो शेयर करें जो 24 घंटे बाद गायब हो जाती हैं। दोस्त जवाब दे सकते हैं या दिल पर टैप कर सकते हैं, और सिर्फ़ आप देखते हैं कि आपकी स्टोरी किसे पसंद आई।

Muse के छोटे वीडियो
छोटे, मज़ेदार और क्रिएटिव वीडियो की फ़ुल-स्क्रीन फ़ीड, जिसे YuKon3t पर हर कोई देख, पसंद कर और उस पर टिप्पणी कर सकता है।

निजी Circles और Collab Boards
किसी शौक, मुहिम या संस्कृति के लिए मुफ़्त में Circle बनाएँ, और चाहें तो उसे सिर्फ़ न्योते से जुड़ने वाला रखें। Collab Boards अलग-अलग देशों के लोगों को हुनर की अदला-बदली, साथ पढ़ाई और प्रोजेक्ट के लिए एक साथ लाते हैं।

10 मेहमानों तक के साथ लाइव
लाइव स्ट्रीम करें, अपने साथ मंच पर 10 लोगों तक को बुलाएँ, और चुनें कि कौन देख सकता है, चाहे सिर्फ़ वही लोग जिन्हें आप चुनें।

चैट, कॉल और शॉपिंग लिस्ट
अकेले में या ग्रुप में बात करें, वॉइस और वीडियो कॉल करें, और ऐसी शॉपिंग लिस्ट भेजें जिस पर चैट में हर कोई तुरंत निशान लगा और कुछ जोड़ सके।

जन्मदिन और छुट्टियाँ
जिन जन्मदिनों को आपके दोस्त शेयर करना चुनते हैं उन पर रिमाइंडर पाएँ, और अपने देश की सार्वजनिक छुट्टियों पर एक सूचना, जिसे आप सेटिंग्स में बंद कर सकते हैं।

नौ भाषाएँ
YuKon3t को अंग्रेज़ी, स्पैनिश, फ़्रेंच, पुर्तगाली, अरबी, जर्मन, इतालवी, हिंदी या स्वाहिली में इस्तेमाल करें, और जब चाहें भाषा बदलें।

ज़्यादा सुरक्षित समुदाय
मैसेज भेजने से पहले हर खाता एक ईमेल पता या फ़ोन नंबर कन्फ़र्म करता है। पोस्ट, फ़ोटो और वीडियो हमारे समुदाय दिशानिर्देशों के अनुसार जाँचे जाते हैं, आप किसी को भी रिपोर्ट या ब्लॉक कर सकते हैं, और किसी खाते पर की गई हर कार्रवाई के साथ उसकी वजह और अपील करने का तरीका बताया जाता है।

सेटिंग्स से अपने डेटा की कॉपी डाउनलोड करें या अपना खाता मुफ़्त में हटाएँ। YuKon3t 16 साल और उससे ज़्यादा उम्र के लोगों के लिए है।
```

---

## Swahili (sw, Google Play only)

Google Play title (max 30):
```text
YuKon3t: Marafiki duniani
```

Google Play short description (max 80):
```text
Marafiki wa tamaduni zote: Story, video za Muse, Circles za faragha, mubashara.
```

Description (App Store) / full description (Google Play) (max 4000):
```text
YuKon3t inakusaidia kukaa karibu na marafiki na familia walio ng'ambo ya mipaka, na kukutana na watu wanaoshiriki mapendeleo yako, lugha yako au utamaduni wako.

MARAFIKI WA TAMADUNI NYINGINE NA WA DIASPORA
Tafuta watu kwa nchi, lugha au mapendeleo, na useme uko hapa kwa ajili ya nini: urafiki, kubadilishana tamaduni, jumuiya, mawasiliano ya kikazi au vidokezo vya safari.

STORY ZENYE MIOYO
Shiriki picha na video zinazopotea baada ya saa 24. Marafiki wanaweza kujibu au kugusa moyo, na ni wewe tu unayeona waliopenda Story yako.

VIDEO FUPI ZA MUSE
Mlisho wa skrini nzima wa video fupi, za kuchekesha na za ubunifu ambazo kila mtu kwenye YuKon3t anaweza kutazama, kupenda na kutolea maoni.

CIRCLES ZA FARAGHA NA COLLAB BOARDS
Anzisha Circle bila malipo kwa ajili ya burudani, harakati au utamaduni, na uifanye ya mwaliko tu ukipenda. Collab Boards huwaleta pamoja watu wa nchi mbalimbali kwa kubadilishana ujuzi, vikundi vya kusoma na miradi.

MUBASHARA NA HADI WAGENI 10
Tangaza mubashara, alika hadi watu 10 jukwaani pamoja nawe, na uchague nani anaweza kutazama, hata watu uliowachagua tu.

GUMZO, SIMU NA ORODHA ZA UNUNUZI
Tuma ujumbe mmoja kwa mmoja au kwenye vikundi, piga simu za sauti na video, na utume orodha ya ununuzi ambayo kila mtu kwenye gumzo anaweza kuweka alama na kuongeza papo hapo.

SIKU ZA KUZALIWA NA SIKUKUU
Pata kikumbusho kwenye siku za kuzaliwa ambazo marafiki zako wanachagua kushiriki, na taarifa kwenye sikukuu za umma za nchi yako, ambayo unaweza kuzima kwenye Mipangilio.

LUGHA TISA
Tumia YuKon3t kwa Kiingereza, Kihispania, Kifaransa, Kireno, Kiarabu, Kijerumani, Kiitaliano, Kihindi au Kiswahili, na ubadilishe wakati wowote.

JUMUIYA SALAMA ZAIDI
Kila akaunti huthibitisha barua pepe au namba ya simu kabla ya kuweza kutuma ujumbe. Machapisho, picha na video hukaguliwa kulingana na Miongozo yetu ya Jumuiya, unaweza kuripoti au kumzuia mtu yeyote, na kila hatua inayochukuliwa dhidi ya akaunti huja na sababu na njia ya kukata rufaa.

Pakua nakala ya data yako au futa akaunti yako kwenye Mipangilio, bila malipo. YuKon3t ni kwa watu wenye umri wa miaka 16 na zaidi.
```

---

## Search Console and Bing Webmaster Tools checklist

The code already renders both verification tags from environment variables (src/app/layout.tsx `metadata.verification`;
documented in `.env.example`). Nothing is set yet, and no secret is involved (these are public tokens).

1. Google Search Console: add a **URL-prefix** property for `https://yukon3t.com/` (or a Domain property via a DNS TXT
   record, if the DNS move to Name.com/Route53 is done). Choose "HTML tag", copy only the `content="..."` value.
2. Set `GOOGLE_SITE_VERIFICATION` to that value on **both Netlify and Vercel** (yukon3t.com is served by Netlify), and
   redeploy. Check `view-source:https://yukon3t.com/` shows `<meta name="google-site-verification" ...>`, then press
   Verify.
3. Bing Webmaster Tools: either import the verified Search Console property (then `BING_SITE_VERIFICATION` isn't
   needed), or add the site, choose the meta tag method and set `BING_SITE_VERIFICATION` the same way.
4. Submit `https://yukon3t.com/sitemap.xml` in both. Expect 28 URLs: the landing page and the FAQ once plain and once
   per language (`?lang=xx`), plus sign-up, sign-in, advertise and the five legal pages.
5. Optional: set `IOS_APP_STORE_ID` (the numeric Apple ID of the app, not secret) on both hosts so the landing page's
   structured data also lists the iOS app.
6. After deploy, check:
   - Google Rich Results Test / Schema Markup Validator on `https://yukon3t.com/` (Organization, WebSite, WebPage,
     MobileApplication) and `https://yukon3t.com/faq` (FAQPage). Note: Google shows FAQ rich results only for a few
     authoritative government and health sites, so a valid FAQPage won't show as a rich result here; it still
     describes the page.
   - `view-source:https://yukon3t.com/?lang=es` (and fr, pt, ar, de, it, hi, sw): `<html lang="es">`, the Spanish
     `<title>`, `<link rel="canonical" href="https://yukon3t.com/?lang=es">`, ten `hreflang` links (nine languages
     plus x-default), `og:locale` = es_ES.
   - URL Inspection in Search Console on `https://yukon3t.com/?lang=fr`: "User-declared canonical" should be the same
     address.
   - `https://yukon3t.com/robots.txt` lists the disallowed app paths and the sitemap.
