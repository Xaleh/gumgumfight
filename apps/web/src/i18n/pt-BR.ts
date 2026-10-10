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
  // ==== /menu ====


  // ==== home ====
  // ==== /home ====


  // ==== deck ====
  // ==== /deck ====


  // ==== card ====
  // ==== /card ====


  // ==== online ====
  // ==== /online ====


  // ==== watch ====
  // ==== /watch ====


  // ==== admin ====
  // ==== /admin ====


  // ==== reports ====
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
