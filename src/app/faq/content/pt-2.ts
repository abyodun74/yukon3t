import type { FaqItems } from "../ids";

// Portuguese FAQ, part 2: Going Live, Stories, Muse, Ambient.
export const pt2 = {
  "start-join-live-stream": {
    q: "Como inicio uma transmissão ao vivo ou entro em uma?",
    a: "Toque em «Transmitir ao vivo» acima do feed do Início, dê um título e escolha quem pode assistir: **Todos** ou um dos seus Circles ou sub-Circles. Uma transmissão para Todos ou para um Circle público aparece de duas formas no Início enquanto está no ar: como um avatar na faixa «Ao vivo agora» e como um cartão completo mais abaixo, no próprio feed, exibindo a transmissão ao vivo, com quem transmite, a contagem de espectadores em tempo real e os botões «Assistir», «Entrar como convidado» e «Entrar como coapresentador». Tocar em qualquer um deles leva você direto para a transmissão com essa escolha já feita, sem tela intermediária. O vídeo desse cartão só começa quando você realmente rola até ele, então passar por ele ao descer o feed não conta você como espectador; parar nele, sim. As transmissões de um Circle também aparecem em uma seção «Ao vivo agora» no topo da página daquele Circle.",
  },
  "who-see-live-stream-start": {
    q: "Quem pode ver uma transmissão ao vivo que eu inicio para um Circle?",
    a: "Depende da privacidade do Circle. Uma transmissão para um Circle **público** (ou para Todos) aparece na faixa «Ao vivo agora» do Início e qualquer pessoa pode assistir. Uma transmissão para um Circle ou sub-Circle **privado** é vista apenas pelos membros daquele Circle: nunca aparece no Início nem em nenhum outro lugar do aplicativo, e sua página, seu chat e suas gravações ficam fechados para quem não é membro, mesmo com o link. Nos dois casos, escolher um Circle ou sub-Circle em quem pode assistir também define quem é *notificado*: todos os membros daquele Circle ou sub-Circle recebem uma notificação no momento em que a transmissão começa, seja ela iniciada pelo proprietário ou por qualquer outro membro, e não o conjunto dos seus inscritos, nem mesmo em um Circle público. Já uma transmissão iniciada para **Todos** é anunciada aos seus próprios inscritos, como qualquer outra publicação pública. Os membros também encontram a transmissão de um Circle na seção «Ao vivo agora» da página do Circle.",
  },
  "start-live-stream-just-one": {
    q: "Posso iniciar uma transmissão ao vivo com apenas uma pessoa específica?",
    a: "Sim. Escolha o nome dela em «Uma pessoa específica», na lista de quem pode assistir, ao iniciar uma transmissão (só suas conexões aparecem ali). Essa transmissão é privada entre vocês dois: nunca aparece no Início, na página de um Circle nem em nenhum outro lugar, e só essa pessoa (além de você) pode ver ou entrar; seus inscritos e suas outras conexões não podem. Ela recebe uma notificação no momento em que a transmissão começa, como em uma chamada.",
  },
  "live-only-people-i-pick": {
    q: "Posso fazer uma transmissão ao vivo só para as pessoas que eu escolher?",
    a: "Sim. Em «Transmitir com», escolha as pessoas (até 10). Assim que você escolhe alguém, «Quem pode assistir» passa por padrão para **Só as pessoas que eu escolhi**. A transmissão então só aparece no Início dessas pessoas (e no seu), elas recebem uma notificação no idioma delas e ninguém mais consegue encontrá-la, abri-la ou entrar, nem mesmo com o link. Seus inscritos não são avisados.\n\nSe preferir que qualquer pessoa possa assistir, volte «Quem pode assistir» para «Todos» (ou escolha um Circle): as pessoas que você escolheu são apenas convidadas para o palco. Se você remover todas as pessoas escolhidas, volta para «Todos».\n\nDurante a transmissão, quem transmite e os coapresentadores podem convidar mais pessoas, e cada pessoa convidada também passa a poder assistir (até 50 pessoas no total). Cancelar um convite que a pessoa ainda não aceitou tira o acesso dela; quem já está no palco continua até sair. Recusar o convite para o palco ou deixá-lo expirar não tira o acesso: a pessoa continua podendo assistir. A publicação automática da gravação não é oferecida nessas transmissões. Se nenhuma das pessoas escolhidas puder ser convidada, a transmissão não começa e você é avisado; se só algumas puderem, ela começa e informa quantas não puderam ser convidadas. Quem tiver o convite cancelado vê que a transmissão não está mais disponível para essa pessoa.",
  },
  "difference-between-watching-joining-guest": {
    q: "Qual é a diferença entre assistir, entrar como convidado e entrar como coapresentador?",
    a: "**Assistir** é apenas ver: sem acesso à câmera nem ao microfone. **Convidado** e **coapresentador** colocam sua câmera e seu microfone no palco, em uma tela dividida ao lado de quem transmite (coapresentador é pensado para quem ajuda a apresentar, e convidado para quem aparece rapidamente, mas os dois funcionam do mesmo jeito). São 10 vagas no palco no total, divididas entre convidados e coapresentadores, além de quem transmite. Uma transmissão também tem um limite de quantas pessoas podem assistir ao mesmo tempo: se estiver lotada, você verá uma mensagem avisando e poderá tentar novamente daqui a pouco. Você assiste a uma transmissão por vez: ao começar a assistir outra, você sai da que estava assistindo. Com até 4 pessoas no palco, além de quem transmite, o vídeo fica com qualidade máxima; acima disso, os quadros ficam menores e a qualidade do vídeo diminui automaticamente para tudo continuar fluido.",
  },
  "invite-people-on-stage-live": {
    q: "Posso convidar outras pessoas para entrar ao vivo comigo?",
    a: "Sim. Ao tocar em «Transmitir ao vivo», em «Transmitir com» você pode buscar pessoas por nome ou @usuário e escolher até 10; cada uma aparece como uma etiqueta que você pode remover antes de começar. Durante a transmissão, quem transmite e os coapresentadores (mais ninguém) podem convidar mais pessoas pelo botão «Convidar pessoas».\n\nA busca mostra apenas suas conexões e as pessoas que aparecem na busca de pessoas, nunca alguém que você bloqueou ou que bloqueou você, e um convite nunca amplia quem pode assistir: numa transmissão para um Circle privado você só pode convidar os membros dele, e numa transmissão com uma pessoa específica, só essa pessoa. A exceção é uma transmissão para «Só as pessoas que eu escolhi»: nela, convidar alguém é justamente o que permite que a pessoa assista.\n\nCada pessoa convidada recebe uma notificação no idioma dela e, ao abrir a transmissão, pode escolher «Entrar no palco» ou «Agora não». Se aceitar, ela entra direto no palco como convidada, sem outra aprovação, desde que haja vaga (até 10 além de quem transmite). Os convites expiram depois de 15 minutos ou quando a transmissão termina, e quem transmite ou um coapresentador pode cancelá-los. Quem responde «Agora não» não pode ser convidado de novo para essa transmissão; a mesma pessoa pode ser convidada no máximo duas vezes por transmissão, e há um limite de convites por hora.",
  },
  "host-mute-guest-co-host": {
    q: "Quem transmite pode silenciar um convidado ou um coapresentador?",
    a: "Sim. Quem transmite pode tocar no ícone de microfone no quadro de vídeo de qualquer convidado ou coapresentador para silenciar ou reativar o microfone dessa pessoa para todos que estão assistindo, não só no próprio aparelho. Esse controle é exclusivo de quem transmite (um coapresentador não o tem, embora compartilhe as demais permissões de transmissão) e nunca aparece no seu próprio quadro. Um convidado ou coapresentador silenciado ainda pode reativar o próprio microfone se quiser voltar a falar: isso serve para resolver rápido um ruído de fundo ou várias pessoas falando ao mesmo tempo, não é um bloqueio definitivo.",
  },
  "record-go-live-stream-take": {
    q: "Posso gravar uma transmissão ao vivo ou fazer uma captura de tela?",
    a: "Quem transmite e os coapresentadores podem tocar em «Gravar» para iniciar uma gravação na nuvem. Depois de encerrada, ela aparece em uma lista de gravações da transmissão, com um link para baixar. Qualquer pessoa na transmissão pode tocar em «Captura de tela» para salvar um quadro; seu navegador vai pedir que você confirme o que capturar, porque é assim que a captura de um vídeo ao vivo funciona nos navegadores.",
  },
  "recording-stream-posted-automatically": {
    q: "Uma gravação da minha transmissão pode ser publicada automaticamente?",
    a: "Sim. Se você é quem transmite, toque em «Gravar e publicar» (o botão de gravar com um pequeno ícone de casa) em vez de apenas «Gravar», e essa gravação é publicada por você quando terminar de ser processada: no feed do Início, em uma transmissão para «Todos», ou no mesmo Circle, se você limitou a transmissão a um. Não há nada para enviar depois. Não é instantâneo: a gravação passa exatamente pela mesma análise automática de qualquer outro vídeo que você publica, então espere alguns minutos; se a análise apontar algum problema, avisamos você em vez de publicar. O botão que você tocou fica fixo para aquela gravação, então inicie outra se mudar de ideia. Essa opção não é oferecida em uma transmissão iniciada com apenas uma pessoa específica: essa transmissão é privada entre vocês dois, e uma publicação não tem uma configuração equivalente. O mesmo vale para uma transmissão para «Só as pessoas que eu escolhi».",
  },
  "did-live-stream-end-its": {
    q: "Por que minha transmissão ao vivo terminou sozinha?",
    a: "Uma transmissão termina automaticamente quando quem transmite e todos os coapresentadores ficaram ausentes por 30 minutos seguidos (ninguém com permissão de apresentação continua ativo nela). É uma medida de limpeza, para que uma transmissão abandonada não fique «ao vivo» indefinidamente. Uma transmissão recém-criada sempre tem uma tolerância de 30 minutos, em qualquer caso, então nunca é encerrada antes de alguém ter uma chance real de entrar.",
  },
  "people-comment-during-live-stream": {
    q: "As pessoas podem comentar durante uma transmissão ao vivo?",
    a: "Sim. Uma caixa «Escreva algo...» fica sobre a própria transmissão; qualquer pessoa que esteja assistindo pode digitar um comentário, e todos os outros o veem surgir acima dela em tempo real.",
  },
  "keep-using-app-during-call": {
    q: "Posso continuar usando o aplicativo durante uma chamada ou uma transmissão ao vivo?",
    a: "Sim. Toque no ícone de minimizar (no canto superior direito em uma chamada, no canto inferior direito em uma transmissão ao vivo) para reduzi-la a uma pequena janela de vídeo presa em um canto enquanto você navega pelo resto do aplicativo. A chamada ou a transmissão continua o tempo todo; toque no ícone de expandir da janela para voltar à tela cheia, ou no ícone de desligar para encerrá-la sem expandir antes.\n\nQuando uma chamada toca ou está em andamento, tudo o que estiver tocando no aplicativo (vídeos, Muse, stories, mensagens de voz e de vídeo) é pausado e nada começa sozinho; o que estava tocando continua quando a chamada termina, é recusada ou perdida. Os players incorporados do YouTube, do TikTok e de outros só podem ser parados, então recomeçam do início.",
  },

  story: {
    q: "O que é um story?",
    a: "Uma foto, um vídeo curto (de até 2 minutos) ou um texto digitado ou colado, exibido no seu perfil, que desaparece automaticamente depois de 24 horas. Toque no «+» da sua própria foto de perfil («Seu story» no Início, ou no seu perfil) e escolha «Story» para adicionar um; esse mesmo «+» também oferece «Publicação» e «Muse». Qualquer pessoa que possa ver seu perfil pode ver seu story enquanto estiver ativo. No editor de stories, «Enviar do dispositivo» permite escolher uma foto ou um vídeo, inclusive uma gravação de tela do iPhone.",
  },
  "post-text-only-story": {
    q: "Posso publicar um story só de texto?",
    a: "Sim. Ao adicionar um story, mude para a aba «Texto» em vez de escolher uma foto ou um vídeo. Digite ou cole o que quiser dizer, escolha uma cor de fundo e publique. Nos bastidores ele vira uma imagem, então funciona exatamente como qualquer outro story (expira em 24 horas e aceita reações, respostas e comentários). Pode ter até 2000 caracteres. Se for longo, a imagem mostra só o começo e o texto completo aparece abaixo com «Ver mais». Para publicar vários stories de texto de uma vez, toque em «Adicionar outro» (até 10); cada um é compartilhado como um story separado, na ordem em que você os criou.",
  },
  "post-more-than-one-story": {
    q: "Posso publicar mais de um story no mesmo dia?",
    a: "Sim. O pequeno «+» no anel do seu story (tanto no Início quanto no seu perfil) está sempre lá: toque nele e escolha «Story» para continuar adicionando outros sem limite. Quando você tem um story ativo, tocar no próprio anel mostra os que você já tem.",
  },
  "move-between-different-peoples-stories": {
    q: "Como passo dos stories de uma pessoa para os de outra?",
    a: "Enquanto vê um story, toque no lado direito da tela para avançar pelos stories daquela mesma pessoa, ou no lado esquerdo para voltar. Para pular para os stories de outra pessoa, deslize para a esquerda (próxima pessoa) ou para a direita (pessoa anterior) em qualquer lugar da tela: deslizar sempre troca de pessoa, não importa em qual story dela você esteja.",
  },
  "close-story": {
    q: "Como fecho um story?",
    a: "Toque no X no topo de qualquer story ou deslize para baixo sobre ele (um gesto rápido basta). No Android, o botão Voltar ou o gesto de voltar também o fecha, e no computador, a tecla Esc. Se houver algo aberto sobre o story (os comentários, a lista de quem viu, a confirmação de exclusão, o menu de compartilhar ou o seletor de emojis), Voltar ou Esc fecha isso primeiro e o story continua aberto. Tocar no nome da pessoa ou em um link dentro de um story fecha o story e abre essa página; voltar dali leva você para onde estava antes de abrir o story. Depois do último story, o visualizador fecha sozinho.",
  },
  "video-story-wont-play": {
    q: "E se uma story em vídeo não começar a tocar?",
    a: "Uma story em vídeo começa sozinha, seja a primeira ou venha depois de outras stories. Se ela parar ou não começar (com uma conexão lenta, por exemplo), o app tenta de novo sozinho; se depois de alguns segundos ainda não tiver começado, você verá \"Toque para reproduzir\" no meio da story. Se o seu celular ou navegador só deixar o vídeo tocar sem som, ele toca sem som com \"Toque para ativar o som\" no alto. Um vídeo que o seu aparelho não consegue reproduzir avisa isso e passa para a próxima story depois de alguns segundos. Você sempre pode tocar no lado direito da tela para avançar.",
  },
  "people-react-reply-comment-story": {
    q: "As pessoas podem reagir, responder ou comentar no meu story?",
    a: "Sim, as três coisas, e são diferentes: **reagir** é um emoji rápido (você vê quem reagiu ao abrir seu próprio story); **responder** envia uma mensagem direta privada e só funciona entre pessoas que já têm conexão, como nas mensagens comuns; **comentar** publica um comentário público que qualquer pessoa vendo o story pode ver, acessível pelo ícone de comentários ao lado das reações, e você recebe uma notificação quando alguém comenta no seu. Também há um ícone de **compartilhar** ao lado dos comentários em qualquer story: qualquer pessoa que possa ver o story, e não só quem o publicou, pode tocar nele para encaminhá-lo a uma das suas conversas diretas ou em grupo. Quem recebe vê o story de verdade na conversa e pode tocar nele para abri-lo em tela cheia, na mesma visualização da fileira de stories, em vez de apenas uma mensagem de texto sobre ele. As pessoas com quem você compartilha um story recebem uma notificação, como em uma mensagem comum. A mesma folha de Compartilhar também pode publicar uma cópia do story no seu feed, no Muse ou em um dos seus Circles (veja as próximas perguntas).",
  },
  "like-story": {
    q: "Posso curtir um story, e quem vê isso?",
    a: "Sim. Toque no coração ao lado da caixa de resposta no story de qualquer pessoa para curtir; toque de novo para descurtir. Só quem publicou o story pode ver quantas curtidas ele tem e quem curtiu: ao abrir seu próprio story, o coração ao lado do número de visualizações mostra quantas são, e a lista de quem viu marca com um coração todas as pessoas que curtiram. Seu próprio story não tem coração para tocar. Ninguém mais vê o número nem quem curtiu, e ninguém vê a sua curtida. A pessoa recebe uma única notificação na primeira vez que você curte um story (curtir de novo depois não envia outra). Você só pode curtir um story que consegue ver, e as curtidas somem junto com o story depois de 24 horas. Curtir é diferente de reagir com um emoji.",
  },
  "post-story-feed-muse-circle": {
    q: "Posso publicar um story no meu feed, no Muse ou em um Circle?",
    a: "Sim. Toque no ícone de Compartilhar em um story que você pode ver e escolha **Publicar no meu feed**, **Publicar no Muse** ou **Publicar em um Circle** (e depois escolha um dos seus Circles). Funciona com os seus stories e com os de outras pessoas, a menos que quem publicou o story tenha desativado a republicação. É publicada uma cópia da foto, do vídeo ou do vídeo incorporado do story, com a legenda. A cópia do story de outra pessoa começa com um crédito «Story by» com o nome dela, e ela recebe uma notificação de que você republicou. O Muse só aceita vídeos e vídeos incorporados, não fotos. No seu feed, a cópia recebe o público mais restrito entre o do seu perfil e o de quem publicou o story: se qualquer um de vocês mostra as publicações só para conexões, a cópia também. O story de outra pessoa só pode ir para o Muse ou para um Circle se o perfil dela for público. A cópia de um vídeo passa pela mesma verificação automática de qualquer vídeo novo; no Muse, um vídeo de mais de um minuto, mais ou menos, aparece quando essa verificação termina. Publicar o mesmo story no mesmo lugar de novo não cria uma segunda cópia. Qualquer tipo de story (uma foto, um vídeo com o próprio som ou um vídeo incorporado) pode ser enviado para conversas, para o seu feed e para os seus Circles; não existem stories só de áudio. Um vídeo cuja duração não pode ser lida nem a partir do próprio arquivo (raro, por exemplo algumas gravações WebM) ainda pode ir para conversas, para o seu feed e para os seus Circles, mas não para o Muse, e a folha de Compartilhar avisa. O Muse também não aceita vídeos com mais de 5 minutos. Um story criado a partir de um Muse com uma faixa de som adicionada mantém essa faixa, e a cópia dele no Muse também; uma cópia no seu feed ou em um Circle toca o som original do vídeo (as publicações não têm faixa de som separada), e a folha de Compartilhar avisa.",
  },
  "reposted-story-disappear": {
    q: "Um story republicado some depois de 24 horas?",
    a: "Não. O story em si continua sumindo depois de 24 horas, mas uma cópia publicada em um feed, no Muse ou em um Circle é uma publicação ou um Muse comum e fica até que a pessoa que publicou a cópia a apague. Se o story era seu, você não pode apagar a cópia de outra pessoa, mas pode denunciá-la como qualquer publicação ou Muse. Desativar a republicação impede novas cópias; não remove as que já existem.",
  },
  "stop-people-reposting-stories": {
    q: "Como impeço outras pessoas de republicar meus stories?",
    a: "Vá em Configurações, abra Privacidade, desmarque «Permitir que outras pessoas republiquem meus stories» e toque em «Salvar configurações de privacidade». A opção vem ativada por padrão. Enquanto estiver desativada, ninguém mais pode publicar seus stories no próprio feed, no Muse ou em um Circle; você ainda pode, e quem pode ver seu story ainda pode enviá-lo para as próprias conversas. Isso não remove cópias feitas antes de você desativar.",
  },

  "muse-2": {
    q: "O que é o Muse?",
    a: "Uma aba dedicada a vídeos curtos, divertidos e criativos: em tela cheia, um de cada vez; role para baixo para o próximo e para cima para o anterior (um feed de rolagem comum, não um gesto de deslizar). Diferente de um story, um Muse não expira em 24 horas e, diferente do seu feed do Início, não se limita às suas conexões: todo Muse é visível para todas as pessoas no YuKon3t. É um feed de descoberta, não um feed só de conexões.",
  },
  "post-muse": {
    q: "Como publico um Muse?",
    a: "Abra seu próprio perfil e toque em «Publicar um Muse», ou toque no «+» da sua própria foto de perfil (no Início ou no seu perfil) e escolha «Muse». Escolha um vídeo (de até 5 minutos), adicione uma legenda se quiser e publique. É só isso, sem outras telas. Um vídeo mais longo (com mais de um minuto, aproximadamente) passa por uma análise automática de segurança adicional antes de ficar visível para os outros, o que pode demorar um pouco mais do que com um vídeo mais curto. Antes de publicar, você também pode escolher «Áudio personalizado» para anexar um arquivo de som separado que substitui por completo o áudio do vídeo (a ideia de «adicionar som» do TikTok). Escolha «Som original» (o padrão) para manter o áudio do próprio vídeo.",
  },
  "delete-muse-after-ive-posted": {
    q: "Posso excluir um Muse depois de publicar?",
    a: "Sim. Abra o Muse no feed do Muse e toque no ícone de lixeira perto do topo (visível apenas nos seus próprios Muse); depois, toque nele de novo para confirmar. Ele é removido na hora e de forma permanente, para você e para todas as outras pessoas.",
  },
  "share-reshare-follow-muse": {
    q: "Posso compartilhar, recompartilhar ou seguir alguém no Muse?",
    a: "Sim, os três ficam ao lado dos botões de comentário e de curtir de cada Muse. O ícone de compartilhar abre um painel: compartilhe no seu **Início**, adicione ao seu **story** (para Muse de até 2 minutos), envie para um amigo ou um grupo, use o menu de compartilhamento do seu dispositivo ou copie o link. Início, story, amigos e o menu de compartilhamento do dispositivo enviam o vídeo de verdade, não só um link. O ícone de recompartilhar (uma seta circular) coloca o vídeo no seu Início com um toque: ele dá crédito a quem criou, envia uma notificação a essa pessoa e, se você tocar de novo, retira o vídeo. «Inscrever-se», ao lado do nome de quem criou, serve para seguir essa pessoa e ficar sabendo das próximas publicações dela. Nada disso exige ter conexão com quem criou, assim como curtir ou comentar. Se um Muse usa uma faixa de som adicionada, o story criado a partir dele mantém essa faixa de som.",
  },
  "share-post-muse": {
    q: "Posso compartilhar uma publicação no Muse?",
    a: "Sim. Qualquer publicação com vídeo (de até 5 minutos) pode ser compartilhada no Muse: abra o menu de compartilhar da publicação e toque em «Compartilhar no Muse». Ela vira um novo Muse no seu nome, dando crédito ao original com um link «Ver a publicação original»; quem publicou o original recebe uma notificação e ganha um compartilhamento na contagem, como ao compartilhá-la no seu story ou em um Circle. Publicações sem vídeo (texto, foto, link, conteúdo incorporado, GIF) não podem ser compartilhadas no Muse: não existe formato de Muse sem vídeo.",
  },
  "muse-feed-copy-same-likes": {
    q: "Quando um Muse e uma publicação do mesmo vídeo compartilham uma única contagem de curtidas?",
    a: "O seu próprio Muse e a sua própria cópia dele no feed compartilham uma única contagem de curtidas: quando você compartilha de novo o seu Muse no Início, ou compartilha no Muse a sua própria publicação com vídeo, os dois mostram o mesmo número, o de pessoas diferentes que curtiram qualquer um dos dois, sem contar ninguém duas vezes. Curtir um também aparece como curtido no outro (onde você puder vê-lo), e descurtir remove sua curtida dos dois. Uma cópia feita por outra pessoa (quando ela compartilha de novo o seu Muse ou cria um Muse a partir da sua publicação) tem a própria contagem: as curtidas que ela recebe ficam nela, e as da sua ficam na sua. Um Muse tem um botão de curtir em forma de coração; uma reação com emoji que você deixou em um Muse antes disso continua contando como sua curtida (o coração aparece preenchido), e tocar no coração a remove. Quem publicou só recebe notificação na primeira vez que você curte qualquer uma das duas cópias dessa pessoa. As republicações comuns de uma publicação já contam as curtidas na publicação original.",
  },
  "view-count-muse-mean": {
    q: "O que significa a contagem de visualizações de um Muse?",
    a: "O ícone de olho abaixo da legenda conta quantas vezes aquele Muse foi visto, incluindo as vezes em que você mesmo o viu. É um total acumulado, não uma contagem de espectadores únicos.",
  },
  "muse-play-sound": {
    q: "O Muse toca com som?",
    a: "Sim. O Muse começa a tocar com o som ligado assim que abre; toque no ícone de alto-falante perto do topo da tela para silenciar, e ele continua sem som quando você passa para o próximo Muse. Alguns navegadores não tocam som até você tocar na página uma vez. Se o seu fizer isso, o vídeo toca sem som com o aviso «Toque para ativar o som», e seu próximo toque liga o som.",
  },
  "react-comment-muse": {
    q: "Posso curtir ou comentar em um Muse?",
    a: "Sim. Toque no coração à direita para curtir um Muse (ele fica vermelho; toque de novo para descurtir), e o número embaixo mostra quantas pessoas curtiram. Você também pode tocar duas vezes no vídeo para curtir: o toque duplo só curte (em um Muse que você já curtiu, ele apenas mostra o coração de novo), e o vídeo continua tocando, ou continua pausado, como estava. Uma reação com emoji que você deixou em um Muse antes da chegada do coração continua contando como sua curtida. Os emojis e os GIFs ficam nos comentários: a caixa de comentário tem uma fileira de emojis rápidos, um seletor completo de emojis e uma busca de GIFs.\n\nMantenha o dedo sobre um vídeo do Muse para pausá-lo enquanto segura, ou toque nele para pausar: uma barra na parte de baixo mostra então em que ponto o vídeo está e a duração total (por exemplo, 0:12 / 0:45). Arraste ao longo da barra para pular para outro momento; o vídeo continua dali se estava tocando. Com um teclado, a barra pode receber o foco e ser movida com as setas (5 segundos por vez). A barra não aparece em vídeos incorporados de outro site (YouTube, TikTok e parecidos), cujo próprio player tem os próprios controles.\n\nToque no ícone de comentários: o vídeo continua tocando em um pequeno cartão arredondado no topo, enquanto os comentários ocupam a parte de baixo da tela. Toque no vídeo, arraste para baixo a barra no topo dos comentários ou volte para retornar ao vídeo em tela cheia. Quem criou o Muse, quem escreveu o comentário ou um administrador podem remover qualquer comentário.",
  },
  "muse-comment-replies-likes-gifs": {
    q: "Como funcionam as respostas, as curtidas, os emojis e os GIFs nos comentários de um Muse?",
    a: "Toque em **Responder** embaixo de um comentário para respondê-lo: a caixa mostra «Respondendo a» com o nome da pessoa e começa com o @usuário dela (você pode cancelar a resposta). As respostas ficam embaixo do comentário que respondem, em um só nível: responder a uma resposta coloca a sua no mesmo fio e menciona com @ a pessoa a quem você respondeu. Toque em «Ver respostas» para abrir um fio e em «Ocultar respostas» para fechá-lo. Toque no coração ao lado de um comentário ou de uma resposta para curtir; o número ao lado mostra quantas pessoas curtiram.\n\nAo lado da caixa de comentário, o botão de emoji abre um seletor completo de emojis no lugar do teclado, e o botão de GIF abre uma busca de GIFs (os GIFs vêm do GIPHY). Um comentário ou uma resposta pode ser texto, um GIF ou os dois. Os emojis usados recentemente aparecem primeiro e ficam salvos só no seu dispositivo. A pessoa a quem você respondeu recebe uma notificação, e quem criou o Muse recebe uma notificação por comentário ou resposta nova, nunca duas pelo mesmo.\n\nVocê pode excluir seus próprios comentários e respostas, e quem criou o Muse pode excluir qualquer comentário ou resposta no seu Muse; excluir um comentário exclui também as respostas dele. Comentários e respostas de contas que você bloqueou (ou que bloquearam você) ou que não estão mais ativas não aparecem, e um texto sinalizado pela nossa verificação automática não é publicado. Os comentários de um Muse não podem ser editados; para denunciar um, denuncie a pessoa que o escreveu.",
  },
  "need-keep-scrolling-see-theres": {
    q: "Preciso continuar rolando para saber se há mais?",
    a: "Não. O Muse carrega o próximo lote de vídeos em segundo plano quando você se aproxima do fim do que já está carregado, então a rolagem parece contínua.",
  },

  "ambient-2": {
    q: "O que é o Ambient?",
    a: "Configurações → «Ambient» permite escolher um Inner Circle pequeno (até 8 pessoas com quem você já tem conexão) e compartilhar «momentos» em foto, casuais, que só elas podem ver, em vez de uma publicação pública mais elaborada. Um momento desaparece depois de 48 horas.",
  },
  "who-see-ambient-moments": {
    q: "Quem pode ver meus momentos do Ambient?",
    a: "Somente as pessoas que adicionaram *você* ao Inner Circle delas. Nunca mais ninguém, e eles nunca aparecem no seu perfil público, no feed nem no Descobrir. Adicionar alguém ao seu Inner Circle é de mão única, como se inscrever: a pessoa não precisa adicionar você de volta para você ver os dela. Elas também precisam continuar conectadas com você: se um de vocês bloquear o outro, ou se deixarem de estar conectados, seus momentos deixam de aparecer para elas (e o bloqueio tira cada um do Inner Circle do outro).",
  },
  "there-lock-screen-watch-widget": {
    q: "Existe um widget para a tela de bloqueio ou para o relógio?",
    a: "Ainda não. Isso exige desenvolvimento nativo de verdade para cada plataforma. Enquanto isso, Configurações → «Ambient» mostra dentro do aplicativo uma prévia de como seria o seu feed do Ambient, e já é possível gerar um token de acesso para widget, para quando existir um.",
  },
} satisfies Partial<FaqItems>;
