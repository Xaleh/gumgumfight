// Textos do Bot do Time (português do Brasil, referência das chaves): o perfil Time, o nível Time do
// bot, os decks do meta, a marcação de jogadas, o painel do treinador e a aba "Bot do Time" da Administração.

const teamPtBR = {
  // ---- perfil Time (conta e Administração) ----
  'team.tag': 'Time',
  'team.tagTitle': 'Faz parte do Time do bot',
  'admin.teamHelpLabel': 'Time',
  'admin.teamHelp': 'Joga contra o Bot do Time (os decks do meta) e envia correções das jogadas dele.',
  'admin.team': 'Time do bot',
  'admin.teamOn': 'Faz parte do Time',
  'admin.teamOff': 'Fora do Time',
  'errors.invalidTeam': 'Informe se a conta entra ou sai do Time.',
  // ---- nível Time no menu e decks do meta ----
  'labels.deckGroup.meta': 'Decks do meta',
  'decks.empty.meta': 'Nenhum deck do meta.',
  'decks.tab.meta': 'Decks do meta',
  'menu.botTeam': 'Time',
  'menu.botTeamTitle': 'Bot do Time: joga os decks do meta com o conhecimento do deck. Exclusivo de quem faz parte do Time.',
  'menu.botTeamServer': 'O Bot do Time joga no servidor; a partida aparece em "Assistir".',
  'errors.invalidBotLevel': 'Nível do bot inválido.',
  'errors.teamOnly': 'O Bot do Time é só para quem faz parte do Time.',
} as const;

export type TeamKey = keyof typeof teamPtBR;
export type TeamMessages = Record<TeamKey, string>;

export default teamPtBR;
