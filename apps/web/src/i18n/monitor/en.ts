// Monitoramento (English): a aba "Monitoramento" da Administração e os erros das rotas /api/monitor.

import type monitorPtBR from './pt-BR';

const monitor = {
  'monitor.tab': 'Monitoring',
  'monitor.hint':
    'Server and browser errors (identical ones are grouped), the live match channels and the running process. Refreshes every 15 s. The site-down alert comes from GitHub (issue "Site fora do ar").',
  'monitor.testServer': 'Force a server error',
  'monitor.testBrowser': 'Force a browser error',
  'monitor.testServerDone': 'Server error forced. It shows up in the list below.',
  'monitor.testBrowserDone': 'Error forced in this browser. It shows up in the list in a few seconds.',
  'monitor.refresh': 'Refresh',
  'monitor.uptime': 'Up for',
  'monitor.release': 'version {release}',
  'monitor.memory': '{rss} MB of memory ({heap} MB heap)',
  'monitor.sseOpen': 'Open live channels',
  'monitor.sseOpenSplit': '{online} in matches · {yonko} in Yonko',
  'monitor.sse24h': 'Channels in the last 24 h',
  'monitor.sseOpened': '{n|# opened|# opened}',
  'monitor.sseDropsReconnects': '{drops} drops · {reconnects} reconnections',
  'monitor.errorsOpen': 'Open errors',
  'monitor.errors24h': '{n|# seen in the last 24 h|# seen in the last 24 h}',
  'monitor.sseTitle': 'Live channels (SSE), per hour',
  'monitor.sseSinceStart':
    'Since the server started: {opened} opened, {drops} drops (the browser or the network closed it), {ended} ended by the server, {reconnects} reconnections; average length {avg}.',
  'monitor.sseEmpty': 'No channel opened in the last 24 h.',
  'monitor.hour': 'Hour',
  'monitor.opened': 'Opened',
  'monitor.drops': 'Drops',
  'monitor.reconnects': 'Reconnections',
  'monitor.peak': 'Peak',
  'monitor.errorsTitle': 'Errors',
  'monitor.showResolved': 'Show resolved',
  'monitor.clearResolved': 'Delete resolved ({n})',
  'monitor.noErrors': 'No errors. 🎉',
  'monitor.sourceServer': 'Server',
  'monitor.sourceWeb': 'Browser',
  'monitor.kindTest': 'test',
  'monitor.occurrences': '{n|# time|# times}',
  'monitor.firstSeen': 'First seen: {when}',
  'monitor.resolve': 'Mark as resolved',
  'errors.tooManyReports': 'Too many error reports. Try again later.',
  'errors.badErrorReport': 'Invalid error report.',
  'errors.errorNotFound': 'Error not found.',
} satisfies Record<keyof typeof monitorPtBR, string>;

export default monitor;
