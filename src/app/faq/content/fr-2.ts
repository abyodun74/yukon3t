import type { FaqItems } from "../ids";

// French FAQ, part 2: Going Live, Stories, Muse, Ambient.
export const fr2 = {
  "start-join-live-stream": {
    q: "Comment lancer ou rejoindre un direct ?",
    a: "Touchez « Passer en direct » au-dessus du fil Accueil, donnez un titre au direct et choisissez qui peut le regarder : **Tout le monde** ou l'un de vos Circles ou sous-Circles. Un direct pour Tout le monde ou pour un Circle public apparaît de deux façons dans Accueil pendant sa diffusion : sous la forme d'un avatar dans le bandeau « En direct », et sous la forme d'une carte complète plus bas dans le fil lui-même, qui diffuse le direct, avec la personne qui l'anime, le nombre de spectateurs en temps réel et les boutons « Regarder », « Rejoindre en tant qu'invité » et « Rejoindre en tant que coanimateur ». Toucher l'un d'eux vous fait entrer directement dans le direct avec ce choix déjà fait, sans écran intermédiaire. La vidéo de cette carte ne démarre que lorsque vous avez réellement fait défiler jusqu'à elle : passer simplement devant en descendant dans le fil ne vous compte donc pas comme spectateur, alors que vous y arrêter, si. Les directs d'un Circle apparaissent aussi dans une section « En direct » en haut de la page de ce Circle.",
  },
  "who-see-live-stream-start": {
    q: "Qui peut voir un direct que je lance pour un Circle ?",
    a: "Cela dépend de la confidentialité du Circle. Un direct pour un Circle **public** (ou pour Tout le monde) s'affiche dans le bandeau « En direct » d'Accueil et tout le monde peut le regarder. Un direct pour un Circle ou un sous-Circle **privé** n'est vu que par les membres de ce Circle : il n'apparaît jamais dans Accueil ni ailleurs dans l'application, et sa page, sa discussion et ses enregistrements sont fermés aux non-membres, même avec le lien. Dans les deux cas, choisir un Circle ou un sous-Circle comme public du direct détermine aussi qui est *notifié* : chaque membre de ce Circle ou sous-Circle reçoit une notification dès que le direct commence, qu'il soit lancé par le propriétaire ou par n'importe quel autre membre, et non l'ensemble de vos abonnés, même pour un Circle public. Un direct lancé pour **Tout le monde** est en revanche annoncé à vos propres abonnés, comme toute autre publication publique. Les membres retrouvent aussi le direct d'un Circle dans la section « En direct » de la page du Circle.",
  },
  "start-live-stream-just-one": {
    q: "Puis-je lancer un direct avec une seule personne en particulier ?",
    a: "Oui. Choisissez son nom sous « Une personne en particulier », dans la liste des personnes qui peuvent regarder, au moment de lancer un direct (seules vos relations y figurent). Ce direct est privé entre vous deux : il n'apparaît jamais dans Accueil, sur la page d'un Circle ni ailleurs, et seule cette personne (en plus de vous) peut le voir ou le rejoindre ; ni vos abonnés ni vos autres relations ne le peuvent. Elle reçoit une notification dès que le direct commence, comme pour un appel.",
  },
  "difference-between-watching-joining-guest": {
    q: "Quelle est la différence entre regarder, rejoindre en tant qu'invité et rejoindre en tant que coanimateur ?",
    a: "**Regarder** se fait en simple spectateur : aucun accès à la caméra ni au micro. **Invité** et **coanimateur** placent tous deux votre caméra et votre micro sur scène, dans une vue en écran partagé aux côtés de la personne qui anime le direct (coanimateur est prévu pour quelqu'un qui aide à présenter, invité pour quelqu'un qui passe brièvement, mais les deux fonctionnent de la même façon). Il y a 3 places sur scène au total, partagées entre invités et coanimateurs, en plus de la personne qui anime le direct. Le nombre de spectateurs n'est pas limité.",
  },
  "host-mute-guest-co-host": {
    q: "La personne qui anime le direct peut-elle couper le micro d'un invité ou d'un coanimateur ?",
    a: "Oui. La personne qui anime le direct peut toucher l'icône de micro sur la vignette vidéo d'un invité ou d'un coanimateur pour couper ou réactiver son micro pour tous les spectateurs, et pas seulement de son côté. Cette commande lui est réservée (un coanimateur ne l'a pas, même s'il partage par ailleurs ses droits de diffusion) et n'apparaît jamais sur votre propre vignette. Un invité ou un coanimateur dont le micro a été coupé peut le réactiver lui-même s'il souhaite reprendre la parole : la commande sert à régler rapidement un bruit de fond ou des prises de parole simultanées, ce n'est pas un verrouillage strict.",
  },
  "record-go-live-stream-take": {
    q: "Puis-je enregistrer un direct ou faire une capture d'écran ?",
    a: "La personne qui anime le direct et les coanimateurs peuvent toucher « Enregistrer » pour lancer un enregistrement dans le cloud. Une fois arrêté, il apparaît dans une liste d'enregistrements sur le direct, avec un lien de téléchargement. Toute personne présente dans le direct peut toucher « Capture d'écran » pour enregistrer une image ; votre navigateur vous demandera de confirmer ce qu'il faut capturer, car c'est ainsi que fonctionne la capture d'une vidéo en direct dans les navigateurs.",
  },
  "recording-stream-posted-automatically": {
    q: "Un enregistrement de mon direct peut-il être publié automatiquement ?",
    a: "Oui. Si vous animez le direct, touchez « Enregistrer et publier » (le bouton d'enregistrement portant une petite icône de maison) au lieu du simple « Enregistrer », et cet enregistrement est publié pour vous une fois son traitement terminé : dans le fil Accueil pour un direct destiné à « Tout le monde », ou dans le même Circle si vous avez limité le direct à un Circle. Il n'y a rien à importer ensuite. Ce n'est pas instantané : l'enregistrement passe exactement par le même contrôle automatisé que toute autre vidéo que vous publiez, comptez donc quelques minutes ; si le contrôle le signale, nous vous prévenons au lieu de le publier. Le bouton que vous avez touché vaut pour tout cet enregistrement : lancez-en un nouveau si vous changez d'avis. Cette option n'est pas proposée pour un direct lancé avec une seule personne en particulier : ce direct est privé entre vous deux, et une publication n'a pas de réglage équivalent.",
  },
  "did-live-stream-end-its": {
    q: "Pourquoi mon direct s'est-il terminé tout seul ?",
    a: "Un direct se termine automatiquement lorsque la personne qui l'anime et tous les coanimateurs sont absents depuis 30 minutes d'affilée (plus personne disposant des droits d'animation n'y est actif). C'est une mesure de nettoyage, pour qu'un direct abandonné ne reste pas « en direct » indéfiniment. Un direct tout juste créé bénéficie toujours d'un délai de grâce de 30 minutes, quoi qu'il arrive : il ne se termine donc jamais avant que quelqu'un ait eu une vraie possibilité de le rejoindre.",
  },
  "people-comment-during-live-stream": {
    q: "Peut-on commenter pendant un direct ?",
    a: "Oui. Une zone « Écrivez quelque chose... » est superposée au direct lui-même ; toute personne qui regarde peut saisir un commentaire, et tous les autres le voient défiler au-dessus en temps réel.",
  },
  "keep-using-app-during-call": {
    q: "Puis-je continuer à utiliser l'application pendant un appel ou un direct ?",
    a: "Oui. Touchez l'icône de réduction (en haut à droite pendant un appel, en bas à droite pendant un direct) pour le réduire à une petite fenêtre vidéo ancrée dans un coin pendant que vous naviguez ailleurs dans l'application. L'appel ou le direct se poursuit pendant tout ce temps ; touchez l'icône d'agrandissement de la fenêtre pour revenir en plein écran, ou son icône pour raccrocher afin d'y mettre fin sans l'agrandir d'abord.",
  },

  story: {
    q: "Qu'est-ce qu'une story ?",
    a: "Une photo, une courte vidéo (2 minutes maximum) ou un texte saisi ou collé, affiché sur votre profil, qui disparaît automatiquement au bout de 24 heures. Touchez le « + » sur votre propre photo de profil pour en ajouter une. Toute personne qui peut voir votre profil peut la consulter tant qu'elle est active.",
  },
  "post-text-only-story": {
    q: "Puis-je publier une story composée uniquement de texte ?",
    a: "Oui. Lorsque vous ajoutez une story, passez à l'onglet « Texte » au lieu de choisir une photo ou une vidéo. Saisissez ou collez ce que vous voulez dire, choisissez une couleur d'arrière-plan et publiez. En coulisses, le texte devient une image : la story fonctionne donc exactement comme n'importe quelle autre (expiration au bout de 24 heures, réactions, réponses, commentaires).",
  },
  "post-more-than-one-story": {
    q: "Puis-je publier plusieurs stories le même jour ?",
    a: "Oui. Dès que vous avez une story active, un petit « + » apparaît sur l'anneau de votre story (dans Accueil comme sur votre profil) pour vous permettre d'en ajouter d'autres sans limite, en plus de pouvoir toucher l'anneau lui-même pour voir celles que vous avez déjà.",
  },
  "move-between-different-peoples-stories": {
    q: "Comment passer des stories d'une personne à celles d'une autre ?",
    a: "Pendant que vous regardez une story, touchez le côté droit de l'écran pour avancer dans les stories de cette même personne, ou le côté gauche pour revenir en arrière. Pour passer aux stories d'une autre personne, balayez vers la gauche (personne suivante) ou vers la droite (personne précédente) n'importe où sur l'écran : le balayage change toujours de personne, quelle que soit la story que vous êtes en train de regarder.",
  },
  "people-react-reply-comment-story": {
    q: "Peut-on réagir à ma story, y répondre ou la commenter ?",
    a: "Oui, les trois sont possibles, et ce sont trois choses différentes : **réagir**, c'est envoyer un emoji rapide (vous voyez qui a réagi en ouvrant votre propre story) ; **répondre** envoie un message privé et ne fonctionne qu'entre personnes déjà en relation, comme la messagerie habituelle ; **commenter** publie un commentaire public, que toute personne qui regarde la story peut voir, accessible depuis l'icône de commentaire à côté des réactions, et vous recevez une notification lorsque quelqu'un commente la vôtre. Il y a aussi une icône de **partage** à côté des commentaires sur chaque story : toute personne qui peut voir la story, et pas seulement son auteur, peut la toucher pour la transférer dans l'une de ses discussions privées ou de groupe. Le destinataire voit la vraie story dans la discussion et peut la toucher pour l'ouvrir en plein écran, dans la même vue que depuis la barre des stories, plutôt qu'un simple message texte à son sujet.",
  },

  "muse-2": {
    q: "Qu'est-ce que Muse ?",
    a: "Un onglet consacré aux vidéos courtes, drôles et créatives : en plein écran, une à la fois ; faites défiler vers le bas pour la suivante et vers le haut pour la précédente (un fil à défilement ordinaire, pas un geste de balayage). Contrairement à une story, un Muse n'expire pas au bout de 24 heures, et contrairement à votre fil Accueil, il ne se limite pas à vos relations : chaque Muse est visible par tout le monde sur YuKon3t. C'est un fil de découverte, et non un fil réservé aux relations.",
  },
  "post-muse": {
    q: "Comment publier un Muse ?",
    a: "Ouvrez votre propre profil et touchez « Publier un Muse ». Choisissez une vidéo (5 minutes maximum), ajoutez une légende si vous le souhaitez, puis publiez. C'est tout, sans autre écran. Une vidéo plus longue (au-delà d'une minute environ) passe par un contrôle de sécurité automatisé supplémentaire avant d'être visible par les autres, ce qui peut prendre un peu plus de temps que pour une vidéo plus courte. Vous pouvez aussi choisir « Audio personnalisé » avant de publier pour joindre un fichier son distinct qui remplace entièrement le son de la vidéo (l'idée d'« ajouter un son » de TikTok). Choisissez « Son d'origine » (le réglage par défaut) pour conserver le son de la vidéo.",
  },
  "delete-muse-after-ive-posted": {
    q: "Puis-je supprimer un Muse après l'avoir publié ?",
    a: "Oui. Ouvrez le Muse dans le fil Muse et touchez l'icône de corbeille vers le haut de l'écran (visible uniquement sur vos propres Muse), puis touchez-la à nouveau pour confirmer. Il est supprimé immédiatement et définitivement, pour vous comme pour tous les autres.",
  },
  "share-reshare-follow-muse": {
    q: "Puis-je partager ou repartager un Muse, ou suivre quelqu'un sur Muse ?",
    a: "Oui, les trois se trouvent à côté des boutons de commentaire et de réaction de chaque Muse. L'icône de partage ouvre un panneau : partagez le Muse sur votre **Accueil**, ajoutez-le à votre **story** (pour les Muse de 2 minutes maximum), envoyez-le à un ami ou à un groupe, utilisez le menu de partage de votre appareil ou copiez le lien. Accueil, story, amis et menu de partage de l'appareil envoient tous la vraie vidéo, et pas seulement un lien. L'icône de repartage (une flèche circulaire) place la vidéo sur votre Accueil d'un seul toucher : elle crédite son créateur, lui envoie une notification, et la toucher à nouveau retire la vidéo. « S'abonner », à côté du nom du créateur, permet de le suivre pour être informé de ses prochaines publications. Rien de tout cela ne nécessite d'être d'abord en relation avec le créateur, tout comme pour réagir ou commenter.",
  },
  "share-post-muse": {
    q: "Puis-je partager une publication sur Muse ?",
    a: "Oui. Toute publication contenant une vidéo (5 minutes maximum) peut être partagée sur Muse : ouvrez le menu de partage de cette publication et touchez « Partager sur Muse ». Elle devient un nouveau Muse à votre nom, qui crédite l'original par un lien « Voir la publication d'origine » ; l'auteur de l'original reçoit une notification et un partage lui est compté, comme lorsque vous la partagez dans votre story ou dans un Circle. Les publications sans vidéo (texte, photo, lien, contenu intégré, GIF) ne peuvent pas être partagées sur Muse : il n'existe pas de format Muse sans vidéo.",
  },
  "view-count-muse-mean": {
    q: "Que signifie le nombre de vues d'un Muse ?",
    a: "L'icône d'œil sous la légende compte le nombre de fois où ce Muse a été vu, y compris par vous. C'est un total cumulé, et non un nombre de spectateurs uniques.",
  },
  "muse-play-sound": {
    q: "Muse se lance-t-il avec le son ?",
    a: "Oui. Muse se lance avec le son activé dès son ouverture ; touchez l'icône de haut-parleur vers le haut de l'écran pour couper le son, et il reste coupé lorsque vous passez au Muse suivant. Certains navigateurs ne diffusent aucun son tant que vous n'avez pas touché la page une fois. Si c'est le cas du vôtre, la vidéo est lue sans le son avec l'indication « Touchez pour activer le son », et votre prochain toucher active le son.",
  },
  "react-comment-muse": {
    q: "Puis-je réagir à un Muse ou le commenter ?",
    a: "Oui. Vous y trouvez la même rangée de réactions rapides que pour les publications et les stories (touchez le + à son extrémité pour tous les emojis), ainsi qu'un fil de commentaires publics (touchez l'icône de commentaire pour l'ouvrir dans un panneau venant du bas). Le créateur, l'auteur du commentaire ou un administrateur peuvent retirer n'importe quel commentaire.",
  },
  "need-keep-scrolling-see-theres": {
    q: "Dois-je continuer à faire défiler pour savoir s'il y en a d'autres ?",
    a: "Non. Muse charge le lot de vidéos suivant en arrière-plan lorsque vous approchez de la fin de ce qui est déjà chargé, si bien que le défilement paraît continu.",
  },

  "ambient-2": {
    q: "Qu'est-ce qu'Ambient ?",
    a: "Paramètres → « Ambient » vous permet de choisir un Inner Circle restreint (jusqu'à 8 personnes avec lesquelles vous êtes déjà en relation) et de partager des « instants » en photo, pris sur le vif, qu'elles seules peuvent voir, à la place d'une publication publique soignée. Un instant disparaît au bout de 48 heures.",
  },
  "who-see-ambient-moments": {
    q: "Qui peut voir mes instants Ambient ?",
    a: "Uniquement les personnes qui *vous* ont ajouté à leur propre Inner Circle. Jamais personne d'autre, et jamais sur votre profil public, dans le fil ni dans Découvrir. Ajouter quelqu'un à votre Inner Circle est à sens unique, comme un abonnement : cette personne n'a pas besoin de vous ajouter en retour pour que vous voyiez les siens.",
  },
  "there-lock-screen-watch-widget": {
    q: "Existe-t-il un widget pour l'écran de verrouillage ou la montre ?",
    a: "Pas encore. Cela demande un vrai développement natif pour chaque plateforme. En attendant, Paramètres → « Ambient » affiche dans l'application un aperçu de ce à quoi ressemblerait votre fil Ambient, et un jeton d'accès pour widget peut déjà être généré, pour le jour où un widget existera.",
  },
} satisfies Partial<FaqItems>;
