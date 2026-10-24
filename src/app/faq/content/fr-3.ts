import type { FaqItems } from "../ids";

// French FAQ, part 3: Connecting, messaging and calls; Hidden chats. These answers state what is and isn't private:
// every number, time limit and caveat follows the English in ../page.tsx.
export const fr3 = {
  "message-someone": {
    q: "Comment envoyer un message à quelqu'un ?",
    a: "Il faut d'abord une relation acceptée : envoyez une demande depuis son profil ou depuis Découvrir. Une fois en relation, écrivez-lui depuis Relations ou lancez une nouvelle conversation dans Messages.",
  },
  "reply-specific-message": {
    q: "Comment répondre à un message précis ?",
    a: "Balayez un message vers la droite (ou ouvrez son menu « ⋯ » et touchez « Répondre » si vous êtes sur ordinateur) pour le citer dans votre réponse. L'autre personne voit exactement à quel message vous répondez, ce qui est utile lorsqu'une discussion porte sur plusieurs sujets à la fois.",
  },
  "send-photos-videos-voice-notes": {
    q: "Puis-je envoyer des photos, des vidéos, des notes vocales ou des GIF dans une discussion ?",
    a: "Oui. La zone de saisie de la discussion comporte les boutons « Ajouter une photo » et « Ajouter une vidéo » (appareil, appareil photo ou enregistrement sur le moment), un bouton GIF, ainsi qu'une icône de micro pour enregistrer une note vocale. Tout message que vous envoyez peut être supprimé pour vous, ou pour tout le monde si c'est vous qui l'avez envoyé.",
  },
  "send-photo-video-disappears-after": {
    q: "Puis-je envoyer une photo ou une vidéo qui disparaît après avoir été vue ?",
    a: "Oui, dans les discussions à deux (pas dans les discussions de groupe). Joignez une photo ou une vidéo, activez « Vue unique » à côté du fichier, puis envoyez ; le fichier part sans légende, et les vidéos sont limitées à 64 Mo. L'autre personne voit une invitation à toucher pour le voir une fois et ne peut l'ouvrir qu'une seule fois. À ce moment-là, le fichier est supprimé de notre stockage : normalement à l'instant où il s'affiche sur son écran, et en quelques minutes au plus si son application se ferme ou perd la connexion avant. Ensuite, plus personne ne peut l'ouvrir : ni elle, ni vous, ni YuKon3t. S'il n'est jamais ouvert, il expire au bout de 14 jours, et supprimer le message pour tout le monde avant son ouverture le retire également. Ce qui reste, c'est la trace qu'un message à vue unique a été envoyé et l'indication qu'il a été ouvert ou non (et quand) ; vous verrez « Ouvert » de votre côté.\n\nCe qu'il ne peut pas faire : empêcher quelqu'un d'en garder une copie. Les captures d'écran et les enregistrements d'écran ne peuvent pas être empêchés. Dans les applications mobiles, vous recevez une notification lorsqu'une capture d'écran est détectée dans la discussion, mais une photo de l'écran prise avec un autre appareil ne peut pas être détectée du tout. N'envoyez que ce que vous accepteriez de voir conservé par l'autre personne. Et comme rien n'est conservé, un message à vue unique déjà vu ne peut pas être examiné par nos modérateurs s'il est signalé. Les photos (et une image fixe de chaque vidéo) sont contrôlées automatiquement à l'envoi, comme tout autre fichier importé, et vous pouvez toujours signaler et bloquer l'expéditeur.",
  },
  "see-photo-chat-full-screen": {
    q: "Puis-je voir une photo d'une discussion en plein écran ?",
    a: "Oui. Touchez n'importe quelle photo d'un message pour l'ouvrir en plein écran, dans la même visionneuse que pour les images des publications (pincez ou faites défiler pour zoomer, touchez à l'extérieur ou le X pour fermer).",
  },
  "when-open-chat-jump-straight": {
    q: "Quand j'ouvre une discussion, arrive-t-on directement au message le plus récent ?",
    a: "Oui. Ouvrir une conversation, ou passer à une autre, vous place sur le message le plus récent, et l'affichage continue de suivre les nouveaux messages qui arrivent pendant que vous êtes dans cette discussion. La zone de message est aussi préremplie avec le dernier message de la conversation, envoyé ou reçu, pour qu'il soit rapide d'y répondre ou de renvoyer la même chose.",
  },
  "voice-video-calls-work": {
    q: "Comment fonctionnent les appels vocaux et vidéo ?",
    a: "Touchez l'icône de téléphone ou de vidéo sur le profil d'une relation ou dans votre discussion avec elle. Son téléphone sonne (avec la sonnerie que vous avez choisie ; choisissez-en une dans Paramètres → « Appels ») et elle peut accepter ou refuser. Accepter vous met en communication immédiatement, même si son téléphone était verrouillé ou l'application en arrière-plan au moment où il a sonné.",
  },
  "add-more-people-call": {
    q: "Puis-je ajouter d'autres personnes à un appel ?",
    a: "Oui. Une fois l'appel établi, touchez l'icône d'ajout de personne à côté du bouton pour raccrocher et choisissez l'une de vos relations. Elle reçoit un appel entrant normal et rejoint le même appel lorsqu'elle accepte ; tant qu'elle n'a pas répondu, vous voyez « Appel vers … » en haut de l'appel. Toute personne présente dans l'appel peut ajouter l'une de ses propres relations, jusqu'à 8 personnes au total. Une personne déjà en communication ailleurs, ou concernée par un blocage avec l'un des participants, ne peut pas être ajoutée. Lorsqu'une personne raccroche, elle seule quitte l'appel et celui-ci se poursuit pour tous les autres ; il prend fin lorsqu'il ne reste qu'une seule personne. Si votre téléphone affiche l'écran d'appel du système, cet écran ne nomme que la personne qui vous a ajouté.",
  },
  "put-call-hold": {
    q: "Puis-je mettre un appel en attente ?",
    a: "Oui. Touchez l'icône de pause dans les commandes de l'appel pour mettre en attente un appel vocal ou vidéo. Cela met en pause votre micro et votre caméra et vous empêche d'entendre l'autre personne, qui voit que vous avez mis l'appel en attente. Touchez le même bouton (devenu une icône de lecture) pour reprendre : votre micro et votre caméra reprennent exactement dans l'état où ils étaient avant la mise en attente.",
  },
  "live-translated-captions-call": {
    q: "Puis-je avoir des sous-titres traduits en direct pendant un appel ?",
    a: "Oui, dans un appel vocal ou vidéo à deux. Touchez le bouton des sous-titres dans les commandes de l'appel. Avant que quoi que ce soit ne démarre, vous voyez ce qui se passe : ce que vous dites est envoyé à un service d'IA (OpenAI) pour être transcrit et traduit. YuKon3t ne conserve ni l'audio ni le texte ; OpenAI peut conserver ce qu'il traite pendant une durée limitée, selon ses propres conditions. On demande ensuite à l'autre personne si elle l'autorise, et les sous-titres ne démarrent que lorsque vous êtes tous les deux d'accord. Pendant qu'ils sont activés, vous continuez tous les deux à entendre la vraie voix de l'autre, chacun voit les paroles de l'autre sous-titrées dans la langue dans laquelle il utilise YuKon3t (anglais, espagnol, français, portugais ou arabe), et « Sous-titres en direct activés » s'affiche en haut des deux écrans ; « Voir l'original » montre les mots tels qu'ils ont été dits. Chacun de vous peut les désactiver à tout moment avec le même bouton, ce qui les arrête pour vous deux en même temps ; ils sont de nouveau désactivés pour l'appel suivant et se désactivent d'eux-mêmes au bout d'une heure. Votre micro n'est sous-titré que lorsqu'il est activé : le couper ou mettre l'appel en attente le met en pause. Chaque personne dispose de 120 minutes par mois de sous-titres de ce qu'elle dit. Les sous-titres ne sont pas disponibles dans les appels à plus de deux personnes, peuvent avoir une ou deux secondes de retard et contenir des erreurs, surtout pour les langues que le service reconnaît moins bien (le yoruba, par exemple).",
  },
  "happens-call-switch-apps-lock": {
    q: "Que devient un appel si je change d'application ou si je verrouille mon téléphone ?",
    a: "Dans l'application YuKon3t pour Android ou iPhone, l'appel se poursuit : vous et l'autre personne pouvez continuer à parler pendant que l'application est en arrière-plan ou que votre écran est verrouillé. Votre caméra se met en pause pendant votre absence (les téléphones ne laissent pas une application en arrière-plan continuer à filmer) : lors d'un appel vidéo, l'autre personne voit donc une indication signalant que votre caméra est en pause, et votre vidéo reprend lorsque vous revenez dans l'application. Dans le navigateur web d'un téléphone, c'est différent : le navigateur suspend la page dès que vous la quittez, si bien qu'un appel ne peut pas s'y poursuivre en arrière-plan. L'autre personne verra que votre connexion a été perdue, et l'appel prend fin si vous n'êtes pas de retour dans un délai d'environ une minute et demie. Pour les appels pendant lesquels vous devez vous absenter, utilisez l'application.",
  },
  "happens-connection-drops-during-call": {
    q: "Que se passe-t-il si ma connexion est interrompue pendant un appel ?",
    a: "L'appel ne prend pas fin tout de suite. Vous voyez « Reconnexion… » pendant que YuKon3t tente de vous reconnecter, pendant une minute environ au maximum. C'est pratique dans un ascenseur, un tunnel ou lors du passage du Wi-Fi aux données mobiles. Pendant ce temps, l'autre personne voit que votre connexion a été perdue et il lui est demandé de patienter. Si la reconnexion n'aboutit pas dans ce délai, l'appel prend fin pour vous deux, et chacun peut simplement rappeler.",
  },
  "there-limit-long-call-last": {
    q: "La durée d'un appel est-elle limitée ?",
    a: "Un même appel vocal ou vidéo peut durer jusqu'à 12 heures. Il prend ensuite fin automatiquement, et vous pouvez en lancer un nouveau aussitôt.",
  },
  "hear-ringing-sound-when-call": {
    q: "Pourquoi est-ce que j'entends une sonnerie quand j'appelle quelqu'un ?",
    a: "C'est la tonalité de retour d'appel : elle vous indique que l'appel est bien en train d'aboutir pendant que vous attendez la réponse. Elle s'arrête dès que la personne répond ou refuse, ou que vous annulez.",
  },
  "says-already-have-call-someone": {
    q: "L'application indique que j'ai déjà un appel avec quelqu'un et refuse de rappeler. Que faire ?",
    a: "Cela se produit lorsqu'un appel précédent vers cette personne est encore marqué comme en train de sonner ou actif (par exemple si un appel a été interrompu). Une fenêtre vous propose d'annuler cet appel bloqué et d'en passer immédiatement un nouveau : touchez « L'annuler et rappeler ».",
  },
  "group-chats-work": {
    q: "Comment fonctionnent les discussions de groupe ?",
    a: "Créez-en une depuis Messages → « Nouveau groupe » : choisissez un nom et au moins 2 de vos relations. Les groupes publics peuvent aussi être trouvés sous « Découvrir des groupes » : cherchez par nom et demandez à rejoindre. Si vous avez créé un groupe, ouvrez-le et utilisez « Ajouter des membres » à tout moment pour y faire entrer d'autres relations. Tout membre peut toucher « Quitter le groupe » pour en sortir de lui-même (si le créateur du groupe part, la propriété passe au membre suivant) ; le créateur dispose aussi d'une option « Supprimer le groupe », qui supprime le groupe entier, messages compris, pour tout le monde en une fois, lorsqu'il n'est plus utile. Les administrateurs de YuKon3t peuvent également supprimer directement un groupe (pour spam, doublon ou infraction aux Règles), même s'ils ne l'ont jamais rejoint.",
  },
  "typed-message-but-didnt-send": {
    q: "J'ai saisi un message sans l'envoyer. Est-il perdu si je quitte la discussion ?",
    a: "Non. Tout ce que vous avez saisi sans l'envoyer est enregistré comme brouillon sur votre appareil au moment même où vous le saisissez. Passez à une autre conversation, fermez l'application ou rechargez la page : il sera toujours dans la zone de message à votre retour dans cette discussion. Il ne disparaît que lorsque vous l'envoyez réellement (ou que vous effacez vous-même le texte).",
  },
  "secret-chats": {
    q: "Que sont les discussions secrètes ?",
    a: "Une discussion secrète est une conversation à deux dans laquelle le texte de vos messages est chiffré de bout en bout : il est verrouillé sur votre téléphone et déverrouillé uniquement sur celui de l'autre personne, de sorte que même les serveurs de YuKon3t ne peuvent pas le lire. Vous devez l'activer tous les deux (ouvrez la discussion, touchez le ⋯ en haut et choisissez « Confidentialité de la discussion »), et la première fois vous choisirez une phrase de récupération. Cela ne fonctionne que dans les discussions à deux, pas dans les discussions de groupe. Bon à savoir : seul le *texte* des messages est chiffré. Les photos, les vidéos, les notes vocales et les GIF sont toujours importés et contrôlés comme partout ailleurs, et les messages envoyés avant que vous l'ayez tous deux activé n'étaient pas chiffrés. Une fois activé, rien à l'écran ne signale que la discussion est secrète : il n'y a ni libellé ni cadenas dans la discussion ou dans votre liste de messages, et les notifications indiquent simplement « Nouveau message ». Le même menu « Confidentialité de la discussion » figure dans toutes les discussions à deux, et c'est là que vous vérifiez qu'elle est activée, que vous vérifiez le code ou que vous la désactivez. (Votre liste de messages affiche « Message » à la place du texte, car nous ne pouvons pas le lire pour en donner un aperçu.) Les discussions secrètes n'offrent pas de confidentialité persistante (forward secrecy) : votre clé reste la même, si bien qu'une personne ayant accès à votre téléphone déverrouillé pourrait lire l'historique enregistré de cette discussion. Et comme c'est nous qui remettons à chacun la clé publique de l'autre, ouvrez « Confidentialité de la discussion », touchez « Vérifier le code » et comparez le code de sécurité avec l'autre personne, en personne ou lors d'un appel : s'il est identique sur les deux téléphones, personne n'a remplacé une clé en chemin et la discussion est privée, même vis-à-vis de nous.",
  },
  "forget-recovery-passphrase-lose-phone": {
    q: "Que se passe-t-il si j'oublie ma phrase de récupération ou si je perds mon téléphone ?",
    a: "Votre phrase de récupération verrouille une sauvegarde de votre clé, que nous stockons mais ne pouvons pas lire. Sur un nouveau téléphone, saisissez-la pour déverrouiller vos anciennes discussions secrètes. Si vous l'oubliez *et* que vous perdez votre téléphone, nous ne pouvons pas récupérer vos messages secrets : c'est la contrepartie d'un chiffrement que nous ne pouvons pas ouvrir. Vous pouvez repartir de zéro avec de nouvelles clés, mais les messages secrets envoyés avec l'ancienne clé ne pourront alors plus jamais être lus, ni par vous ni par l'autre personne, et vos discussions secrètes sont désactivées jusqu'à ce que vous les réactiviez tous les deux.",
  },
  "moderators-read-secret-chats-report": {
    q: "Les modérateurs peuvent-ils lire les discussions secrètes ? Comment y signaler un abus ?",
    a: "Non. Comme nous ne pouvons pas lire les discussions secrètes, nous n'analysons pas leur texte à la recherche d'infractions à nos règles, comme nous le faisons pour les messages ordinaires, et les administrateurs ne peuvent pas les ouvrir. Nos règles s'y appliquent tout de même. Si quelqu'un vous envoie un contenu abusif, touchez le ⋯ de ce message et choisissez « Signaler » : l'application vous prévient d'abord que cela partage le texte de ce seul message avec nos modérateurs, afin qu'ils puissent l'examiner. Nous ne pouvons pas le vérifier de manière indépendante : un signalement ne contient donc que ce que vous choisissez d'envoyer. Les photos et les vidéos des discussions secrètes restent contrôlées. Vous pouvez désactiver la discussion secrète à tout moment sous « Confidentialité de la discussion », après quoi les nouveaux messages sont de nouveau analysés.",
  },

  "hiding-chat": {
    q: "Que se passe-t-il quand je masque une discussion ?",
    a: "Ouvrez une discussion, touchez le ⋯ en haut et choisissez « Masquer la discussion ». La première fois, vous choisissez un code PIN de 4 à 8 chiffres. La discussion quitte alors votre liste Messages, n'est plus comptée dans vos pastilles de messages non lus ni sur la cloche des notifications, et n'est plus proposée lorsque vous partagez quelque chose. Pour une discussion à deux, l'autre personne disparaît aussi de votre liste Relations et des sélecteurs servant à créer un groupe, à lancer un appel ou à envoyer une invitation. Les discussions de groupe peuvent aussi être masquées. Un nouveau message dans une discussion masquée vous parvient toujours, mais la notification indique seulement « Vous avez une nouvelle notification », sans nom ni aperçu, et ouvre l'écran Accueil. Un appel entrant d'une personne dont vous avez masqué la discussion s'affiche comme « Appel privé ».",
  },
  "open-hidden-chat-unhide-one": {
    q: "Comment ouvrir une discussion masquée, et comment cesser de la masquer ?",
    a: "Maintenez le doigt appuyé sur le mot « Messages » en haut de votre écran Messages, ou allez dans Paramètres, « Confidentialité », « Discussions masquées ». Saisissez votre code PIN et vos discussions masquées s'affichent. Ces deux points d'entrée sont toujours présents pour tout le monde : ils ne révèlent donc pas si vous avez masqué quelque chose. L'espace se verrouille de lui-même au bout d'environ 10 minutes, dès que vous quittez l'application ou changez d'onglet avec une discussion masquée à l'écran, lorsque vous touchez « Verrouiller maintenant » et lorsque vous vous déconnectez. Pour cesser de masquer une discussion, ouvrez-la, touchez ⋯ et choisissez « Ne plus masquer la discussion ».",
  },
  "other-person-know-hid-our": {
    q: "L'autre personne sait-elle que j'ai masqué notre discussion ?",
    a: "Non. Le masquage ne concerne que votre côté. Elle n'en est pas informée, rien ne change de son côté, et ses messages et ses appels sont remis comme d'habitude. Elle vous voit toujours dans ses propres listes.",
  },
  "forgot-pin-happens-hidden-chats": {
    q: "J'ai oublié mon code PIN. Que deviennent mes discussions masquées ?",
    a: "Sur l'écran du code PIN, touchez « Code PIN oublié ? » et confirmez votre identité avec le mot de passe de votre compte. Si votre compte n'a pas de mot de passe (vous vous connectez avec un lien reçu par e-mail, Google ou Apple), nous vous envoyons un code par e-mail à la place. Choisissez ensuite un nouveau code PIN. Vos discussions restent masquées et rien de leur contenu n'est perdu. Après 5 codes PIN erronés d'affilée, vous devez attendre 15 minutes, et plus longtemps chaque fois que cela se reproduit.",
  },
  "doesnt-hiding-chat": {
    q: "Qu'est-ce que le masquage d'une discussion ne fait pas ?",
    a: "Il masque la discussion sur votre compte ; il ne la chiffre pas. Les messages sont stockés comme ceux de n'importe quelle autre discussion, et notre modération s'applique toujours. Si vous voulez un texte que même nous ne pouvons pas lire, c'est le rôle de « Confidentialité de la discussion » (les discussions secrètes), et vous pouvez utiliser les deux sur la même discussion. Les notifications déjà présentes sur votre téléphone avant le masquage ne sont pas retirées : effacez-les vous-même. La personne apparaît toujours dans les espaces publics : la recherche, Découvrir, son profil, ainsi que ses publications, ses commentaires et ses mentions J'aime. Toucher « Message » sur son profil vous demande votre code PIN. Et toute personne qui connaît votre code PIN et dispose de votre téléphone déverrouillé peut ouvrir l'espace masqué.",
  },
} satisfies Partial<FaqItems>;
