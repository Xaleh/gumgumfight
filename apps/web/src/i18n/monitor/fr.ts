// Monitoramento (Français): a aba "Monitoramento" da Administração e os erros das rotas /api/monitor.

import type monitorPtBR from './pt-BR';

const monitor = {
  'monitor.tab': 'Surveillance',
  'monitor.hint':
    'Erreurs du serveur et du navigateur (les identiques sont regroupées), les canaux en direct des parties et le processus en cours. Mise à jour toutes les 15 s. L’alerte de site hors ligne vient de GitHub (issue « Site fora do ar »).',
  'monitor.testServer': 'Provoquer une erreur serveur',
  'monitor.testBrowser': 'Provoquer une erreur navigateur',
  'monitor.testServerDone': 'Erreur provoquée sur le serveur. Elle apparaît dans la liste ci-dessous.',
  'monitor.testBrowserDone': 'Erreur provoquée dans ce navigateur. Elle apparaît dans la liste dans quelques secondes.',
  'monitor.refresh': 'Actualiser',
  'monitor.uptime': 'En ligne depuis',
  'monitor.release': 'version {release}',
  'monitor.memory': '{rss} Mo de mémoire ({heap} Mo de heap)',
  'monitor.sseOpen': 'Canaux en direct ouverts',
  'monitor.sseOpenSplit': '{online} en parties · {yonko} au Yonko',
  'monitor.sse24h': 'Canaux sur les dernières 24 h',
  'monitor.sseOpened': '{n|# ouvert|# ouverts}',
  'monitor.sseDropsReconnects': '{drops} coupures · {reconnects} reconnexions',
  'monitor.errorsOpen': 'Erreurs ouvertes',
  'monitor.errors24h': '{n|# vue sur les dernières 24 h|# vues sur les dernières 24 h}',
  'monitor.sseTitle': 'Canaux en direct (SSE), par heure',
  'monitor.sseSinceStart':
    'Depuis le démarrage du serveur : {opened} ouverts, {drops} coupures (le navigateur ou le réseau l’a fermé), {ended} fermés par le serveur, {reconnects} reconnexions ; durée moyenne {avg}.',
  'monitor.sseEmpty': 'Aucun canal ouvert sur les dernières 24 h.',
  'monitor.hour': 'Heure',
  'monitor.opened': 'Ouverts',
  'monitor.drops': 'Coupures',
  'monitor.reconnects': 'Reconnexions',
  'monitor.peak': 'Pic',
  'monitor.errorsTitle': 'Erreurs',
  'monitor.showResolved': 'Afficher les résolues',
  'monitor.clearResolved': 'Supprimer les résolues ({n})',
  'monitor.noErrors': 'Aucune erreur. 🎉',
  'monitor.sourceServer': 'Serveur',
  'monitor.sourceWeb': 'Navigateur',
  'monitor.kindTest': 'test',
  'monitor.occurrences': '{n|# fois|# fois}',
  'monitor.firstSeen': 'Première fois : {when}',
  'monitor.resolve': 'Marquer comme résolue',
  'errors.tooManyReports': 'Trop de rapports d’erreur. Réessayez plus tard.',
  'errors.badErrorReport': 'Rapport d’erreur invalide.',
  'errors.errorNotFound': 'Erreur introuvable.',
} satisfies Record<keyof typeof monitorPtBR, string>;

export default monitor;
