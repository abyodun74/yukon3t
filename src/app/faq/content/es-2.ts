import type { FaqItems } from "../ids";

// Spanish FAQ, part 2: Going Live, Stories, Muse, Ambient.
export const es2 = {
  "start-join-live-stream": {
    q: "¿Cómo inicio una transmisión en vivo o me uno a una?",
    a: "Toca «Transmitir en vivo» encima del feed de Inicio, ponle un título y elige quién puede verla: **Todos** o uno de tus Circles o sub-Circles. Una transmisión para Todos o para un Circle público aparece de dos formas en Inicio mientras dura: como un avatar en la franja «En vivo ahora» y como una tarjeta completa más abajo en el propio feed, que reproduce la transmisión en directo, con quien transmite, el número de espectadores en ese momento y los botones «Ver», «Unirse como invitado» y «Unirse como coanfitrión». Al tocar cualquiera de ellos entras directamente a la transmisión con esa opción ya elegida, sin pantallas intermedias. El video de esa tarjeta solo empieza cuando de verdad llegas a ella al desplazarte, así que pasar de largo al bajar por el feed no te cuenta como espectador; detenerte en ella sí. Las transmisiones de un Circle también aparecen en una sección «En vivo ahora» en la parte superior de la página de ese Circle.",
  },
  "who-see-live-stream-start": {
    q: "¿Quién puede ver una transmisión en vivo que inicio para un Circle?",
    a: "Depende de la privacidad del Circle. Una transmisión para un Circle **público** (o para Todos) aparece en la franja «En vivo ahora» de Inicio y cualquiera puede verla. Una transmisión para un Circle o sub-Circle **privado** solo la ven los miembros de ese Circle: nunca aparece en Inicio ni en ningún otro lugar de la aplicación, y su página, su chat y sus grabaciones están cerrados para quienes no son miembros, incluso con el enlace. En ambos casos, elegir un Circle o sub-Circle en «quién puede verla» también define a quién se le *notifica*: todos los miembros de ese Circle o sub-Circle reciben una notificación en cuanto empieza la transmisión, la inicie el propietario o cualquier otro miembro, y no el conjunto de tus suscriptores, ni siquiera si el Circle es público. En cambio, una transmisión iniciada para **Todos** se anuncia a tus propios suscriptores, igual que cualquier otra publicación pública. Los miembros también encuentran la transmisión de un Circle en la sección «En vivo ahora» de la página del Circle.",
  },
  "start-live-stream-just-one": {
    q: "¿Puedo iniciar una transmisión en vivo con una sola persona en concreto?",
    a: "Sí. Elige su nombre en «Una persona concreta», dentro de la lista de quién puede verla, al iniciar una transmisión (ahí solo aparecen tus contactos). Esa transmisión es privada entre ustedes dos: nunca aparece en Inicio, en la página de un Circle ni en ningún otro lugar, y solo esa persona (además de ti) puede verla o unirse; no pueden tus suscriptores ni tus otros contactos. Esa persona recibe una notificación en cuanto empieza, igual que con una llamada.",
  },
  "difference-between-watching-joining-guest": {
    q: "¿Qué diferencia hay entre ver, unirse como invitado y unirse como coanfitrión?",
    a: "**Ver** es solo mirar: sin acceso a la cámara ni al micrófono. Tanto **invitado** como **coanfitrión** ponen tu cámara y tu micrófono en el escenario, en una vista de pantalla dividida junto a quien transmite (coanfitrión está pensado para alguien que ayuda a presentar e invitado para alguien que pasa un momento, pero funcionan igual). Hay 3 lugares en el escenario en total, compartidos entre invitados y coanfitriones, además de quien transmite. Para ver no hay límite.",
  },
  "host-mute-guest-co-host": {
    q: "¿Quien transmite puede silenciar a un invitado o a un coanfitrión?",
    a: "Sí. Quien transmite puede tocar el ícono de micrófono en el recuadro de video de cualquier invitado o coanfitrión para silenciar o reactivar su micrófono para todos los que están viendo, no solo en su propio dispositivo. Este control es exclusivo de quien transmite (un coanfitrión no lo tiene, aunque en lo demás comparte sus permisos de emisión) y nunca aparece en tu propio recuadro. Un invitado o coanfitrión silenciado puede reactivar su micrófono por su cuenta si quiere volver a hablar: esto sirve para resolver rápido el ruido de fondo o cuando varias personas hablan a la vez, no es un bloqueo definitivo.",
  },
  "record-go-live-stream-take": {
    q: "¿Puedo grabar una transmisión en vivo o hacer una captura de pantalla?",
    a: "Quien transmite y los coanfitriones pueden tocar «Grabar» para iniciar una grabación en la nube. Cuando se detiene, aparece en una lista de grabaciones de la transmisión con un enlace de descarga. Cualquier persona que esté en la transmisión puede tocar «Captura de pantalla» para guardar un fotograma; tu navegador te pedirá confirmar qué capturar, porque así es como funciona una captura de video en vivo en los navegadores.",
  },
  "recording-stream-posted-automatically": {
    q: "¿Se puede publicar automáticamente una grabación de mi transmisión?",
    a: "Sí. Si eres quien transmite, toca «Grabar y publicar» (el botón de grabar que tiene un pequeño ícono de casa) en lugar de «Grabar» a secas, y esa grabación se publicará por ti cuando termine de procesarse: en el feed de Inicio si la transmisión es para «Todos», o en el mismo Circle si la limitaste a uno. Después no hay que subir nada. No es instantáneo: pasa exactamente por la misma revisión automática que cualquier otro video que publiques, así que dale unos minutos; si la revisión detecta algún problema, te avisamos en lugar de publicarla. El botón que tocaste queda fijo para esa grabación, así que inicia una nueva si cambias de idea. Esta opción no se ofrece en una transmisión que iniciaste con una sola persona en concreto: esa transmisión es privada entre ustedes dos y una publicación no tiene un ajuste equivalente.",
  },
  "did-live-stream-end-its": {
    q: "¿Por qué mi transmisión en vivo terminó sola?",
    a: "Una transmisión termina automáticamente cuando quien transmite y todos los coanfitriones han estado ausentes 30 minutos seguidos (es decir, no queda activo en ella nadie con permisos de anfitrión). Es una medida de limpieza para que una transmisión abandonada no se quede «en vivo» indefinidamente. Una transmisión recién creada siempre tiene un margen de 30 minutos, pase lo que pase, de modo que nunca termina antes de que alguien haya tenido una oportunidad real de unirse.",
  },
  "people-comment-during-live-stream": {
    q: "¿Se puede comentar durante una transmisión en vivo?",
    a: "Sí. Sobre la propia transmisión hay un cuadro «Escribe algo...»; cualquiera que la esté viendo puede escribir un comentario y todos los demás lo ven aparecer encima en tiempo real.",
  },
  "keep-using-app-during-call": {
    q: "¿Puedo seguir usando la aplicación durante una llamada o una transmisión en vivo?",
    a: "Sí. Toca el ícono de minimizar (arriba a la derecha en una llamada, abajo a la derecha en una transmisión en vivo) para reducirla a un pequeño recuadro de video anclado en una esquina mientras navegas por el resto de la aplicación. La llamada o la transmisión sigue en marcha todo el tiempo; toca el ícono de expandir del recuadro para volver a pantalla completa, o su ícono de colgar para terminarla sin expandirla antes.",
  },

  story: {
    q: "¿Qué es una historia?",
    a: "Una foto, un video corto (de hasta 2 minutos) o un texto escrito o pegado que aparece en tu perfil y desaparece automáticamente a las 24 horas. Toca el «+» de tu propia foto de perfil para agregar una. Cualquier persona que pueda ver tu perfil puede verla mientras está activa.",
  },
  "post-text-only-story": {
    q: "¿Puedo publicar una historia solo de texto?",
    a: "Sí. Al agregar una historia, cambia a la pestaña «Texto» en lugar de elegir una foto o un video. Escribe o pega lo que quieras decir, elige un color de fondo y publícala. Por dentro se convierte en una imagen, así que funciona exactamente igual que cualquier otra historia (caduca a las 24 horas y admite reacciones, respuestas y comentarios).",
  },
  "post-more-than-one-story": {
    q: "¿Puedo publicar más de una historia el mismo día?",
    a: "Sí. Cuando tienes una historia activa, aparece un pequeño «+» en el aro de tu historia (tanto en Inicio como en tu perfil) para que sigas agregando más sin límite, además de poder tocar el propio aro para ver las que ya tienes.",
  },
  "move-between-different-peoples-stories": {
    q: "¿Cómo paso de las historias de una persona a las de otra?",
    a: "Mientras ves una historia, toca el lado derecho de la pantalla para avanzar por las historias de esa misma persona, o el lado izquierdo para retroceder. Para saltar a las historias de otra persona, desliza hacia la izquierda (persona siguiente) o hacia la derecha (persona anterior) en cualquier parte de la pantalla: deslizar siempre cambia de persona, sin importar en cuál de sus historias estés.",
  },
  "people-react-reply-comment-story": {
    q: "¿Se puede reaccionar, responder o comentar en mi historia?",
    a: "Sí, las tres cosas, y son distintas: **reaccionar** es un emoji rápido (verás quién reaccionó al abrir tu propia historia); **responder** envía un mensaje directo privado y solo funciona entre personas que ya son contactos, igual que los mensajes normales; **comentar** publica un comentario público que puede ver cualquiera que esté viendo la historia, visible desde el ícono de comentarios que está junto a las reacciones, y recibes una notificación cuando alguien comenta la tuya. También hay un ícono de **compartir** junto a los comentarios en cualquier historia: cualquier persona que pueda ver la historia, no solo quien la publicó, puede tocarlo para reenviarla a uno de sus mensajes directos o chats grupales. Quien la recibe ve la historia real en el chat y puede tocarla para abrirla a pantalla completa, con la misma vista que desde la fila de historias, en lugar de un simple mensaje de texto sobre ella.",
  },

  "muse-2": {
    q: "¿Qué es Muse?",
    a: "Una pestaña dedicada a videos cortos, divertidos y creativos: a pantalla completa, de uno en uno; desplázate hacia abajo para ver el siguiente y hacia arriba para el anterior (un feed de desplazamiento normal, no un gesto de deslizar). A diferencia de una historia, un Muse no caduca a las 24 horas y, a diferencia de tu feed de Inicio, no se limita a tus contactos: todos los Muse son visibles para todas las personas de YuKon3t. Es un feed para descubrir, no uno solo de contactos.",
  },
  "post-muse": {
    q: "¿Cómo publico un Muse?",
    a: "Abre tu propio perfil y toca «Publicar un Muse». Elige un video (de hasta 5 minutos), agrega un texto si quieres y publícalo. Eso es todo, sin más pantallas. Un video más largo (de más de un minuto, aproximadamente) pasa por una revisión automática de seguridad adicional antes de ser visible para los demás, lo que puede tardar un poco más que con un clip corto. Antes de publicar también puedes elegir «Audio propio» para adjuntar un archivo de sonido aparte que reemplaza por completo el audio del video (la idea de «agregar sonido» de TikTok). Elige «Sonido original» (la opción por defecto) para conservar el audio del video.",
  },
  "delete-muse-after-ive-posted": {
    q: "¿Puedo eliminar un Muse después de publicarlo?",
    a: "Sí. Abre el Muse en el feed de Muse y toca el ícono de papelera que está cerca de la parte superior (solo visible en tus propios Muse); luego tócalo otra vez para confirmar. Se elimina de inmediato y de forma permanente, para ti y para todos los demás.",
  },
  "share-reshare-follow-muse": {
    q: "¿Puedo compartir, volver a compartir o seguir a alguien en Muse?",
    a: "Sí, las tres opciones están junto a los botones de comentarios y reacciones de cada Muse. El ícono de compartir abre un panel: compártelo en tu **Inicio**, agrégalo a tu **historia** (para Muse de hasta 2 minutos), envíaselo a un amigo o a un grupo, usa el menú de compartir de tu dispositivo o copia el enlace. Inicio, historia, amigos y el menú de compartir del dispositivo envían el video real, no solo un enlace. El ícono de volver a compartir (una flecha circular) pone el video en tu Inicio con un solo toque: da crédito a quien lo creó, le envía una notificación y, si lo tocas otra vez, lo quita. «Suscribirse», junto al nombre de quien lo creó, sirve para seguir a esa persona y enterarte de sus próximas publicaciones. Nada de esto requiere tener antes a esa persona entre tus contactos, igual que reaccionar o comentar.",
  },
  "share-post-muse": {
    q: "¿Puedo compartir una publicación en Muse?",
    a: "Sí. Cualquier publicación con un video (de hasta 5 minutos) se puede compartir en Muse: abre el menú de compartir de esa publicación y toca «Compartir en Muse». Se convierte en un Muse nuevo a tu nombre, que da crédito al original con un enlace «Ver la publicación original»; quien publicó el original recibe una notificación y se le cuenta como una vez compartida, igual que al compartirla en tu historia o en un Circle. Las publicaciones sin video (texto, foto, enlace, contenido incrustado, GIF) no se pueden compartir en Muse: no existe un formato de Muse sin video.",
  },
  "view-count-muse-mean": {
    q: "¿Qué significa el número de vistas de un Muse?",
    a: "El ícono de ojo que está debajo del texto cuenta cuántas veces se ha visto ese Muse, incluidas las veces que lo viste tú. Es un total acumulado, no un número de espectadores únicos.",
  },
  "muse-play-sound": {
    q: "¿Muse se reproduce con sonido?",
    a: "Sí. Muse empieza a reproducirse con el sonido activado en cuanto se abre; toca el ícono de altavoz que está cerca de la parte superior de la pantalla para silenciarlo, y seguirá en silencio cuando pases al siguiente Muse. Algunos navegadores no reproducen sonido hasta que tocas la página una vez. Si el tuyo hace eso, el video se reproduce en silencio con el aviso «Toca para activar el sonido», y tu siguiente toque activa el sonido.",
  },
  "react-comment-muse": {
    q: "¿Puedo reaccionar o comentar en un Muse?",
    a: "Sí. Tiene la misma fila de reacciones rápidas que las publicaciones y las historias (toca el + del final para ver todos los emojis), además de un hilo de comentarios públicos (toca el ícono de comentarios para abrirlo como un panel desde abajo). Quien creó el Muse, quien escribió el comentario o un administrador pueden quitar cualquier comentario.",
  },
  "need-keep-scrolling-see-theres": {
    q: "¿Tengo que seguir desplazándome para saber si hay más?",
    a: "No. Muse carga el siguiente grupo de videos en segundo plano cuando te acercas al final de lo que ya está cargado, así que el desplazamiento se siente continuo.",
  },

  "ambient-2": {
    q: "¿Qué es Ambient?",
    a: "Ajustes → «Ambient» te permite elegir un Inner Circle reducido (hasta 8 personas que ya son tus contactos) y compartir «momentos» en foto, informales, que solo ellas pueden ver, en lugar de una publicación pública más elaborada. Un momento desaparece a las 48 horas.",
  },
  "who-see-ambient-moments": {
    q: "¿Quién puede ver mis momentos de Ambient?",
    a: "Solo las personas que te han agregado *a ti* a su propio Inner Circle. Nunca nadie más, y nunca aparecen en tu perfil público, en el feed ni en Descubrir. Agregar a alguien a tu Inner Circle va en una sola dirección, como suscribirse: esa persona no necesita agregarte para que tú veas los suyos.",
  },
  "there-lock-screen-watch-widget": {
    q: "¿Hay un widget para la pantalla de bloqueo o para el reloj?",
    a: "Todavía no. Eso requiere desarrollo nativo de verdad para cada plataforma. Mientras tanto, Ajustes → «Ambient» muestra dentro de la aplicación una vista previa de cómo se vería tu feed de Ambient, y ya puedes generar un token de acceso para widgets, para cuando exista uno.",
  },
} satisfies Partial<FaqItems>;
