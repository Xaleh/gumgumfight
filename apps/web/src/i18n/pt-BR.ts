// Português (Brasil): idioma padrão e referência das chaves. Todo idioma novo precisa ter
// exatamente estas chaves (ver `Messages`). Sintaxe de {param} e {n|# um|# vários}: index.ts.

const ptBR = {
  // ---- geral ----
  'app.name': 'GumGum Fight',
  'app.error': 'Algo deu errado',
  'common.close': 'Fechar',
  'common.back': 'Voltar',
  'common.save': 'Salvar',
  'common.saving': 'Salvando…',
  'common.cancel': 'Cancelar',
  'common.ok': 'OK',
  'common.yes': 'Sim',
  'common.no': 'Não',
  'common.loading': 'Carregando…',

  // ---- barra superior / gaveta ----
  'topbar.home': 'GumGum Fight: início',
  'topbar.nav': 'Principal',
  'topbar.counting': 'Contando quem está online',
  'topbar.online': '{n|# conectado|# conectados}',
  'topbar.onlineWord': '{n|conectado|conectados}',
  'topbar.account': 'Conta',
  'topbar.signIn': 'Entrar',
  'topbar.openMenu': 'Abrir menu',
  'topbar.closeMenu': 'Fechar menu',
  'topbar.menu': 'Menu',
  'topbar.themeDark': 'Tema escuro',
  'topbar.themeLight': 'Tema claro',
  'topbar.signOut': 'Sair',
  'topbar.language': 'Idioma',
  'account.google': 'Conta Google',
  'account.signInHint': 'Entre para guardar decks e estatísticas na sua conta e jogar a ranqueada.',
  'account.guest': 'Visitante',
  'account.loginOff': 'O login está desligado neste servidor.',

  // ---- configurações ----
  'settings.title': '⚙️ Configurações',
  'settings.dialog': 'Configurações',
  'settings.language': 'Idioma',
  'settings.languageHint': 'Idioma da interface. O texto das cartas sai traduzido em português; nos outros idiomas, aparece o original em inglês.',
  'settings.theme': 'Tema',
  'settings.themeHint': 'Claro, escuro ou o mesmo do aparelho.',
  'settings.themeSystem': 'Automático',
  'settings.themeSystemShort': 'Auto',
  'settings.themeSystemTitle': 'Segue o tema do aparelho',
  'settings.themeLight': 'Claro',
  'settings.themeLightTitle': 'Tema claro',
  'settings.themeDark': 'Escuro',
  'settings.themeDarkTitle': 'Tema escuro',
  'settings.nickname': 'Apelido',
  'settings.nicknameHint': 'O nome que o oponente vê nas partidas online e contra o bot, e que aparece no ranking (2 a 24 letras).',
  'settings.images': 'Imagens das cartas',
  'settings.imagesHint': 'Mostra a arte oficial das cartas. Desligue para carregar menos dados.',
  'settings.imagesOff': 'Desativadas neste servidor (CARD_IMAGES=off).',
  'settings.imagesOffTitle': 'Imagens desativadas neste servidor (CARD_IMAGES=off)',
  'settings.quickCounter': 'Counter sem confirmação',
  'settings.quickCounterHint': 'Na etapa de Counter, tocar numa carta (ou arrastá-la até a mesa) usa o Counter na hora.',
  'settings.quickCounterTitle': 'Na etapa de Counter, tocar numa carta ou arrastá-la até a mesa usa o Counter na hora',
  'settings.animations': 'Animações',
  'settings.animationsHint': 'Cartas voando pela mesa, faixa de troca de turno e sorteio inicial com dados.',
  'settings.replayCues': 'Cliques no replay',
  'settings.replayCuesHint':
    'Ao assistir a um replay, mostra o que o jogador clicou ou escolheu (contorno nas cartas, toque e legenda) antes de cada ação. Desligue para ver só a mesa.',
  'settings.replayCuesTitle': 'No replay, mostra o que o jogador clicou ou escolheu (contorno nas cartas, toque e legenda) antes de cada ação',
  'settings.opponentChat': 'Chat do oponente',
  'settings.opponentChatHint':
    'Nas partidas online, mostra as mensagens e os emotes que o oponente manda. Desligue para não ver nada que ele escreve; as suas mensagens continuam saindo.',
  'settings.opponentChatTitle': 'Nas partidas online, mostra as mensagens e os emotes que o oponente manda',
  'settings.sfx': 'Efeitos sonoros',
  'settings.sfxHint': 'Cartas, DON!!, ataques, dano, dados e o resultado da partida. No iPhone, a chave de silencioso também vale.',
  'settings.sfxLabel': 'efeitos sonoros',
  'settings.music': 'Música',
  'settings.musicHint': 'Trilha original do GumGum Fight no menu e na partida.',
  'settings.musicLabel': 'música',
  'settings.mute': 'Silenciar',
  'settings.unmute': 'Ligar',
  'settings.muteLabel': 'Silenciar {what}',
  'settings.unmuteLabel': 'Ligar {what}',
  'settings.footer': 'As configurações ficam guardadas neste navegador e valem para todas as partidas. O apelido fica no servidor, ligado a este navegador.',

  // ---- rótulos usados em várias telas (api.ts) ----
  'labels.role.player': 'Player',
  'labels.role.streamer': 'Streamer',
  'labels.role.organizer': 'Organizador',
  'labels.role.admin': 'Admin',
  'labels.role.dev': 'Dev',
  'labels.structure.swiss': 'Suíço',
  'labels.structure.single': 'Eliminação simples',
  'labels.tourStatus.registration': 'Inscrições abertas',
  'labels.tourStatus.running': 'Em andamento',
  'labels.tourStatus.finished': 'Encerrado',

  // ==== menu ====
  // ---- navegação ----
  'menu.navPlay': 'Jogar',
  'menu.navDecks': 'Montar decks',
  'menu.navTournaments': 'Torneios',
  'menu.navWatch': 'Assistir',
  'menu.navStats': 'Estatísticas',
  'menu.navSettings': 'Configurações',
  'menu.navReplay': 'Assistir replay',
  'menu.navAdmin': 'Administração',
  'menu.navCoverage': 'Cobertura das cartas',
  'menu.footerNav': 'Rodapé',
  'menu.disclaimer':
    'Projeto de fã, sem fins lucrativos e sem vínculo com a Bandai, Toei Animation ou Shueisha. As traduções para português são automáticas e não oficiais.',
  // ---- conexão ----
  'menu.connecting': 'Conectando ao servidor…',
  'menu.connectFailed': 'Não foi possível conectar ao servidor. Veja as mensagens [server] no terminal do npm run dev.',
  // ---- hero ----
  'menu.heroKicker': 'One Piece Card Game no navegador',
  'menu.heroTitle': 'Escolha seu modo',
  'menu.heroSub': 'Toda partida usa o deck equipado. Escolha uma fila e entre num duelo 1 contra 1, ou treine contra o bot.',
  'menu.myStats': 'Minhas estatísticas',
  'menu.watchMatches': 'Assistir partidas',
  'menu.watchReplayTitle': 'Assistir a um replay baixado (.json)',
  'menu.nickname': 'Apelido',
  'menu.nicknameTitle': 'Mudar o apelido (Configurações)',
  'menu.onlineWord': '{n|conectado|conectados}',
  'menu.liveMatchesWord': '{n|partida ao vivo|partidas ao vivo}',
  'menu.inQueueNow': 'na fila agora',
  // ---- avisos de partida aberta ----
  'menu.playingBot': 'Você tem um treino contra o bot em andamento.',
  'menu.playingTournament': 'Você tem uma partida de torneio em andamento.',
  'menu.playingOnline': 'Você tem uma partida online em andamento.',
  'menu.clockRunning': 'Seu relógio pode estar correndo.',
  'menu.backToMatch': 'Voltar à partida',
  'menu.roomWaiting': 'Sua sala {code} está esperando um oponente.',
  'menu.roomWaitingHint': 'Envie o código ou o link para quem vai jogar com você.',
  'menu.openRoom': 'Abrir sala',
  // ---- deck equipado ----
  'menu.equippedDeck': 'Deck equipado',
  'menu.opponentDeck': 'Deck do oponente',
  'menu.chooseDeck': 'Escolha um deck',
  'menu.loadingDecks': 'Carregando decks…',
  'menu.leaderChip': 'Líder: {name}',
  'menu.incompleteChip': '{size}/50 cartas: incompleto',
  'menu.validIn': 'Válido no {format}',
  'menu.notAllowedIn': 'Não permitido no {format}',
  'menu.notAllowedShort': '🚫 {format}',
  'menu.unscriptedChip': '⚙ {n} sem efeito automático',
  'menu.unscriptedTitle': 'Essas cartas entram no jogo, mas sem o efeito automático',
  'menu.changeDeck': 'Trocar deck',
  'menu.format': 'Formato',
  'menu.randomDeck': 'Aleatório',
  'menu.choose': 'Escolher',
  // ---- modos de jogo ----
  'menu.modes': 'Modos de jogo',
  'menu.modesHint': 'Contadores ao vivo, atualizados a cada 10 s',
  'menu.counting': 'Contando…',
  'menu.queueLive': '{n|# partida|# partidas} · {q} na fila',
  'menu.findMatch': 'Buscar partida',
  'menu.pickDeck': 'Escolha um deck.',
  'menu.deckNotValidIn': 'O deck equipado não vale no {format}.',
  'menu.finishCurrent': 'Termine a partida em andamento primeiro.',
  'menu.rankedKicker': 'Competitivo',
  'menu.ranked': 'Ranqueada',
  'menu.rankedDesc': 'Vale bounty. Você enfrenta quem está perto do seu nível.',
  'menu.chipGoogleLogin': 'Login com Google',
  'menu.chipNoManual': 'Sem efeitos manuais',
  'menu.rankedNeedsLogin': 'Entre com o Google para jogar a ranqueada.',
  'menu.rankedManualCards':
    '{n|O deck tem # carta com efeito manual (⚙), que a ranqueada não permite.|O deck tem # cartas com efeito manual (⚙), que a ranqueada não permite.}',
  'menu.casualKicker': 'Casual',
  'menu.casual': 'Partida rápida',
  'menu.casualDesc': 'Sem bounty em jogo. Ideal para testar um deck novo.',
  'menu.chipAnyDeck': 'Qualquer deck válido',
  'menu.chipClock': 'Relógio de {time}',
  'menu.privateKicker': 'Com amigos',
  'menu.private': 'Sala privada',
  'menu.privateDesc': 'Crie uma sala e mande o código, ou entre na sala de um amigo.',
  'menu.privateLive': '{n|# partida|# partidas} · {w|# sala esperando|# salas esperando}',
  'menu.createRoom': 'Criar sala',
  'menu.roomCode': 'Código da sala',
  'menu.roomCodePlaceholder': 'ABC123',
  'menu.joinRoom': 'Entrar',
  'menu.botKicker': 'Treino',
  'menu.vsBot': 'Contra o bot',
  'menu.botDesc': 'Treine com qualquer deck, sem fila e sem pressa.',
  'menu.botLive': '{n|# treino transmitido|# treinos transmitidos}',
  'menu.botLocal': 'Roda no seu navegador',
  'menu.bothDecksValid': 'Os dois decks precisam valer no {format}.',
  'menu.battle': 'Batalhar!',
  'menu.opponent': 'Oponente: {name}',
  'menu.whoStarts': 'Quem começa',
  'menu.firstRandom': 'Sorteio',
  'menu.you': 'Você',
  'menu.botName': 'Bot',
  'menu.botLevel': 'Nível do bot',
  'menu.botEasy': 'Fácil',
  'menu.botNormal': 'Normal',
  'menu.botHard': 'Difícil',
  'menu.broadcast': 'Transmitir esta partida',
  'menu.broadcastNeedsLogin': 'Transmitir: entre com o Google',
  'menu.broadcastTitle': 'A partida aparece em "Assistir".',
  'menu.broadcastFull': 'A transmissão está lotada agora: este treino roda no seu navegador, sem espectadores.',
  'menu.noBuiltinDeck': 'Nenhum deck pronto é permitido no {format}.',
  'menu.tourKicker': 'Eventos',
  'menu.tourBadge': 'Suíço e mata-mata',
  'menu.tourDesc': 'Torneios da comunidade, com chave, rodadas e relógio.',
  'menu.chipTourLogin': 'Inscrição com login',
  'menu.chipBestOf': 'Melhor de 1 ou de 3',
  'menu.tourLive': '{n|# aberto|# abertos} · {running} em andamento',
  'menu.seeTournaments': 'Ver torneios',
  // ---- opções de teste (Dev) ----
  'menu.testOptions': 'Opções de teste',
  'menu.testSeed': 'Seed do embaralhamento',
  'menu.testSeedRerollTitle': 'Sortear outra',
  'menu.testSeedHint':
    'Número que define a ordem dos decks e o sorteio de quem começa, nas partidas contra o bot. A mesma seed com as mesmas jogadas repete a partida exatamente, o que é útil para reproduzir um problema.',
  // ---- fila online (OnlineMenu) ----
  'menu.onlineRanked': 'Ranqueada',
  'menu.onlineCasual': 'Casual',
  'menu.onlineSearching': 'Procurando oponente',
  'menu.onlineQueuePlayers': '{n} jogadores na fila',
  'menu.onlineQueueAlone': 'Você é o único na fila agora.',
  // ---- erro de tela (ErrorBoundary) ----
  'menu.errorHint': 'Algo deu errado ao desenhar a tela. A partida continua: tente de novo.',
  'menu.errorRetry': 'Tentar de novo',
  'menu.errorBackToMenu': 'Voltar ao menu',
  'menu.errorReload': 'Recarregar a página',
  // ==== /menu ====


  // ==== home ====
  // ---- tipos de sala ----
  'home.queue.private': 'Sala privada',
  'home.queue.casual': 'Casual',
  'home.queue.ranked': 'Ranqueada',
  'home.queue.bot': 'Treino',
  'home.queue.tournament': 'Torneio',
  // ---- ao vivo agora ----
  'home.liveNow': 'Ao vivo agora',
  'home.seeAllMatches': 'Ver todas',
  'home.versus': '{a} vs {b}',
  'home.whereTurn': '{where} · Turno {turn}',
  'home.watching': '{n} assistindo',
  'home.watch': 'Assistir',
  'home.noLive': 'Nenhuma partida pública agora. Que tal começar uma?',
  // ---- atalho do torneio em jogo ----
  'home.timeLeft': 'restam {m}min{s}s',
  'home.deadlinePassed': 'o prazo acabou',
  'home.checkInOpenFor': 'Check-in aberto: {name}',
  'home.checkedInStarts': '✔ Check-in feito. O torneio começa às {time}: a sua sala aparece aqui.',
  'home.confirmPresence': 'O torneio começa às {time}. Confirme a sua presença.',
  'home.openTournament': 'Abrir torneio',
  'home.doCheckIn': 'Fazer check-in',
  'home.matchTitle': '{name} · {label}: mesa {table} contra {opponent}',
  'home.matchTitleGame': '{name} · {label}: mesa {table} contra {opponent} (jogo {game})',
  'home.matchRunning': 'A partida está em andamento.',
  'home.enterUntil': 'Entre na sala até {time} ({left}). Quem não entra perde por W.O.',
  'home.oneWaiting': 'Uma das pessoas já está na sala esperando.',
  'home.firstWaits': 'Quem entra primeiro espera o oponente na sala.',
  'home.backToGame': 'Voltar ao jogo',
  'home.enterRoom': 'Entrar na sala',
  'home.tournamentRunning': '{name} em andamento',
  'home.bye': 'Você está de bye nesta rodada. Aguarde a próxima.',
  'home.roundDone': 'Sua partida desta rodada terminou. Aguarde a próxima rodada.',
  // ---- torneios ----
  'home.tournaments': 'Torneios',
  'home.seeAllTournaments': 'Ver todos',
  'home.round': 'Rodada {n}',
  'home.roundOf': 'Rodada {n} de {total}',
  'home.checkInOpen': 'Check-in aberto',
  'home.registered': '{count} inscritos',
  'home.playersCount': '{count} jogadores',
  'home.noTournaments': 'Nenhum torneio aberto agora.',
  'home.noTournamentsCreate': 'Nenhum torneio aberto agora. Que tal organizar um?',
  // ---- meta da semana ----
  'home.meta': 'Meta da semana',
  'home.stats': 'Estatísticas',
  'home.metaSub': 'Líderes mais jogados nos últimos 7 dias',
  'home.noMeta': 'Ainda não há partidas nos últimos 7 dias.',
  // ==== /home ====


  // ==== deck ====
  // ==== /deck ====


  // ==== card ====
  // ==== /card ====


  // ==== online ====
  // ---- ligas da ranqueada ----
  'online.tier.eastBlue': 'East Blue',
  'online.tier.paradise': 'Paradise',
  'online.tier.newWorld': 'Novo Mundo',
  'online.tier.supernova': 'Supernova',
  'online.tier.warlord': 'Shichibukai',
  'online.tier.emperor': 'Yonkou',
  // ---- emotes ----
  'online.emote.hello': 'Olá! 👋',
  'online.emote.gg': 'Boa partida! 🤝',
  'online.emote.nice': 'Boa jogada! 👏',
  'online.emote.think': 'Hmm… 🤔',
  'online.emote.wow': 'Uau! 😮',
  'online.emote.oops': 'Ops! 😅',
  'online.emote.thanks': 'Valeu! 🙏',
  'online.emote.hurry': 'Vamos lá? ⏳',
  // ---- relógio e conexão ----
  'online.clockTitle': 'Tempo total do jogador: só corre quando a ação ou a decisão é dele',
  'online.connected': 'Conectado',
  'online.disconnected': 'Desconectado',
  'online.connLost': 'Conexão perdida. Reconectando…',
  'online.roomGone': 'A partida não existe mais.',
  'online.playerLeft': '{name} desconectou.',
  'online.opponentLeft': '{name} desconectou. Se ficar 2 minutos fora na vez dele, perde por abandono.',
  // ---- chat ----
  'online.you': 'Você',
  'online.opponent': 'Oponente',
  'online.chatLabel': 'Chat da partida',
  'online.chatTitle': 'Chat e mensagens rápidas',
  'online.chat': 'Chat',
  'online.unmuteTitle': 'Voltar a ver as mensagens e emotes do oponente nesta partida',
  'online.muteTitle': 'Esconder as mensagens e emotes do oponente só nesta partida',
  'online.muted': '🔇 Silenciado',
  'online.mute': '🔊 Silenciar',
  'online.closeChatLabel': 'Fechar o chat',
  'online.noMessages': 'Nenhuma mensagem ainda.',
  'online.opponentHidden': 'Mensagens do oponente escondidas.',
  'online.messagePlaceholder': 'Mensagem para o oponente…',
  'online.messageLabel': 'Mensagem',
  'online.send': 'Enviar',
  // ---- fim da partida ----
  'online.seriesScore': 'placar da série',
  'online.seriesWon': ' — você venceu a série!',
  'online.seriesOver': ' — série encerrada.',
  'online.bounty': 'Recompensa:',
  'online.rematchWanted': '{name} quer revanche!',
  'online.report': '⚑ Relatar um problema',
  // ---- espera ----
  'online.shareText': 'Vamos jogar? Código da sala: {code}',
  'online.cannotWatch': 'Não foi possível assistir',
  'online.notFound': 'Partida não encontrada',
  'online.roomExpired': 'A sala foi cancelada ou expirou.',
  'online.tourGame': ' · Jogo {game} da melhor de {bestOf} (placar {a}–{b})',
  'online.tourStartHint': 'O jogo começa quando o seu oponente clicar em "Jogar" na página do torneio.',
  'online.waitingOpponent': 'Aguardando o oponente',
  'online.privateRoom': 'Sala privada',
  'online.privateHint': 'Envie o código ou o link para quem vai jogar com você. A partida começa quando a pessoa entrar.',
  'online.linkCopied': 'Link copiado!',
  'online.shareLink': 'Compartilhar link',
  'online.reconnecting': 'Reconectando',
  'online.connecting': 'Conectando',
  'online.cancelRoom': 'Cancelar sala',
  'online.backToMenu': 'Voltar ao menu',
  // ---- espectadores ----
  'online.spectatorsTitle': '{n|# pessoa assistindo|# pessoas assistindo}',
  'online.watchingTitle': '{n} assistindo',
  'online.watching': '👁 Assistindo · {n}',
  'online.handsTitle': 'Mostra as mãos dos dois jogadores (perfil Streamer ou Admin)',
  'online.hands': 'Ver mãos',
  // ==== /online ====


  // ==== watch ====
  'watch.menu': '← Menu',
  'watch.title': 'Assistir partidas',
  'watch.queue.ranked': '🏆 Ranqueada',
  'watch.queue.casual': 'Casual',
  'watch.queue.private': 'Sala privada',
  'watch.queue.bot': '🤖 Treino contra o bot',
  'watch.queue.tournament': '🏆 Torneio',
  'watch.showHands': 'Ver as mãos dos jogadores',
  'watch.handsRole': '(perfil {role})',
  'watch.noHandsHint': 'Você assiste sem ver as mãos dos jogadores. Ver as mãos é só para os perfis Streamer e Admin.',
  'watch.empty': 'Nenhuma partida em andamento agora. A lista se atualiza sozinha.',
  'watch.tourLine': '🏆 {name} · {label}',
  'watch.tourGame': ' · Jogo {n}',
  'watch.mineTitle': 'Você joga esta partida: ela aparece sem as mãos dos jogadores',
  'watch.mine': 'Sua partida',
  'watch.turn': 'Turno {n}',
  'watch.openingHand': 'Mão inicial',
  'watch.vs': 'VS',
  'watch.privateRoom': 'Sala privada',
  'watch.privateHint': 'Salas privadas não aparecem na lista: peça o código a quem está jogando.',
  'watch.codePlaceholder': 'Código',
  'watch.watch': 'Assistir',
  // ==== /watch ====


  // ==== admin ====
  'admin.menu': '← Menu',
  'admin.title': 'Administração',
  'admin.tabUsers': 'Perfis das contas',
  'admin.tabReports': 'Relatos de partidas',
  'admin.roleHelp.player': 'Joga e assiste às partidas sem ver as mãos.',
  'admin.roleHelp.streamer': 'Assiste às partidas podendo ver as mãos dos dois jogadores.',
  'admin.roleHelp.organizer': 'Cria torneios e gerencia os que criou (inscrições, rodadas e resultados).',
  'admin.roleHelp.admin': 'Tudo do Streamer e do Organizador, gerencia qualquer torneio e muda os perfis das contas.',
  'admin.roleHelp.dev': 'Tudo do Admin e as funções de desenvolvimento: ferramentas manuais na partida, cobertura das cartas e opções de teste.',
  'admin.searchPlaceholder': 'Buscar por nome ou e-mail',
  'admin.noAccounts': 'Nenhuma conta encontrada.',
  'admin.googleAccount': 'Conta Google',
  'admin.selfRoleTitle': 'Você só pode mudar o seu próprio perfil para Dev',
  // ---- cobertura das cartas ----
  'admin.coverage.menu': '← Menu',
  'admin.coverage.title': 'Cobertura das cartas',
  'admin.coverage.scripted': 'Efeito automatizado',
  'admin.coverage.vanilla': 'Sem efeito',
  'admin.coverage.partial': 'Parcial (parte automática, parte manual)',
  'admin.coverage.manual': 'Manual',
  'admin.coverage.barTitle': '{title}: {n}',
  'admin.coverage.percent': '{n}%',
  'admin.coverage.partialManual': '({partial} parciais, {manual} manuais)',
  'admin.coverage.legendScripted': 'efeito automatizado',
  'admin.coverage.legendVanilla': 'sem efeito (nada a automatizar)',
  'admin.coverage.legendPartial': 'parcial (parte dos efeitos é automática)',
  'admin.coverage.legendManual': 'manual (o efeito ainda não é aplicado na partida).',
  'admin.coverage.legendAuto': '"Automático" = automatizadas + sem efeito.',
  'admin.coverage.colSet': 'Coleção',
  'admin.coverage.colCards': 'Cartas',
  'admin.coverage.colAutomation': 'Automação',
  'admin.coverage.colAuto': 'Automático',
  'admin.coverage.colPt': 'Tradução PT completa',
  // ==== /admin ====


  // ==== reports ====
  // ---- lista de relatos ----
  'reports.queue.private': 'Sala privada',
  'reports.queue.casual': 'Casual',
  'reports.queue.ranked': 'Ranqueada',
  'reports.queue.bot': 'Treino',
  'reports.queue.tournament': 'Torneio',
  'reports.none': 'Nenhum relato.',
  'reports.resolved': 'Resolvido',
  'reports.open': 'Aberto',
  'reports.tourInfo': ' · {name} · Rodada {round} · Mesa {table} · Jogo {game}',
  'reports.noWinner': 'sem vencedor',
  'reports.matchMissing': 'Partida #{id} (não encontrada).',
  'reports.resolvedAtNote': 'Resolvido em {date}: {note}',
  'reports.resolvedAt': 'Resolvido em {date}.',
  'reports.watchReplay': '▶ Assistir replay',
  'reports.reopen': 'Reabrir',
  'reports.notePlaceholder': 'Nota (opcional): o que foi feito',
  'reports.confirm': 'Confirmar',
  'reports.resolve': '✔ Resolver',
  'reports.filterOpen': 'Abertos',
  'reports.filterResolved': 'Resolvidos',
  'reports.filterAll': 'Todos',
  'reports.panelHint':
    'Os jogadores relatam problemas ao fim das partidas ranqueadas e de torneio. Toda partida fica gravada: o replay mostra exatamente o que aconteceu.',
  // ---- relatar um problema ----
  'reports.dialogLabel': 'Relatar problema',
  'reports.title': '⚑ Relatar um problema',
  'reports.sent': 'Relato enviado.',
  'reports.sentTournament': 'O organizador do torneio e os administradores vão analisar a partida pelo replay gravado.',
  'reports.sentAdmins': 'Os administradores vão analisar a partida pelo replay gravado.',
  'reports.describeTournament':
    'Descreva o que aconteceu (uma carta que não funcionou como devia, queda de conexão, comportamento do oponente…). O replay da partida fica gravado e vai junto com o relato para o organizador de {tournament} e para os administradores.',
  'reports.describeAdmins':
    'Descreva o que aconteceu (uma carta que não funcionou como devia, queda de conexão, comportamento do oponente…). O replay da partida fica gravado e vai junto com o relato para os administradores.',
  'reports.textPlaceholder': 'O que aconteceu?',
  'reports.sending': 'Enviando…',
  'reports.send': 'Enviar relato',
  // ==== /reports ====


  // ==== tour ====
  // ==== /tour ====


  // ==== stats ====
  // ---- taxas e intervalos ----
  'stats.noGames': 'Sem partidas',
  'stats.winRateTitle': '{wins|# vitória|# vitórias} em {games|# partida|# partidas} (95%: {lo} a {hi})',
  'stats.ciTitle': '95%: {lo} a {hi}',
  'stats.pp': '{sign}{value} pp',
  'stats.nameValue': '{name} ({value})',
  'stats.nameId': '{name} ({id})',
  'stats.listSep': ', ',
  'stats.gamesCount': '{n|# partida|# partidas}',

  // ---- perfil / recompensa ----
  'stats.wanted': 'WANTED',
  'stats.renameTitle': 'Trocar o nome',
  'stats.unnamedPirate': 'Pirata sem nome',
  'stats.tierOpen': '{min} ou mais',
  'stats.tierSpan': '{min} a {max}',
  'stats.tierRange': 'Faixa {range}.',
  'stats.nextTier': 'Próximo tier: {label} ({min}).',
  'stats.bountyHint': 'A recompensa sobe e desce nas partidas ranqueadas contra outros jogadores. Partidas contra o bot contam nas estatísticas como casuais.',
  'stats.bountyHintPlayed':
    'A recompensa sobe e desce nas partidas ranqueadas contra outros jogadores ({n|# jogada|# jogadas}). Partidas contra o bot contam nas estatísticas como casuais.',

  // ---- resumo (tiles) ----
  'stats.tileGames': 'Partidas',
  'stats.tilePlayers': '{n|# jogador|# jogadores}',
  'stats.tileWins': 'Vitórias',
  'stats.tileWinsOf': '{wins} de {games}',
  'stats.tileSecond': 'Como segundo',
  'stats.tileKeep': 'Mantendo a mão',
  'stats.tileMulligan': 'Com mulligan',
  'stats.first': 'Começando',
  'stats.second': 'Em segundo',

  // ---- resumo do meta ----
  'stats.metaTop': '{leader} é o Líder mais jogado ({share} das partidas), com {rate} de vitórias.',
  'stats.metaBest': 'Melhor taxa de vitórias entre os Líderes com pelo menos {min|# partida|# partidas}: {leader}, {rate} (em {share} das partidas).',
  'stats.metaBestSame': 'Além de ser o mais jogado, ele também lidera em vitórias entre os Líderes com pelo menos {min|# partida|# partidas}.',
  'stats.metaLosing': 'Muito jogados, mas perdendo: {list}.',
  'stats.metaFirstSecond': 'Quem começa vence {first} das partidas; quem joga em segundo, {second}.',
  'stats.metaMulligan': 'Depois de um mulligan a taxa é {mulligan}, contra {keep} mantendo a mão.',

  // ---- tabela de Líderes ----
  'stats.noGamesFilters': 'Nenhuma partida com esses filtros.',
  'stats.leader': 'Líder',
  'stats.colGames': 'Partidas',
  'stats.colWins': 'Vitórias',
  'stats.colInterval': 'Intervalo (95%)',
  'stats.colFirstShort': '1º',
  'stats.colFirstTitle': 'Vitórias começando a partida',
  'stats.colSecondShort': '2º',
  'stats.colSecondTitle': 'Vitórias jogando em segundo',
  'stats.colLists': 'Listas',
  'stats.colListsTitle': 'Listas diferentes usadas',
  'stats.rowCardsTitle': 'Ver as cartas deste Líder',
  'stats.hiddenLeaders': '{n|# Líder|# Líderes} com menos de {min|# partida|# partidas} {n|escondido|escondidos}. Mude o mínimo nos filtros para ver.',

  // ---- matchups ----
  'stats.backToMatrix': '← Tabela de todos os Líderes',
  'stats.vsEachLeader': '{leader} contra cada Líder',
  'stats.noMatchups': 'Nenhum matchup deste Líder com {min|# partida|# partidas} ou mais.',
  'stats.colOpponent': 'Adversário',
  'stats.colFirstMatchupTitle': 'Vitórias do Líder analisado quando ele começa',
  'stats.colSecondMatchupTitle': 'Vitórias do Líder analisado jogando em segundo',
  'stats.hiddenOpponents': '{n|# adversário|# adversários} com menos de {min|# partida|# partidas} {n|escondido|escondidos}.',
  'stats.matrixHint':
    'Linha = Líder analisado, coluna = Líder adversário. A cor vai do laranja (perde mais) ao azul (vence mais), passando pelo cinza em 50%. Na diagonal (espelho), a taxa é de quem começou. Células com menos de {min|# partida|# partidas} mostram só a quantidade. Clique numa linha para ver todos os adversários daquele Líder.',
  'stats.cellTitle': '{a} x {b}: {wins|# vitória|# vitórias} em {games}; começando: {rate} em {firstGames}',
  'stats.mirrorGames': '1º · {n}',

  // ---- tendência ----
  'stats.sparkPoint': '{label}: {value}',
  'stats.weeks': 'Semanas',
  'stats.weeksCount': '{n|# semana|# semanas}',
  'stats.risers': 'Subindo nesta semana: {list}.',
  'stats.fallers': 'Caindo: {list}.',
  'stats.noTrend': 'Nenhum Líder com {min|# partida|# partidas} ou mais nessas semanas.',
  'stats.colUsage': 'Uso ({from} → {to})',
  'stats.colUsageTitle': 'Participação nas partidas de cada semana',
  'stats.colThisWeek': 'Nesta semana',
  'stats.colUsageDelta': 'Δ uso',
  'stats.colUsageDeltaTitle': 'Variação da participação em relação à semana anterior',
  'stats.colWinsWeek': 'Vitórias na semana',
  'stats.colWinsPeriod': 'Vitórias no período',
  'stats.rowMatchupsTitle': 'Ver os matchups deste Líder',
  'stats.trendFooter': 'Semanas começam na segunda-feira. O período dos filtros não vale aqui: a janela é a escolhida acima.',

  // ---- cartas ----
  'stats.noCards': 'Nenhuma carta com {min|# partida|# partidas} ou mais com esses filtros.',
  'stats.cardsHint':
    '{lift}: vitórias com a carta no deck menos as vitórias do Líder em geral ({base}); só aparece quando nem todas as listas usam a carta. {opening}: a carta estava na mão mantida após o mulligan. {drawn}: passou pela mão em algum momento. {iwd}: vitórias quando comprada menos vitórias quando não comprada; positivo indica que a carta ajuda quando aparece. Toque no cabeçalho para ordenar.',
  'stats.colCard': 'Carta',
  'stats.colInDeck': 'No deck',
  'stats.colInDeckTitle': 'Partidas com a carta no deck (média de cópias)',
  'stats.colLift': 'Lift',
  'stats.colLiftTitle': 'Vitórias com a carta no deck menos as vitórias do Líder em geral',
  'stats.colOpening': 'Mão inicial',
  'stats.colDrawn': 'Comprada',
  'stats.colNotDrawn': 'Não comprada',
  'stats.colIwd': 'Δ comprada',
  'stats.colIwdTitle': 'Diferença de vitórias entre comprar e não comprar a carta',
  'stats.colPlayed': 'Jogada',
  'stats.colPerGame': 'Usos/partida',
  'stats.colPerGameTitle': 'Vezes jogada (ou usada como Counter) por partida',
  'stats.copies': '×{n}',

  // ---- página / filtros ----
  'stats.backMenu': '← Menu',
  'stats.title': 'Estatísticas',
  'stats.updating': 'Atualizando…',
  'stats.filters': 'Filtros',
  'stats.all': 'Todos',
  'stats.allFem': 'Todas',
  'stats.filterFormat': 'Formato',
  'stats.filterQueue': 'Partida',
  'stats.filterOpponent': 'Oponente',
  'stats.opponentBot': 'Bot',
  'stats.opponentHuman': 'Jogador',
  'stats.filterTurnOrder': 'Ordem do turno',
  'stats.filterPeriod': 'Período',
  'stats.allTime': 'Tudo',
  'stats.days': '{n|# dia|# dias}',
  'stats.filterWhose': 'De quem',
  'stats.allPlayers': 'Todos os jogadores',
  'stats.onlyMe': 'Só eu',
  'stats.filterMin': 'Mínimo de partidas por linha',
  'stats.filterTiers': 'Tiers (recompensa na hora da partida)',
  'stats.tabLeaders': 'Líderes',
  'stats.tabMatchups': 'Matchups',
  'stats.tabTrend': 'Tendência',
  'stats.tabCards': 'Cartas',
  'stats.list': 'Lista',
  'stats.allLists': 'Todas as listas',
  'stats.listOption': '{name} · {n|# partida|# partidas}',
  'stats.footer':
    'Cada partida é refeita pelo servidor a partir do replay antes de entrar nas estatísticas. Taxas com menos de {n|# partida|# partidas} aparecem esmaecidas: passe o mouse para ver o intervalo de confiança.',
  // ==== /stats ====


  // ==== game ====
  // ==== /game ====


  // ==== board ====
  // ==== /board ====


  // ==== dice ====
  // ==== /dice ====


  // ==== result ====
  // ==== /result ====


  // ==== replay ====
  // ==== /replay ====


  // ==== ability ====
  // ==== /ability ====


  // ==== engine ====
  // ==== /engine ====


  // ==== errors ====
  // ==== /errors ====

} as const;

export type MessageKey = keyof typeof ptBR;
export type Messages = Record<MessageKey, string>;

export default ptBR satisfies Record<string, string>;
