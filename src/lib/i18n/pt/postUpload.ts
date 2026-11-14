import type { postUploadEn } from "@/lib/i18n/en/postUpload";

export const postUpload: typeof postUploadEn = {
  retry: "Tentar de novo",
  retrying: "Tentando de novo...",
  restored: "Sua publicação não foi enviada. Ela voltou para o editor.",
  repick: "Essa foto ou vídeo não pode mais ser lido neste aparelho. Escolha de novo e toque em Publicar.",
  timeout: "A publicação demorou demais e foi interrompida. Sua publicação continua aqui. Toque em Tentar de novo.",
  network: "Não foi possível conectar ao servidor, então sua publicação não foi enviada. Ela continua aqui. Verifique sua conexão e toque em Tentar de novo.",
  uploadFailed: "A foto ou o vídeo não terminou de ser enviado. Sua publicação continua aqui. Toque em Tentar de novo.",
  serverError: "Algo deu errado do nosso lado. Sua publicação continua aqui. Toque em Tentar de novo. Se ela já foi publicada, não será publicada duas vezes.",
  somethingWrong: "Algo deu errado ao publicar. Sua publicação continua aqui. Toque em Tentar de novo.",
  rateLimitedRetry: "Muitas tentativas em pouco tempo. Espere um minuto e toque em Tentar de novo.",
  unauthorized: "Você saiu da sua conta. Entre de novo e publique.",
};
