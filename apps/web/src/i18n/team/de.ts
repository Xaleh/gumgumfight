// Texte des Team-Bots (Deutsch).

import type { TeamMessages } from './pt-BR';

export default {
  'team.tag': 'Team',
  'team.tagTitle': 'Mitglied des Bot-Teams',
  'admin.teamHelpLabel': 'Team',
  'admin.teamHelp': 'Spielt gegen den Team-Bot (die Meta-Decks) und schickt Korrekturen seiner Züge.',
  'admin.team': 'Bot-Team',
  'admin.teamOn': 'Im Team',
  'admin.teamOff': 'Nicht im Team',
  'errors.invalidTeam': 'Gib an, ob das Konto ins Team kommt oder es verlässt.',
  'labels.deckGroup.meta': 'Meta-Decks',
  'decks.empty.meta': 'Keine Meta-Decks.',
  'decks.tab.meta': 'Meta-Decks',
  'menu.botTeam': 'Team',
  'menu.botTeamTitle': 'Team-Bot: spielt die Meta-Decks mit Deck-Wissen. Nur für Teammitglieder.',
  'menu.botTeamServer': 'Der Team-Bot spielt auf dem Server; die Partie erscheint unter „Zuschauen“.',
  'errors.invalidBotLevel': 'Ungültige Bot-Stufe.',
  'botFeedback.title': 'Bot bewerten',
  'botFeedback.star1': 'Schlecht gespielt',
  'botFeedback.star2': 'Unter den Erwartungen',
  'botFeedback.star3': 'Ordentlich',
  'botFeedback.star4': 'Gut gespielt',
  'botFeedback.star5': 'Wie ein starker Spieler',
  'botFeedback.commentPlaceholder': 'Was hat er falsch (oder richtig) gemacht? Nenne den Zug.',
  'botFeedback.marks': '{n|# markierter Zug|# markierte Züge}',
  'botFeedback.send': 'An das Team senden',
  'botFeedback.sent': 'Danke! Die Bewertung ging in den Korrektur-Posteingang des Bots.',
  'errors.teamOnly': 'Der Team-Bot ist nur für Teammitglieder.',
} satisfies TeamMessages;
