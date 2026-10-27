import type { FaqItems } from "../ids";

// French FAQ, part 1: Getting around, The Android app, Posts and media. Conventions as in src/lib/i18n/fr: standard
// French, formal "vous"; names of buttons and screens exactly as the app shows them, in « »; product names (YuKon3t,
// Circles, Collab Boards, Muse) as they are. The space before ? : ; ! and inside « » is a non-breaking one (U+00A0).
export const fr1 = {
  "who-join-yukon3t": {
    q: "Qui peut rejoindre YuKon3t ?",
    a: "Toute personne âgée de 16 ans ou plus. Votre date de naissance vous est demandée à l'inscription. Si vous avez 16 ou 17 ans, vous ne pouvez utiliser YuKon3t qu'avec la participation et l'accord d'un parent ou de votre représentant légal.",
  },
  "try-without-signing-up": {
    q: "Puis-je essayer YuKon3t sans m'inscrire ?",
    a: "Quand l'aperçu invité est activé, oui : la page yukon3t.com/try propose un bouton « Explorer YuKon3t en tant qu'invité », sans e-mail ni mot de passe. Un invité voit ce que voit un tout nouveau membre : les publications que leurs auteurs ont réglées sur Tout le monde, les Circles publics et leurs canaux publics, les vidéos Muse, les Collab Boards, Découvrir et les profils des gens (nom, photo de profil, bio, pays et leurs publications pour Tout le monde), avec les commentaires, le nombre de j'aime et la liste des personnes qui ont aimé ces publications. Un invité ne voit jamais rien qu'un nouveau membre ne pourrait pas voir : pas de publications réservées aux relations, pas de Circles ni de canaux privés, pas de messages et pas de Stories (elles sont réservées aux relations). Les invités ne peuvent pas publier, commenter, aimer ou réagir, se connecter, s'abonner, envoyer de messages, appeler, rejoindre ou regarder un direct, voter, répondre à des événements ni signaler quoi que ce soit ; toucher l'une de ces actions propose de créer un compte gratuit. Une visite en tant qu'invité dure au maximum 2 heures, puis se termine d'elle-même. Les invités n'apparaissent jamais dans la recherche, Découvrir, les listes de membres ni « qui est en ligne », et personne n'est prévenu qu'un invité a consulté son profil ou ses publications. Ce qu'une visite invité enregistre est expliqué dans la Politique de confidentialité.",
  },
  "where-find-everything": {
    q: "Où se trouve chaque chose ?",
    a: "Sur ordinateur, la barre supérieure contient des liens vers « Accueil », « Découvrir », « Circles », « Collab Boards », « Muse », « Relations », « Messages » et votre « Profil ». Sur téléphone, les six sections les plus utilisées (« Accueil », « Circles », « Collab », « Muse », « Messages », « Profil ») se trouvent dans une barre d'onglets en bas de l'écran, et « Relations » est l'icône de personne de la barre supérieure. Touchez le menu ☰ en haut à droite pour accéder à « Découvrir », « Inviter des amis », « Paramètres » et, pour les administrateurs, aux outils de modération.",
  },
  "swipe-between-tabs-instead-tapping": {
    q: "Puis-je balayer pour changer d'onglet au lieu de toucher ?",
    a: "Oui, sur téléphone : balayez vers la droite n'importe où sur l'écran pour avancer dans Accueil → Circles → Collab → Muse → Messages → Profil, puis revenir à Accueil. Balayez vers la gauche pour parcourir les mêmes onglets en sens inverse, en bouclant dans l'autre sens.",
  },
  "difference-between-home-discover-connections": {
    q: "Quelle est la différence entre Accueil, Découvrir et Relations ?",
    a: "**Accueil** est votre fil : les publications de vos relations et de toutes les personnes qui publient en public, y compris les publications des Circles publics. Les publications d'un Circle privé restent dans ce Circle et n'apparaissent jamais ici. **Découvrir** sert à trouver de nouvelles personnes par pays, par langue ou par centre d'intérêt. **Relations** est la liste de vos relations acceptées, ainsi que des demandes en attente que vous avez envoyées ou reçues.",
  },
  "switch-between-light-dark-mode": {
    q: "Comment passer du mode clair au mode sombre ?",
    a: "Utilisez le sélecteur de thème situé à côté de « Paramètres » dans la barre supérieure (ou dans le menu ☰ sur mobile). Par défaut, il suit le réglage de votre appareil, mais vous pouvez le fixer sur clair ou sur sombre.",
  },
  "yukon3t-work-iphones-accessibility-settings": {
    q: "YuKon3t fonctionne-t-il avec les réglages d'accessibilité de mon iPhone ?",
    a: "Oui. L'application iPhone fonctionne avec Contrôle vocal et suit la taille du texte de votre iPhone : augmentez-la dans Réglages → Accessibilité → Affichage et taille du texte → Police plus grande, et le texte de YuKon3t grandit avec elle, jusqu'à un peu plus du double de sa taille normale. La barre supérieure et la barre d'onglets du bas ne grandissent que légèrement, afin que toutes les icônes et tous les onglets tiennent encore à l'écran. L'application respecte aussi Réduire les animations, et le mode sombre suit votre appareil, sauf si vous le fixez vous-même.",
  },
  "megaphone-icon-next-bell": {
    q: "À quoi correspond l'icône de mégaphone à côté de la cloche ?",
    a: "C'est « Nouveautés » : touchez-la pour voir la liste, tenue à jour, des nouvelles fonctionnalités et des mises à jour que nous avons publiées. Elle s'allume lorsqu'il y a quelque chose que vous n'avez pas encore vu, et une vraie notification est envoyée sur votre téléphone dès qu'une nouveauté est publiée ; vous n'avez donc pas à penser à vérifier.",
  },
  "search-app": {
    q: "Comment faire une recherche dans l'application ?",
    a: "Touchez l'icône de loupe à côté de la cloche des notifications. Un seul champ de recherche couvre à la fois les personnes, les Circles, les discussions de groupe et les collaborations. Filtrez les résultats par les plus pertinents, les plus récents, les plus anciens, « actualité » (actifs au cours des deux dernières semaines) ou par pays.",
  },
  "click-someones-name-almost-everywhere": {
    q: "Pourquoi puis-je cliquer sur le nom de quelqu'un presque partout ?",
    a: "Tout nom ou toute photo de profil que vous voyez (dans une discussion, un commentaire, une liste de relations, la liste des membres d'un Circle, etc.) mène directement au profil de cette personne. C'est volontairement le même fonctionnement partout, pour que vous n'ayez jamais à chercher un bouton « voir le profil ».",
  },
  "some-people-disappear-from-discover": {
    q: "Pourquoi certaines personnes disparaissent-elles de Découvrir ?",
    a: "Découvrir n'affiche que les personnes avec lesquelles vous n'avez encore eu aucun échange de mise en relation : dès que vous envoyez ou recevez une demande de mise en relation, la personne disparaît des résultats de Découvrir (que la demande soit encore en attente ou déjà acceptée). Si une demande est refusée, cette personne peut réapparaître dans Découvrir pour une nouvelle tentative.",
  },
  "new-member-alerts": {
    q: "Pourquoi ai-je reçu une notification indiquant que quelqu'un vient de rejoindre YuKon3t ?",
    a: "Quand une nouvelle personne termine son profil et a vérifié son compte, YuKon3t prévient les personnes qui utilisent Découvrir, pour que les nouveaux venus trouvent des personnes avec qui se mettre en relation. Seules les personnes qui apparaissent elles-mêmes dans Découvrir sont annoncées : pas celles qui ont désactivé « Afficher mon profil dans Découvrir », pas celles dont les publications ne sont visibles que par leurs relations, et jamais une personne que vous avez bloquée ou qui vous a bloqué. Chaque personne est annoncée une seule fois, peu après son arrivée. Votre téléphone en reçoit au plus une toutes les 12 heures ; quand d'autres personnes arrivent, vos notifications les regroupent en une seule entrée (« Ada et 3 autres personnes viennent de rejoindre YuKon3t ») qui ouvre Découvrir avec les personnes les plus récentes en premier. Pour ne plus les recevoir, décochez Nouveaux membres dans Paramètres → Notifications. Pour ne pas être annoncé à votre arrivée, désactivez « Afficher mon profil dans Découvrir » dans Paramètres → Confidentialité juste après votre inscription.",
  },
  "home-split-into-sections-like": {
    q: "Pourquoi Accueil est-il divisé en rubriques comme Vie professionnelle, Divertissement, Politique et Sport ?",
    a: "Les publications sont regroupées selon la rubrique du fil que leur auteur a choisie dans l'éditeur (par défaut, Général), afin qu'il soit plus facile de parcourir ce qui vous intéresse. Tant que vous êtes sur la page, chaque rubrique ajoute automatiquement les nouvelles publications en haut, généralement en quelques secondes, et en une demi-minute environ lorsque beaucoup de contenus sont publiés en même temps. Inutile d'actualiser.",
  },
  "update-the-app": {
    q: "Comment mettre à jour l'application, et pourquoi me demande-t-on de le faire ?",
    a: "La plupart des améliorations vous parviennent d'elles-mêmes : l'application charge la dernière version de YuKon3t à chaque ouverture. Certains changements nécessitent toutefois une nouvelle version de l'application elle-même sur Google Play ou l'App Store ; quand elle sort, vous pouvez voir une bannière « Mise à jour disponible » : touchez **Mettre à jour** pour ouvrir la boutique, puis touchez Mettre à jour. « Plus tard » masque la bannière pendant 3 jours. Plus rarement, quand une ancienne version ne peut plus fonctionner correctement, un écran « Mise à jour requise » s'affiche à la place ; vous pouvez toujours ouvrir cette FAQ ou vous déconnecter depuis cet écran, et tout refonctionne dès la mise à jour faite. Vous pouvez aussi mettre à jour quand vous voulez : ouvrez Google Play ou l'App Store, recherchez YuKon3t et touchez Mettre à jour. Pour envoyer ces avis, la version et le numéro de build de l'application ainsi que la plateforme de votre téléphone (Android ou iPhone) sont enregistrés avec son jeton de notifications push.",
  },
  "slow-connection-data-saver": {
    q: "YuKon3t fonctionne-t-il avec une connexion lente ou instable ?",
    a: "Oui. Quand votre connexion est lente (3G, 4G ou 5G avec peu de réseau, Wi-Fi saturé) ou que l'économiseur de données de votre téléphone est activé, YuKon3t s'adapte tout seul : les vidéos du fil attendent que vous appuyiez sur lecture au lieu de démarrer pendant le défilement, Muse ne charge que la vidéo que vous regardez, le fil charge moins de publications à la fois et la session n'est pas enregistrée pour les statistiques. Vous pouvez aussi le choisir vous-même dans Paramètres → **« Économiseur de données »** : « Automatique » (par défaut), « Activé » ou « Désactivé ». Le réglage est enregistré sur cet appareil uniquement.\n\nSi quelque chose ne se charge pas, YuKon3t réessaie tout seul et affiche un petit message « Connexion lente. Nouvelle tentative… » pendant ce temps. Hors ligne, un bandeau s'affiche, et ce qui ne s'est pas chargé reprend dès que la connexion revient. Certaines choses ne dépendent pas de YuKon3t et peuvent rester lentes : le réseau de votre opérateur, les vidéos intégrées d'autres sites et la qualité d'un appel sur une connexion très faible (les appels adaptent eux-mêmes leur qualité vidéo à la connexion).",
  },

  "app-opens-chrome-instead-full": {
    q: "L'application s'ouvre dans Chrome au lieu du plein écran. Comment corriger cela ?",
    a: "Il s'agit d'un réglage Android à effectuer une seule fois, pas d'un bug. Sur votre téléphone, allez dans Paramètres → Applications → YuKon3t → « Ouvrir par défaut » (certaines versions d'Android l'appellent « Définir par défaut » ou « Liens compatibles ») et vérifiez que `yukon3t.com` est activé sous « Adresses Web compatibles ». Android désactive cette option par défaut par souci de confidentialité et l'application ne peut pas l'activer à votre place : c'est donc une étape manuelle à faire une seule fois après l'installation.",
  },
  "still-get-calls-phone-asleep": {
    q: "Vais-je quand même recevoir les appels si mon téléphone est en veille ou verrouillé ?",
    a: "Oui. Un appel entrant sonne et allume votre écran par-dessus l'écran de verrouillage, même lorsque votre téléphone est en veille ou en mode d'économie de batterie (Doze), comme un appel téléphonique ordinaire. Acceptez-le ou refusez-le directement depuis cet écran, ou touchez-le pour ouvrir l'application. Cela nécessite que l'autorisation de notification soit activée pour YuKon3t (Android la demande lors de votre première connexion). Si les appels ne réveillent pas votre téléphone, vérifiez Paramètres → Applications → YuKon3t → Notifications.",
  },
  "shows-up-notification-phone": {
    q: "Qu'est-ce qui apparaît sous forme de notification sur mon téléphone ?",
    a: "Les appels entrants, les appels manqués (avec le nom de la personne qui a appelé), les messages (y compris les réponses à votre story), les mentions J'aime, les commentaires, les partages et les repartages de vos publications et de vos vidéos Muse, les demandes de mise en relation, les rappels d'événements, le démarrage d'un direct réservé à vous seul, une session récurrente de collaboration sur le point de commencer et les annonces générales sur les nouvelles fonctionnalités. Tout cela arrive sous forme de vraies notifications Android même lorsque l'application n'est pas ouverte, et pas seulement sur l'icône de cloche dans l'application. Toucher une notification (ou une notification de la liste dans l'application) ouvre exactement ce qu'elle concerne : la publication, le Muse, la story, la discussion, l'événement, le Circle, le direct, la collaboration ou la liste Relations (pour un appel manqué, le profil de la personne qui a appelé), même si l'application était en arrière-plan ou se recharge sur une version plus récente à l'ouverture. Si l'élément a été supprimé depuis, ou se trouve dans un Circle privé dont vous ne faites plus partie, une page « introuvable » s'affiche à la place. Ouvrir l'application (depuis une notification, depuis son icône ou en revenant d'une autre application) efface automatiquement toutes les notifications de ce type de votre volet de notifications. Seule exception : un appel qui sonne ou un appel manqué, qui restent affichés jusqu'à ce que vous vous en occupiez. La liste des notifications dans l'application fonctionne différemment : une notification y est marquée comme lue lorsque vous l'ouvrez depuis la liste, lorsque vous touchez sa notification sur le téléphone ou lorsque vous ouvrez ce qu'elle concerne (la discussion, la publication, le Muse, le Circle, etc.). Les autres restent non lues, et la pastille rouge de la cloche continue de les compter, jusque-là ou jusqu'à ce que vous touchiez « Tout marquer comme lu ».",
  },
  "turning-up-phones-volume-unmutes": {
    q: "Monter le volume de mon téléphone réactive le son d'une vidéo de mon fil. Est-ce normal ?",
    a: "Oui, c'est voulu. Les vidéos du fil partagent un seul réglage de son pour toute l'application (touchez l'icône de haut-parleur d'une vidéo ou montez le volume de votre téléphone) : réactiver le son s'applique à toutes les vidéos de votre fil, y compris celles que vous faites défiler ensuite, comme dans le fil d'Instagram.",
  },

  post: {
    q: "Que puis-je publier ?",
    a: "Du texte, des photos et des vidéos provenant de votre appareil ou de votre appareil photo, une image récupérée à partir d'une URL ou un lien YouTube/Vimeo intégré. Touchez les icônes d'appareil photo et de photo dans l'éditeur : chacune ouvre un petit menu proposant l'appareil, l'appareil photo ou un lien. Il y a ainsi un bouton pour les photos et un pour les vidéos, plutôt qu'une rangée de boutons distincts.",
  },
  "which-video-formats-upload-everyone": {
    q: "Quels formats vidéo puis-je importer, et tout le monde peut-il les regarder ?",
    a: "MP4, WebM et QuickTime (.mov, ce qu'enregistre un iPhone), jusqu'à 2 Go. Un fichier .mov est réencodé en arrière-plan en MP4 standard afin d'être lisible dans tous les navigateurs, et pas seulement dans Safari. Cela prend généralement quelques minutes et, en attendant, l'original est lu pour toute personne dont le navigateur le prend en charge. Si une vidéo ne peut pas être convertie, l'original reste tel quel.",
  },
  "was-photo-video-rejected": {
    q: "Pourquoi ma photo ou ma vidéo a-t-elle été refusée ou mise en attente de vérification ?",
    a: "Chaque fichier importé est contrôlé automatiquement avant d'être visible par qui que ce soit d'autre, et les contenus qui enfreignent nos [Règles de la communauté](/legal/guidelines) (le plus souvent des contenus sexuellement explicites) ne sont jamais publiés. Lorsque le contrôle signale une publication avec photo ou vidéo, elle est enregistrée mais masquée pour tout le monde sauf vous, et nos modérateurs l'examinent : ils la publient telle que vous l'avez publiée ou la suppriment. Une note vous indique qu'elle attend une vérification, et vous n'avez pas besoin de l'importer à nouveau. Une publication retenue que personne n'a examinée sous 14 jours est supprimée, avec ses photos ou sa vidéo. Les fichiers relevant des catégories les plus graves (comme les contenus sexuels impliquant des mineurs) sont refusés et supprimés immédiatement, sans jamais être conservés pour examen. Si un import échoue à cause d'un problème de notre côté, l'application l'indique et il suffit de réessayer.",
  },
  "delete-post-report-someone-elses": {
    q: "Comment supprimer une publication ou signaler celle de quelqu'un d'autre ?",
    a: "Ouvrez le menu « ⋯ » d'une publication pour la supprimer (s'il s'agit de la vôtre) ou la signaler (quelle qu'elle soit). Les signalements arrivent dans notre file de modération et sont examinés ; dans un cas comme dans l'autre, le motif de la décision est indiqué.",
  },
  "share-post": {
    q: "Comment partager une publication ?",
    a: "Touchez l'icône de partage d'une publication pour afficher un menu : copier le lien, partager via le menu de partage de votre appareil, l'ajouter à votre story, la partager sur Muse (publications vidéo de 5 minutes maximum uniquement), l'envoyer directement à un ami sous forme de message ou la partager dans un Circle. Le partage via l'appareil joint la photo ou la vidéo elle-même lorsque c'est possible (et pas seulement un lien), marquée d'un petit logo yukon3t, afin que des applications comme WhatsApp ou Messages affichent la vraie publication avec la marque de son lieu d'origine. Dans « Envoyer à un ami », vous pouvez cocher jusqu'à 5 discussions et l'envoyer à toutes en une fois ; cela fonctionne aussi pour un Muse, une story ou un contenu partagé depuis une autre application.",
  },
  "share-photo-video-from-another": {
    q: "Puis-je partager une photo ou une vidéo d'une autre application (Instagram, TikTok, WhatsApp, etc.) directement dans YuKon3t ?",
    a: "Oui : dans le menu de partage de cette application, choisissez YuKon3t comme destination. Une petite fenêtre s'ouvre aussitôt avec un aperçu et vous permet de l'ajouter à votre story, de le publier sur Muse, de le publier dans votre fil Accueil ou de l'envoyer à un ami. Choisissez une option et le contenu est publié immédiatement (après avoir passé le même contrôle automatique que tout fichier importé), sans autre manipulation ni passage par l'éditeur. Cela fonctionne mieux lorsque l'autre application transmet le vrai fichier photo ou vidéo. Dans certaines applications, l'action de partage n'envoie qu'un lien vers leur propre publication (c'est un choix de chaque application, pas quelque chose que YuKon3t contrôle ; Instagram et TikTok, entre autres, ne transmettent généralement le fichier qu'à quelques applications partenaires). Dans ce cas, si le lien provient d'une plateforme vidéo reconnue (YouTube, Vimeo, TikTok, Instagram, Facebook, Dailymotion), YuKon3t propose quand même la story, Muse et le fil : la vraie vidéo est lue sur place, comme lorsque vous collez l'un de ces liens directement dans l'éditeur du fil, mais elle est modérée par cette plateforme et non par YuKon3t. Pour tout autre lien, YuKon3t vous l'indique et vous pouvez tout de même l'envoyer à un ami depuis la même fenêtre. Sur Android uniquement pour le moment.",
  },
  "react-post-something-other-than": {
    q: "Puis-je réagir à une publication autrement qu'avec un cœur ?",
    a: "Oui. L'icône de smiley à côté du cœur sur une publication (ou un message) ouvre d'abord une rangée de réactions courantes, ainsi qu'un « + » pour ouvrir le sélecteur d'emojis complet si vous voulez autre chose. Choisir à nouveau le même emoji le retire, et en choisir un autre le remplace. C'est indépendant du bouton cœur/J'aime : vous pouvez donc aimer une publication et y ajouter une réaction emoji en même temps. Le sélecteur complet (dans les publications, les commentaires et les discussions) comprend aussi les termes de recherche familiers ou non anglais : saisir « pray », « amen »/« ameen »/« aameen » ou « sad » fait apparaître une petite rangée « Suggestions » d'emojis pertinents au-dessus des résultats habituels.",
  },
  "change-emoji-look-throughout-app": {
    q: "Puis-je changer l'apparence des emojis dans toute l'application ?",
    a: "Oui. Dans Paramètres → « Style des emojis », choisissez entre le rendu natif, Apple, Google, Facebook ou Twitter/X. Votre choix s'applique partout où des emojis apparaissent : les réactions, le sélecteur et les messages.",
  },
  "send-gif": {
    q: "Puis-je envoyer un GIF ?",
    a: "Oui. Le bouton GIF (à côté du bouton des emojis) dans l'éditeur de publication, une discussion ou une zone de commentaire ouvre une recherche. Choisissez-en un pour le joindre, comme vous joindriez une photo.",
  },
  "videos-feed-play-automatically-no": {
    q: "Pourquoi les vidéos de mon fil se lancent-elles automatiquement sans le son ?",
    a: "Les vidéos du fil se lancent automatiquement sans le son lorsque vous arrivez dessus en faisant défiler, et se mettent en pause une fois que vous les avez dépassées. Touchez l'icône de haut-parleur de la vidéo pour réactiver le son (voir « Monter le volume de mon téléphone réactive le son d'une vidéo de mon fil » ci-dessus), ou touchez la vidéo elle-même pour la mettre en pause ou la reprendre.",
  },
  "zoom-back-out-photo-without": {
    q: "Comment dézoomer une photo sans fermer la visionneuse ?",
    a: "Touchez une fois la photo agrandie (un simple toucher, pas un double) pour la ramener à sa taille d'origine. Le double toucher continue de zoomer et de dézoomer comme avant ; cela ajoute simplement un moyen plus rapide de revenir à la taille normale sans quitter la visionneuse.",
  },
  "dictate-post": {
    q: "Puis-je dicter une publication au lieu de la saisir ?",
    a: "Oui. Touchez l'icône du micro dans l'éditeur de publication (ou dans la zone de message d'une discussion) pour enregistrer un court extrait vocal ; il est transcrit et inséré dans la zone de texte pour que vous puissiez le relire et le modifier avant de publier ou d'envoyer. Ce n'est pas le bouton rond micro/envoi d'une discussion, qui envoie l'enregistrement lui-même sous forme de note vocale : le micro de dictée se trouve à côté du bouton des emojis et produit toujours du texte modifiable. Parlez dans votre langue : l'espagnol, le français, le portugais, l'arabe et bien d'autres sont reconnus automatiquement, quelle que soit la langue d'affichage de l'application.",
  },
  "difference-between-connect-subscribe": {
    q: "Quelle est la différence entre Entrer en relation et S'abonner ?",
    a: "**Entrer en relation** est la demande mutuelle habituelle : vous choisissez pourquoi vous souhaitez entrer en relation (amitié, échange culturel, professionnel, communauté ou conseils de voyage), l'autre personne doit accepter, et cela débloque les messages et les appels entre vous. **S'abonner** est à sens unique et ne nécessite aucune approbation : en vous abonnant à quelqu'un, vous recevez une notification chaque fois que cette personne publie, ajoute une story, republie quelque chose, passe en direct, confirme sa participation à un événement, met en ligne un Muse, lance une collaboration, ou rejoint ou crée un Circle. Vous pouvez vous abonner à quelqu'un sans être en relation avec cette personne, et inversement. Seule exception : accepter une demande de mise en relation vous abonne automatiquement l'un à l'autre, si bien que vous n'avez pas à vous abonner en plus à une personne avec laquelle vous êtes déjà en relation. Vous pouvez ensuite vous désabonner sans que cela modifie la relation elle-même. Les deux icônes se trouvent à côté de l'icône de partage sur chaque publication que vous voyez : dans Accueil, dans le fil d'un Circle, dans les résultats de recherche et dans les annonces de Collab Boards. Les publications d'un Circle public sont notifiées à vos abonnés et à vos relations comme toute publication publique ; celles d'un Circle privé sont réservées à ses membres : elles ne sont donc notifiées à personne en dehors et ne peuvent être ni republiées ni partagées à l'extérieur.",
  },
  "see-who-im-subscribed-whos": {
    q: "Comment voir à qui je suis abonné, ou qui est abonné à moi ?",
    a: "Ouvrez le profil de n'importe qui, y compris le vôtre, et touchez le nombre d'abonnés ou d'abonnements affiché près du nom pour voir la liste complète. Vous pouvez vous abonner à quelqu'un ou vous en désabonner directement depuis ces listes, et pas seulement depuis une publication.",
  },
  "people-you-may-know-discover": {
    q: "À quoi correspond « Vous connaissez peut-être » dans Découvrir ?",
    a: "Une rangée de suggestions située vers le haut de Découvrir, classée selon les relations en commun : des personnes avec lesquelles vous n'êtes pas encore en relation et qui partagent des relations avec vous, avec le nombre de relations communes. Ce ne sont que des suggestions : y figurer n'envoie de notification à personne et ne déclenche rien ; c'est simplement un moyen plus rapide de trouver des personnes que vous connaissez probablement déjà que de filtrer toute la liste de Découvrir. La rangée n'apparaît que lorsque vous avez au moins une relation.",
  },
  "long-post-get-cut-off": {
    q: "Pourquoi une longue publication est-elle coupée par un lien « Voir plus » ?",
    a: "Au-delà d'une certaine longueur, les publications sont tronquées dans les fils afin qu'une seule longue publication ne repousse pas tout le reste vers le bas de la page. Touchez « Voir plus » pour lire la suite sur place, et « Voir moins » pour la replier. Cela s'applique partout où des publications sont listées, ainsi qu'au texte propre d'une republication. Il n'y a pas de limite significative à la longueur d'une publication : écrivez autant que nécessaire, les lecteurs pourront toujours la déplier.",
  },
  "got-message-saying-new-version": {
    q: "En publiant, j'ai reçu un message indiquant qu'une nouvelle version de l'application est disponible et qu'il faut actualiser la page pour continuer.",
    a: "Ce message apparaît si votre onglet était ouvert depuis avant la mise en ligne d'une mise à jour. Ce n'est pas un problème de connexion, juste une page périmée. Actualisez la page et réessayez : rien de ce que vous alliez publier n'est perdu en réessayant.",
  },
  "there-way-see-older-posts": {
    q: "Existe-t-il un moyen de voir les publications plus anciennes sur un profil, dans un Circle ou dans les résultats de recherche ?",
    a: "Oui. Partout dans YuKon3t, les éléments plus anciens se chargent automatiquement à mesure que vous faites défiler, que ce soit dans **Accueil**, les publications d'un profil, le fil d'un salon d'un Circle, les résultats de recherche, Relations ou les listes d'abonnés et d'abonnements. Rien à toucher. (Par ailleurs, Accueil ajoute automatiquement les toutes nouvelles publications en haut, généralement quelques secondes après leur publication ; ce n'est pas la même chose que de charger ce qui se trouve plus loin dans le fil.)",
  },
} satisfies Partial<FaqItems>;
