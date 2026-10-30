import type { FaqItems } from "../ids";

// Portuguese FAQ, part 3: Connecting, messaging and calls; Hidden chats. These answers state what is and isn't
// private: every number, time limit and caveat follows the English in ../page.tsx.
export const pt3 = {
  "message-someone": {
    q: "Como envio uma mensagem para alguém?",
    a: "Primeiro é preciso uma conexão aceita: envie um pedido pelo perfil da pessoa ou pelo Descobrir. Depois de conectados, escreva para ela por Conexões ou inicie uma nova conversa em Mensagens.",
  },
  "reply-specific-message": {
    q: "Como respondo a uma mensagem específica?",
    a: "Deslize uma mensagem para a direita (ou abra o menu «⋯» dela e toque em «Responder», se estiver no computador) para citá-la na sua resposta. A outra pessoa vê exatamente a qual mensagem você está respondendo, o que é útil quando a conversa já passou a tratar de vários assuntos ao mesmo tempo.",
  },
  "forward-message": {
    q: "Posso encaminhar uma mensagem para outra conversa?",
    a: "Sim. Abra o menu «⋯» da mensagem e toque em «Encaminhar», escolha até 5 das suas conversas (pesquise por nome ou @usuário) e toque em «Enviar». Textos, links, fotos, vídeos, GIFs e mensagens de voz podem ser encaminhados. Cada conversa recebe uma cópia como uma nova mensagem sua, com uma pequena etiqueta «Encaminhada»; a etiqueta não diz quem a escreveu nem de qual conversa veio, e as pessoas dessa conversa são notificadas como em qualquer mensagem. A cópia é sua: apagar a original não a remove das outras conversas, e você pode apagar a sua cópia como qualquer mensagem que enviou. Algumas mensagens não podem ser encaminhadas: fotos e vídeos de visualização única, mensagens apagadas, mensagens em análise, respostas a stories e mensagens de uma conversa secreta. Conversas secretas, conversas ocultas e conversas com alguém que você bloqueou (ou que bloqueou você) não aparecem como destino, e nada encaminhado entra em uma conversa secreta. O texto encaminhado, incluindo links, é verificado de novo de acordo com nossas Diretrizes da comunidade antes de ser enviado.",
  },
  "send-photos-videos-voice-notes": {
    q: "Posso enviar fotos, vídeos, mensagens de voz ou GIFs em uma conversa?",
    a: "Sim. A caixa de mensagem da conversa tem os botões «Adicionar uma foto» e «Adicionar um vídeo» (dispositivo, câmera ou gravação na hora), um botão de GIF e um ícone de microfone para gravar uma mensagem de voz. Qualquer mensagem que você enviar pode ser excluída para você, ou para todos se foi você quem enviou.",
  },
  "send-photo-video-disappears-after": {
    q: "Posso enviar uma foto ou um vídeo que desaparece depois de visto?",
    a: "Sim, em conversas entre duas pessoas (não em conversas em grupo). Anexe uma foto ou um vídeo, ative «Visualização única» ao lado do arquivo e envie; ele vai sem legenda, e os vídeos são limitados a 64 MB. A outra pessoa vê o aviso para tocar e ver uma vez, e só pode abrir uma única vez. Quando ela abre, o arquivo é excluído do nosso armazenamento: normalmente no momento em que aparece na tela dela, e em alguns minutos no máximo se o aplicativo dela fechar ou perder a conexão antes. Depois disso, ninguém consegue abrir de novo: nem ela, nem você, nem o YuKon3t. Se nunca for aberto, expira depois de 14 dias, e excluir a mensagem para todos antes de ser aberta também o remove. O que fica é o registro de que uma mensagem de visualização única foi enviada e se foi aberta (e quando); do seu lado, você verá «Aberta».\n\nO que ela não faz: impedir que alguém guarde uma cópia. Capturas e gravações de tela não podem ser impedidas. Nos aplicativos para celular, você é avisado quando uma captura de tela é detectada na conversa, mas uma foto da tela tirada com outro aparelho não pode ser detectada de jeito nenhum. Envie apenas o que você aceitaria que a outra pessoa guardasse. E, como nada é mantido, uma mensagem de visualização única que já foi vista não pode ser analisada pelos nossos moderadores se for denunciada. As fotos (e um quadro de cada vídeo) são verificadas automaticamente no envio, como qualquer outro arquivo enviado, e você ainda pode denunciar e bloquear quem enviou.",
  },
  "see-photo-chat-full-screen": {
    q: "Posso ver uma foto de uma conversa em tela cheia?",
    a: "Sim. Toque em qualquer foto de uma mensagem para abri-la em tela cheia, no mesmo visualizador usado para as imagens das publicações (faça o gesto de pinça ou role para dar zoom; toque fora ou no X para fechar).",
  },
  "when-open-chat-jump-straight": {
    q: "Quando abro uma conversa, ela vai direto para a mensagem mais recente?",
    a: "Sim. Abrir uma conversa, ou mudar para outra, deixa você na mensagem mais recente, e a tela continua acompanhando as novas que chegam enquanto você está naquela conversa. A caixa de mensagem também já começa preenchida com a última mensagem da conversa, enviada ou recebida, para ser rápido responder a ela ou reenviar a mesma coisa.",
  },
  "voice-video-calls-work": {
    q: "Como funcionam as chamadas de voz e de vídeo?",
    a: "Toque no ícone de telefone ou de vídeo no perfil de uma conexão ou na sua conversa com ela. O celular dela toca (com o toque que você escolheu; escolha um em Configurações → «Chamadas») e ela pode aceitar ou recusar. Ao aceitar, vocês entram na chamada na hora, mesmo que o celular dela estivesse bloqueado ou o aplicativo em segundo plano quando tocou.",
  },
  "add-more-people-call": {
    q: "Posso adicionar mais pessoas a uma chamada?",
    a: "Sim. Com a chamada já conectada, toque no ícone de adicionar pessoa ao lado do botão de desligar e escolha uma das suas conexões. Ela recebe uma chamada normal e entra na mesma chamada quando aceita; enquanto não atende, você vê «Chamando …» no topo da chamada. Qualquer pessoa na chamada pode adicionar uma das próprias conexões, até 8 pessoas no total. Alguém que já está em outra chamada, ou que tem um bloqueio com qualquer pessoa da chamada, não pode ser adicionado. Quando uma pessoa desliga, só ela sai e a chamada continua para as demais; ela termina quando resta apenas uma pessoa. Se o seu celular mostrar a tela de chamada do sistema, essa tela mostra só o nome de quem adicionou você.",
  },
  "put-call-hold": {
    q: "Posso colocar uma chamada em espera?",
    a: "Sim. Toque no ícone de pausa nos controles da chamada para colocar em espera uma chamada de voz ou de vídeo. Isso pausa seu microfone e sua câmera e faz você parar de ouvir a outra pessoa, que verá que você colocou a chamada em espera. Toque no mesmo botão (agora um ícone de reproduzir) para retomar: seu microfone e sua câmera voltam exatamente como estavam antes de você colocar a chamada em espera.",
  },
  "live-translated-captions-call": {
    q: "Posso ter legendas traduzidas ao vivo durante uma chamada?",
    a: "Sim, numa chamada de voz ou de vídeo entre duas pessoas. Toque no botão de legendas nos controles da chamada. Antes de qualquer coisa começar, você vê o que acontece: o que você fala é enviado a um serviço de IA (OpenAI) para virar texto e ser traduzido. O YuKon3t não guarda o áudio nem o texto; a OpenAI pode manter o que processa por um tempo limitado, conforme os próprios termos. Depois, a outra pessoa é consultada para permitir, e as legendas só começam quando vocês dois concordam. Enquanto estão ativadas, vocês continuam ouvindo a voz real um do outro, cada um vê legendas do que o outro diz no idioma em que usa o YuKon3t (inglês, espanhol, francês, português ou árabe) e aparece «Legendas ao vivo ativadas» no alto das duas telas; «Ver original» mostra as palavras como foram ditas. Qualquer um de vocês pode desativá-las a qualquer momento com o mesmo botão, o que as desliga para os dois ao mesmo tempo; na próxima chamada elas voltam desativadas, e se desativam sozinhas depois de uma hora. Seu microfone só é legendado enquanto está ligado: silenciá-lo ou colocar a chamada em espera pausa as legendas. Cada pessoa tem 120 minutos por mês de legendas da própria fala. As legendas não estão disponíveis em chamadas com mais de duas pessoas, podem atrasar um ou dois segundos e ter erros, principalmente em idiomas que o serviço reconhece pior (por exemplo, iorubá).",
  },
  "happens-call-switch-apps-lock": {
    q: "O que acontece com uma chamada se eu trocar de aplicativo ou bloquear o celular?",
    a: "No aplicativo do YuKon3t para Android ou iPhone, a chamada continua: você e a outra pessoa podem seguir conversando com o aplicativo em segundo plano ou com a tela bloqueada. Sua câmera pausa enquanto você está fora (os celulares não deixam um aplicativo em segundo plano continuar filmando), então, em uma chamada de vídeo, a outra pessoa vê um aviso de que sua câmera está pausada, e seu vídeo volta quando você retorna ao aplicativo. No navegador de um celular é diferente: o navegador suspende a página assim que você sai dela, então ali uma chamada não consegue continuar em segundo plano. A outra pessoa verá que sua conexão caiu, e a chamada termina se você não voltar em cerca de um minuto e meio. Para chamadas em que você precisa se afastar, use o aplicativo.",
  },
  "happens-connection-drops-during-call": {
    q: "O que acontece se minha conexão cair durante uma chamada?",
    a: "A chamada não é encerrada na hora. Você verá «Reconectando…» enquanto o YuKon3t tenta trazer você de volta, por até cerca de um minuto. É útil em um elevador, em um túnel ou ao trocar do Wi-Fi para os dados móveis. Enquanto isso, a outra pessoa vê que sua conexão caiu e é orientada a aguardar. Se não for possível reconectar você nesse tempo, a chamada termina para os dois, e qualquer um pode simplesmente ligar de novo.",
  },
  "there-limit-long-call-last": {
    q: "Há um limite para a duração de uma chamada?",
    a: "Uma mesma chamada de voz ou de vídeo pode durar até 12 horas. Depois disso ela termina automaticamente, e você pode iniciar outra logo em seguida.",
  },
  "hear-ringing-sound-when-call": {
    q: "Por que ouço um som de chamada quando ligo para alguém?",
    a: "É o tom de chamada, para você saber que a ligação está de fato sendo completada enquanto espera a pessoa atender. Ele para assim que ela atende ou recusa, ou quando você cancela.",
  },
  "says-already-have-call-someone": {
    q: "Aparece que já tenho uma chamada com alguém e não consigo ligar de novo. O que faço?",
    a: "Isso acontece quando uma chamada anterior para aquela pessoa ainda está marcada como tocando ou ativa (por exemplo, se uma chamada foi interrompida). Você verá uma janela oferecendo cancelar essa chamada travada e fazer uma nova imediatamente: toque em «Cancelar e ligar de novo».",
  },
  "group-chats-work": {
    q: "Como funcionam as conversas em grupo?",
    a: "Crie uma em Mensagens → «Novo grupo»: escolha um nome e pelo menos 2 das suas conexões. Grupos públicos também podem ser encontrados em «Descobrir grupos»: busque pelo nome e peça para entrar. Se você criou um grupo, abra-o e use «Adicionar membros» a qualquer momento para trazer mais conexões suas. Qualquer membro pode tocar em «Sair do grupo» para sair por conta própria (se quem criou o grupo sair, a propriedade passa para o próximo membro). Quem criou também tem a opção «Excluir grupo», que remove o grupo inteiro, com mensagens e tudo, para todos de uma vez, quando ele não for mais necessário. Os administradores do YuKon3t também podem excluir um grupo diretamente (por spam, duplicidade ou violação das Diretrizes), mesmo que nunca tenham entrado nele.",
  },
  "typed-message-but-didnt-send": {
    q: "Digitei uma mensagem, mas não enviei. Ela se perde se eu sair da conversa?",
    a: "Não. Tudo o que você digitou e não enviou é salvo como rascunho no seu dispositivo no momento em que você digita. Mude para outra conversa, feche o aplicativo ou recarregue a página, e o texto ainda estará na caixa de mensagem quando você voltar àquela conversa. Ele só some quando você realmente envia (ou apaga o texto por conta própria).",
  },
  "secret-chats": {
    q: "O que são conversas secretas?",
    a: "Uma conversa secreta é uma conversa entre duas pessoas em que o texto das suas mensagens é criptografado de ponta a ponta: ele é trancado no seu celular e só é destrancado no da outra pessoa, de modo que nem os servidores do YuKon3t conseguem lê-lo. Os dois precisam ativar (abra a conversa, toque no ⋯ no topo e escolha «Privacidade da conversa»), e na primeira vez você escolhe uma frase de recuperação. Funciona apenas em conversas entre duas pessoas, não em conversas em grupo. Vale saber: só o *texto* das mensagens é criptografado. Fotos, vídeos, mensagens de voz e GIFs continuam sendo enviados e verificados como em qualquer outro lugar, e as mensagens enviadas antes de os dois ativarem não estavam criptografadas. Publicações, Muses, stories, o que você compartilha de outros aplicativos e mensagens encaminhadas nunca entram em uma conversa secreta (não podem ser criptografados no seu celular), por isso as conversas secretas não aparecem quando você compartilha ou encaminha; para enviar um link para lá, cole-o você mesmo na conversa. Depois de ativada, nada na tela marca a conversa como secreta: não há rótulo nem cadeado na conversa nem na sua lista de mensagens, e as notificações dizem apenas «Nova mensagem». O mesmo menu «Privacidade da conversa» está em todas as conversas entre duas pessoas, e é nele que você confere se está ativada, verifica o código ou desativa. (Sua lista de mensagens mostra «Mensagem» no lugar do texto, porque não conseguimos lê-lo para mostrar uma prévia.) As conversas secretas não têm sigilo futuro (forward secrecy): sua chave continua a mesma, então alguém que tivesse acesso ao seu celular desbloqueado poderia ler o histórico salvo daquela conversa. E, como somos nós que entregamos a cada um a chave pública do outro, abra «Privacidade da conversa», toque em «Verificar código» e compare o código de segurança com a outra pessoa, pessoalmente ou em uma chamada: se ele for igual nos dois celulares, ninguém trocou uma chave no caminho e a conversa é privada até mesmo em relação a nós.",
  },
  "forget-recovery-passphrase-lose-phone": {
    q: "E se eu esquecer minha frase de recuperação ou perder meu celular?",
    a: "Sua frase de recuperação tranca um backup da sua chave, que nós guardamos mas não conseguimos ler. Em um celular novo, digite-a para destrancar suas conversas secretas antigas. Se você a esquecer *e* perder o celular, não conseguimos recuperar suas mensagens secretas: é o preço de uma criptografia que nós não conseguimos abrir. Você pode recomeçar com chaves novas, mas aí as mensagens secretas enviadas com a chave antiga nunca mais poderão ser lidas, nem por você nem pela outra pessoa, e suas conversas secretas ficam desativadas até os dois ativarem de novo.",
  },
  "moderators-read-secret-chats-report": {
    q: "Os moderadores conseguem ler conversas secretas? Como denuncio um abuso em uma?",
    a: "Não. Como não conseguimos ler conversas secretas, não analisamos o texto delas em busca de violações das nossas políticas, como fazemos com as mensagens comuns, e os administradores não conseguem abri-las. Nossas regras continuam valendo ali. Se alguém enviar algo abusivo, toque no ⋯ daquela mensagem e escolha «Denunciar»: o aplicativo avisa antes que isso compartilha o texto daquela única mensagem com nossos moderadores, para que possam analisá-la. Não temos como verificar isso de forma independente, então uma denúncia contém apenas o que você decide enviar. Fotos e vídeos em conversas secretas continuam sendo verificados. Você pode desativar a conversa secreta a qualquer momento em «Privacidade da conversa»; a partir daí, as novas mensagens voltam a ser analisadas.",
  },

  "hiding-chat": {
    q: "O que acontece ao ocultar uma conversa?",
    a: "Abra uma conversa, toque no ⋯ no topo e escolha «Ocultar conversa». Na primeira vez, você escolhe um PIN de 4 a 8 dígitos. A conversa então sai da sua lista de Mensagens, deixa de contar nos indicadores de não lidas e no sino de notificações, e não é mais oferecida quando você compartilha algo. Em uma conversa entre duas pessoas, a outra pessoa também some da sua lista de Conexões e dos seletores para criar um grupo, fazer uma chamada ou enviar um convite. Conversas em grupo também podem ser ocultadas. Uma nova mensagem em uma conversa oculta ainda chega até você, mas a notificação diz apenas «Você tem uma nova notificação», sem nome e sem prévia, e abre a tela Início. Uma chamada recebida de alguém cuja conversa você ocultou aparece como «Chamada privada».",
  },
  "open-hidden-chat-unhide-one": {
    q: "Como abro uma conversa oculta e como deixo de ocultá-la?",
    a: "Toque e segure a palavra «Mensagens» no topo da sua tela de Mensagens, ou vá em Configurações, «Privacidade», «Conversas ocultas». Digite seu PIN e suas conversas ocultas são listadas. Essas duas entradas estão sempre ali para todo mundo, então não mostram se você ocultou alguma coisa. A área volta a ser bloqueada sozinha depois de cerca de 10 minutos, assim que você sai do aplicativo ou troca de aba com uma conversa oculta na tela, quando você toca em «Bloquear agora» e quando você sai da conta. Para deixar de ocultar, abra a conversa, toque em ⋯ e escolha «Deixar de ocultar a conversa».",
  },
  "other-person-know-hid-our": {
    q: "A outra pessoa sabe que ocultei nossa conversa?",
    a: "Não. Ocultar acontece só do seu lado. Ela não é avisada, nada muda do lado dela, e as mensagens e chamadas dela são entregues normalmente. Ela continua vendo você nas listas dela.",
  },
  "forgot-pin-happens-hidden-chats": {
    q: "Esqueci meu PIN. O que acontece com minhas conversas ocultas?",
    a: "Na tela do PIN, toque em «Esqueceu o PIN?» e confirme que é você com a senha da sua conta. Se a sua conta não tem senha (você entra com um link por e-mail, com o Google ou com a Apple), enviamos um código por e-mail. Depois, escolha um novo PIN. Suas conversas continuam ocultas e nada do que há nelas se perde. Depois de 5 PINs errados seguidos, você precisa esperar 15 minutos, e mais tempo a cada vez que isso se repete.",
  },
  "doesnt-hiding-chat": {
    q: "O que ocultar uma conversa não faz?",
    a: "Oculta a conversa na sua conta; não a criptografa. As mensagens são armazenadas como as de qualquer outra conversa, e nossa moderação continua valendo. Se você quer um texto que nem nós conseguimos ler, é para isso que serve «Privacidade da conversa» (as conversas secretas), e você pode usar as duas coisas na mesma conversa. As notificações que já estavam no seu celular antes de você ocultar a conversa não são retiradas, então limpe-as você mesmo. A pessoa continua aparecendo em lugares públicos: a busca, o Descobrir, o perfil dela e as publicações, os comentários e as curtidas dela. Tocar em «Mensagem» no perfil dela pede o seu PIN. E qualquer pessoa que saiba seu PIN e esteja com seu celular desbloqueado pode abrir a área oculta.",
  },
} satisfies Partial<FaqItems>;
