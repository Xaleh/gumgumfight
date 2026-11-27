// Espera por oponente (Deutsch): a busca minimizada, o cartão de dicas e a mão de teste com o deck da fila.

import type waitPtBR from './pt-BR';

const wait = {
  'wait.minimize': 'Minimieren',
  'wait.minimizeHint': 'Die Suche läuft weiter, während du dir Statistiken, Turniere, Live-Partien und die Lektionen ansiehst.',
  'wait.pill': 'Suche einen Gegner',
  'wait.pillOpen': 'Suche seit {time} einen Gegner. Suche öffnen.',
  'wait.handTest': 'Testhand',
  'wait.handTestTitle': 'Testhand · {deck}',
  'wait.handSearching': 'Suche einen Gegner · {time}',
  'wait.handFailed': 'Das Deck konnte gerade nicht geladen werden.',
  'wait.inQueueNote': 'Du bist in der Warteschlange. Brich die Suche ab, um etwas anderes zu spielen.',
  'wait.leaveTitle': 'Warteschlange verlassen?',
  'wait.leaveText': 'Du suchst gerade einen Gegner. Wenn du diesen Bildschirm öffnest, verlässt du die Warteschlange.',
  'wait.leaveStay': 'In der Warteschlange bleiben',
  'wait.leaveGo': 'Warteschlange verlassen und öffnen',
  'wait.stopped': 'Die Suche nach einem Gegner wurde beendet: {reason}',
  // ---- cartão de dicas ----
  'wait.tipsLabel': 'Während du wartest',
  'wait.kickerRule': 'Regeltipp',
  'wait.kickerMeta': 'Meta der Woche',
  'wait.kickerDeck': 'Dein Deck',
  'wait.next': 'Nächster Tipp',
  'wait.metaTop': 'Meistgespielte Anführer der letzten 7 Tage: {list}.',
  'wait.deckRecord': 'Mit {name} hast du {wins} von {games|# Partie|# Partien} gegen andere Spieler gewonnen ({pct} %).',
  'wait.matchupBest': 'Dein bestes Matchup mit {name}: gegen {opp}, {pct} % Siege in {games|# Partie|# Partien}.',
  'wait.matchupWorst': 'Dein schwerstes Matchup mit {name}: gegen {opp}, {pct} % Siege in {games|# Partie|# Partien}.',
  'wait.tip.firstTurn': 'Wer anfängt, zieht im ersten Zug keine Karte und bekommt in diesem Zug nur 1 DON!!.',
  'wait.tip.noFirstAttack': 'Keiner der beiden Spieler greift in seinem ersten Zug an.',
  'wait.tip.rush': 'Ein Charakter greift in dem Zug, in dem er ins Spiel kommt, nicht an, außer er hat [Rush].',
  'wait.tip.rested': 'Du kannst nur erschöpfte Charaktere des Gegners angreifen. Der Anführer kann immer angegriffen werden.',
  'wait.tip.tie': 'Bei gleicher Stärke kommt der Angriff durch: Es reicht, die Stärke des Ziels zu erreichen.',
  'wait.tip.blockThenCounter': 'Die Verteidigung hat eine Reihenfolge: zuerst [Blocker], dann Counter. Nach einem Counter kannst du nicht mehr blocken.',
  'wait.tip.don': 'Ein angelegtes DON!! gibt nur in deinem Zug +1000 Stärke und kehrt zu Beginn deines nächsten Zuges in den Kostenbereich zurück.',
  'wait.tip.mulligan': 'Der Mulligan ist alles oder nichts: Du gibst alle 5 Karten zurück, mischst und ziehst 5 neue, nur ein einziges Mal.',
  'wait.tip.zeroLife': 'Mit 0 Leben bist du noch im Spiel: Du verlierst, wenn dein Anführer Schaden nimmt und kein Leben mehr übrig ist.',
  'wait.tip.deckOut': 'Wer 0 Karten im Deck hat, verliert die Partie.',
  'wait.tip.trigger': 'Wenn eine Lebenskarte mit [Trigger] durch Schaden auf deine Hand käme, darfst du sie aufdecken und stattdessen den [Trigger] aktivieren.',
  'wait.tip.doubleBanish': '[Double Attack] fügt dem Leben 2 Schaden zu. Mit [Banish] geht die Lebenskarte in die Ablage und ihr [Trigger] wird nicht aktiviert.',
  'wait.tip.fiveCharacters': 'Du kannst höchstens 5 Charaktere haben. Spielst du einen sechsten, geht einer von ihnen in die Ablage, und das zählt nicht als K.O.',
} satisfies Record<keyof typeof waitPtBR, string>;

export default wait;
