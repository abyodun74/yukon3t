import type { settingsEn } from "@/lib/i18n/en/settings";
import { serverUnreachable } from "@/lib/i18n/pt/common";

// "Inner Circle" and "Ambient" are feature names and stay as they are, like Circles and Muse.
export const settings: typeof settingsEn = {
  title: "Configurações",
  signedInAs: "Conta conectada: {email}",
  editProfile: "Quer mudar seu nome, bio, foto ou interesses? {link}.",
  editProfileLink: "Edite seu perfil",
  faq: "Está começando no YuKon3t ou quer saber como algo funciona? {link}.",
  faqLink: "Consulte as perguntas frequentes",
  passwordResetRequired: "Para sua segurança, escolha uma nova senha",
  saved: "Configurações atualizadas.",
  errors: {
    username_taken: "Esse nome de usuário já está em uso. Tente outro.",
    current_password_invalid: "A senha atual está incorreta.",
    same_password: "Essa é a sua senha atual. Para sua segurança, escolha outra.",
    rate_limited: "Muitas tentativas. Tente novamente em alguns minutos.",
    other: "Confira os dados informados.",
  },
  saving: "Salvando...",
  privacy: {
    heading: "Privacidade",
    intro: "Controla o que pode ser visto por quem não é sua conexão.",
    postsVisibility: "Quem pode ver suas publicações",
    public: "Qualquer pessoa com sessão iniciada",
    connectionsOnly: "Somente minhas conexões",
    discoverable: "Mostrar meu perfil em Descobrir",
    save: "Salvar configurações de privacidade",
    hiddenChats: "Conversas ocultas",
  },
  notifications: {
    heading: "Notificações",
    intro:
      "Receba avisos de chamadas e de novas mensagens mesmo quando o YuKon3t não estiver aberto em uma aba.",
    native: "As notificações já estão ativadas no aplicativo. Não é preciso ativá-las separadamente aqui.",
    unsupported: "Ainda não disponível neste dispositivo ou navegador.",
    denied:
      "As notificações deste site estão bloqueadas nas configurações do seu navegador. Libere-as por lá para ativar esta opção.",
    turnOff: "Desativar notificações",
    enable: "Ativar notificações",
    newMembers: "Novos membros",
    newMembersHint:
      "Me avise quando alguém novo entrar no YuKon3t e aparecer em Descobrir. Seu celular recebe no máximo um desses avisos a cada 12 horas; os demais ficam agrupados em uma única entrada nas suas notificações.",
    save: "Salvar",
  },
  language: {
    heading: "Idioma",
    body: "O aplicativo inteiro, as telas de acesso à conta e as perguntas frequentes estão disponíveis nesses idiomas, e as notificações enviadas ao seu celular seguem o que você escolher aqui. As páginas legais estão em inglês.",
    autoTranslate: "Traduzir automaticamente publicações, comentários e mensagens para o meu idioma",
    autoTranslateHint: "Desativado: você verá um botão Traduzir abaixo de textos escritos em outro idioma. Ativado: eles são traduzidos assim que aparecem na tela, e \"Ver original\" fica sempre a um toque. Para ser traduzido, o texto é enviado ao nosso provedor de IA (OpenAI). Conversas secretas nunca são traduzidas.",
    autoTranslateUnavailable: "A tradução está indisponível no momento.",
    save: "Salvar",
  },
  emoji: {
    heading: "Estilo dos emojis",
    intro: "Escolha a aparência dos emojis em todo o aplicativo: reações, mensagens e publicações.",
    styles: {
      native: "Nativo",
      apple: "Apple (estilo 3D)",
      google: "Google",
      facebook: "Facebook (estilo 2.5D)",
      twitter: "Twitter/X",
    },
  },
  invite: {
    heading: "Convidar amigos",
    intro:
      "Envie o link do aplicativo direto para as pessoas da agenda do seu celular que ainda não estão no YuKon3t.",
  },
  blocked: {
    heading: "Contas bloqueadas",
    intro:
      "Essas contas não podem enviar mensagens, ligar nem se conectar com você, e você não as verá em Descobrir.",
    deleted: "Conta excluída",
  },
  calls: {
    heading: "Chamadas",
    intro: "Toca tanto nas chamadas de áudio quanto nas de vídeo.",
    ringtone: "Toque",
    save: "Salvar toque",
    preview: "Ouvir",
    ringtones: {
      CLASSIC: "Toque clássico",
      CHIME: "Carrilhão",
      DIGITAL: "Digital",
      MARIMBA: "Marimba",
      PULSE: "Pulso",
    },
  },
  signInMethod: {
    heading: "Forma de acesso",
    withPassword: "Você pode entrar com seu nome de usuário e senha ou com o link por e-mail.",
    withoutPassword: "Adicione um nome de usuário e uma senha como alternativa ao link de acesso por e-mail.",
    username: "Nome de usuário",
    usernameIs: "Nome de usuário: {username}",
    currentPassword: "Senha atual",
    newPassword: "Nova senha",
    password: "Senha",
    signsOut: "Ao mudar sua senha, sua conta é desconectada em todos os outros dispositivos.",
    update: "Atualizar senha",
    updating: "Atualizando...",
    set: "Definir senha",
    setting: "Salvando...",
  },
  phone: {
    heading: "Verificação do telefone",
    intro: "Opcional: verificar um número de telefone aumenta seu nível de confiança.",
    verified: "Telefone verificado: {number}",
  },
  data: {
    heading: "Seus dados",
    stored:
      "Suas publicações, fotos, vídeos, mensagens, Circles e conexões ficam guardados em nossos servidores, e não em um dispositivo específico. Por isso, ao entrar em um novo celular ou computador com este mesmo e-mail ou nome de usuário, tudo vem junto automaticamente. Não é preciso mover nem restaurar nada manualmente.",
    exportIntro:
      "Você também pode exportar em JSON tudo o que temos sobre você, quando quiser e de graça: um backup pessoal que fica com você, fora do YuKon3t.",
    export: "Exportar meus dados",
    exportLimited: "Muitas exportações recentes. Tente novamente daqui a pouco.",
    deactivateHeading: "Desativar conta",
    deactivateIntro:
      "Oculta temporariamente seu perfil e suas publicações. Nada é excluído: entre novamente quando quiser, com sua senha ou com o link por e-mail, para reativar a conta.",
    deactivate: "Desativar minha conta",
    deactivateConfirm: "Sim, desativar",
    deleteHeading: "Excluir conta",
    deleteIntro:
      "Exclui permanentemente seu perfil, suas publicações, suas mensagens e os Circles que pertencem a você. Não é possível desfazer, e nunca cobramos nem dificultamos isso.",
    delete: "Excluir minha conta",
    deleteConfirm: "Sim, excluir permanentemente",
    cancel: "Cancelar",
  },
  verifyDevice: {
    usedBody:
      "Este link de verificação expirou ou já foi usado. Tente mudar sua senha novamente nas Configurações.",
    backToSettings: "Voltar às Configurações",
    body: "Para sua segurança, digite o código de 6 dígitos que acabamos de enviar para o seu e-mail para concluir a mudança de senha.",
    submit: "Confirmar mudança de senha",
    cancel: "Cancelar",
  },
  dataSaver: {
    heading: "Economia de dados",
    intro: "Usa menos dados móveis e mantém o YuKon3t rápido em conexões lentas ou instáveis: os vídeos do feed esperam você tocar em reproduzir, os vídeos próximos do Muse não são pré-carregados, o feed carrega menos publicações por vez e a gravação de sessão para estatísticas é desativada.",
    options: {
      auto: "Automático",
      on: "Ativada",
      off: "Desativada",
    },
    hints: {
      auto: "Liga sozinha quando sua conexão está lenta ou a economia de dados do celular está ativada.",
      on: "Sempre ativada neste dispositivo.",
      off: "Nunca ativada, nem em conexão lenta.",
    },
    status: {
      good: "Agora: sua conexão parece boa.",
      slow: "Agora: a economia de dados está ativada.",
      offline: "Agora: você está offline.",
    },
    device: "Esta configuração fica salva só neste dispositivo.",
  },
  ambient: {
    heading: "Ambient",
    intro:
      "Um punhado de pessoas que você conhece de verdade e momentos espontâneos em vez de publicações elaboradas. É só uma primeira base: ainda não há widget para a tela de bloqueio.",
    manage: "Gerenciar o Inner Circle",
    page: {
      intro:
        "Presença no dia a dia em vez de publicações para se exibir: um punhado de pessoas que você conhece de verdade e momentos espontâneos em vez de publicações elaboradas. Ainda não existe widget para a tela de bloqueio ou para a tela inicial, nem aplicativo para relógio (isso exige desenvolvimento nativo que esta página não consegue fazer sozinha), mas tudo o que está abaixo já funciona dentro do aplicativo e serve de base.",
      circleHeading: "Seu Inner Circle",
      circleIntro:
        "Quem estiver aqui é quem seu feed do Ambient (e um futuro widget) mostraria. Não é a mesma coisa que as pessoas em quem você se inscreve ou que você segue.",
      momentHeading: "Compartilhar um momento",
      momentIntro:
        "Uma foto e, se quiser, uma legenda. Só aparece para quem tem você no próprio Inner Circle e some depois de 48 horas.",
      feedHeading: "Seu feed do Ambient (prévia)",
      feedIntro:
        "O que você veria do seu Inner Circle. São os mesmos dados que /api/ambient/feed retorna para um futuro widget, mostrados aqui porque ainda não existe nenhum.",
      widgetHeading: "Para um futuro widget",
    },
    circle: {
      spots: "{count} de {max} vagas ocupadas.",
      unnamed: "Sem nome",
      remove: "Remover",
      addFrom: "Adicionar das suas conexões",
      add: "Adicionar",
      empty: "Conecte-se com algumas pessoas primeiro: o Inner Circle só funciona com conexões reais e aceitas.",
      errors: {
        rate_limited: "Muitas alterações de uma vez. Aguarde um momento e tente novamente.",
        not_connected: "Você só pode adicionar alguém com quem tem conexão.",
        limit_reached: "O Inner Circle tem limite de {max} pessoas. Remova alguém primeiro.",
        other: "Algo deu errado. Tente novamente.",
      },
    },
    moment: {
      choosePhoto: "Escolher uma foto",
      caption: "Adicione uma legenda (opcional)",
      sharing: "Compartilhando…",
      active:
        "Seus momentos ativos: aparecem para qualquer pessoa que tenha você no próprio Inner Circle e somem em 48 horas",
      delete: "Excluir",
      errors: {
        type: "Use uma imagem JPEG, PNG ou WebP.",
        not_configured: "Os envios ainda não estão disponíveis. Volte em breve.",
        network: serverUnreachable,
        upload: "Falha no envio. Tente novamente.",
        invalid: "Não foi possível ler esse arquivo. Tente novamente.",
        rate_limited: "Muitos momentos de uma vez. Aguarde um pouco e tente novamente.",
        too_large: "A imagem deve ter no máximo 25 MB.",
        moderation: "Essa foto não está de acordo com nossas diretrizes de conteúdo e não foi salva.",
        server_error: "Algo deu errado ao salvar. Tente novamente.",
        other: "Algo deu errado.",
      },
    },
    feed: {
      empty:
        "Nada do seu Inner Circle por enquanto. Os momentos aparecem aqui (e apareceriam em um futuro widget) por 48 horas depois que alguém compartilha um.",
    },
    token: {
      heading: "Token de acesso do widget",
      intro:
        "Ainda não existe widget para a tela de bloqueio nem aplicativo para relógio: esta é apenas a credencial de que eles precisariam. Mantenha em sigilo: qualquer pessoa com o token pode ler (mas não publicar) os momentos do seu Inner Circle.",
      activeSince: "Ativado: {when}",
      lastUsed: "último uso: {when}",
      copyNow: "Copie agora: ele não será mostrado de novo. Gerar um novo token revoga este.",
      copy: "Copiar",
      copied: "Copiado",
      generate: "Gerar token",
      generateNew: "Gerar novo token",
      revoke: "Revogar",
    },
  },
};
