// Team bot texts (English).

import type { TeamMessages } from './pt-BR';

export default {
  'team.tag': 'Team',
  'team.tagTitle': 'Member of the bot team',
  'admin.teamHelpLabel': 'Team',
  'admin.teamHelp': 'Plays against the Team Bot (the meta decks) and sends corrections of its plays.',
  'admin.team': 'Bot team',
  'admin.teamOn': 'On the team',
  'admin.teamOff': 'Not on the team',
  'errors.invalidTeam': 'Say whether the account joins or leaves the team.',
  'labels.deckGroup.meta': 'Meta decks',
  'decks.empty.meta': 'No meta decks.',
  'decks.tab.meta': 'Meta decks',
  'menu.botTeam': 'Team',
  'menu.botTeamTitle': 'Team Bot: plays the meta decks with deck knowledge. Only for team members.',
  'menu.botTeamServer': 'The Team Bot plays on the server; the match shows up under "Watch".',
  'errors.invalidBotLevel': 'Invalid bot level.',
  'botFeedback.title': 'Rate the bot',
  'botFeedback.star1': 'Played badly',
  'botFeedback.star2': 'Below expectations',
  'botFeedback.star3': 'Fair',
  'botFeedback.star4': 'Played well',
  'botFeedback.star5': 'Like a strong player',
  'botFeedback.commentPlaceholder': 'What did it get wrong (or right)? Mention the turn.',
  'botFeedback.marks': '{n|# play marked|# plays marked}',
  'botFeedback.send': 'Send to the team',
  'botFeedback.sent': 'Thanks! The review went to the bot\'s correction inbox.',
  'errors.teamOnly': 'The Team Bot is only for team members.',
} satisfies TeamMessages;
