import type { FaqItems } from "../ids";

// Portuguese FAQ, part 1: Getting around, The Android app, Posts and media. Conventions as in src/lib/i18n/pt:
// Brazilian Portuguese, "você"; names of buttons and screens exactly as the app shows them, in «»; product names
// (YuKon3t, Circles, Collab Boards, Muse) as they are.
export const pt1 = {
  "who-join-yukon3t": {
    q: "Quem pode entrar no YuKon3t?",
    a: "Qualquer pessoa com 16 anos ou mais. Pedimos sua data de nascimento no cadastro. Se você tem 16 ou 17 anos, só pode usar o YuKon3t com o envolvimento e o consentimento de um dos seus pais ou do seu responsável legal.",
  },
  "where-find-everything": {
    q: "Onde encontro cada coisa?",
    a: "No computador, a barra superior tem links para «Início», «Descobrir», «Circles», «Collab Boards», «Muse», «Conexões», «Mensagens» e seu «Perfil». No celular, as seis seções mais usadas («Início», «Circles», «Collab», «Muse», «Mensagens», «Perfil») ficam em uma barra de abas na parte de baixo, e «Conexões» é o ícone de pessoa na barra superior. Toque no menu ☰, no canto superior direito, para acessar «Descobrir», «Convidar amigos», «Configurações» e, para administradores, as ferramentas de moderação.",
  },
  "swipe-between-tabs-instead-tapping": {
    q: "Posso deslizar para trocar de aba em vez de tocar?",
    a: "Sim, no celular: deslize para a direita em qualquer lugar da tela para avançar por Início → Circles → Collab → Muse → Mensagens → Perfil, e daí de volta para Início. Deslize para a esquerda para percorrer as mesmas abas no sentido contrário, dando a volta pelo outro lado.",
  },
  "difference-between-home-discover-connections": {
    q: "Qual é a diferença entre Início, Descobrir e Conexões?",
    a: "**Início** é o seu feed: publicações das suas conexões e de todas as pessoas que publicam em modo público, incluindo publicações de Circles públicos. As publicações de um Circle privado ficam naquele Circle e nunca aparecem aqui. **Descobrir** serve para encontrar pessoas novas por país, idioma ou interesse. **Conexões** é a lista das suas conexões aceitas, além dos pedidos pendentes que você enviou ou recebeu.",
  },
  "switch-between-light-dark-mode": {
    q: "Como alterno entre o modo claro e o escuro?",
    a: "Use o seletor de tema ao lado de «Configurações» na barra superior (ou no menu ☰ no celular). Por padrão ele acompanha o seu dispositivo, mas você pode fixá-lo em claro ou escuro.",
  },
  "yukon3t-work-iphones-accessibility-settings": {
    q: "O YuKon3t funciona com os ajustes de acessibilidade do meu iPhone?",
    a: "Sim. O aplicativo para iPhone funciona com o Controle por Voz e acompanha o tamanho de texto do seu iPhone: aumente-o em Ajustes → Acessibilidade → Tela e Tamanho do Texto → Texto Maior, e o texto do YuKon3t cresce junto, até um pouco mais do que o dobro do tamanho normal. A barra superior e a barra de abas inferior crescem só um pouco, para que todos os ícones e abas continuem cabendo na tela. O aplicativo também respeita Reduzir Movimento, e o modo escuro acompanha o seu dispositivo, a menos que você mesmo o fixe.",
  },
  "megaphone-icon-next-bell": {
    q: "O que é o ícone de megafone ao lado do sino?",
    a: "É «Novidades»: toque nele para ver a lista, sempre atualizada, dos novos recursos e melhorias que lançamos. Ele acende quando há algo que você ainda não viu, e uma notificação de verdade é enviada ao seu celular assim que uma novidade é publicada, para você não precisar lembrar de conferir.",
  },
  "search-app": {
    q: "Como faço uma busca no aplicativo?",
    a: "Toque no ícone de lupa ao lado do sino de notificações. Uma única caixa de busca cobre pessoas, Circles, conversas em grupo e colaborações de uma vez. Filtre os resultados por mais relevantes, mais recentes, mais antigos, «atualidades» (com atividade nas últimas duas semanas) ou um país específico.",
  },
  "click-someones-name-almost-everywhere": {
    q: "Por que posso clicar no nome de alguém em quase todo lugar?",
    a: "Qualquer nome ou foto de perfil que você vê (em uma conversa, um comentário, uma lista de conexões, a lista de membros de um Circle e assim por diante) leva direto ao perfil daquela pessoa. É o mesmo comportamento em todo lugar de propósito, para você nunca precisar procurar um botão «ver perfil».",
  },
  "some-people-disappear-from-discover": {
    q: "Por que algumas pessoas somem do Descobrir?",
    a: "O Descobrir só mostra pessoas com quem você ainda não teve nenhuma interação de conexão: assim que você envia ou recebe um pedido de conexão, a pessoa sai dos resultados do Descobrir (esteja o pedido pendente ou já aceito). Se um pedido for recusado, essa pessoa pode voltar a aparecer no Descobrir para uma nova tentativa.",
  },
  "new-member-alerts": {
    q: "Por que recebi uma notificação de que alguém acabou de entrar no YuKon3t?",
    a: "Quando alguém novo termina de configurar o perfil e já verificou a conta, o YuKon3t avisa quem usa Descobrir, para que os recém-chegados encontrem pessoas com quem se conectar. Só são anunciadas as pessoas que aparecem em Descobrir: não quem desativou “Mostrar meu perfil em Descobrir”, não quem deixa as publicações visíveis só para as conexões, e nunca alguém que você bloqueou ou que bloqueou você. Cada pessoa é anunciada uma única vez, pouco depois de entrar. Seu celular recebe no máximo um desses avisos a cada 12 horas; quando mais pessoas entram, suas notificações as agrupam em uma única entrada (“Ada e mais 3 pessoas acabaram de entrar no YuKon3t”) que abre Descobrir com as pessoas mais novas primeiro. Para parar de recebê-los, desmarque Novos membros em Configurações → Notificações. Para não ser anunciado quando entrar, desative “Mostrar meu perfil em Descobrir” em Configurações → Privacidade logo depois de se cadastrar.",
  },
  "home-split-into-sections-like": {
    q: "Por que o Início é dividido em seções como Trabalho, Entretenimento, Política e Esportes?",
    a: "As publicações são agrupadas pela seção do feed que o autor escolheu no editor (por padrão, Geral), para facilitar a navegação pelo que interessa a você. Enquanto você está na página, cada seção adiciona as publicações novas no topo automaticamente, em geral em poucos segundos e em cerca de meio minuto quando muita coisa é publicada ao mesmo tempo. Não é preciso atualizar.",
  },
  "update-the-app": {
    q: "Como atualizo o aplicativo e por que pedem que eu atualize?",
    a: "A maioria das melhorias chega até você sozinha: o aplicativo carrega a versão mais recente do YuKon3t toda vez que você o abre. Algumas mudanças, porém, precisam de uma nova versão do próprio aplicativo no Google Play ou na App Store e, quando ela sai, você pode ver um aviso de \"Atualização disponível\": toque em **Atualizar** para abrir a loja e depois toque em Atualizar lá. \"Agora não\" esconde o aviso por 3 dias. Raramente, quando uma versão antiga não consegue mais funcionar direito, aparece uma tela de \"Atualização necessária\"; por ela você ainda pode abrir estas perguntas frequentes ou sair da conta, e tudo volta a funcionar assim que você atualiza. Você também pode atualizar quando quiser: abra o Google Play ou a App Store, procure por YuKon3t e toque em Atualizar. Para enviar esses avisos, a versão e o número de build do aplicativo e a plataforma do seu celular (Android ou iPhone) ficam guardados junto com o token de notificações push dele.",
  },
  "slow-connection-data-saver": {
    q: "O YuKon3t funciona com uma conexão lenta ou instável?",
    a: "Sim. Quando sua conexão está lenta (3G, 4G ou 5G com sinal fraco, Wi-Fi congestionado) ou a economia de dados do celular está ativada, o YuKon3t se adapta sozinho: os vídeos do feed esperam você tocar em reproduzir em vez de começar enquanto você rola, o Muse só carrega o vídeo que você está vendo, o feed carrega menos publicações por vez e a sessão não é gravada para estatísticas. Você também pode escolher em Configurações → **«Economia de dados»**: «Automático» (o padrão), «Ativada» ou «Desativada». A configuração fica salva só naquele dispositivo.\n\nSe algo não carregar, o YuKon3t tenta de novo sozinho e mostra um pequeno aviso «Conexão lenta. Tentando de novo…» enquanto isso. Sem conexão, aparece um aviso, e o que não carregou continua assim que você volta a ficar online. Algumas coisas fogem do controle do YuKon3t e podem continuar lentas: o sinal da sua operadora, vídeos incorporados de outros sites e a qualidade de uma chamada numa conexão muito fraca (as chamadas ajustam a própria qualidade de vídeo à conexão).",
  },

  "app-opens-chrome-instead-full": {
    q: "O aplicativo abre no Chrome em vez de em tela cheia. Como resolvo isso?",
    a: "É um ajuste do Android feito uma única vez, não um erro. No celular, vá em Configurações → Apps → YuKon3t → «Abrir por padrão» (algumas versões do Android chamam isso de «Definir como padrão» ou «Links compatíveis») e confira se `yukon3t.com` está ativado em «Endereços da Web compatíveis». O Android deixa isso desativado por padrão como controle de privacidade e o aplicativo não consegue ativar por você, então é um passo manual, feito uma única vez depois da instalação.",
  },
  "still-get-calls-phone-asleep": {
    q: "Vou continuar recebendo chamadas se o celular estiver em repouso ou bloqueado?",
    a: "Sim. Uma chamada recebida toca e acende a tela por cima da tela de bloqueio mesmo com o celular em repouso ou em modo de economia de bateria (Doze), como uma ligação comum. Aceite ou recuse direto nessa tela, ou toque nela para abrir o aplicativo. Para isso, a permissão de notificações do YuKon3t precisa estar ativada (o Android pede isso na primeira vez que você entra). Se as chamadas não estiverem acordando o celular, confira Configurações → Apps → YuKon3t → Notificações.",
  },
  "shows-up-notification-phone": {
    q: "O que aparece como notificação no meu celular?",
    a: "Chamadas recebidas, chamadas perdidas (com o nome de quem ligou), mensagens (inclusive respostas ao seu story), curtidas, comentários, compartilhamentos e recompartilhamentos das suas publicações e dos seus vídeos do Muse, pedidos de conexão, lembretes de eventos, alguém iniciando uma transmissão ao vivo só com você, uma sessão recorrente de colaboração prestes a começar e avisos gerais sobre novos recursos. Tudo isso chega como notificações de verdade do Android mesmo com o aplicativo fechado, e não apenas no ícone de sino dentro do aplicativo. Tocar em uma (ou em uma notificação da lista dentro do aplicativo) abre exatamente aquilo de que ela trata: a publicação, o Muse, o story, a conversa, o evento, o Circle, a transmissão ao vivo, a colaboração ou a lista de Conexões (numa chamada perdida, o perfil de quem ligou), mesmo que o aplicativo estivesse em segundo plano ou recarregue numa versão mais nova ao abrir. Se isso tiver sido excluído depois, ou estiver num Circle privado do qual você não faz mais parte, aparece uma página de «não encontrado». Abrir o aplicativo (por uma notificação, pelo ícone ou voltando de outro aplicativo) limpa automaticamente todas as notificações desse tipo da sua área de notificações. A única exceção é uma chamada tocando ou perdida, que fica ali até você resolver a chamada. A lista de notificações dentro do aplicativo funciona de outro jeito: uma notificação é marcada como lida quando você a abre pela lista, quando toca na notificação do celular ou quando abre aquilo de que ela trata (a conversa, a publicação, o Muse, o Circle e assim por diante). As demais continuam não lidas, e o indicador vermelho do sino continua contando, até lá ou até você tocar em «Marcar tudo como lido».",
  },
  "turning-up-phones-volume-unmutes": {
    q: "Aumentar o volume do celular ativa o som de um vídeo do meu feed. É para ser assim?",
    a: "Sim, é intencional. Os vídeos do feed compartilham uma única configuração de som no aplicativo inteiro (toque no ícone de alto-falante de qualquer vídeo ou aumente o volume do celular): ativar o som vale para todos os vídeos do seu feed, inclusive os que você rolar depois, como acontece no feed do Instagram.",
  },

  post: {
    q: "O que posso publicar?",
    a: "Texto, fotos e vídeos do seu dispositivo ou da câmera, uma imagem obtida de uma URL ou um link incorporado do YouTube/Vimeo. Toque nos ícones de câmera e de foto no editor: cada um abre um pequeno menu com dispositivo, câmera ou link, então há um botão para fotos e outro para vídeos, em vez de uma fileira de botões separados.",
  },
  "which-video-formats-upload-everyone": {
    q: "Quais formatos de vídeo posso enviar? Todo mundo consegue assistir?",
    a: "MP4, WebM e QuickTime (.mov, o que um iPhone grava), com até 2 GB. Um .mov é recodificado em segundo plano para um MP4 padrão, para tocar em todos os navegadores, não só no Safari. Isso costuma levar alguns minutos e, até terminar, o original toca para quem usa um navegador compatível. Se um vídeo não puder ser convertido, o original fica como está.",
  },
  "was-photo-video-rejected": {
    q: "Por que minha foto ou meu vídeo foi rejeitado?",
    a: "Todo envio passa por uma verificação automática antes de ficar visível para qualquer outra pessoa. Conteúdo que viola nossas [Diretrizes da comunidade](/legal/guidelines) (mais comumente, material sexualmente explícito) é rejeitado e nunca é publicado.",
  },
  "delete-post-report-someone-elses": {
    q: "Como excluo uma publicação ou denuncio a de outra pessoa?",
    a: "Abra o menu «⋯» de qualquer publicação para excluir (as suas) ou denunciar (a de qualquer pessoa). As denúncias vão para nossa fila de moderação e são analisadas; em qualquer um dos resultados, o motivo é informado.",
  },
  "share-post": {
    q: "Como compartilho uma publicação?",
    a: "Toque no ícone de compartilhar de qualquer publicação para abrir um menu: copiar o link, compartilhar pelo menu de compartilhamento do seu dispositivo, adicionar ao seu story, compartilhar no Muse (apenas publicações com vídeo de até 5 minutos), enviar direto para um amigo como mensagem ou compartilhar em um Circle. O compartilhamento pelo dispositivo anexa a própria foto ou o próprio vídeo quando possível (não só um link), com um pequeno logo do yukon3t, para que aplicativos como o WhatsApp ou o Mensagens mostrem a publicação de verdade, com a marca de onde ela veio. Em “Enviar para um amigo”, você pode marcar até 5 conversas e enviar para todas de uma vez; o mesmo vale ao compartilhar um Muse, um story ou algo compartilhado de outro aplicativo.",
  },
  "share-photo-video-from-another": {
    q: "Posso compartilhar uma foto ou um vídeo de outro aplicativo (Instagram, TikTok, WhatsApp etc.) direto no YuKon3t?",
    a: "Sim: no menu de compartilhamento do outro aplicativo, escolha o YuKon3t como destino. Uma pequena janela abre na hora com uma prévia e permite adicionar ao seu story, publicar no Muse, publicar no seu feed do Início ou enviar para um amigo. Escolha uma opção e o conteúdo é publicado imediatamente (depois de passar pela mesma verificação automática de conteúdo de todo envio), sem toques extras nem precisar ir ao editor separadamente. Funciona melhor quando o outro aplicativo entrega o arquivo real da foto ou do vídeo. A ação de compartilhar de alguns aplicativos envia apenas um link para a publicação deles (é uma escolha de cada aplicativo, não algo que o YuKon3t controla; o Instagram e o TikTok, entre outros, em geral só entregam o arquivo a alguns aplicativos parceiros). Quando isso acontece e o link é de uma plataforma de vídeo reconhecida (YouTube, Vimeo, TikTok, Instagram, Facebook, Dailymotion), o YuKon3t ainda oferece story, Muse e feed: o vídeo de verdade toca ali mesmo, do mesmo jeito que colar um desses links direto no editor do feed, só que moderado por aquela plataforma, e não pelo YuKon3t. Para qualquer outro link, o YuKon3t avisa você, e ainda dá para enviar a um amigo pela mesma janela. Por enquanto, só no Android.",
  },
  "react-post-something-other-than": {
    q: "Posso reagir a uma publicação com algo além de um coração?",
    a: "Sim. O ícone de carinha ao lado do coração em qualquer publicação (ou em uma mensagem) abre primeiro uma fileira rápida de reações comuns, além de um «+» para abrir o seletor completo de emojis, se você quiser outra coisa. Escolher o mesmo emoji de novo o remove, e escolher outro o substitui. Isso é separado do botão de coração/Curtir, então você pode curtir uma publicação e adicionar uma reação com emoji ao mesmo tempo. O seletor completo (em publicações, comentários e conversas) também entende termos de busca informais e que não estão em inglês: digitar «pray», «amen»/«ameen»/«aameen» ou «sad» mostra uma pequena fileira «Sugeridos» com emojis relacionados, acima dos resultados normais.",
  },
  "change-emoji-look-throughout-app": {
    q: "Posso mudar a aparência dos emojis no aplicativo inteiro?",
    a: "Sim. Em Configurações → «Estilo dos emojis», escolha entre a renderização nativa, da Apple, do Google, do Facebook ou do Twitter/X. O que você escolher vale em todo lugar onde aparecem emojis: reações, o seletor e as mensagens.",
  },
  "send-gif": {
    q: "Posso enviar um GIF?",
    a: "Sim. O botão de GIF (ao lado do botão de emojis) no editor de publicações, em uma conversa ou em uma caixa de comentário abre uma busca. Escolha um para anexar, do mesmo jeito que você anexaria uma foto.",
  },
  "videos-feed-play-automatically-no": {
    q: "Por que os vídeos do meu feed tocam sozinhos e sem som?",
    a: "Os vídeos do feed tocam automaticamente sem som quando você chega até eles ao rolar e pausam quando você passa. Toque no ícone de alto-falante do vídeo para ativar o som (veja «Aumentar o volume do celular ativa o som de um vídeo do meu feed», acima) ou toque no próprio vídeo para pausar ou retomar.",
  },
  "zoom-back-out-photo-without": {
    q: "Como tiro o zoom de uma foto sem fechar o visualizador?",
    a: "Toque uma vez na foto ampliada (um toque simples, não duplo) para ela voltar ao tamanho original. O toque duplo continua ampliando e reduzindo como sempre; isso só acrescenta um jeito mais rápido de voltar ao tamanho normal sem sair do visualizador.",
  },
  "dictate-post": {
    q: "Posso ditar uma publicação em vez de digitar?",
    a: "Sim. Toque no ícone de microfone no editor de publicações (ou na caixa de mensagem de uma conversa) para gravar um áudio curto; ele é transcrito e colocado na caixa de texto para você revisar e editar antes de publicar ou enviar. Isso é diferente do botão redondo de microfone/enviar de uma conversa, que envia a própria gravação como mensagem de voz: o microfone de ditado fica ao lado do botão de emojis e sempre gera texto editável. Fale no seu idioma: espanhol, francês, português, árabe e muitos outros são reconhecidos automaticamente, seja qual for o idioma em que o aplicativo é exibido.",
  },
  "difference-between-connect-subscribe": {
    q: "Qual é a diferença entre Conectar e Inscrever-se?",
    a: "**Conectar** é o pedido mútuo de sempre: você escolhe por que quer se conectar (amizade, intercâmbio cultural, profissional, comunidade ou dicas de viagem), a outra pessoa precisa aceitar, e isso libera mensagens e chamadas entre vocês. **Inscrever-se** é de mão única e não precisa de aprovação: ao se inscrever em alguém, você recebe uma notificação sempre que essa pessoa publica, adiciona um story, republica algo, transmite ao vivo, confirma presença em um evento, envia um Muse, inicia uma colaboração ou cria um Circle ou entra em um. Você pode se inscrever em alguém sem ter conexão com essa pessoa, e vice-versa. A exceção é que aceitar um pedido de conexão inscreve automaticamente cada um no outro, então você não precisa também se inscrever em alguém com quem já tem conexão. Depois, você ainda pode cancelar a inscrição sem afetar a conexão em si. Os dois ícones ficam ao lado do ícone de compartilhar em toda publicação que você vê: no Início, no feed de um Circle, nos resultados da busca e nos anúncios do Collab Boards. As publicações de um Circle público notificam seus inscritos e suas conexões como qualquer publicação pública. As de um Circle privado são só para os membros, então não notificam ninguém de fora e não podem ser republicadas nem compartilhadas para fora.",
  },
  "see-who-im-subscribed-whos": {
    q: "Como vejo em quem estou inscrito ou quem está inscrito em mim?",
    a: "Abra o perfil de qualquer pessoa, inclusive o seu, e toque no número de inscritos ou de inscrições perto do nome para ver a lista completa. Você pode se inscrever em qualquer pessoa ou cancelar a inscrição direto por essas listas, não só por uma publicação.",
  },
  "people-you-may-know-discover": {
    q: "O que é «Pessoas que você talvez conheça» no Descobrir?",
    a: "Uma fileira de sugestões perto do topo do Descobrir, ordenada por conexões em comum: pessoas com quem você ainda não tem conexão e que compartilham conexões com você, com a contagem de quantas. São apenas sugestões: aparecer ali não notifica ninguém nem faz nada por si só; é só um jeito mais rápido de achar pessoas que você provavelmente já conhece do que filtrar a lista inteira do Descobrir. Só aparece quando você tem pelo menos uma conexão.",
  },
  "long-post-get-cut-off": {
    q: "Por que uma publicação longa é cortada com um link «Ver mais»?",
    a: "Publicações acima de certo tamanho são encurtadas nos feeds para que uma única publicação longa não empurre todo o resto para baixo. Toque em «Ver mais» para ler o restante ali mesmo e em «Ver menos» para recolher de novo. Isso vale em todo lugar onde publicações são listadas, e também para o texto próprio de uma republicação. Não há um limite relevante para o tamanho de uma publicação: escreva o quanto precisar, e quem lê sempre pode expandir.",
  },
  "got-message-saying-new-version": {
    q: "Ao publicar, apareceu uma mensagem dizendo que há uma nova versão do aplicativo e que é preciso atualizar a página para continuar.",
    a: "Isso aparece quando sua aba estava aberta desde antes de lançarmos uma atualização. Não é um problema de conexão, só uma página desatualizada. Atualize a página e tente de novo: nada do que você ia publicar se perde ao tentar novamente.",
  },
  "there-way-see-older-posts": {
    q: "Dá para ver publicações mais antigas em um perfil, em um Circle ou nos resultados da busca?",
    a: "Sim. Em todo o YuKon3t, os itens mais antigos carregam automaticamente conforme você rola, seja no **Início**, nas publicações de um perfil, no feed de um canal de um Circle, nos resultados da busca, em Conexões ou nas listas de inscritos e inscrições. Não há nada para tocar. (À parte, o Início adiciona as publicações recém-feitas no topo automaticamente, em geral poucos segundos depois de publicadas; isso é diferente de carregar o que está mais para trás no feed.)",
  },
} satisfies Partial<FaqItems>;
