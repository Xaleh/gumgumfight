// Monitoramento (Deutsch): a aba "Monitoramento" da Administração e os erros das rotas /api/monitor.

import type monitorPtBR from './pt-BR';

const monitor = {
  'monitor.tab': 'Überwachung',
  'monitor.hint':
    'Fehler von Server und Browser (gleiche werden zusammengefasst), die Live-Kanäle der Partien und der laufende Prozess. Aktualisiert alle 15 s. Die Warnung, dass die Seite down ist, kommt von GitHub (Issue „Site fora do ar“).',
  'monitor.testServer': 'Serverfehler auslösen',
  'monitor.testBrowser': 'Browserfehler auslösen',
  'monitor.testServerDone': 'Serverfehler ausgelöst. Er erscheint in der Liste unten.',
  'monitor.testBrowserDone': 'Fehler in diesem Browser ausgelöst. Er erscheint in wenigen Sekunden in der Liste.',
  'monitor.refresh': 'Aktualisieren',
  'monitor.uptime': 'Online seit',
  'monitor.release': 'Version {release}',
  'monitor.memory': '{rss} MB Speicher ({heap} MB Heap)',
  'monitor.sseOpen': 'Offene Live-Kanäle',
  'monitor.sseOpenSplit': '{online} in Partien · {yonko} im Yonko',
  'monitor.sse24h': 'Kanäle in den letzten 24 h',
  'monitor.sseOpened': '{n|# geöffnet|# geöffnet}',
  'monitor.sseDropsReconnects': '{drops} Abbrüche · {reconnects} Wiederverbindungen',
  'monitor.errorsOpen': 'Offene Fehler',
  'monitor.errors24h': '{n|# in den letzten 24 h gesehen|# in den letzten 24 h gesehen}',
  'monitor.sseTitle': 'Live-Kanäle (SSE) pro Stunde',
  'monitor.sseSinceStart':
    'Seit dem Serverstart: {opened} geöffnet, {drops} Abbrüche (Browser oder Netz hat geschlossen), {ended} vom Server beendet, {reconnects} Wiederverbindungen; durchschnittliche Dauer {avg}.',
  'monitor.sseEmpty': 'In den letzten 24 h wurde kein Kanal geöffnet.',
  'monitor.hour': 'Stunde',
  'monitor.opened': 'Geöffnet',
  'monitor.drops': 'Abbrüche',
  'monitor.reconnects': 'Wiederverbindungen',
  'monitor.peak': 'Spitze',
  'monitor.errorsTitle': 'Fehler',
  'monitor.showResolved': 'Erledigte anzeigen',
  'monitor.clearResolved': 'Erledigte löschen ({n})',
  'monitor.noErrors': 'Keine Fehler. 🎉',
  'monitor.sourceServer': 'Server',
  'monitor.sourceWeb': 'Browser',
  'monitor.kindTest': 'Test',
  'monitor.occurrences': '{n|# Mal|# Mal}',
  'monitor.firstSeen': 'Zum ersten Mal: {when}',
  'monitor.resolve': 'Als erledigt markieren',
  'errors.tooManyReports': 'Zu viele Fehlerberichte. Versuche es später noch einmal.',
  'errors.badErrorReport': 'Ungültiger Fehlerbericht.',
  'errors.errorNotFound': 'Fehler nicht gefunden.',
} satisfies Record<keyof typeof monitorPtBR, string>;

export default monitor;
