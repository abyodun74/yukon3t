import type { inviteEn } from "@/lib/i18n/en/invite";
import { phoneInvalid } from "@/lib/i18n/es/common";
import { shared } from "@/lib/i18n/es/shared";

// The contacts here are the phone's address book ("la agenda", "contactos del teléfono"), not the people someone is
// connected with on YuKon3t.
export const invite: typeof inviteEn = {
  controls: { phoneField: shared.phoneField, phoneInvalid },
  title: "Invitar amigos",
  intro: "Trae a YuKon3t a la gente que conoces.",
  message: "Únete a mí en YuKon3t y conecta con personas de otras culturas, intereses y países:",
  linkHeading: "Tus enlaces de invitación",
  copy: "Copiar",
  copied: "¡Copiado!",
  copyFailed: "No se pudo copiar",
  share: "Compartir",
  shareFailed: "No se pudo compartir. Inténtalo de nuevo.",
  whatsApp: "WhatsApp",
  whatsAppLabel: "Invitar por WhatsApp",
  textHeading: "Invitar por mensaje de texto o WhatsApp",
  textIntro:
    "Elige personas de tu agenda (donde sea posible) o ingresa un número, y envía a cada una un mensaje de texto o de WhatsApp con los enlaces de la App Store y Google Play.",
  openingContacts: "Abriendo la agenda…",
  chooseContacts: "Elegir de la agenda",
  phoneLabel: "Número de teléfono",
  add: "Agregar",
  invite: "Invitar",
  // Visible label of the contact row's sms: action (the WhatsApp one reuses `whatsApp`), then a one-line hint for Android's "open with" chooser.
  textButton: "SMS",
  textHint: "Si tu teléfono te pregunta con qué abrirlo, elige Mensajes.",
  remove: "Quitar",
  pickerTitle: "Elegir de la agenda",
  searchContacts: "Buscar en la agenda",
  noMatches: "Nadie coincide con la búsqueda.",
  addSelected: "one: Agregar # seleccionado | other: Agregar # seleccionados",
  selectToAdd: "Selecciona a quién agregar",
  phoneKinds: { mobile: "Móvil", home: "Casa", work: "Trabajo", other: "Otro" },
  errors: {
    permission:
      "Se denegó el permiso para acceder a la agenda. Actívalo para YuKon3t en los ajustes de tu teléfono para invitar desde tu agenda.",
    noNumbers: "Nadie de tu agenda tiene un número de teléfono guardado.",
    openFailed: "No pudimos abrir tu agenda. Inténtalo de nuevo.",
    pickedNoNumbers: "Esas personas no tienen un número de teléfono guardado.",
  },
};
