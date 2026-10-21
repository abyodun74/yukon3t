import type { FaqItems } from "../ids";

// French FAQ, part 4: Circles and Collab Boards, Advertising, Inviting friends, Your account and data, Privacy,
// safety and trust.
export const fr4 = {
  circle: {
    q: "Qu'est-ce qu'un Circle ?",
    a: "Une communauté gratuite réunie par un centre d'intérêt ou une identité : loisirs, causes, cultures, tout ce autour de quoi un groupe de membres souhaite s'organiser. Tout le monde peut en créer un ; créer un Circle et en rejoindre un sont toujours gratuits.",
  },
  "who-see-shared-circle-sub": {
    q: "Qui peut voir ce qui est partagé dans un Circle ou un sous-Circle ?",
    a: "Cela dépend de la confidentialité du Circle. Les publications, les vidéos et les directs d'un Circle **public** sont publics : ils peuvent apparaître dans Accueil et dans la recherche, être republiés ou partagés dans une story, sur Muse ou dans un autre Circle, et sont notifiés aux abonnés comme toute publication publique. Les publications, les vidéos, les conversations des salons, les salons vocaux et les directs d'un Circle **privé** (ou d'un sous-Circle privé) ne sont visibles que par ses membres : jamais dans Accueil, dans la recherche ni sur les profils, et ils ne peuvent être ni republiés ni partagés à l'extérieur. Un salon privé à l'intérieur d'un Circle public est réservé aux membres de la même façon. Chaque sous-Circle a sa propre confidentialité et ses propres membres : faire partie du Circle principal ne vous permet pas de voir le contenu d'un sous-Circle privé, et inversement.",
  },
  "pick-category-circle": {
    q: "Comment choisir une catégorie pour mon Circle ?",
    a: "Recherchez-la au moment de créer le Circle. La liste couvre des thèmes généraux (Voyages, Culture, Technologie et start-up, et d'autres) ainsi que des types de métiers et des professions précis (Bookkeeping, Civil Engineer, Cybersecurity Analyst, Linux Administrator et des dizaines d'autres, affichés en anglais), pour que vous trouviez exactement la bonne au lieu d'une catégorie générique « Vie professionnelle ». Vous pouvez choisir jusqu'à 5 catégories pour un même Circle si plusieurs conviennent réellement.",
  },
  "rename-circle-change-its-theme": {
    q: "Puis-je renommer mon Circle ou modifier son thème, ses catégories ou sa confidentialité après sa création ?",
    a: "Oui. Le propriétaire ou un co-admin peut toucher l'icône de crayon à côté du nom du Circle, sur sa page, pour modifier à tout moment son nom, son thème (la description de ce dont traite le Circle, rédigée à sa création), ses catégories ou sa confidentialité (public ou privé). Son URL ne change jamais lorsque vous le renommez : les liens et les favoris existants continuent donc de fonctionner. Rendre un Circle privé masque immédiatement ses publications et ses directs aux non-membres (et rend aussi ses sous-Circles privés) ; les membres actuels restent. Le rendre public permet à tout le monde de le rejoindre et de le voir, et efface les demandes d'adhésion en attente, puisqu'elles ne sont plus nécessaires. Un sous-Circle d'un Circle privé ne peut pas être rendu public.",
  },
  "sub-circles": {
    q: "Que sont les sous-Circles ?",
    a: "Un sous-Circle est un Circle plus petit rattaché à un Circle principal : par exemple un sous-Circle « Design » et un sous-Circle « Marketing » dans un Circle « Fondateurs de start-up ». Ouvrez le Circle principal : ses sous-Circles sont listés directement sur sa page. Chacun a ses propres membres, ses propres salons et publications, et sa propre liste de membres sur sa propre page, et vous pouvez rejoindre n'importe lequel d'entre eux séparément : vous n'avez pas à rejoindre d'abord le Circle principal, et en rejoindre un ne vous fait pas rejoindre les autres. Seul le propriétaire du Circle principal peut ajouter des sous-Circles (touchez « Ajouter un sous-Circle » sur la page du Circle principal). Les sous-Circles n'ont qu'un seul niveau de profondeur, et un sous-Circle d'un Circle privé est lui aussi privé. Supprimer un Circle principal supprime également ses sous-Circles.",
  },
  "invite-people-private-circle": {
    q: "Comment inviter des personnes dans un Circle privé ?",
    a: "Sur la page d'un Circle privé, son propriétaire ou un co-admin peut toucher « Inviter des personnes » et choisir parmi ses propres relations, jusqu'à 50 à la fois. Chaque personne reçoit une notification et une invitation à accepter ou refuser sur la page du Circle (son bouton indique « Accepter l'invitation » au lieu de « Demander à rejoindre ») ; personne ne devient membre sans accepter, et un refus n'est signalé à personne. Inviter quelqu'un qui avait déjà demandé à rejoindre approuve simplement sa demande. Tous les admins voient la liste « Invités » avec le statut de chaque invitation et peuvent annuler celle qui est encore en attente. Les invitations n'expirent pas, mais une invitation ne peut plus être acceptée si la personne qui l'a envoyée n'est plus admin du Circle ; la liste la signale, et inviter de nouveau cette personne lui envoie une nouvelle invitation. Une personne qui a refusé, est partie ou a été retirée peut être invitée à nouveau. Un sous-Circle est un Circle à part entière : invitez des personnes depuis sa propre page. Rendre le Circle public annule les invitations en attente, puisque tout le monde peut alors le rejoindre.",
  },
  "invite-someone-circles-voice-channel": {
    q: "Comment inviter quelqu'un dans le salon vocal d'un Circle ?",
    a: "Ouvrez le salon vocal et touchez « Inviter » pour choisir parmi les membres du Circle. N'importe quel membre peut en inviter un autre, pas seulement le propriétaire ou les co-admins. Le salon affiche le décompte des invitations en attente, acceptées et refusées. Accepter une invitation ne fait pas entrer la personne directement dans le salon : elle doit encore toucher pour le rejoindre, comme tout le monde.",
  },
  "collab-board": {
    q: "Qu'est-ce qu'un Collab Board ?",
    a: "Un espace où trouver des échanges de compétences entre pays, du mentorat, des services professionnels, des événements et des projets. Le champ « Type » est une liste dans laquelle vous pouvez chercher (échange de compétences, conseil fiscal, tenue de livres et comptabilité, orientation professionnelle, vente et marketing, et des dizaines d'autres) plutôt qu'une poignée d'options fixes. Les annonces peuvent être limitées à certains pays ou marquées comme ouvertes au monde entier. Une fois que vous participez, vous avez accès à la discussion de groupe de cette collaboration (texte, photos et vidéos) et à une session vidéo en direct avec partage d'écran, documents importés et enregistrement.",
  },
  "difference-between-public-private-collab": {
    q: "Quelle est la différence entre un Collab Board public et un Collab Board privé ?",
    a: "Les collaborations **publiques** sont annoncées à tout le monde et listées dans Collab Boards : chacun peut toucher « Demander à rejoindre », et l'organisateur ou un co-admin examine chaque demande (Approuver/Refuser) avant d'accorder l'accès. Les collaborations **privées** sont sur invitation uniquement : l'organisateur choisit les relations qu'il souhaite inviter, soit au moment de publier, soit plus tard via « Inviter des personnes » sur la page de la collaboration, et elles ne sont jamais listées ni accessibles par la recherche ; seuls l'organisateur et les personnes invitées ou déjà inscrites peuvent les voir. Vous pouvez aussi inviter tout un Circle que vous avez créé : chacun de ses membres actuels reçoit sa propre invitation, et personne ne rejoint sans l'avoir acceptée. Une personne invitée voit un bandeau lui proposant d'accepter ou de refuser sur la page de la collaboration tant qu'elle n'a pas répondu.",
  },
  "starting-joining-collab-session-work": {
    q: "Comment démarrer ou rejoindre une session Collab ?",
    a: "Seul l'organisateur ou un co-admin peut démarrer une session à partir de rien : un bouton « Démarrer la session » s'affiche pour lui sur la page de la collaboration. Sur une collaboration publique, le toucher le connecte aussitôt, sans autre confirmation. Sur une collaboration privée, un court panneau « Démarrer la session » s'ouvre d'abord : « Prévenir les participants que la session est en direct » (activé par défaut) envoie une notification à toutes les personnes déjà dans la collaboration, au plus une fois toutes les 30 minutes, et vous pouvez aussi inviter d'autres relations ou jusqu'à cinq Circles que vous avez créés, exactement comme avec « Inviter des personnes » (chacun accepte toujours sa propre invitation, et une personne invitée pendant qu'une session est en direct en est informée). Touchez « Démarrer » sans choisir personne pour simplement lancer la session. Si une invitation ne peut pas être envoyée (par exemple un Circle qui ajouterait plus de 200 nouvelles invitations), la session n'est pas démarrée et personne n'est prévenu. Les autres ne voient un bouton « Rejoindre la session » qu'une fois une session en cours (avant cela, la page affiche simplement « En attente du démarrage de la session par l'organisateur »). Si une session est déjà en cours au moment où vous voulez la démarrer ou la rejoindre, une brève question vous demande d'abord si vous êtes prêt à la rejoindre, car arriver au milieu de personnes qui discutent déjà dérange davantage que de démarrer à neuf ; si vous refusez, il ne se passe rien et vous n'êtes pas ajouté à l'appel. Dans tous les cas, l'appel s'ouvre automatiquement en plein écran ; touchez l'icône de réduction (en bas à droite) pour le réduire à une petite fenêtre pendant que vous utilisez le reste de l'application, comme pour un appel à deux.",
  },
  "schedule-recurring-collaboration-session": {
    q: "Puis-je programmer une session de collaboration récurrente ?",
    a: "Oui. Lorsque vous publiez une collaboration (ou la modifiez par la suite), cochez « Session récurrente » et choisissez le ou les jours de la semaine ainsi que l'heure. L'heure est saisie en UTC afin que tous les participants voient la même heure commune où qu'ils se trouvent, au lieu qu'elle se décale silencieusement vers un autre jour ou une autre heure pour quelqu'un situé dans un autre fuseau horaire. L'organisateur ou un co-admin peut modifier ou supprimer la programmation à tout moment depuis « Modifier ».",
  },
  "add-collaborations-session-own-calendar": {
    q: "Puis-je ajouter la session d'une collaboration à mon agenda ?",
    a: "Oui. Une collaboration dotée d'une programmation récurrente affiche sur sa page un lien « Ajouter à Google Agenda » et un lien pour télécharger un fichier .ics (pour Apple Calendrier, Outlook ou toute autre application capable de l'importer), chacun comportant son propre rappel intégré avant le début de la session. Vous recevez aussi une notification dans l'application peu avant chaque occurrence. Seuls l'organisateur et les participants inscrits voient ces liens, et non un simple visiteur qui parcourt une collaboration publique qu'il n'a pas réellement rejointe.",
  },
  "share-screen-upload-material-during": {
    q: "Puis-je partager mon écran ou importer des documents pendant une session Collab ?",
    a: "Touchez l'icône d'écran dans les commandes de l'appel (ou le menu « … » des autres options de l'appel, si la barre est trop étroite pour afficher toutes les icônes) pour partager votre écran avec tous les participants de la session. Cela ne fonctionne que depuis un navigateur sur ordinateur : les navigateurs de téléphone et l'application Android installée ne peuvent pas du tout accorder à une page l'autorisation de capture d'écran ; c'est une limite des navigateurs mobiles en général, pas une particularité de YuKon3t. Pour des documents ou des images, touchez plutôt l'icône d'import située à côté des boutons pour quitter et réduire : le fichier s'ouvre immédiatement dans un panneau partagé pour toutes les personnes présentes dans l'appel, puis reste publié dans la discussion de la collaboration pour celles qui la rejoignent plus tard.",
  },
  "leave-collab-session": {
    q: "Comment quitter une session Collab ?",
    a: "Touchez l'icône rouge pour raccrocher, à côté de l'icône de réduction (ou sur la fenêtre réduite si vous avez déjà réduit l'appel). Vous quittez ainsi la session, pas la collaboration elle-même : la session reste ouverte pour les personnes qui s'y trouvent encore, et vous pouvez la redémarrer ou la rejoindre à tout moment depuis la page de la collaboration.",
  },
  "invite-someone-private-collaboration-approve": {
    q: "Comment inviter quelqu'un à une collaboration privée, ou approuver une demande pour en rejoindre une publique ?",
    a: "Pour une collaboration privée, l'organisateur ou un co-admin touche « Inviter des personnes » sur sa page et cherche parmi ses relations, ou choisit jusqu'à cinq Circles qu'il a créés sous « Inviter un Circle » (jusqu'à 200 nouvelles invitations à la fois). Chaque membre du Circle reçoit sa propre invitation et décide s'il l'accepte ; les personnes déjà invitées, celles qui ont refusé auparavant et celles concernées par un blocage sont ignorées. Une liste des personnes invitées, sur la page, indique l'état de chaque invitation (en attente, acceptée ou refusée) ; les invitations envoyées par un autre co-admin à des personnes que vous ne connaissez pas sont seulement comptées, sans les noms, et l'organisateur ou un co-admin peut annuler une invitation encore en attente. Les invitations n'expirent pas, mais une invitation ne peut plus être acceptée dès que la personne qui l'a envoyée n'est plus admin de la collaboration ; la liste la signale, et inviter de nouveau cette personne (seule ou via un Circle dont elle fait partie) lui envoie une nouvelle invitation. Pour une collaboration publique, les demandes en attente apparaissent dans une liste de demandes d'adhésion sur la page, avec les boutons Approuver et Refuser ; approuver une demande ajoute aussitôt la personne comme participant.",
  },
  "edit-collab-board-after-ive": {
    q: "Puis-je modifier un Collab Board après l'avoir publié ?",
    a: "Oui. Son créateur (ou un co-admin) peut toucher « Modifier » sur sa page à tout moment pour changer le titre, le type, la description ou les pays, même après que des personnes l'ont rejoint ou qu'une session en direct a déjà commencé. Il n'y a aucun verrou : modifiez-le à mesure que vos projets évoluent.",
  },
  "co-admins-circle-collab-board": {
    q: "Que font les co-admins dans un Circle ou un Collab Board ?",
    a: "Le créateur d'un Circle ou d'une collaboration peut promouvoir n'importe quel membre ou participant au rang de co-admin, ce qui lui donne les mêmes pouvoirs de gestion au quotidien (modérer les publications, gérer les membres, promouvoir d'autres co-admins) : tout, sauf supprimer le Circle entier ou clôturer définitivement la collaboration, ce qui reste réservé au créateur d'origine.",
  },

  "polls-circle-collab-board": {
    q: "Comment fonctionnent les sondages dans un Circle ou un Collab Board ?",
    a: "Le créateur d'un Circle ou ses co-admins (ou l'organisateur d'une collaboration ou ses co-admins) peuvent lancer un **sondage** depuis la section Sondages de sa page : une question avec 2 à 10 choix, ou un sondage pour **trouver une date**, dont les choix sont des dates et des heures. Les heures sont saisies et affichées en UTC pour que tout le monde partage la même référence, avec votre heure locale indiquée à côté de chacune. Les membres (ou participants) sont prévenus et peuvent voter, changer leur vote ou le retirer à tout moment tant que le sondage est ouvert. Les résultats se mettent à jour en direct au fil des votes. Les sondages d'un Circle ou d'une collaboration privés ne sont visibles que par ses membres.\n\nLes résultats indiquent seulement combien de personnes ont choisi chaque option, jamais qui a voté pour quoi, pas même aux administrateurs. La personne qui a créé le sondage et les administrateurs du Circle ou de la collaboration peuvent le modifier, le clôturer ou le rouvrir, ou le supprimer. Si un choix qui a déjà des voix est modifié ou retiré, ses voix sont supprimées (on vous le demande d'abord), afin qu'aucune voix ne compte pour quelque chose que la personne n'a pas choisi ; ces personnes peuvent simplement voter à nouveau.\n\nQuand un sondage pour trouver une date a un gagnant, un administrateur (ou le créateur du sondage, une fois celui-ci clôturé) peut le programmer : dans un Circle, cela publie un événement auquel chacun peut répondre et qu'il peut ajouter à son agenda ; dans un Collab Board, cela ajoute une session ponctuelle (une collaboration peut en avoir plusieurs, chacune affichée sur sa page jusqu'à ce qu'elle commence), avec le rappel habituel peu avant. Toutes les personnes qui ont voté sont prévenues.",
  },

  "circle-events-coming-up": {
    q: "Comment fonctionnent les événements dans un Circle ?",
    a: "Tout membre peut publier un **événement** dans un Circle en ajoutant une date, une heure et un lieu à une publication. La page du Circle affiche ce qui est **à venir**, du plus proche au plus lointain et dans votre heure locale, avec le nombre de participants et un bouton pour indiquer que vous venez. Chaque événement propose aussi **ajouter à l'agenda** (Google Agenda ou un fichier d'agenda), ainsi que le rappel habituel peu avant le début si vous avez indiqué venir. Les événements d'un Circle privé, et ceux d'un salon privé, ne sont visibles que par les personnes qui peuvent voir ce Circle ou ce salon.\n\nSur la page de l'événement, son organisateur (la personne qui l'a publié, ou le créateur du Circle et ses coadmins) peut lancer une liste **qui apporte quoi** de 20 éléments au maximum. Tout membre qui peut voir l'événement peut se proposer pour un élément (une personne par élément) puis se retirer ; l'organisateur peut modifier, retirer ou désattribuer des éléments. Toutes les personnes qui peuvent voir l'événement voient qui apporte quoi.\n\nL'organisateur peut aussi **relancer les personnes qui n'ont pas répondu** : les membres qui peuvent voir l'événement et n'ont pas indiqué qu'ils venaient reçoivent une notification. Cela ne fonctionne qu'avant le début de l'événement, et au plus une fois toutes les 12 heures.\n\nEn publiant un événement dans un Circle, vous pouvez le faire **répéter** chaque semaine, toutes les 2 semaines ou chaque mois (le même jour du mois, ou le dernier jour des mois plus courts), pour 2 à 12 dates ou jusqu'à une date dans l'année qui vient. Chaque date est un événement à part, avec ses propres réponses et sa propre liste. La date suivante est publiée automatiquement peu après le début de la précédente, sans prévenir personne, et l'organisateur peut arrêter la répétition à tout moment. Les dates suivent l'heure UTC : là où l'on change d'heure, l'heure locale peut se décaler d'une heure.",
  },

  "advertise-yukon3t": {
    q: "Comment faire de la publicité sur YuKon3t ?",
    a: "Rendez-vous sur la page [Publicité](/advertise). Aucun compte YuKon3t n'est nécessaire. Envoyez les informations de votre entreprise, le texte de l'annonce, une photo ou une courte vidéo, et choisissez le nombre de jours de diffusion ; le paiement est traité de manière sécurisée par Stripe. Chaque demande est examinée avant sa mise en ligne, généralement sous un jour ouvré.",
  },

  "invite-someone-from-phones-contacts": {
    q: "Comment inviter une personne des contacts de mon téléphone qui n'est pas encore sur YuKon3t ?",
    a: "Allez dans Paramètres → « Inviter des amis » → « Choisir parmi les contacts ». Sur un téléphone ou un appareil Android, vous pouvez choisir directement des contacts et leur envoyer le lien de l'application par SMS d'un seul toucher ; partout ailleurs, cela ouvre le menu de partage de votre appareil, ou vous pouvez simplement copier le lien d'invitation et l'envoyer vous-même.",
  },

  "signed-new-phone-computer-wheres": {
    q: "Je me suis connecté sur un nouveau téléphone ou un nouvel ordinateur. Où sont passées mes données ?",
    a: "Exactement là où vous les avez laissées. Vos publications, photos, vidéos, messages, Circles et relations se trouvent sur nos serveurs, et non sur un appareil en particulier : en vous connectant avec la même adresse e-mail ou le même nom d'utilisateur sur n'importe quel appareil, vous retrouvez tout automatiquement. Il n'y a rien à transférer ni à restaurer à la main.",
  },
  "download-copy-data": {
    q: "Puis-je télécharger une copie de mes données ?",
    a: "Oui. Paramètres → « Vos données » → « Exporter mes données » vous fournit un fichier JSON de tout ce qui est lié à votre compte, gratuitement et à tout moment, comme sauvegarde personnelle.",
  },
  "difference-between-deactivating-deleting-account": {
    q: "Quelle est la différence entre désactiver et supprimer mon compte ?",
    a: "**Désactiver** masque votre profil et vos publications sans rien supprimer ; vous reconnecter avec votre mot de passe ou un lien reçu par e-mail le réactive automatiquement. **Supprimer** efface définitivement votre profil, vos publications, vos messages et les Circles dont vous êtes propriétaire ; cette action est irréversible.",
  },
  "forgot-password": {
    q: "J'ai oublié mon mot de passe.",
    a: "Utilisez « Mot de passe oublié ? » sur la page de connexion, puis saisissez votre nouveau mot de passe deux fois pour le confirmer. Vous pouvez aussi vous connecter uniquement avec un lien reçu par e-mail si vous préférez ne pas utiliser de mot de passe du tout.",
  },
  "was-asked-reset-password": {
    q: "Pourquoi m'a-t-on demandé de réinitialiser mon mot de passe ?",
    a: "Par mesure de sécurité, nous avons demandé à toutes les personnes qui se connectent avec un mot de passe d'en choisir un nouveau. Votre ancien mot de passe ne permet plus de vous connecter : la première fois que vous l'essayez, nous envoyons un lien de réinitialisation à l'adresse associée à votre compte. Ouvrez ce lien et choisissez un nouveau mot de passe (il ne peut pas être identique à l'ancien), ou demandez un nouveau lien avec « Mot de passe oublié ? » sur la page de connexion. La connexion par lien reçu par e-mail, par Google ou par Apple n'est pas concernée.",
  },
  "set-interests-find-specific-job": {
    q: "Comment définir mes centres d'intérêt, ou trouver un métier ou une profession en particulier ?",
    a: "Recherchez-le lors de la configuration initiale de votre profil ou dans Paramètres → « Modifier le profil » → « Centres d'intérêt ». En plus des centres d'intérêt généraux, la liste comprend des intitulés de poste et des professions précis (comme Tax Advising, System Administrator ou UX Designer, affichés en anglais) : vous n'êtes donc pas limité à de grandes catégories.",
  },
  "need-sign-up": {
    q: "De quoi ai-je besoin pour m'inscrire ?",
    a: "Sur la page d'accueil, touchez « Première visite ? Créez un compte gratuit ». Saisissez un nom d'utilisateur (de 3 à 20 lettres, chiffres ou tirets bas), votre adresse e-mail, un mot de passe et votre date de naissance, puis choisissez comment vérifier votre compte : par un code envoyé par e-mail, ou par un numéro de téléphone (saisissez-le directement : choisissez votre pays dans la liste et tapez votre numéro comme vous le feriez d'habitude ; l'indicatif du pays est ajouté pour vous). Touchez « Créer un compte » et nous envoyons le code. Vous pourrez modifier votre nom d'utilisateur plus tard depuis Paramètres.",
  },
  languages: {
    q: "Puis-je utiliser YuKon3t dans une autre langue que l'anglais ?",
    a: "Oui. YuKon3t est disponible en anglais, en espagnol, en français, en portugais et en arabe : la page d'accueil et l'inscription, toute l'application une fois que vous êtes connecté, cette FAQ, ainsi que les e-mails et les SMS de vérification que nous envoyons pour votre compte. L'application s'ouvre dans la langue de votre téléphone ou de votre navigateur lorsqu'il s'agit de l'une des cinq ; pour en changer, utilisez le menu « Langue » dans le coin supérieur de la page d'accueil (sous « Se connecter ») ou en bas des autres écrans du compte, ou Paramètres → « Langue » une fois connecté. Ce choix est mémorisé sur l'appareil. En arabe, l'application se lit de droite à gauche. Quelques éléments n'existent qu'en anglais : les pages juridiques (Conditions, Confidentialité, Règles de la communauté, Avertissement), les intitulés de poste dans les listes de centres d'intérêt et de catégories, l'écran d'appel entrant affiché par votre téléphone lui-même et les outils des administrateurs. Les notifications envoyées sur votre téléphone sont dans la langue que vous avez choisie en dernier dans un menu « Langue » ou, si vous n'en avez jamais choisi, dans celle de votre téléphone ou de votre navigateur (en anglais jusqu'à votre prochaine ouverture de YuKon3t). Quelques anciens avis restent en anglais, tels qu'ils ont été rédigés. Ce que les personnes écrivent n'est jamais traduit : un message, une publication ou un commentaire apparaît dans la langue dans laquelle il a été écrit.",
  },
  "sign-up-says-something-needs": {
    q: "L'inscription indique qu'un élément est à corriger. Ai-je perdu ce que j'avais saisi ?",
    a: "Non. Si un élément ne peut pas être accepté (un nom d'utilisateur déjà pris, une adresse e-mail déjà associée à un compte, un numéro de téléphone qui ne correspond pas au pays choisi), le formulaire n'affiche que les parties à corriger, chacune accompagnée de la raison juste en dessous. Tout le reste de ce que vous avez saisi, y compris votre mot de passe et votre date de naissance, est conservé. Corrigez ce qui est affiché et touchez de nouveau « Créer un compte », ou touchez « Modifier toutes les informations » pour voir le formulaire complet.",
  },
  "verify-account-after-signing-up": {
    q: "Comment vérifier mon compte après l'inscription ?",
    a: "À l'inscription, choisissez l'e-mail ou le téléphone : nous envoyons un code à 6 chiffres par le moyen choisi, et vous le saisissez sur l'écran suivant pour terminer la création de votre compte. Vous ne l'avez pas reçu, ou le code a expiré ? Rouvrez simplement cet écran et un nouveau code est envoyé automatiquement, sans avoir à chercher un bouton de renvoi (il y en a tout de même un, si vous préférez le déclencher vous-même). Si l'e-mail tarde à arriver, utilisez « Utiliser le téléphone » sur cet écran pour vérifier par SMS ; et si un SMS n'arrive pas, « Utiliser un code par e-mail » vous ramène à l'e-mail. Vous pouvez aussi vous connecter à tout moment pour reprendre là où vous vous étiez arrêté.",
  },
  "why-verify-human-app": {
    q: "Pourquoi me demande-t-on parfois de prouver que je suis humain dans l'app ?",
    a: "À l'inscription, à la connexion et à la réinitialisation du mot de passe, nous vérifions qu'une vraie personne est à l'origine de la demande. Sur le web, il s'agit de la touche « Vérifier que vous êtes humain ». Dans l'app YuKon3t, elle peut à la place confirmer qu'elle est bien l'app authentique et non modifiée, installée sur un appareil authentique, grâce à Play Integrity de Google sur Android et à App Attest d'Apple sur iPhone. Si cette vérification réussit, il se peut qu'on ne vous demande rien. Vous verrez toujours la touche si vous utilisez le site web, une copie modifiée ou non officielle de l'app, un appareil rooté ou un émulateur, ou si l'app n'arrive pas à terminer la vérification à ce moment-là. Rien de cette vérification n'est conservé sur votre compte ; nous gardons seulement un résultat anonyme (réussie ou non, plateforme et version de l'app) pour repérer les abus.",
  },
  "says-account-locked-happened": {
    q: "L'application indique que mon compte est verrouillé. Que s'est-il passé ?",
    a: "Après 4 tentatives avec un mot de passe incorrect, un compte est verrouillé pendant 24 heures par mesure de sécurité. Réinitialiser votre mot de passe (via « Mot de passe oublié ? » sur la page de connexion) le déverrouille immédiatement : vous n'avez pas à attendre la fin des 24 heures. Si vous êtes toujours bloqué, contactez l'assistance et nous pourrons envoyer directement un lien de réinitialisation à votre adresse e-mail enregistrée.",
  },

  "who-see-posts-profile": {
    q: "Qui peut voir mes publications et mon profil ?",
    a: "Vous le contrôlez dans Paramètres → « Confidentialité » : vos publications peuvent être visibles par toute personne connectée ou uniquement par vos relations, et vous pouvez retirer entièrement votre profil de Découvrir.",
  },
  "trust-score-trust-badge": {
    q: "Qu'est-ce que le score de confiance ou le badge de confiance ?",
    a: "Un indicateur construit à partir d'éléments comme la vérification de l'e-mail ou du téléphone, l'ancienneté du compte, le degré de complétude du profil et les séries d'activité, diminué des signalements à votre encontre qui ont été jugés fondés. C'est un indicateur de réputation, pas une vérification d'antécédents.",
  },
  "someone-know-take-screenshot": {
    q: "Quelqu'un saura-t-il que j'ai fait une capture d'écran ?",
    a: "Dans les applications natives Android et iOS, oui, à quelques endroits : pendant un appel vocal ou vidéo (vous êtes tous les deux prévenus instantanément), et lorsque vous consultez la publication, la story, le message privé ou le profil de quelqu'un d'autre ; son propriétaire reçoit alors une notification indiquant que vous avez fait une capture d'écran. Faire une capture d'écran de votre propre contenu ne prévient jamais personne. Cette fonction n'est pas disponible dans un navigateur ordinaire, car il n'existe aucun moyen fiable d'y détecter une capture d'écran.",
  },
  "save-someones-profile-picture": {
    q: "Puis-je enregistrer la photo de profil de quelqu'un ?",
    a: "Pas depuis YuKon3t. Les photos de profil n'ont aucune option d'enregistrement, de téléchargement ou de partage, y compris quand vous en touchez une pour l'agrandir, et les raccourcis appui long, clic droit et glisser pour enregistrer sont désactivés pour elles. C'est une mesure dissuasive, pas un verrou : YuKon3t ne peut pas empêcher une capture d'écran ni arrêter quelqu'un de déterminé à copier ce qui s'affiche sur son écran ; choisissez donc une photo de profil que vous acceptez que d'autres voient. Les publications, les stories et Muse gardent leurs propres options d'enregistrement et de partage.",
  },
  "report-someone-something": {
    q: "Comment signaler une personne ou un contenu ?",
    a: "Utilisez le menu « ⋯ » d'une publication, d'un commentaire ou d'un message, ou l'option de signalement d'un profil. Chaque signalement est trié, et chaque mesure prise est accompagnée d'un motif. Consultez nos [Règles de la communauté](/legal/guidelines) (en anglais) pour savoir ce qui est sanctionné.",
  },
} satisfies Partial<FaqItems>;
