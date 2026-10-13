// Neutral Latin American Spanish, informal "tú". Product names (YuKon3t, Circles, Collab Boards) stay as they are.
// Under /messages the people someone is connected with are "contactos" (a request is a "solicitud de contacto"),
// because "conexión" already means the network connection. A story is "historia", a post "publicación", a live
// stream "transmisión en vivo". A screen is referred to by the label the nav gives it ("Descubrir", "Ajustes"), even
// while the screen itself is still English. A state of the reader ("Suscripción activa") is worded without a
// gendered participle.

export const captchaFailed =
  "No pudimos completar la verificación de seguridad. Espera un momento e inténtalo de nuevo. Si sigue pasando, desactiva cualquier bloqueador de contenido o prueba con otra red.";
export const phoneInvalid = "Ese número no es válido para el país seleccionado. Revisa el país y los dígitos.";
export const emailPlaceholder = "tu@ejemplo.com";

export const serverUnreachable = "No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.";
// Also under messages.controls: the screens under /messages render these two controls as well.
export const passwordInput = { show: "Mostrar contraseña", hide: "Ocultar contraseña" };
export const multiSelect = {
  placeholder: "Buscar y seleccionar...",
  noMatches: "Sin resultados",
  remove: "Quitar {label}",
  selected: "{count}/{max} seleccionados",
};
