import type { advertiseEn } from "@/lib/i18n/en/advertise";
import { captchaUnavailable, serverUnreachable } from "@/lib/i18n/pt/common";
import { shared } from "@/lib/i18n/pt/shared";

export const advertise: typeof advertiseEn = {
  page: {
    eyebrow: "Anuncie no YuKon3t",
    title: "Coloque sua empresa diante de um público global e verificado.",
    intro:
      "Uma tarifa única, sem precisar de conta e sem segmentação de público para configurar: seu anúncio é exibido em todo o aplicativo pelo número de dias que você escolher. Todo anúncio é analisado antes de ir ao ar, e o preço é de {price} por dia.",
    canceled: "O pagamento foi cancelado e nada foi cobrado. Você pode enviar de novo quando quiser.",
    notConfigured:
      "As reservas de anúncios ainda não estão disponíveis. Volte em breve ou fale diretamente com a gente.",
  },
  success: {
    eyebrow: "Pagamento recebido",
    title: "Obrigado! Seu anúncio está reservado.",
    body: "Vamos analisar seu anúncio em breve (normalmente em até um dia útil) antes de ele ir ao ar. Se tivermos alguma dúvida, escreveremos para o e-mail de contato que você informou.",
    back: "Voltar ao YuKon3t",
  },
  form: {
    company: "Nome da empresa",
    contactName: "Nome do contato",
    contactEmail: "E-mail de contato",
    emailPlaceholder: "voce@empresa.com",
    emailHint: "É para onde enviamos seu recibo e o andamento da análise.",
    headline: "Título",
    headlinePlaceholder: "O que você está anunciando?",
    copy: "Texto do anúncio",
    copyPlaceholder: "Uma ou duas frases descrevendo o que você oferece.",
    link: "URL do link",
    linkPlaceholder: "https://suaempresa.com",
    creative: "Imagem ou vídeo do anúncio",
    removeMedia: "Remover mídia",
    addPhoto: "Adicionar uma foto",
    addVideo: "Adicionar um vídeo",
    uploadFromDevice: "Enviar do dispositivo",
    takePhoto: "Tirar uma foto",
    duration: "Duração",
    days: "one: # dia | other: # dias",
    total: "Total",
    preparing: "Preparando o pagamento...",
    continue: "Continuar para o pagamento: {price}",
    stripeNote:
      "O pagamento é feito com segurança pela Stripe. Os anúncios vão ao ar depois de uma análise rápida, normalmente em até um dia útil.",
    oneTime:
      "one: Cobrança única por apenas # dia, sem renovação automática nem cobrança recorrente. Para veicular outra campanha depois, é preciso fazer uma nova reserva e um novo pagamento. | other: Cobrança única por apenas # dias, sem renovação automática nem cobrança recorrente. Para veicular outra campanha depois, é preciso fazer uma nova reserva e um novo pagamento.",
    // The bot check's own button and status lines (TurnstileWidget), the same sentences as the account screens.
    turnstile: shared.turnstile,
    errors: {
      too_large: "Esse arquivo é grande demais.",
      moderation: "Esse anúncio não está de acordo com nossas diretrizes de conteúdo.",
      rate_limited: "Muitas tentativas. Tente novamente em instantes.",
      not_configured: "As reservas de anúncios ainda não estão disponíveis. Volte em breve.",
      payment_setup_failed: "Não foi possível iniciar o pagamento. Tente novamente.",
      invalid: "Confira os dados informados.",
      network: serverUnreachable,
      captcha: "Não foi possível concluir a verificação de segurança. Aguarde um momento e tente novamente.",
      captcha_unavailable: captchaUnavailable,
      other: "Não foi possível enviar essa reserva. Tente novamente.",
      imageType: "Use uma imagem JPEG, PNG ou WebP.",
      imageTooLarge: "As imagens devem ter no máximo 25 MB.",
      videoType: "Use um vídeo MP4, MOV ou WebM.",
      videoTooLarge: "O vídeo deve ter no máximo 250 MB.",
      videoTooLong: "one: Os vídeos devem ter no máximo # segundo. | other: Os vídeos devem ter no máximo # segundos.",
      details: "Preencha os dados da sua empresa e de contato.",
      adFields: "Preencha o título, o texto e o link do seu anúncio.",
      media: "Adicione uma foto ou um vídeo ao seu anúncio.",
    },
  },
};
