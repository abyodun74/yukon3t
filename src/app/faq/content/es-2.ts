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
  "live-only-people-i-pick": {
    q: "¿Puedo transmitir en vivo solo para las personas que elija?",
    a: "Sí. En «Transmitir con», elige a las personas (hasta 10). En cuanto eliges a alguien, «Quién puede verlo» cambia por defecto a **Solo las personas que elegí**. Así, la transmisión solo aparece en Inicio para esas personas (y para ti), ellas reciben una notificación en su idioma y nadie más puede encontrarla, abrirla ni unirse, ni siquiera con el enlace. Tus suscriptores no reciben ningún aviso.\n\nSi prefieres que cualquiera pueda verla, vuelve a poner «Quién puede verlo» en «Todos» (o elige un Circle): las personas que elegiste simplemente quedan invitadas al escenario. Si quitas a todas las personas elegidas, vuelve a «Todos».\n\nDurante la transmisión, quien transmite y los coanfitriones pueden invitar a más personas, y cada persona invitada también puede verla (hasta 50 personas en total). Cancelar una invitación que alguien aún no aceptó le quita el acceso; quien ya está en el escenario sigue hasta que sale. Rechazar la invitación al escenario o dejar que caduque no le quita el acceso: puede seguir viéndola. La publicación automática de la grabación no se ofrece en estas transmisiones. Si no se puede invitar a ninguna de las personas que elegiste, la transmisión no empieza y te lo indicamos; si solo se puede invitar a algunas, empieza y te dice cuántas no se pudieron invitar. A quien le canceles la invitación verá que la transmisión ya no está disponible para esa persona.",
  },
  "difference-between-watching-joining-guest": {
    q: "¿Qué diferencia hay entre ver, unirse como invitado y unirse como coanfitrión?",
    a: "**Ver** es solo mirar: sin acceso a la cámara ni al micrófono. Tanto **invitado** como **coanfitrión** ponen tu cámara y tu micrófono en el escenario, en una vista de pantalla dividida junto a quien transmite (coanfitrión está pensado para alguien que ayuda a presentar e invitado para alguien que pasa un momento, pero funcionan igual). Hay 10 lugares en el escenario en total, compartidos entre invitados y coanfitriones, además de quien transmite. Una transmisión también tiene un límite de cuántas personas pueden verla a la vez: si está llena, verás un mensaje que lo indica y podrás intentarlo de nuevo en un rato. Ves una transmisión a la vez: al empezar a ver otra, sales de la que estabas viendo. Con hasta 4 personas en el escenario, además de quien transmite, el video va con la máxima calidad; con más, los recuadros se hacen más pequeños y la calidad del video baja automáticamente para que todo siga fluido.",
  },
  "invite-people-on-stage-live": {
    q: "¿Puedo invitar a otras personas a salir en vivo conmigo?",
    a: "Sí. Al tocar «Transmitir en vivo», en «Transmitir con» puedes buscar personas por nombre o @usuario y elegir hasta 10; cada una aparece como una etiqueta que puedes quitar antes de empezar. Durante la transmisión, quien transmite y los coanfitriones (nadie más) pueden invitar a más personas con el botón «Invitar personas».\n\nEn la búsqueda solo aparecen tus contactos y las personas que se muestran en la búsqueda de personas; nunca alguien a quien hayas bloqueado o que te haya bloqueado, y una invitación nunca amplía quién puede ver la transmisión: en una transmisión para un Circle privado solo puedes invitar a sus miembros, y en una para una persona concreta, solo a esa persona. La excepción es una transmisión para «Solo las personas que elegí»: ahí, invitar a alguien es justo lo que le permite verla.\n\nCada persona invitada recibe una notificación en su idioma y, al abrir la transmisión, puede elegir «Unirme al escenario» o «Ahora no». Si acepta, sube al escenario como invitada directamente, sin otra aprobación, siempre que quede lugar (hasta 10 además de quien transmite). Las invitaciones caducan a los 15 minutos o cuando termina la transmisión, y quien transmite o un coanfitrión puede cancelarlas. Si alguien dice «Ahora no», no se le puede volver a invitar a esa transmisión; a la misma persona se la puede invitar como mucho dos veces por transmisión, y hay un límite de invitaciones por hora.",
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
    a: "Sí. Si eres quien transmite, toca «Grabar y publicar» (el botón de grabar que tiene un pequeño ícono de casa) en lugar de «Grabar» a secas, y esa grabación se publicará por ti cuando termine de procesarse: en el feed de Inicio si la transmisión es para «Todos», o en el mismo Circle si la limitaste a uno. Después no hay que subir nada. No es instantáneo: pasa exactamente por la misma revisión automática que cualquier otro video que publiques, así que dale unos minutos; si la revisión detecta algún problema, te avisamos en lugar de publicarla. El botón que tocaste queda fijo para esa grabación, así que inicia una nueva si cambias de idea. Esta opción no se ofrece en una transmisión que iniciaste con una sola persona en concreto: esa transmisión es privada entre ustedes dos y una publicación no tiene un ajuste equivalente. Lo mismo vale para una transmisión para «Solo las personas que elegí».",
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
    a: "Sí. Toca el ícono de minimizar (arriba a la derecha en una llamada, abajo a la derecha en una transmisión en vivo) para reducirla a un pequeño recuadro de video anclado en una esquina mientras navegas por el resto de la aplicación. La llamada o la transmisión sigue en marcha todo el tiempo; toca el ícono de expandir del recuadro para volver a pantalla completa, o su ícono de colgar para terminarla sin expandirla antes.\n\nCuando suena una llamada o hay una en curso, todo lo que se esté reproduciendo en la aplicación (videos, Muse, historias, mensajes de voz y de video) se pausa y nada empieza solo; lo que se estaba reproduciendo continúa cuando la llamada termina, se rechaza o se pierde. Los reproductores incrustados de YouTube, TikTok y otros solo se pueden detener, así que vuelven a empezar desde el principio.",
  },

  story: {
    q: "¿Qué es una historia?",
    a: "Una foto, un video corto (de hasta 2 minutos) o un texto escrito o pegado que aparece en tu perfil y desaparece automáticamente a las 24 horas. Toca el «+» de tu propia foto de perfil («Tu historia» en Inicio, o en tu perfil) y elige «Historia» para agregar una; ese mismo «+» también ofrece «Publicación» y «Muse». Cualquier persona que pueda ver tu perfil puede ver tu historia mientras está activa. En el editor de historias, «Subir desde el dispositivo» te deja elegir una foto o un video, incluida una grabación de pantalla del iPhone.",
  },
  "post-text-only-story": {
    q: "¿Puedo publicar una historia solo de texto?",
    a: "Sí. Al agregar una historia, cambia a la pestaña «Texto» en lugar de elegir una foto o un video. Escribe o pega lo que quieras decir, elige un color de fondo y publícala. Por dentro se convierte en una imagen, así que funciona exactamente igual que cualquier otra historia (caduca a las 24 horas y admite reacciones, respuestas y comentarios). Puede tener hasta 2000 caracteres. Si es largo, la imagen muestra solo el comienzo y el texto completo aparece debajo con «Ver más». Para publicar varias historias de texto a la vez, toca «Añadir otra» (hasta 10); cada una se comparte como una historia aparte, en el orden en que las creaste.",
  },
  "post-more-than-one-story": {
    q: "¿Puedo publicar más de una historia el mismo día?",
    a: "Sí. El pequeño «+» del aro de tu historia (tanto en Inicio como en tu perfil) siempre está ahí: tócalo y elige «Historia» para seguir agregando más sin límite. Cuando tienes una historia activa, al tocar el propio aro ves las que ya tienes.",
  },
  "move-between-different-peoples-stories": {
    q: "¿Cómo paso de las historias de una persona a las de otra?",
    a: "Mientras ves una historia, toca el lado derecho de la pantalla para avanzar por las historias de esa misma persona, o el lado izquierdo para retroceder. Para saltar a las historias de otra persona, desliza hacia la izquierda (persona siguiente) o hacia la derecha (persona anterior) en cualquier parte de la pantalla: deslizar siempre cambia de persona, sin importar en cuál de sus historias estés.",
  },
  "close-story": {
    q: "¿Cómo cierro una Historia?",
    a: "Toca la X de la parte superior de cualquier Historia o desliza hacia abajo sobre ella (basta con un gesto rápido). En Android, el botón Atrás o el gesto para volver también la cierran, y en una computadora, la tecla Esc. Si hay algo abierto encima de la Historia (los comentarios, la lista de quién la vio, la confirmación para eliminarla, la hoja para compartir o el selector de emojis), Atrás o Esc cierra eso primero y la Historia sigue abierta. Al tocar el nombre de la persona o un enlace dentro de una Historia, esta se cierra y se abre esa página; al volver atrás desde ahí, regresas a donde estabas antes de abrir la Historia. Después de la última Historia, el visor se cierra solo.",
  },
  "video-story-wont-play": {
    q: "¿Qué pasa si una Story de video no empieza a reproducirse?",
    a: "Una Story de video empieza sola, sea la primera o venga después de otras Stories. Si se detiene o no arranca (por ejemplo, con una conexión lenta), la app lo vuelve a intentar sola; si después de unos segundos sigue sin empezar, verás «Toca para reproducir» en el centro de la Story. Si tu teléfono o navegador solo deja reproducir el video sin sonido, se reproduce silenciado con «Toca para activar el sonido» arriba. Un video que tu dispositivo no puede reproducir lo indica y pasa a la siguiente Story después de unos segundos. Siempre puedes tocar el lado derecho de la pantalla para avanzar.",
  },
  "people-react-reply-comment-story": {
    q: "¿Se puede reaccionar, responder o comentar en mi historia?",
    a: "Sí, las tres cosas, y son distintas: **reaccionar** es un emoji rápido (verás quién reaccionó al abrir tu propia historia); **responder** envía un mensaje directo privado y solo funciona entre personas que ya son contactos, igual que los mensajes normales; **comentar** publica un comentario público que puede ver cualquiera que esté viendo la historia, visible desde el ícono de comentarios que está junto a las reacciones, y recibes una notificación cuando alguien comenta la tuya. También hay un ícono de **compartir** junto a los comentarios en cualquier historia: cualquier persona que pueda ver la historia, no solo quien la publicó, puede tocarlo para reenviarla a uno de sus mensajes directos o chats grupales. Quien la recibe ve la historia real en el chat y puede tocarla para abrirla a pantalla completa, con la misma vista que desde la fila de historias, en lugar de un simple mensaje de texto sobre ella. Las personas con quienes compartes una historia reciben una notificación, como con un mensaje normal. La misma hoja de Compartir también puede publicar una copia de la historia en tu feed, en Muse o en uno de tus Circles (consulta las preguntas siguientes).",
  },
  "like-story": {
    q: "¿Puedo dar me gusta a una historia y quién lo ve?",
    a: "Sí. Toca el corazón junto al cuadro de respuesta en la historia de cualquier persona para darle me gusta; vuelve a tocarlo para quitarlo. Solo quien publicó la historia puede ver cuántos me gusta tiene y a quién le gustó: al abrir tu propia historia, el corazón junto al número de vistas muestra cuántos hay, y la lista de quién la vio marca con un corazón a todas las personas a las que les gustó. En tu propia historia no hay corazón para tocar. Nadie más puede ver el número ni quién dio me gusta, y tampoco ven tu me gusta. La persona recibe una sola notificación la primera vez que das me gusta a una historia (volver a darlo más tarde no envía otra). Solo puedes dar me gusta a una historia que puedes ver, y los me gusta desaparecen con la historia a las 24 horas. Dar me gusta es distinto de reaccionar con un emoji.",
  },
  "post-story-feed-muse-circle": {
    q: "¿Puedo publicar una historia en mi feed, en Muse o en un Circle?",
    a: "Sí. Toca el ícono de Compartir en una historia que puedas ver y elige **Publicar en mi feed**, **Publicar en Muse** o **Publicar en un Circle** (y luego elige uno de tus Circles). Funciona con tus propias historias y con las de otras personas, salvo que quien publicó la historia haya desactivado que se vuelva a publicar. Se publica una copia de la foto, el video o el video insertado de la historia, con su texto. La copia de la historia de otra persona empieza con un crédito «Story by» con su nombre, y esa persona recibe una notificación de que la volviste a publicar. Muse solo admite videos y videos insertados, no fotos. En tu feed, la copia tiene el público más restringido entre el de tu perfil y el de quien publicó la historia: si cualquiera de los dos muestra sus publicaciones solo a sus contactos, la copia también. La historia de otra persona solo puede ir a Muse o a un Circle si su perfil es público. La copia de un video pasa por la misma revisión automática que cualquier video nuevo; en Muse, un video de más de un minuto, aproximadamente, aparece cuando termina esa revisión. Publicar la misma historia en el mismo lugar otra vez no crea una segunda copia. Cualquier tipo de historia (una foto, un video con su propio sonido o un video insertado) se puede enviar a chats, a tu feed y a tus Circles; no hay historias solo de audio. Un video cuya duración no se puede leer ni siquiera desde el propio archivo (algo raro, por ejemplo algunas grabaciones WebM) igual puede ir a chats, a tu feed y a tus Circles, pero no a Muse, y la hoja de Compartir lo indica. Muse tampoco admite videos de más de 5 minutos. Una historia creada a partir de un Muse con una pista de sonido añadida conserva esa pista, y su copia en Muse también; una copia en tu feed o en un Circle reproduce en cambio el sonido original del video (las publicaciones no tienen pista de sonido aparte), y la hoja de Compartir lo indica.",
  },
  "reposted-story-disappear": {
    q: "¿Una historia que se vuelve a publicar desaparece a las 24 horas?",
    a: "No. La historia en sí sigue desapareciendo a las 24 horas, pero la copia publicada en un feed, en Muse o en un Circle es una publicación o un Muse normal y se queda hasta que la persona que publicó la copia la elimine. Si la historia era tuya, no puedes eliminar la copia de otra persona, pero puedes denunciarla como cualquier publicación o Muse. Desactivar la opción de volver a publicar impide copias nuevas; no elimina las que ya existen.",
  },
  "stop-people-reposting-stories": {
    q: "¿Cómo evito que otras personas vuelvan a publicar mis historias?",
    a: "Ve a Ajustes, abre Privacidad, desmarca «Permitir que otras personas vuelvan a publicar mis historias» y toca «Guardar ajustes de privacidad». Está activado de forma predeterminada. Mientras está desactivado, nadie más puede publicar tus historias en su feed, en Muse ni en un Circle; tú sí puedes, y quienes pueden ver tu historia aún pueden enviarla a sus chats. No elimina las copias hechas antes de desactivarlo.",
  },

  "muse-2": {
    q: "¿Qué es Muse?",
    a: "Una pestaña dedicada a videos cortos, divertidos y creativos: a pantalla completa, de uno en uno; desplázate hacia abajo para ver el siguiente y hacia arriba para el anterior (un feed de desplazamiento normal, no un gesto de deslizar). A diferencia de una historia, un Muse no caduca a las 24 horas y, a diferencia de tu feed de Inicio, no se limita a tus contactos: todos los Muse son visibles para todas las personas de YuKon3t. Es un feed para descubrir, no uno solo de contactos.",
  },
  "post-muse": {
    q: "¿Cómo publico un Muse?",
    a: "Abre tu propio perfil y toca «Publicar un Muse», o toca el «+» de tu propia foto de perfil (en Inicio o en tu perfil) y elige «Muse». Elige un video (de hasta 5 minutos), agrega un texto si quieres y publícalo. Eso es todo, sin más pantallas. Un video más largo (de más de un minuto, aproximadamente) pasa por una revisión automática de seguridad adicional antes de ser visible para los demás, lo que puede tardar un poco más que con un clip corto. Antes de publicar también puedes elegir «Audio propio» para adjuntar un archivo de sonido aparte que reemplaza por completo el audio del video (la idea de «agregar sonido» de TikTok). Elige «Sonido original» (la opción por defecto) para conservar el audio del video.",
  },
  "delete-muse-after-ive-posted": {
    q: "¿Puedo eliminar un Muse después de publicarlo?",
    a: "Sí. Abre el Muse en el feed de Muse y toca el ícono de papelera que está cerca de la parte superior (solo visible en tus propios Muse); luego tócalo otra vez para confirmar. Se elimina de inmediato y de forma permanente, para ti y para todos los demás.",
  },
  "share-reshare-follow-muse": {
    q: "¿Puedo compartir, volver a compartir o seguir a alguien en Muse?",
    a: "Sí, las tres opciones están junto a los botones de comentarios y Me gusta de cada Muse. El ícono de compartir abre un panel: compártelo en tu **Inicio**, agrégalo a tu **historia** (para Muse de hasta 2 minutos), envíaselo a un amigo o a un grupo, usa el menú de compartir de tu dispositivo o copia el enlace. Inicio, historia, amigos y el menú de compartir del dispositivo envían el video real, no solo un enlace. El ícono de volver a compartir (una flecha circular) pone el video en tu Inicio con un solo toque: da crédito a quien lo creó, le envía una notificación y, si lo tocas otra vez, lo quita. «Suscribirse», junto al nombre de quien lo creó, sirve para seguir a esa persona y enterarte de sus próximas publicaciones. Nada de esto requiere tener antes a esa persona entre tus contactos, igual que dar Me gusta o comentar. Si un Muse usa una pista de sonido añadida, la historia que se crea a partir de él conserva esa pista de sonido.",
  },
  "share-post-muse": {
    q: "¿Puedo compartir una publicación en Muse?",
    a: "Sí. Cualquier publicación con un video (de hasta 5 minutos) se puede compartir en Muse: abre el menú de compartir de esa publicación y toca «Compartir en Muse». Se convierte en un Muse nuevo a tu nombre, que da crédito al original con un enlace «Ver la publicación original»; quien publicó el original recibe una notificación y se le cuenta como una vez compartida, igual que al compartirla en tu historia o en un Circle. Las publicaciones sin video (texto, foto, enlace, contenido incrustado, GIF) no se pueden compartir en Muse: no existe un formato de Muse sin video.",
  },
  "muse-feed-copy-same-likes": {
    q: "¿Cuándo comparten un Muse y una publicación del mismo video un solo contador de Me gusta?",
    a: "Tu propio Muse y tu propia copia de él en el feed comparten un solo contador de Me gusta: cuando vuelves a compartir tu Muse en Inicio, o compartes en Muse tu propia publicación con video, los dos muestran el mismo número, el de personas distintas a las que les gustó cualquiera de los dos, sin contar a nadie dos veces. Si das Me gusta a uno, también aparece en el otro (donde puedas verlo), y si lo quitas, se quita de los dos. Una copia que hace otra persona (cuando vuelve a compartir tu Muse o crea un Muse a partir de tu publicación) tiene su propio contador: los Me gusta que recibe se quedan en ella, y los de lo tuyo se quedan en lo tuyo. Un Muse tiene un botón de corazón para dar Me gusta; una reacción con emoji que dejaste antes en un Muse sigue contando como tu Me gusta (el corazón aparece relleno), y al tocar el corazón se quita. Quien publicó recibe una notificación solo la primera vez que das Me gusta a cualquiera de sus dos copias. Las republicaciones normales de una publicación ya cuentan sus Me gusta en la publicación original.",
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
    q: "¿Puedo dar Me gusta o comentar en un Muse?",
    a: "Sí. Toca el corazón de la derecha para dar Me gusta a un Muse (se pone rojo; tócalo otra vez para quitarlo), y el número de abajo indica a cuántas personas les gustó. También puedes tocar dos veces el video para darle Me gusta: el doble toque solo da Me gusta (en un Muse que ya te gusta solo vuelve a mostrar el corazón), y el video sigue reproduciéndose, o sigue en pausa, tal como estaba. Una reacción con emoji que dejaste en un Muse antes de que llegara el corazón sigue contando como tu Me gusta. Los emojis y los GIF están en los comentarios: el cuadro de comentario tiene una fila de emojis rápidos, un selector completo de emojis y una búsqueda de GIF.\n\nMantén el dedo sobre un video de Muse para pausarlo mientras lo mantienes, o tócalo para pausarlo: una barra en la parte de abajo muestra entonces por dónde va el video y su duración total (por ejemplo, 0:12 / 0:45). Arrastra a lo largo de la barra para saltar a otro momento; el video sigue desde ahí si se estaba reproduciendo. Con un teclado, la barra se puede enfocar y mover con las flechas (5 segundos cada vez). La barra no aparece en los videos incrustados de otro sitio (YouTube, TikTok y similares), cuyo propio reproductor tiene sus propios controles.\n\nToca el ícono de comentarios: el video sigue reproduciéndose en una pequeña tarjeta redondeada arriba mientras los comentarios ocupan la parte de abajo de la pantalla. Toca el video, arrastra hacia abajo la barra de la parte superior de los comentarios o vuelve atrás para regresar al video en pantalla completa. Quien creó el Muse, quien escribió el comentario o un administrador pueden quitar cualquier comentario. Cuando das Me gusta con el corazón grande, también suena un suave latido (lub-dub) mientras el corazón sube; no suena con «reducir movimiento» activado, durante una llamada ni si la pestaña está en segundo plano, y se mezcla bajo cualquier video o audio que esté sonando. En iPhone, el interruptor de silencio también lo silencia.",
  },
  "muse-comment-replies-likes-gifs": {
    q: "¿Cómo funcionan las respuestas, los Me gusta, los emojis y los GIF en los comentarios de un Muse?",
    a: "Toca **Responder** debajo de un comentario para contestarlo: el cuadro muestra «Respondiendo a» con el nombre de la persona y empieza con su @usuario (puedes cancelar la respuesta). Las respuestas aparecen debajo del comentario al que contestan, en un solo nivel: si respondes a una respuesta, la tuya se suma al mismo hilo y menciona con @ a la persona a la que contestaste. Toca «Ver respuestas» para abrir un hilo y «Ocultar respuestas» para cerrarlo. Toca el corazón junto a un comentario o una respuesta para darle Me gusta; el número de al lado indica a cuántas personas les gustó.\n\nJunto al cuadro de comentario, el botón de emojis abre un selector completo de emojis en lugar del teclado, y el botón de GIF abre una búsqueda de GIF (los GIF vienen de GIPHY). Un comentario o una respuesta puede ser texto, un GIF o ambos. Los emojis que usaste hace poco aparecen primero y se guardan solo en tu dispositivo. La persona a la que respondiste recibe una notificación, y quien creó el Muse recibe una notificación por cada comentario o respuesta nuevos, nunca dos por el mismo.\n\nPuedes eliminar tus propios comentarios y respuestas, y quien creó el Muse puede eliminar cualquier comentario o respuesta de su Muse; al eliminar un comentario también se eliminan sus respuestas. No se muestran los comentarios ni las respuestas de cuentas que bloqueaste (o que te bloquearon) o que ya no están activas, y no se publica el texto que nuestra revisión automática marca. Los comentarios de un Muse no se pueden editar; para reportar uno, reporta a la persona que lo escribió.",
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
    a: "Solo las personas que te han agregado *a ti* a su propio Inner Circle. Nunca nadie más, y nunca aparecen en tu perfil público, en el feed ni en Descubrir. Agregar a alguien a tu Inner Circle va en una sola dirección, como suscribirse: esa persona no necesita agregarte para que tú veas los suyos. Además, deben seguir conectados contigo: si alguno de los dos bloquea al otro o dejan de estar conectados, tus momentos dejan de mostrarse para esa persona (y al bloquear, cada uno sale del Inner Circle del otro).",
  },
  "there-lock-screen-watch-widget": {
    q: "¿Hay un widget para la pantalla de bloqueo o para el reloj?",
    a: "Todavía no. Eso requiere desarrollo nativo de verdad para cada plataforma. Mientras tanto, Ajustes → «Ambient» muestra dentro de la aplicación una vista previa de cómo se vería tu feed de Ambient, y ya puedes generar un token de acceso para widgets, para cuando exista uno.",
  },
} satisfies Partial<FaqItems>;
