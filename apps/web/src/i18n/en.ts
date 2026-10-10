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
