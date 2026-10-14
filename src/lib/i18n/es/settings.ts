import type { settingsEn } from "@/lib/i18n/en/settings";
import { serverUnreachable } from "@/lib/i18n/es/common";

// "Inner Circle" and "Ambient" are feature names and stay as they are, like Circles and Muse.
export const settings: typeof settingsEn = {
  title: "Ajustes",
  signedInAs: "Sesión iniciada como {email}",
  editProfile: "¿Quieres cambiar tu nombre, biografía, foto o intereses? {link}.",
  editProfileLink: "Edita tu perfil",
  faq: "¿Es tu primera vez en YuKon3t o quieres saber cómo funciona algo? {link}.",
  faqLink: "Consulta las preguntas frecuentes",
  passwordResetRequired: "Por tu seguridad, elige una contraseña nueva",
  saved: "Ajustes actualizados.",
  errors: {
    username_taken: "Ese nombre de usuario ya está en uso. Prueba con otro.",
    current_password_invalid: "La contraseña actual no es correcta.",
    same_password: "Esa es tu contraseña actual. Por tu seguridad, elige una distinta.",
    rate_limited: "Demasiados intentos. Inténtalo de nuevo en unos minutos.",
    other: "Revisa los datos que ingresaste.",
  },
  saving: "Guardando...",
  privacy: {
    heading: "Privacidad",
    intro: "Controla lo que pueden ver las personas que no son tus contactos.",
    postsVisibility: "Quién puede ver tus publicaciones",
    public: "Cualquier persona con sesión iniciada",
    connectionsOnly: "Solo mis contactos",
    discoverable: "Mostrar mi perfil en Descubrir",
    save: "Guardar ajustes de privacidad",
    hiddenChats: "Chats ocultos",
  },
  notifications: {
    heading: "Notificaciones",
    intro: "Recibe avisos de llamadas entrantes y mensajes nuevos aunque YuKon3t no esté abierto en una pestaña.",
    native: "Las notificaciones ya están activadas en la aplicación. No hace falta activarlas aquí por separado.",
    unsupported: "Aún no está disponible en este dispositivo o navegador.",
    denied:
      "Las notificaciones de este sitio están bloqueadas en los ajustes de tu navegador. Actívalas ahí para poder usar esta opción.",
    turnOff: "Desactivar notificaciones",
    enable: "Activar notificaciones",
  },
  language: {
    heading: "Idioma",
    body: "Toda la aplicación, las pantallas de inicio de sesión y las preguntas frecuentes están disponibles en estos idiomas, y las notificaciones que llegan a tu teléfono siguen el que elijas aquí. Las páginas legales están en inglés.",
  },
  emoji: {
    heading: "Estilo de emojis",
    intro: "Elige cómo se ven los emojis en toda la aplicación: reacciones, mensajes y publicaciones.",
    styles: {
      native: "Nativo",
      apple: "Apple (estilo 3D)",
      google: "Google",
      facebook: "Facebook (estilo 2.5D)",
      twitter: "Twitter/X",
    },
  },
  invite: {
    heading: "Invitar amigos",
    intro:
      "Envía el enlace de la aplicación directamente a las personas de la agenda de tu teléfono que aún no están en YuKon3t.",
  },
  blocked: {
    heading: "Cuentas bloqueadas",
    intro: "No pueden enviarte mensajes, llamarte ni conectar contigo, y no las verás en Descubrir.",
    deleted: "Cuenta eliminada",
  },
  calls: {
    heading: "Llamadas",
    intro: "Suena tanto en las llamadas de voz como en las videollamadas.",
    ringtone: "Tono de llamada",
    save: "Guardar tono",
    preview: "Escuchar",
    ringtones: {
      CLASSIC: "Timbre clásico",
      CHIME: "Campanilla",
      DIGITAL: "Digital",
      MARIMBA: "Marimba",
      PULSE: "Pulso",
    },
  },
  signInMethod: {
    heading: "Método de inicio de sesión",
    withPassword: "Puedes iniciar sesión con tu nombre de usuario y contraseña, o con el enlace por correo.",
    withoutPassword: "Agrega un nombre de usuario y una contraseña como alternativa al enlace de acceso por correo.",
    username: "Nombre de usuario",
    usernameIs: "Nombre de usuario: {username}",
    currentPassword: "Contraseña actual",
    newPassword: "Contraseña nueva",
    password: "Contraseña",
    signsOut: "Al cambiar tu contraseña se cierra tu sesión en todos los demás dispositivos.",
    update: "Actualizar contraseña",
    updating: "Actualizando...",
    set: "Establecer contraseña",
    setting: "Guardando...",
  },
  phone: {
    heading: "Verificación del teléfono",
    intro: "Opcional: verificar un número de teléfono mejora tu nivel de confianza.",
    verified: "Teléfono verificado: {number}",
  },
  data: {
    heading: "Tus datos",
    stored:
      "Tus publicaciones, fotos, videos, mensajes, Circles y contactos se guardan en nuestros servidores, no en un dispositivo concreto. Por eso, al iniciar sesión en otro teléfono o computadora con este mismo correo o nombre de usuario, todo te acompaña automáticamente. No hay nada que mover ni restaurar a mano.",
    exportIntro:
      "También puedes exportar en formato JSON todo lo que tenemos sobre ti, cuando quieras y gratis: una copia de seguridad personal que guardas fuera de YuKon3t.",
    export: "Exportar mis datos",
    exportLimited: "Demasiadas exportaciones recientes. Inténtalo de nuevo en un rato.",
    deactivateHeading: "Desactivar cuenta",
    deactivateIntro:
      "Oculta temporalmente tu perfil y tus publicaciones. No se elimina nada: vuelve a iniciar sesión cuando quieras con tu contraseña o con el enlace por correo para reactivarla.",
    deactivate: "Desactivar mi cuenta",
    deactivateConfirm: "Sí, desactivar",
    deleteHeading: "Eliminar cuenta",
    deleteIntro:
      "Elimina de forma permanente tu perfil, tus publicaciones, tus mensajes y los Circles que te pertenecen. No se puede deshacer, y nunca cobramos ni ponemos trabas para hacerlo.",
    delete: "Eliminar mi cuenta",
    deleteConfirm: "Sí, eliminar definitivamente",
    cancel: "Cancelar",
  },
  verifyDevice: {
    usedBody: "Este enlace de verificación venció o ya se usó. Intenta cambiar tu contraseña de nuevo desde Ajustes.",
    backToSettings: "Volver a Ajustes",
    body: "Por tu seguridad, ingresa el código de 6 dígitos que te acabamos de enviar por correo para terminar de cambiar tu contraseña.",
    submit: "Confirmar cambio de contraseña",
    cancel: "Cancelar",
  },
  ambient: {
    heading: "Ambient",
    intro:
      "Unas pocas personas que conoces de verdad y momentos espontáneos en lugar de publicaciones elaboradas. Es una primera base: aún no hay widget para la pantalla de bloqueo.",
    manage: "Administrar Inner Circle",
    page: {
      intro:
        "Presencia cotidiana en lugar de publicaciones para lucirse: unas pocas personas que conoces de verdad y momentos espontáneos en lugar de publicaciones elaboradas. Todavía no hay widget para la pantalla de bloqueo ni para la pantalla de inicio, ni aplicación para reloj (eso requiere un desarrollo nativo que esta página no puede hacer por sí sola), pero todo lo de abajo ya funciona dentro de la aplicación y sirve de base.",
      circleHeading: "Tu Inner Circle",
      circleIntro:
        "Quienes estén aquí son las personas que mostraría tu feed de Ambient (y un futuro widget). No es lo mismo que las personas a las que te suscribes o sigues.",
      momentHeading: "Compartir un momento",
      momentIntro:
        "Una foto y, si quieres, un texto. Solo la ven quienes te tienen en su Inner Circle, y desaparece a las 48 horas.",
      feedHeading: "Tu feed de Ambient (vista previa)",
      feedIntro:
        "Lo que verías de tu Inner Circle. Son los mismos datos que /api/ambient/feed devuelve para un futuro widget; se muestran aquí porque aún no existe ninguno.",
      widgetHeading: "Para un futuro widget",
    },
    circle: {
      spots: "{count} de {max} lugares ocupados.",
      unnamed: "Sin nombre",
      remove: "Quitar",
      addFrom: "Agregar desde tus contactos",
      add: "Agregar",
      empty: "Primero conecta con algunas personas: Inner Circle solo funciona con contactos reales y aceptados.",
      errors: {
        rate_limited: "Demasiados cambios a la vez. Espera un momento e inténtalo de nuevo.",
        not_connected: "Solo puedes agregar a alguien que ya sea tu contacto.",
        limit_reached: "Inner Circle admite un máximo de {max} personas. Quita a alguien primero.",
        other: "Algo salió mal. Inténtalo de nuevo.",
      },
    },
    moment: {
      choosePhoto: "Elegir una foto",
      caption: "Agrega un texto (opcional)",
      sharing: "Compartiendo…",
      active: "Tus momentos activos: los ve cualquiera que te tenga en su Inner Circle y desaparecen a las 48 horas",
      delete: "Eliminar",
      errors: {
        type: "Usa una imagen JPEG, PNG o WebP.",
        not_configured: "Las subidas aún no están disponibles. Vuelve pronto.",
        network: serverUnreachable,
        upload: "No se pudo subir. Inténtalo de nuevo.",
        invalid: "No pudimos leer ese archivo. Inténtalo de nuevo.",
        rate_limited: "Demasiados momentos a la vez. Espera un poco e inténtalo de nuevo.",
        too_large: "La imagen debe pesar 25 MB o menos.",
        moderation: "Esa foto no cumple nuestras normas de contenido y no se guardó.",
        server_error: "Algo salió mal al guardar. Inténtalo de nuevo.",
        other: "Algo salió mal.",
      },
    },
    feed: {
      empty:
        "No hay nada de tu Inner Circle por ahora. Los momentos aparecen aquí (y aparecerían en un futuro widget) durante 48 horas después de que alguien comparte uno.",
    },
    token: {
      heading: "Token de acceso para el widget",
      intro:
        "Aún no existe un widget para la pantalla de bloqueo ni una aplicación para reloj: esto es solo la credencial que necesitaría. Mantenlo en privado: cualquiera que lo tenga puede leer (no publicar) los momentos de tu Inner Circle.",
      activeSince: "Activado: {when}",
      lastUsed: "último uso: {when}",
      copyNow: "Cópialo ahora: no se volverá a mostrar. Si generas uno nuevo, este deja de funcionar.",
      copy: "Copiar",
      copied: "Copiado",
      generate: "Generar token",
      generateNew: "Generar un token nuevo",
      revoke: "Revocar",
    },
  },
};
