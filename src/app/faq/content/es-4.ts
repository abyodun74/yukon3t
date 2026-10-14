import type { FaqItems } from "../ids";

// Spanish FAQ, part 4: Circles and Collab Boards, Advertising, Inviting friends, Your account and data, Privacy,
// safety and trust.
export const es4 = {
  circle: {
    q: "¿Qué es un Circle?",
    a: "Una comunidad gratuita en torno a un interés o una identidad: aficiones, causas, culturas, cualquier cosa alrededor de la cual un grupo de miembros quiera organizarse. Cualquiera puede crear uno; crear un Circle y unirse a uno siempre es gratis.",
  },
  "who-see-shared-circle-sub": {
    q: "¿Quién puede ver lo que se comparte en un Circle o en un sub-Circle?",
    a: "Depende de la privacidad del Circle. Las publicaciones, los videos y las transmisiones en vivo de un Circle **público** son públicos: pueden aparecer en Inicio y en la búsqueda, se pueden republicar o compartir en una historia, en Muse o en otro Circle, y notifican a los suscriptores como cualquier publicación pública. Las publicaciones, los videos, las conversaciones de los canales, las salas de voz y las transmisiones en vivo de un Circle **privado** (o de un sub-Circle privado) solo son visibles para sus miembros: nunca aparecen en Inicio, en la búsqueda ni en los perfiles, y no se pueden republicar ni compartir fuera. Un canal privado dentro de un Circle público es solo para miembros de la misma manera. Cada sub-Circle tiene su propia privacidad y sus propios miembros: estar en el Circle principal no te permite ver el contenido de un sub-Circle privado, y viceversa.",
  },
  "pick-category-circle": {
    q: "¿Cómo elijo una categoría para mi Circle?",
    a: "Búscala al crear el Circle. La lista incluye temas generales (Viajes, Cultura, Tecnología y startups, y más) además de tipos de trabajo y profesiones específicos (Bookkeeping, Civil Engineer, Cybersecurity Analyst, Linux Administrator y decenas más, que aparecen en inglés), para que encuentres exactamente la adecuada en lugar de una categoría genérica de «Profesional». Puedes elegir hasta 5 categorías para un mismo Circle si de verdad le corresponde más de una.",
  },
  "rename-circle-change-its-theme": {
    q: "¿Puedo cambiar el nombre, la temática, las categorías o la privacidad de mi Circle después de crearlo?",
    a: "Sí. El propietario o un coadmin puede tocar el ícono de lápiz que está junto al nombre del Circle, en su página, para cambiar en cualquier momento el nombre, la temática (la descripción de qué trata el Circle, que escribiste al crearlo), las categorías o la privacidad (público o privado). Su URL nunca cambia cuando le cambias el nombre, así que los enlaces y marcadores existentes siguen funcionando. Hacer privado un Circle oculta de inmediato sus publicaciones y transmisiones en vivo a quienes no son miembros (y hace privados también sus sub-Circles); los miembros actuales se quedan. Hacerlo público permite que cualquiera se una y lo vea, y borra las solicitudes de ingreso pendientes porque ya no hacen falta. Un sub-Circle de un Circle privado no se puede hacer público.",
  },
  "sub-circles": {
    q: "¿Qué son los sub-Circles?",
    a: "Un sub-Circle es un Circle más pequeño que vive dentro de un Circle principal: por ejemplo, un sub-Circle «Diseño» y otro «Marketing» dentro de un Circle «Fundadores de startups». Abre el Circle principal y verás sus sub-Circles listados en su página. Cada uno tiene sus propios miembros, sus propios canales y publicaciones y su propia lista de miembros en su propia página, y puedes unirte a cualquiera de ellos por separado: no tienes que unirte antes al Circle principal, y unirte a uno no te une a los demás. Solo el propietario del Circle principal puede agregar sub-Circles (toca «Agregar un sub-Circle» en la página del Circle principal). Los sub-Circles tienen un solo nivel de profundidad, y un sub-Circle de un Circle privado también es privado. Al eliminar un Circle principal se eliminan también sus sub-Circles.",
  },
  "invite-someone-circles-voice-channel": {
    q: "¿Cómo invito a alguien al canal de voz de un Circle?",
    a: "Abre el canal de voz y toca «Invitar» para elegir entre los miembros del Circle. Cualquier miembro puede invitar a otro, no solo el propietario o los coadmins. El canal muestra un recuento de cuántas invitaciones están pendientes, aceptadas y rechazadas. Aceptar una invitación no mete a alguien directamente en la sala por sí solo: esa persona aún tiene que tocar para entrar, igual que cualquier otra.",
  },
  "collab-board": {
    q: "¿Qué es un Collab Board?",
    a: "Un lugar para encontrar intercambios de habilidades entre países, mentorías, servicios profesionales, eventos y proyectos. El campo «Tipo» es una lista en la que puedes buscar (intercambio de habilidades, asesoría fiscal, contabilidad y teneduría de libros, orientación profesional, ventas y marketing, y decenas más) en lugar de un puñado fijo de opciones. Las publicaciones se pueden limitar a países concretos o marcar como para todo el mundo. Cuando ya participas, tienes acceso al chat grupal de esa colaboración (texto, fotos y videos) y a una sesión de video en vivo con pantalla compartida, materiales subidos y grabación.",
  },
  "difference-between-public-private-collab": {
    q: "¿Qué diferencia hay entre un Collab Board público y uno privado?",
    a: "Las colaboraciones **públicas** se anuncian a todos y aparecen en Collab Boards: cualquiera puede tocar «Solicitar unirme», y quien organiza o un coadmin revisa cada solicitud (Aprobar/Rechazar) antes de dar acceso. Las colaboraciones **privadas** son solo por invitación: quien organiza elige a contactos concretos para invitarlos, ya sea al publicarla o más tarde con «Invitar personas» en la página de la colaboración, y nunca aparecen en listas ni en búsquedas; solo pueden verlas quien organiza y quienes fueron invitados o ya se unieron. Una persona invitada ve un aviso para aceptar o rechazar en la página de la colaboración hasta que responde.",
  },
  "starting-joining-collab-session-work": {
    q: "¿Cómo funciona empezar una sesión de Collab o unirse a una?",
    a: "Solo quien organiza o un coadmin puede empezar una sesión desde cero: verá un botón «Empezar la sesión» en la página de la colaboración y, al tocarlo, se conecta enseguida, sin más confirmación. Los demás solo ven un botón «Unirme a la sesión» cuando ya hay una en curso (antes, la página solo muestra «Esperando a que quien organiza empiece la sesión»). Si ya hay una sesión en curso cuando vas a empezarla o a unirte, primero verás una pregunta rápida sobre si quieres unirte, porque entrar cuando hay gente hablando interrumpe más que empezar de cero; si la rechazas no pasa nada y no se te agrega a la llamada. En cualquier caso, la llamada se abre automáticamente a pantalla completa; toca el ícono de minimizar (abajo a la derecha) para reducirla a un pequeño recuadro mientras usas el resto de la aplicación, igual que en una llamada entre dos personas.",
  },
  "schedule-recurring-collaboration-session": {
    q: "¿Puedo programar una sesión periódica de una colaboración?",
    a: "Sí. Al publicar una colaboración (o al editarla después), marca «Sesión periódica» y elige qué día o días de la semana y a qué hora. La hora se indica en UTC para que todas las personas de la colaboración vean la misma hora compartida estén donde estén, en lugar de que se desplace sin aviso a otro día u otra hora para alguien en otra zona horaria. Quien organiza o un coadmin puede cambiar o quitar el horario cuando quiera desde «Editar».",
  },
  "add-collaborations-session-own-calendar": {
    q: "¿Puedo agregar la sesión de una colaboración a mi calendario?",
    a: "Sí. Una colaboración con un horario periódico muestra en su página un enlace «Agregar a Google Calendar» y un enlace para descargar un archivo .ics (para Apple Calendar, Outlook o cualquier otra aplicación que los importe), cada uno con su propio recordatorio incluido antes de que empiece la sesión. También recibirás una notificación en la aplicación poco antes de cada sesión. Solo los ven quien organiza y quienes ya participan, no alguien que está mirando de paso una colaboración pública a la que no se ha unido.",
  },
  "share-screen-upload-material-during": {
    q: "¿Puedo compartir mi pantalla o subir material durante una sesión de Collab?",
    a: "Toca el ícono de pantalla en los controles de la llamada (o el menú «…» de más opciones de la llamada, si la barra es demasiado estrecha para mostrar todos los íconos) para compartir tu pantalla con todas las personas de la sesión. Solo funciona desde un navegador de computadora: los navegadores de teléfono y la aplicación de Android instalada no pueden conceder a una página el permiso de captura de pantalla; es una limitación general de los navegadores móviles, no algo propio de YuKon3t. Para documentos o imágenes, toca en cambio el ícono de subir que está junto a los botones de salir y minimizar: el archivo se abre de inmediato como un panel compartido para todas las personas que están en la llamada en ese momento, y después queda publicado en el chat de la colaboración para quien se una más tarde.",
  },
  "leave-collab-session": {
    q: "¿Cómo salgo de una sesión de Collab?",
    a: "Toca el ícono rojo de colgar que está junto al de minimizar (o en el recuadro minimizado, si ya la redujiste). Así sales de la sesión, no de la colaboración: la sesión sigue abierta para quien continúe en ella, y puedes volver a empezarla o a unirte cuando quieras desde la página de la colaboración.",
  },
  "invite-someone-private-collaboration-approve": {
    q: "¿Cómo invito a alguien a una colaboración privada o apruebo una solicitud para unirse a una pública?",
    a: "En una colaboración privada, quien organiza o un coadmin toca «Invitar personas» en su página y busca entre sus contactos; una lista de personas invitadas en la página muestra el estado de cada invitación (pendiente, se unió o rechazada). En una pública, las solicitudes pendientes aparecen en una lista de solicitudes para unirse en la página, con los botones Aprobar y Rechazar. Al aprobar a alguien, pasa a participar de inmediato.",
  },
  "edit-collab-board-after-ive": {
    q: "¿Puedo editar un Collab Board después de publicarlo?",
    a: "Sí. Quien lo creó (o un coadmin) puede tocar «Editar» en su página en cualquier momento para cambiar el título, el tipo, la descripción o los países, incluso después de que se haya unido gente o de que ya haya empezado una sesión en vivo. No hay ningún bloqueo: edítalo a medida que cambien tus planes.",
  },
  "co-admins-circle-collab-board": {
    q: "¿Qué hacen los coadmins en un Circle o en un Collab Board?",
    a: "Quien creó un Circle o una colaboración puede ascender a coadmin a cualquier miembro o participante, lo que le da las mismas facultades de gestión del día a día (moderar publicaciones, gestionar miembros, ascender a más coadmins): todo menos eliminar el Circle entero o cerrar la colaboración por completo, que sigue en manos de quien lo creó.",
  },

  "advertise-yukon3t": {
    q: "¿Cómo me anuncio en YuKon3t?",
    a: "Ve a la página [Publicidad](/advertise). No necesitas una cuenta de YuKon3t. Envía los datos de tu empresa, el texto del anuncio y una foto o un video corto, y elige cuántos días quieres que se muestre; el pago se procesa de forma segura a través de Stripe. Cada envío se revisa antes de publicarse, por lo general en un día hábil.",
  },

  "invite-someone-from-phones-contacts": {
    q: "¿Cómo invito a alguien de la agenda de mi teléfono que todavía no está en YuKon3t?",
    a: "Ve a Ajustes → «Invitar amigos» → «Elegir de la agenda». En un teléfono o dispositivo Android puedes elegir personas de tu agenda directamente y enviarles el enlace de la aplicación por mensaje de texto con un toque; en los demás casos, se abre el menú de compartir de tu dispositivo, o puedes simplemente copiar el enlace de invitación y enviarlo tú.",
  },

  "signed-new-phone-computer-wheres": {
    q: "Inicié sesión en un teléfono o una computadora nuevos. ¿Dónde están mis cosas?",
    a: "Justo donde las dejaste. Tus publicaciones, fotos, videos, mensajes, Circles y contactos están en nuestros servidores, no en un dispositivo concreto: al iniciar sesión con el mismo correo o nombre de usuario en cualquier dispositivo, todo te acompaña automáticamente. No hay nada que transferir ni restaurar a mano.",
  },
  "download-copy-data": {
    q: "¿Puedo descargar una copia de mis datos?",
    a: "Sí. Ajustes → «Tus datos» → «Exportar mis datos» te da un archivo JSON con todo lo vinculado a tu cuenta, gratis y en cualquier momento, como copia de seguridad personal.",
  },
  "difference-between-deactivating-deleting-account": {
    q: "¿Qué diferencia hay entre desactivar y eliminar mi cuenta?",
    a: "**Desactivar** oculta tu perfil y tus publicaciones sin eliminar nada; al volver a iniciar sesión con tu contraseña o con un enlace por correo, la cuenta se reactiva automáticamente. **Eliminar** borra de forma permanente tu perfil, tus publicaciones, tus mensajes y los Circles de los que eres propietario; esto no se puede deshacer.",
  },
  "forgot-password": {
    q: "Olvidé mi contraseña.",
    a: "Usa «¿Olvidaste tu contraseña?» en la página de inicio de sesión y luego escribe tu nueva contraseña dos veces para confirmarla. También puedes iniciar sesión solo con un enlace por correo si prefieres no usar ninguna contraseña.",
  },
  "was-asked-reset-password": {
    q: "¿Por qué me pidieron restablecer mi contraseña?",
    a: "Como medida de seguridad, les pedimos a todas las personas que inician sesión con contraseña que elijan una nueva. Tu contraseña anterior ya no sirve para iniciar sesión: la primera vez que la uses, enviaremos un enlace para restablecerla a la dirección de correo de tu cuenta. Abre ese enlace y elige una contraseña nueva (no puede ser la misma que la anterior), o pide un enlace nuevo con «¿Olvidaste tu contraseña?» en la página de inicio de sesión. Iniciar sesión con un enlace por correo, con Google o con Apple no se ve afectado.",
  },
  "set-interests-find-specific-job": {
    q: "¿Cómo elijo mis intereses o encuentro un trabajo o una profesión en concreto?",
    a: "Búscalo durante la configuración inicial de tu perfil o en Ajustes → «Editar perfil» → «Intereses». Además de los intereses generales, la lista incluye puestos de trabajo y profesiones específicos (como Tax Advising, System Administrator o UX Designer, que aparecen en inglés), así que no estás limitado a categorías amplias.",
  },
  "need-sign-up": {
    q: "¿Qué necesito para registrarme?",
    a: "En la página principal, toca «¿Primera vez? Crea tu cuenta gratis». Escribe un nombre de usuario (de 3 a 20 letras, números o guiones bajos), tu correo, una contraseña y tu fecha de nacimiento, y luego elige cómo verificar la cuenta: con un código por correo o con un número de teléfono (escríbelo ahí mismo: elige tu país en la lista y escribe tu número como lo harías normalmente; el código de país se agrega por ti). Toca «Crear cuenta» y te enviamos el código. Más adelante puedes cambiar tu nombre de usuario desde Ajustes.",
  },
  languages: {
    q: "¿Puedo usar YuKon3t en un idioma que no sea el inglés?",
    a: "Sí. YuKon3t está disponible en inglés, español, francés, portugués y árabe: la página principal y el registro, toda la aplicación una vez que inicias sesión, estas preguntas frecuentes, y los correos y mensajes de verificación que enviamos para tu cuenta. Se abre en el idioma de tu teléfono o navegador cuando es uno de los cinco; para cambiarlo, usa el menú «Idioma» en la esquina superior de la página principal (debajo de «Iniciar sesión») o al final de las demás pantallas de la cuenta, o Ajustes → «Idioma» cuando ya iniciaste sesión. La elección se recuerda en ese dispositivo. En árabe, la aplicación se lee de derecha a izquierda. Algunas cosas están solo en inglés: las páginas legales (Términos, Privacidad, Normas de la comunidad, Aviso legal), los puestos de trabajo de las listas de intereses y de categorías, la pantalla de llamada entrante que muestra tu propio teléfono y las herramientas que usan los administradores. Las notificaciones que llegan a tu teléfono están en el idioma que elegiste por última vez en un menú «Idioma» o, si nunca elegiste uno, en el idioma de tu teléfono o navegador (en inglés hasta la próxima vez que abras YuKon3t). Algunos avisos antiguos siguen en inglés, tal como se escribieron. Lo que escriben las personas nunca se traduce: un mensaje, una publicación o un comentario aparece en el idioma en que se escribió.",
  },
  "sign-up-says-something-needs": {
    q: "El registro dice que hay que corregir algo. ¿Perdí lo que escribí?",
    a: "No. Si algo no se puede aceptar (un nombre de usuario que ya está en uso, un correo que ya tiene una cuenta, un número de teléfono que no corresponde al país que elegiste), el formulario muestra solo las partes que hay que corregir, cada una con el motivo debajo. Todo lo demás que escribiste, incluidas tu contraseña y tu fecha de nacimiento, se conserva. Corrige lo que se muestra y toca «Crear cuenta» otra vez, o toca «Editar todos los datos» para ver el formulario completo.",
  },
  "verify-account-after-signing-up": {
    q: "¿Cómo verifico mi cuenta después de registrarme?",
    a: "Al registrarte, elige correo o teléfono: enviaremos un código de 6 dígitos al que elijas, y lo escribes en la pantalla siguiente para terminar de crear tu cuenta. ¿No te llegó o el código caducó? Vuelve a abrir esa pantalla y se envía uno nuevo automáticamente, sin tener que buscar un botón para reenviarlo (aunque también hay uno, por si quieres pedirlo tú). Si el correo tarda en llegar, usa «Usar teléfono» en esa pantalla para verificar por mensaje de texto; y si el mensaje de texto no llega, «Usar código por correo» te lleva de vuelta. También puedes iniciar sesión en cualquier momento para continuar donde lo dejaste.",
  },
  "says-account-locked-happened": {
    q: "Dice que mi cuenta está bloqueada. ¿Qué pasó?",
    a: "Después de 4 intentos con una contraseña incorrecta, la cuenta se bloquea durante 24 horas como medida de seguridad. Restablecer tu contraseña (con «¿Olvidaste tu contraseña?» en la página de inicio de sesión) la desbloquea de inmediato: no tienes que esperar las 24 horas. Si aun así no puedes entrar, escribe a soporte y podemos enviar directamente un enlace para restablecerla a tu correo registrado.",
  },

  "who-see-posts-profile": {
    q: "¿Quién puede ver mis publicaciones y mi perfil?",
    a: "Lo controlas en Ajustes → «Privacidad»: tus publicaciones pueden ser visibles para cualquier persona que haya iniciado sesión o solo para tus contactos, y puedes sacar tu perfil de Descubrir por completo.",
  },
  "trust-score-trust-badge": {
    q: "¿Qué es la puntuación de confianza o la insignia de confianza?",
    a: "Una señal que se calcula a partir de cosas como la verificación por correo o por teléfono, la antigüedad de la cuenta, qué tan completo está el perfil y las rachas de actividad, menos los reportes en tu contra que se hayan considerado fundados. Es una señal de reputación, no una verificación de antecedentes.",
  },
  "someone-know-take-screenshot": {
    q: "¿Alguien se entera si hago una captura de pantalla?",
    a: "En las aplicaciones nativas de Android y iOS, sí, en algunos lugares: durante una llamada de voz o una videollamada (se les avisa a los dos al instante) y al ver la publicación, la historia, el mensaje directo o el perfil de otra persona; en ese caso, su dueño recibe una notificación de que hiciste una captura de pantalla. Hacer una captura de tu propio contenido nunca notifica a nadie. Esto no está disponible en un navegador normal, porque ahí no hay una forma fiable de detectar una captura de pantalla.",
  },
  "report-someone-something": {
    q: "¿Cómo reporto a alguien o algo?",
    a: "Usa el menú «⋯» de una publicación, un comentario o un mensaje, o la opción de reportar de un perfil. Todos los reportes se clasifican y cada medida que se toma indica un motivo. Consulta nuestras [Normas de la comunidad](/legal/guidelines) (en inglés) para ver qué se hace cumplir.",
  },
} satisfies Partial<FaqItems>;
