import type { settingsEn } from "@/lib/i18n/en/settings";
import { serverUnreachable } from "@/lib/i18n/fr/common";

// "Inner Circle" and "Ambient" are feature names and stay as they are, like Circles and Muse.
export const settings: typeof settingsEn = {
  title: "Paramètres",
  signedInAs: "Compte connecté : {email}",
  editProfile: "Vous souhaitez modifier votre nom, votre bio, votre photo ou vos centres d'intérêt ? {link}.",
  editProfileLink: "Modifiez votre profil",
  faq: "Vous découvrez YuKon3t ou vous cherchez comment fonctionne quelque chose ? {link}.",
  faqLink: "Consultez la FAQ",
  passwordResetRequired: "Pour votre sécurité, veuillez choisir un nouveau mot de passe",
  saved: "Paramètres mis à jour.",
  errors: {
    username_taken: "Ce nom d'utilisateur est déjà pris. Essayez-en un autre.",
    current_password_invalid: "Le mot de passe actuel est incorrect.",
    same_password: "C'est votre mot de passe actuel. Pour votre sécurité, choisissez-en un autre.",
    rate_limited: "Trop de tentatives. Réessayez dans quelques minutes.",
    other: "Veuillez vérifier les informations saisies.",
  },
  saving: "Enregistrement...",
  privacy: {
    heading: "Confidentialité",
    intro: "Détermine ce que peuvent voir les personnes qui ne font pas partie de vos relations.",
    postsVisibility: "Qui peut voir vos publications",
    public: "Toute personne connectée",
    connectionsOnly: "Mes relations uniquement",
    discoverable: "Afficher mon profil dans Découvrir",
    save: "Enregistrer les paramètres de confidentialité",
    hiddenChats: "Discussions masquées",
  },
  notifications: {
    heading: "Notifications",
    intro:
      "Recevez une notification pour les appels entrants et les nouveaux messages, même lorsque YuKon3t n'est pas ouvert dans un onglet.",
    native: "Les notifications sont déjà activées pour l'application. Inutile de les activer séparément ici.",
    unsupported: "Pas encore disponible sur cet appareil ou ce navigateur.",
    denied:
      "Les notifications de ce site sont bloquées dans les réglages de votre navigateur. Autorisez-les à cet endroit pour activer cette option.",
    turnOff: "Désactiver les notifications",
    enable: "Activer les notifications",
  },
  language: {
    heading: "Langue",
    body: "Toute l'application, les écrans de connexion et la FAQ sont disponibles dans ces langues, et les notifications envoyées sur votre téléphone suivent celle que vous choisissez ici. Les pages juridiques sont en anglais.",
  },
  emoji: {
    heading: "Style des emojis",
    intro: "Choisissez l'apparence des emojis partout dans l'application : réactions, messages et publications.",
    styles: {
      native: "Natif",
      apple: "Apple (style 3D)",
      google: "Google",
      facebook: "Facebook (style 2.5D)",
      twitter: "Twitter/X",
    },
  },
  invite: {
    heading: "Inviter des amis",
    intro:
      "Envoyez le lien de l'application directement aux contacts de votre téléphone qui ne sont pas encore sur YuKon3t.",
  },
  blocked: {
    heading: "Comptes bloqués",
    intro:
      "Ces comptes ne peuvent ni vous écrire, ni vous appeler, ni entrer en relation avec vous, et vous ne les verrez pas dans Découvrir.",
    deleted: "Compte supprimé",
  },
  calls: {
    heading: "Appels",
    intro: "Utilisée pour les appels audio comme pour les appels vidéo.",
    ringtone: "Sonnerie",
    save: "Enregistrer la sonnerie",
    preview: "Écouter",
    ringtones: {
      CLASSIC: "Sonnerie classique",
      CHIME: "Carillon",
      DIGITAL: "Numérique",
      MARIMBA: "Marimba",
      PULSE: "Pulsation",
    },
  },
  signInMethod: {
    heading: "Méthode de connexion",
    withPassword:
      "Vous pouvez vous connecter avec votre nom d'utilisateur et votre mot de passe, ou avec le lien par e-mail.",
    withoutPassword:
      "Ajoutez un nom d'utilisateur et un mot de passe comme alternative au lien de connexion par e-mail.",
    username: "Nom d'utilisateur",
    usernameIs: "Nom d'utilisateur : {username}",
    currentPassword: "Mot de passe actuel",
    newPassword: "Nouveau mot de passe",
    password: "Mot de passe",
    signsOut: "Changer de mot de passe vous déconnecte de tous vos autres appareils.",
    update: "Mettre à jour le mot de passe",
    updating: "Mise à jour...",
    set: "Définir le mot de passe",
    setting: "Enregistrement...",
  },
  phone: {
    heading: "Vérification du téléphone",
    intro: "Facultatif : vérifier un numéro de téléphone améliore votre indice de confiance.",
    verified: "Téléphone vérifié : {number}",
  },
  data: {
    heading: "Vos données",
    stored:
      "Vos publications, photos, vidéos, messages, Circles et relations sont stockés sur nos serveurs, et non sur un appareil en particulier. En vous connectant sur un nouveau téléphone ou ordinateur avec la même adresse e-mail ou le même nom d'utilisateur, vous retrouvez donc tout automatiquement. Rien à déplacer ni à restaurer à la main.",
    exportIntro:
      "Vous pouvez aussi exporter au format JSON tout ce que nous détenons à votre sujet, à tout moment et gratuitement : une sauvegarde personnelle que vous conservez en dehors de YuKon3t.",
    export: "Exporter mes données",
    exportLimited: "Trop d'exports récemment. Réessayez dans un moment.",
    deactivateHeading: "Désactiver le compte",
    deactivateIntro:
      "Masque temporairement votre profil et vos publications. Rien n'est supprimé : reconnectez-vous à tout moment avec votre mot de passe ou le lien par e-mail pour le réactiver.",
    deactivate: "Désactiver mon compte",
    deactivateConfirm: "Oui, désactiver",
    deleteHeading: "Supprimer le compte",
    deleteIntro:
      "Supprime définitivement votre profil, vos publications, vos messages et les Circles qui vous appartiennent. Cette action est irréversible. Elle est toujours gratuite, et nous n'y mettons jamais d'obstacle.",
    delete: "Supprimer mon compte",
    deleteConfirm: "Oui, supprimer définitivement",
    cancel: "Annuler",
  },
  verifyDevice: {
    usedBody:
      "Ce lien de vérification a expiré ou a déjà été utilisé. Relancez le changement de mot de passe depuis les Paramètres.",
    backToSettings: "Retour aux Paramètres",
    body: "Pour votre sécurité, saisissez le code à 6 chiffres que nous venons de vous envoyer par e-mail pour terminer le changement de mot de passe.",
    submit: "Confirmer le changement de mot de passe",
    cancel: "Annuler",
  },
  ambient: {
    heading: "Ambient",
    intro:
      "Une poignée de personnes que vous connaissez vraiment et des instants spontanés plutôt que des publications travaillées. Ce n'est qu'une première base : pas encore de widget pour l'écran verrouillé.",
    manage: "Gérer l'Inner Circle",
    page: {
      intro:
        "Une présence au quotidien plutôt qu'une mise en scène : une poignée de personnes que vous connaissez vraiment et des instants spontanés plutôt que des publications travaillées. Il n'existe pas encore de widget pour l'écran verrouillé ou l'écran d'accueil, ni d'application pour montre (cela demande un développement natif que cette page ne peut pas assurer seule), mais tout ce qui suit fonctionne dès maintenant dans l'application et en constitue la base.",
      circleHeading: "Votre Inner Circle",
      circleIntro:
        "Les personnes présentes ici sont celles que votre fil Ambient (et un futur widget) afficherait. Ce n'est pas la même chose que vos abonnements.",
      momentHeading: "Partager un instant",
      momentIntro:
        "Une photo, une légende facultative : visible uniquement par les personnes qui vous comptent dans leur Inner Circle, et effacée au bout de 48 heures.",
      feedHeading: "Votre fil Ambient (aperçu)",
      feedIntro:
        "Ce que vous verriez de votre Inner Circle. Ce sont les mêmes données que celles que /api/ambient/feed renvoie pour un futur widget, affichées ici puisqu'aucun widget n'existe encore.",
      widgetHeading: "Pour un futur widget",
    },
    circle: {
      spots: "{count} places occupées sur {max}.",
      unnamed: "Sans nom",
      remove: "Retirer",
      addFrom: "Ajouter depuis vos relations",
      add: "Ajouter",
      empty:
        "Commencez par entrer en relation avec quelques personnes : l'Inner Circle ne fonctionne qu'avec de vraies relations acceptées.",
      errors: {
        rate_limited: "Trop de modifications à la fois. Patientez un instant, puis réessayez.",
        not_connected: "Vous ne pouvez ajouter qu'une personne avec laquelle vous êtes en relation.",
        limit_reached: "L'Inner Circle est limité à {max} personnes. Retirez d'abord quelqu'un.",
        other: "Une erreur s'est produite. Réessayez.",
      },
    },
    moment: {
      choosePhoto: "Choisir une photo",
      caption: "Ajouter une légende (facultatif)",
      sharing: "Partage en cours…",
      active:
        "Vos instants actifs : visibles par toute personne qui vous compte dans son Inner Circle, effacés au bout de 48 heures",
      delete: "Supprimer",
      errors: {
        type: "Utilisez une image JPEG, PNG ou WebP.",
        not_configured: "Les envois ne sont pas encore disponibles. Revenez bientôt.",
        network: serverUnreachable,
        upload: "L'envoi a échoué. Réessayez.",
        invalid: "Impossible de lire ce fichier. Réessayez.",
        rate_limited: "Trop d'instants à la fois. Patientez un peu, puis réessayez.",
        too_large: "L'image ne doit pas dépasser 25 Mo.",
        moderation: "Cette photo ne respecte pas nos règles de contenu et n'a pas été enregistrée.",
        server_error: "Une erreur s'est produite lors de l'enregistrement. Réessayez.",
        other: "Une erreur s'est produite.",
      },
    },
    feed: {
      empty:
        "Rien de la part de votre Inner Circle pour le moment. Les instants apparaissent ici (et apparaîtraient dans un futur widget) pendant 48 heures après leur partage.",
    },
    token: {
      heading: "Jeton d'accès du widget",
      intro:
        "Aucun widget d'écran verrouillé ni application pour montre n'existe encore : il s'agit seulement de l'identifiant dont ils auraient besoin. Gardez-le pour vous : toute personne qui le détient peut lire (mais pas publier) les instants de votre Inner Circle.",
      activeSince: "Activé : {when}",
      lastUsed: "dernière utilisation : {when}",
      copyNow: "Copiez-le maintenant : il ne sera plus affiché. En générer un nouveau révoque celui-ci.",
      copy: "Copier",
      copied: "Copié",
      generate: "Générer un jeton",
      generateNew: "Générer un nouveau jeton",
      revoke: "Révoquer",
    },
  },
};
