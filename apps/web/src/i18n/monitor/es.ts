// Monitoramento (Español): a aba "Monitoramento" da Administração e os erros das rotas /api/monitor.

import type monitorPtBR from './pt-BR';

const monitor = {
  'monitor.tab': 'Monitoreo',
  'monitor.hint':
    'Errores del servidor y del navegador (los iguales se agrupan), los canales en vivo de las partidas y el proceso en marcha. Se actualiza cada 15 s. La alerta de sitio caído llega desde GitHub (issue "Site fora do ar").',
  'monitor.testServer': 'Forzar un error en el servidor',
  'monitor.testBrowser': 'Forzar un error en el navegador',
  'monitor.testServerDone': 'Error forzado en el servidor. Aparece en la lista de abajo.',
  'monitor.testBrowserDone': 'Error forzado en este navegador. Aparece en la lista en unos segundos.',
  'monitor.refresh': 'Actualizar',
  'monitor.uptime': 'En línea desde hace',
  'monitor.release': 'versión {release}',
  'monitor.memory': '{rss} MB de memoria ({heap} MB de heap)',
  'monitor.sseOpen': 'Canales en vivo abiertos',
  'monitor.sseOpenSplit': '{online} en partidas · {yonko} en Yonko',
  'monitor.sse24h': 'Canales en las últimas 24 h',
  'monitor.sseOpened': '{n|# abierto|# abiertos}',
  'monitor.sseDropsReconnects': '{drops} caídas · {reconnects} reconexiones',
  'monitor.errorsOpen': 'Errores abiertos',
  'monitor.errors24h': '{n|# visto en las últimas 24 h|# vistos en las últimas 24 h}',
  'monitor.sseTitle': 'Canales en vivo (SSE), por hora',
  'monitor.sseSinceStart':
    'Desde que arrancó el servidor: {opened} abiertos, {drops} caídas (el navegador o la red lo cerró), {ended} cerrados por el servidor, {reconnects} reconexiones; duración media {avg}.',
  'monitor.sseEmpty': 'Ningún canal abierto en las últimas 24 h.',
  'monitor.hour': 'Hora',
  'monitor.opened': 'Abiertos',
  'monitor.drops': 'Caídas',
  'monitor.reconnects': 'Reconexiones',
  'monitor.peak': 'Pico',
  'monitor.errorsTitle': 'Errores',
  'monitor.showResolved': 'Mostrar los resueltos',
  'monitor.clearResolved': 'Borrar los resueltos ({n})',
  'monitor.noErrors': 'Ningún error. 🎉',
  'monitor.sourceServer': 'Servidor',
  'monitor.sourceWeb': 'Navegador',
  'monitor.kindTest': 'prueba',
  'monitor.occurrences': '{n|# vez|# veces}',
  'monitor.firstSeen': 'Primera vez: {when}',
  'monitor.resolve': 'Marcar como resuelto',
  'errors.tooManyReports': 'Demasiados informes de error. Inténtalo más tarde.',
  'errors.badErrorReport': 'Informe de error no válido.',
  'errors.errorNotFound': 'Error no encontrado.',
} satisfies Record<keyof typeof monitorPtBR, string>;

export default monitor;
