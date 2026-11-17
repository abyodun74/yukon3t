import type { postUploadEn } from "@/lib/i18n/en/postUpload";

export const postUpload: typeof postUploadEn = {
  retry: "Riprova",
  retrying: "Nuovo tentativo...",
  restored: "Il tuo post non è stato inviato. È tornato nell'editor.",
  repick: "Questa foto o questo video non può più essere letto su questo dispositivo. Sceglilo di nuovo e tocca Pubblica.",
  timeout: "La pubblicazione ha impiegato troppo tempo ed è stata interrotta. Il tuo post è ancora qui. Tocca Riprova.",
  network: "Impossibile connettersi al server, quindi il tuo post non è stato inviato. È ancora qui. Controlla la connessione e tocca Riprova.",
  uploadFailed: "La foto o il video non è stato caricato del tutto. Il tuo post è ancora qui. Tocca Riprova.",
  serverError: "Qualcosa è andato storto da parte nostra. Il tuo post è ancora qui. Tocca Riprova. Se è già stato pubblicato, non verrà pubblicato due volte.",
  somethingWrong: "Qualcosa è andato storto durante la pubblicazione. Il tuo post è ancora qui. Tocca Riprova.",
  rateLimitedRetry: "Troppi tentativi in poco tempo. Aspetta un minuto e tocca Riprova.",
  unauthorized: "Sei uscito dall'account. Accedi di nuovo e pubblica.",
};
