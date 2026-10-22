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
    a: "Depende de la privacidad del Circle. Las publicaciones, los videos y las transmisiones en vivo de un Circle **público** son públicos: pueden aparecer en Inicio y en la búsqueda, se pueden republicar o compartir en una historia, en Muse o en otro Circle, y notifican a los suscriptores como cualquier publicación pública. Un Circle **privado** (o un sub-Circle privado) solo es visible para sus miembros: para todos los demás no existe. No aparece en ninguna lista, no se encuentra en la búsqueda, y su nombre, foto, descripción, miembros, publicaciones, videos, eventos, encuestas, conversaciones de los canales, salas de voz y transmisiones en vivo quedan ocultos para ellos. Su contenido nunca aparece en Inicio, en la búsqueda ni en los perfiles, y no se puede republicar ni compartir fuera. A un Circle privado solo se entra por invitación: quien recibió una invitación ve su nombre, su foto y su descripción, junto con la invitación, hasta que responde. Un canal privado dentro de un Circle público es solo para miembros de la misma manera. Cada sub-Circle tiene su propia privacidad y sus propios miembros: estar en el Circle principal no te permite ver un sub-Circle privado, y viceversa.",
  },
  "pick-category-circle": {
    q: "¿Cómo elijo una categoría para mi Circle?",
    a: "Búscala al crear el Circle. La lista incluye temas generales (Viajes, Cultura, Tecnología y startups, y más) además de tipos de trabajo y profesiones específicos (Bookkeeping, Civil Engineer, Cybersecurity Analyst, Linux Administrator y decenas más, que aparecen en inglés), para que encuentres exactamente la adecuada en lugar de una categoría genérica de «Profesional». Puedes elegir hasta 5 categorías para un mismo Circle si de verdad le corresponde más de una.",
  },
  "rename-circle-change-its-theme": {
    q: "¿Puedo cambiar el nombre, la temática, las categorías o la privacidad de mi Circle después de crearlo?",
    a: "Sí. El propietario o un coadmin puede tocar el ícono de lápiz que está junto al nombre del Circle, en su página, para cambiar en cualquier momento el nombre, la temática (la descripción de qué trata el Circle, que escribiste al crearlo), las categorías o la privacidad (público o privado). Su URL nunca cambia cuando le cambias el nombre, así que los enlaces y marcadores existentes siguen funcionando. Hacer privado un Circle lo oculta de inmediato a todos los que no son miembros: sale de la lista de Circles y de la búsqueda, y sus publicaciones, eventos y transmisiones en vivo (y las republicaciones de sus publicaciones) desaparecen para ellos. También hace privados sus sub-Circles; los miembros actuales se quedan, y a partir de entonces solo se entra por invitación. Hacerlo público permite que cualquiera lo encuentre, se una y lo vea, y borra las solicitudes de ingreso y las invitaciones pendientes porque ya no hacen falta. Un sub-Circle de un Circle privado no se puede hacer público.",
  },
  "sub-circles": {
    q: "¿Qué son los sub-Circles?",
    a: "Un sub-Circle es un Circle más pequeño que vive dentro de un Circle principal: por ejemplo, un sub-Circle «Diseño» y otro «Marketing» dentro de un Circle «Fundadores de startups». Abre el Circle principal y verás en su página los sub-Circles que puedes ver: todos los públicos, y uno privado solo si eres miembro o te invitaron. Cada uno tiene sus propios miembros, sus propios canales y publicaciones y su propia lista de miembros en su propia página. Puedes unirte a cualquier sub-Circle público por separado (no tienes que unirte antes al Circle principal, y unirte a uno no te une a los demás), mientras que a uno privado, como a cualquier Circle privado, solo se entra por invitación. Solo el propietario del Circle principal puede agregar sub-Circles (toca «Agregar un sub-Circle» en la página del Circle principal). Los sub-Circles tienen un solo nivel de profundidad, y un sub-Circle de un Circle privado también es privado. Al eliminar un Circle principal se eliminan también sus sub-Circles.",
  },
  "invite-people-private-circle": {
    q: "¿Cómo invito a personas a un Circle privado?",
    a: "Un Circle privado es solo por invitación: nadie más puede encontrarlo ni pedir unirse, así que una invitación es la única forma de entrar. En la página de un Circle privado, el propietario o un coadmin puede tocar «Invitar personas» y elegir entre sus propios contactos, hasta 50 a la vez. Cada persona recibe una notificación y, en la página del Circle, un aviso para aceptar o rechazar (lo único del Circle que puede ver hasta que acepta); nadie se convierte en miembro hasta que acepta, y rechazar no avisa a nadie, tras lo cual el Circle vuelve a quedar oculto para esa persona. Invitar a alguien que pidió unirse antes de que los Circles privados pasaran a ser solo por invitación simplemente lo deja entrar. Todos los admins ven la lista «Invitados» con el estado de cada invitación y pueden cancelar una que siga pendiente. Las invitaciones no caducan, pero una ya no se puede aceptar si quien la envió deja de ser admin del Circle; la lista la marca, y volver a invitar a esa persona le envía una invitación nueva. Puedes volver a invitar a quien rechazó, salió o fue eliminado. Un sub-Circle es un Circle aparte, así que invita a personas desde su propia página. Hacer público el Circle cancela las invitaciones pendientes, porque entonces cualquiera puede unirse.",
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
    a: "Las colaboraciones **públicas** se anuncian a todos y aparecen en Collab Boards: cualquiera puede tocar «Solicitar unirme», y quien organiza o un coadmin revisa cada solicitud (Aprobar/Rechazar) antes de dar acceso. Las colaboraciones **privadas** son solo por invitación: quien organiza elige a contactos concretos para invitarlos, ya sea al publicarla o más tarde con «Invitar personas» en la página de la colaboración, y nunca aparecen en listas ni en búsquedas; solo pueden verlas quien organiza y quienes fueron invitados o ya se unieron. También puedes invitar a un Circle entero que hayas creado: cada uno de sus miembros actuales recibe su propia invitación y nadie se une si no la acepta. Una persona invitada ve un aviso para aceptar o rechazar en la página de la colaboración hasta que responde.",
  },
  "starting-joining-collab-session-work": {
    q: "¿Cómo funciona empezar una sesión de Collab o unirse a una?",
    a: "Solo quien organiza o un coadmin puede empezar una sesión desde cero: verá un botón «Empezar la sesión» en la página de la colaboración. En una colaboración pública, al tocarlo se conecta enseguida, sin más confirmación. En una privada, primero se abre un breve panel «Empezar la sesión»: «Avisar a los participantes de que la sesión está en vivo» (activado por defecto) envía una notificación a todas las personas que ya están en la colaboración, como máximo una vez cada 30 minutos, y además puedes invitar a más contactos o a hasta cinco Circles que hayas creado, igual que con «Invitar personas» (cada persona sigue aceptando su propia invitación, y a quien recibe una invitación mientras hay una sesión en vivo se le indica). Toca «Empezar» sin elegir a nadie para simplemente empezar. Si alguna invitación no se puede enviar (por ejemplo, un Circle que agregaría más de 200 invitaciones nuevas), la sesión no se empieza y no se avisa a nadie. Los demás solo ven un botón «Unirme a la sesión» cuando ya hay una en curso (antes, la página solo muestra «Esperando a que quien organiza empiece la sesión»). Si ya hay una sesión en curso cuando vas a empezarla o a unirte, primero verás una pregunta rápida sobre si quieres unirte, porque entrar cuando hay gente hablando interrumpe más que empezar de cero; si la rechazas no pasa nada y no se te agrega a la llamada. En cualquier caso, la llamada se abre automáticamente a pantalla completa; toca el ícono de minimizar (abajo a la derecha) para reducirla a un pequeño recuadro mientras usas el resto de la aplicación, igual que en una llamada entre dos personas.",
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
    a: "En una colaboración privada, quien organiza o un coadmin toca «Invitar personas» en su página y busca entre sus contactos, o elige hasta cinco Circles que haya creado en «Invitar a un Circle» (hasta 200 invitaciones nuevas a la vez). Cada miembro del Circle recibe su propia invitación y decide si la acepta; se omite a quien ya estaba invitado, a quien rechazó antes y a quien tenga un bloqueo. Una lista de personas invitadas en la página muestra el estado de cada invitación (pendiente, se unió o rechazada); las invitaciones que otro coadmin envió a personas que no conoces solo se cuentan, sin nombres, y quien organiza o un coadmin puede cancelar una que siga pendiente. Las invitaciones no caducan, pero una ya no se puede aceptar si quien la envió deja de ser admin de la colaboración; la lista la marca, y volver a invitar a esa persona (sola o a través de un Circle en el que esté) le envía una invitación nueva. En una pública, las solicitudes pendientes aparecen en una lista de solicitudes para unirse en la página, con los botones Aprobar y Rechazar. Al aprobar a alguien, pasa a participar de inmediato.",
  },
  "edit-collab-board-after-ive": {
    q: "¿Puedo editar un Collab Board después de publicarlo?",
    a: "Sí. Quien lo creó (o un coadmin) puede tocar «Editar» en su página en cualquier momento para cambiar el título, el tipo, la descripción o los países, incluso después de que se haya unido gente o de que ya haya empezado una sesión en vivo. No hay ningún bloqueo: edítalo a medida que cambien tus planes.",
  },
  "co-admins-circle-collab-board": {
    q: "¿Qué hacen los coadmins en un Circle o en un Collab Board?",
    a: "Quien creó un Circle o una colaboración puede ascender a coadmin a cualquier miembro o participante, lo que le da las mismas facultades de gestión del día a día (moderar publicaciones, gestionar miembros, ascender a más coadmins): todo menos eliminar el Circle entero o cerrar la colaboración por completo, que sigue en manos de quien lo creó.",
  },

  "polls-circle-collab-board": {
    q: "¿Cómo funcionan las encuestas en un Circle o en un Collab Board?",
    a: "Quien creó un Circle o sus coadmins (o quien organiza una colaboración o sus coadmins) pueden crear una **encuesta** desde la sección Encuestas de su página: una pregunta con entre 2 y 10 opciones, o una encuesta para **buscar una fecha**, cuyas opciones son fechas y horas. Las horas se escriben y se muestran en UTC para que todos compartan la misma referencia, con tu hora local al lado de cada una. Los miembros (o participantes) reciben un aviso y pueden votar, cambiar su voto o retirarlo en cualquier momento mientras la encuesta esté abierta. Los resultados se actualizan en directo a medida que la gente vota. Las encuestas de un Circle o de una colaboración privados solo las ven sus miembros.\n\nLos resultados solo muestran cuántas personas eligieron cada opción, nunca quién votó qué, ni siquiera a los administradores. Quien creó la encuesta y los administradores del Circle o de la colaboración pueden editarla, cerrarla o reabrirla, o eliminarla. Si se cambia o se quita una opción que ya tiene votos, esos votos se eliminan (antes se te pregunta), para que ningún voto acabe contando para algo que su autor no eligió; esas personas pueden simplemente volver a votar.\n\nCuando una encuesta para buscar una fecha tiene una ganadora, un administrador (o quien creó la encuesta, una vez cerrada) puede programarla: en un Circle se publica un evento al que la gente puede confirmar asistencia y que puede añadir a su calendario; en un Collab Board se añade una sesión única (una colaboración puede tener varias, cada una visible en su página hasta que empieza), con el recordatorio habitual poco antes. Se avisa a todos los que votaron.",
  },

  "circle-events-coming-up": {
    q: "¿Cómo funcionan los eventos en un Circle?",
    a: "Cualquier miembro puede publicar un **evento** en un Circle añadiendo una fecha, una hora y un lugar a una publicación. La página del Circle muestra lo **próximo**, empezando por lo más cercano y en tu hora local, con cuántas personas asistirán y un botón para decir que vas. Cada evento tiene además **añadir al calendario** (Google Calendar, o un archivo de calendario si usas YuKon3t en un navegador web) y el recordatorio habitual poco antes de empezar si dijiste que vas. Los eventos de un Circle privado, y los de un canal privado, solo los ven quienes pueden ver ese Circle o canal.\n\nToca **Detalles del evento** en el evento dentro del Circle (o abre la página del evento) para ver los enlaces de calendario y la lista. Ahí quien lo organiza (quien lo publicó, o quien creó el Circle y sus coadmins) puede crear una lista de **quién trae qué** con hasta 20 elementos. Cualquier miembro que pueda ver el evento puede apuntarse a un elemento (una persona por elemento) y volver a dejarlo; quien organiza puede editar, quitar o desasignar elementos. Todos los que pueden ver el evento ven quién se apuntó a qué.\n\nQuien organiza también puede **recordárselo a quienes no han respondido**: los miembros que pueden ver el evento y no han dicho que van reciben un aviso. Solo funciona antes de que empiece el evento y como máximo una vez cada 12 horas.\n\nAl publicar un evento en un Circle puedes hacer que se **repita** cada semana, cada 2 semanas o cada mes (el mismo día del mes, o su último día en los meses más cortos), durante 2 a 12 fechas o hasta una fecha dentro de un año como máximo. Cada fecha es un evento propio, con sus propias respuestas y su propia lista. La siguiente fecha se publica automáticamente poco después de que empiece la anterior, sin avisar a nadie, y quien organiza puede detener la repetición en cualquier momento. Las fechas siguen la hora UTC, así que donde se cambia la hora la hora local puede moverse una hora.\n\nAntes de que empiece un evento, quien lo organiza puede **reprogramarlo** a otra fecha y hora o **cancelarlo**, con un motivo breve opcional que se muestra en el evento. Se avisa a todos los que van y a todos los que traen algo (también a quien lo publicó, si el cambio lo hizo otra persona). Un evento reprogramado conserva sus respuestas y su lista, muestra la hora anterior y vuelve a enviar el recordatorio para la nueva hora; si lo vuelves a añadir a un calendario, se actualiza en lugar de duplicarse. Un evento cancelado sigue visible marcado como \"Cancelado\", sale de la lista de próximos y ya no admite respuestas ni recordatorios. Cancelar una fecha de un evento que se repite no detiene la repetición, salvo que quien organiza también elija detenerla.",
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
  "why-verify-human-app": {
    q: "¿Por qué a veces me piden verificar que soy una persona en la app?",
    a: "Al registrarte, iniciar sesión o restablecer la contraseña comprobamos que detrás de la solicitud hay una persona real. En la web es el toque en «Verificar que eres una persona». En la app de YuKon3t, en cambio, ella puede confirmar que es la app genuina y sin modificar, ejecutándose en un dispositivo genuino, mediante Play Integrity de Google en Android y App Attest de Apple en iPhone. Si esa comprobación se supera, puede que no te pidan tocar nada. Seguirás viendo el toque si usas el sitio web, una copia modificada o no oficial de la app, un dispositivo con root o un emulador, o si la app no puede completar la comprobación en ese momento. No guardamos nada de esta comprobación en tu cuenta; solo conservamos un resultado anónimo (superada o no, plataforma y versión de la app) para detectar abusos.",
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
  "save-someones-profile-picture": {
    q: "¿Puedo guardar la foto de perfil de otra persona?",
    a: "No desde YuKon3t. Las fotos de perfil no tienen opción para guardar, descargar ni compartir, tampoco cuando tocas una para ampliarla, y los atajos de mantener pulsado, hacer clic derecho o arrastrar para guardar están desactivados para ellas. Es una medida disuasoria, no un bloqueo: YuKon3t no puede impedir una captura de pantalla ni detener a alguien decidido a copiar lo que ve en su pantalla, así que usa una foto de perfil que no te importe que otros vean. Las publicaciones, las historias y Muse conservan sus propias opciones para guardar y compartir.",
  },
  "report-someone-something": {
    q: "¿Cómo reporto a alguien o algo?",
    a: "Usa el menú «⋯» de una publicación, un comentario o un mensaje, o la opción de reportar de un perfil. Todos los reportes se clasifican y cada medida que se toma indica un motivo. Consulta nuestras [Normas de la comunidad](/legal/guidelines) (en inglés) para ver qué se hace cumplir.",
  },
} satisfies Partial<FaqItems>;
