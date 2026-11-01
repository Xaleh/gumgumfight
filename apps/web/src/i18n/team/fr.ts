// Textes du bot de l'équipe (français).

import type { TeamMessages } from './pt-BR';

export default {
  'team.tag': 'Équipe',
  'team.tagTitle': "Fait partie de l'équipe du bot",
  'admin.teamHelpLabel': 'Équipe',
  'admin.teamHelp': "Joue contre le Bot de l'équipe (les decks du méta) et envoie des corrections de ses coups.",
  'admin.team': "Équipe du bot",
  'admin.teamOn': "Dans l'équipe",
  'admin.teamOff': "Hors de l'équipe",
  'errors.invalidTeam': "Indiquez si le compte entre dans l'équipe ou en sort.",
  'labels.deckGroup.meta': 'Decks du méta',
  'decks.empty.meta': 'Aucun deck du méta.',
  'decks.tab.meta': 'Decks du méta',
  'menu.botTeam': 'Équipe',
  'menu.botTeamTitle': "Bot de l'équipe : joue les decks du méta avec la connaissance du deck. Réservé aux membres de l'équipe.",
  'menu.botTeamServer': "Le Bot de l'équipe joue sur le serveur ; la partie apparaît dans « Regarder ».",
  'errors.invalidBotLevel': 'Niveau du bot invalide.',
  'botFeedback.title': 'Évaluer le bot',
  'botFeedback.star1': 'A mal joué',
  'botFeedback.star2': 'En dessous des attentes',
  'botFeedback.star3': 'Correct',
  'botFeedback.star4': 'A bien joué',
  'botFeedback.star5': 'Comme un joueur fort',
  'botFeedback.commentPlaceholder': "Qu'a-t-il fait de mal (ou de bien) ? Citez le tour.",
  'botFeedback.marks': '{n|# coup marqué|# coups marqués}',
  'botFeedback.send': "Envoyer à l'équipe",
  'botFeedback.sent': "Merci ! L'évaluation est partie dans la boîte des corrections du bot.",
  'errors.teamOnly': "Le Bot de l'équipe est réservé aux membres de l'équipe.",
} satisfies TeamMessages;
