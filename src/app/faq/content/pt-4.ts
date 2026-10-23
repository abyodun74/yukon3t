import type { FaqItems } from "../ids";

// Portuguese FAQ, part 4: Circles and Collab Boards, Advertising, Inviting friends, Your account and data, Privacy,
// safety and trust.
export const pt4 = {
  circle: {
    q: "O que é um Circle?",
    a: "Uma comunidade gratuita em torno de um interesse ou de uma identidade: hobbies, causas, culturas, qualquer coisa em torno da qual um grupo de membros queira se organizar. Qualquer pessoa pode criar um; criar um Circle e entrar em um é sempre gratuito.",
  },
  "who-see-shared-circle-sub": {
    q: "Quem pode ver o que é compartilhado em um Circle ou sub-Circle?",
    a: "Depende da privacidade do Circle. As publicações, os vídeos e as transmissões ao vivo de um Circle **público** são públicos: podem aparecer no Início e na busca, podem ser republicados ou compartilhados em um story, no Muse ou em outro Circle, e notificam os inscritos como qualquer publicação pública. Um Circle **privado** (ou um sub-Circle privado) é visível apenas para os membros: para todas as outras pessoas, ele não existe. Não aparece em nenhuma lista, não é encontrado na busca, e o nome, a foto, a descrição, os membros, as publicações, os vídeos, os eventos, as enquetes, as conversas dos canais, as salas de voz e as transmissões ao vivo dele ficam ocultos para elas. O conteúdo dele nunca aparece no Início, na busca nem nos perfis, e não pode ser republicado nem compartilhado para fora. Só se entra em um Circle privado por convite: quem foi convidado vê o nome, a foto e a descrição dele, junto com o convite, até responder. Um canal privado dentro de um Circle público é só para membros do mesmo jeito. Cada sub-Circle tem sua própria privacidade e seus próprios membros: estar no Circle principal não permite ver um sub-Circle privado, e vice-versa.",
  },
  "pick-category-circle": {
    q: "Como escolho uma categoria para o meu Circle?",
    a: "Busque por ela ao criar o Circle. A lista cobre temas gerais (Viagens, Cultura, Tecnologia e startups e outros) além de tipos de trabalho e profissões específicos (Bookkeeping, Civil Engineer, Cybersecurity Analyst, Linux Administrator e dezenas de outros, que aparecem em inglês), para você chegar exatamente à categoria certa em vez de uma categoria genérica «Profissional». Você pode escolher até 5 categorias para um mesmo Circle, se mais de uma realmente se aplicar.",
  },
  "rename-circle-change-its-theme": {
    q: "Posso mudar o nome, o tema, as categorias ou a privacidade do meu Circle depois de criá-lo?",
    a: "Sim. O proprietário ou um coadmin pode tocar no ícone de lápis ao lado do nome do Circle, na página dele, para mudar a qualquer momento o nome, o tema (a descrição do que trata o Circle, escrita por você ao criá-lo), as categorias ou a privacidade (público ou privado). A URL nunca muda quando você troca o nome, então os links e favoritos existentes continuam funcionando. Tornar um Circle privado o oculta imediatamente de todos que não são membros: ele sai da lista de Circles e da busca, e as publicações, os eventos e as transmissões ao vivo dele (e as republicações das publicações dele) somem para essas pessoas. Isso também torna privados os sub-Circles dele; os membros atuais permanecem, e a partir daí só se entra por convite. Torná-lo público permite que qualquer pessoa o encontre, entre e o veja, e limpa os pedidos de entrada e os convites pendentes, já que deixam de ser necessários. Um sub-Circle de um Circle privado não pode ser tornado público.",
  },
  "sub-circles": {
    q: "O que são sub-Circles?",
    a: "Um sub-Circle é um Circle menor que fica dentro de um Circle principal: por exemplo, um sub-Circle «Design» e outro «Marketing» dentro de um Circle «Fundadores de startups». Abra o Circle principal e os sub-Circles que você pode ver aparecem listados na própria página: todos os públicos, e um privado só se você for membro ou tiver sido convidado. Cada um tem seus próprios membros, seus próprios canais e publicações e sua própria lista de membros em sua própria página. Você pode entrar em qualquer sub-Circle público separadamente (não é preciso entrar antes no Circle principal, e entrar em um não coloca você nos outros), enquanto em um privado, como em qualquer Circle privado, só se entra por convite. Só o proprietário do Circle principal pode adicionar sub-Circles (toque em «Adicionar um sub-Circle» na página do Circle principal). Os sub-Circles têm um único nível de profundidade, e um sub-Circle de um Circle privado também é privado. Excluir um Circle principal exclui também os sub-Circles dele.",
  },
  "invite-people-private-circle": {
    q: "Como convido pessoas para um Circle privado?",
    a: "Um Circle privado é somente por convite: ninguém mais consegue encontrá-lo nem pedir para entrar, então um convite é a única forma de entrar. Na página de um Circle privado, o dono ou um coadmin pode tocar em «Convidar pessoas» e escolher entre as próprias conexões, até 50 de cada vez. Cada pessoa recebe uma notificação e, na página do Circle, um aviso para aceitar ou recusar (a única parte do Circle que ela vê antes de aceitar); ninguém vira membro antes de aceitar, e recusar não avisa ninguém, e depois disso o Circle volta a ficar oculto para ela. Convidar alguém que pediu para entrar antes de os Circles privados passarem a ser somente por convite simplesmente coloca essa pessoa no Circle. Todos os admins veem a lista «Convidados» com o status de cada convite e podem cancelar um que ainda esteja pendente. Os convites não expiram, mas um convite não pode mais ser aceito se quem o enviou deixar de ser admin do Circle; a lista o marca, e convidar essa pessoa de novo envia um novo convite. Quem recusou, saiu ou foi removido pode ser convidado de novo. Um sub-Circle é um Circle à parte, então convide pessoas pela página dele. Tornar o Circle público cancela os convites pendentes, já que qualquer pessoa pode entrar.",
  },
  "invite-someone-circles-voice-channel": {
    q: "Como convido alguém para o canal de voz de um Circle?",
    a: "Abra o canal de voz e toque em «Convidar» para escolher entre os membros do Circle. Qualquer membro pode convidar outro, não só o proprietário ou os coadmins. O canal mostra a contagem de quantos convites estão pendentes, aceitos e recusados. Aceitar um convite não coloca a pessoa direto na sala por si só: ela ainda precisa tocar para entrar de fato, como qualquer outra.",
  },
  "collab-board": {
    q: "O que é um Collab Board?",
    a: "Um lugar para encontrar trocas de habilidades entre países, mentoria, serviços profissionais, eventos e projetos. O campo «Tipo» é uma lista em que você pode buscar (troca de habilidades, consultoria tributária, escrituração e contabilidade, orientação de carreira, vendas e marketing e dezenas de outros), em vez de um punhado fixo de opções. Os anúncios podem ser limitados a países específicos ou marcados como válidos para o mundo todo. Depois que você participa, tem acesso à conversa em grupo daquela colaboração (texto, fotos e vídeos) e a uma sessão de vídeo ao vivo com compartilhamento de tela, materiais enviados e gravação.",
  },
  "difference-between-public-private-collab": {
    q: "Qual é a diferença entre um Collab Board público e um privado?",
    a: "As colaborações **públicas** são anunciadas a todos e listadas no Collab Boards: qualquer pessoa pode tocar em «Pedir para participar», e quem organiza ou um coadmin analisa cada pedido (Aprovar/Recusar) antes de liberar o acesso. As colaborações **privadas** são apenas por convite: quem organiza escolhe conexões específicas para convidar, ao publicar ou depois, por «Convidar pessoas» na página da colaboração, e elas nunca são listadas nem aparecem na busca; só quem organiza e quem foi convidado ou já entrou consegue vê-las. Você também pode convidar um Circle inteiro que tenha criado: cada um dos membros atuais recebe o próprio convite, e ninguém entra sem aceitar. Uma pessoa convidada vê um aviso para aceitar ou recusar na página da colaboração até responder.",
  },
  "starting-joining-collab-session-work": {
    q: "Como funciona começar uma sessão do Collab ou entrar em uma?",
    a: "Só quem organiza ou um coadmin pode começar uma sessão do zero: essa pessoa vê um botão «Começar a sessão» na página da colaboração. Em uma colaboração pública, ao tocar nele, é conectada na hora, sem confirmação extra. Em uma privada, primeiro abre um painel curto «Começar a sessão»: «Avisar os participantes de que a sessão está ao vivo» (ativado por padrão) envia uma notificação a todos que já estão na colaboração, no máximo uma vez a cada 30 minutos, e você ainda pode convidar mais conexões ou até cinco Circles que tenha criado, exatamente como em «Convidar pessoas» (cada pessoa continua aceitando o próprio convite, e quem é convidado enquanto há uma sessão ao vivo fica sabendo disso). Toque em «Começar» sem escolher ninguém para simplesmente começar. Se algum convite não puder ser enviado (por exemplo, um Circle que adicionaria mais de 200 convites novos), a sessão não começa e ninguém é avisado. Os demais só veem um botão «Entrar na sessão» quando já existe uma em andamento (antes disso, a página mostra apenas «Aguardando quem organiza começar a sessão»). Se já houver uma sessão em andamento quando você for começá-la ou entrar nela, primeiro aparece uma pergunta rápida sobre se você quer entrar, porque chegar no meio de pessoas que já estão conversando interrompe mais do que começar do zero; se você recusar, nada acontece e você não é adicionado à chamada. De qualquer forma, a chamada abre automaticamente em tela cheia; toque no ícone de minimizar (no canto inferior direito) para reduzi-la a uma pequena janela enquanto usa o resto do aplicativo, como em uma chamada entre duas pessoas.",
  },
  "schedule-recurring-collaboration-session": {
    q: "Posso agendar uma sessão recorrente de uma colaboração?",
    a: "Sim. Ao publicar uma colaboração (ou ao editá-la depois), marque «Sessão recorrente» e escolha o dia ou os dias da semana e o horário. O horário é informado em UTC para que todas as pessoas da colaboração vejam o mesmo horário compartilhado, onde quer que estejam, em vez de ele mudar sem aviso para outro dia ou outra hora para alguém em outro fuso horário. Quem organiza ou um coadmin pode alterar ou remover o agendamento a qualquer momento em «Editar».",
  },
  "add-collaborations-session-own-calendar": {
    q: "Posso adicionar a sessão de uma colaboração à minha agenda?",
    a: "Sim. Uma colaboração com agendamento recorrente mostra na página dela um link «Adicionar ao Google Agenda» e um link para baixar um arquivo .ics (para o Calendário da Apple, o Outlook ou qualquer outro aplicativo que o importe), cada um com seu próprio lembrete embutido antes do início da sessão. Você também recebe uma notificação no aplicativo pouco antes de cada ocorrência. Só quem organiza e quem já participa vê esses links, não um visitante que está apenas olhando uma colaboração pública na qual não entrou de fato.",
  },
  "share-screen-upload-material-during": {
    q: "Posso compartilhar minha tela ou enviar material durante uma sessão do Collab?",
    a: "Toque no ícone de tela nos controles da chamada (ou no menu «…» de mais opções da chamada, se a barra for estreita demais para mostrar todos os ícones) para compartilhar sua tela com todos na sessão. Isso só funciona em um navegador de computador: os navegadores de celular e o aplicativo instalado para Android não conseguem conceder a uma página a permissão de captura de tela; é uma limitação dos navegadores de celular em geral, não algo específico do YuKon3t. Para documentos ou imagens, toque no ícone de envio ao lado dos botões de sair e minimizar: o arquivo abre imediatamente como um painel compartilhado para todos que estão na chamada naquele momento, e depois fica publicado na conversa da colaboração para quem entrar mais tarde.",
  },
  "leave-collab-session": {
    q: "Como saio de uma sessão do Collab?",
    a: "Toque no ícone vermelho de desligar ao lado do de minimizar (ou na janela minimizada, se você já reduziu a chamada). Isso faz você sair da sessão, não da colaboração: a sessão continua aberta para quem ainda está nela, e você pode começá-la de novo ou entrar nela a qualquer momento pela página da colaboração.",
  },
  "invite-someone-private-collaboration-approve": {
    q: "Como convido alguém para uma colaboração privada ou aprovo um pedido para entrar em uma pública?",
    a: "Em uma colaboração privada, quem organiza ou um coadmin toca em «Convidar pessoas» na página dela e busca entre as próprias conexões, ou escolhe até cinco Circles que criou em «Convidar um Circle» (até 200 novos convites por vez). Cada membro do Circle recebe o próprio convite e decide se aceita; quem já foi convidado, quem recusou antes e quem tem um bloqueio fica de fora. Uma lista de pessoas convidadas na página mostra a situação de cada convite (pendente, entrou ou recusado); convites que outro coadmin enviou a pessoas que você não conhece aparecem só como um número, sem nomes, e quem organiza ou um coadmin pode cancelar um convite ainda pendente. Os convites não expiram, mas um convite não pode mais ser aceito quando quem o enviou deixa de ser admin da colaboração; a lista o marca, e convidar essa pessoa de novo (sozinha ou por um Circle de que ela faça parte) envia um novo convite. Em uma pública, os pedidos pendentes aparecem em uma lista de pedidos de entrada na página, com os botões Aprovar e Recusar; ao aprovar, a pessoa passa a participar na hora.",
  },
  "edit-collab-board-after-ive": {
    q: "Posso editar um Collab Board depois de publicar?",
    a: "Sim. Quem criou (ou um coadmin) pode tocar em «Editar» na página dele a qualquer momento para mudar o título, o tipo, a descrição ou os países, mesmo depois de pessoas terem entrado ou de uma sessão ao vivo já ter começado. Não há nenhuma trava: edite conforme seus planos mudarem.",
  },
  "co-admins-circle-collab-board": {
    q: "O que os coadmins fazem em um Circle ou em um Collab Board?",
    a: "Quem criou um Circle ou uma colaboração pode promover qualquer membro ou participante a coadmin, dando a essa pessoa os mesmos poderes de gestão do dia a dia (moderar publicações, gerenciar membros, promover outros coadmins): tudo, exceto excluir o Circle inteiro ou encerrar a colaboração de vez, o que continua com quem criou.",
  },

  "polls-circle-collab-board": {
    q: "Como funcionam as enquetes em um Circle ou em um Collab Board?",
    a: "Quem criou um Circle ou os coadmins dele (ou quem organiza uma colaboração ou os coadmins dela) podem criar uma **enquete** na seção Enquetes da página: uma pergunta com de 2 a 10 opções, ou uma enquete para **encontrar um horário**, cujas opções são datas e horários. Os horários são digitados e mostrados em UTC para que todos compartilhem a mesma referência, com o seu horário local ao lado de cada um. Os membros (ou participantes) são avisados e podem votar, mudar o voto ou retirá-lo a qualquer momento enquanto a enquete estiver aberta. Os resultados são atualizados ao vivo conforme as pessoas votam. As enquetes de um Circle ou de uma colaboração privados só ficam visíveis para os membros.\n\nOs resultados mostram apenas quantas pessoas escolheram cada opção, nunca quem votou em quê, nem mesmo para os administradores. Quem criou a enquete e os administradores do Circle ou da colaboração podem editá-la, encerrá-la ou reabri-la, ou excluí-la. Se uma opção que já tem votos for alterada ou removida, esses votos são removidos (você é avisado antes), para que nenhum voto acabe contando para algo que a pessoa não escolheu; essas pessoas podem simplesmente votar de novo.\n\nQuando uma enquete para encontrar um horário tem uma vencedora, um administrador (ou quem criou a enquete, depois de encerrada) pode agendá-la: em um Circle, isso publica um evento em que as pessoas podem confirmar presença e que podem adicionar à agenda; em um Collab Board, isso adiciona uma sessão avulsa (uma colaboração pode ter várias, cada uma exibida na página até começar), com o lembrete de sempre pouco antes. Todos que votaram são avisados.",
  },

  "circle-events-coming-up": {
    q: "Como funcionam os eventos em um Circle?",
    a: "Qualquer membro pode publicar um **evento** em um Circle adicionando data, horário e local a uma publicação. A página do Circle mostra o que vem **em breve**, do mais próximo ao mais distante e no seu horário local, com quantas pessoas vão e um botão para dizer que você vai. Cada evento também tem **adicionar à agenda** (Google Agenda, ou um arquivo de calendário se você usa o YuKon3t em um navegador) e o lembrete de sempre pouco antes de começar, se você disse que vai. Os eventos de um Circle privado, e os de um canal privado, só aparecem para quem pode ver aquele Circle ou canal.\n\nToque em **Detalhes do evento** no evento dentro do Circle (ou abra a página do evento) para ver os links de agenda e a lista. Ali, quem organiza (quem o publicou, ou quem criou o Circle e seus coadmins) pode criar uma lista de **quem leva o quê** com até 20 itens. Qualquer membro que pode ver o evento pode se oferecer para levar um item (uma pessoa por item) e desistir depois; quem organiza pode editar, remover ou tirar o responsável de um item. Todos que podem ver o evento veem quem vai levar o quê.\n\nQuem organiza também pode **lembrar quem não respondeu**: os membros que podem ver o evento e ainda não disseram que vão recebem uma notificação. Isso só funciona antes de o evento começar e no máximo uma vez a cada 12 horas.\n\nAo publicar um evento em um Circle, você pode fazê-lo se **repetir** toda semana, a cada 2 semanas ou todo mês (no mesmo dia do mês, ou no último dia nos meses mais curtos), por 2 a 12 datas ou até uma data dentro de um ano. Cada data é um evento próprio, com suas próprias respostas e sua própria lista. A próxima data é publicada automaticamente logo depois que a anterior começa, sem avisar ninguém, e quem organiza pode parar a repetição a qualquer momento. As datas seguem o horário UTC, então onde há horário de verão o horário local pode mudar em uma hora.\n\nAntes de um evento começar, quem organiza pode **remarcá-lo** para outra data e horário ou **cancelá-lo**, com um motivo curto opcional que aparece no evento. Todos que vão e todos que vão levar algo são avisados (e também quem publicou o evento, se outra pessoa fez a mudança). Um evento remarcado mantém as respostas e a lista, mostra o horário anterior e envia o lembrete de novo para o novo horário; adicioná-lo de novo a uma agenda atualiza o evento em vez de criar outro. Um evento cancelado continua visível marcado como \"Cancelado\", sai da lista de próximos eventos e não aceita mais respostas nem lembretes. Cancelar uma data de um evento que se repete não para a repetição, a menos que quem organiza também escolha pará-la.",
  },

  "advertise-yukon3t": {
    q: "Como anuncio no YuKon3t?",
    a: "Acesse a página [Anuncie](/advertise). Não é preciso ter conta no YuKon3t. Envie os dados da sua empresa, o texto do anúncio e uma foto ou um vídeo curto, e escolha por quantos dias quer que ele seja exibido; o pagamento é processado com segurança pela Stripe. Todo envio é analisado antes de ir ao ar, em geral em até um dia útil.",
  },

  "invite-someone-from-phones-contacts": {
    q: "Como convido alguém dos contatos do meu celular que ainda não está no YuKon3t?",
    a: "Vá em Configurações → «Convidar amigos» → «Escolher dos contatos». Em um celular ou dispositivo Android, você pode escolher contatos diretamente e enviar o link do aplicativo por mensagem de texto com um toque; nos demais casos, abre-se o menu de compartilhamento do seu dispositivo, ou você pode simplesmente copiar o link de convite e enviá-lo por conta própria.",
  },

  "signed-new-phone-computer-wheres": {
    q: "Entrei em um celular ou computador novo. Onde estão as minhas coisas?",
    a: "Exatamente onde você deixou. Suas publicações, fotos, vídeos, mensagens, Circles e conexões ficam nos nossos servidores, não em um aparelho específico: ao entrar com o mesmo e-mail ou nome de usuário em qualquer dispositivo, tudo vem junto automaticamente. Não há nada para transferir ou restaurar manualmente.",
  },
  "download-copy-data": {
    q: "Posso baixar uma cópia dos meus dados?",
    a: "Sim. Configurações → «Seus dados» → «Exportar meus dados» fornece um arquivo JSON com tudo o que está ligado à sua conta, de graça e a qualquer momento, como backup pessoal.",
  },
  "difference-between-deactivating-deleting-account": {
    q: "Qual é a diferença entre desativar e excluir minha conta?",
    a: "**Desativar** oculta seu perfil e suas publicações sem excluir nada; entrar de novo com sua senha ou com um link por e-mail reativa a conta automaticamente. **Excluir** remove de forma permanente seu perfil, suas publicações, suas mensagens e os Circles dos quais você é proprietário; isso não pode ser desfeito.",
  },
  "forgot-password": {
    q: "Esqueci minha senha.",
    a: "Use «Esqueceu a senha?» na página de entrada e depois digite sua nova senha duas vezes para confirmá-la. Você também pode entrar apenas com um link por e-mail, se preferir não usar senha nenhuma.",
  },
  "was-asked-reset-password": {
    q: "Por que me pediram para redefinir minha senha?",
    a: "Por precaução de segurança, pedimos a todas as pessoas que entram com senha que escolham uma nova. Sua senha antiga não serve mais para entrar: na primeira vez que você tenta usá-la, enviamos um link de redefinição para o endereço de e-mail da sua conta. Abra esse link e escolha uma nova senha (ela não pode ser igual à antiga), ou peça um novo link com «Esqueceu a senha?» na página de entrada. Entrar com um link por e-mail, com o Google ou com a Apple não é afetado.",
  },
  "set-interests-find-specific-job": {
    q: "Como defino meus interesses ou encontro um trabalho ou uma profissão específica?",
    a: "Busque na configuração inicial do seu perfil ou em Configurações → «Editar perfil» → «Interesses». Além dos interesses gerais, a lista inclui cargos e profissões específicos (como Tax Advising, System Administrator ou UX Designer, que aparecem em inglês), então você não fica limitado a categorias amplas.",
  },
  "need-sign-up": {
    q: "Do que preciso para me cadastrar?",
    a: "Na página inicial, toque em «Primeira vez aqui? Crie sua conta grátis». Digite um nome de usuário (de 3 a 20 letras, números ou sublinhados), seu e-mail, uma senha e sua data de nascimento, e depois escolha como verificar a conta: com um código por e-mail ou com um número de telefone (digite-o ali mesmo: escolha seu país na lista e digite seu número como faria normalmente; o código do país é adicionado para você). Toque em «Criar conta» e enviamos o código. Depois você pode mudar seu nome de usuário em Configurações.",
  },
  languages: {
    q: "Posso usar o YuKon3t em um idioma que não seja o inglês?",
    a: "Sim. O YuKon3t está disponível em inglês, espanhol, francês, português e árabe: a página inicial e o cadastro, o aplicativo inteiro depois que você entra, estas perguntas frequentes, e os e-mails e as mensagens de verificação que enviamos para a sua conta. Ele abre no idioma do seu celular ou navegador quando é um dos cinco; para trocar, use o menu «Idioma» no canto superior da página inicial (abaixo de «Entrar») ou no fim das outras telas da conta, ou Configurações → «Idioma» depois de entrar. A escolha fica gravada naquele dispositivo. Em árabe, o aplicativo é lido da direita para a esquerda. Algumas coisas existem só em inglês: as páginas legais (Termos, Privacidade, Diretrizes da comunidade, Aviso legal), os cargos nas listas de interesses e de categorias, a tela de chamada recebida que o seu próprio celular mostra e as ferramentas usadas pelos administradores. As notificações enviadas ao seu celular ficam no idioma que você escolheu por último em um menu «Idioma» ou, se você nunca escolheu um, no idioma do seu celular ou navegador (em inglês até você abrir o YuKon3t de novo). Alguns avisos antigos continuam em inglês, como foram escritos. O que as pessoas escrevem aparece no idioma em que foi escrito, com um botão «Traduzir» embaixo quando não é o seu idioma (veja «Posso ler publicações e mensagens escritas em outro idioma?»).",
  },
  "translate-posts-messages": {
    q: "Posso ler publicações e mensagens escritas em outro idioma?",
    a: "Sim. Quando uma publicação, um comentário ou uma mensagem de conversa está escrito em um idioma diferente daquele em que você usa o YuKon3t (inglês, espanhol, francês, português ou árabe), aparece um botão «Traduzir» embaixo. Toque nele para ler no seu idioma; a tradução vem identificada (por exemplo, «Traduzido do inglês») e «Ver original» volta ao texto original. Nada muda para mais ninguém: quem escreveu, e todas as outras pessoas, continuam vendo exatamente o que foi escrito. Para traduzir automaticamente sem tocar toda vez, ative Configurações → «Idioma» → «Traduzir automaticamente publicações, comentários e mensagens para o meu idioma» (desativado por padrão); o texto passa a ser traduzido assim que aparece na tela. As traduções são feitas por um serviço de IA (OpenAI), que recebe o texto só quando ele é traduzido, e podem não ser perfeitas; links, @menções e #hashtags continuam como foram escritos. Uma tradução é guardada e reutilizada para qualquer outra pessoa que leia o mesmo texto no mesmo idioma, e é apagada quando o texto é editado ou excluído. Conversas secretas nunca são traduzidas (o texto delas só pode ser lido no seu dispositivo), e textos muito curtos, emojis, links sozinhos e textos muito longos (mais de 2.000 caracteres) não oferecem tradução.",
  },
  "sign-up-says-something-needs": {
    q: "O cadastro diz que algo precisa ser corrigido. Perdi o que digitei?",
    a: "Não. Se algo não puder ser aceito (um nome de usuário já em uso, um e-mail que já tem conta, um número de telefone que não corresponde ao país escolhido), o formulário mostra só as partes que precisam de correção, cada uma com o motivo logo abaixo. Todo o resto que você digitou, incluindo sua senha e sua data de nascimento, é mantido. Corrija o que aparece e toque em «Criar conta» de novo, ou toque em «Editar todos os dados» para ver o formulário inteiro.",
  },
  "verify-account-after-signing-up": {
    q: "Como verifico minha conta depois de me cadastrar?",
    a: "No cadastro, escolha e-mail ou telefone: enviamos um código de 6 dígitos para o que você escolher, e você o digita na tela seguinte para terminar de criar a conta. Não recebeu, ou o código expirou? É só reabrir essa tela e um novo é enviado automaticamente, sem precisar procurar um botão de reenviar (embora exista um, se você quiser acionar por conta própria). Se o e-mail demorar a chegar, use «Usar telefone» nessa tela para verificar por mensagem de texto; e, se a mensagem de texto não chegar, «Usar código por e-mail» leva você de volta. Você também pode entrar a qualquer momento para continuar de onde parou.",
  },
  "why-verify-human-app": {
    q: "Por que às vezes me pedem para verificar que sou uma pessoa no app?",
    a: "Ao se cadastrar, entrar ou redefinir a senha, verificamos se há uma pessoa real por trás da solicitação. Na web, é o toque em «Verificar que você é humano». No app do YuKon3t, ele pode, em vez disso, confirmar que é o app genuíno e não modificado, rodando em um dispositivo genuíno, usando o Play Integrity do Google no Android e o App Attest da Apple no iPhone. Quando essa verificação é aprovada, talvez você nem precise tocar. Você ainda verá o toque se estiver no site, usando uma cópia modificada ou não oficial do app, um dispositivo com root ou um emulador, ou se o app não conseguir concluir a verificação naquele momento. Nada dessa verificação fica guardado na sua conta; mantemos apenas um resultado anônimo (aprovada ou não, plataforma e versão do app) para detectar abusos.",
  },
  "says-account-locked-happened": {
    q: "Aparece que minha conta está bloqueada. O que aconteceu?",
    a: "Depois de 4 tentativas com senha incorreta, a conta fica bloqueada por 24 horas, como medida de segurança. Redefinir sua senha (por «Esqueceu a senha?» na página de entrada) a desbloqueia imediatamente: você não precisa esperar as 24 horas. Se ainda assim não conseguir, fale com o suporte e podemos enviar um link de redefinição diretamente para o seu e-mail cadastrado.",
  },

  "who-see-posts-profile": {
    q: "Quem pode ver minhas publicações e meu perfil?",
    a: "Você controla isso em Configurações → «Privacidade»: suas publicações podem ficar visíveis para qualquer pessoa que tenha entrado na conta ou só para as suas conexões, e você pode tirar seu perfil do Descobrir por completo.",
  },
  "trust-score-trust-badge": {
    q: "O que é a pontuação de confiança ou o selo de confiança?",
    a: "Um indicador construído a partir de coisas como verificação por e-mail ou por telefone, tempo de conta, o quanto o perfil está completo e sequências de atividade, menos as denúncias contra você que foram consideradas procedentes. É um indicador de reputação, não uma verificação de antecedentes.",
  },
  "someone-know-take-screenshot": {
    q: "Alguém fica sabendo se eu fizer uma captura de tela?",
    a: "Nos aplicativos nativos para Android e iOS, sim, em alguns lugares: durante uma chamada de voz ou de vídeo (os dois são avisados na hora) e ao ver a publicação, o story, a mensagem direta ou o perfil de outra pessoa; nesse caso, o dono recebe uma notificação de que você fez uma captura de tela. Fazer uma captura do seu próprio conteúdo nunca notifica ninguém. Isso não está disponível em um navegador comum, porque ali não há um jeito confiável de detectar uma captura de tela.",
  },
  "save-someones-profile-picture": {
    q: "Posso salvar a foto de perfil de outra pessoa?",
    a: "Não pelo YuKon3t. As fotos de perfil não têm opção de salvar, baixar ou compartilhar, nem quando você toca em uma para ampliá-la, e os atalhos de tocar e segurar, clicar com o botão direito e arrastar para salvar ficam desativados para elas. É uma medida para desencorajar, não um bloqueio: o YuKon3t não consegue impedir uma captura de tela nem deter alguém decidido a copiar o que aparece na própria tela, então use uma foto de perfil que você não se importe que outras pessoas vejam. Publicações, stories e Muse mantêm as próprias opções de salvar e compartilhar.",
  },
  "report-someone-something": {
    q: "Como denuncio alguém ou alguma coisa?",
    a: "Use o menu «⋯» de uma publicação, de um comentário ou de uma mensagem, ou a opção de denunciar em um perfil. Toda denúncia é triada, e toda medida tomada informa um motivo. Consulte nossas [Diretrizes da comunidade](/legal/guidelines) (em inglês) para saber o que é aplicado.",
  },
} satisfies Partial<FaqItems>;
