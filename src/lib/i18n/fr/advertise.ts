import type { advertiseEn } from "@/lib/i18n/en/advertise";
import { serverUnreachable } from "@/lib/i18n/fr/common";

export const advertise: typeof advertiseEn = {
  page: {
    eyebrow: "Faites votre publicité sur YuKon3t",
    title: "Présentez votre entreprise à une audience mondiale et vérifiée.",
    intro:
      "Un tarif unique, aucun compte requis, aucun ciblage d'audience à configurer : votre annonce est diffusée dans toute l'application pendant le nombre de jours de votre choix. Chaque annonce est examinée avant sa mise en ligne, et le tarif est de {price} par jour.",
    canceled:
      "Le paiement a été annulé et rien n'a été débité. Vous pouvez soumettre à nouveau votre annonce quand vous le souhaitez.",
    notConfigured:
      "La réservation d'annonces n'est pas encore disponible. Revenez bientôt ou contactez-nous directement.",
  },
  success: {
    eyebrow: "Paiement reçu",
    title: "Merci, votre annonce est réservée.",
    body: "Nous examinerons votre annonce sous peu (généralement sous un jour ouvré) avant sa mise en ligne. Si nous avons des questions, nous vous écrirons à l'adresse e-mail de contact que vous avez indiquée.",
    back: "Retour à YuKon3t",
  },
  form: {
    company: "Nom de l'entreprise",
    contactName: "Nom du contact",
    contactEmail: "E-mail de contact",
    emailPlaceholder: "vous@entreprise.com",
    emailHint: "Votre reçu et le statut de l'examen y seront envoyés.",
    headline: "Titre",
    headlinePlaceholder: "Que souhaitez-vous promouvoir ?",
    copy: "Texte de l'annonce",
    copyPlaceholder: "Une ou deux phrases décrivant ce que vous proposez.",
    link: "URL du lien",
    linkPlaceholder: "https://votreentreprise.com",
    creative: "Visuel",
    removeMedia: "Retirer le média",
    addPhoto: "Ajouter une photo",
    addVideo: "Ajouter une vidéo",
    uploadFromDevice: "Importer depuis l'appareil",
    takePhoto: "Prendre une photo",
    duration: "Durée",
    days: "one: # jour | other: # jours",
    total: "Total",
    preparing: "Préparation du paiement...",
    continue: "Continuer vers le paiement : {price}",
    stripeNote:
      "Le paiement est sécurisé par Stripe. Les annonces sont mises en ligne après un examen rapide, généralement sous un jour ouvré.",
    oneTime:
      "one: Paiement unique pour # jour seulement, sans renouvellement automatique ni prélèvement récurrent. Lancer une autre campagne plus tard nécessite une nouvelle réservation et un paiement distinct. | other: Paiement unique pour # jours seulement, sans renouvellement automatique ni prélèvement récurrent. Lancer une autre campagne plus tard nécessite une nouvelle réservation et un paiement distinct.",
    errors: {
      too_large: "Ce fichier est trop volumineux.",
      moderation: "Ce visuel ne respecte pas nos règles de contenu.",
      rate_limited: "Trop de tentatives. Réessayez dans un instant.",
      not_configured: "La réservation d'annonces n'est pas encore disponible. Revenez bientôt.",
      payment_setup_failed: "Impossible de lancer le paiement. Réessayez.",
      invalid: "Veuillez vérifier les informations saisies.",
      network: serverUnreachable,
      captcha: "Nous n'avons pas pu terminer la vérification de sécurité. Patientez un instant, puis réessayez.",
      other: "Impossible d'envoyer cette réservation. Réessayez.",
      imageType: "Utilisez une image JPEG, PNG ou WebP.",
      imageTooLarge: "Les images doivent faire 25 Mo au maximum.",
      videoType: "Utilisez une vidéo MP4, MOV ou WebM.",
      videoTooLarge: "La vidéo doit faire 2 Go au maximum.",
      videoTooLong:
        "one: Les vidéos doivent durer # seconde au maximum. | other: Les vidéos doivent durer # secondes au maximum.",
      details: "Renseignez les informations sur votre entreprise et votre contact.",
      adFields: "Renseignez le titre, le texte et le lien de votre annonce.",
      media: "Ajoutez une photo ou une vidéo à votre annonce.",
      securityWait: "Vérification de sécurité en cours. Réessayez dans un instant.",
      securityExpired: "La vérification de sécurité a expiré. Patientez un instant, puis réessayez.",
    },
  },
};
