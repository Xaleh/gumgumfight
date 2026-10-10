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
  // ---- navigation ----
  'menu.navPlay': 'Play',
  'menu.navDecks': 'Deck builder',
  'menu.navTournaments': 'Tournaments',
  'menu.navWatch': 'Watch',
  'menu.navStats': 'Stats',
  'menu.navSettings': 'Settings',
  'menu.navReplay': 'Watch replay',
  'menu.navAdmin': 'Admin',
  'menu.navCoverage': 'Card coverage',
  'menu.footerNav': 'Footer',
  'menu.disclaimer':
    'Fan project, non-profit and not affiliated with Bandai, Toei Animation or Shueisha. The Portuguese translations are automatic and unofficial.',
  // ---- connection ----
  'menu.connecting': 'Connecting to the server…',
  'menu.connectFailed': 'Could not connect to the server. Check the [server] messages in the npm run dev terminal.',
  // ---- hero ----
  'menu.heroKicker': 'One Piece Card Game in your browser',
  'menu.heroTitle': 'Pick your mode',
  'menu.heroSub': 'Every match uses your equipped deck. Pick a queue and jump into a 1v1 duel, or practice against the bot.',
  'menu.myStats': 'My stats',
  'menu.watchMatches': 'Watch matches',
  'menu.watchReplayTitle': 'Watch a downloaded replay (.json)',
  'menu.nickname': 'Nickname',
  'menu.nicknameTitle': 'Change your nickname (Settings)',
  'menu.onlineWord': 'online',
  'menu.liveMatchesWord': '{n|live match|live matches}',
  'menu.inQueueNow': 'in queue now',
  // ---- open match banners ----
  'menu.playingBot': 'You have a practice match against the bot in progress.',
  'menu.playingTournament': 'You have a tournament match in progress.',
  'menu.playingOnline': 'You have an online match in progress.',
  'menu.clockRunning': 'Your clock may be running.',
  'menu.backToMatch': 'Back to the match',
  'menu.roomWaiting': 'Your room {code} is waiting for an opponent.',
  'menu.roomWaitingHint': 'Send the code or the link to whoever is playing with you.',
  'menu.openRoom': 'Open room',
  // ---- equipped deck ----
  'menu.equippedDeck': 'Equipped deck',
  'menu.opponentDeck': "Opponent's deck",
  'menu.chooseDeck': 'Choose a deck',
  'menu.loadingDecks': 'Loading decks…',
  'menu.leaderChip': 'Leader: {name}',
  'menu.incompleteChip': '{size}/50 cards: incomplete',
  'menu.validIn': 'Legal in {format}',
  'menu.notAllowedIn': 'Not allowed in {format}',
  'menu.notAllowedShort': '🚫 {format}',
  'menu.unscriptedChip': '⚙ {n} without automatic effect',
  'menu.unscriptedTitle': 'These cards can be played, but without their automatic effect',
  'menu.changeDeck': 'Change deck',
  'menu.format': 'Format',
  'menu.randomDeck': 'Random',
  'menu.choose': 'Choose',
  // ---- game modes ----
  'menu.modes': 'Game modes',
  'menu.modesHint': 'Live counters, updated every 10 s',
  'menu.counting': 'Counting…',
  'menu.queueLive': '{n|# match|# matches} · {q} in queue',
  'menu.findMatch': 'Find match',
  'menu.pickDeck': 'Choose a deck.',
  'menu.deckNotValidIn': 'The equipped deck is not legal in {format}.',
  'menu.finishCurrent': 'Finish your current match first.',
  'menu.rankedKicker': 'Competitive',
  'menu.ranked': 'Ranked',
  'menu.rankedDesc': 'Bounty on the line. You face players close to your level.',
  'menu.chipGoogleLogin': 'Google sign-in',
  'menu.chipNoManual': 'No manual effects',
  'menu.rankedNeedsLogin': 'Sign in with Google to play ranked.',
  'menu.rankedManualCards':
    '{n|The deck has # card with a manual effect (⚙), which ranked does not allow.|The deck has # cards with manual effects (⚙), which ranked does not allow.}',
  'menu.casualKicker': 'Casual',
  'menu.casual': 'Quick match',
  'menu.casualDesc': 'No bounty at stake. Great for testing a new deck.',
  'menu.chipAnyDeck': 'Any legal deck',
  'menu.chipClock': '{time} clock',
  'menu.privateKicker': 'With friends',
  'menu.private': 'Private room',
  'menu.privateDesc': "Create a room and share the code, or join a friend's room.",
  'menu.privateLive': '{n|# match|# matches} · {w|# room waiting|# rooms waiting}',
  'menu.createRoom': 'Create room',
  'menu.roomCode': 'Room code',
  'menu.roomCodePlaceholder': 'ABC123',
  'menu.joinRoom': 'Join',
  'menu.botKicker': 'Practice',
  'menu.vsBot': 'Against the bot',
  'menu.botDesc': 'Practice with any deck, no queue and no rush.',
  'menu.botLive': '{n|# practice match streamed|# practice matches streamed}',
  'menu.botLocal': 'Runs in your browser',
  'menu.bothDecksValid': 'Both decks must be legal in {format}.',
  'menu.battle': 'Battle!',
  'menu.opponent': 'Opponent: {name}',
  'menu.whoStarts': 'Who goes first',
  'menu.firstRandom': 'Coin flip',
  'menu.you': 'You',
  'menu.botName': 'Bot',
  'menu.botLevel': 'Bot level',
  'menu.botEasy': 'Easy',
  'menu.botNormal': 'Normal',
  'menu.botHard': 'Hard',
  'menu.broadcast': 'Stream this match',
  'menu.broadcastNeedsLogin': 'Stream: sign in with Google',
  'menu.broadcastTitle': 'The match shows up under "Watch".',
  'menu.broadcastFull': 'Streaming is full right now: this practice match runs in your browser, without spectators.',
  'menu.noBuiltinDeck': 'No ready-made deck is allowed in {format}.',
  'menu.tourKicker': 'Events',
  'menu.tourBadge': 'Swiss and single elimination',
  'menu.tourDesc': 'Community tournaments, with brackets, rounds and a clock.',
  'menu.chipTourLogin': 'Sign in to register',
  'menu.chipBestOf': 'Best of 1 or 3',
  'menu.tourLive': '{n|# open|# open} · {running} in progress',
  'menu.seeTournaments': 'See tournaments',
  // ---- test options (Dev) ----
  'menu.testOptions': 'Test options',
  'menu.testSeed': 'Shuffle seed',
  'menu.testSeedRerollTitle': 'Roll another',
  'menu.testSeedHint':
    'Number that sets the deck order and who goes first in matches against the bot. The same seed with the same plays repeats the match exactly, which helps reproduce a problem.',
  // ---- online queue (OnlineMenu) ----
  'menu.onlineRanked': 'Ranked',
  'menu.onlineCasual': 'Casual',
  'menu.onlineSearching': 'Looking for an opponent',
  'menu.onlineQueuePlayers': '{n} players in queue',
  'menu.onlineQueueAlone': 'You are the only one in the queue right now.',
  // ---- screen error (ErrorBoundary) ----
  'menu.errorHint': 'Something went wrong while drawing the screen. The match goes on: try again.',
  'menu.errorRetry': 'Try again',
  'menu.errorBackToMenu': 'Back to menu',
  'menu.errorReload': 'Reload the page',
  // ==== /menu ====


  // ==== home ====
  // ---- room kinds ----
  'home.queue.private': 'Private room',
  'home.queue.casual': 'Casual',
  'home.queue.ranked': 'Ranked',
  'home.queue.bot': 'Practice',
  'home.queue.tournament': 'Tournament',
  // ---- live now ----
  'home.liveNow': 'Live now',
  'home.seeAllMatches': 'See all',
  'home.versus': '{a} vs {b}',
  'home.whereTurn': '{where} · Turn {turn}',
  'home.watching': '{n} watching',
  'home.watch': 'Watch',
  'home.noLive': 'No public matches right now. How about starting one?',
  // ---- current tournament shortcut ----
  'home.timeLeft': '{m}min{s}s left',
  'home.deadlinePassed': 'time is up',
  'home.checkInOpenFor': 'Check-in open: {name}',
  'home.checkedInStarts': '✔ Checked in. The tournament starts at {time}: your room will show up here.',
  'home.confirmPresence': 'The tournament starts at {time}. Confirm you are in.',
  'home.openTournament': 'Open tournament',
  'home.doCheckIn': 'Check in',
  'home.matchTitle': '{name} · {label}: table {table} vs {opponent}',
  'home.matchTitleGame': '{name} · {label}: table {table} vs {opponent} (game {game})',
  'home.matchRunning': 'The match is in progress.',
  'home.enterUntil': 'Enter the room by {time} ({left}). No-shows lose by forfeit.',
  'home.oneWaiting': 'One of the players is already waiting in the room.',
  'home.firstWaits': 'Whoever enters first waits for the opponent in the room.',
  'home.backToGame': 'Back to the game',
  'home.enterRoom': 'Enter room',
  'home.tournamentRunning': '{name} in progress',
  'home.bye': 'You have a bye this round. Wait for the next one.',
  'home.roundDone': 'Your match this round is over. Wait for the next round.',
  // ---- tournaments ----
  'home.tournaments': 'Tournaments',
  'home.seeAllTournaments': 'See all',
  'home.round': 'Round {n}',
  'home.roundOf': 'Round {n} of {total}',
  'home.checkInOpen': 'Check-in open',
  'home.registered': '{count} registered',
  'home.playersCount': '{count} players',
  'home.noTournaments': 'No open tournaments right now.',
  'home.noTournamentsCreate': 'No open tournaments right now. How about organizing one?',
  // ---- weekly meta ----
  'home.meta': 'Meta of the week',
  'home.stats': 'Stats',
  'home.metaSub': 'Most played Leaders in the last 7 days',
  'home.noMeta': 'No matches in the last 7 days yet.',
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
