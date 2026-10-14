import type { FaqItems } from "../ids";

// Spanish FAQ, part 3: Connecting, messaging and calls; Hidden chats. These answers state what is and isn't private:
// every number, time limit and caveat follows the English in ../page.tsx.
export const es3 = {
  "message-someone": {
    q: "¿Cómo le envío un mensaje a alguien?",
    a: "Primero necesitas que esa persona acepte ser tu contacto: envíale una solicitud desde su perfil o desde Descubrir. Cuando ya son contactos, escríbele desde Contactos o inicia una conversación nueva en Mensajes.",
  },
  "reply-specific-message": {
    q: "¿Cómo respondo a un mensaje en concreto?",
    a: "Desliza un mensaje hacia la derecha (o abre su menú «⋯» y toca «Responder» si estás en una computadora) para citarlo en tu respuesta. La otra persona ve exactamente a qué mensaje respondes, algo útil cuando un chat ya va por varios temas a la vez.",
  },
  "send-photos-videos-voice-notes": {
    q: "¿Puedo enviar fotos, videos, notas de voz o GIF en un chat?",
    a: "Sí. El cuadro de mensaje del chat tiene los botones «Agregar una foto» y «Agregar un video» (dispositivo, cámara o grabación en el momento), un botón de GIF y un ícono de micrófono para grabar una nota de voz. Cualquier mensaje que envíes se puede eliminar para ti, o para todos si lo enviaste tú.",
  },
  "send-photo-video-disappears-after": {
    q: "¿Puedo enviar una foto o un video que desaparezca después de verse?",
    a: "Sí, en los chats entre dos personas (no en los chats grupales). Adjunta una foto o un video, activa «Ver una vez» junto al archivo y envíalo. Se envía sin texto, y los videos tienen un límite de 64 MB. La otra persona ve el aviso de tocar para verlo una vez y puede abrirlo una sola vez. Cuando lo hace, el archivo se elimina de nuestro almacenamiento: normalmente en el momento en que aparece en su pantalla, y como mucho en unos minutos si su aplicación se cierra o pierde la conexión antes. Después nadie puede volver a abrirlo: ni esa persona, ni tú, ni YuKon3t. Si nunca se abre, caduca a los 14 días, y eliminar el mensaje para todos antes de que se abra también lo quita. Lo que se conserva es el registro de que se envió un mensaje para ver una vez y de si se abrió (y cuándo); en tu lado verás «Abierto».\n\nLo que no puede hacer: impedir que alguien se quede con una copia. Las capturas y las grabaciones de pantalla no se pueden impedir. En las aplicaciones móviles recibes una notificación cuando se detecta una captura de pantalla en el chat, pero una foto de la pantalla tomada con otro dispositivo no se puede detectar de ninguna manera. Envía solo lo que no te molestaría que la otra persona conservara. Y como no se conserva nada, nuestros moderadores no pueden revisar un mensaje para ver una vez que ya se vio, si alguien lo reporta. Las fotos (y un fotograma de cada video) se revisan automáticamente al enviarse, igual que cualquier otro archivo que se sube, y sigues pudiendo reportar y bloquear a quien lo envió.",
  },
  "see-photo-chat-full-screen": {
    q: "¿Puedo ver una foto de un chat a pantalla completa?",
    a: "Sí. Toca cualquier foto de un mensaje para abrirla a pantalla completa, en el mismo visor que se usa para las imágenes de las publicaciones (pellizca o usa la rueda del ratón para hacer zoom; toca fuera o la X para cerrar).",
  },
  "when-open-chat-jump-straight": {
    q: "Cuando abro un chat, ¿va directo al mensaje más reciente?",
    a: "Sí. Al abrir una conversación, o al cambiar a otra, quedas ubicado en el mensaje más reciente, y la vista sigue los mensajes nuevos que llegan mientras estás en ese chat. Además, el cuadro de mensaje empieza con el último mensaje de la conversación ya escrito, sea enviado o recibido, para que sea rápido responderlo o reenviar lo mismo.",
  },
  "voice-video-calls-work": {
    q: "¿Cómo funcionan las llamadas de voz y las videollamadas?",
    a: "Toca el ícono de teléfono o de video en el perfil de un contacto o en tu chat con esa persona. Le sonará la llamada (con el tono que elegiste; puedes elegirlo en Ajustes → «Llamadas») y podrá aceptarla o rechazarla. Al aceptar, entra a la llamada de inmediato, aunque su teléfono estuviera bloqueado o la aplicación en segundo plano cuando sonó.",
  },
  "add-more-people-call": {
    q: "¿Puedo agregar más personas a una llamada?",
    a: "Sí. Cuando la llamada ya está conectada, toca el ícono de agregar persona que está junto al botón de colgar y elige a uno de tus contactos. Esa persona recibe una llamada entrante normal y, al aceptar, se une a la misma llamada; mientras no contesta, verás «Llamando a …» en la parte superior de la llamada. Cualquier persona que esté en la llamada puede agregar a uno de sus propios contactos, hasta un total de 8 personas. No se puede agregar a alguien que ya está en otra llamada o que tiene un bloqueo con cualquiera de quienes están en la llamada. Cuando una persona cuelga, sale solo ella y la llamada continúa para las demás; termina cuando queda una sola persona. Si tu teléfono muestra la pantalla de llamada del sistema, esa pantalla solo nombra a la persona que te agregó.",
  },
  "put-call-hold": {
    q: "¿Puedo poner una llamada en espera?",
    a: "Sí. Toca el ícono de pausa en los controles de la llamada para poner en espera una llamada de voz o una videollamada. Eso pausa tu micrófono y tu cámara y hace que dejes de oír a la otra persona, que verá que pusiste la llamada en espera. Toca el mismo botón (ahora un ícono de reproducir) para reanudarla: tu micrófono y tu cámara vuelven exactamente a como estaban antes de poner la llamada en espera.",
  },
  "happens-call-switch-apps-lock": {
    q: "¿Qué pasa con una llamada si cambio de aplicación o bloqueo el teléfono?",
    a: "En la aplicación de YuKon3t para Android o iPhone, la llamada continúa: tú y la otra persona pueden seguir hablando con la aplicación en segundo plano o con la pantalla bloqueada. Tu cámara se pausa mientras no estás (los teléfonos no dejan que una aplicación en segundo plano siga grabando), así que en una videollamada la otra persona ve un aviso de que tu cámara está en pausa, y tu video se reanuda cuando vuelves a la aplicación. En el navegador web de un teléfono es distinto: el navegador suspende la página en cuanto sales de ella, así que ahí una llamada no puede seguir en segundo plano. La otra persona verá que se perdió tu conexión, y la llamada termina si no vuelves en aproximadamente un minuto y medio. Para las llamadas en las que necesites apartarte, usa la aplicación.",
  },
  "happens-connection-drops-during-call": {
    q: "¿Qué pasa si se me cae la conexión durante una llamada?",
    a: "La llamada no termina enseguida. Verás «Reconectando…» mientras YuKon3t intenta volver a conectarte, durante un minuto como máximo, aproximadamente. Es útil en un ascensor, en un túnel o al pasar de wifi a datos móviles. Mientras tanto, la otra persona ve que se perdió tu conexión y se le pide que espere. Si no es posible reconectarte en ese tiempo, la llamada termina para ambos, y cualquiera de los dos puede simplemente volver a llamar.",
  },
  "there-limit-long-call-last": {
    q: "¿Hay un límite para la duración de una llamada?",
    a: "Una misma llamada de voz o videollamada puede durar hasta 12 horas. Después termina automáticamente, y puedes iniciar una nueva enseguida.",
  },
  "hear-ringing-sound-when-call": {
    q: "¿Por qué oigo un tono cuando llamo a alguien?",
    a: "Es el tono de llamada en curso, para que sepas que la llamada de verdad está saliendo mientras esperas a que conteste. Se detiene en cuanto la otra persona contesta o rechaza la llamada, o cuando tú la cancelas.",
  },
  "says-already-have-call-someone": {
    q: "Dice que ya tengo una llamada con alguien y no me deja volver a llamar. ¿Qué hago?",
    a: "Pasa cuando una llamada anterior a esa persona sigue marcada como sonando o activa (por ejemplo, si una llamada se interrumpió). Verás una ventana que te ofrece cancelar esa llamada atascada y hacer una nueva de inmediato: toca «Cancelarla y volver a llamar».",
  },
  "group-chats-work": {
    q: "¿Cómo funcionan los chats grupales?",
    a: "Crea uno desde Mensajes → «Nuevo grupo»: elige un nombre y al menos 2 de tus contactos. Los grupos públicos también se pueden encontrar en «Descubrir grupos»: busca por nombre y solicita unirte. Si creaste un grupo, ábrelo y usa «Agregar miembros» en cualquier momento para sumar a más contactos tuyos. Cualquier miembro puede tocar «Salir del grupo» para irse por su cuenta (si quien creó el grupo se va, la propiedad pasa al siguiente miembro). Quien creó el grupo también tiene la opción «Eliminar grupo», que borra el grupo entero, con mensajes y todo, para todos a la vez, cuando ya no hace falta. Los administradores de YuKon3t también pueden eliminar un grupo directamente (por spam, duplicados o un incumplimiento de las Normas), aunque nunca se hayan unido a él.",
  },
  "typed-message-but-didnt-send": {
    q: "Escribí un mensaje pero no lo envié. ¿Se pierde si salgo del chat?",
    a: "No. Lo que hayas escrito sin enviar se guarda como borrador en tu dispositivo en el momento en que lo escribes. Cambia a otra conversación, cierra la aplicación o recarga la página, y seguirá en el cuadro de mensaje cuando vuelvas a ese chat. Solo se borra cuando de verdad lo envías (o cuando borras el texto tú).",
  },
  "secret-chats": {
    q: "¿Qué son los chats secretos?",
    a: "Un chat secreto es una conversación entre dos personas en la que el texto de tus mensajes está cifrado de extremo a extremo: se bloquea en tu teléfono y solo se desbloquea en el de la otra persona, así que ni siquiera los servidores de YuKon3t pueden leerlo. Tienen que activarlo los dos (abre el chat, toca el ⋯ de arriba y elige «Privacidad del chat»), y la primera vez elegirás una frase de recuperación. Funciona solo en chats entre dos personas, no en chats grupales. Conviene saberlo: solo se cifra el *texto* de los mensajes. Las fotos, los videos, las notas de voz y los GIF se siguen subiendo y revisando como en cualquier otro lugar, y los mensajes enviados antes de que los dos lo activaran no estaban cifrados. Una vez activado, nada en la pantalla marca el chat como secreto: no hay etiqueta ni candado en el chat ni en tu lista de mensajes, y las notificaciones solo dicen «Nuevo mensaje». El mismo menú «Privacidad del chat» está en todos los chats entre dos personas, y es ahí donde compruebas que está activado, verificas el código o lo desactivas. (Tu lista de mensajes muestra «Mensaje» en lugar del texto, porque no podemos leerlo para mostrar una vista previa.) Los chats secretos no tienen secreto hacia adelante (forward secrecy): tu clave sigue siendo la misma, así que alguien que accediera a tu teléfono desbloqueado podría leer el historial guardado de ese chat. Y como somos nosotros quienes le entregamos a cada uno la clave pública del otro, abre «Privacidad del chat», toca «Verificar código» y compara el código de seguridad con la otra persona, en persona o en una llamada: si coincide en los dos teléfonos, nadie cambió una clave por el camino y el chat es privado incluso para nosotros.",
  },
  "forget-recovery-passphrase-lose-phone": {
    q: "¿Qué pasa si olvido mi frase de recuperación o pierdo mi teléfono?",
    a: "Tu frase de recuperación bloquea una copia de seguridad de tu clave que nosotros guardamos pero no podemos leer. En un teléfono nuevo, escríbela para desbloquear tus chats secretos anteriores. Si la olvidas *y además* pierdes tu teléfono, no podemos recuperar tus mensajes secretos: es el precio de un cifrado que nosotros no podemos abrir. Puedes empezar de cero con claves nuevas, pero entonces los mensajes secretos enviados con la clave anterior ya no se podrán leer nunca más, ni tú ni la otra persona, y tus chats secretos se desactivan hasta que los dos vuelvan a activarlos.",
  },
  "moderators-read-secret-chats-report": {
    q: "¿Los moderadores pueden leer los chats secretos? ¿Cómo reporto un abuso en uno?",
    a: "No. Como no podemos leer los chats secretos, no analizamos su texto en busca de incumplimientos de nuestras políticas, como sí hacemos con los mensajes normales, y los administradores no pueden abrirlos. Nuestras reglas se siguen aplicando ahí. Si alguien te envía algo abusivo, toca el ⋯ de ese mensaje y elige «Reportar»: la aplicación te avisa primero de que eso comparte el texto de ese único mensaje con nuestros moderadores para que puedan revisarlo. No podemos verificarlo por nuestra cuenta, así que un reporte solo contiene lo que tú decides enviar. Las fotos y los videos de los chats secretos se siguen revisando. Puedes desactivar el chat secreto cuando quieras en «Privacidad del chat»; a partir de entonces, los mensajes nuevos se vuelven a analizar.",
  },

  "hiding-chat": {
    q: "¿Qué pasa al ocultar un chat?",
    a: "Abre un chat, toca el ⋯ de arriba y elige «Ocultar chat». La primera vez, eliges un PIN de 4 a 8 dígitos. Desde ese momento, el chat sale de tu lista de Mensajes, deja de contar en tus indicadores de mensajes sin leer y en la campana de notificaciones, y ya no se ofrece cuando compartes algo. Si es un chat entre dos personas, la otra persona también desaparece de tu lista de Contactos y de los selectores para crear un grupo, iniciar una llamada o enviar una invitación. Los chats grupales también se pueden ocultar. Un mensaje nuevo en un chat oculto te sigue llegando, pero la notificación solo dice «Tienes una nueva notificación», sin nombre y sin vista previa, y abre la pantalla de Inicio. Una llamada entrante de alguien cuyo chat ocultaste aparece como «Llamada privada».",
  },
  "open-hidden-chat-unhide-one": {
    q: "¿Cómo abro un chat oculto y cómo dejo de ocultarlo?",
    a: "Mantén presionada la palabra «Mensajes» en la parte superior de tu pantalla de Mensajes, o ve a Ajustes, «Privacidad», «Chats ocultos». Escribe tu PIN y verás la lista de tus chats ocultos. Esas dos entradas están siempre ahí para todo el mundo, así que no revelan si has ocultado algo. La zona se vuelve a bloquear sola después de unos 10 minutos, en cuanto sales de la aplicación o cambias de pestaña con un chat oculto en pantalla, cuando tocas «Bloquear ahora» y cuando cierras sesión. Para dejar de ocultar un chat, ábrelo, toca ⋯ y elige «Dejar de ocultar el chat».",
  },
  "other-person-know-hid-our": {
    q: "¿La otra persona sabe que oculté nuestro chat?",
    a: "No. Ocultar es algo que pasa solo de tu lado. No se le avisa, nada cambia de su lado, y sus mensajes y llamadas se entregan como siempre. Esa persona te sigue viendo en sus propias listas.",
  },
  "forgot-pin-happens-hidden-chats": {
    q: "Olvidé mi PIN. ¿Qué pasa con mis chats ocultos?",
    a: "En la pantalla del PIN, toca «¿Olvidaste tu PIN?» y confirma que eres tú con la contraseña de tu cuenta. Si tu cuenta no tiene contraseña (inicias sesión con un enlace por correo, con Google o con Apple), te enviamos un código por correo. Después, elige un PIN nuevo. Tus chats siguen ocultos y no se pierde nada de lo que hay en ellos. Después de 5 PIN incorrectos seguidos tienes que esperar 15 minutos, y más tiempo cada vez que vuelve a pasar.",
  },
  "doesnt-hiding-chat": {
    q: "¿Qué no hace ocultar un chat?",
    a: "Oculta el chat en tu cuenta; no lo cifra. Los mensajes se guardan igual que los de cualquier otro chat, y nuestra moderación se sigue aplicando. Si quieres un texto que ni siquiera nosotros podamos leer, para eso está «Privacidad del chat» (los chats secretos), y puedes usar las dos cosas en el mismo chat. Las notificaciones que ya estaban en tu teléfono antes de ocultar el chat no se retiran, así que bórralas tú. La persona sigue apareciendo en los lugares públicos: la búsqueda, Descubrir, su perfil y sus publicaciones, comentarios y me gusta. Al tocar «Mensaje» en su perfil se te pide tu PIN. Y cualquiera que conozca tu PIN y tenga tu teléfono desbloqueado puede abrir la zona oculta.",
  },
} satisfies Partial<FaqItems>;
