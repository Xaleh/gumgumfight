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
