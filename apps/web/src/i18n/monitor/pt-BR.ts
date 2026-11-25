// Monitoramento (português do Brasil, referência das chaves): a aba "Monitoramento" da Administração e os erros
// das rotas /api/monitor e /api/admin/monitor.

const monitorPtBR = {
  'monitor.tab': 'Monitoramento',
  'monitor.hint':
    'Erros do servidor e do navegador (iguais ficam juntos), os canais ao vivo das partidas e o processo no ar. Atualiza a cada 15 s. O alerta de site fora do ar vem do GitHub (issue "Site fora do ar").',
  'monitor.testServer': 'Forçar erro no servidor',
  'monitor.testBrowser': 'Forçar erro no navegador',
  'monitor.testServerDone': 'Erro forçado no servidor. Ele aparece na lista abaixo.',
  'monitor.testBrowserDone': 'Erro forçado neste navegador. Ele aparece na lista em alguns segundos.',
  'monitor.refresh': 'Atualizar',
  'monitor.uptime': 'No ar há',
  'monitor.release': 'versão {release}',
  'monitor.memory': '{rss} MB de memória ({heap} MB de heap)',
  'monitor.sseOpen': 'Canais ao vivo abertos',
  'monitor.sseOpenSplit': '{online} em partidas · {yonko} no Yonko',
  'monitor.sse24h': 'Canais nas últimas 24 h',
  'monitor.sseOpened': '{n|# aberto|# abertos}',
  'monitor.sseDropsReconnects': '{drops} quedas · {reconnects} reconexões',
  'monitor.errorsOpen': 'Erros em aberto',
  'monitor.errors24h': '{n|# visto nas últimas 24 h|# vistos nas últimas 24 h}',
  'monitor.sseTitle': 'Canais ao vivo (SSE), por hora',
  'monitor.sseSinceStart':
    'Desde que o servidor subiu: {opened} abertos, {drops} quedas (o navegador ou a rede fechou), {ended} encerrados pelo servidor, {reconnects} reconexões; duração média {avg}.',
  'monitor.sseEmpty': 'Nenhum canal aberto nas últimas 24 h.',
  'monitor.hour': 'Hora',
  'monitor.opened': 'Abertos',
  'monitor.drops': 'Quedas',
  'monitor.reconnects': 'Reconexões',
  'monitor.peak': 'Pico',
  'monitor.errorsTitle': 'Erros',
  'monitor.showResolved': 'Mostrar os resolvidos',
  'monitor.clearResolved': 'Apagar os resolvidos ({n})',
  'monitor.noErrors': 'Nenhum erro. 🎉',
  'monitor.sourceServer': 'Servidor',
  'monitor.sourceWeb': 'Navegador',
  'monitor.kindTest': 'teste',
  'monitor.occurrences': '{n|# vez|# vezes}',
  'monitor.firstSeen': 'Primeira vez: {when}',
  'monitor.resolve': 'Marcar como resolvido',
  'errors.tooManyReports': 'Relatos de erro demais. Tente de novo mais tarde.',
  'errors.badErrorReport': 'Relato de erro inválido.',
  'errors.errorNotFound': 'Erro não encontrado.',
} as const;

export default monitorPtBR;
