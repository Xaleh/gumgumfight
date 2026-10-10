// English.

import type { Messages } from './pt-BR';

export default {
  // ---- general ----
  'app.name': 'GumGum Fight',
  'app.error': 'Something went wrong',
  'common.close': 'Close',
  'common.back': 'Back',
  'common.save': 'Save',
  'common.saving': 'Saving…',
  'common.cancel': 'Cancel',
  'common.ok': 'OK',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.loading': 'Loading…',

  // ---- top bar / drawer ----
  'topbar.home': 'GumGum Fight: home',
  'topbar.nav': 'Main',
  'topbar.counting': 'Counting who is online',
  'topbar.online': '{n|# online|# online}',
  'topbar.onlineWord': 'online',
  'topbar.account': 'Account',
  'topbar.signIn': 'Sign in',
  'topbar.openMenu': 'Open menu',
  'topbar.closeMenu': 'Close menu',
  'topbar.menu': 'Menu',
  'topbar.themeDark': 'Dark theme',
  'topbar.themeLight': 'Light theme',
  'topbar.signOut': 'Sign out',
  'topbar.language': 'Language',
  'account.google': 'Google account',
  'account.signInHint': 'Sign in to keep your decks and stats in your account and play ranked.',
  'account.guest': 'Guest',
  'account.loginOff': 'Sign-in is turned off on this server.',

  // ---- settings ----
  'settings.title': '⚙️ Settings',
  'settings.dialog': 'Settings',
  'settings.language': 'Language',
  'settings.languageHint': 'Interface language. Card text is translated in Portuguese; in the other languages it shows the original English.',
  'settings.theme': 'Theme',
  'settings.themeHint': 'Light, dark or the same as your device.',
  'settings.themeSystem': 'Automatic',
  'settings.themeSystemShort': 'Auto',
  'settings.themeSystemTitle': 'Follows the device theme',
  'settings.themeLight': 'Light',
  'settings.themeLightTitle': 'Light theme',
  'settings.themeDark': 'Dark',
  'settings.themeDarkTitle': 'Dark theme',
  'settings.nickname': 'Nickname',
  'settings.nicknameHint': 'The name your opponent sees in online matches and against the bot, and that shows on the leaderboard (2 to 24 characters).',
  'settings.images': 'Card images',
  'settings.imagesHint': 'Shows the official card art. Turn off to load less data.',
  'settings.imagesOff': 'Disabled on this server (CARD_IMAGES=off).',
  'settings.imagesOffTitle': 'Images disabled on this server (CARD_IMAGES=off)',
  'settings.quickCounter': 'Counter without confirmation',
  'settings.quickCounterHint': 'In the Counter step, tapping a card (or dragging it to the table) uses the Counter right away.',
  'settings.quickCounterTitle': 'In the Counter step, tapping a card or dragging it to the table uses the Counter right away',
  'settings.animations': 'Animations',
  'settings.animationsHint': 'Cards flying across the table, turn-change banner and the opening dice roll.',
  'settings.replayCues': 'Clicks in replays',
  'settings.replayCuesHint':
    'When watching a replay, shows what the player clicked or chose (card outline, tap and caption) before each action. Turn off to see only the table.',
  'settings.replayCuesTitle': 'In replays, shows what the player clicked or chose (card outline, tap and caption) before each action',
  'settings.opponentChat': "Opponent's chat",
  'settings.opponentChatHint':
    "In online matches, shows the messages and emotes your opponent sends. Turn off to see nothing they write; your own messages still go out.",
  'settings.opponentChatTitle': 'In online matches, shows the messages and emotes your opponent sends',
  'settings.sfx': 'Sound effects',
  'settings.sfxHint': 'Cards, DON!!, attacks, damage, dice and the match result. On iPhone, the silent switch also applies.',
  'settings.sfxLabel': 'sound effects',
  'settings.music': 'Music',
  'settings.musicHint': 'Original GumGum Fight soundtrack in the menu and during matches.',
  'settings.musicLabel': 'music',
  'settings.mute': 'Mute',
  'settings.unmute': 'Unmute',
  'settings.muteLabel': 'Mute {what}',
  'settings.unmuteLabel': 'Unmute {what}',
  'settings.footer': 'Settings are stored in this browser and apply to every match. The nickname is stored on the server, tied to this browser.',

  // ---- labels shared across screens (api.ts) ----
  'labels.role.player': 'Player',
  'labels.role.streamer': 'Streamer',
  'labels.role.organizer': 'Organizer',
  'labels.role.admin': 'Admin',
  'labels.role.dev': 'Dev',
  'labels.structure.swiss': 'Swiss',
  'labels.structure.single': 'Single elimination',
  'labels.tourStatus.registration': 'Registration open',
  'labels.tourStatus.running': 'In progress',
  'labels.tourStatus.finished': 'Finished',

  // ==== menu ====
  // ==== /menu ====


  // ==== home ====
  // ==== /home ====


  // ==== deck ====
  // ==== /deck ====


  // ==== card ====
  // ==== /card ====


  // ==== online ====
  // ==== /online ====


  // ==== watch ====
  // ==== /watch ====


  // ==== admin ====
  // ==== /admin ====


  // ==== reports ====
  // ==== /reports ====


  // ==== tour ====
  // ==== /tour ====


  // ==== stats ====
  // ---- rates and intervals ----
  'stats.noGames': 'No games',
  'stats.winRateTitle': '{wins|# win|# wins} in {games|# game|# games} (95%: {lo} to {hi})',
  'stats.ciTitle': '95%: {lo} to {hi}',
  'stats.pp': '{sign}{value} pp',
  'stats.nameValue': '{name} ({value})',
  'stats.nameId': '{name} ({id})',
  'stats.listSep': ', ',
  'stats.gamesCount': '{n|# game|# games}',

  // ---- profile / bounty ----
  'stats.wanted': 'WANTED',
  'stats.renameTitle': 'Change name',
  'stats.unnamedPirate': 'Nameless pirate',
  'stats.tierOpen': '{min} or more',
  'stats.tierSpan': '{min} to {max}',
  'stats.tierRange': 'Range: {range}.',
  'stats.nextTier': 'Next tier: {label} ({min}).',
  'stats.bountyHint': 'Your bounty goes up and down in ranked games against other players. Games against the bot count in the stats as casual.',
  'stats.bountyHintPlayed':
    'Your bounty goes up and down in ranked games against other players ({n|# played|# played}). Games against the bot count in the stats as casual.',

  // ---- summary tiles ----
  'stats.tileGames': 'Games',
  'stats.tilePlayers': '{n|# player|# players}',
  'stats.tileWins': 'Wins',
  'stats.tileWinsOf': '{wins} of {games}',
  'stats.tileSecond': 'Going second',
  'stats.tileKeep': 'Keeping the hand',
  'stats.tileMulligan': 'After mulligan',
  'stats.first': 'Going first',
  'stats.second': 'Going second',

  // ---- meta summary ----
  'stats.metaTop': '{leader} is the most played Leader ({share} of games), with a {rate} win rate.',
  'stats.metaBest': 'Best win rate among Leaders with at least {min|# game|# games}: {leader}, {rate} (in {share} of games).',
  'stats.metaBestSame': 'Besides being the most played, it also has the best win rate among Leaders with at least {min|# game|# games}.',
  'stats.metaLosing': 'Heavily played but losing: {list}.',
  'stats.metaFirstSecond': 'Going first wins {first} of games; going second, {second}.',
  'stats.metaMulligan': 'After a mulligan the win rate is {mulligan}, versus {keep} when keeping the hand.',

  // ---- Leaders table ----
  'stats.noGamesFilters': 'No games match these filters.',
  'stats.leader': 'Leader',
  'stats.colGames': 'Games',
  'stats.colWins': 'Wins',
  'stats.colInterval': 'Interval (95%)',
  'stats.colFirstShort': '1st',
  'stats.colFirstTitle': 'Wins when going first',
  'stats.colSecondShort': '2nd',
  'stats.colSecondTitle': 'Wins when going second',
  'stats.colLists': 'Lists',
  'stats.colListsTitle': 'Different lists used',
  'stats.rowCardsTitle': "See this Leader's cards",
  'stats.hiddenLeaders': '{n|# Leader|# Leaders} with fewer than {min|# game|# games} hidden. Change the minimum in the filters to see them.',

  // ---- matchups ----
  'stats.backToMatrix': '← All Leaders table',
  'stats.vsEachLeader': '{leader} against each Leader',
  'stats.noMatchups': 'No matchups for this Leader with {min|# game|# games} or more.',
  'stats.colOpponent': 'Opponent',
  'stats.colFirstMatchupTitle': 'Wins of the analyzed Leader when going first',
  'stats.colSecondMatchupTitle': 'Wins of the analyzed Leader when going second',
  'stats.hiddenOpponents': '{n|# opponent|# opponents} with fewer than {min|# game|# games} hidden.',
  'stats.matrixHint':
    "Row = analyzed Leader, column = opposing Leader. Color goes from orange (loses more) to blue (wins more), through gray at 50%. On the diagonal (mirror), the rate is for whoever went first. Cells with fewer than {min|# game|# games} show only the count. Click a row to see all of that Leader's opponents.",
  'stats.cellTitle': '{a} vs {b}: {wins|# win|# wins} in {games}; going first: {rate} in {firstGames}',
  'stats.mirrorGames': '1st · {n}',

  // ---- trend ----
  'stats.sparkPoint': '{label}: {value}',
  'stats.weeks': 'Weeks',
  'stats.weeksCount': '{n|# week|# weeks}',
  'stats.risers': 'Rising this week: {list}.',
  'stats.fallers': 'Falling: {list}.',
  'stats.noTrend': 'No Leader with {min|# game|# games} or more in these weeks.',
  'stats.colUsage': 'Usage ({from} → {to})',
  'stats.colUsageTitle': 'Share of games in each week',
  'stats.colThisWeek': 'This week',
  'stats.colUsageDelta': 'Δ usage',
  'stats.colUsageDeltaTitle': 'Change in share compared to the previous week',
  'stats.colWinsWeek': 'Wins this week',
  'stats.colWinsPeriod': 'Wins in the period',
  'stats.rowMatchupsTitle': "See this Leader's matchups",
  'stats.trendFooter': "Weeks start on Monday. The filters' period does not apply here: the window is the one chosen above.",

  // ---- cards ----
  'stats.noCards': 'No cards with {min|# game|# games} or more match these filters.',
  'stats.cardsHint':
    "{lift}: wins with the card in the deck minus the Leader's overall wins ({base}); shown only when not every list runs the card. {opening}: the card was in the hand kept after the mulligan. {drawn}: it passed through the hand at some point. {iwd}: wins when drawn minus wins when not drawn; positive means the card helps when it shows up. Tap a header to sort.",
  'stats.colCard': 'Card',
  'stats.colInDeck': 'In deck',
  'stats.colInDeckTitle': 'Games with the card in the deck (average copies)',
  'stats.colLift': 'Lift',
  'stats.colLiftTitle': "Wins with the card in the deck minus the Leader's overall wins",
  'stats.colOpening': 'Opening hand',
  'stats.colDrawn': 'Drawn',
  'stats.colNotDrawn': 'Not drawn',
  'stats.colIwd': 'Δ drawn',
  'stats.colIwdTitle': 'Difference in wins between drawing and not drawing the card',
  'stats.colPlayed': 'Played',
  'stats.colPerGame': 'Uses/game',
  'stats.colPerGameTitle': 'Times played (or used as Counter) per game',
  'stats.copies': '×{n}',

  // ---- page / filters ----
  'stats.backMenu': '← Menu',
  'stats.title': 'Stats',
  'stats.updating': 'Updating…',
  'stats.filters': 'Filters',
  'stats.all': 'All',
  'stats.allFem': 'All',
  'stats.filterFormat': 'Format',
  'stats.filterQueue': 'Game',
  'stats.filterOpponent': 'Opponent',
  'stats.opponentBot': 'Bot',
  'stats.opponentHuman': 'Player',
  'stats.filterTurnOrder': 'Turn order',
  'stats.filterPeriod': 'Period',
  'stats.allTime': 'All time',
  'stats.days': '{n|# day|# days}',
  'stats.filterWhose': 'Whose',
  'stats.allPlayers': 'All players',
  'stats.onlyMe': 'Only me',
  'stats.filterMin': 'Minimum games per row',
  'stats.filterTiers': 'Tiers (bounty at game time)',
  'stats.tabLeaders': 'Leaders',
  'stats.tabMatchups': 'Matchups',
  'stats.tabTrend': 'Trend',
  'stats.tabCards': 'Cards',
  'stats.list': 'List',
  'stats.allLists': 'All lists',
  'stats.listOption': '{name} · {n|# game|# games}',
  'stats.footer':
    'The server replays every game from its replay before it enters the stats. Rates with fewer than {n|# game|# games} are dimmed: hover to see the confidence interval.',
  // ==== /stats ====


  // ==== game ====
  // ==== /game ====


  // ==== board ====
  // ==== /board ====


  // ==== dice ====
  // ==== /dice ====


  // ==== result ====
  // ==== /result ====


  // ==== replay ====
  // ==== /replay ====


  // ==== ability ====
  // ==== /ability ====


  // ==== engine ====
  // ==== /engine ====


  // ==== errors ====
  // ==== /errors ====

} satisfies Messages;
