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
  "difference-between-watching-joining-guest": {
    q: "Qual é a diferença entre assistir, entrar como convidado e entrar como coapresentador?",
    a: "**Assistir** é apenas ver: sem acesso à câmera nem ao microfone. **Convidado** e **coapresentador** colocam sua câmera e seu microfone no palco, em uma tela dividida ao lado de quem transmite (coapresentador é pensado para quem ajuda a apresentar, e convidado para quem aparece rapidamente, mas os dois funcionam do mesmo jeito). São 3 vagas no palco no total, divididas entre convidados e coapresentadores, além de quem transmite. Para assistir não há limite.",
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
    a: "Sim. Se você é quem transmite, toque em «Gravar e publicar» (o botão de gravar com um pequeno ícone de casa) em vez de apenas «Gravar», e essa gravação é publicada por você quando terminar de ser processada: no feed do Início, em uma transmissão para «Todos», ou no mesmo Circle, se você limitou a transmissão a um. Não há nada para enviar depois. Não é instantâneo: a gravação passa exatamente pela mesma análise automática de qualquer outro vídeo que você publica, então espere alguns minutos; se a análise apontar algum problema, avisamos você em vez de publicar. O botão que você tocou fica fixo para aquela gravação, então inicie outra se mudar de ideia. Essa opção não é oferecida em uma transmissão iniciada com apenas uma pessoa específica: essa transmissão é privada entre vocês dois, e uma publicação não tem uma configuração equivalente.",
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
    a: "Sim. Toque no ícone de minimizar (no canto superior direito em uma chamada, no canto inferior direito em uma transmissão ao vivo) para reduzi-la a uma pequena janela de vídeo presa em um canto enquanto você navega pelo resto do aplicativo. A chamada ou a transmissão continua o tempo todo; toque no ícone de expandir da janela para voltar à tela cheia, ou no ícone de desligar para encerrá-la sem expandir antes.",
  },

  story: {
    q: "O que é um story?",
    a: "Uma foto, um vídeo curto (de até 2 minutos) ou um texto digitado ou colado, exibido no seu perfil, que desaparece automaticamente depois de 24 horas. Toque no «+» da sua própria foto de perfil para adicionar um. Qualquer pessoa que possa ver seu perfil pode vê-lo enquanto estiver ativo.",
  },
  "post-text-only-story": {
    q: "Posso publicar um story só de texto?",
    a: "Sim. Ao adicionar um story, mude para a aba «Texto» em vez de escolher uma foto ou um vídeo. Digite ou cole o que quiser dizer, escolha uma cor de fundo e publique. Nos bastidores ele vira uma imagem, então funciona exatamente como qualquer outro story (expira em 24 horas e aceita reações, respostas e comentários).",
  },
  "post-more-than-one-story": {
    q: "Posso publicar mais de um story no mesmo dia?",
    a: "Sim. Quando você tem um story ativo, aparece um pequeno «+» no anel do seu story (tanto no Início quanto no seu perfil) para você continuar adicionando outros sem limite, além de poder tocar no próprio anel para ver os que já tem.",
  },
  "move-between-different-peoples-stories": {
    q: "Como passo dos stories de uma pessoa para os de outra?",
    a: "Enquanto vê um story, toque no lado direito da tela para avançar pelos stories daquela mesma pessoa, ou no lado esquerdo para voltar. Para pular para os stories de outra pessoa, deslize para a esquerda (próxima pessoa) ou para a direita (pessoa anterior) em qualquer lugar da tela: deslizar sempre troca de pessoa, não importa em qual story dela você esteja.",
  },
  "people-react-reply-comment-story": {
    q: "As pessoas podem reagir, responder ou comentar no meu story?",
    a: "Sim, as três coisas, e são diferentes: **reagir** é um emoji rápido (você vê quem reagiu ao abrir seu próprio story); **responder** envia uma mensagem direta privada e só funciona entre pessoas que já têm conexão, como nas mensagens comuns; **comentar** publica um comentário público que qualquer pessoa vendo o story pode ver, acessível pelo ícone de comentários ao lado das reações, e você recebe uma notificação quando alguém comenta no seu. Também há um ícone de **compartilhar** ao lado dos comentários em qualquer story: qualquer pessoa que possa ver o story, e não só quem o publicou, pode tocar nele para encaminhá-lo a uma das suas conversas diretas ou em grupo. Quem recebe vê o story de verdade na conversa e pode tocar nele para abri-lo em tela cheia, na mesma visualização da fileira de stories, em vez de apenas uma mensagem de texto sobre ele.",
  },

  "muse-2": {
    q: "O que é o Muse?",
    a: "Uma aba dedicada a vídeos curtos, divertidos e criativos: em tela cheia, um de cada vez; role para baixo para o próximo e para cima para o anterior (um feed de rolagem comum, não um gesto de deslizar). Diferente de um story, um Muse não expira em 24 horas e, diferente do seu feed do Início, não se limita às suas conexões: todo Muse é visível para todas as pessoas no YuKon3t. É um feed de descoberta, não um feed só de conexões.",
  },
  "post-muse": {
    q: "Como publico um Muse?",
    a: "Abra seu próprio perfil e toque em «Publicar um Muse». Escolha um vídeo (de até 5 minutos), adicione uma legenda se quiser e publique. É só isso, sem outras telas. Um vídeo mais longo (com mais de um minuto, aproximadamente) passa por uma análise automática de segurança adicional antes de ficar visível para os outros, o que pode demorar um pouco mais do que com um vídeo mais curto. Antes de publicar, você também pode escolher «Áudio personalizado» para anexar um arquivo de som separado que substitui por completo o áudio do vídeo (a ideia de «adicionar som» do TikTok). Escolha «Som original» (o padrão) para manter o áudio do próprio vídeo.",
  },
  "delete-muse-after-ive-posted": {
    q: "Posso excluir um Muse depois de publicar?",
    a: "Sim. Abra o Muse no feed do Muse e toque no ícone de lixeira perto do topo (visível apenas nos seus próprios Muse); depois, toque nele de novo para confirmar. Ele é removido na hora e de forma permanente, para você e para todas as outras pessoas.",
  },
  "share-reshare-follow-muse": {
    q: "Posso compartilhar, recompartilhar ou seguir alguém no Muse?",
    a: "Sim, os três ficam ao lado dos botões de comentário e de reação de cada Muse. O ícone de compartilhar abre um painel: compartilhe no seu **Início**, adicione ao seu **story** (para Muse de até 2 minutos), envie para um amigo ou um grupo, use o menu de compartilhamento do seu dispositivo ou copie o link. Início, story, amigos e o menu de compartilhamento do dispositivo enviam o vídeo de verdade, não só um link. O ícone de recompartilhar (uma seta circular) coloca o vídeo no seu Início com um toque: ele dá crédito a quem criou, envia uma notificação a essa pessoa e, se você tocar de novo, retira o vídeo. «Inscrever-se», ao lado do nome de quem criou, serve para seguir essa pessoa e ficar sabendo das próximas publicações dela. Nada disso exige ter conexão com quem criou, assim como reagir ou comentar.",
  },
  "share-post-muse": {
    q: "Posso compartilhar uma publicação no Muse?",
    a: "Sim. Qualquer publicação com vídeo (de até 5 minutos) pode ser compartilhada no Muse: abra o menu de compartilhar da publicação e toque em «Compartilhar no Muse». Ela vira um novo Muse no seu nome, dando crédito ao original com um link «Ver a publicação original»; quem publicou o original recebe uma notificação e ganha um compartilhamento na contagem, como ao compartilhá-la no seu story ou em um Circle. Publicações sem vídeo (texto, foto, link, conteúdo incorporado, GIF) não podem ser compartilhadas no Muse: não existe formato de Muse sem vídeo.",
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
    q: "Posso reagir ou comentar em um Muse?",
    a: "Sim. Há a mesma fileira de reações rápidas das publicações e dos stories (toque no + no fim dela para ver todos os emojis), além de uma lista de comentários públicos (toque no ícone de comentários para abri-la como um painel que sobe de baixo). Quem criou o Muse, quem escreveu o comentário ou um administrador podem remover qualquer comentário.",
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
