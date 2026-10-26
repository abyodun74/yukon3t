import type { FaqItems } from "../ids";

// Spanish FAQ, part 1: Getting around, The Android app, Posts and media. Conventions as in src/lib/i18n/es: neutral
// Latin American Spanish, "tú"; names of buttons and screens exactly as the app shows them, in «»; product names
// (YuKon3t, Circles, Collab Boards, Muse) as they are.
export const es1 = {
  "who-join-yukon3t": {
    q: "¿Quién puede unirse a YuKon3t?",
    a: "Cualquier persona de 16 años o más. Al registrarte te pediremos tu fecha de nacimiento. Si tienes 16 o 17 años, solo puedes usar YuKon3t con la participación y el consentimiento de tu madre, tu padre o tu tutor legal.",
  },
  "where-find-everything": {
    q: "¿Dónde encuentro cada cosa?",
    a: "En una computadora, la barra superior tiene enlaces a «Inicio», «Descubrir», «Circles», «Collab Boards», «Muse», «Contactos», «Mensajes» y tu «Perfil». En un teléfono, las seis secciones más usadas («Inicio», «Circles», «Collab», «Muse», «Mensajes», «Perfil») están en una barra de pestañas inferior, y «Contactos» es el ícono de persona de la barra superior. Toca el menú ☰ de arriba a la derecha para ir a «Descubrir», «Invitar amigos», «Ajustes» y, si eres administrador, a las herramientas de moderación.",
  },
  "swipe-between-tabs-instead-tapping": {
    q: "¿Puedo deslizar para cambiar de pestaña en lugar de tocar?",
    a: "Sí, en un teléfono: desliza hacia la derecha en cualquier parte de la pantalla para avanzar por Inicio → Circles → Collab → Muse → Mensajes → Perfil, y de ahí otra vez a Inicio. Desliza hacia la izquierda para recorrer las mismas pestañas hacia atrás, dando la vuelta en el otro sentido.",
  },
  "difference-between-home-discover-connections": {
    q: "¿Qué diferencia hay entre Inicio, Descubrir y Contactos?",
    a: "**Inicio** es tu feed: publicaciones de tus contactos y de todas las personas que publican de forma pública, incluidas las publicaciones de los Circles públicos. Las publicaciones de un Circle privado se quedan en ese Circle y nunca aparecen aquí. **Descubrir** sirve para encontrar personas nuevas por país, idioma o interés. **Contactos** es tu lista de contactos aceptados, más las solicitudes pendientes que hayas enviado o recibido.",
  },
  "switch-between-light-dark-mode": {
    q: "¿Cómo cambio entre el modo claro y el oscuro?",
    a: "Usa el selector de tema que está junto a «Ajustes» en la barra superior (o en el menú ☰ en el teléfono). Por defecto sigue la configuración de tu dispositivo, pero puedes dejarlo fijo en claro u oscuro.",
  },
  "yukon3t-work-iphones-accessibility-settings": {
    q: "¿YuKon3t funciona con los ajustes de accesibilidad de mi iPhone?",
    a: "Sí. La aplicación para iPhone funciona con Control por voz y respeta el tamaño de texto de tu iPhone: auméntalo en Ajustes → Accesibilidad → Pantalla y tamaño de texto → Texto más grande y el texto de YuKon3t crecerá con él, hasta un poco más del doble de su tamaño normal. La barra superior y la barra de pestañas inferior crecen solo un poco, para que todos los íconos y pestañas sigan cabiendo en la pantalla. La aplicación también respeta Reducir movimiento, y el modo oscuro sigue a tu dispositivo a menos que lo fijes tú.",
  },
  "megaphone-icon-next-bell": {
    q: "¿Qué es el ícono de megáfono que está junto a la campana?",
    a: "Es «Novedades»: tócalo para ver la lista de las funciones y mejoras que vamos lanzando. Se ilumina cuando hay algo que todavía no has visto, y en cuanto se publica una novedad se envía una notificación real a tu teléfono, así que no tienes que acordarte de revisarlo.",
  },
  "search-app": {
    q: "¿Cómo busco en la aplicación?",
    a: "Toca el ícono de lupa que está junto a la campana de notificaciones. Un solo cuadro de búsqueda cubre personas, Circles, chats grupales y colaboraciones a la vez. Puedes filtrar los resultados por más relevantes, más recientes, más antiguos, «actualidad» (con actividad en las últimas dos semanas) o un país concreto.",
  },
  "click-someones-name-almost-everywhere": {
    q: "¿Por qué puedo hacer clic en el nombre de alguien casi en cualquier parte?",
    a: "Cualquier nombre o foto de perfil que veas (en un chat, un comentario, una lista de contactos, la lista de miembros de un Circle, etc.) lleva directamente al perfil de esa persona. Funciona igual en todas partes a propósito, para que nunca tengas que buscar un botón de «ver perfil».",
  },
  "some-people-disappear-from-discover": {
    q: "¿Por qué algunas personas desaparecen de Descubrir?",
    a: "Descubrir solo muestra personas con las que todavía no has tenido ninguna interacción de contacto: en cuanto envías o recibes una solicitud de contacto, esa persona deja de aparecer en los resultados de Descubrir (siga pendiente o ya esté aceptada). Si una solicitud se rechaza, esa persona puede volver a aparecer en Descubrir para un nuevo intento.",
  },
  "new-member-alerts": {
    q: "¿Por qué recibí una notificación de que alguien acaba de unirse a YuKon3t?",
    a: "Cuando alguien nuevo termina de configurar su perfil y ha verificado su cuenta, YuKon3t avisa a quienes usan Descubrir, para que los recién llegados encuentren personas con quienes conectar. Solo se anuncia a quienes aparecen en Descubrir: no a quien desactivó «Mostrar mi perfil en Descubrir», no a quien tiene sus publicaciones visibles solo para sus contactos, y nunca a nadie que hayas bloqueado o que te haya bloqueado. Cada persona se anuncia una sola vez, poco después de unirse. Tu teléfono recibe como máximo uno de estos avisos cada 12 horas; cuando se unen más personas, tus notificaciones las agrupan en una sola entrada («Ada y 3 personas más acaban de unirse a YuKon3t») que abre Descubrir con las personas más nuevas primero. Para dejar de recibirlos, desmarca Miembros nuevos en Ajustes → Notificaciones. Para que no te anuncien cuando te unas, desactiva «Mostrar mi perfil en Descubrir» en Ajustes → Privacidad justo después de registrarte.",
  },
  "home-split-into-sections-like": {
    q: "¿Por qué Inicio está dividido en secciones como Trabajo, Entretenimiento, Política y Deportes?",
    a: "Las publicaciones se agrupan según la sección del feed que su autor eligió al escribirlas (por defecto, General), para que sea más fácil ver lo que te interesa. Mientras estás en la página, cada sección agrega las publicaciones nuevas arriba automáticamente, por lo general en unos segundos y en cerca de medio minuto cuando se publica mucho a la vez. No hace falta actualizar.",
  },
  "update-the-app": {
    q: "¿Cómo actualizo la aplicación y por qué me piden que la actualice?",
    a: "La mayoría de las mejoras te llegan solas: la aplicación carga la versión más reciente de YuKon3t cada vez que la abres. Algunos cambios necesitan una versión nueva de la propia aplicación en Google Play o en la App Store, y cuando sale una puede que veas un aviso de «Actualización disponible»: toca **Actualizar** para abrir la tienda y luego toca Actualizar allí. «Ahora no» oculta el aviso durante 3 días. En contadas ocasiones, cuando una versión anterior ya no puede funcionar bien, verás en su lugar una pantalla de «Actualización necesaria»; desde ella puedes seguir abriendo estas preguntas frecuentes o cerrar sesión, y todo vuelve a funcionar en cuanto actualizas. También puedes actualizar cuando quieras: abre Google Play o la App Store, busca YuKon3t y toca Actualizar. Para enviar estos avisos, la versión y el número de compilación de la aplicación y la plataforma de tu teléfono (Android o iPhone) se guardan junto con su token de notificaciones push.",
  },
  "slow-connection-data-saver": {
    q: "¿YuKon3t funciona con una conexión lenta o inestable?",
    a: "Sí. Cuando tu conexión es lenta (3G, 4G o 5G con poca señal, una red Wi-Fi saturada) o el ahorro de datos de tu teléfono está activado, YuKon3t se adapta solo: los videos del feed esperan a que toques reproducir en lugar de empezar mientras te desplazas, Muse solo carga el video que estás viendo, el feed carga menos publicaciones a la vez y no se graba la sesión para las estadísticas. También puedes elegirlo tú en Ajustes → **«Ahorro de datos»**: «Automático» (la opción predeterminada), «Activado» o «Desactivado». El ajuste se guarda solo en ese dispositivo.\n\nSi algo no carga, YuKon3t lo vuelve a intentar solo y muestra un pequeño aviso «Conexión lenta. Reintentando…» mientras tanto. Sin conexión verás un aviso, y lo que no cargó continúa en cuanto vuelves a conectarte. Hay cosas que YuKon3t no controla y pueden seguir yendo lentas: la señal de tu operador, los videos insertados de otros sitios y la calidad de una llamada con una conexión muy débil (las llamadas ajustan su propia calidad de video a la conexión).",
  },

  "app-opens-chrome-instead-full": {
    q: "La aplicación se abre en Chrome en lugar de a pantalla completa. ¿Cómo lo soluciono?",
    a: "Es un ajuste de Android que se cambia una sola vez, no un error. En tu teléfono, ve a Ajustes → Aplicaciones → YuKon3t → «Abrir de forma predeterminada» (algunas versiones de Android lo llaman «Establecer como predeterminada» o «Enlaces compatibles») y comprueba que `yukon3t.com` esté activado en «Direcciones web compatibles». Android lo deja desactivado por defecto como control de privacidad y la aplicación no puede activarlo por ti, así que es un paso manual que se hace una sola vez después de instalarla.",
  },
  "still-get-calls-phone-asleep": {
    q: "¿Me seguirán llegando llamadas si mi teléfono está en reposo o bloqueado?",
    a: "Sí. Una llamada entrante suena y enciende la pantalla sobre la pantalla de bloqueo aunque el teléfono esté en reposo o en un modo de ahorro de batería (Doze), igual que una llamada telefónica normal. Puedes aceptarla o rechazarla desde esa misma pantalla, o tocarla para abrir la aplicación. Para esto, YuKon3t necesita tener activado el permiso de notificaciones (Android lo pide la primera vez que inicias sesión). Si las llamadas no encienden tu teléfono, revisa Ajustes → Aplicaciones → YuKon3t → Notificaciones.",
  },
  "shows-up-notification-phone": {
    q: "¿Qué llega como notificación a mi teléfono?",
    a: "Llamadas entrantes, llamadas perdidas (con el nombre de quien llamó), mensajes (incluidas las respuestas a tu historia), me gusta, comentarios y veces que se comparten o se vuelven a compartir tus publicaciones y tus videos de Muse, solicitudes de contacto, recordatorios de eventos, alguien que inicia una transmisión en vivo solo contigo, una sesión periódica de una colaboración que está por empezar y avisos generales sobre funciones nuevas. Todo eso llega como notificaciones reales de Android aunque la aplicación no esté abierta, no solo en el ícono de campana dentro de la aplicación. Al tocar una (o una notificación de la lista dentro de la aplicación) se abre exactamente aquello de lo que trata: la publicación, el Muse, la historia, el chat, el evento, el Circle, la transmisión en vivo, la colaboración o la lista de Contactos (en una llamada perdida, el perfil de quien llamó), aunque la aplicación estuviera en segundo plano o se recargue con una versión más nueva al abrirse. Si eso se eliminó después, o está en un Circle privado del que ya no formas parte, verás una página de «no encontrado». Abrir la aplicación (desde una notificación, desde su ícono o al volver de otra aplicación) borra automáticamente todas las notificaciones de este tipo del panel de notificaciones. La única excepción es una llamada que está sonando o una llamada perdida, que se quedan hasta que te ocupes de la llamada. La lista de notificaciones dentro de la aplicación funciona de otra manera: una notificación se marca como leída cuando la abres desde la lista, cuando tocas su notificación en el teléfono o cuando abres aquello de lo que trata (la conversación, la publicación, el Muse, el Circle, etc.). Las demás siguen sin leer, y el indicador rojo de la campana las sigue contando, hasta entonces o hasta que toques «Marcar todo como leído».",
  },
  "turning-up-phones-volume-unmutes": {
    q: "Al subir el volumen del teléfono se activa el sonido de un video de mi feed. ¿Es normal?",
    a: "Sí, es intencional. Los videos del feed comparten un único ajuste de sonido para toda la aplicación (toca el ícono de altavoz de cualquier video o sube el volumen del teléfono): al activar el sonido, se activa para todos los videos de tu feed, incluidos los que veas después al desplazarte, igual que en el feed de Instagram.",
  },

  post: {
    q: "¿Qué puedo publicar?",
    a: "Texto, fotos y videos de tu dispositivo o de la cámara, una imagen tomada de una URL o un enlace incrustado de YouTube o Vimeo. Toca los íconos de cámara y de foto del editor: cada uno abre un pequeño menú con dispositivo, cámara o enlace, de modo que hay un botón para fotos y otro para videos en lugar de una fila de botones separados.",
  },
  "which-video-formats-upload-everyone": {
    q: "¿Qué formatos de video puedo subir? ¿Todo el mundo puede verlos?",
    a: "MP4, WebM y QuickTime (.mov, lo que graba un iPhone), de hasta 2 GB. Un .mov se vuelve a codificar en segundo plano como un MP4 estándar para que se reproduzca en todos los navegadores, no solo en Safari. Suele tardar unos minutos y, hasta que termina, el original se reproduce para quienes usen un navegador compatible. Si un video no se puede convertir, el original se queda como está.",
  },
  "was-photo-video-rejected": {
    q: "¿Por qué rechazaron mi foto o mi video?",
    a: "Todo lo que se sube pasa por una revisión automática antes de que lo vea nadie más. El contenido que incumple nuestras [Normas de la comunidad](/legal/guidelines) (lo más habitual es el material sexualmente explícito) se rechaza y nunca se publica.",
  },
  "delete-post-report-someone-elses": {
    q: "¿Cómo elimino una publicación o reporto la de otra persona?",
    a: "Abre el menú «⋯» de cualquier publicación para eliminarla (si es tuya) o reportarla (sea de quien sea). Los reportes van a nuestra cola de moderación y se revisan; en cualquiera de los dos resultados se indica el motivo.",
  },
  "share-post": {
    q: "¿Cómo comparto una publicación?",
    a: "Toca el ícono de compartir de cualquier publicación para abrir un menú: copiar el enlace, compartir con el menú de compartir de tu dispositivo, agregarla a tu historia, compartirla en Muse (solo publicaciones con video de hasta 5 minutos), enviársela directamente a un amigo como mensaje o compartirla en un Circle. Al compartir con el dispositivo se adjunta la foto o el video en sí cuando es posible (no solo un enlace), con un pequeño logo de yukon3t, para que aplicaciones como WhatsApp o Mensajes muestren la publicación real con la marca del lugar de donde salió. En «Enviar a un amigo» puedes marcar hasta 5 chats y enviárselo a todos a la vez; lo mismo funciona al compartir un Muse, una historia o algo que compartes desde otra aplicación.",
  },
  "share-photo-video-from-another": {
    q: "¿Puedo compartir una foto o un video de otra aplicación (Instagram, TikTok, WhatsApp, etc.) directamente en YuKon3t?",
    a: "Sí: en el menú de compartir de esa aplicación, elige YuKon3t como destino. Se abre enseguida un pequeño cuadro con una vista previa que te deja agregarlo a tu historia, publicarlo en Muse, publicarlo en tu feed de Inicio o enviárselo a un amigo. Elige una opción y se publica de inmediato (después de pasar la misma revisión automática de contenido que todo lo que se sube), sin más toques ni tener que ir aparte al editor. Funciona mejor cuando la otra aplicación entrega el archivo real de la foto o el video. La acción de compartir de algunas aplicaciones solo envía un enlace a su propia publicación (es una decisión de cada aplicación, no algo que YuKon3t controle; Instagram y TikTok, entre otras, por lo general solo entregan el archivo a unas pocas aplicaciones asociadas). Cuando eso pasa y el enlace es de una plataforma de video reconocida (YouTube, Vimeo, TikTok, Instagram, Facebook, Dailymotion), YuKon3t igual te ofrece historia, Muse y feed: el video real se reproduce ahí mismo, igual que cuando pegas uno de esos enlaces directamente en el editor del feed, solo que lo modera esa plataforma y no YuKon3t. Con cualquier otro enlace, YuKon3t te lo avisa y aun así puedes enviárselo a un amigo desde el mismo cuadro. Por ahora, solo en Android.",
  },
  "react-post-something-other-than": {
    q: "¿Puedo reaccionar a una publicación con algo que no sea un corazón?",
    a: "Sí. El ícono de carita que está junto al corazón en cualquier publicación (o en un mensaje) abre primero una fila rápida de reacciones comunes, más un «+» para abrir el selector completo de emojis si quieres otra cosa. Si eliges el mismo emoji otra vez, se quita, y si eliges uno distinto, se cambia. Esto es independiente del botón de corazón o «Me gusta», así que puedes darle «Me gusta» a una publicación y además agregarle una reacción con emoji. El selector completo (en publicaciones, comentarios y chats) también entiende términos de búsqueda informales y que no están en inglés: al escribir «pray», «amen»/«ameen»/«aameen» o «sad» aparece una pequeña fila «Sugeridos» con emojis relacionados, encima de los resultados normales.",
  },
  "change-emoji-look-throughout-app": {
    q: "¿Puedo cambiar cómo se ven los emojis en toda la aplicación?",
    a: "Sí. En Ajustes → «Estilo de emojis», elige entre el estilo nativo, el de Apple, el de Google, el de Facebook o el de Twitter/X. Lo que elijas se aplica en todos los lugares donde aparecen emojis: reacciones, el selector y los mensajes.",
  },
  "send-gif": {
    q: "¿Puedo enviar un GIF?",
    a: "Sí. El botón de GIF (junto al botón de emojis) del editor de publicaciones, de un chat o de un cuadro de comentarios abre un buscador. Elige uno para adjuntarlo, igual que adjuntarías una foto.",
  },
  "videos-feed-play-automatically-no": {
    q: "¿Por qué los videos de mi feed se reproducen solos y sin sonido?",
    a: "Los videos del feed se reproducen automáticamente en silencio cuando llegas a ellos al desplazarte y se pausan cuando los dejas atrás. Toca el ícono de altavoz del video para activar el sonido (consulta «Al subir el volumen del teléfono se activa el sonido de un video de mi feed», más arriba) o toca el video para pausarlo o reanudarlo.",
  },
  "zoom-back-out-photo-without": {
    q: "¿Cómo quito el zoom de una foto sin cerrar el visor?",
    a: "Toca una vez la foto ampliada (un toque simple, no doble) para que vuelva a su tamaño original. El doble toque sigue acercando y alejando como siempre; esto solo agrega una forma más rápida de volver al tamaño normal sin salir del visor.",
  },
  "dictate-post": {
    q: "¿Puedo dictar una publicación en lugar de escribirla?",
    a: "Sí. Toca el ícono del micrófono en el editor de publicaciones (o en el cuadro de mensaje de un chat) para grabar un audio corto; se transcribe y aparece en el cuadro de texto para que lo revises y lo edites antes de publicar o enviar. No es lo mismo que el botón redondo de micrófono/enviar de un chat, que envía la grabación tal cual como nota de voz: el micrófono de dictado está junto al botón de emojis y siempre produce texto editable. Habla en tu idioma: el español, el francés, el portugués, el árabe y muchos otros se reconocen automáticamente, sin importar en qué idioma veas la aplicación.",
  },
  "difference-between-connect-subscribe": {
    q: "¿Qué diferencia hay entre Conectar y Suscribirse?",
    a: "**Conectar** es la solicitud de contacto mutua de siempre: eliges por qué quieres conectar (amistad, intercambio cultural, profesional, comunidad o consejos de viaje), la otra persona tiene que aceptar y eso habilita los mensajes y las llamadas entre ustedes. **Suscribirse** va en una sola dirección y no necesita aprobación: al suscribirte a alguien, recibes una notificación cada vez que publica, agrega una historia, republica algo, transmite en vivo, confirma su asistencia a un evento, sube un Muse, inicia una colaboración o crea un Circle o se une a uno. Puedes suscribirte a alguien sin tenerlo entre tus contactos, y al revés. La excepción es que aceptar una solicitud de contacto suscribe automáticamente a cada uno al otro, así que no hace falta que además te suscribas a alguien con quien ya conectaste. Después puedes cancelar la suscripción sin que eso afecte al contacto en sí. Los dos íconos están junto al ícono de compartir en todas las publicaciones que ves: en Inicio, en el feed de un Circle, en los resultados de búsqueda y en las publicaciones de Collab Boards. Las publicaciones de un Circle público notifican a tus suscriptores y contactos como cualquier publicación pública. Las de un Circle privado son solo para sus miembros, así que no notifican a nadie de fuera y no se pueden republicar ni compartir fuera de él.",
  },
  "see-who-im-subscribed-whos": {
    q: "¿Cómo veo a quién estoy suscrito o quién está suscrito a mí?",
    a: "Abre el perfil de cualquier persona, incluido el tuyo, y toca el número de suscriptores o de suscripciones que aparece cerca de su nombre para ver la lista completa. Desde esas listas puedes suscribirte a cualquier persona o cancelar la suscripción directamente, no solo desde una publicación.",
  },
  "people-you-may-know-discover": {
    q: "¿Qué es «Personas que quizá conozcas» en Descubrir?",
    a: "Una fila de sugerencias cerca de la parte superior de Descubrir, ordenada por contactos en común: personas con las que todavía no has conectado y que comparten contactos contigo, con el número de contactos en común. Son solo sugerencias: aparecer ahí no notifica a nadie ni hace nada por sí solo; es simplemente una forma más rápida de encontrar a gente que probablemente ya conoces que filtrar toda la lista de Descubrir. Solo aparece cuando ya tienes al menos un contacto.",
  },
  "long-post-get-cut-off": {
    q: "¿Por qué una publicación larga se corta con un enlace «Ver más»?",
    a: "Las publicaciones que pasan de cierta longitud se acortan en los feeds para que una sola publicación larga no empuje todo lo demás hacia abajo. Toca «Ver más» para leer el resto ahí mismo y «Ver menos» para volver a contraerla. Esto se aplica en todos los lugares donde se listan publicaciones, y también al texto propio de una republicación. No hay un límite relevante para la longitud de una publicación: escribe todo lo que necesites, que quien la lea siempre podrá expandirla.",
  },
  "got-message-saying-new-version": {
    q: "Al publicar me apareció un mensaje que dice que hay una versión nueva de la aplicación y que actualice la página para continuar.",
    a: "Aparece cuando tu pestaña llevaba abierta desde antes de que lanzáramos una actualización. No es un problema de conexión, solo una página desactualizada. Actualiza la página e inténtalo de nuevo: no se pierde nada de lo que ibas a publicar por reintentarlo.",
  },
  "there-way-see-older-posts": {
    q: "¿Hay forma de ver publicaciones más antiguas en un perfil, en un Circle o en los resultados de búsqueda?",
    a: "Sí. En todo YuKon3t, los elementos más antiguos se cargan solos a medida que te desplazas, ya sea en **Inicio**, en las publicaciones de un perfil, en el feed de un canal de un Circle, en los resultados de búsqueda, en Contactos o en las listas de suscriptores y suscripciones. No hay nada que tocar. (Aparte, Inicio agrega las publicaciones recién hechas arriba automáticamente, por lo general unos segundos después de que se publican; eso es distinto de cargar lo que está más atrás en el feed.)",
  },
} satisfies Partial<FaqItems>;
